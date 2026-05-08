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

  // Default tools granted to all agents inside a pipeline execution.
  const PIPELINE_TOOLS = "Read,Write,Edit,LS,Glob,Grep";

  // File access instructions with project path — always injected for pipeline agents.
  function buildFileAccessBlock(allowedTools, projectPath) {
    const root = projectPath ? `\nProject root: **${projectPath}** — use absolute paths when reading or writing project files.` : "";
    return `\n\n## File System Access\nYou have full read-write access via: **Read** (read file), **Write** (create/overwrite), **Edit** (modify sections), **LS** (list directory), **Glob** (find files), **Grep** (search in files).${root} Always read the task document first, then read relevant source files before making changes.`;
  }

  // ── Task file helpers ─────────────────────────────────────────────────────

  function createTaskFile(project, message, allIssues) {
    if (!project?.path) return null;
    try {
      const taskDir = path.join(project.path, ".legion", "tasks");
      fs.mkdirSync(taskDir, { recursive: true });
      const filePath = path.join(taskDir, `task-${Date.now()}.md`);
      const content = [
        `# Task`,
        `**Created:** ${new Date().toISOString()}`,
        ``,
        `## Request`,
        ``,
        message,
        allIssues ? `\n## Linear Context\n${allIssues}` : "",
      ].join("\n");
      fs.writeFileSync(filePath, content, "utf8");
      log.info("chat", `task file created: ${filePath}`);
      return filePath;
    } catch (err) {
      log.warn("chat", `failed to create task file: ${err.message}`);
      return null;
    }
  }

  function appendTaskFile(filePath, agentName, content) {
    if (!filePath) return;
    try {
      fs.appendFileSync(filePath, `\n\n## ${agentName}\n\n${content}`, "utf8");
    } catch (err) {
      log.warn("chat", `failed to append to task file: ${err.message}`);
    }
  }

  function readTaskFile(filePath) {
    if (!filePath) return "";
    try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
  }

  function deleteTaskFile(filePath) {
    if (!filePath) return;
    try { fs.unlinkSync(filePath); log.info("chat", `task file deleted: ${filePath}`); }
    catch (err) { log.warn("chat", `failed to delete task file: ${err.message}`); }
  }

  // Generic Linear actions format block — injected when agent.linearEnabled is true.
  function buildLinearFormatBlock() {
    return `\n\n## Linear Actions\n` +
      `**RULE: Always create a Linear issue when the user gives you a task, work item, deliverable, or asks you to do something trackable. Do not skip this — if the request is actionable, create the issue.**\n\n` +
      `**Update existing tasks** — append at the END of your response:\n` +
      `%%LINEAR_UPDATES%%\n[{"issueId":"PROJ-XX","stateName":"State","title":"Updated title","description":"What to do and why."}]\n%%END_LINEAR_UPDATES%%\n\n` +
      `- \`issueId\` required. \`stateName\`, \`title\`, \`description\` optional — include only what you are changing.\n` +
      `- Use only real issue IDs from the task list above.\n` +
      `- Valid states: Backlog, Todo, In Progress, In Review, Done, Cancelled\n\n` +
      `**Create new tasks** — append at the END of your response:\n` +
      `%%LINEAR_CREATE%%\n[{"title":"Task title","description":"Markdown description","priority":"urgent|high|medium|low","labelNames":["Label Name"]}]\n%%END_LINEAR_CREATE%%\n\n` +
      `- \`title\` required. \`priority\`: urgent, high, medium, low (default: medium). \`labelNames\`: array of label names.\n` +
      `- Both blocks can appear together in the same response.\n` +
      `- **When to create:** any new work request, feature, content deliverable, bug, or task mentioned by the user — create it automatically. One request = one or more issues.`;
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
      const q = `query($label:String!,$first:Int!){issues(filter:{labels:{some:{name:{eq:$label}}}},first:$first,orderBy:updatedAt){nodes{identifier title description state{name}priority url}}}`;
      const result = await io.linearQuery(apiKey, q, { label: agent.linearLabelName, first: 25 });
      const issues = (result.data?.issues?.nodes || [])
        .filter(i => !DONE_STATES.has((i.state?.name || "").toLowerCase()));
      if (!issues.length) return "";

      const lines = issues.map(i => {
        const desc = i.description ? `\n  ${i.description.slice(0, 300).replace(/\n/g, " ")}` : "";
        return `- [${i.identifier}] ${i.title} | ${i.state?.name || "?"}${desc}`;
      }).join("\n");
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

      const q = `query(${parts.join(",")}){issues(${filter},first:$first,orderBy:updatedAt){nodes{identifier title description state{name}priority assignee{name}labels{nodes{name}}url}}}`;
      const result = await io.linearQuery(apiKey, q, vars);
      const issues = (result.data?.issues?.nodes || [])
        .filter(i => !DONE_STATES.has((i.state?.name || "").toLowerCase()));
      if (!issues.length) return "";

      const lines = issues.map(i => {
        const labels   = (i.labels?.nodes || []).map(l => l.name).join(", ");
        const assignee = i.assignee?.name || "unassigned";
        const desc     = i.description ? `\n  ${i.description.slice(0, 400).replace(/\n/g, " ")}` : "";
        return `[${i.identifier}] ${i.title} | ${i.state?.name || "?"} | assignee: ${assignee}${labels ? ` | labels: ${labels}` : ""}${desc}`;
      }).join("\n");

      log.info("chat:linear", `loaded ${issues.length} active project issues`);
      return `\n\n## All Linear Issues (${issues.length})\n${lines}`;
    } catch (err) {
      log.warn("chat:linear", `failed to fetch all project issues: ${err.message}`);
      return "";
    }
  }

  // Fetch full detail for a specific issue: description + comments + sub-tasks.
  async function fetchIssueDetail(project, identifier) {
    if (!project?.path || !identifier) return "";
    const integ  = io.readIntegrations(project);
    const apiKey = integ.linear?.apiKey;
    if (!apiKey) return "";

    try {
      const q = `{issue(id:"${identifier}"){identifier title description state{name}priority assignee{name}labels{nodes{name}}url updatedAt comments(first:25,orderBy:createdAt){nodes{body user{name}createdAt}}children{nodes{identifier title description state{name}}}}}`;
      const result = await io.linearQuery(apiKey, q);
      const issue  = result.data?.issue;
      if (!issue) return "";

      const labels   = (issue.labels?.nodes || []).map(l => l.name).join(", ");
      const comments = (issue.comments?.nodes || []);
      const children = (issue.children?.nodes || []);

      const lines = [
        `### ${issue.identifier}: ${issue.title}`,
        `**State:** ${issue.state?.name || "?"} | **Priority:** ${issue.priority ?? "?"} | **Assignee:** ${issue.assignee?.name || "unassigned"}${labels ? ` | **Labels:** ${labels}` : ""}`,
        `**URL:** ${issue.url}`,
        "",
        "#### Description",
        issue.description || "(no description)",
      ];

      if (comments.length) {
        lines.push("", "#### Comments");
        comments.forEach(c => lines.push(`\n**${c.user?.name || "?"}:** ${c.body}`));
      }

      if (children.length) {
        lines.push("", "#### Sub-tasks");
        children.forEach(c => {
          lines.push(`- [${c.identifier}] ${c.title} | ${c.state?.name || "?"}`);
          if (c.description) lines.push(`  ${c.description.slice(0, 200).replace(/\n/g, " ")}`);
        });
      }

      log.info("chat:linear", `loaded full detail for ${identifier}`);
      return lines.join("\n");
    } catch (err) {
      log.warn("chat:linear", `failed to fetch issue detail "${identifier}": ${err.message}`);
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

    // Resolve identifier (e.g. "VIS-33") → internal UUID
    async function resolveIssueId(rawId) {
      if (!rawId) return null;
      if (/^[0-9a-f-]{36}$/.test(rawId)) return rawId; // already a UUID
      // Identifier format: fetch via issue(id:) which accepts both
      try {
        const r = await io.linearQuery(apiKey, `{ issue(id:"${rawId}") { id } }`);
        return r.data?.issue?.id || null;
      } catch { return null; }
    }

    const results = [];
    for (const u of updates) {
      const rawId  = u.issueId || u.id; // accept both field names
      const label  = rawId || "(no id)";
      const stateId = u.stateId || stateMap[u.stateName?.toLowerCase()];
      const input = {};
      if (stateId)       input.stateId     = stateId;
      if (u.title)       input.title       = u.title;
      if (u.description) input.description = u.description;
      if (!Object.keys(input).length) { results.push(`⚠ ${label}: nothing to update`); continue; }
      if (!rawId) { results.push(`⚠ skipped: issueId missing in LINEAR_UPDATES entry`); continue; }
      try {
        const uuid = await resolveIssueId(rawId);
        if (!uuid) { results.push(`❌ ${label}: could not resolve issue — check the identifier`); continue; }
        const q = `mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{identifier title state{name}}}}`;
        const r = await io.linearQuery(apiKey, q, { id: uuid, input });
        if (r.errors || !r.data?.issueUpdate?.success) {
          results.push(`❌ ${label}: ${r.errors?.[0]?.message || "update failed"}`);
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
        results.push(`❌ ${label}: ${e.message}`);
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

  // ── Orchestrator core (recursive, returns reply string) ─────────────────

  // Calls a single agent: if it has its own pipeline, runs it as a nested
  // orchestrator; otherwise calls it directly. Returns { agentName, task, reply }
  // or { agentName, error }. depth prevents infinite loops.
  async function callAgent(sse, pid, orchestratorAid, subAgent, task, lang, allModels, allProviders, project, agentMap, cfg, parentProviderType, depth, allIssues, taskFile) {
    const subResolved = resolveSubAgentModel(subAgent, allModels, allProviders, parentProviderType, cfg.defaultModelId);
    if (!subResolved) return { agentName: subAgent.name, error: "No model configured" };

    const subPipeline = db?.storeGet(pid, subAgent.id, "pipeline") || [];

    let reply;
    if (subPipeline.length > 0 && depth < 5) {
      log.info("chat", `delegate → ${subAgent.name} (orchestrator chain, depth=${depth + 1})`);
      reply = await runOrchestratorCore(
        sse, pid, subAgent, task, lang, subPipeline,
        subResolved.model, subResolved.provider,
        allModels, allProviders, project, agentMap, cfg,
        "", depth + 1, allIssues, taskFile
      );
    } else {
      log.info("chat", `delegate → ${subAgent.name} (leaf)`);
      const subIdentity   = loadIdentity(project, subAgent.id);
      const subFileAccess = buildFileAccessBlock(subAgent.allowedTools, project?.path);
      const subSystem     = `You are ${subAgent.name}. ${subAgent.role || ""}${ai.langDirective(lang) || ""}${subIdentity}${subFileAccess}`;
      // Inject current task file content so sub-agents work from file, not from Linear
      const taskCtx = taskFile
        ? `\n\n## Task Document (${taskFile})\n\n${readTaskFile(taskFile)}`
        : "";
      reply = await ai.callAIMessages(
        subResolved.model, subResolved.provider, subSystem,
        [{ role: "user", content: task + taskCtx }],
        { maxTokens: 2048, allowedTools: subAgent.allowedTools || PIPELINE_TOOLS }
      );
    }

    return { agentName: subAgent.name, task, reply };
  }

  // Core orchestrator logic. Returns the final reply string.
  // historyCtx is only non-empty at the top level (conversation continuity).
  // allIssues is fetched once at depth=0 and passed down to avoid repeat API calls.
  // depth prevents infinite pipeline loops.
  async function runOrchestratorCore(sse, pid, agent, message, lang, pipeline, modelObj, provider, allModels, allProviders, project, agentMap, cfg, historyCtx, depth, allIssues, taskFile) {
    const aid       = agent.id;
    const subAgents = pipeline.map(p => agentMap[p.targetAgentId]).filter(Boolean);
    if (allIssues === undefined) allIssues = await fetchAllProjectIssues(project);
    const identity  = loadIdentity(project, aid);
    const linearFormat = agent.linearEnabled ? buildLinearFormatBlock() : "";

    if (!subAgents.length) {
      const fileAccess = buildFileAccessBlock(agent.allowedTools, project?.path);
      const sp   = `You are ${agent.name}. ${agent.role || ""}${ai.langDirective(lang) || ""}${identity}${allIssues}${linearFormat}${fileAccess}${historyCtx}`;
      const msgs = historyCtx ? [{ role: "user", content: message }] : [{ role: "user", content: message }];
      return await ai.callAIMessages(modelObj, provider, sp, msgs, { allowedTools: agent.allowedTools || "" });
    }

    const subAgentsList = subAgents.map(a => `- **${a.name}** (id: ${a.id}): ${a.role || a.description || "no role"}`).join("\n");
    const fileAccess    = buildFileAccessBlock(agent.allowedTools, project?.path);
    const promptFile    = path.resolve(__dirname, "../core/prompts/chat-orchestrator.md");
    const systemPrompt  = fs.readFileSync(promptFile, "utf8")
      .replace("{{agent_name}}",      agent.name || aid)
      .replace("{{agent_role}}",      agent.role || agent.description || "General-purpose agent")
      .replace("{{sub_agents_list}}", subAgentsList)
      .replace("{{lang_directive}}",  ai.langDirective(lang) || "")
      + identity + linearFormat + fileAccess + allIssues + historyCtx;

    sse({ type: "progress", text: depth === 0 ? "Analyzing request…" : `${agent.name} analyzing…` });
    log.info("chat", `orchestrator ${agent.name} analyzing (${subAgents.length} sub-agents, depth=${depth})`);

    const orchestratorReply = await ai.callAIMessages(modelObj, provider, systemPrompt, [{ role: "user", content: message }], { allowedTools: agent.allowedTools || PIPELINE_TOOLS });

    const delegateMatch = orchestratorReply.match(/<DELEGATE>([\s\S]*?)<\/DELEGATE>/);
    if (!delegateMatch) {
      db?.chatLog(pid, aid, "direct_reply", agent.name, orchestratorReply);
      return orchestratorReply;
    }

    let delegations = [];
    try {
      delegations = JSON.parse(delegateMatch[1].trim()).tasks || [];
    } catch {
      return orchestratorReply.replace(/<DELEGATE>[\s\S]*?<\/DELEGATE>/, "").trim() || orchestratorReply;
    }

    const planSummary = delegations.map(d => `${agentMap[d.agentId]?.name || d.agentId}: ${d.task}`).join("\n");
    db?.chatLog(pid, aid, "delegation_plan", agent.name, planSummary);
    log.info("chat", `${agent.name} delegating to ${delegations.length} agent(s)`);

    const settled = await Promise.allSettled(
      delegations
        .filter(d => agentMap[d.agentId])
        .map(async d => {
          const subAgent = agentMap[d.agentId];
          sse({ type: "delegate", agentName: subAgent.name, agentId: d.agentId, task: d.task });
          db?.chatLog(pid, aid, "delegate_task", subAgent.name, d.task);
          const delegateStart = Date.now();

          const result = await callAgent(sse, pid, aid, subAgent, d.task, lang, allModels, allProviders, project, agentMap, cfg, provider.type, depth, allIssues, taskFile);

          if (result.error) {
            db?.chatLog(pid, aid, "delegate_error", subAgent.name, result.error);
            sse({ type: "agent_error", agentName: subAgent.name, error: result.error });
            return result;
          }

          const elapsed = Date.now() - delegateStart;
          log.info("chat", `delegate ← ${subAgent.name} in ${elapsed}ms`);
          db?.chatLog(pid, aid, "delegate_reply", subAgent.name, result.reply, elapsed);
          sse({ type: "agent_reply", agentName: subAgent.name, preview: result.reply.slice(0, 120) });
          return result;
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

    // Append each agent's response to the task file (builds audit trail)
    results.forEach(r => { if (r.reply) appendTaskFile(taskFile, r.agentName, r.reply); });

    // Always synthesize when Linear enabled — sub-agents don't handle Linear blocks.
    const needsSynthesis = agent.linearEnabled || delegations.length !== 1 || !results[0] || results[0].error;

    if (!needsSynthesis) {
      log.info("chat", `${agent.name} single-delegate, skipping synthesis`);
      return results[0].reply;
    }

    sse({ type: "progress", text: depth === 0 ? "Synthesizing team responses…" : `${agent.name} synthesizing…` });
    log.info("chat", `${agent.name} synthesizing ${results.length} results`);

    // PM synthesis reads the accumulated task file instead of raw LLM-to-LLM context
    const taskFileContent = readTaskFile(taskFile);
    const synthCtx = taskFileContent
      ? `Task document (full history):\n\n${taskFileContent}`
      : results.map(r =>
          r.error ? `**${r.agentName}** (error): ${r.error}` : `**${r.agentName}**:\n${r.reply}`
        ).join("\n\n---\n\n");

    const synthSystem = `You are ${agent.name}. ${agent.role || ""}${ai.langDirective(lang) || ""}${depth === 0 ? allIssues : ""}${linearFormat}`;
    const linearInstruction = agent.linearEnabled
      ? `\n\nBased on the user's original request and the team's response, decide if any Linear tasks need to be created or updated, and include the appropriate %%LINEAR_UPDATES%% or %%LINEAR_CREATE%% blocks at the END of your response.`
      : "";
    const synthMessage = `Original user request: "${message}"\n\nTeam responses:\n\n${synthCtx}\n\nProvide a clear, comprehensive answer that combines the team's work.${linearInstruction}`;

    const synthTimer = log.timer();
    const synthReply = await ai.callAIMessages(modelObj, provider, synthSystem, [{ role: "user", content: synthMessage }]);
    log.info("chat", `${agent.name} synthesis done in ${synthTimer()}`);
    return synthReply;
  }

  // ── Orchestrator chat (SSE wrapper around runOrchestratorCore) ────────────

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

      const history = db?.getChatHistory(pid, aid) || [];
      const historyCtx = history.length
        ? "\n\n## Conversation so far\n" + history.map(m =>
            m.role === "assistant" ? `Assistant: ${m.content}` : `User: ${m.content}`
          ).join("\n\n")
        : "";

      // Fetch once at top level — sub-orchestrators receive allIssues, not re-fetch.
      const allIssues = await fetchAllProjectIssues(project);

      // Deep-fetch any specific issue IDs mentioned in the message (e.g. VIS-154).
      const mentionedIds = [...new Set((message.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || []))];
      const detailParts  = (await Promise.all(mentionedIds.map(id => fetchIssueDetail(project, id)))).filter(Boolean);
      const issueDetails = detailParts.length ? `\n\n## Issue Details\n\n${detailParts.join("\n\n---\n\n")}` : "";

      // Create task file: PM loads full context once, all sub-agents read from it.
      const taskFile = createTaskFile(project, message, allIssues + issueDetails);

      let finalReply;
      try {
        finalReply = await runOrchestratorCore(
          sse, pid, agent, message, lang, pipeline,
          modelObj, provider, allModels, allProviders, project, agentMap, cfg,
          historyCtx, 0, allIssues, taskFile
        );

        const { cleanedReply, summary } = await applyLinearActions(project, finalReply);
        if (summary) finalReply = cleanedReply + summary;
        else finalReply = cleanedReply;

        db?.appendChatHistory(pid, aid, "user",      message);
        db?.appendChatHistory(pid, aid, "assistant", finalReply);
        db?.chatLog(pid, aid, "final_reply", agent.name, finalReply);

        sse({ type: "reply", text: finalReply });
        res.end();
        log.info("chat", `orchestrator done in ${totalTimer()}`);
      } finally {
        deleteTaskFile(taskFile);
      }
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
      const fileAccess   = buildFileAccessBlock(agent.allowedTools, project?.path);
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
