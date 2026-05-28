"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const createHooks = require("../lib/hooks");

test("handlers run in priority order (high first)", async () => {
  const h = createHooks();
  const order = [];
  h.register("e", () => { order.push("low"); }, { priority: 100 });
  h.register("e", () => { order.push("high"); }, { priority: 900 });
  await h.emit("e");
  assert.deepEqual(order, ["high", "low"]);
});

test("abort short-circuits the chain", async () => {
  const h = createHooks();
  let ranSecond = false;
  h.register("e", () => ({ abort: true, message: "stop" }), { priority: 900 });
  h.register("e", () => { ranSecond = true; }, { priority: 100 });
  const r = await h.emit("e", { x: 1 });
  assert.equal(r.aborted, true);
  assert.equal(r.message, "stop");
  assert.equal(ranSecond, false, "lower-priority handler did not run after abort");
});

test("data passes forward and can be rewritten mid-chain", async () => {
  const h = createHooks();
  h.register("e", (data) => ({ data: { ...data, step1: true } }), { priority: 900 });
  h.register("e", (data) => {
    assert.equal(data.step1, true, "received rewritten data");
    return { data: { ...data, step2: true } };
  }, { priority: 100 });
  const r = await h.emit("e", { start: true });
  assert.deepEqual(r.data, { start: true, step1: true, step2: true });
});

test("a failing handler does not break the chain by default", async () => {
  const h = createHooks();
  let reached = false;
  h.register("e", () => { throw new Error("boom"); }, { priority: 900 });
  h.register("e", () => { reached = true; }, { priority: 100 });
  const r = await h.emit("e");
  assert.equal(r.aborted, false);
  assert.equal(reached, true);
});

test("emit on an event with no handlers is a no-op", async () => {
  const h = createHooks();
  const r = await h.emit("nobody", { a: 1 });
  assert.deepEqual(r, { aborted: false, data: { a: 1 } });
});
