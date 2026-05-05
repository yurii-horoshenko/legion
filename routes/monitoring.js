"use strict";

const fs   = require("fs");
const path = require("path");

module.exports = function createMonitoringRoutes(ctx) {
  const { io, http, visor } = ctx;

  return async function handle(urlPath, method, req, res, body) {

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
      const parts   = urlPath.split("/");
      const project = io.readProjects().find(p => p.id === parts[3]);
      if (!project?.path) { http.json(res, 404, { error: "Project not found" }); return true; }
      const agents = io.readPAgents()[parts[3]] || [];
      const result = [];
      for (const agent of agents) {
        const tasks = visor.readAgentStoreFile(project, agent.id, "tasks");
        for (const t of tasks) {
          result.push({ ...t, agentId: agent.id, agentName: agent.name, agentEmoji: agent.emoji || "🤖" });
        }
      }
      http.json(res, 200, result);
      return true;
    }

    // GET /api/projects/:pid/pipelines — aggregate all agent pipeline connections
    if (urlPath.match(/^\/api\/projects\/[^/]+\/pipelines$/) && method === "GET") {
      const pid = urlPath.split("/")[3];
      const project = io.readProjects().find(p => p.id === pid);
      if (!project?.path) { http.json(res, 200, { agents: [], connections: [] }); return true; }

      const agents    = io.readPAgents()[pid] || [];
      const agentMap  = Object.fromEntries(agents.map(a => [a.id, a]));
      const connections = [];

      for (const agent of agents) {
        const pf = path.join(project.path, ".legion", "agents", agent.id, "pipeline.json");
        if (!fs.existsSync(pf)) continue;
        try {
          const links = JSON.parse(fs.readFileSync(pf, "utf8"));
          for (const l of links) {
            connections.push({
              from:      agent.id,
              fromName:  agent.name  || agent.id,
              fromColor: agent.color || "#6b7280",
              to:        l.targetAgentId,
              toName:    agentMap[l.targetAgentId]?.name  || l.targetAgentId,
              toColor:   agentMap[l.targetAgentId]?.color || "#6b7280",
              condition: l.condition || "always",
              mode:      l.mode      || "sequential",
              event:     l.event     || "task_complete",
            });
          }
        } catch {}
      }

      const agentList = agents.map(a => ({
        id: a.id, name: a.name, color: a.color, emoji: a.emoji, group: a.group, status: a.status,
      }));
      http.json(res, 200, { agents: agentList, connections });
      return true;
    }

    return false;
  };
};
