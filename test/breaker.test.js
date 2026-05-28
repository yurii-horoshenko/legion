"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { CircuitBreaker, withResilience } = require("../lib/breaker");

test("breaker opens after threshold consecutive failures", () => {
  const b = new CircuitBreaker("t", { failureThreshold: 3, resetTimeoutMs: 1000 });
  assert.equal(b.tryAcquire(), true);
  b.onFailure(); b.onFailure(); b.onFailure();
  assert.equal(b.state, "open");
  assert.equal(b.tryAcquire(), false, "open breaker rejects requests");
});

test("breaker recovers via half-open probe success", async () => {
  const b = new CircuitBreaker("t", { failureThreshold: 1, resetTimeoutMs: 10 });
  b.onFailure();
  assert.equal(b.state, "open");
  await new Promise(r => setTimeout(r, 20));
  assert.equal(b.tryAcquire(), true, "after reset timeout, half-open probe allowed");
  assert.equal(b.state, "half-open");
  b.onSuccess();
  assert.equal(b.state, "closed");
});

test("withResilience retries retryable errors then succeeds", async () => {
  let calls = 0;
  const result = await withResilience("retry-key", async () => {
    calls++;
    if (calls < 3) { const e = new Error("flaky"); e.retryable = true; throw e; }
    return "ok";
  }, { retries: 5, baseDelayMs: 1 });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withResilience does not retry non-retryable errors", async () => {
  let calls = 0;
  await assert.rejects(
    withResilience("noretry-key", async () => { calls++; throw new Error("fatal"); }, { retries: 5, baseDelayMs: 1 }),
    /fatal/
  );
  assert.equal(calls, 1, "non-retryable error fails immediately");
});

test("withResilience fails fast when circuit already open", async () => {
  const key = "open-key";
  // Trip the breaker: 5 non-retryable failures (default threshold).
  for (let i = 0; i < 5; i++) {
    await assert.rejects(withResilience(key, async () => { throw new Error("boom"); }, { retries: 0 }));
  }
  await assert.rejects(
    withResilience(key, async () => "never", {}),
    /circuit open/
  );
});
