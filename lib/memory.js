"use strict";

const vector = require("./vector");
const log    = require("./log");

// Hybrid semantic memory. Ported in design from Sloppy's HybridMemoryStore
// (Memory/HybridMemoryStore.swift): canonical SQLite rows, recall fuses keyword
// (FTS5 bm25) + vector cosine via weighted max-merge, then graph-expands seeds
// one hop along memory_edges. Embeddings are best-effort — recall degrades to
// keyword-only when no embedding provider is configured.

const DEFAULTS = {
  limit:        8,
  candidateK:   20,
  semanticW:    1.0,
  keywordW:     0.7,
  graphW:       0.5,   // applied to one-hop neighbours, scaled by edge weight
  minSemantic:  0.2,   // cosine floor for semantic candidates
};

// Per-kind default lifetimes (ms). null = never expire. Mirrors Sloppy's
// resolveExpiry-on-write so transient events don't accumulate forever.
const KIND_TTL = {
  note:     null,
  fact:     null,
  decision: null,
  goal:     null,
  event:    1000 * 60 * 60 * 24 * 30, // 30 days
};

module.exports = function createMemory({ db, ai, io }) {

  // Choose a provider that can produce embeddings. Preference: explicit flag →
  // OpenAI → Google → Ollama (local). Returns { provider, embedModel } or null.
  function pickEmbedProvider() {
    const providers = io.readProviders();
    const flagged = providers.find(p => p.embedModel && ["openai", "ollama", "google"].includes(p.type));
    if (flagged) return { provider: flagged, embedModel: flagged.embedModel };
    const openai = providers.find(p => p.type === "openai" && p.key);
    if (openai) return { provider: openai, embedModel: openai.embedModel || "text-embedding-3-small" };
    const google = providers.find(p => p.type === "google" && p.key);
    if (google) return { provider: google, embedModel: google.embedModel || "text-embedding-004" };
    const ollama = providers.find(p => p.type === "ollama");
    if (ollama) return { provider: ollama, embedModel: ollama.embedModel || "nomic-embed-text" };
    return null;
  }

  async function embedText(text) {
    const choice = pickEmbedProvider();
    if (!choice) return null;
    const vecs = await ai.embed(choice.provider, [text], { embedModel: choice.embedModel });
    return vecs && vecs[0] ? Float32Array.from(vecs[0]) : null;
  }

  function resolveExpiry(kind, explicit) {
    if (explicit != null) return explicit;
    const ttl = KIND_TTL[kind];
    return ttl == null ? null : Date.now() + ttl;
  }

  // Persist a memory. The canonical row + a pending-embedding outbox entry
  // commit together; the background indexer does the (best-effort) embedding,
  // so store never blocks on the embedding provider and nothing is lost on crash.
  async function store(pid, aid, content, opts = {}) {
    if (!pid || !content?.trim()) return null;
    const kind = opts.kind || "note";
    return db.memInsert({
      pid, aid, content: content.trim(),
      kind, class: opts.class,
      importance: opts.importance, confidence: opts.confidence,
      expiresAt: resolveExpiry(kind, opts.expiresAt),
    }, { enqueueEmbed: embeddingsAvailable() });
  }

  // ── Outbox indexer (durable embeddings + crash recovery) ───────────────────
  let timer = null, draining = false;

  async function drainOutbox(batch = 10) {
    if (draining) return;
    draining = true;
    try {
      const rows = db.memOutboxPending(batch, Date.now());
      for (const row of rows) {
        try {
          const vec = await embedText(row.content);
          if (vec) { db.memSetEmbedding(row.memory_id, vec); db.memOutboxDone(row.memory_id); }
          else { db.memOutboxFail(row.memory_id, "no embedding provider", Date.now() + 60_000); }
        } catch (err) {
          const backoff = Math.min(10 * 60_000, 30_000 * 2 ** (row.attempts || 0));
          db.memOutboxFail(row.memory_id, err.message, Date.now() + backoff);
        }
      }
    } finally { draining = false; }
  }

  function startIndexer({ intervalMs = 2000 } = {}) {
    if (timer) return;
    const pending = db.memOutboxCount();
    if (pending) log.info("memory", `outbox indexer started — ${pending} pending embedding(s) to recover`);
    timer = setInterval(() => { drainOutbox().catch(() => {}); }, intervalMs);
    if (timer.unref) timer.unref();
  }
  function stopIndexer() { if (timer) { clearInterval(timer); timer = null; } }

  // ── Maintenance daemon: importance decay + expiry prune ────────────────────
  // (ruflo consolidator + Sloppy Visor decay/prune in spirit). Keeps memory
  // from growing unbounded and lets unreinforced entries fade in ranking.
  let maint = null;
  function runMaintenance() {
    try {
      const pruned = db.memPruneExpired();
      db.memDecay();
      if (pruned) log.info("memory", `maintenance: pruned ${pruned} expired memory(ies)`);
    } catch (e) { log.warn("memory", `maintenance failed — ${e.message}`); }
  }
  function startMaintenance({ intervalMs = 3600_000 } = {}) {
    if (maint) return;
    runMaintenance(); // run once on boot
    maint = setInterval(runMaintenance, intervalMs);
    if (maint.unref) maint.unref();
  }
  function stopMaintenance() { if (maint) { clearInterval(maint); maint = null; } }

  // Hybrid recall → [{ id, content, kind, score, importance, source }] desc.
  async function recall(pid, query, opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };
    if (!pid || !query?.trim()) return [];
    const started = Date.now();

    // Signal 1 — keyword (FTS5 bm25 or LIKE fallback).
    const kwNorm = vector.minMaxNormalize(db.memKeywordSearch(pid, query, cfg.candidateK));

    // Signal 2 — semantic cosine (best-effort).
    let semNorm = new Map();
    const qvec = await embedText(query);
    if (qvec) {
      const items = db.memEmbeddings(pid);
      if (items.length) {
        const top = vector.topK(qvec, items, cfg.candidateK, cfg.minSemantic);
        semNorm = vector.minMaxNormalize(top);
      }
    }

    // Weighted max-merge of the two signals.
    const merged = new Map();
    const bump = (id, s) => { if (s > (merged.get(id) || 0)) merged.set(id, s); };
    for (const [id, s] of kwNorm) bump(id, cfg.keywordW * s);
    for (const [id, s] of semNorm) bump(id, cfg.semanticW * s);

    // Graph-expand: one hop from current seeds, decayed by graphW * edge weight.
    const seedIds = [...merged.keys()];
    for (const e of db.memEdgesFrom(seedIds)) {
      const seedScore = merged.get(e.src) || 0;
      bump(e.dst, cfg.graphW * (e.weight ?? 1) * seedScore);
    }

    if (!merged.size) return [];

    // Hydrate + filter expiry + final rank.
    const now = Date.now();
    const rows = db.memHydrate([...merged.keys()]);
    const out = [];
    for (const [id, score] of merged) {
      const r = rows.get(id);
      if (!r) continue;
      if (r.expires_at && r.expires_at < now) continue;
      out.push({
        id, content: r.content, kind: r.kind,
        importance: r.importance, score,
        source: semNorm.has(id) ? "semantic" : "keyword",
      });
    }
    out.sort((a, b) => b.score - a.score || b.importance - a.importance);
    const result = out.slice(0, cfg.limit);
    try { db.memRecallLog({ pid, query, latencyMs: Date.now() - started, resultIds: result.map(r => r.id) }); } catch {}
    return result;
  }

  // Format recalled memories as a system-prompt block (or "" when empty).
  async function buildContextBlock(pid, query, opts = {}) {
    const hits = await recall(pid, query, opts);
    if (!hits.length) return "";
    const lines = hits.map(h => `- (${h.kind}) ${h.content.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
    return `\n\n## Relevant memory\nRetrieved from past context — use if relevant, ignore otherwise:\n${lines}`;
  }

  function link(srcId, dstId, rel, weight) { db.memAddEdge(srcId, dstId, rel, weight); }
  function prune() { return db.memPruneExpired(); }
  function embeddingsAvailable() { return !!pickEmbedProvider(); }

  return { store, recall, buildContextBlock, link, prune, embeddingsAvailable, startIndexer, stopIndexer, drainOutbox, startMaintenance, stopMaintenance, runMaintenance };
};
