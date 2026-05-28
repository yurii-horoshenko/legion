"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const cron = require("../lib/cron");

// Helper: build a Date with given fields (month is 1-12 here).
const at = (min, hr, dom, mon, year = 2026, ) => new Date(year, mon - 1, dom, hr, min);

test("isValid accepts valid expressions and rejects bad ones", () => {
  assert.ok(cron.isValid("* * * * *"));
  assert.ok(cron.isValid("*/15 9-17 * * 1-5"));
  assert.ok(!cron.isValid("* * * *"));      // 4 fields
  assert.ok(!cron.isValid("bad cron here !"));
});

test("every-minute wildcard matches any time", () => {
  assert.ok(cron.matches("* * * * *", at(37, 13, 10, 6)));
});

test("specific minute/hour matches only then", () => {
  assert.ok(cron.matches("30 9 * * *", at(30, 9, 1, 1)));
  assert.ok(!cron.matches("30 9 * * *", at(31, 9, 1, 1)));
  assert.ok(!cron.matches("30 9 * * *", at(30, 10, 1, 1)));
});

test("step values */15 match quarter hours", () => {
  assert.ok(cron.matches("*/15 * * * *", at(0, 8, 1, 1)));
  assert.ok(cron.matches("*/15 * * * *", at(45, 8, 1, 1)));
  assert.ok(!cron.matches("*/15 * * * *", at(20, 8, 1, 1)));
});

test("day-of-week ranges (1-5 = Mon-Fri)", () => {
  // 2026-06-08 is a Monday, 2026-06-13 is a Saturday.
  assert.ok(cron.matches("0 9 * * 1-5", at(0, 9, 8, 6)));
  assert.ok(!cron.matches("0 9 * * 1-5", at(0, 9, 13, 6)));
});

test("dom and dow both restricted → OR semantics", () => {
  // Fire on the 1st OR on Sundays. 2026-06-07 is a Sunday.
  assert.ok(cron.matches("0 0 1 * 0", at(0, 0, 1, 6)));   // 1st
  assert.ok(cron.matches("0 0 1 * 0", at(0, 0, 7, 6)));   // Sunday
  assert.ok(!cron.matches("0 0 1 * 0", at(0, 0, 9, 6)));  // neither
});
