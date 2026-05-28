"use strict";

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

module.exports = function createAgentRoutes(ctx) {
  const { io, http, agentFs, port, db, ws, stats } = ctx;

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
        // Apply defaults for new agents
        const cfg = io.readConfig();
        if (!agent.model && cfg.defaultModelId) {
          // Resolve to modelId string (e.g. "claude-sonnet-4-6") so the UI dropdown matches correctly.
          // cfg.defaultModelId may be a record UUID or a modelId string — handle both.
          const models = io.readModels();
          const def = models.find(m => m.id === cfg.defaultModelId || m.modelId === cfg.defaultModelId);
          agent.model = def?.modelId || cfg.defaultModelId;
        }
        if (agent.linearEnabled === undefined) agent.linearEnabled = true;
        if (!agent.linearLabelName) agent.linearLabelName = agent.name || agent.id;
        if (agent.allowedTools === undefined) agent.allowedTools = "Read,LS,Glob,Grep";
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
      const MAX_AVATAR = 5 * 1024 * 1024;
      const chunks = []; let avatarSize = 0;
      for await (const c of req) {
        avatarSize += c.length;
        if (avatarSize > MAX_AVATAR) { req.destroy(); http.json(res, 413, { error: "Avatar exceeds 5 MB limit" }); return true; }
        chunks.push(c);
      }
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
      const DEFAULT_FILES = ["IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md", "CONTEXT.md", "SKILLS.md"];
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
      const allowed = ["agent.md", "IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md", "CONTEXT.md", "SKILLS.md", "PIPELINE.md"];
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
      const allowed = ["agent.md", "IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md", "CONTEXT.md", "SKILLS.md", "PIPELINE.md"];
      if (!allowed.includes(filename)) { http.json(res, 400, { error: "Invalid file" }); return true; }
      const filePath = path.join(project.path, ".legion", "agents", agentId, filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, body.content || "");
      const rebuildFiles = ["IDENTITY.md", "SOUL.md", "CONTEXT.md", "MEMORY.md", "SKILLS.md"];
      if (rebuildFiles.includes(filename)) agentFs.buildClaudeAgentMd(project, agentId);
      http.json(res, 200, { ok: true });
      return true;
    }

    // GET /api/projects/:pid/agents/:aid/chat-stats — XP source from real chat_logs
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/chat-stats$/) && method === "GET") {
      const parts = urlPath.split("/");
      const projectId = parts[3], agentId = parts[5];
      http.json(res, 200, db.getChatStats(projectId, agentId));
      return true;
    }

    // GET /api/projects/:pid/agents/:aid/stats — ADR-0005 attempts/success/failure-modes
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/stats$/) && method === "GET") {
      const parts = urlPath.split("/");
      const projectId = parts[3], agentId = parts[5];
      const project = io.readProjects().find(p => p.id === projectId);
      http.json(res, 200, (stats && project) ? stats.load(project, agentId) : { attempted: 0, succeeded: 0, failures: [] });
      return true;
    }

    // Agent data stores: GET/POST/PATCH/DELETE /api/projects/:pid/agents/:aid/:store[/:itemId]
    const storeMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/agents\/([^/]+)\/(tasks|cron|workers|channels|memories|pipeline)(?:\/([^/]+))?$/);
    if (storeMatch) {
      const [, projectId, agentId, store, itemId] = storeMatch;
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agentId)) { http.json(res, 400, { error: "Invalid agent ID" }); return true; }
      const project = io.readProjects().find(p => p.id === projectId);

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
        http.json(res, 200, db.storeGet(projectId, agentId, store));
        return true;
      }
      if (method === "POST" && !itemId) {
        const item = { ...body, id: body.id || crypto.randomUUID(), createdAt: new Date().toISOString() };
        db.storePost(projectId, agentId, store, item);
        const list = db.storeGet(projectId, agentId, store);
        syncPipelineMd(list);
        if (store === "tasks") {
          db.log("task:created", projectId, agentId, { id: item.id, title: item.title, status: item.status });
          ws?.broadcast("task:created", { pid: projectId, aid: agentId, task: item });
        }
        http.json(res, 200, item);
        return true;
      }
      if ((method === "PATCH" || method === "PUT") && itemId) {
        const updated = db.storePatch(projectId, agentId, store, itemId, body);
        if (!updated) { http.json(res, 404, { error: "Not found" }); return true; }
        const list = db.storeGet(projectId, agentId, store);
        syncPipelineMd(list);
        if (store === "tasks") {
          db.log("task:updated", projectId, agentId, { id: itemId, status: updated.status, title: updated.title });
          ws?.broadcast("task:updated", { pid: projectId, aid: agentId, task: updated });
        }
        http.json(res, 200, updated);
        return true;
      }
      if (method === "DELETE" && itemId) {
        db.storeDel(projectId, agentId, store, itemId);
        const list = db.storeGet(projectId, agentId, store);
        syncPipelineMd(list);
        if (store === "tasks") {
          db.log("task:deleted", projectId, agentId, { id: itemId });
          ws?.broadcast("task:deleted", { pid: projectId, aid: agentId, taskId: itemId });
        }
        http.json(res, 200, { ok: true });
        return true;
      }
    }

    // POST /api/projects/:pid/agents/:aid/initialize  (SSE) — AI-populate all agent MD files
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/initialize$/) && method === "POST") {
      const parts     = urlPath.split("/");
      const projectId = parts[3];
      const agentId   = parts[5];
      const { progress, done, fail, isAborted } = http.createSSEHandler(res, req, "agent-init");

      try {
        const project = io.readProjects().find(p => p.id === projectId);
        if (!project) return fail("Project not found");

        const cfg = io.readConfig();
        if (!cfg.defaultModelId) return fail("No default model configured");
        const resolved = http.resolveModel(io.readModels(), io.readProviders(), cfg.defaultModelId);
        if (!resolved) return fail("Model not found or provider not configured");
        const { model, provider } = resolved;

        const allAgents = io.readPAgents()[projectId] || [];
        const agent = allAgents.find(a => a.id === agentId);
        if (!agent) return fail("Agent not found");

        // ── Load agent catalog definition ────────────────────────────────────
        progress("Reading agent catalog definition…");
        let agentDescription = agent.description || agent.role || "";
        let agentTools = agent.tools || "Read, Write, Edit";
        if (agent.catalogId) {
          const catalogFile = path.join(ctx.webRoot, "data", "agents-catalog.json");
          if (fs.existsSync(catalogFile)) {
            try {
              const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
              const entry = catalog.find(a => a.id === agent.catalogId);
              if (entry) {
                agentDescription = entry.description || agentDescription;
                if (entry.tools) agentTools = entry.tools;
              }
            } catch {}
          }
          // Also try reading the catalog MD file directly for full content
          const catalogMdCandidates = [
            path.resolve(ctx.webRoot, "../../core/agents/catalog", agent.catalogId.replace(/^catalog\//, "") + ".md"),
            path.resolve(ctx.webRoot, "../../core/agents", agent.catalogId + ".md"),
          ];
          for (const p of catalogMdCandidates) {
            if (fs.existsSync(p)) {
              try { agentDescription = fs.readFileSync(p, "utf8").slice(0, 3000); } catch {}
              break;
            }
          }
        }

        // ── Scan project docs ────────────────────────────────────────────────
        progress("Scanning project documentation…");
        const docParts = [];
        if (project.path) {
          const candidates = ["README.md", "readme.md", "CLAUDE.md", "package.json", "pyproject.toml"];
          for (const f of candidates) {
            const fp = path.join(project.path, f);
            if (fs.existsSync(fp)) {
              try { docParts.push(`### ${f}\n${fs.readFileSync(fp, "utf8").slice(0, 2000)}`); } catch {}
            }
          }
          // Also check .legion/LEGION.md for project agent context
          const legionMd = path.join(project.path, ".legion", "LEGION.md");
          if (fs.existsSync(legionMd)) {
            try { docParts.push(`### .legion/LEGION.md\n${fs.readFileSync(legionMd, "utf8").slice(0, 1500)}`); } catch {}
          }
          // Check docs/ directory
          const docsDir = path.join(project.path, "docs");
          if (fs.existsSync(docsDir)) {
            try {
              const files = fs.readdirSync(docsDir).filter(f => /\.(md|txt)$/i.test(f)).slice(0, 3);
              for (const f of files) {
                try { docParts.push(`### docs/${f}\n${fs.readFileSync(path.join(docsDir, f), "utf8").slice(0, 1500)}`); } catch {}
              }
            } catch {}
          }
        }
        const projectDocs = docParts.length ? docParts.join("\n\n") : "No documentation found.";
        progress(`Loaded ${docParts.length} documentation file(s)`);

        // ── Build existing agents list ────────────────────────────────────────
        const existingAgents = allAgents
          .filter(a => a.id !== agentId)
          .map(a => `- ${a.name}: ${a.role || a.description || ""}`)
          .join("\n") || "None yet";

        // ── Load prompt template ─────────────────────────────────────────────
        progress("Building initialization prompt…");
        const tplPath = path.resolve(ctx.webRoot, "../../core/prompts/agent-init.md");
        if (!fs.existsSync(tplPath)) return fail("agent-init.md prompt template not found");
        const tpl = fs.readFileSync(tplPath, "utf8");

        const agentSkills = (() => {
          const agentDir = path.join(project.path || "", ".legion", "agents", agentId);
          const skillsFile = path.join(agentDir, "SKILLS.md");
          if (fs.existsSync(skillsFile)) {
            const content = fs.readFileSync(skillsFile, "utf8");
            const skills = content.match(/^### (.+)$/gm);
            return skills ? skills.map(s => s.replace("### ", "")).join(", ") : "None";
          }
          return "None";
        })();

        const prompt = tpl
          .replace("{{agent_name}}",        agent.name || agentId)
          .replace("{{agent_role}}",        agent.role || agent.description || "")
          .replace("{{agent_description}}", agentDescription)
          .replace("{{agent_skills}}",      agentSkills)
          .replace("{{agent_tools}}",       agentTools)
          .replace("{{project_name}}",      project.name || "")
          .replace("{{project_description}}", project.description || "No description")
          .replace("{{project_docs}}",      projectDocs)
          .replace("{{existing_agents}}",   existingAgents);

        // ── Call AI ──────────────────────────────────────────────────────────
        progress("Generating agent files with AI…");
        if (isAborted()) return;
        const raw = await ai.callAI(model, provider, prompt);
        if (isAborted()) return;

        // ── Parse and write files ────────────────────────────────────────────
        progress("Parsing AI response…");
        let files;
        try { files = http.parseAIJson(raw); } catch { return fail("AI returned invalid JSON"); }

        const allowed = ["CONTEXT.md", "USER.md", "MEMORY.md", "IDENTITY.md", "SOUL.md", "SKILLS.md"];
        const agentDir = path.join(project.path || "", ".legion", "agents", agentId);
        fs.mkdirSync(agentDir, { recursive: true });

        const written = [];
        for (const filename of allowed) {
          if (files[filename]) {
            const filePath = path.join(agentDir, filename);
            fs.writeFileSync(filePath, files[filename]);
            written.push(filename);
            progress(`Wrote ${filename}`);
          }
        }

        agentFs.buildClaudeAgentMd(project, agentId);
        progress(`Done — wrote ${written.length} files: ${written.join(", ")}`);
        done({ ok: true, files: written });

      } catch (err) {
        console.error("[agent-init]", err.message);
        fail(err.message);
      }
      return true;
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
      agentFs.buildClaudeAgentMd(project, aid);
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
      db.deleteAgent(projectId, agentId);
      const project = io.readProjects().find(p => p.id === projectId);
      if (project) agentFs.deleteAgentFile(project, agentId);
      if (project) agentFs.syncLegionMd(project, projectId);
      db.log("agent:removed", projectId, agentId, { name: removed?.name });
      ws?.broadcast("agent:removed", { pid: projectId, aid: agentId, name: removed?.name });
      http.json(res, 200, { ok: true });
      return true;
    }

    return false;
  };
};
