"use strict";

const fs     = require("fs");
const path   = require("path");
const os     = require("os");
const crypto = require("crypto");
const dag    = require("../lib/dag");
const orch   = require("../lib/orchestrator");
const tools  = require("../lib/tools");
const log    = require("../lib/log");

// In-memory intro cache: "pid:aid:lang" → { intro, ts }
const introCache = new Map();
const INTRO_TTL_MS = 60 * 60 * 1000; // 1 hour

// States that should not appear in agent context (terminal states)
const DONE_STATES = new Set(["done", "cancelled", "duplicate"]);

module.exports = function createChatRoutes(ctx) {
  const { io, http, ai, db, ws, memory, compactor, defence, hooks, capture, stats, runner, agentLoop, agentFs } = ctx;
  const EV = hooks?.EVENTS || {};

  // Normalize externally-sourced content (Linear bodies, comments) before it
  // enters a prompt — strips zero-width chars used to hide injected instructions.
  const sanitizeExternal = (s) => (defence && s) ? defence.normalize(s) : s;

  // ── Memory & context compaction helpers (Phase 1) ─────────────────────────

  // Best-effort semantic recall block; never throws into the request path.
  async function recallBlock(pid, query) {
    if (!memory) return "";
    try { return await memory.buildContextBlock(pid, query, { limit: 6 }); }
    catch (err) { log.warn("chat:memory", `recall failed — ${err.message}`); return ""; }
  }

  // Store a conversation turn as memory (fire-and-forget).
  function remember(pid, aid, role, content, kind) {
    if (!memory || !content?.trim()) return;
    memory.store(pid, aid, `${role}: ${content}`, { kind }).catch(() => {});
  }

  // Compact history into a summary + recent tail when it exceeds the token
  // budget, instead of blindly slicing. Returns { summaryBlock, messages }.
  async function compactHistory(pid, aid, history, candidates) {
    if (!compactor || !history.length) return { summaryBlock: "", messages: history };
    const summarize = async (older) => {
      const transcript = older.map(m => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`).join("\n\n");
      return ai.callAIMessagesResilient(candidates,
        "Summarize this earlier part of a conversation concisely. Preserve decisions, facts, names, numbers, and open questions. Output only the summary.",
        [{ role: "user", content: transcript }], { maxTokens: 700 });
    };
    const r = await compactor.maybeCompact(`${pid}:${aid}`, history, { budgetTokens: 8000, summarize });
    if (r.compacted) {
      remember(pid, aid, "summary", r.summary, "note");
      return { summaryBlock: `\n\n## Conversation summary (older turns)\n${r.summary}`, messages: r.messages };
    }
    return { summaryBlock: "", messages: r.messages };
  }

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

  // Max parallel sub-agents per delegation — guards against fan-out explosion.
  const MAX_DELEGATIONS = 8;

  // Emit a progress ping every 12s while a long LLM call runs, so the UI never
  // looks frozen. Cleared as soon as the promise settles.
  async function withHeartbeat(sse, text, promise) {
    const iv = setInterval(() => { try { sse({ type: "progress", text }); } catch {} }, 12_000);
    try { return await promise; } finally { clearInterval(iv); }
  }

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
      return sanitizeExternal(`\n\n## Your Current Linear Tasks (label: ${agent.linearLabelName})\n${lines}`);
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
      return sanitizeExternal(`\n\n## All Linear Issues (${issues.length})\n${lines}`);
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
      const q = `query($id:String!){issue(id:$id){identifier title description state{name}priority assignee{name}labels{nodes{name}}url updatedAt comments(first:25,orderBy:createdAt){nodes{body user{name}createdAt}}children{nodes{identifier title description state{name}}}}}`;
      const result = await io.linearQuery(apiKey, q, { id: identifier });
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
      return sanitizeExternal(lines.join("\n"));
    } catch (err) {
      log.warn("chat:linear", `failed to fetch issue detail "${identifier}": ${err.message}`);
      return "";
    }
  }

  // ── Linear update executor ────────────────────────────────────────────────

  async function applyLinearUpdates(project, reply) {
    const parsed = orch.parseLinearBlock(reply, "UPDATES");
    if (!parsed.found) return { cleanedReply: reply, summary: null };
    const cleanedReply = parsed.cleanedReply;

    const integ  = io.readIntegrations(project);
    const apiKey = integ.linear?.apiKey;
    if (!apiKey) return { cleanedReply, summary: "⚠️ Linear not configured — status updates skipped." };

    if (parsed.invalid) return { cleanedReply, summary: "⚠️ Could not parse LINEAR_UPDATES block — invalid JSON." };
    const updates = parsed.items;
    if (!updates.length) return { cleanedReply, summary: null };

    const teamId = integ.linear?.defaultTeamId;
    let stateMap = {};
    try {
      const sq = teamId
        ? `query($t:String!){ team(id:$t) { states { nodes { id name } } } }`
        : `{ teams { nodes { states { nodes { id name } } } } }`;
      const sr = await io.linearQuery(apiKey, sq, teamId ? { t: teamId } : {});
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
        const r = await io.linearQuery(apiKey, `query($id:String!){ issue(id:$id) { id } }`, { id: rawId });
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
    const parsed = orch.parseLinearBlock(reply, "CREATE");
    if (!parsed.found) return { cleanedReply: reply, summary: null };
    const cleanedReply = parsed.cleanedReply;

    const integ  = io.readIntegrations(project);
    const apiKey = integ.linear?.apiKey;
    if (!apiKey) return { cleanedReply, summary: "⚠️ Linear not configured — creates skipped." };

    if (parsed.invalid) return { cleanedReply, summary: "⚠️ Could not parse LINEAR_CREATE block — invalid JSON." };
    const creates = parsed.items;
    if (!creates.length) return { cleanedReply, summary: null };

    const teamId = integ.linear?.defaultTeamId;
    if (!teamId) return { cleanedReply, summary: "⚠️ Linear defaultTeamId not set — creates skipped." };

    let labelMap = {};
    try {
      const lq = `query($t:String!){ team(id:$t) { labels { nodes { id name } } } }`;
      const lr = await io.linearQuery(apiKey, lq, { t: teamId });
      const labels = lr.data?.team?.labels?.nodes || [];
      labelMap = Object.fromEntries(labels.map(l => [l.name.toLowerCase(), l.id]));
    } catch (e) { log.warn("chat:linear", `failed to fetch labels: ${e.message}`); }

    const results = [];

    for (const c of creates) {
      if (!c.title) { results.push("⚠ skipped: missing title"); continue; }
      const input = { title: c.title, teamId };
      if (c.description) input.description = c.description;
      if (c.priority)    input.priority = orch.PRIORITY_MAP[c.priority.toLowerCase()] ?? 3;
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
  async function callAgent(sse, pid, orchestratorAid, subAgent, task, lang, allModels, allProviders, project, agentMap, cfg, parentProviderType, depth, allIssues, taskFile, parentMemId) {
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
        "", depth + 1, allIssues, taskFile, parentMemId
      );
    } else {
      log.info("chat", `delegate → ${subAgent.name} (leaf)`);
      const subIdentity   = loadIdentity(project, subAgent.id);
      const subFileAccess = buildFileAccessBlock(subAgent.allowedTools, project?.path);
      // Branch-fork isolation (Sloppy BranchRuntime): give the sub-agent a
      // SCOPED context — memory relevant to its own task plus a bounded excerpt
      // of the shared task file — instead of the entire growing document, which
      // otherwise blows up tokens as more agents append to it.
      const subMem        = await recallBlock(pid, task);
      const subSkills     = agentFs.skillsPromptBlock(project, subAgent);
      const subSystem     = `You are ${subAgent.name}. ${subAgent.role || ""}${ai.langDirective(lang) || ""}${subIdentity}${subSkills}${subFileAccess}${subMem}`;
      const full          = readTaskFile(taskFile);
      const excerpt       = full.length > 6000 ? `${full.slice(0, 1500)}\n…(trimmed)…\n${full.slice(-4000)}` : full;
      const taskCtx       = taskFile ? `\n\n## Task Document (excerpt)\n\n${excerpt}` : "";
      const subCandidates = ai.buildFailoverCandidates(subResolved, allModels, allProviders);
      const granted       = subAgent.allowedTools || PIPELINE_TOOLS;
      // Tool execution mode (config `toolExecution`): false | "readonly" (default) | "full".
      // claude-cli runs its own internal tool loop, so it bypasses ours.
      const toolMode = cfg.toolExecution === undefined ? "readonly" : cfg.toolExecution;
      const effectiveTools = (toolMode === "full" || toolMode === true)
        ? granted
        : (toolMode === false ? "" : granted.split(",").map(s => s.trim()).filter(t => tools.READONLY.has(t)).join(","));

      if (agentLoop && project?.path && subResolved.provider.type !== "claude-cli" && effectiveTools) {
        reply = await agentLoop.run({
          candidates: subCandidates, systemPrompt: subSystem,
          messages: [{ role: "user", content: task + taskCtx }],
          agentId: subAgent.id, projectRoot: project.path,
          allowedTools: effectiveTools, sessionId: `${pid}:${subAgent.id}:${Date.now()}`, sse,
        });
      } else {
        reply = await ai.callAIMessagesFailover(
          subCandidates, subSystem,
          [{ role: "user", content: task + taskCtx }],
          { maxTokens: 2048, allowedTools: granted }
        );
      }

      // Branch concludes: persist its result as one memory and link it back to
      // the parent task (derivedFrom edge), so the distilled output re-enters
      // shared memory without polluting the parent transcript.
      if (memory && reply) {
        try {
          const childId = await memory.store(pid, subAgent.id, `${subAgent.name} on "${task.slice(0, 80)}": ${reply}`, { kind: "note", class: "branch-result" });
          if (parentMemId && childId) memory.link(childId, parentMemId, "derivedFrom", 1.0);
        } catch { /* memory is best-effort */ }
      }
    }

    return { agentName: subAgent.name, task, reply };
  }

  // Core orchestrator logic. Returns the final reply string.
  // historyCtx is only non-empty at the top level (conversation continuity).
  // allIssues is fetched once at depth=0 and passed down to avoid repeat API calls.
  // depth prevents infinite pipeline loops.
  async function runOrchestratorCore(sse, pid, agent, message, lang, pipeline, modelObj, provider, allModels, allProviders, project, agentMap, cfg, historyCtx, depth, allIssues, taskFile, parentMemId) {
    const aid       = agent.id;
    const subAgents = pipeline.map(p => agentMap[p.targetAgentId]).filter(Boolean);
    if (allIssues === undefined) allIssues = await fetchAllProjectIssues(project);
    const identity  = loadIdentity(project, aid);
    const linearFormat = agent.linearEnabled ? buildLinearFormatBlock() : "";
    const memBlock  = depth === 0 ? await recallBlock(pid, message) : "";

    const skillsBlock = agentFs.skillsPromptBlock(project, agent);

    if (!subAgents.length) {
      const fileAccess = buildFileAccessBlock(agent.allowedTools, project?.path);
      const sp   = `You are ${agent.name}. ${agent.role || ""}${ai.langDirective(lang) || ""}${identity}${skillsBlock}${allIssues}${linearFormat}${fileAccess}${memBlock}${historyCtx}`;
      const msgs = [{ role: "user", content: message }];
      const leafCandidates = ai.buildFailoverCandidates({ model: modelObj, provider }, allModels, allProviders);
      return await ai.callAIMessagesResilient(leafCandidates, sp, msgs, { allowedTools: agent.allowedTools || "" });
    }

    const subAgentsList = subAgents.map(a => `- **${a.name}** (id: ${a.id}): ${a.role || a.description || "no role"}`).join("\n");
    const fileAccess    = buildFileAccessBlock(agent.allowedTools, project?.path);
    const promptFile    = path.resolve(__dirname, "../core/prompts/chat-orchestrator.md");
    const systemPrompt  = fs.readFileSync(promptFile, "utf8")
      .replace("{{agent_name}}",      agent.name || aid)
      .replace("{{agent_role}}",      agent.role || agent.description || "General-purpose agent")
      .replace("{{sub_agents_list}}", subAgentsList)
      .replace("{{lang_directive}}",  ai.langDirective(lang) || "")
      + identity + skillsBlock + linearFormat + fileAccess + allIssues + memBlock + historyCtx;

    sse({ type: "progress", text: depth === 0 ? "Analyzing request…" : `${agent.name} analyzing…` });
    log.info("chat", `orchestrator ${agent.name} analyzing (${subAgents.length} sub-agents, depth=${depth})`);

    const candidates = ai.buildFailoverCandidates({ model: modelObj, provider }, allModels, allProviders);
    const orchestratorReply = await withHeartbeat(
      sse, depth === 0 ? "Analyzing request…" : `${agent.name} analyzing…`,
      ai.callAIMessagesFailover(candidates, systemPrompt, [{ role: "user", content: message }], { allowedTools: agent.allowedTools || PIPELINE_TOOLS })
    );

    const parsedDelegate = orch.parseDelegate(orchestratorReply);
    if (!parsedDelegate) {
      db?.chatLog(pid, aid, "direct_reply", agent.name, orchestratorReply);
      return orchestratorReply;
    }
    if (parsedDelegate.invalid) {
      return orch.stripDelegate(orchestratorReply) || orchestratorReply;
    }
    const delegations = parsedDelegate.tasks;

    const planSummary = delegations.map(d => `${agentMap[d.agentId]?.name || d.agentId}: ${d.task}`).join("\n");
    db?.chatLog(pid, aid, "delegation_plan", agent.name, planSummary);
    log.info("chat", `${agent.name} delegating to ${delegations.length} agent(s)`);

    const runnable = delegations.filter(d => agentMap[d.agentId]).slice(0, MAX_DELEGATIONS);
    runnable.forEach((d, i) => { if (!d.id) d.id = `t${i}`; });

    // Run a single delegation; never throws (returns an error result instead).
    const runOne = async (d) => {
      const subAgent = agentMap[d.agentId];
      sse({ type: "delegate", agentName: subAgent.name, agentId: d.agentId, task: d.task });
      db?.chatLog(pid, aid, "delegate_task", subAgent.name, d.task);
      const delegateStart = Date.now();
      try {
        const result = await callAgent(sse, pid, aid, subAgent, d.task, lang, allModels, allProviders, project, agentMap, cfg, provider.type, depth, allIssues, taskFile, parentMemId);
        if (result.error) {
          db?.chatLog(pid, aid, "delegate_error", subAgent.name, result.error);
          stats?.recordFailure(project, subAgent.id, result.error);
          sse({ type: "agent_error", agentName: subAgent.name, error: result.error });
          return result;
        }
        const elapsed = Date.now() - delegateStart;
        log.info("chat", `delegate ← ${subAgent.name} in ${elapsed}ms`);
        db?.chatLog(pid, aid, "delegate_reply", subAgent.name, result.reply, elapsed);
        stats?.recordSuccess(project, subAgent.id);
        sse({ type: "agent_reply", agentName: subAgent.name, preview: result.reply.slice(0, 120) });
        return result;
      } catch (err) {
        log.error("chat", `delegate ✗ ${subAgent.name} — ${err.message}`);
        db?.chatLog(pid, aid, "delegate_error", subAgent.name, err.message || "Unknown error");
        stats?.recordFailure(project, subAgent.id, err.message);
        sse({ type: "agent_error", agentName: subAgent.name, error: err.message || "Error" });
        return { agentName: subAgent.name, error: err.message || "Error" };
      }
    };

    // Validate the proposed subtask DAG and run in dependency-ordered waves.
    // With no declared dependencies this is one flat parallel wave (unchanged
    // behaviour); an invalid graph (cycle/bad dep) also degrades to flat.
    const validation = dag.validate(runnable, { maxDepth: 6 });
    let waves;
    if (validation.ok && validation.hasDeps) {
      waves = validation.waves;
      log.info("chat", `delegation DAG: ${runnable.length} task(s) in ${waves.length} wave(s)`);
    } else {
      if (!validation.ok) log.warn("chat", `delegation DAG invalid (${validation.errors.join("; ")}) — flat parallel`);
      waves = [runnable.map(d => d.id)];
    }

    const byId = new Map(runnable.map(d => [d.id, d]));
    const results = [];
    for (const wave of waves) {
      const waveResults = await Promise.all(wave.map(id => runOne(byId.get(id))));
      results.push(...waveResults);
    }

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
    const synthReply = await withHeartbeat(
      sse, depth === 0 ? "Synthesizing team responses…" : `${agent.name} synthesizing…`,
      ai.callAIMessagesResilient(candidates, synthSystem, [{ role: "user", content: synthMessage }], {})
    );
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

    const trace = crypto.randomUUID();
    db?.chatLog(pid, aid, "user_message", agent.name, message, undefined, trace);

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

      // Parent memory node for this run — sub-agent branch results link to it.
      let parentMemId = null;
      if (memory) { try { parentMemId = await memory.store(pid, aid, `Request: ${message}`, { kind: "goal", importance: 0.7 }); } catch {} }

      let finalReply;
      try {
        finalReply = await runOrchestratorCore(
          sse, pid, agent, message, lang, pipeline,
          modelObj, provider, allModels, allProviders, project, agentMap, cfg,
          historyCtx, 0, allIssues, taskFile, parentMemId
        );

        const { cleanedReply, summary } = await applyLinearActions(project, finalReply);
        if (summary) finalReply = cleanedReply + summary;
        else finalReply = cleanedReply;

        // Goal 5 — enforced code-review + docs + session-note capture for
        // implementation runs (config `autoReviewDocs`, on by default).
        if (capture && cfg.autoReviewDocs !== false && capture.isImplementationRun(message)) {
          const rdCandidates  = ai.buildFailoverCandidates({ model: modelObj, provider }, io.readModels(), io.readProviders());
          const projAgents    = Object.values(agentMap);
          const reviewerAgent = capture.findRoleAgent(projAgents, "review");
          const writerAgent   = capture.findRoleAgent(projAgents, "docs");
          const { review, docs, reviewedBy, documentedBy } = await withHeartbeat(sse, "Reviewing & documenting…",
            capture.reviewAndDocument({ ai, candidates: rdCandidates, message, finalReply, runner, pid, reviewerAgent, writerAgent }));
          finalReply += `\n\n---\n### 🔍 Auto code review (${reviewedBy})\n${review || "_(none)_"}\n\n### 📝 Docs / changelog (${documentedBy})\n${docs || "_(none)_"}`;
          const note = capture.writeSessionNote(project, { message, finalReply, review, docs });
          if (note) { db?.log("capture:session", pid, aid, { file: note }, trace); sse({ type: "progress", text: "Session note saved" }); }
        }

        db?.appendChatHistory(pid, aid, "user",      message);
        db?.appendChatHistory(pid, aid, "assistant", finalReply);
        db?.chatLog(pid, aid, "final_reply", agent.name, finalReply, undefined, trace);
        remember(pid, aid, "User", message, "event");
        remember(pid, aid, agent.name, finalReply, "note");
        stats?.recordSuccess(project, aid);

        sse({ type: "reply", text: finalReply, trace });
        res.end();
        hooks?.emit(EV.CHAT_REPLY, { pid, aid, trace, reply: finalReply }, { agent, mode: "orchestrator" }).catch(() => {});
        log.info("chat", `orchestrator done in ${totalTimer()}`);
      } finally {
        deleteTaskFile(taskFile);
      }
    } catch (err) {
      log.error("chat", `orchestrator error in ${totalTimer()} — ${err.message}`);
      db?.chatLog(pid, aid, "error", agent.name, err.message, undefined, trace);
      stats?.recordFailure(io.readProjects().find(p => p.id === pid), aid, err.message);
      hooks?.emit(EV.CHAT_ERROR, { pid, aid, trace, error: err.message }, { agent, mode: "orchestrator" }).catch(() => {});
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
        const introCandidates = ai.buildFailoverCandidates({ model: modelObj, provider }, io.readModels(), io.readProviders());
        const intro = await ai.callAIMessagesResilient(introCandidates, systemPrompt, [{ role: "user", content: "Introduce yourself." }], {});
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
      const trace = crypto.randomUUID();
      log.info("chat", `start agent="${agent.name}" model=${modelObj.modelId} provider=${provider.type} pid=${pid}`);
      db?.chatLog(pid, aid, "user_message", agent.name, message.trim(), undefined, trace);

      // Lifecycle hook — a registered handler may veto the request.
      if (hooks) {
        const pre = await hooks.emit(EV.CHAT_START, { pid, aid, message: message.trim() }, { agent });
        if (pre.aborted) { http.json(res, 200, { reply: pre.message || "Request blocked by a hook." }); return true; }
      }

      const identity     = loadIdentity(project, aid);
      const skillsBlock  = agentFs.skillsPromptBlock(project, agent);
      const linearCtx    = await buildLinearContext(project, agent);
      const linearFormat = agent.linearEnabled ? buildLinearFormatBlock() : "";
      const fileAccess   = buildFileAccessBlock(agent.allowedTools, project?.path);
      const candidates   = ai.buildFailoverCandidates({ model: modelObj, provider }, io.readModels(), io.readProviders());
      const rawHistory   = db?.getChatHistory(pid, aid) || [];
      const memBlock     = await recallBlock(pid, message.trim());
      const { summaryBlock, messages: history } = await compactHistory(pid, aid, rawHistory, candidates);
      const systemPrompt = `You are ${agent.name}. ${agent.role || ""}${ai.langDirective(body.lang)}${identity}${skillsBlock}${linearCtx}${linearFormat}${fileAccess}${summaryBlock}${memBlock}`;
      const messages     = [...history, { role: "user", content: message.trim() }];

      try {
        let reply = await ai.callAIMessagesResilient(candidates, systemPrompt, messages, { allowedTools: agent.allowedTools || "" });
        log.info("chat", `done agent="${agent.name}" in ${chatTimer()} history=${history.length}msgs`);

        const { cleanedReply, summary } = await applyLinearActions(project, reply);
        if (summary) reply = cleanedReply + summary;
        else reply = cleanedReply;

        db?.appendChatHistory(pid, aid, "user",      message.trim());
        db?.appendChatHistory(pid, aid, "assistant", reply);
        remember(pid, aid, "User", message.trim(), "event");
        remember(pid, aid, agent.name, reply, "note");
        db?.chatLog(pid, aid, "direct_reply", agent.name, reply, undefined, trace);
        db?.log("chat:message", pid, aid, { role: "user", preview: message.slice(0, 80) }, trace);
        ws?.broadcast("chat:message", { pid, aid, agentName: agent.name, preview: message.slice(0, 80) });
        stats?.recordSuccess(project, aid);
        hooks?.emit(EV.CHAT_REPLY, { pid, aid, trace, reply }, { agent }).catch(() => {});
        http.json(res, 200, { reply, trace });
      } catch (err) {
        log.error("chat", `fail agent="${agent.name}" in ${chatTimer()} — ${err.message}`);
        db?.chatLog(pid, aid, "error", agent.name, err.message, undefined, trace);
        stats?.recordFailure(project, aid, err.message);
        hooks?.emit(EV.CHAT_ERROR, { pid, aid, trace, error: err.message }, { agent }).catch(() => {});
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
