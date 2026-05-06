"use strict";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[process.env.LEGION_LOG] ?? LEVELS.info;

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

function emit(lvl, tag, msg) {
  if ((LEVELS[lvl] ?? 0) < minLevel) return;
  const line = `${ts()} [${lvl.toUpperCase().padEnd(5)}] [${tag}] ${msg}`;
  (lvl === "error" || lvl === "warn" ? console.error : console.log)(line);
}

// Returns a function that returns elapsed time as "Xms"
function timer() {
  const start = Date.now();
  return () => `${Date.now() - start}ms`;
}

module.exports = {
  debug: (tag, msg) => emit("debug", tag, msg),
  info:  (tag, msg) => emit("info",  tag, msg),
  warn:  (tag, msg) => emit("warn",  tag, msg),
  error: (tag, msg) => emit("error", tag, msg),
  timer,
};
