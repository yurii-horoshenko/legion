"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const log  = require("../lib/log");

// In-memory intro cache: "pid:aid:lang" → { intro, ts }
const introCache = new Map();
const INTRO_TTL_MS = 60 * 60 * 1000; // 1 hour

// States that should not appear in agent context (terminal states)
const DONE_STATES = new Set(["done", "cancelled", "duplicate"]);

module.exports = function createChatRoutes(ctx) {
  const { io, http, ai, db, ws } = ctx;

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Load IDENTITY.md for an agent. Returns "" if not found.
  function loadIdentity(project, agentId) {
    if (!project?.path) return "";
    try {
      const f = path.join(project.path, ".legion", "agents", agentId, "IDENTITY.md");
      return fs.existsSync(f) ? "\n\n## Identity\n\n" + fs.readFileSync(f, "utf8") : "";
    } catch { return ""; }
  }

  // File access instructions — injected when agent has allowedTools configured.
  function buildFileAccessBlock(allowedTools) {
    if (!allowedTools) return "";
    return `\n\n## File System Access\nYou have read-only access to project files via these tools: **Read** (read file contents), **LS** (list directory), **Glob** (find files by pattern), **Grep** (search in files). Use them to analyse the codebase when your task requires it.`;
  }

  // Generic Linear actions format block — injected when agent.linearEnabled is true.
  function buildLinearFormatBlock() {
    return `\n\n## Linear Actions\n` +
      `**Update existing tasks** — append at the END of your response:\n` +
      `%%LINEAR_UPDATES%%\n[{"issueId":"PROJ-XX","stateName":"State","title":"Updated title","description":"What to do and why."}]\n%%END_LINEAR_UPDATES%%\n\n` +
      `- \`issueId\` required. \`stateName\`, \`title\`, \`description\` optional — include only what you are changing.\n` +
      `- Use only real issue IDs from the task list above.\n` +
      `- Valid states: Backlog, Todo, In Progress, In Review, Done, Cancelled\n\n` +
      `**Create new tasks** — append at the END of your response:\n` +
      `%%LINEAR_CREATE%%\n[{"title":"Task title","description":"Markdown description","priority":"urgent|high|medium|low","labelNames":["Label Name"]}]\n%%END_LINEAR_CREATE%%\n\n` +
      `- \`title\` required. \`priority\`: urgent, high, medium, low (default: medium). \`labelNames\`: array of label names.\n` +
      `- Both blocks can appear together in the same response.`;
  }

  // Resolve the best model for a sub-agent: own model → haiku from same provider → default.
  function resolveSubAgentModel(subAgent, allModels, allProviders, orchestratorProviderType, defaultModelId) {
    if (subAgent.model) {
      const r = http.resolveModel(allModels, allProviders, subAgent.model);
      if (r) return r;
    }
    const haiku = allModels.find(m =>
      (m.modelId || "").toLowerCase().includes("haiku") &&
      allProviders.find(p => p.id === m.providerId)?.type === orchestratorProviderType
    );
    if (haiku) {
      const r = http.resolveModel(allModels, allProviders, haiku.id);
      if (r) return r;
    }
    return http.resolveModel(allModels, allProviders, defaultModelId);
  }

  // ── Linear context builders ───────────────────────────────────────────────

  // Fetch agent's own labeled Linear issues (for non-orchestrators).
  async function buildLinearContext(project, agent) {
    if (!project?.path || !agent.linearEnabled || !agent.linearLabelName) return "";
    const integ  = io.readIntegrations(project);
    const apiKey = integ.linear?.apiKey;
    if (!apiKey) return "";

    try {
      const q = `query($label:String!,$first:Int!){issues(filter:{labels:{some:{name:{eq:$label}}}},first:$first,orderBy:updatedAt){nodes{identifier title state{name}priority url}}}`;
      const result = await io.linearQuery(apiKey, q, { label: agent.linearLabelName, first: 25 });
      const issues = (result.data?.issues?.nodes || [])
        .filter(i => !DONE_STATES.has((i.state?.name || "").toLowerCase()));
      if (!issues.length) return "";

      const lines = issues.map(i =>
        `- [${i.identifier}] ${i.title} | ${i.state?.name || "?"}`
      ).join("\n");
      log.info("chat:linear", `loaded ${issues.length} active issues label="${agent.linearLabelName}"`);
      return `\n\n## Your Current Linear Tasks (label: ${agent.linearLabelName})\n${lines}`;
    } catch (err) {
      log.warn("chat:linear", `failed to fetch tasks for "${agent.name}": ${err.message}`);
      return "";
    }
  }

  // Fetch all active project issues from Linear (for orchestrators).
  async function fetchAllProjectIssues(project) {
    if (!project?.path) return "";
    const integ  = io.readIntegrations(project);
    const apiKey = integ.linear?.apiKey;
    if (!apiKey) return "";

    try {
      const teamId = integ.linear?.defaultTeamId;
      const vars   = { first: 100 };
      const parts  = ["$first:Int"];
      let   filter = "";
      if (teamId) { parts.push("$teamId:ID"); filter = "filter:{team:{id:{eq:$teamId}}}"; vars.teamId = teamId; }

      const q = `query(${parts.join(",")}){issues(${filter},first:$first,orderBy:updatedAt){nodes{identifier title state{name}priority assignee{name}labels{nodes{name}}url}}}`;
      const result = await io.linearQuery(apiKey, q, vars);
      const issues = (result.data?.issues?.nodes || [])
        .filter(i => !DONE_STATES.has((i.state?.name || "").toLowerCase()));
      if (!issues.length) return "";

      const lines = issues.map(i => {
        const labels   = (i.labels?.nodes || []).map(l => l.name).join(", ");
        const assignee = i.assignee?.name || "unassigned";
        return `[${i.identifier}] ${i.title} | ${i.state?.name || "?"} | assignee: ${assignee}${labels ? ` | labels: ${labels}` : ""}`;
      }).join("\n");

      log.info("chat:linear", `loaded ${issues.length} active project issues`);
      return `\n\n## All Linear Issues (${issues.length})\n${lines}`;
    } catch (err) {
      log.warn("chat:linear", `failed to fetch all project issues: ${err.message}`);
      return "";
    }
  }

  // ── Linear update executor ────────────────────────────────────────────────

  async function applyLinearUpdates(project, reply) {
    const match = reply.match(/%%LINEAR_UPDATES%%([\s\S]*?)%%END_LINEAR_UPDATES%%/);
    if (!match) return { cleanedReply: reply, summary: null };

    const cleanedReply = reply.replace(/%%LINEAR_UPDATES%%[\s\S]*?%%END_LINEAR_UPDATES%%/g, "").trim();

    const integ  = io.readIntegrations(project);
    const apiKey = integ.linear?.apiKey;
    if (!apiKey) return { cleanedReply, summary: "⚠️ Linear not configured — status updates skipped." };

    let updates;
    try { updates = JSON.parse(match[1].trim()); } catch {
      return { cleanedReply, summary: "⚠️ Could not parse LINEAR_UPDATES block — invalid JSON." };
    }
    if (!Array.isArray(updates) || !updates.length) return { cleanedReply, summary: null };

    const teamId = integ.linear?.defaultTeamId;
    let stateMap = {};
    try {
      const sq = teamId
        ? `{ team(id:"${teamId}") { states { nodes { id name } } } }`
        : `{ teams { nodes { states { nodes { id name } } } } }`;
      const sr = await io.linearQuery(apiKey, sq);
      const states = teamId
        ? (sr.data?.team?.states?.nodes || [])
        : (sr.data?.teams?.nodes?.flatMap(t => t.states?.nodes || []) || []);
      stateMap = Object.fromEntries(states.map(s => [s.name.toLowerCase(), s.id]));
    } catch (e) {
      return { cleanedReply, summary: `⚠️ Could not fetch Linear states: ${e.message}` };
    }

    const results = [];
    for (const u of updates) {
      const stateId = u.stateId || stateMap[u.stateName?.toLowerCase()];
      const input = {};
      if (stateId)       input.stateId     = stateId;
      if (u.title)       input.title       = u.title;
      if (u.description) input.description = u.description;
      if (!Object.keys(input).length) { results.push(`⚠ ${u.issueId}: nothing to update`); continue; }
      try {
        const q = `mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{identifier title state{name}}}}`;
        const r = await io.linearQuery(apiKey, q, { id: u.issueId, input });
        if (r.errors || !r.data?.issueUpdate?.success) {
          results.push(`❌ ${u.issueId}: ${r.errors?.[0]?.message || "update failed"}`);
        } else {
          const iss = r.data.issueUpdate.issue;
          const parts = [`✅ ${iss.identifier}`];
          if (u.title)       parts.push(`"${iss.title}"`);
          if (stateId)       parts.push(`→ ${iss.state?.name}`);
          if (u.description) parts.push(`description updated`);
          results.push(parts.join(" "));
          log.info("chat:linear", `updated ${iss.identifier}${stateId ? ` → ${iss.state?.name}` : ""}${u.title ? ` title updated` : ""}`);
        }
      } catch (e) {
        results.push(`❌ ${u.issueId}: ${e.message}`);
      }
    }

    return { cleanedReply, summary: `\n\n**Linear updates applied:**\n${results.join("\n")}` };
  }

  async function applyLinearCreates(project, reply) {
    const match = reply.match(/%%LINEAR_CREATE%%([\s\S]*?)%%END_LINEAR_CREATE%%/);
    if (!match) return { cleanedReply: reply, summary: null };

    const cleanedReply = reply.replace(/%%LINEAR_CREATE%%[\s\S]*?%%END_LINEAR_CREATE%%/g, "").trim();

    const integ  = io.readIntegrations(project);
    const apiKey = integ.linear?.apiKey;
    if (!apiKey) return { cleanedReply, summary: "⚠️ Linear not configured — creates skipped." };

    let creates;
    try { creates = JSON.parse(match[1].trim()); } catch {
      return { cleanedReply, summary: "⚠️ Could not parse LINEAR_CREATE block — invalid JSON." };
    }
    if (!Array.isArray(creates) || !creates.length) return { cleanedReply, summary: null };

    const teamId = integ.linear?.defaultTeamId;
    if (!teamId) return { cleanedReply, summary: "⚠️ Linear defaultTeamId not set — creates skipped." };

    let labelMap = {};
    try {
      const lq = `{ team(id:"${teamId}") { labels { nodes { id name } } } }`;
      const lr = await io.linearQuery(apiKey, lq);
      const labels = lr.data?.team?.labels?.nodes || [];
      labelMap = Object.fromEntries(labels.map(l => [l.name.toLowerCase(), l.id]));
    } catch (e) { log.warn("chat:linear", `failed to fetch labels: ${e.message}`); }

    const PRIORITY_MAP = { urgent: 1, high: 2, medium: 3, low: 4 };
    const results = [];

    for (const c of creates) {
      if (!c.title) { results.push("⚠ skipped: missing title"); continue; }
      const input = { title: c.title, teamId };
      if (c.description) input.description = c.description;
      if (c.priority)    input.priority = PRIORITY_MAP[c.priority.toLowerCase()] ?? 3;
      if (c.labelNames?.length) {
        const ids = c.labelNames.map(n => labelMap[n.toLowerCase()]).filter(Boolean);
        if (ids.length) input.labelIds = ids;
      }
      try {
        const q = `mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{identifier title url}}}`;
        const r = await io.linearQuery(apiKey, q, { input });
        if (r.errors || !r.data?.issueCreate?.success) {
          results.push(`❌ "${c.title}": ${r.errors?.[0]?.message || "create failed"}`);
        } else {
          const iss = r.data.issueCreate.issue;
          results.push(`✅ ${iss.identifier} "${iss.title}" created`);
          log.info("chat:linear", `created ${iss.identifier} "${iss.title}"`);
        }
      } catch (e) { results.push(`❌ "${c.title}": ${e.message}`); }
    }

    return { cleanedReply, summary: `\n\n**Linear tasks created:**\n${results.join("\n")}` };
  }

  async function applyLinearActions(project, reply) {
    const upd = await applyLinearUpdates(project, reply);
    const cre = await applyLinearCreates(project, upd.cleanedReply);
    const summary = [upd.summary, cre.summary].filter(Boolean).join("\n") || null;
    return { cleanedReply: cre.cleanedReply, summary };
  }

  // ── Orchestrator chat (agent has pipeline → delegation flow) ──────────────

  async function runOrchestratorChat(res, pid, aid, agent, message, lang, pipeline, modelObj, provider, cfg) {
    const totalTimer = log.timer();
    log.info("chat", `orchestrator start agent="${agent.name}" model=${modelObj.modelId} provider=${provider.type} pid=${pid}`);

    res.writeHead(200, {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    const sse = data => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

    db?.chatLog(pid, aid, "user_message", agent.name, message);

    try {
      const agentMap = {};
      (io.readPAgents()[pid] || []).forEach(a => { agentMap[a.id] = a; });

      const allModels    = io.readModels();
      const allProviders = io.readProviders();
      const project      = io.readProjects().find(p => p.id === pid);
      const subAgents    = pipeline.map(p => agentMap[p.targetAgentId]).filter(Boolean);

      const history   = db?.getChatHistory(pid, aid) || [];
      const allIssues = await fetchAllProjectIssues(project);

      // Format history for context injection
      const historyCtx = history.length
        ? "\n\n## Conversation so far\n" + history.map(m =>
            m.role === "assistant" ? `Assistant: ${m.content}` : `User: ${m.content}`
          ).join("\n\n")
        : "";

      // Build orchestrator system prompt
      const identity     = loadIdentity(project, aid);
      const linearFormat = agent.linearEnabled ? buildLinearFormatBlock() : "";

      if (!subAgents.length) {
        // Orchestrator with no sub-agents → direct reply
        const fileAccess = buildFileAccessBlock(agent.allowedTools);
        const sp   = `You are ${agent.name}. ${agent.role || ""}${ai.langDirective(lang) || ""}${identity}${allIssues}${linearFormat}${fileAccess}`;
        const msgs = [...history, { role: "user", content: message }];
        const reply = await ai.callAIMessages(modelObj, provider, sp, msgs, { allowedTools: agent.allowedTools || "" });
        const { cleanedReply, summary } = await applyLinearActions(project, reply);
        const finalReply = summary ? cleanedReply + summary : cleanedReply;
        db?.appendChatHistory(pid, aid, "user",      message);
        db?.appendChatHistory(pid, aid, "assistant", finalReply);
        db?.chatLog(pid, aid, "direct_reply", agent.name, finalReply);
        sse({ type: "reply", text: finalReply });
        res.end();
        log.info("chat", `orchestrator done (direct) in ${totalTimer()}`);
        return;
      }

      const subAgentsList = subAgents.map(a => `- **${a.name}** (id: ${a.id}): ${a.role || a.description || "no role"}`).join("\n");

      const fileAccess   = buildFileAccessBlock(agent.allowedTools);
      const promptFile   = path.resolve(__dirname, "../core/prompts/chat-orchestrator.md");
      const systemPrompt = fs.readFileSync(promptFile, "utf8")
        .replace("{{agent_name}}",      agent.name || aid)
        .replace("{{agent_role}}",      agent.role || agent.description || "General-purpose agent")
        .replace("{{sub_agents_list}}", subAgentsList)
        .replace("{{lang_directive}}",  ai.langDirective(lang) || "")
        + identity + linearFormat + fileAccess + allIssues + historyCtx;

      sse({ type: "progress", text: "Analyzing request…" });
      log.info("chat", `orchestrator analyzing (${subAgents.length} sub-agents${allIssues ? ", Linear loaded" : ""})`);

      const orchestratorReply = await ai.callAIMessages(modelObj, provider, systemPrompt, [{ role: "user", content: message }], { allowedTools: agent.allowedTools || "" });

      const delegateMatch = orchestratorReply.match(/<DELEGATE>([\s\S]*?)<\/DELEGATE>/);
      if (!delegateMatch) {
        // No delegation — orchestrator answered directly
        const { cleanedReply, summary } = await applyLinearActions(project, orchestratorReply);
        const finalReply = summary ? cleanedReply + summary : cleanedReply;
        db?.appendChatHistory(pid, aid, "user",      message);
        db?.appendChatHistory(pid, aid, "assistant", finalReply);
        db?.chatLog(pid, aid, "direct_reply", agent.name, finalReply);
        sse({ type: "reply", text: finalReply });
        res.end();
        log.info("chat", `orchestrator done (no delegation) in ${totalTimer()}`);
        return;
      }

      let delegations = [];
      try {
        delegations = JSON.parse(delegateMatch[1].trim()).tasks || [];
      } catch {
        const direct = orchestratorReply.replace(/<DELEGATE>[\s\S]*?<\/DELEGATE>/, "").trim();
        db?.chatLog(pid, aid, "direct_reply", agent.name, direct || orchestratorReply);
        sse({ type: "reply", text: direct || orchestratorReply });
        res.end();
        log.info("chat", `orchestrator done (parse error fallback) in ${totalTimer()}`);
        return;
      }

      const planSummary = delegations.map(d => {
        const a = agentMap[d.agentId];
        return `${a?.name || d.agentId}: ${d.task}`;
      }).join("\n");
      db?.chatLog(pid, aid, "delegation_plan", agent.name, planSummary);
      log.info("chat", `orchestrator delegating to ${delegations.length} agent(s) in parallel`);

      // Run delegations in parallel
      const settled = await Promise.allSettled(
        delegations
          .filter(d => agentMap[d.agentId])
          .map(async d => {
            const subAgent = agentMap[d.agentId];
            sse({ type: "delegate", agentName: subAgent.name, agentId: d.agentId, task: d.task });
            db?.chatLog(pid, aid, "delegate_task", subAgent.name, d.task);
            const delegateStart = Date.now();
            log.info("chat", `delegate → ${subAgent.name} (parallel)`);

            const subResolved = resolveSubAgentModel(subAgent, allModels, allProviders, provider.type, cfg.defaultModelId);
            if (!subResolved) {
              db?.chatLog(pid, aid, "delegate_error", subAgent.name, "No model configured");
              sse({ type: "agent_error", agentName: subAgent.name, error: "No model configured" });
              return { agentName: subAgent.name, error: "No model configured" };
            }

            const subIdentity   = loadIdentity(project, subAgent.id);
            const subFileAccess = buildFileAccessBlock(subAgent.allowedTools);
            const subSystem     = `You are ${subAgent.name}. ${subAgent.role || ""}${ai.langDirective(lang) || ""}${subIdentity}${subFileAccess}`;
            const subReply      = await ai.callAIMessages(
              subResolved.model, subResolved.provider, subSystem,
              [{ role: "user", content: d.task }],
              { maxTokens: 2048, allowedTools: subAgent.allowedTools || "" }
            );
            const elapsed = Date.now() - delegateStart;
            log.info("chat", `delegate ← ${subAgent.name} (${subResolved.model.modelId || subResolved.model.id}) in ${elapsed}ms`);
            db?.chatLog(pid, aid, "delegate_reply", subAgent.name, subReply, elapsed);
            sse({ type: "agent_reply", agentName: subAgent.name, preview: subReply.slice(0, 120) });
            return { agentName: subAgent.name, task: d.task, reply: subReply };
          })
      );

      const results = settled.map((s, i) => {
        if (s.status === "fulfilled") return s.value;
        const subAgent = agentMap[delegations[i]?.agentId];
        const name = subAgent?.name || delegations[i]?.agentId || "unknown";
        log.error("chat", `delegate ✗ ${name} — ${s.reason?.message}`);
        db?.chatLog(pid, aid, "delegate_error", name, s.reason?.message || "Unknown error");
        sse({ type: "agent_error", agentName: name, error: s.reason?.message || "Error" });
        return { agentName: name, error: s.reason?.message || "Error" };
      });

      let finalReply;

      if (delegations.length === 1 && results[0] && !results[0].error) {
        // Single delegate — skip synthesis, return their reply directly
        log.info("chat", `orchestrator single-delegate, skipping synthesis`);
        finalReply = results[0].reply;
      } else {
        // Multiple delegates or errors — synthesize
        sse({ type: "progress", text: "Synthesizing team responses…" });
        log.info("chat", `orchestrator synthesizing ${results.length} results`);

        const synthCtx     = results.map(r =>
          r.error ? `**${r.agentName}** (error): ${r.error}` : `**${r.agentName}**:\n${r.reply}`
        ).join("\n\n---\n\n");
        const synthSystem  = `You are ${agent.name}. ${agent.role || ""}${ai.langDirective(lang) || ""}`;
        const synthMessage = `Team responses for the request: "${message}"\n\n${synthCtx}\n\nProvide a clear, comprehensive answer. If any sub-agent provided Linear update or create suggestions, preserve them using the exact format:\n%%LINEAR_UPDATES%%\n[...]\n%%END_LINEAR_UPDATES%%\nand/or\n%%LINEAR_CREATE%%\n[...]\n%%END_LINEAR_CREATE%%`;

        const synthTimer = log.timer();
        finalReply = await ai.callAIMessages(modelObj, provider, synthSystem, [{ role: "user", content: synthMessage }]);
        log.info("chat", `orchestrator synthesis done in ${synthTimer()}`);
      }

      const { cleanedReply, summary } = await applyLinearActions(project, finalReply);
      if (summary) finalReply = cleanedReply + summary;
      else finalReply = cleanedReply;

      db?.appendChatHistory(pid, aid, "user",      message);
      db?.appendChatHistory(pid, aid, "assistant", finalReply);
      db?.chatLog(pid, aid, "final_reply", agent.name, finalReply);

      sse({ type: "reply", text: finalReply });
      res.end();
      log.info("chat", `orchestrator done in ${totalTimer()}`);
    } catch (err) {
      log.error("chat", `orchestrator error in ${totalTimer()} — ${err.message}`);
      db?.chatLog(pid, aid, "error", agent.name, err.message);
      sse({ type: "error", error: err.message });
      if (!res.writableEnded) res.end();
    }
  }

  // ── Route handler ─────────────────────────────────────────────────────────

  return async function handle(urlPath, method, req, res, body) {

    // GET /api/projects/:pid/agents/:aid/chat/history
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/chat\/history$/) && method === "GET") {
      const parts = urlPath.split("/");
      const pid = parts[3], aid = parts[5];
      const history = db?.getChatHistory(pid, aid) || [];
      http.json(res, 200, { history });
      return true;
    }

    // DELETE /api/projects/:pid/agents/:aid/chat/history
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/chat\/history$/) && method === "DELETE") {
      const parts = urlPath.split("/");
      const pid = parts[3], aid = parts[5];
      db?.clearChatHistory(pid, aid);
      log.info("chat", `history cleared pid=${pid} aid=${aid}`);
      http.json(res, 200, { ok: true });
      return true;
    }

    // POST /api/projects/:pid/agents/:aid/chat/intro
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/chat\/intro$/) && method === "POST") {
      const parts = urlPath.split("/");
      const pid = parts[3], aid = parts[5];
      const map   = io.readPAgents();
      const agent = (map[pid] || []).find(a => a.id === aid);
      if (!agent) { http.json(res, 404, { error: "Agent not found" }); return true; }

      const lang = body.lang || "en";
      const cacheKey = `${pid}:${aid}:${lang}`;
      const cached = introCache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < INTRO_TTL_MS) {
        http.json(res, 200, { intro: cached.intro });
        return true;
      }

      const cfg     = io.readConfig();
      const modelId = agent.model || cfg.defaultModelId;
      if (!modelId) { http.json(res, 400, { error: "No model configured for this agent" }); return true; }

      const resolved = http.resolveModel(io.readModels(), io.readProviders(), modelId);
      if (!resolved) { http.json(res, 404, { error: `Model '${modelId}' not found or provider not configured` }); return true; }
      const { model: modelObj, provider } = resolved;

      const userSkillsDir = path.join(os.homedir(), ".claude", "skills");
      const skillEntries = (agent.skills || []).map(skillId => {
        if (fs.existsSync(userSkillsDir)) {
          const skillMd = path.join(userSkillsDir, skillId, "SKILL.md");
          if (fs.existsSync(skillMd)) {
            const content = fs.readFileSync(skillMd, "utf8").slice(0, 400);
            const m = content.match(/^description:\s*(.+)/m);
            if (m) return `**${skillId}** — ${m[1].trim().replace(/^["']|["']$/g, "")}`;
          }
        }
        return `**${skillId}**`;
      });
      const skillsLine = skillEntries.length ? skillEntries.join(", ") : "None configured";

      const project = io.readProjects().find(p => p.id === pid);
      let identitySection = "";
      if (project?.path) {
        const identityFile = path.join(project.path, ".legion", "agents", aid, "IDENTITY.md");
        if (fs.existsSync(identityFile)) {
          const raw = fs.readFileSync(identityFile, "utf8").slice(0, 1200);
          identitySection = `## Identity (from IDENTITY.md)\n\n${raw}`;
        }
      }

      const modelName     = modelObj.name || modelObj.modelId || modelId;
      const providerLabel = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", mistral: "Mistral", ollama: "Ollama", "claude-cli": "Claude CLI" }[provider.type] || provider.type;

      const promptFile = path.resolve(__dirname, "../core/prompts/chat-intro.md");
      const systemPrompt = fs.readFileSync(promptFile, "utf8")
        .replace("{{agent_name}}",       agent.name || aid)
        .replace("{{agent_role}}",       agent.role || agent.description || "General-purpose agent")
        .replace("{{model_name}}",       modelName)
        .replace("{{provider_type}}",    providerLabel)
        .replace("{{skills_line}}",      skillsLine)
        .replace("{{identity_section}}", identitySection)
        .replace("{{lang_directive}}",   ai.langDirective(lang) || "");

      try {
        const intro = await ai.callAIMessages(modelObj, provider, systemPrompt, [{ role: "user", content: "Introduce yourself." }]);
        introCache.set(cacheKey, { intro, ts: Date.now() });
        http.json(res, 200, { intro });
      } catch (err) {
        http.json(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /api/projects/:pid/agents/:aid/chat
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/chat$/) && method === "POST") {
      const parts = urlPath.split("/");
      const pid = parts[3], aid = parts[5];
      const map   = io.readPAgents();
      const agent = (map[pid] || []).find(a => a.id === aid);
      if (!agent) { http.json(res, 404, { error: "Agent not found" }); return true; }
      const { message } = body;
      if (!message?.trim()) { http.json(res, 400, { error: "message is required" }); return true; }

      const cfg     = io.readConfig();
      const modelId = agent.model || cfg.defaultModelId;
      if (!modelId) { http.json(res, 400, { error: "No model configured for this agent. Set one in Settings → Models." }); return true; }

      const resolved = http.resolveModel(io.readModels(), io.readProviders(), modelId);
      if (!resolved) { http.json(res, 404, { error: `Model '${modelId}' not found or provider not configured` }); return true; }
      const { model: modelObj, provider } = resolved;

      const project  = io.readProjects().find(p => p.id === pid);
      const pipeline = db?.storeGet(pid, aid, "pipeline") || [];

      // Orchestrator mode — agent has pipeline entries → delegation flow via SSE
      if (pipeline.length > 0) {
        await runOrchestratorChat(res, pid, aid, agent, message.trim(), body.lang, pipeline, modelObj, provider, cfg);
        db?.log("chat:message", pid, aid, { role: "user", preview: message.slice(0, 80), mode: "orchestrator" });
        ws?.broadcast("chat:message", { pid, aid, agentName: agent.name, preview: message.slice(0, 80) });
        return true;
      }

      // Direct agent chat
      const chatTimer = log.timer();
      log.info("chat", `start agent="${agent.name}" model=${modelObj.modelId} provider=${provider.type} pid=${pid}`);
      db?.chatLog(pid, aid, "user_message", agent.name, message.trim());

      const identity     = loadIdentity(project, aid);
      const linearCtx    = await buildLinearContext(project, agent);
      const linearFormat = agent.linearEnabled ? buildLinearFormatBlock() : "";
      const fileAccess   = buildFileAccessBlock(agent.allowedTools);
      const history      = db?.getChatHistory(pid, aid) || [];
      const systemPrompt = `You are ${agent.name}. ${agent.role || ""}${ai.langDirective(body.lang)}${identity}${linearCtx}${linearFormat}${fileAccess}`;
      const messages     = [...history, { role: "user", content: message.trim() }];

      try {
        let reply = await ai.callAIMessages(modelObj, provider, systemPrompt, messages, { allowedTools: agent.allowedTools || "" });
        log.info("chat", `done agent="${agent.name}" in ${chatTimer()} history=${history.length}msgs`);

        const { cleanedReply, summary } = await applyLinearActions(project, reply);
        if (summary) reply = cleanedReply + summary;
        else reply = cleanedReply;

        db?.appendChatHistory(pid, aid, "user",      message.trim());
        db?.appendChatHistory(pid, aid, "assistant", reply);
        db?.chatLog(pid, aid, "direct_reply", agent.name, reply);
        db?.log("chat:message", pid, aid, { role: "user", preview: message.slice(0, 80) });
        ws?.broadcast("chat:message", { pid, aid, agentName: agent.name, preview: message.slice(0, 80) });
        http.json(res, 200, { reply });
      } catch (err) {
        log.error("chat", `fail agent="${agent.name}" in ${chatTimer()} — ${err.message}`);
        db?.chatLog(pid, aid, "error", agent.name, err.message);
        http.json(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /api/proxy/v1/messages — Anthropic-compatible proxy routing to Legion providers
    if (urlPath === "/api/proxy/v1/messages" && method === "POST") {
      const { model: modelId, messages = [], max_tokens, system, stream } = body;

      const resolved = http.resolveModel(io.readModels(), io.readProviders(), modelId);
      if (!resolved) { http.json(res, 404, { error: { type: "not_found_error", message: `Model '${modelId}' not found or provider not configured. Check Settings → Models.` } }); return true; }
      const { model: modelObj, provider } = resolved;

      const allMessages = system ? [{ role: "system", content: system }, ...messages] : messages;

      if (provider.type === "ollama") {
        const base = (provider.endpoint || "http://localhost:11434").replace(/\/$/, "");
        if (stream) {
          await ai.streamOllamaToAnthropicSSE(res, base, modelObj, allMessages);
          return true;
        }
        const d = await http.postJson(`${base}/api/chat`, {}, { model: modelObj.modelId, messages: allMessages, stream: false });
        if (d.error) { http.json(res, 500, { error: { type: "api_error", message: `Ollama: ${d.error}` } }); return true; }
        http.json(res, 200, {
          id: `msg_${Date.now()}`, type: "message", role: "assistant",
          content: [{ type: "text", text: d.message?.content || "" }],
          model: modelId, stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        });
        return true;
      }

      if (provider.type === "anthropic") {
        const key = modelObj.key || provider.key;
        if (!key) { http.json(res, 401, { error: { type: "authentication_error", message: "No Anthropic API key configured" } }); return true; }
        const reqBody = { model: modelObj.modelId, max_tokens: max_tokens || 4096, messages };
        if (system) reqBody.system = system;
        const d = await http.postJson("https://api.anthropic.com/v1/messages",
          { "x-api-key": key, "anthropic-version": "2023-06-01" }, reqBody);
        http.json(res, 200, d);
        return true;
      }

      if (provider.type === "claude-cli") {
        const lastUser = messages.filter(m => m.role === "user").pop()?.content || "";
        const prompt = system ? `${system}\n\nUser: ${lastUser}` : lastUser;
        if (stream) {
          await ai.streamClaudeCLIToAnthropicSSE(res, modelObj, prompt);
          return true;
        }
        try {
          const text = await ai.callAIMessages(modelObj, provider, system || "", messages);
          http.json(res, 200, {
            id: `msg_${Date.now()}`, type: "message", role: "assistant",
            content: [{ type: "text", text }],
            model: modelId, stop_reason: "end_turn", stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          });
        } catch (err) {
          http.json(res, 500, { error: { type: "api_error", message: err.message } });
        }
        return true;
      }

      http.json(res, 400, { error: { type: "invalid_request_error", message: `Provider type '${provider.type}' is not supported via the Anthropic-compatible proxy` } });
      return true;
    }

    return false;
  };
};
