"use strict";

const fs   = require("fs");
const path = require("path");
const log  = require("./log");

// Agent STATS — the observation layer of ADR-0005 ("Agent STATS & retrospective
// loop"). Records per-agent task attempts/successes and deduped failure modes so
// an agent's weaknesses become visible over time. Source of truth is a machine
// `stats.json`; a human-readable `STATS.md` (per the ADR template) is rendered
// from it. We NEVER auto-rewrite the agent's persona files — observation only.

function agentDir(project, agentId) {
  return path.join(project.path, ".legion", "agents", agentId);
}
const jsonPath = (p, id) => path.join(agentDir(p, id), "stats.json");
const mdPath   = (p, id) => path.join(agentDir(p, id), "STATS.md");

function blank(agentId) {
  const now = new Date().toISOString();
  return { agent: agentId, created: now, last_updated: now,
    attempted: 0, succeeded: 0, rework: 0, blocked: 0, failures: [] };
}

function load(project, agentId) {
  try {
    const raw = fs.readFileSync(jsonPath(project, agentId), "utf8");
    return { ...blank(agentId), ...JSON.parse(raw) };
  } catch { return blank(agentId); }
}

// Short, stable pattern slug from an error/description — used to dedupe failures.
function patternSlug(text) {
  return (text || "unknown").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(Boolean).slice(0, 6).join("-")
    .slice(0, 60) || "unknown";
}

function renderMd(d) {
  const lines = [
    "---", `agent: ${d.agent}`, `created: ${d.created}`, `last_updated: ${d.last_updated}`,
    `tasks_attempted: ${d.attempted}`, `tasks_succeeded: ${d.succeeded}`, "---", "",
    `# STATS — ${d.agent}`, "",
    "## Counters",
    `- Tasks attempted: ${d.attempted}`,
    `- Succeeded: ${d.succeeded}`,
    `- Needed rework: ${d.rework}`,
    `- Blocked: ${d.blocked}`, "",
    "## Failure modes (most recent first, deduped by pattern)",
  ];
  if (!d.failures.length) lines.push("- _no failures recorded yet_");
  else for (const f of d.failures) lines.push(`- **${f.date.slice(0, 10)}** \`${f.pattern}\` ×${f.count} — ${f.description}`);
  lines.push("");
  return lines.join("\n");
}

function save(project, agentId, d) {
  if (!project?.path) return;
  try {
    const dir = agentDir(project, agentId);
    fs.mkdirSync(dir, { recursive: true });
    d.last_updated = new Date().toISOString();
    fs.writeFileSync(jsonPath(project, agentId), JSON.stringify(d, null, 2));
    fs.writeFileSync(mdPath(project, agentId), renderMd(d));
  } catch (e) { log.warn("stats", `save failed for ${agentId} — ${e.message}`); }
}

function recordSuccess(project, agentId) {
  if (!project?.path) return;
  const d = load(project, agentId);
  d.attempted++; d.succeeded++;
  save(project, agentId, d);
}

// Record a failure, deduped by pattern (increments count + bumps date if seen).
function recordFailure(project, agentId, errorText, sessionRef) {
  if (!project?.path) return;
  const d = load(project, agentId);
  d.attempted++;
  const pattern = patternSlug(errorText);
  const now = new Date().toISOString();
  const existing = d.failures.find(f => f.pattern === pattern);
  if (existing) { existing.count++; existing.date = now; if (sessionRef) existing.session = sessionRef; }
  else d.failures.unshift({ date: now, pattern, description: (errorText || "").slice(0, 160), count: 1, session: sessionRef });
  d.failures = d.failures.slice(0, 20); // keep most recent 20 patterns
  save(project, agentId, d);
}

module.exports = { load, recordSuccess, recordFailure, patternSlug, renderMd, jsonPath, mdPath };
