"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const createScheduler = require("../lib/scheduler");
const createRunner = require("../lib/runner");

// Minimal fakes for io/db wired to a single project+agent+cron job.
function fakes(job) {
  const events = [];
  return {
    events,
    io: {
      readProjects: () => [{ id: "P", path: "/tmp/p" }],
      readPAgents: () => ({ P: [{ id: "a1", name: "Agent", model: "gpt" }] }),
      readModels: () => [{ id: "m1", modelId: "gpt", providerId: "pr1" }],
      readProviders: () => [{ id: "pr1", type: "openai", key: "x" }],
      readConfig: () => ({ defaultModelId: "gpt" }),
    },
    db: {
      storeGet: (pid, aid, store) => store === "cron" ? [job] : [],
      log: (type, pid, aid, data) => events.push({ type, data }),
    },
  };
}

test("scheduler fires a matching enabled job exactly once per minute", async () => {
  const job = { id: "j1", schedule: "* * * * *", command: "do the thing", enabled: true };
  const f = fakes(job);
  let runCount = 0;
  const runner = { run: async () => { runCount++; return "done"; } };
  const sched = createScheduler({ io: f.io, db: f.db, runner });

  const now = new Date();
  assert.equal(sched.tick(now), 1, "one job fired");
  assert.equal(sched.tick(now), 0, "same minute → not fired again (dedup)");
  await new Promise(r => setTimeout(r, 10));
  assert.equal(runCount, 1);
});

test("disabled jobs and non-matching schedules do not fire", () => {
  const f1 = fakes({ id: "j", schedule: "* * * * *", command: "x", enabled: false });
  assert.equal(createScheduler({ io: f1.io, db: f1.db, runner: { run: async () => {} } }).tick(new Date()), 0);

  const f2 = fakes({ id: "j", schedule: "0 0 1 1 *", command: "x", enabled: true });
  // pick a time that is definitely not Jan 1 00:00
  assert.equal(createScheduler({ io: f2.io, db: f2.db, runner: { run: async () => {} } }).tick(new Date(2026, 5, 10, 13, 30)), 0);
});

test("runner executes a headless turn via failover", async () => {
  const io = {
    readModels: () => [{ id: "m1", modelId: "gpt", providerId: "pr1" }],
    readProviders: () => [{ id: "pr1", type: "openai", key: "x" }],
    readConfig: () => ({ defaultModelId: "gpt" }),
  };
  const ai = {
    langDirective: () => "",
    buildFailoverCandidates: (primary) => [primary],
    callAIMessagesResilient: async (cands, system, msgs) => `echo:${msgs[0].content}`,
  };
  const runner = createRunner({ io, ai, db: null, memory: null });
  const reply = await runner.run("P", { id: "a1", name: "Agent", model: "gpt" }, "ping");
  assert.equal(reply, "echo:ping");
});
