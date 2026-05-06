"use strict";

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

// One active analysis per project at a time
const _activeAnalyze = new Set();

module.exports = function createAnalysisRoutes(ctx) {
  const { io, http, ai, visor } = ctx;

  return async function handle(urlPath, method, req, res, body) {

    // POST /api/projects/:pid/analyze  (SSE)
    if (urlPath.match(/^\/api\/projects\/[^/]+\/analyze$/) && method === "POST") {
      const pid = urlPath.split("/")[3];

      if (_activeAnalyze.has(pid)) {
        const { fail } = http.createSSEHandler(res, req, "analyze");
        fail("Analysis already running for this project"); return true;
      }
      _activeAnalyze.add(pid);

      const { progress, done, fail, isAborted } = http.createSSEHandler(res, req, "analyze");

      try {
        progress("Validating configuration…");
        const project = io.readProjects().find(p => p.id === pid);
        if (!project) return fail("Project not found");

        const cfg = io.readConfig();
        if (!cfg.defaultModelId) return fail("No default model configured in Settings → General");

        const resolved = http.resolveModel(io.readModels(), io.readProviders(), cfg.defaultModelId);
        if (!resolved) return fail("Default model not found or provider not configured");
        const { model, provider } = resolved;
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

        // ── Load catalog ─────────────────────────────────────────────────────
        const catalogFile   = path.join(ctx.webRoot, "data", "agents-catalog.json");
        const catalogAgents = fs.existsSync(catalogFile)
          ? (() => { try { return JSON.parse(fs.readFileSync(catalogFile, "utf8")); } catch { return []; } })()
          : [];

        const existingIds   = new Set(existingList.map(a => a.catalogId).filter(Boolean));
        const existingNames = new Set(existingList.map(a => a.name.toLowerCase()));
        const notInstalled  = a => !existingIds.has(a.id) && !existingNames.has(a.name.toLowerCase());

        // ── Shortcut: no docs and no description ─────────────────────────────
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

        // ── Detect domain ────────────────────────────────────────────────────
        const domainHint = detectDomain((project.description || '') + ' ' + docParts.slice(0, 2).join(' '));
        progress(`Domain detected: ${domainHint}`);

        progress("Loading agent catalog…");
        const allowedGroups = DOMAIN_GROUPS[domainHint];
        const available     = catalogAgents.filter(a => notInstalled(a) && (!allowedGroups || allowedGroups.has(a.group)));
        const catalogText   = available.map(a => {
          const caps = a.capabilities?.length ? ` | capabilities: ${a.capabilities.join(', ')}` : '';
          return `- id: "${a.id}" | group: ${a.group} | name: ${a.name}${caps} | ${a.description}`;
        }).join("\n");
        progress(`Catalog filtered: ${available.length} agents in ${[...new Set(available.map(a => a.group))].join(', ')}`);

        if (isAborted()) return;

        // ── Pass 1: extract functional areas ─────────────────────────────────
        progress("Pass 1 — Extracting functional requirements…");
        const pass1File = path.resolve(ctx.webRoot, "../../core/prompts/analyze-pass1.md");
        const pass1Tpl  = fs.existsSync(pass1File) ? fs.readFileSync(pass1File, "utf8") : "";
        const pass1Prompt = pass1Tpl
          .replace("{{project_name}}",        project.name)
          .replace("{{project_description}}", project.description || "No description")
          .replace("{{project_docs}}",        projectDocs)
          .replace("{{existing_agents}}",     existingAgents);

        const pass1Raw = await ai.callAI(model, provider, pass1Prompt);
        if (isAborted()) return;
        const pass1    = http.parseAIJson(pass1Raw);
        const funcAreas = (pass1.functional_areas || []).join("\n- ");
        const covered   = (pass1.covered_by_existing || []).join("\n- ") || "Nothing yet";
        progress(`Found ${pass1.functional_areas?.length || 0} functional areas: ${(pass1.functional_areas || []).slice(0, 3).join(', ')}…`);

        // ── Pass 2: match agents ──────────────────────────────────────────────
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
        if (isAborted()) return;

        progress("Parsing response…");
        const result = http.parseAIJson(pass2Raw);
        if (result.agents) {
          // Resolve AI-suggested IDs to actual catalog entries — AI sometimes hallucinates
          // IDs that don't exist (e.g. "project-manager" vs "senior-project-manager").
          const catById   = new Map(catalogAgents.map(a => [a.id, a]));
          const catByName = new Map(catalogAgents.map(a => [a.name.toLowerCase(), a]));
          result.agents = result.agents.map(ag => {
            if (catById.has(ag.id)) return ag; // exact catalog match — good
            // Try name match
            const byName = catByName.get(ag.name.toLowerCase());
            if (byName) return { ...ag, id: byName.id, name: byName.name };
            // Try partial word match on ID (e.g. "project-manager" → "senior-project-manager")
            const words  = (ag.id || '').split('-').filter(Boolean);
            const fuzzy  = words.length
              ? catalogAgents.find(a => words.every(w => a.id.includes(w)))
              : null;
            if (fuzzy) return { ...ag, id: fuzzy.id, name: fuzzy.name };
            // No catalog match — keep as-is; will become a custom agent
            return ag;
          });
          result.agents = result.agents.filter(a => !existingNames.has(a.name.toLowerCase()) && !existingIds.has(a.id));
        }
        progress(`Done — ${result.agents?.length || 0} agents recommended, ${result.pipelines?.length || 0} pipelines suggested`);
        done(result);

      } catch (err) {
        console.error("[analyze]", err.message);
        fail(err.message);
      } finally {
        _activeAnalyze.delete(pid);
      }
      return true;
    }

    // GET /api/projects/:pid/agents/:aid/recommend-pipeline  (EventSource)
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/recommend-pipeline$/) && method === "GET") {
      const parts = urlPath.split("/");
      const pid = parts[3], aid = parts[5];
      const { progress, done, fail } = http.createSSEHandler(res, req, "recommend-pipeline");

      try {
        const project = io.readProjects().find(p => p.id === pid);
        if (!project) return fail("Project not found");

        const cfg = io.readConfig();
        if (!cfg.defaultModelId) return fail("No default model configured in Settings → General");

        const resolved = http.resolveModel(io.readModels(), io.readProviders(), cfg.defaultModelId);
        if (!resolved) return fail("Default model not found or provider not configured");
        const { model, provider } = resolved;

        const allAgents = io.readPAgents()[pid] || [];
        const agent = allAgents.find(a => a.id === aid);
        if (!agent) return fail("Agent not found");

        const existingPipeline = ctx.db?.storeGet(pid, aid, "pipeline") || [];
        const existingTargetIds = new Set(existingPipeline.map(t => t.targetAgentId));
        const otherAgents = allAgents.filter(a => a.id !== aid && !existingTargetIds.has(a.id));

        if (!otherAgents.length) return done({ recommendations: [] });

        progress("Analysing team structure…");

        const agentList = otherAgents.map(a =>
          `- id: "${a.id}", name: "${a.name}", role: "${a.role || a.description || "no role"}"`
        ).join("\n");

        const alreadyConnected = existingPipeline.length
          ? `Already connected: ${existingPipeline.map(t => allAgents.find(a => a.id === t.targetAgentId)?.name || t.targetAgentId).join(", ")}\n\n`
          : "";

        const prompt = `You are a software team architect. Recommend which agents should be in the pipeline of the current agent (i.e. it can delegate work to them).

Current agent:
- name: "${agent.name}"
- role: "${agent.role || agent.description || "no role"}"

${alreadyConnected}Available agents to connect:
${agentList}

Project: "${project.name}"${project.description ? ` — ${project.description}` : ""}

Return JSON only (no markdown fences):
{
  "recommendations": [
    {
      "targetAgentId": "agent-id-here",
      "condition": "always",
      "mode": "parallel",
      "reason": "One sentence why this connection makes sense."
    }
  ]
}

Rules:
- condition: "always" (always trigger), "on_success" (only on success), "on_failure" (escalation/handoff)
- mode: "parallel" (simultaneously), "sequential" (one after another)
- Only recommend connections that make genuine organisational sense
- Maximum 4 recommendations; empty array if none make sense`;

        const raw = await ai.callAI(model, provider, prompt);
        const result = http.parseAIJson(raw);
        done({ recommendations: Array.isArray(result?.recommendations) ? result.recommendations : [] });
      } catch (err) {
        fail(err.message);
      }
      return true;
    }

    // POST /api/projects/:pid/agents/:aid/tasks/:tid/decompose  (SSE)
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/tasks\/[^/]+\/decompose$/) && method === "POST") {
      const parts = urlPath.split("/");
      const xpid = parts[3], xaid = parts[5], xtid = parts[7];

      const { progress, done, fail, isAborted } = http.createSSEHandler(res, req, "swarm");

      try {
        const cfg = io.readConfig();
        if (!cfg.defaultModelId) return fail("No default model configured in Settings → General");
        const project = io.readProjects().find(p => p.id === xpid);
        if (!project)  return fail("Project not found");

        const resolved = http.resolveModel(io.readModels(), io.readProviders(), cfg.defaultModelId);
        if (!resolved) return fail("Default model not found or provider not configured");
        const { model, provider } = resolved;

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
        if (isAborted()) return;
        const raw = await ai.callAI(model, provider, prompt);
        if (isAborted()) return;

        progress("Parsing decomposition plan…");
        let plan;
        try {
          plan = http.parseAIJson(raw);
        } catch {
          return fail("AI returned invalid response — no JSON found");
        }

        const subtasks = plan.subtasks || [];
        if (!subtasks.length) return fail("AI returned no subtasks");
        progress(`Creating ${subtasks.length} subtasks…`);

        const swarmId = crypto.randomUUID();
        const created = [];

        for (const sub of subtasks) {
          if (isAborted()) break;
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
