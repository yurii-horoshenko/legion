"use strict";

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

module.exports = function createVisor(io, aiLib) {
  const VISOR_BULLETINS = {}; // projectId → [bulletin, ...]
  const VISOR_STALE_MS  = 10 * 60 * 1000; // 10 minutes

  function readAgentStoreFile(project, agentId, store) {
    if (!project?.path) return [];
    const f = path.join(project.path, ".legion", "agents", agentId, store + ".json");
    if (!fs.existsSync(f)) return [];
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return []; }
  }

  function runVisorCheck(projectId) {
    try {
      const project = io.readProjects().find(p => p.id === projectId);
      if (!project?.path) return null;
      const agents  = io.readPAgents()[projectId] || [];
      const now     = Date.now();
      let activeWorkers = 0, staleWorkers = 0, failedWorkers = 0;
      let totalTasks = 0, stuckTasks = 0, doneTasks = 0;
      const agentReports = [];

      for (const agent of agents) {
        const workers = readAgentStoreFile(project, agent.id, "workers");
        const tasks   = readAgentStoreFile(project, agent.id, "tasks");
        const running = workers.filter(w => w.status === "running");
        const stale   = running.filter(w => (now - new Date(w.updatedAt || w.createdAt || 0).getTime()) > VISOR_STALE_MS);
        const failed  = workers.filter(w => w.status === "failed");
        const inProg  = tasks.filter(t => /in_progress/i.test(t.status || ""));
        const stuck   = inProg.filter(t => (now - new Date(t.updatedAt || t.createdAt || 0).getTime()) > VISOR_STALE_MS);
        const done    = tasks.filter(t => /^done$|^completed$/i.test(t.status || ""));
        activeWorkers += running.length;
        staleWorkers  += stale.length;
        failedWorkers += failed.length;
        totalTasks    += tasks.length;
        stuckTasks    += stuck.length;
        doneTasks     += done.length;
        if (stale.length || failed.length || stuck.length) {
          agentReports.push({ agentId: agent.id, name: agent.name || agent.id, emoji: agent.emoji || "🤖",
            staleWorkers: stale.length, failedWorkers: failed.length, stuckTasks: stuck.length });
        }
      }

      const issues = [];
      if (staleWorkers)  issues.push(`${staleWorkers} stale worker${staleWorkers > 1 ? "s" : ""}`);
      if (failedWorkers) issues.push(`${failedWorkers} failed worker${failedWorkers > 1 ? "s" : ""}`);
      if (stuckTasks)    issues.push(`${stuckTasks} stuck task${stuckTasks > 1 ? "s" : ""}`);
      const health  = issues.length === 0 ? "healthy" : issues.length <= 1 ? "degraded" : "critical";
      const summary = issues.length === 0
        ? `System nominal. ${agents.length} agent${agents.length !== 1 ? "s" : ""}, ${activeWorkers} active worker${activeWorkers !== 1 ? "s" : ""}, ${doneTasks}/${totalTasks} tasks done.`
        : `Issues: ${issues.join(", ")}. ${activeWorkers} active workers, ${doneTasks}/${totalTasks} tasks done.`;

      const bulletin = { id: crypto.randomUUID(), timestamp: new Date().toISOString(),
        health, summary, activeWorkers, staleWorkers, failedWorkers,
        totalTasks, doneTasks, stuckTasks, agentCount: agents.length, agentReports };
      if (!VISOR_BULLETINS[projectId]) VISOR_BULLETINS[projectId] = [];
      VISOR_BULLETINS[projectId].unshift(bulletin);
      if (VISOR_BULLETINS[projectId].length > 20) VISOR_BULLETINS[projectId].length = 20;
      return bulletin;
    } catch (e) { console.error("[visor]", e.message); return null; }
  }

  // Periodic check for all projects
  setInterval(() => { try { for (const p of io.readProjects()) runVisorCheck(p.id); } catch {} }, 30_000);

  return {
    runVisorCheck,
    readAgentStoreFile,
    getBulletins: (projectId) => VISOR_BULLETINS[projectId] || [],
  };
};
