"use strict";

// Circuit breaker + retry/backoff. Zero-dep, node stdlib only.
// Ported in spirit from ruflo providers/src/base-provider.ts (circuit breaker)
// and integration/provider-adapter.ts (backoff). Keyed per-host so one flaky
// provider trips its own breaker without affecting the others.

const log = require("./log");

const DEFAULTS = {
  failureThreshold: 5,    // consecutive failed calls before opening
  resetTimeoutMs:   30_000, // how long to stay open before a half-open probe
  halfOpenMax:      1,    // probes allowed while half-open
};

class CircuitBreaker {
  constructor(key, opts = {}) {
    this.key   = key;
    this.cfg   = { ...DEFAULTS, ...opts };
    this.state = "closed"; // closed | open | half-open
    this.failures = 0;
    this.nextTry  = 0;
    this.halfOpen = 0;
  }

  // Returns true if a call may proceed; mutates state for half-open probes.
  tryAcquire() {
    const now = Date.now();
    if (this.state === "open") {
      if (now < this.nextTry) return false;
      this.state = "half-open";
      this.halfOpen = 0;
    }
    if (this.state === "half-open") {
      if (this.halfOpen >= this.cfg.halfOpenMax) return false;
      this.halfOpen++;
    }
    return true;
  }

  onSuccess() {
    this.failures = 0;
    if (this.state !== "closed") {
      log.info("breaker", `${this.key} → closed`);
      this.state = "closed";
    }
  }

  onFailure() {
    this.failures++;
    if (this.state === "half-open" || this.failures >= this.cfg.failureThreshold) {
      this.state   = "open";
      this.nextTry = Date.now() + this.cfg.resetTimeoutMs;
      log.warn("breaker", `${this.key} → open for ${this.cfg.resetTimeoutMs}ms (failures=${this.failures})`);
    }
  }

  snapshot() {
    return { key: this.key, state: this.state, failures: this.failures, nextTry: this.nextTry };
  }
}

const registry = new Map();
function getBreaker(key, opts) {
  let b = registry.get(key);
  if (!b) { b = new CircuitBreaker(key, opts); registry.set(key, b); }
  return b;
}
function breakerStates() {
  return [...registry.values()].map(b => b.snapshot());
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Exponential backoff with full jitter, capped.
function backoffDelay(attempt, baseMs, maxMs) {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

// Run attemptFn with retry + circuit-breaker protection.
//   key         — breaker bucket (usually a hostname)
//   attemptFn   — async () => result; should throw on failure
//   isRetryable — (err) => bool; default: err.retryable === true
// retryAfterMs on the error (e.g. from a Retry-After header) overrides backoff.
async function withResilience(key, attemptFn, opts = {}) {
  const {
    retries = 3,
    baseDelayMs = 400,
    maxDelayMs = 8_000,
    isRetryable = (e) => e && e.retryable === true,
    breakerOpts,
  } = opts;

  const breaker = getBreaker(key, breakerOpts);
  if (!breaker.tryAcquire()) {
    const err = new Error(`circuit open for ${key}`);
    err.circuitOpen = true;
    throw err;
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await attemptFn();
      breaker.onSuccess();
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) {
        breaker.onFailure();
        throw err;
      }
      const wait = Number.isFinite(err.retryAfterMs)
        ? Math.min(maxDelayMs, err.retryAfterMs)
        : backoffDelay(attempt, baseDelayMs, maxDelayMs);
      log.warn("breaker", `${key} retry ${attempt + 1}/${retries} in ${wait}ms — ${err.message}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

module.exports = { CircuitBreaker, getBreaker, breakerStates, withResilience, backoffDelay };
