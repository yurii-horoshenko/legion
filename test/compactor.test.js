"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const createCompactor = require("../lib/compactor");

const bigMsg = n => ({ role: n % 2 ? "assistant" : "user", content: "x".repeat(400) }); // ~100 tokens each
const makeMessages = count => Array.from({ length: count }, (_, i) => bigMsg(i));

test("level thresholds classify utilization", () => {
  const c = createCompactor();
  assert.equal(c.level(0.5), "none");
  assert.equal(c.level(0.81), "soft");
  assert.equal(c.level(0.86), "aggressive");
  assert.equal(c.level(0.99), "emergency");
});

test("maybeCompact is a no-op below threshold", async () => {
  const c = createCompactor();
  const msgs = makeMessages(4); // ~400 tokens vs 8000 budget
  const r = await c.maybeCompact("k1", msgs, { budgetTokens: 8000, summarize: async () => "S" });
  assert.equal(r.compacted, false);
  assert.equal(r.messages.length, 4);
});

test("maybeCompact summarizes older messages over threshold", async () => {
  const c = createCompactor();
  const msgs = makeMessages(60); // ~6000 tokens vs 6000 budget → util ~1.0
  let summarizedCount = 0;
  const r = await c.maybeCompact("k2", msgs, {
    budgetTokens: 6000,
    summarize: async (older) => { summarizedCount = older.length; return "SUMMARY"; },
  });
  assert.equal(r.compacted, true);
  assert.equal(r.summary, "SUMMARY");
  assert.ok(summarizedCount > 0, "older messages were summarized");
  assert.ok(r.messages.length < 60, "recent tail kept verbatim");
});

test("hash gate reuses summary for identical input", async () => {
  const c = createCompactor();
  const msgs = makeMessages(60);
  let calls = 0;
  const opts = { budgetTokens: 6000, summarize: async () => { calls++; return "S"; } };
  await c.maybeCompact("k3", msgs, opts);
  const r2 = await c.maybeCompact("k3", msgs, opts);
  assert.equal(calls, 1, "second identical compaction reused cached summary");
  assert.equal(r2.skipped, true);
});

test("compaction failure degrades to raw messages", async () => {
  const c = createCompactor();
  const msgs = makeMessages(60);
  const r = await c.maybeCompact("k4", msgs, {
    budgetTokens: 6000,
    summarize: async () => { throw new Error("LLM down"); },
  });
  assert.equal(r.compacted, false);
  assert.equal(r.messages.length, 60, "falls back to full message list");
});
