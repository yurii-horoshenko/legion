"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const stats = require("../lib/stats");

function tmpProject() {
  return { id: "P", path: fs.mkdtempSync(path.join(os.tmpdir(), "stats-")) };
}

test("recordSuccess increments counters and writes STATS.md + stats.json", () => {
  const p = tmpProject();
  stats.recordSuccess(p, "a1");
  stats.recordSuccess(p, "a1");
  const d = stats.load(p, "a1");
  assert.equal(d.attempted, 2);
  assert.equal(d.succeeded, 2);
  assert.ok(fs.existsSync(stats.jsonPath(p, "a1")));
  const md = fs.readFileSync(stats.mdPath(p, "a1"), "utf8");
  assert.match(md, /tasks_attempted: 2/);
  assert.match(md, /Succeeded: 2/);
});

test("recordFailure dedupes by pattern and counts occurrences", () => {
  const p = tmpProject();
  stats.recordFailure(p, "a1", "DTO leak: internal field exposed");
  stats.recordFailure(p, "a1", "DTO leak: internal field exposed");
  stats.recordFailure(p, "a1", "Timeout calling provider");
  const d = stats.load(p, "a1");
  assert.equal(d.attempted, 3);
  assert.equal(d.failures.length, 2, "two distinct patterns");
  const dto = d.failures.find(f => f.pattern.startsWith("dto-leak"));
  assert.equal(dto.count, 2, "duplicate pattern incremented");
});

test("patternSlug is stable and bounded", () => {
  assert.equal(stats.patternSlug("DTO leak: internal field exposed!!!"), "dto-leak-internal-field-exposed");
  assert.equal(stats.patternSlug(""), "unknown");
});

test("STATS.md lists failure modes with counts", () => {
  const p = tmpProject();
  stats.recordFailure(p, "a1", "UTC Kind mismatch on save");
  const md = fs.readFileSync(stats.mdPath(p, "a1"), "utf8");
  assert.match(md, /Failure modes/);
  assert.match(md, /utc-kind-mismatch-on-save/);
});

test("no path → safe no-op", () => {
  assert.doesNotThrow(() => stats.recordSuccess({}, "a1"));
  assert.doesNotThrow(() => stats.recordFailure({}, "a1", "x"));
});
