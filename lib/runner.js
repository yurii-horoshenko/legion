"use strict";

const { resolveModel } = require("./http");
const log = require("./log");

// Headless agent runner: execute one direct (non-orchestrator) agent turn
// outside the HTTP request cycle. Powers the cron scheduler (and future
// workers/channels). Reuses failover + semantic memory; the full orchestrator/
// Linear flow stays in routes/chat.js (it is request/SSE-scoped).

module.exports = function createRunner({ io, ai, db, memory }) {

  async function run(pid, agent, message, opts = {}) {
    if (!agent || !message?.trim()) throw new Error("runner: agent and message required");
    const cfg = io.readConfig();
    const modelId = agent.model || cfg.defaultModelId;
    if (!modelId) throw new Error(`runner: no model configured for ${agent.name}`);

    const resolved = resolveModel(io.readModels(), io.readProviders(), modelId);
    if (!resolved) throw new Error(`runner: model '${modelId}' not resolvable`);

    const candidates = ai.buildFailoverCandidates({ model: resolved.model, provider: resolved.provider }, io.readModels(), io.readProviders());
    let memBlock = "";
    if (memory) { try { memBlock = await memory.buildContextBlock(pid, message, { limit: 6 }); } catch {} }

    const system = `You are ${agent.name}. ${agent.role || ""}${ai.langDirective(opts.lang) || ""}${memBlock}`;
    const reply = await ai.callAIMessagesResilient(candidates, system, [{ role: "user", content: message }], { allowedTools: agent.allowedTools || "" });

    if (memory) {
      memory.store(pid, agent.id, `[scheduled] ${message}`, { kind: "event" }).catch(() => {});
      memory.store(pid, agent.id, `${agent.name}: ${reply}`, { kind: "note" }).catch(() => {});
    }
    log.info("runner", `ran ${agent.name} headless (${reply.length} chars)`);
    return reply;
  }

  return { run };
};
