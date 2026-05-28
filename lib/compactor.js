"use strict";

const log = require("./log");

// Context compactor. Ported in design from Sloppy's Compactor.swift + Visor:
//  - fires only when context utilization crosses a threshold (soft/aggressive/
//    emergency), summarizing older turns instead of blindly dropping them;
//  - per-key single-drain (one compaction at a time per conversation);
//  - FNV-1a hash gate so identical inputs aren't re-summarized;
//  - backoff retry around the (injected) summarize function.
//
// The summarize function is injected so this module stays provider-agnostic and
// unit-testable. Callers pass `summarize: async (olderMessages) => string`.

const THRESHOLDS = { soft: 0.80, aggressive: 0.85, emergency: 0.95 };
// How many recent messages to keep verbatim at each level.
const KEEP = { none: Infinity, soft: 16, aggressive: 10, emergency: 6 };

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = function createCompactor() {
  // key → { chain: Promise, lastHash, lastSummary }
  const state = new Map();

  // ~4 chars/token is the standard rough estimate; good enough for thresholds.
  const estimateTokens = text => Math.ceil((text || "").length / 4);
  const estimateMessagesTokens = msgs => msgs.reduce((n, m) => n + estimateTokens(m.content), 0);
  const utilization = (msgs, budgetTokens) => estimateMessagesTokens(msgs) / Math.max(1, budgetTokens);

  function level(util) {
    if (util >= THRESHOLDS.emergency) return "emergency";
    if (util >= THRESHOLDS.aggressive) return "aggressive";
    if (util >= THRESHOLDS.soft) return "soft";
    return "none";
  }

  async function withBackoff(fn, { retries = 2, baseMs = 300 } = {}) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try { return await fn(); }
      catch (e) { lastErr = e; if (i < retries) await sleep(baseMs * 2 ** i); }
    }
    throw lastErr;
  }

  // Returns:
  //   { compacted: false, messages }                     — below threshold / failed (degrade)
  //   { compacted: true, summary, messages: recent[], level, skipped? }
  async function maybeCompact(key, messages, opts = {}) {
    const { budgetTokens = 8000, summarize } = opts;
    const lvl = level(utilization(messages, budgetTokens));
    if (lvl === "none" || typeof summarize !== "function") return { compacted: false, messages };

    const keep = KEEP[lvl];
    if (messages.length <= keep) return { compacted: false, messages };

    const older  = messages.slice(0, messages.length - keep);
    const recent = messages.slice(messages.length - keep);
    if (!older.length) return { compacted: false, messages };

    const st = state.get(key) || { chain: Promise.resolve(), lastHash: null, lastSummary: null };
    state.set(key, st);

    // Single-drain: serialize compactions for this key.
    const run = st.chain.then(async () => {
      const hash = fnv1a(older.map(m => `${m.role}:${m.content}`).join("\n"));
      if (hash === st.lastHash && st.lastSummary) {
        log.info("compactor", `${key} hash unchanged — reusing summary`);
        return { compacted: true, summary: st.lastSummary, messages: recent, level: lvl, skipped: true };
      }
      try {
        const summary = await withBackoff(() => summarize(older));
        if (!summary || !summary.trim()) throw new Error("empty summary");
        st.lastHash = hash;
        st.lastSummary = summary.trim();
        log.info("compactor", `${key} compacted ${older.length} msgs → summary (level=${lvl})`);
        return { compacted: true, summary: st.lastSummary, messages: recent, level: lvl };
      } catch (err) {
        log.warn("compactor", `${key} compaction failed, keeping raw tail — ${err.message}`);
        return { compacted: false, messages };
      }
    });
    st.chain = run.catch(() => {}); // keep the chain alive on failure
    return run;
  }

  return { maybeCompact, estimateTokens, estimateMessagesTokens, utilization, level, fnv1a };
};
