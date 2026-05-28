"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createAgentLoop = require("../lib/agentloop");
const { createToolGate } = require("../lib/toolgate");

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-"));
  fs.writeFileSync(path.join(root, "README.md"), "# Project\nThe answer is 42.");
  return root;
}

// A scripted model: first turn requests a tool, second turn answers using the result.
function scriptedAI(steps) {
  let i = 0;
  return {
    callAIMessagesResilient: async (_c, _sys, convo) => {
      const step = steps[Math.min(i, steps.length - 1)];
      i++;
      return typeof step === "function" ? step(convo) : step;
    },
  };
}

test("agent loop executes a requested tool and feeds the result back", async () => {
  const root = tmpRoot();
  const ai = scriptedAI([
    '%%TOOL%%{"name":"Read","args":{"path":"README.md"}}%%END_TOOL%%',
    (convo) => {
      const last = convo[convo.length - 1].content;
      assert.match(last, /The answer is 42/, "tool result fed back into conversation");
      return "Final: the answer is 42.";
    },
  ]);
  const loop = createAgentLoop({ ai, toolGate: createToolGate({ maxToolCallsPerMinute: 100 }) });
  const reply = await loop.run({
    candidates: [{}], systemPrompt: "You are a helper.", messages: [{ role: "user", content: "what is the answer?" }],
    agentId: "a1", projectRoot: root, allowedTools: "Read,LS,Grep",
  });
  assert.equal(reply, "Final: the answer is 42.");
});

test("tools outside the allowlist are refused, loop continues", async () => {
  const root = tmpRoot();
  const ai = scriptedAI([
    '%%TOOL%%{"name":"Write","args":{"path":"x","content":"y"}}%%END_TOOL%%',
    (convo) => {
      assert.match(convo[convo.length - 1].content, /not in your allowlist/);
      return "ok, done without writing";
    },
  ]);
  const loop = createAgentLoop({ ai, toolGate: createToolGate({ maxToolCallsPerMinute: 100 }) });
  const reply = await loop.run({
    candidates: [{}], systemPrompt: "s", messages: [{ role: "user", content: "do" }],
    agentId: "a1", projectRoot: root, allowedTools: "Read", // Write not granted
  });
  assert.equal(reply, "ok, done without writing");
  assert.ok(!fs.existsSync(path.join(root, "x")), "nothing was written");
});

test("a plain answer (no tool block) returns immediately", async () => {
  const ai = scriptedAI(["Just answering directly."]);
  const loop = createAgentLoop({ ai, toolGate: createToolGate({}) });
  const reply = await loop.run({
    candidates: [{}], systemPrompt: "s", messages: [{ role: "user", content: "hi" }],
    agentId: "a1", projectRoot: tmpRoot(), allowedTools: "Read",
  });
  assert.equal(reply, "Just answering directly.");
});

test("round cap forces a final answer", async () => {
  const root = tmpRoot();
  // Always requests a tool → loop should cap and force a final answer.
  const ai = scriptedAI(['%%TOOL%%{"name":"LS","args":{"path":"."}}%%END_TOOL%%']);
  // override last step: when asked for final answer, return distinct text
  let calls = 0;
  ai.callAIMessagesResilient = async (_c, _sys, convo) => {
    calls++;
    if (convo[convo.length - 1].content.includes("final answer")) return "FORCED FINAL";
    return '%%TOOL%%{"name":"LS","args":{"path":"."}}%%END_TOOL%%';
  };
  const loop = createAgentLoop({ ai, toolGate: createToolGate({ maxToolCallsPerMinute: 1000, maxToolRounds: 1000 }) });
  const reply = await loop.run({
    candidates: [{}], systemPrompt: "s", messages: [{ role: "user", content: "go" }],
    agentId: "a1", projectRoot: root, allowedTools: "LS", maxRounds: 3,
  });
  assert.equal(reply, "FORCED FINAL");
});
