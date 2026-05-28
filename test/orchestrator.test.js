"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const orch = require("../lib/orchestrator");

test("parseDelegate extracts tasks", () => {
  const r = orch.parseDelegate('intro <DELEGATE>{"tasks":[{"id":"t1","agentId":"a","task":"do"}]}</DELEGATE> tail');
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].agentId, "a");
  assert.ok(!r.invalid);
});

test("parseDelegate returns null when no block", () => {
  assert.equal(orch.parseDelegate("just a normal reply"), null);
});

test("parseDelegate flags invalid JSON", () => {
  const r = orch.parseDelegate("<DELEGATE>{not json}</DELEGATE>");
  assert.equal(r.invalid, true);
  assert.deepEqual(r.tasks, []);
});

test("stripDelegate removes the block", () => {
  assert.equal(orch.stripDelegate("a <DELEGATE>{}</DELEGATE> b"), "a  b".trim());
});

test("parseLinearBlock parses UPDATES and cleans the reply", () => {
  const reply = 'Done.\n%%LINEAR_UPDATES%%[{"issueId":"VIS-1","stateName":"Done"}]%%END_LINEAR_UPDATES%%';
  const r = orch.parseLinearBlock(reply, "UPDATES");
  assert.equal(r.found, true);
  assert.equal(r.items[0].issueId, "VIS-1");
  assert.equal(r.cleanedReply, "Done.");
});

test("parseLinearBlock flags invalid JSON but still cleans", () => {
  const reply = "x %%LINEAR_CREATE%%[broken%%END_LINEAR_CREATE%%";
  const r = orch.parseLinearBlock(reply, "CREATE");
  assert.equal(r.found, true);
  assert.equal(r.invalid, true);
  assert.equal(r.cleanedReply, "x");
});

test("parseLinearBlock returns found:false when absent", () => {
  const r = orch.parseLinearBlock("nothing here", "UPDATES");
  assert.equal(r.found, false);
  assert.equal(r.cleanedReply, "nothing here");
});

test("parseToolCall extracts a tool request", () => {
  const r = orch.parseToolCall('thinking… %%TOOL%%{"name":"Read","args":{"path":"a.txt"}}%%END_TOOL%%');
  assert.equal(r.name, "Read");
  assert.deepEqual(r.args, { path: "a.txt" });
});

test("parseToolCall returns null without a block, invalid on bad JSON", () => {
  assert.equal(orch.parseToolCall("plain answer"), null);
  assert.equal(orch.parseToolCall("%%TOOL%%{bad}%%END_TOOL%%").invalid, true);
});
