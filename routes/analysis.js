"use strict";

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

module.exports = function createAnalysisRoutes(ctx) {
  const { io, http, ai, visor } = ctx;

  return async function handle(urlPath, method, req, res, body) {

    // POST /api/projects/:pid/analyze  (SSE)
    if (urlPath.match(/^\/api\/projects\/[^/]+\/analyze$/) && method === "POST") {
      const pid = urlPath.split("/")[3];

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      let aborted = false;
      req.on("close", () => { aborted = true; });

      const send = (type, payload) => {
        if (!aborted) res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
      };
      const progress = (msg) => { console.log("[analyze]", msg); send("progress", { message: msg }); };
      const done     = (result) => { send("done", { result }); res.end(); };
      const fail     = (err)    => { send("error", { message: err }); res.end(); };

      try {
        progress("Validating configuration…");
        const projects = io.readProjects();
        const project  = projects.find(p => p.id === pid);
        if (!project) return fail("Project not found");

        const cfg = io.readConfig();
        if (!cfg.defaultModelId) return fail("No default model configured in Settings → General");

        const models    = io.readModels();
        const providers = io.readProviders();
        const model     = models.find(m => m.id === cfg.defaultModelId);
        if (!model) return fail("Default model not found");
        const provider = providers.find(p => p.id === model.providerId);
        if (!provider) return fail("Provider not found");
        const needsKey = !["ollama", "claude-cli"].includes(provider.type);
        if (needsKey && !provider.key && !model.key) return fail("Provider not configured or missing API key");

        // ── Domain detection groups ──────────────────────────────────────────
        const DOMAIN_GROUPS = {
          game:      new Set(['game-development', 'engineering', 'testing', 'project-management', 'design', 'specialized', 'spatial-computing']),
          web:       new Set(['engineering', 'design', 'testing', 'project-management', 'product', 'specialized', 'marketing']),
          mobile:    new Set(['engineering', 'design', 'testing', 'project-management', 'product', 'specialized']),
          backend:   new Set(['engineering', 'testing', 'project-management', 'specialized', 'product']),
          marketing: new Set(['marketing', 'design', 'product', 'specialized', 'paid-media', 'sales']),
          assistant: new Set(['specialized', 'support', 'project-management', 'academic']),
          general:   null, // all groups
        };

        function detectDomain(text) {
          const t = (text || '').toLowerCase();
          if (/unreal|unity|godot|\bgame\b|gameplay|mmo|fps|rpg|npc|loot|quest|level design|matchmaking/.test(t)) return 'game';
          if (/\bios\b|android|swift\b|kotlin|flutter|react native|mobile app/.test(t)) return 'mobile';
          if (/react|vue|angular|svelte|nextjs|frontend|web app|saas|dashboard|html|css/.test(t)) return 'web';
          if (/\bapi\b|microservice|postgresql|mongodb|redis|graphql|rest\b|fastapi|express|django/.test(t)) return 'backend';
          if (/marketing|seo|content strateg|social media|campaign|brand/.test(t)) return 'marketing';
          if (/personal assistant|calendar|email|reminder|schedule|note.tak/.test(t)) return 'assistant';
          return 'general';
        }

        function parseJson(raw) {
          const stripped = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
          const jsonStr  = stripped.startsWith("{") || stripped.startsWith("[")
            ? stripped
            : (stripped.match(/\{[\s\S]*\}/)?.[0] || "");
          if (!jsonStr) throw new Error(`Non-JSON response: ${raw.slice(0, 200)}`);
          return JSON.parse(jsonStr);
        }

        // ── Read existing agents ─────────────────────────────────────────────
        progress("Reading existing agents…");
        const pagents      = io.readPAgents();
        const existingList = pagents[pid] || [];
        const existingAgents = existingList.length
          ? existingList.map(a => `- ${a.name}${a.role ? ` (${a.role})` : ""}`).join("\n")
          : "None yet";

        // ── Scan project docs ────────────────────────────────────────────────
        progress("Scanning project documentation…");
        const docParts = [];
        if (project.path) {
          // AGENTS.md intentionally excluded — may contain historical agent lists from other systems
          const docCandidates = ["README.md", "readme.md", "README.txt", "package.json", "pyproject.toml", "Cargo.toml", "CLAUDE.md"];
          for (const f of docCandidates) {
            const fp = path.join(project.path, f);
            if (fs.existsSync(fp)) {
              try { docParts.push(`### ${f}\n${fs.readFileSync(fp, "utf8").slice(0, 3000)}`); } catch {}
            }
          }
          const docsDir = path.join(project.path, "docs");
          if (fs.existsSync(docsDir)) {
            try {
              // Skip agent-list files — they describe historical/planned agents, not architecture
              const SKIP_DOCS = /^(agents|03-agents|agent-list|aifactory)/i;
              const files = fs.readdirSync(docsDir).filter(f => /\.(md|txt)$/i.test(f) && !SKIP_DOCS.test(f)).slice(0, 5);
              for (const f of files) {
                try { docParts.push(`### docs/${f}\n${fs.readFileSync(path.join(docsDir, f), "utf8").slice(0, 2000)}`); } catch {}
              }
            } catch {}
          }
        }
        const projectDocs = docParts.length
          ? `Found ${docParts.length} file(s): ${docParts.map(p => p.match(/^### (.+)/)?.[1]).join(", ")}\n\n` + docParts.join("\n\n")
          : "No documentation found.";
        progress(docParts.length ? `Read ${docParts.length} documentation file(s)` : "No documentation files found");

        // ── Load catalog (needed for both empty and normal paths) ─────────────
        const catalogFile   = path.join(ctx.webRoot, "data", "agents-catalog.json");
        const catalogAgents = fs.existsSync(catalogFile)
          ? (() => { try { return JSON.parse(fs.readFileSync(catalogFile, "utf8")); } catch { return []; } })()
          : [];

        // ── Exclude already-installed agents (by catalogId AND name) ──────────
        const existingIds   = new Set(existingList.map(a => a.catalogId).filter(Boolean));
        const existingNames = new Set(existingList.map(a => a.name.toLowerCase()));
        const notInstalled  = a => !existingIds.has(a.id) && !existingNames.has(a.name.toLowerCase());

        // ── SHORTCUT: no docs and no description → suggest Technical Writer ───
        const hasDesc = (project.description || '').trim().length > 20;
        if (!docParts.length && !hasDesc) {
          progress("No documentation found — suggesting a documentation agent first");
          const writer = catalogAgents.find(a => a.id === 'technical-writer') || catalogAgents.find(a => /technical.writer/i.test(a.name));
          const result = {
            analysis: `No documentation was found for "${project.name}". Before selecting a full agent team, start with a Technical Writer to create project documentation (README, architecture overview, requirements). Once documentation exists, re-run Analyze to get a complete, accurate team recommendation.`,
            agents: writer ? [{
              id: writer.id,
              name: writer.name,
              tier: "mandatory",
              covers: "Project documentation",
              reason: "No project documentation exists. A Technical Writer will create README, architecture docs, and requirements — enabling a proper analysis on the next run."
            }] : [],
            pipelines: [],
          };
          progress(`Done — suggested 1 agent (re-run Analyze after documentation is created)`);
          return done(result);
        }

        // ── Detect domain (server-side, no AI call) ──────────────────────────
        const domainHint = detectDomain((project.description || '') + ' ' + docParts.slice(0, 2).join(' '));
        progress(`Domain detected: ${domainHint}`);

        // ── Filter catalog by domain + exclude installed ──────────────────────
        progress("Loading agent catalog…");
        const allowedGroups = DOMAIN_GROUPS[domainHint];
        const available     = catalogAgents.filter(a => notInstalled(a) && (!allowedGroups || allowedGroups.has(a.group)));
        const catalogText   = available.map(a => {
          const caps = a.capabilities?.length ? ` | capabilities: ${a.capabilities.join(', ')}` : '';
          return `- id: "${a.id}" | group: ${a.group} | name: ${a.name}${caps} | ${a.description}`;
        }).join("\n");
        progress(`Catalog filtered: ${available.length} agents in ${[...new Set(available.map(a => a.group))].join(', ')}`);

        if (aborted) return;

        // ── PASS 1: extract functional areas ─────────────────────────────────
        progress("Pass 1 — Extracting functional requirements…");
        const pass1File = path.resolve(ctx.webRoot, "../../core/prompts/analyze-pass1.md");
        const pass1Tpl  = fs.existsSync(pass1File) ? fs.readFileSync(pass1File, "utf8") : "";
        const pass1Prompt = pass1Tpl
          .replace("{{project_name}}",        project.name)
          .replace("{{project_description}}", project.description || "No description")
          .replace("{{project_docs}}",        projectDocs)
          .replace("{{existing_agents}}",     existingAgents);

        const pass1Raw = await ai.callAI(model, provider, pass1Prompt);
        if (aborted) return;
        const pass1    = parseJson(pass1Raw);
        const funcAreas = (pass1.functional_areas || []).join("\n- ");
        const covered   = (pass1.covered_by_existing || []).join("\n- ") || "Nothing yet";
        progress(`Found ${pass1.functional_areas?.length || 0} functional areas: ${(pass1.functional_areas || []).slice(0, 3).join(', ')}…`);

        // ── PASS 2: match agents to requirements ─────────────────────────────
        progress("Pass 2 — Matching agents to requirements…");
        const installedNote = existingList.length
          ? `\n\nDo NOT recommend any of these already-installed agents: ${existingList.map(a => a.name).join(', ')}.`
          : '';
        const pass2File = path.resolve(ctx.webRoot, "../../core/prompts/analyze.md");
        const pass2Tpl  = fs.existsSync(pass2File) ? fs.readFileSync(pass2File, "utf8") : "";
        const pass2Prompt = pass2Tpl
          .replace("{{project_name}}",        project.name)
          .replace("{{project_description}}", (project.description || "No description") + installedNote)
          .replace("{{tech_stack}}",          (pass1.tech_stack || []).join(', ') || "Unknown")
          .replace("{{functional_areas}}",    funcAreas ? `- ${funcAreas}` : "No specific areas identified")
          .replace("{{covered_by_existing}}", covered)
          .replace("{{existing_agents}}",     existingAgents)
          .replace("{{catalog}}",             catalogText);

        const pass2Raw = await ai.callAI(model, provider, pass2Prompt);
        if (aborted) return;

        progress("Parsing response…");
        const result = parseJson(pass2Raw);
        // Final safety: strip any agents that are already installed
        if (result.agents) {
          result.agents = result.agents.filter(a => !existingNames.has(a.name.toLowerCase()) && !existingIds.has(a.id));
        }
        progress(`Done — ${result.agents?.length || 0} agents recommended, ${result.pipelines?.length || 0} pipelines suggested`);
        done(result);

      } catch (err) {
        console.error("[analyze]", err.message);
        fail(err.message);
      }
      return true; // SSE response already ended — do not fall through to 404 handler
    }

    // POST /api/projects/:pid/agents/:aid/tasks/:tid/decompose  (SSE)
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/tasks\/[^/]+\/decompose$/) && method === "POST") {
      const parts = urlPath.split("/");
      const xpid = parts[3], xaid = parts[5], xtid = parts[7];

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      let aborted = false;
      req.on("close", () => { aborted = true; });
      const send     = (type, payload) => { if (!aborted) res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`); };
      const progress = (msg)    => { console.log("[swarm]", msg); send("progress", { message: msg }); };
      const done     = (result) => { send("done", { result }); res.end(); };
      const fail     = (err)    => { send("error", { message: err }); res.end(); };

      try {
        const cfg = io.readConfig();
        if (!cfg.defaultModelId) return fail("No default model configured in Settings → General");
        const project  = io.readProjects().find(p => p.id === xpid);
        if (!project)  return fail("Project not found");
        const models    = io.readModels();
        const providers = io.readProviders();
        const model     = models.find(m => m.id === cfg.defaultModelId);
        if (!model)    return fail("Default model not found");
        const provider  = providers.find(p => p.id === model.providerId);
        if (!provider) return fail("Provider not found");

        progress("Reading task and team…");
        const tasks = visor.readAgentStoreFile(project, xaid, "tasks");
        const task  = tasks.find(t => t.id === xtid);
        if (!task) return fail("Task not found");

        const agents    = io.readPAgents()[xpid] || [];
        const agentList = agents.map(a => `- id: "${a.id}" | name: ${a.name} | role: ${a.role || a.description || a.group || "—"}`).join("\n");
        progress(`Found ${agents.length} agents in team`);

        const prompt = [
          `You are a task decomposition planner for an AI agent team.`,
          ``,
          `# Task to decompose`,
          `Title: ${task.title || task.name || "Untitled"}`,
          `Description: ${task.description || "No description provided"}`,
          `Priority: ${task.priority || "—"}`,
          ``,
          `# Available agents`,
          agentList || "No agents defined yet",
          ``,
          `# Instructions`,
          `Break this task into 3–7 concrete, atomic subtasks. Each subtask should:`,
          `- Be small enough for one agent to complete in one focused session`,
          `- Have a clear, specific title and description`,
          `- Be assigned to the most appropriate agent from the list above`,
          `- Have an execution order (parallel or sequential)`,
          ``,
          `Return ONLY valid JSON in this exact format:`,
          `{`,
          `  "analysis": "Brief one-sentence strategy explanation",`,
          `  "subtasks": [`,
          `    {`,
          `      "title": "Subtask title",`,
          `      "description": "What needs to be done specifically",`,
          `      "agentId": "agent-id-from-list",`,
          `      "agentName": "Agent display name",`,
          `      "order": 1,`,
          `      "mode": "sequential",`,
          `      "priority": "high"`,
          `    }`,
          `  ]`,
          `}`,
          ``,
          `mode values: "sequential" (depends on previous) or "parallel" (can run simultaneously).`,
          `Only use agent IDs from the Available agents list. Use the exact id values shown.`,
        ].join("\n");

        progress("Calling AI to plan decomposition…");
        if (aborted) return;
        const raw = await ai.callAI(model, provider, prompt);
        if (aborted) return;

        progress("Parsing decomposition plan…");
        const stripped = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
        const jsonStr  = stripped.startsWith("{") ? stripped : (stripped.match(/\{[\s\S]*\}/)?.[0] || "");
        if (!jsonStr) return fail("AI returned invalid response — no JSON found");
        const plan = JSON.parse(jsonStr);

        const subtasks = plan.subtasks || [];
        if (!subtasks.length) return fail("AI returned no subtasks");
        progress(`Creating ${subtasks.length} subtasks…`);

        const swarmId = crypto.randomUUID();
        const created = [];

        for (const sub of subtasks) {
          if (aborted) break;
          const targetAgent = agents.find(a => a.id === sub.agentId) || agents[0];
          if (!targetAgent) continue;
          const newTask = {
            id:          crypto.randomUUID(),
            title:       sub.title,
            description: sub.description || "",
            status:      "backlog",
            priority:    sub.priority || task.priority || "",
            parentId:    xtid,
            swarmId,
            swarmOrder:  sub.order || 0,
            swarmMode:   sub.mode || "sequential",
            createdAt:   new Date().toISOString(),
          };
          if (project?.path) {
            const tf  = path.join(project.path, ".legion", "agents", targetAgent.id, "tasks.json");
            let   lst = [];
            if (fs.existsSync(tf)) { try { lst = JSON.parse(fs.readFileSync(tf, "utf8")); } catch {} }
            lst.push(newTask);
            fs.mkdirSync(path.dirname(tf), { recursive: true });
            const tmp = tf + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(lst, null, 2)); fs.renameSync(tmp, tf);
          }
          created.push({ ...newTask, agentId: targetAgent.id, agentName: targetAgent.name });
          progress(`Created: "${sub.title}" → ${targetAgent.name}`);
        }

        // Tag parent task with swarm metadata
        if (project?.path) {
          const pf = path.join(project.path, ".legion", "agents", xaid, "tasks.json");
          if (fs.existsSync(pf)) {
            try {
              let lst = JSON.parse(fs.readFileSync(pf, "utf8"));
              const idx = lst.findIndex(t => t.id === xtid);
              if (idx >= 0) {
                lst[idx] = { ...lst[idx], swarmId, swarmChildCount: created.length, updatedAt: new Date().toISOString() };
                const tmp = pf + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(lst, null, 2)); fs.renameSync(tmp, pf);
              }
            } catch {}
          }
        }

        const agentSet = new Set(created.map(c => c.agentId)).size;
        progress(`Done — ${created.length} subtasks across ${agentSet} agent${agentSet !== 1 ? "s" : ""}`);
        done({ analysis: plan.analysis, subtasks: created, swarmId, parentTaskId: xtid });
      } catch (err) {
        console.error("[swarm]", err.message);
        fail("Decomposition failed: " + err.message);
      }
      return true;
    }

    return false;
  };
};
