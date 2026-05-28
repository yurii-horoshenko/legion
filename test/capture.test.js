"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const capture = require("../lib/capture");

test("isImplementationRun detects implementation intent", () => {
  assert.ok(capture.isImplementationRun("implement the login flow"));
  assert.ok(capture.isImplementationRun("реализуй фичу импорта"));
  assert.ok(capture.isImplementationRun("fix the crash on startup"));
  assert.ok(!capture.isImplementationRun("what is the project status?"));
});

test("isImplementationRun detects via dev agent participation", () => {
  assert.ok(capture.isImplementationRun("do the thing", [{ agentName: "Backend Developer" }]));
  assert.ok(!capture.isImplementationRun("do the thing", [{ agentName: "Content Strategist" }]));
});

test("slug produces filesystem-safe slugs", () => {
  assert.equal(capture.slug("Implement the Login Flow!"), "implement-the-login-flow");
  assert.equal(capture.slug(""), "task");
});

test("reviewAndDocument runs both passes and never throws", async () => {
  const ai = {
    callAIMessagesResilient: async (c, sys) => sys.includes("reviewer") ? "REVIEW" : "DOCS",
  };
  const r = await capture.reviewAndDocument({ ai, candidates: [{}], message: "m", finalReply: "code" });
  assert.equal(r.review, "REVIEW");
  assert.equal(r.docs, "DOCS");
});

test("reviewAndDocument degrades gracefully on AI failure", async () => {
  const ai = { callAIMessagesResilient: async () => { throw new Error("down"); } };
  const r = await capture.reviewAndDocument({ ai, candidates: [{}], message: "m", finalReply: "x" });
  assert.match(r.review, /skipped/);
  assert.match(r.docs, /skipped/);
});

test("findRoleAgent locates reviewer and writer agents", () => {
  const agents = [
    { id: "pm", name: "Product Manager", role: "plans" },
    { id: "rev", name: "Code Reviewer", role: "reviews code" },
    { id: "tw", name: "Technical Writer", role: "docs" },
  ];
  assert.equal(capture.findRoleAgent(agents, "review").id, "rev");
  assert.equal(capture.findRoleAgent(agents, "docs").id, "tw");
  assert.equal(capture.findRoleAgent([{ id: "pm", name: "PM" }], "review"), null);
});

test("reviewAndDocument delegates to a catalog agent via runner when present", async () => {
  const ai = { callAIMessagesResilient: async () => "BUILT-IN" };
  const runner = { run: async (pid, agent) => `BY-${agent.id}` };
  const reviewerAgent = { id: "rev", name: "Code Reviewer" };
  const r = await capture.reviewAndDocument({ ai, candidates: [{}], message: "m", finalReply: "code", runner, pid: "P", reviewerAgent });
  assert.equal(r.review, "BY-rev", "review went through the reviewer agent");
  assert.equal(r.reviewedBy, "Code Reviewer");
  assert.equal(r.docs, "BUILT-IN", "no writer agent → built-in prompt");
  assert.equal(r.documentedBy, "built-in");
});

test("writeSessionNote archives the run to .legion/sessions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-"));
  const file = capture.writeSessionNote({ path: dir }, {
    message: "implement X", finalReply: "done", review: "looks good", docs: "- added X",
  });
  assert.ok(file && fs.existsSync(file));
  const body = fs.readFileSync(file, "utf8");
  assert.match(body, /## Request/);
  assert.match(body, /## Code review/);
  assert.match(body, /## Docs \/ changelog/);
});

test("writeSessionNote returns null without a project path", () => {
  assert.equal(capture.writeSessionNote({}, { message: "x" }), null);
});
