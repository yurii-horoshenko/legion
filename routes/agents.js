"use strict";

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

module.exports = function createAgentRoutes(ctx) {
  const { io, http, agentFs, port, db, ws } = ctx;

  return async function handle(urlPath, method, req, res, body) {

    // GET /api/projects/:pid/agents
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents$/) && method === "GET") {
      const projectId = urlPath.split("/")[3];
      const map = io.readPAgents();
      http.json(res, 200, map[projectId] || []);
      return true;
    }

    // POST /api/projects/:pid/agents
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents$/) && method === "POST") {
      const projectId = urlPath.split("/")[3];
      const agent     = body;
      // Ensure agent always has an id — derive from catalogId or name slug
      if (!agent.id) {
        agent.id = agent.catalogId ||
          (agent.name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      }
      const map       = io.readPAgents();
      if (!map[projectId]) map[projectId] = [];
      const existing  = map[projectId].findIndex(a => a.id === agent.id);
      const project   = io.readProjects().find(p => p.id === projectId);
      if (existing < 0) {
        map[projectId].push(agent);
        if (project) agentFs.writeAgentFile(project, agent);
      } else {
        map[projectId][existing] = { ...map[projectId][existing], ...agent };
        // Update agent.md frontmatter model field
        if (project?.path) {
          const mdPath = path.join(project.path, ".legion", "agents", agent.id, "agent.md");
          if (fs.existsSync(mdPath)) {
            let content = fs.readFileSync(mdPath, "utf8");
            content = content.replace(/^model:.*$/m, `model: ${agent.model || ""}`);
            fs.writeFileSync(mdPath, content);
          }
        }
      }
      io.writePAgents(map);
      if (project) agentFs.syncLegionMd(project, projectId);
      const ev = { pid: projectId, aid: agent.id, name: agent.name, action: existing < 0 ? "added" : "updated" };
      db?.log("agent:" + ev.action, projectId, agent.id, { name: agent.name });
      ws?.broadcast("agent:" + ev.action, ev);
      http.json(res, 200, { ok: true });
      return true;
    }

    // GET /api/projects/:pid/agents/:aid/avatar
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/avatar$/) && method === "GET") {
      const parts = urlPath.split("/");
      const projectId = parts[3]; const agentId = parts[5];
      const project = io.readProjects().find(p => p.id === projectId);
      if (!project?.path) { http.json(res, 404, { error: "No path" }); return true; }
      const dir = path.join(project.path, ".legion", "agents", agentId);
      for (const ext of ["png", "jpg", "jpeg", "webp", "gif"]) {
        const fp = path.join(dir, `avatar.${ext}`);
        if (fs.existsSync(fp)) {
          const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/png";
          res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
          res.end(fs.readFileSync(fp));
          return true;
        }
      }
      http.json(res, 404, { error: "No avatar" });
      return true;
    }

    // PUT /api/projects/:pid/agents/:aid/avatar
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/avatar$/) && method === "PUT") {
      const parts = urlPath.split("/");
      const projectId = parts[3]; const agentId = parts[5];
      const project = io.readProjects().find(p => p.id === projectId);
      if (!project?.path) { http.json(res, 404, { error: "No path" }); return true; }
      const ct  = req.headers["content-type"] || "";
      const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "png";
      const dir = path.join(project.path, ".legion", "agents", agentId);
      fs.mkdirSync(dir, { recursive: true });
      // Remove old avatars
      for (const e of ["png","jpg","jpeg","webp","gif"]) { try { fs.unlinkSync(path.join(dir, `avatar.${e}`)); } catch {} }
      const chunks = []; for await (const c of req) chunks.push(c);
      fs.writeFileSync(path.join(dir, `avatar.${ext}`), Buffer.concat(chunks));
      http.json(res, 200, { ok: true });
      return true;
    }

    // GET /api/projects/:pid/agents/:aid/files
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/files$/) && method === "GET") {
      const parts     = urlPath.split("/");
      const projectId = parts[3];
      const agentId   = parts[5];
      const project   = io.readProjects().find(p => p.id === projectId);
      if (!project?.path) { http.json(res, 404, { error: "Project has no path" }); return true; }
      const agentDir  = path.join(project.path, ".legion", "agents", agentId);
      const DEFAULT_FILES = ["AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md", "CONTEXT.md", "SKILLS.md"];
      const files = fs.existsSync(agentDir)
        ? fs.readdirSync(agentDir).filter(f => f.endsWith(".md") && f !== "agent.md").sort()
        : DEFAULT_FILES;
      http.json(res, 200, { files });
      return true;
    }

    // GET /api/projects/:pid/agents/:aid/files/:filename
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/files\/[^/]+$/) && method === "GET") {
      const parts     = urlPath.split("/");
      const projectId = parts[3];
      const agentId   = parts[5];
      const filename  = parts[7];
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agentId)) { http.json(res, 400, { error: "Invalid agent ID" }); return true; }
      const project   = io.readProjects().find(p => p.id === projectId);
      if (!project?.path) { http.json(res, 404, { error: "Project has no path" }); return true; }
      const allowed = ["agent.md", "AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md", "CONTEXT.md", "SKILLS.md", "PIPELINE.md"];
      if (!allowed.includes(filename)) { http.json(res, 400, { error: "Invalid file" }); return true; }
      const agentDir = path.join(project.path, ".legion", "agents", agentId);
      // Migrate flat file → directory if needed
      const legacyFlat = path.join(project.path, ".legion", "agents", agentId + ".md");
      if (!fs.existsSync(agentDir) && fs.existsSync(legacyFlat)) {
        fs.mkdirSync(agentDir, { recursive: true });
        fs.renameSync(legacyFlat, path.join(agentDir, "agent.md"));
        // Bootstrap doc files
        const map = io.readPAgents();
        const agent = (map[projectId] || []).find(a => a.id === agentId) || { id: agentId, name: agentId };
        agentFs.writeAgentFile(project, agent);
      } else if (!fs.existsSync(agentDir)) {
        // Bootstrap from stored agent data
        const map = io.readPAgents();
        const agent = (map[projectId] || []).find(a => a.id === agentId) || { id: agentId, name: agentId };
        agentFs.writeAgentFile(project, agent);
      }
      const filePath = path.join(agentDir, filename);
      const content  = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
      http.json(res, 200, { content });
      return true;
    }

    // PUT /api/projects/:pid/agents/:aid/files/:filename
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/files\/[^/]+$/) && method === "PUT") {
      const parts     = urlPath.split("/");
      const projectId = parts[3];
      const agentId   = parts[5];
      const filename  = parts[7];
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agentId)) { http.json(res, 400, { error: "Invalid agent ID" }); return true; }
      const project   = io.readProjects().find(p => p.id === projectId);
      if (!project?.path) { http.json(res, 404, { error: "Project has no path" }); return true; }
      const allowed = ["agent.md", "AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md", "CONTEXT.md", "SKILLS.md", "PIPELINE.md"];
      if (!allowed.includes(filename)) { http.json(res, 400, { error: "Invalid file" }); return true; }
      const filePath = path.join(project.path, ".legion", "agents", agentId, filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, body.content || "");
      http.json(res, 200, { ok: true });
      return true;
    }

    // Agent data stores: GET/POST/PATCH/DELETE /api/projects/:pid/agents/:aid/:store[/:itemId]
    const storeMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/agents\/([^/]+)\/(tasks|cron|workers|channels|memories|pipeline)(?:\/([^/]+))?$/);
    if (storeMatch) {
      const [, projectId, agentId, store, itemId] = storeMatch;
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agentId)) { http.json(res, 400, { error: "Invalid agent ID" }); return true; }
      const project = io.readProjects().find(p => p.id === projectId);

      function storeFile() {
        if (!project?.path) return null;
        const dir = path.join(project.path, ".legion", "agents", agentId);
        fs.mkdirSync(dir, { recursive: true });
        return path.join(dir, store + ".json");
      }
      function readStore() {
        const f = storeFile();
        if (!f || !fs.existsSync(f)) return [];
        try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return []; }
      }
      function writeStore(data) {
        const f = storeFile();
        if (!f) return;
        const d = JSON.stringify(data, null, 2);
        const tmp = f + ".tmp";
        fs.writeFileSync(tmp, d);
        fs.renameSync(tmp, f);
      }

      // After any pipeline mutation, regenerate PIPELINE.md for human/AI readability
      // Also regenerates LEGION.md for pipeline and cron changes
      function syncPipelineMd(list) {
        if (!project?.path) return;
        if (store === "pipeline") {
          const agentMap = {};
          (io.readPAgents()[projectId] || []).forEach(a => { agentMap[a.id] = a.name || a.id; });
          const agentName = agentMap[agentId] || agentId;
          const rows = list.map(p => {
            const toName = agentMap[p.targetAgentId] || p.targetAgentId || "?";
            return `| ${toName} | ${p.condition || "always"} | ${p.mode || "sequential"} | ${p.event || "task_complete"} |`;
          });
          const md = rows.length
            ? `# PIPELINE.md — ${agentName}\n\nOutgoing triggers after task completion.\n\n| To Agent | Condition | Mode | Event |\n|----------|-----------|------|-------|\n${rows.join("\n")}\n`
            : `# PIPELINE.md — ${agentName}\n\nNo outgoing triggers configured.\n`;
          const mdPath = path.join(project.path, ".legion", "agents", agentId, "PIPELINE.md");
          fs.mkdirSync(path.dirname(mdPath), { recursive: true });
          fs.writeFileSync(mdPath, md);
        }
        if (store === "pipeline" || store === "cron") {
          agentFs.syncLegionMd(project, projectId);
        }
      }

      if (method === "GET" && !itemId) {
        http.json(res, 200, readStore());
        return true;
      }
      if (method === "POST" && !itemId) {
        const item = { ...body, id: body.id || crypto.randomUUID(), createdAt: new Date().toISOString() };
        const list = readStore();
        list.push(item);
        writeStore(list);
        syncPipelineMd(list);
        if (store === "tasks") {
          db?.log("task:created", projectId, agentId, { id: item.id, title: item.title, status: item.status });
          ws?.broadcast("task:created", { pid: projectId, aid: agentId, task: item });
        }
        http.json(res, 200, item);
        return true;
      }
      if ((method === "PATCH" || method === "PUT") && itemId) {
        const list = readStore();
        const idx  = list.findIndex(x => x.id === itemId);
        if (idx < 0) { http.json(res, 404, { error: "Not found" }); return true; }
        list[idx] = { ...list[idx], ...body, id: itemId, updatedAt: new Date().toISOString() };
        writeStore(list);
        syncPipelineMd(list);
        if (store === "tasks") {
          db?.log("task:updated", projectId, agentId, { id: itemId, status: list[idx].status, title: list[idx].title });
          ws?.broadcast("task:updated", { pid: projectId, aid: agentId, task: list[idx] });
        }
        http.json(res, 200, list[idx]);
        return true;
      }
      if (method === "DELETE" && itemId) {
        const list = readStore().filter(x => x.id !== itemId);
        writeStore(list);
        syncPipelineMd(list);
        if (store === "tasks") {
          db?.log("task:deleted", projectId, agentId, { id: itemId });
          ws?.broadcast("task:deleted", { pid: projectId, aid: agentId, taskId: itemId });
        }
        http.json(res, 200, { ok: true });
        return true;
      }
    }

    // POST /api/projects/:pid/agents/:aid/activate — write agent's model to .claude/settings.json
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/activate$/) && method === "POST") {
      const parts = urlPath.split("/");
      const pid = parts[3], aid = parts[5];
      const map = io.readPAgents();
      const agent = (map[pid] || []).find(a => a.id === aid);
      if (!agent) { http.json(res, 404, { error: "Agent not found" }); return true; }
      const project = io.readProjects().find(p => p.id === pid);
      if (!project?.path) { http.json(res, 404, { error: "Project path not configured" }); return true; }

      const settingsDir  = path.join(project.path, ".claude");
      const settingsFile = path.join(settingsDir, "settings.json");
      let settings = {};
      if (fs.existsSync(settingsFile)) {
        try { settings = JSON.parse(fs.readFileSync(settingsFile, "utf8")); } catch {}
      }
      // Detect provider type to decide whether to route through Legion proxy
      const allModels     = io.readModels();
      const allProviders  = io.readProviders();
      const agentModelObj = allModels.find(m => m.modelId === agent.model || m.id === agent.model);
      const agentProvider = agentModelObj ? allProviders.find(p => p.id === agentModelObj.providerId) : null;
      const isClaudeCli   = agentProvider?.type === "claude-cli";

      if (agent.model) {
        settings.model = agent.model;
        if (!isClaudeCli) {
          // Non-Claude provider (Ollama, OpenAI, etc.) — route through Legion Anthropic-compatible proxy
          settings.env = {
            ANTHROPIC_BASE_URL: `http://localhost:${port}/api/proxy`,
            ANTHROPIC_API_KEY:  "legion",
          };
        } else {
          delete settings.env;
        }
      } else {
        delete settings.model;
        delete settings.env;
      }
      fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
      http.json(res, 200, { ok: true, model: agent.model || null, proxy: !!(agent.model && !isClaudeCli) });
      return true;
    }

    // DELETE /api/projects/:pid/agents/:aid
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+$/) && method === "DELETE") {
      const parts     = urlPath.split("/");
      const projectId = parts[3];
      const agentId   = parts[5];
      const map       = io.readPAgents();
      const removed   = (map[projectId] || []).find(a => a.id === agentId);
      if (map[projectId]) map[projectId] = map[projectId].filter(a => a.id !== agentId);
      io.writePAgents(map);
      const project = io.readProjects().find(p => p.id === projectId);
      if (project) agentFs.deleteAgentFile(project, agentId);
      if (project) agentFs.syncLegionMd(project, projectId);
      db?.log("agent:removed", projectId, agentId, { name: removed?.name });
      ws?.broadcast("agent:removed", { pid: projectId, aid: agentId, name: removed?.name });
      http.json(res, 200, { ok: true });
      return true;
    }

    return false;
  };
};
