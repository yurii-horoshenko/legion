#!/usr/bin/env node

"use strict";

const fs   = require("fs");
const path = require("path");

// ── CLI parsing ────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

const COMMANDS = {
  web:   cmdWeb,
  start: cmdWeb,
  ask:   cmdAsk,
  help:  cmdHelp,
};

const fn = COMMANDS[cmd];
if (!fn) {
  if (cmd) {
    // Treat unknown command as agent name: legion <agent> [message]
    cmdAsk([cmd, ...args]);
  } else {
    cmdHelp();
    process.exit(0);
  }
} else {
  fn(args);
}

// ── Help ───────────────────────────────────────────────────────────────────

function cmdHelp() {
  console.log(`
  ┌─────────────────────────────────────────┐
  │  LEGION  AI Agent Platform  v0.1.0      │
  └─────────────────────────────────────────┘

  Usage:  legion <command> [options]

  Commands:
    web        Start the Legion web portal
    start      Alias for web
    ask        Start an interactive session with an agent
    help       Show this help

  Options (for web / start):
    --port, -p <number>   Port to listen on  (default: 3000)
    --no-open             Don't open browser automatically

  Examples:
    legion web
    legion web --port 8080
    legion ask product-manager
    legion ask "Product Manager"
`);
}

// ── Web server ─────────────────────────────────────────────────────────────

function cmdWeb(args) {
  let port   = 3000;
  let doOpen = true;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (args[i] === "--no-open") {
      doOpen = false;
    }
  }

  const webRoot = path.resolve(__dirname, "..", "platforms", "web");

  if (!fs.existsSync(webRoot)) {
    console.error(`\n  Error: web platform not found at ${webRoot}\n`);
    process.exit(1);
  }

  require("../lib/catalog").buildCatalog(webRoot);
  require("./server")({ port, doOpen, webRoot });
}

// ── Ask — interactive agent session ────────────────────────────────────────

