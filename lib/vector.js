"use strict";

// Vector similarity for semantic memory. Zero-dep.
//
// Design note: ruflo ships a from-scratch HNSW index (memory/src/hnsw-index.ts,
// ~1500 lines). HNSW buys sub-linear search and only pays off past ~10^5 vectors.
// Legion's per-project memory is orders of magnitude smaller, where exact
// brute-force cosine over Float32 vectors is both faster (no graph overhead) and
// far simpler to keep correct. The API below is index-shaped, so an ANN backend
// can be slotted in later without touching callers.

function norm(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  return Math.sqrt(s) || 1;
}

// Return a normalized copy (so dot product == cosine similarity).
function normalize(vec) {
  const f = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  const n = norm(f);
  const out = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = f[i] / n;
  return out;
}

// Cosine similarity of two raw vectors (handles non-normalized input).
function cosine(a, b) {
  const len = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Top-k nearest by cosine. `items` = [{ id, vec }]. Returns [{ id, score }] desc.
function topK(queryVec, items, k = 10, minScore = 0) {
  const out = [];
  for (const it of items) {
    const score = cosine(queryVec, it.vec);
    if (score >= minScore) out.push({ id: it.id, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, k);
}

// Min-max normalize a [{ id, score }] list into 0..1 (higher = better).
// Lets heterogeneous signals (bm25, cosine, hit-count) be merged comparably.
function minMaxNormalize(scored) {
  if (!scored.length) return new Map();
  let lo = Infinity, hi = -Infinity;
  for (const s of scored) { if (s.score < lo) lo = s.score; if (s.score > hi) hi = s.score; }
  const span = hi - lo;
  const m = new Map();
  for (const s of scored) m.set(s.id, span > 0 ? (s.score - lo) / span : 1);
  return m;
}

module.exports = { normalize, cosine, topK, minMaxNormalize };
