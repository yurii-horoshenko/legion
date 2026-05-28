"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const dag = require("../lib/dag");

test("no dependencies → single parallel wave, hasDeps false", () => {
  const r = dag.validate([{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.equal(r.ok, true);
  assert.equal(r.hasDeps, false);
  assert.deepEqual(r.waves, [["a", "b", "c"]]);
});

test("linear chain orders into sequential waves", () => {
  const r = dag.validate([
    { id: "a" },
    { id: "b", dependencyIds: ["a"] },
    { id: "c", dependencyIds: ["b"] },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.hasDeps, true);
  assert.deepEqual(r.waves, [["a"], ["b"], ["c"]]);
});

test("diamond dependency layers correctly", () => {
  const r = dag.validate([
    { id: "a" },
    { id: "b", dependencyIds: ["a"] },
    { id: "c", dependencyIds: ["a"] },
    { id: "d", dependencyIds: ["b", "c"] },
  ]);
  assert.deepEqual(r.waves, [["a"], ["b", "c"], ["d"]]);
});

test("cycle is rejected", () => {
  const r = dag.validate([
    { id: "a", dependencyIds: ["c"] },
    { id: "b", dependencyIds: ["a"] },
    { id: "c", dependencyIds: ["b"] },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /cycle/.test(e)));
});

test("unknown and self dependencies are rejected", () => {
  assert.equal(dag.validate([{ id: "a", dependencyIds: ["ghost"] }]).ok, false);
  assert.equal(dag.validate([{ id: "a", dependencyIds: ["a"] }]).ok, false);
});

test("duplicate ids are rejected", () => {
  const r = dag.validate([{ id: "a" }, { id: "a" }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /duplicate/.test(e)));
});

test("depth beyond maxDepth is rejected", () => {
  const tasks = [{ id: "t0" }];
  for (let i = 1; i <= 8; i++) tasks.push({ id: `t${i}`, dependencyIds: [`t${i - 1}`] });
  assert.equal(dag.validate(tasks, { maxDepth: 6 }).ok, false);
});