async function cmdAsk(args) {
  const readline = require("readline");
  const os       = require("os");

  if (!args.length) {
    console.error("  Usage: legion ask <agent-name> [message]\n");
    console.error("  Example: legion ask product-manager\n");
    console.error("  Example: legion product-manager \"Обнови задачи\"\n");
    process.exit(1);
  }

  const agentArg = args[0].trim();
  const onceMsg  = args.slice(1).join(" ").trim() || null;

  const configDir = path.resolve(__dirname, "..", ".config");
  const httpLib   = require("../lib/http");
  const db        = require("../lib/db")(configDir);
  const io        = require("../lib/io")(configDir, db);
  const ai        = require("../lib/ai")(httpLib, io);

  // Find agent by name or id — only in projects that exist in the DB
  const agentsMap = db.readPAgents();
  const validPids = new Set(io.readProjects().map(p => p.id));
  let agent = null, pid = null;
  const needle = agentArg.toLowerCase();

  for (const [p, list] of Object.entries(agentsMap)) {
    if (!validPids.has(p)) continue; // skip orphaned project entries
    const found = list.find(a =>
      a.name?.toLowerCase() === needle ||
      a.id?.toLowerCase()   === needle ||
      a.id?.toLowerCase()   === needle.replace(/\s+/g, "-")
    );
    if (found) { agent = found; pid = p; break; }
  }

  if (!agent) {
    console.error(`\n  Agent "${agentArg}" not found.\n`);
    const all = Object.values(agentsMap).flat();
    if (all.length) {
      console.error("  Available agents:");
      all.forEach(a => console.error(`    • ${a.name}  (${a.id})`));
      console.error();
    }
    process.exit(1);
  }

  // Resolve model
  const cfg     = db.readConfig();
  const modelId = agent.model || cfg.defaultModelId;
  if (!modelId) {
    console.error(`\n  No model configured for "${agent.name}".\n`);
    process.exit(1);
  }
  const resolved = httpLib.resolveModel(db.readModels(), db.readProviders(), modelId);
  if (!resolved) {
    console.error(`\n  Model "${modelId}" not found or provider not configured.\n`);
    process.exit(1);
  }
  const { model: modelObj, provider } = resolved;

  const project  = io.readProjects().find(p => p.id === pid);
  const agentMap = Object.fromEntries((agentsMap[pid] || []).map(a => [a.id, a]));
  let _allLinearCtxCache = null;

  // ── Build full system prompt (mirrors routes/chat.js logic) ───────────────
  async function buildSystemPrompt() {
    let identity = "";
    if (project?.path) {
      const iFile = path.join(project.path, ".legion", "agents", agent.id, "IDENTITY.md");
      if (fs.existsSync(iFile)) identity = "\n\n## Identity\n\n" + fs.readFileSync(iFile, "utf8");
    }

    const userSkillsDir = path.join(os.homedir(), ".claude", "skills");
    const skillLines = (agent.skills || []).map(skillId => {
      const md = path.join(userSkillsDir, skillId, "SKILL.md");
      if (fs.existsSync(md)) {
        const m = fs.readFileSync(md, "utf8").slice(0, 400).match(/^description:\s*(.+)/m);
        if (m) return `**${skillId}** — ${m[1].trim().replace(/^["']|["']$/g, "")}`;
      }
      return `**${skillId}**`;
    });
    const skillsLine = skillLines.length ? skillLines.join(", ") : "None";

    // Orchestrators (agents with a pipeline) see all project issues, not just their label
    const pipeline = db.storeGet(pid, agent.id, "pipeline") || [];
    const linearCtx = pipeline.length > 0
      ? await getOrBuildAllLinearCtx()
      : await buildLinearCtx();
    const subAgentCtx = buildSubAgentCtx();

    const fileAccessBlock = agent.allowedTools
      ? `\n\n## File System Access\nYou have read-only access to project files via these tools: **Read** (read file contents), **LS** (list directory), **Glob** (find files by pattern), **Grep** (search in files). Use them to analyse the codebase when your task requires it.`
      : "";

    return `You are ${agent.name}. ${agent.role || ""}

**Skills:** ${skillsLine}
${identity}${linearCtx}${subAgentCtx}${fileAccessBlock}`;
  }

  // ── Linear context for this agent's label ─────────────────────────────────
  async function buildLinearCtx() {
    if (!project?.path || !agent.linearEnabled || !agent.linearLabelName) return "";
    const integ  = io.readIntegrations(project);
    const apiKey = integ.linear?.apiKey;
    if (!apiKey) return "";
    try {
      const q = `query($label:String!,$first:Int!){issues(filter:{labels:{some:{name:{eq:$label}}}},first:$first,orderBy:updatedAt){nodes{id identifier title description state{name}priority url}}}`;
      const r = await io.linearQuery(apiKey, q, { label: agent.linearLabelName, first: 50 });
      const DONE = new Set(["done", "cancelled", "duplicate"]);
      const issues = (r.data?.issues?.nodes || []).filter(i => !DONE.has((i.state?.name || "").toLowerCase()));
      if (!issues.length) return "";
      const lines = issues.map(i =>
        `- [${i.identifier}] ${i.title} | ${i.state?.name || "?"}`
      ).join("\n");
      process.stderr.write(`  ✓ Loaded ${issues.length} Linear tasks (label: ${agent.linearLabelName})\n`);
      return `\n\n## Your Current Linear Tasks (label: ${agent.linearLabelName})\n${lines}`;
    } catch (e) {
      process.stderr.write(`  ⚠ Linear fetch failed: ${e.message}\n`);
      return "";
    }
  }

  // ── All project issues for orchestrator context ────────────────────────────
  async function buildAllLinearCtx() {
    if (!project?.path) return "";
    const integ  = io.readIntegrations(project);
    const apiKey = integ.linear?.apiKey;
    if (!apiKey) return "";
    try {
      const teamId = integ.linear?.defaultTeamId;
      const vars   = { first: 100 };
      const parts  = ["$first:Int"];
      let filter   = "";
      if (teamId) { parts.push("$teamId:ID"); filter = "filter:{team:{id:{eq:$teamId}}}"; vars.teamId = teamId; }
      const q = `query(${parts.join(",")}){issues(${filter},first:$first,orderBy:updatedAt){nodes{id identifier title description state{name}priority assignee{name}labels{nodes{name}}url}}}`;
      const r = await io.linearQuery(apiKey, q, vars);
      const DONE = new Set(["done", "cancelled", "duplicate"]);
      const issues = (r.data?.issues?.nodes || []).filter(i => !DONE.has((i.state?.name || "").toLowerCase()));
      if (!issues.length) return "";
      const lines = issues.map(i => {
        const labels   = (i.labels?.nodes || []).map(l => l.name).join(", ");
        const assignee = i.assignee?.name || "unassigned";
        return `[${i.identifier}] ${i.title} | ${i.state?.name || "?"} | assignee: ${assignee}${labels ? ` | labels: ${labels}` : ""}`;
      }).join("\n");
      process.stderr.write(`  ✓ Loaded ${issues.length} Linear issues (active)\n`);
      return `\n\n## All Linear Issues (${issues.length})\n${lines}`;
    } catch { return ""; }
  }

  async function getOrBuildAllLinearCtx() {
    if (_allLinearCtxCache !== null) return _allLinearCtxCache;
    _allLinearCtxCache = await buildAllLinearCtx();
    return _allLinearCtxCache;
  }

  // ── Pipeline sub-agents list for orchestrator ──────────────────────────────
  function buildSubAgentCtx() {
    const pipeline = db?.storeGet ? (db.storeGet(pid, agent.id, "pipeline") || []) : [];
    if (!pipeline.length) return "";
    const list = pipeline.map(p => {
      const sa = agentMap[p.targetAgentId];
      return sa ? `- **${sa.name}** (id: ${sa.id}): ${sa.role || sa.description || ""}` : null;
    }).filter(Boolean).join("\n");
    return list ? `\n\n## Your Sub-Agents (delegate tasks to them with <DELEGATE>)\n${list}` : "";
  }

  // ── Apply %%LINEAR_UPDATES%% block from AI reply ───────────────────────────
  async function applyLinearUpdates(reply) {
    const match = reply.match(/%%LINEAR_UPDATES%%([\s\S]*?)%%END_LINEAR_UPDATES%%/);
    if (!match) return reply;

    const cleaned = reply.replace(/%%LINEAR_UPDATES%%[\s\S]*?%%END_LINEAR_UPDATES%%/g, "").trim();
    if (!project?.path) return cleaned + "\n\n⚠️ No project path — Linear updates skipped.";

    const integ  = io.readIntegrations(project);
    const apiKey = integ.linear?.apiKey;
    if (!apiKey) return cleaned + "\n\n⚠️ Linear not configured — updates skipped.";

    let updates;
    try { updates = JSON.parse(match[1].trim()); } catch {
      return cleaned + "\n\n⚠️ Could not parse LINEAR_UPDATES block — invalid JSON.";
    }
    if (!Array.isArray(updates) || !updates.length) return cleaned;

    // Fetch state name→id map
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
      return cleaned + `\n\n⚠️ Could not fetch Linear states: ${e.message}`;
    }

    const results = [];
    for (const u of updates) {
      const stateId = u.stateId || stateMap[u.stateName?.toLowerCase()];
      const mut = [];
      const input = {};
      if (stateId) input.stateId = stateId;
      if (u.title) input.title = u.title;
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
          if (u.title)       parts.push(`title updated`);
          if (stateId)       parts.push(`→ ${iss.state?.name}`);
          if (u.description) parts.push(`description updated`);
          results.push(parts.join(" "));
        }
      } catch (e) {
        results.push(`❌ ${u.issueId}: ${e.message}`);
      }
    }

    return cleaned + `\n\n**Linear updates applied:**\n${results.join("\n")}`;
  }

  // ── Execute DELEGATE block — call sub-agents, return structured results ──────
  async function runDelegations(delegations) {
    const allModels    = db.readModels();
    const allProviders = db.readProviders();
    const settled = await Promise.allSettled(delegations.map(async d => {
      const sub = agentMap[d.agentId];
      if (!sub) return { agentName: d.agentId, error: "agent not found" };

      // Prefer haiku from same provider type for speed; fall back to sub's model or default
      const subRes = (() => {
        if (sub.model) {
          const r = httpLib.resolveModel(allModels, allProviders, sub.model);
          if (r) return r;
        }
        const haiku = allModels.find(m =>
          (m.modelId || "").toLowerCase().includes("haiku") &&
          allProviders.find(p => p.id === m.providerId)?.type === provider.type
        );
        if (haiku) {
          const r = httpLib.resolveModel(allModels, allProviders, haiku.id);
          if (r) return r;
        }
        return httpLib.resolveModel(allModels, allProviders, cfg.defaultModelId);
      })();
      if (!subRes) return { agentName: sub.name || d.agentId, error: "no model configured" };
      const { model: subModel, provider: subProv } = subRes;

      process.stderr.write(`  → ${sub.name} (${subModel.modelId || subModel.id})…\n`);

      let subIdentity = "";
      if (project?.path) {
        const iFile = path.join(project.path, ".legion", "agents", sub.id, "IDENTITY.md");
        if (fs.existsSync(iFile)) subIdentity = "\n\n## Identity\n\n" + fs.readFileSync(iFile, "utf8");
      }
      // Subagents receive focused tasks — no full Linear context needed
      const subFileAccess = sub.allowedTools
        ? `\n\n## File System Access\nYou have read-only access to project files via: **Read**, **LS**, **Glob**, **Grep**. Use them to analyse code when your task requires it.`
        : "";
      const subSp    = `You are ${sub.name}. ${sub.role || ""}${subIdentity}${subFileAccess}`;
      const task     = d.task || d.prompt || "";
      const subReply = await ai.callAIMessages(subModel, subProv, subSp, [{ role: "user", content: task }], { maxTokens: 2048, allowedTools: sub.allowedTools || "" });
      return { agentName: sub.name, task, reply: subReply };
    }));

    return settled.map((s, i) => {
      if (s.status === "fulfilled") return s.value;
      const d = delegations[i];
      return { agentName: agentMap[d?.agentId]?.name || d?.agentId || "unknown", error: s.reason?.message || "error" };
    });
  }

  // ── Process one AI reply (DELEGATE → sub-agents → synthesis → Linear) ────────
  async function processReply(reply, userMessage) {
    // Check for orchestrator DELEGATE block first
    const delMatch = reply.match(/<DELEGATE>([\s\S]*?)<\/DELEGATE>/);
    if (delMatch) {
      let delegations = [];
      try { delegations = JSON.parse(delMatch[1].trim()).tasks || []; } catch {}
      if (delegations.length) {
        process.stderr.write(`\n  Delegating to ${delegations.length} agent(s)…\n`);
        const results = await runDelegations(delegations);

        if (delegations.length === 1 && results[0] && !results[0].error) {
          // Single delegate — skip synthesis, return reply directly
          reply = results[0].reply;
        } else {
          // Multiple delegates or errors — synthesize
          process.stderr.write(`  Synthesizing…\n`);
          const synthCtx = results.map(r =>
            r.error ? `**${r.agentName}** (error): ${r.error}` : `**${r.agentName}**:\n${r.reply}`
          ).join("\n\n---\n\n");
          const synthSp  = `You are ${agent.name}. ${agent.role || ""}`;
          const synthMsg = `Team responses for: "${userMessage || "the request"}"\n\n${synthCtx}\n\nProvide a clear, comprehensive final answer. If any sub-agent provided Linear update suggestions, include a %%LINEAR_UPDATES%% block.`;
          reply = await ai.callAIMessages(modelObj, provider, synthSp, [{ role: "user", content: synthMsg }]);
        }
      }
    }

    // Apply Linear updates (from either direct reply or synthesis)
    reply = await applyLinearUpdates(reply);
    return reply;
  }

  // ── Print formatted reply ──────────────────────────────────────────────────
  function printReply(label, text) {
    const prefix = `${label} > `;
    const pad    = " ".repeat(prefix.length);
    const lines  = text.replace(/\r\n/g, "\n").split("\n");
    console.log(prefix + lines[0]);
    for (let i = 1; i < lines.length; i++) console.log(pad + lines[i]);
    console.log();
  }

  // ── Build full system prompt once ─────────────────────────────────────────
  const shortName    = agent.name.split(" ")[0];
  const label        = shortName.padEnd(6);

  process.stderr.write(`\n  Building context…\n`);
  const systemPrompt = await buildSystemPrompt();
  const history      = db?.getChatHistory ? (db.getChatHistory(pid, agent.id) || []) : [];

  // ── One-shot mode ──────────────────────────────────────────────────────────
  if (onceMsg) {
    let dots = 0;
    const spin = setInterval(() => {
      process.stdout.write(`\r${label} > ${".".repeat(++dots % 4).padEnd(3)}`);
    }, 350);
    try {
      const messages = [...history, { role: "user", content: onceMsg }];
      let reply = await ai.callAIMessages(modelObj, provider, systemPrompt, messages, { allowedTools: agent.allowedTools || "" });
      clearInterval(spin);
      process.stdout.write(`\r${" ".repeat(60)}\r`);
      reply = await processReply(reply, onceMsg);
      printReply(label, reply);
    } catch (err) {
      clearInterval(spin);
      process.stdout.write(`\r${" ".repeat(60)}\r`);
      console.error(`${label} > ✗ ${err.message}\n`);
      process.exit(1);
    }
    process.exit(0);
  }

  // ── Interactive mode ───────────────────────────────────────────────────────
  const bar = "─".repeat(45);
  console.log(`\n  ┌${bar}┐`);
  console.log(`  │  ${(agent.name).padEnd(43)}│`);
  console.log(`  │  ${(modelObj.modelId || modelId).padEnd(43)}│`);
  if (history.length) console.log(`  │  ${(`history: ${history.length} messages`).padEnd(43)}│`);
  console.log(`  └${bar}┘`);
  console.log(`  Ctrl+C or type "exit" to end the session.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const turn = () => {
    rl.question("You    > ", async (raw) => {
      const input = raw.trim();
      if (!input)                               { turn(); return; }
      if (input === "exit" || input === "quit") { rl.close(); return; }

      let dots = 0;
      const spin = setInterval(() => {
        process.stdout.write(`\r${label} > ${".".repeat(++dots % 4).padEnd(3)}`);
      }, 350);

      try {
        history.push({ role: "user", content: input });
        let reply = await ai.callAIMessages(modelObj, provider, systemPrompt, [...history], { allowedTools: agent.allowedTools || "" });
        clearInterval(spin);
        process.stdout.write(`\r${" ".repeat(60)}\r`);
        reply = await processReply(reply, input);
        history.push({ role: "assistant", content: reply });
        if (db?.appendChatHistory) {
          db.appendChatHistory(pid, agent.id, "user",      input);
          db.appendChatHistory(pid, agent.id, "assistant", reply);
        }
        printReply(label, reply);
      } catch (err) {
        clearInterval(spin);
        process.stdout.write(`\r${" ".repeat(60)}\r`);
        console.log(`${label} > ✗ ${err.message}\n`);
      }

      turn();
    });
  };

  turn();

  rl.on("close", () => {
    console.log("\n  Session ended.\n");
    process.exit(0);
  });
}
