"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { cosine, normalize, topK, minMaxNormalize } = require("../lib/vector");

test("cosine of identical vectors is 1, orthogonal is 0", () => {
  assert.ok(Math.abs(cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9);
});

test("cosine handles zero vectors without NaN", () => {
  assert.equal(cosine([0, 0], [1, 1]), 0);
});

test("normalize yields unit length", () => {
  const n = normalize([3, 4]);
  assert.ok(Math.abs(Math.hypot(n[0], n[1]) - 1) < 1e-6);
});

test("topK returns highest-similarity items in order", () => {
  const items = [
    { id: "a", vec: [1, 0] },
    { id: "b", vec: [0.9, 0.1] },
    { id: "c", vec: [0, 1] },
  ];
  const res = topK([1, 0], items, 2);
  assert.deepEqual(res.map(r => r.id), ["a", "b"]);
});

test("minMaxNormalize maps to 0..1 and collapses constant scores to 1", () => {
  const m = minMaxNormalize([{ id: "a", score: 2 }, { id: "b", score: 4 }, { id: "c", score: 6 }]);
  assert.equal(m.get("a"), 0);
  assert.equal(m.get("c"), 1);
  const m2 = minMaxNormalize([{ id: "x", score: 5 }, { id: "y", score: 5 }]);
  assert.equal(m2.get("x"), 1);
});
