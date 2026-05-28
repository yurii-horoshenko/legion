"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createDB = require("../lib/db");
const createMemory = require("../lib/memory");

// Deterministic toy embedding: collision-free bag-of-words over a shared
// vocabulary (each distinct word gets its own dimension). Cosine then reflects
// exact word overlap — a clean, noise-free stand-in for a real model in tests.
const VOCAB = new Map();
const DIM = 512;
function toyEmbed(text) {
  const v = new Array(DIM).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) || []) {
    if (!VOCAB.has(w)) VOCAB.set(w, VOCAB.size % DIM);
    v[VOCAB.get(w)] += 1;
  }
  return v;
}

function freshDB() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legion-mem-"));
  return createDB(dir);
}

const stubAI = { embed: async (_provider, texts) => texts.map(toyEmbed) };
const stubIO = { readProviders: () => [{ id: "p1", type: "openai", key: "test" }] };

test("FTS5 keyword search is available (or LIKE fallback works)", () => {
  const db = freshDB();
  db.memInsert({ pid: "P", content: "deploy the backend service to production" });
  db.memInsert({ pid: "P", content: "the cat sat on the mat" });
  const hits = db.memKeywordSearch("P", "backend deploy", 10);
  assert.ok(hits.length >= 1);
  assert.ok(hits[0].score >= (hits[1]?.score ?? -Infinity));
});

test("store + recall returns the most relevant memory", async () => {
  const db = freshDB();
  const mem = createMemory({ db, ai: stubAI, io: stubIO });
  await mem.store("P", "a1", "User prefers TypeScript over JavaScript for new services");
  await mem.store("P", "a1", "The office coffee machine is broken again");
  await mem.store("P", "a1", "Deployment uses GitHub Actions and Docker");
  await mem.drainOutbox(100); // process deferred embeddings (outbox indexer)

  const hits = await mem.recall("P", "what language should new services use");
  assert.ok(hits.length >= 1);
  assert.match(hits[0].content, /TypeScript/);
});

test("recall degrades to keyword-only when embeddings unavailable", async () => {
  const db = freshDB();
  const noEmbedAI = { embed: async () => null };
  const mem = createMemory({ db, ai: noEmbedAI, io: { readProviders: () => [] } });
  await mem.store("P", "a1", "Postgres connection string lives in the vault");
  const hits = await mem.recall("P", "postgres vault connection");
  assert.ok(hits.length >= 1);
  assert.match(hits[0].content, /Postgres/);
});

test("graph-expand pulls in linked memories", async () => {
  const db = freshDB();
  const mem = createMemory({ db, ai: stubAI, io: stubIO });
  const a = await mem.store("P", "x", "Project Apollo kickoff scheduled");
  const b = await mem.store("P", "x", "zzzzz unrelated lexical tokens qqqqq");
  mem.link(a, b, "related", 1.0);
  await mem.drainOutbox(100);
  const hits = await mem.recall("P", "Apollo kickoff");
  assert.ok(hits.some(h => h.id === b), "linked memory surfaced via graph expansion");
});

test("memDecay lowers importance toward the floor", async () => {
  const db = freshDB();
  const mem = createMemory({ db, ai: stubAI, io: stubIO });
  const id = await mem.store("P", "a1", "important thing", { importance: 0.8 });
  db.memDecay(0.5, 0.1);
  const row = db.memList("P").find(m => m.id === id);
  assert.ok(Math.abs(row.importance - 0.4) < 1e-6, "0.8 * 0.5 = 0.4");
  db.memDecay(0.0, 0.1); // collapses toward floor
  assert.ok(db.memList("P").find(m => m.id === id).importance >= 0.1, "respects floor");
});

test("store enqueues to the outbox and the indexer drains it durably", async () => {
  const db = freshDB();
  const mem = createMemory({ db, ai: stubAI, io: stubIO });
  await mem.store("P", "a1", "embedding goes through the durable outbox");
  assert.equal(db.memOutboxCount(), 1, "embedding work was enqueued, not done inline");
  await mem.drainOutbox(100);
  assert.equal(db.memOutboxCount(), 0, "indexer drained the outbox");
  assert.equal(db.memEmbeddings("P").length, 1, "embedding was persisted");
});

test("no outbox entry is created when embeddings are unavailable", async () => {
  const db = freshDB();
  const mem = createMemory({ db, ai: { embed: async () => null }, io: { readProviders: () => [] } });
  await mem.store("P", "a1", "keyword-only memory");
  assert.equal(db.memOutboxCount(), 0);
});

test("expired memories are pruned and excluded from recall", async () => {
  const db = freshDB();
  const mem = createMemory({ db, ai: stubAI, io: stubIO });
  await mem.store("P", "x", "ephemeral event marker alpha", { kind: "event", expiresAt: Date.now() - 1000 });
  const pruned = mem.prune();
  assert.ok(pruned >= 1);
  const hits = await mem.recall("P", "ephemeral event marker alpha");
  assert.equal(hits.length, 0);
});
