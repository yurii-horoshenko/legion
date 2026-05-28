"use strict";

module.exports = function createMonitoringRoutes(ctx) {
  const { io, http, visor, db } = ctx;

  return async function handle(urlPath, method, req, res, body) {

    // GET /api/trace/:traceId — reconstruct a single run's chat-log timeline
    if (urlPath.match(/^\/api\/trace\/[^/]+$/) && method === "GET") {
      const traceId = decodeURIComponent(urlPath.split("/")[3]);
      http.json(res, 200, { traceId, events: db.getTrace(traceId) });
      return true;
    }

    // GET /api/projects/:pid/cron-runs — last execution status per cron job
    if (urlPath.match(/^\/api\/projects\/[^/]+\/cron-runs$/) && method === "GET") {
      const pid = urlPath.split("/")[3];
      const events = db.recent(pid, 300).filter(e => (e.type || "").startsWith("cron:")); // newest-first
      const runs = {};
      for (const e of events) {
        const jid = e.data?.jobId;
        if (!jid || runs[jid]) continue; // first seen = latest event for this job
        const status = e.type === "cron:error" ? "error" : e.type === "cron:done" ? "done" : "fired";
        runs[jid] = { ts: e.ts, status, detail: e.data?.error || e.data?.preview || "" };
      }
      http.json(res, 200, runs);
      return true;
    }

    // GET /api/projects/:pid/visor  — list bulletins
    if (urlPath.match(/^\/api\/projects\/[^/]+\/visor$/) && method === "GET") {
      const pid = urlPath.split("/")[3];
      const bulletins = visor.getBulletins(pid);
      if (!bulletins.length) {
        const b = visor.runVisorCheck(pid);
        http.json(res, 200, b ? [b] : []);
        return true;
      }
      http.json(res, 200, bulletins);
      return true;
    }

    // POST /api/projects/:pid/visor/check — manual check
    if (urlPath.match(/^\/api\/projects\/[^/]+\/visor\/check$/) && method === "POST") {
      const pid = urlPath.split("/")[3];
      const b   = visor.runVisorCheck(pid);
      http.json(res, 200, b || { error: "Project not found or has no path" });
      return true;
    }

    // GET /api/projects/:pid/tasks — aggregated agent tasks
    if (urlPath.match(/^\/api\/projects\/[^/]+\/tasks$/) && method === "GET") {
      const pid     = urlPath.split("/")[3];
      const project = io.readProjects().find(p => p.id === pid);
      if (!project) { http.json(res, 404, { error: "Project not found" }); return true; }
      const agents  = io.readPAgents()[pid] || [];
      const agentLookup = Object.fromEntries(agents.map(a => [a.id, a]));
      const items   = db.getProjectStores(pid, "tasks");
      const result  = items.map(task => {
        const agent = agentLookup[task.aid] || {};
        return { ...task, agentId: task.aid, agentName: agent.name, agentEmoji: agent.emoji || "🤖" };
      });
      http.json(res, 200, result);
      return true;
    }

    // GET /api/projects/:pid/pipelines — aggregate all agent pipeline connections
    if (urlPath.match(/^\/api\/projects\/[^/]+\/pipelines$/) && method === "GET") {
      const pid     = urlPath.split("/")[3];
      const project = io.readProjects().find(p => p.id === pid);
      if (!project) { http.json(res, 200, { agents: [], connections: [] }); return true; }

      const agents   = io.readPAgents()[pid] || [];
      const agentMap = Object.fromEntries(agents.map(a => [a.id, a]));
      const links    = db.getProjectStores(pid, "pipeline");

      const connections = links.map(l => ({
        from:      l.aid,
        fromName:  agentMap[l.aid]?.name  || l.aid,
        fromColor: agentMap[l.aid]?.color || "#6b7280",
        to:        l.targetAgentId,
        toName:    agentMap[l.targetAgentId]?.name  || l.targetAgentId,
        toColor:   agentMap[l.targetAgentId]?.color || "#6b7280",
        condition: l.condition || "always",
        mode:      l.mode      || "sequential",
        event:     l.event     || "task_complete",
      }));

      const agentList = agents.map(a => ({
        id: a.id, name: a.name, color: a.color, emoji: a.emoji, group: a.group, status: a.status,
      }));
      http.json(res, 200, { agents: agentList, connections });
      return true;
    }

    // GET /api/chat-logs?pid=&limit=  — full orchestration logs for current session
    if (urlPath === "/api/chat-logs" && method === "GET") {
      const qs    = new URL(req.url, "http://x").searchParams;
      const pid   = qs.get("pid") || undefined;
      const limit = Math.min(parseInt(qs.get("limit") || "200", 10), 1000);
      http.json(res, 200, db.getChatLogs(pid, limit));
      return true;
    }

    return false;
  };
};
