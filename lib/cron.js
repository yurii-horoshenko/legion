"use strict";

// Minimal 5-field cron matcher (min hour day-of-month month day-of-week).
// Supports *, */n, a-b, a,b, a-b/n. Zero-dep — no cron library needed.
// DOW: 0 and 7 both mean Sunday. Standard semantics: when BOTH day-of-month and
// day-of-week are restricted, a match on EITHER fires.

function parseField(field, min, max) {
  const out = new Set();
  for (const part of String(field).split(",")) {
    let step = 1, range = part;
    const slash = part.split("/");
    if (slash.length === 2) { step = parseInt(slash[1], 10); range = slash[0]; }
    if (!Number.isFinite(step) || step < 1) return null;
    let lo, hi;
    if (range === "*") { lo = min; hi = max; }
    else if (range.includes("-")) { const [a, b] = range.split("-").map(Number); lo = a; hi = b; }
    else { lo = hi = parseInt(range, 10); }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    for (let v = lo; v <= hi; v += step) if (v >= min && v <= max) out.add(v);
  }
  return out;
}

function isValid(expr) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const specs = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  return fields.every((f, i) => parseField(f, specs[i][0], specs[i][1]) !== null);
}

function matches(expr, date = new Date()) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minF, hrF, domF, monF, dowF] = fields;
  const M  = parseField(minF, 0, 59);
  const H  = parseField(hrF, 0, 23);
  const D  = parseField(domF, 1, 31);
  const Mo = parseField(monF, 1, 12);
  const Dw = parseField(dowF, 0, 7);
  if (!M || !H || !D || !Mo || !Dw) return false;
  if (Dw.has(7)) Dw.add(0); // 7 == Sunday

  const dow = date.getDay(); // 0..6
  const domRestricted = domF !== "*";
  const dowRestricted = dowF !== "*";
  const dayOk = (domRestricted && dowRestricted)
    ? (D.has(date.getDate()) || Dw.has(dow))
    : (D.has(date.getDate()) && Dw.has(dow));

  return M.has(date.getMinutes()) && H.has(date.getHours()) && Mo.has(date.getMonth() + 1) && dayOk;
}

module.exports = { matches, isValid, parseField };
