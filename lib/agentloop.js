"use strict";

const orch  = require("./orchestrator");
const tools = require("./tools");
const { filterAllowedTools } = require("./toolgate");
const log   = require("./log");

// Provider-agnostic tool-execution loop. The model requests a tool with a
// %%TOOL%% block (same block idiom as DELEGATE/Linear), Legion executes it
// through the toolGate (authorize → rate-limit → loop-guard → pre-hook) and the
// jailed file tools, feeds the result back as %%TOOL_RESULT%%, and repeats until
// the model answers without a tool or the round/budget cap is hit. This is what
// gives API-provider agents REAL tool use (claude-cli runs its own loop, so it
// bypasses this) and is the substrate MCP tools will plug into.

const DEFAULT_MAX_ROUNDS = 12;
const resultBlock = s => `%%TOOL_RESULT%%\n${s}\n%%END_TOOL_RESULT%%`;

module.exports = function createAgentLoop({ ai, toolGate }) {

  async function run({ candidates, systemPrompt, messages, agentId, projectRoot, allowedTools, sessionId, sse, maxRounds = DEFAULT_MAX_ROUNDS }) {
    const { allowed } = filterAllowedTools(allowedTools || "");
    const allowSet = new Set(allowed.split(",").filter(Boolean));
    const sys = systemPrompt + tools.describe(allowSet);
    const convo = [...messages];
    const sid = sessionId || `loop_${Date.now()}`;

    for (let round = 0; round < maxRounds; round++) {
      const reply = await ai.callAIMessagesResilient(candidates, sys, convo, {});
      const call = orch.parseToolCall(reply);
      if (!call || call.invalid) return reply; // no (valid) tool request → final answer

      const feedback = (msg) => {
        convo.push({ role: "assistant", content: reply });
        convo.push({ role: "user", content: resultBlock(msg) });
      };

      if (!allowSet.has(call.name)) { feedback(`ERROR: tool '${call.name}' is not in your allowlist`); continue; }

      const decision = toolGate
        ? await toolGate.check({ agentId, tool: call.name, args: call.args, cwd: projectRoot, projectRoot, sessionId: sid })
        : { action: "allow", arguments: call.args };

      if (decision.action === "block") {
        feedback(`BLOCKED: ${decision.message}`);
        if (/budget/i.test(decision.message || "")) break; // loop budget exhausted
        continue;
      }

      const exec = tools.execute(call.name, decision.arguments || call.args, { root: projectRoot });
      log.info("agentloop", `${agentId} ${call.name} → ${exec.ok ? "ok" : "err"}`);
      if (sse) sse({ type: "tool", name: call.name, ok: exec.ok });
      feedback(exec.ok ? exec.result : `ERROR: ${exec.error}`);
    }

    // Round/budget cap reached — ask for a final answer without tools.
    return ai.callAIMessagesResilient(candidates, sys,
      [...convo, { role: "user", content: "Provide your final answer now without using any tool." }], {});
  }

  return { run };
};
