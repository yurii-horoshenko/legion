"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { filterAllowedTools, RateLimiter, createToolGate } = require("../lib/toolgate");

test("filterAllowedTools strips dangerous tools, keeps safe ones", () => {
  const { allowed, removed } = filterAllowedTools("Read,Write,Bash,Grep,Shell");
  assert.equal(allowed, "Read,Write,Grep");
  assert.deepEqual(removed.sort(), ["Bash", "Shell"]);
});

test("RateLimiter blocks past the limit within the window", () => {
  const rl = new RateLimiter(2, 60_000);
  assert.equal(rl.allow("k"), true);
  assert.equal(rl.allow("k"), true);
  assert.equal(rl.allow("k"), false);
  assert.equal(rl.allow("other"), true, "different key has its own budget");
});

test("gate blocks denied tools and allows safe ones", async () => {
  const gate = createToolGate({ maxToolCallsPerMinute: 100 });
  assert.equal((await gate.check({ agentId: "a", tool: "Bash" })).action, "block");
  assert.equal((await gate.check({ agentId: "a", tool: "Read" })).action, "allow");
});

test("gate enforces loop-round budget", async () => {
  const gate = createToolGate({ maxToolRounds: 2, maxToolCallsPerMinute: 100 });
  assert.equal((await gate.check({ agentId: "a", tool: "Read", sessionId: "s" })).action, "allow");
  assert.equal((await gate.check({ agentId: "a", tool: "Read", sessionId: "s" })).action, "allow");
  const third = await gate.check({ agentId: "a", tool: "Read", sessionId: "s" });
  assert.equal(third.action, "block");
  assert.match(third.message, /budget/);
});

test("gate blocks cwd that escapes the project root", async () => {
  const gate = createToolGate({ maxToolCallsPerMinute: 100 });
  const r = await gate.check({ agentId: "a", tool: "Read", cwd: "../../etc", projectRoot: "/home/proj" });
  assert.equal(r.action, "block");
});

test("pre-hook child process can veto a tool call", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-"));
  const hook = path.join(dir, "hook.sh");
  fs.writeFileSync(hook, '#!/bin/sh\ncat >/dev/null\necho \'{"action":"block","message":"vetoed"}\'\n');
  fs.chmodSync(hook, 0o755);
  const gate = createToolGate({ preHookPath: hook, maxToolCallsPerMinute: 100 });
  const r = await gate.check({ agentId: "a", tool: "Read", args: { path: "x" } });
  assert.equal(r.action, "block");
  assert.equal(r.message, "vetoed");
});

test("pre-hook can rewrite tool arguments", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-"));
  const hook = path.join(dir, "hook.sh");
  fs.writeFileSync(hook, '#!/bin/sh\ncat >/dev/null\necho \'{"action":"allow","arguments":{"path":"/safe"}}\'\n');
  fs.chmodSync(hook, 0o755);
  const gate = createToolGate({ preHookPath: hook, maxToolCallsPerMinute: 100 });
  const r = await gate.check({ agentId: "a", tool: "Read", args: { path: "/danger" } });
  assert.equal(r.action, "allow");
  assert.deepEqual(r.arguments, { path: "/safe" });
});
