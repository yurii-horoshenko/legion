"use strict";

const path = require("path");
const log  = require("./log");

// Tool authorization gate. Ported in design from Sloppy's tool layer
// (ToolAuthorizationService + ToolPreHookService + CoreService+Tools enforcement
// order): authorize → pre-hook → loop-guard → invoke.
//
// Today Legion only executes tools through the claude-cli provider (which runs
// its own internal tool loop), so the immediately-active enforcement point is
// `filterAllowedTools` — it strips dangerous tools from the granted list before
// Legion spawns `claude --dangerously-skip-permissions`. The stateful gate
// (rate limit, loop guard, child-process pre-hook) is the infrastructure for
// when Legion executes tools itself, and is unit-tested standalone.

// Never auto-granted unless an explicit policy allows them.
const DEFAULT_DENY = new Set(["Bash", "BashOutput", "KillBash", "Shell", "Exec", "Execute", "Terminal", "Computer"]);

// Pure: filter a comma-separated allowlist against a deny set.
// Returns { allowed: "csv", removed: [...] }.
function filterAllowedTools(csv, denySet = DEFAULT_DENY) {
  const tools = (csv || "").split(",").map(s => s.trim()).filter(Boolean);
  const allowed = [], removed = [];
  for (const t of tools) (denySet.has(t) ? removed : allowed).push(t);
  return { allowed: allowed.join(","), removed };
}

// Sliding-window rate limiter (per key).
class RateLimiter {
  constructor(max = 60, windowMs = 60_000) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  allow(key) {
    const now = Date.now();
    const arr = (this.hits.get(key) || []).filter(t => now - t < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}

// Run an external pre-hook process with a JSON stdin/stdout contract.
// stdin:  { version, agentId, tool, arguments, workingDirectory }
// stdout: { action: "allow"|"block", arguments?, message? }
function runPreHook(hookPath, payload, { timeoutMs = 5000, maxOutput = 64 * 1024 } = {}) {
  return new Promise((resolve) => {
    const { spawn } = require("child_process");
    let child;
    try { child = spawn(hookPath, [], { shell: false }); }
    catch (e) { return resolve({ action: "allow", _error: `spawn failed: ${e.message}` }); }

    let out = "", err = "", killed = false, over = false;
    const timer = setTimeout(() => { killed = true; child.kill(); }, timeoutMs);
    child.stdout.on("data", c => { out += c; if (out.length > maxOutput) { over = true; child.kill(); } });
    child.stderr.on("data", c => { err += c; });
    child.on("error", e => { clearTimeout(timer); resolve({ action: "allow", _error: e.message }); });
    child.on("close", () => {
      clearTimeout(timer);
      if (killed) return resolve({ action: "allow", _error: "pre-hook timeout" });
      if (over)   return resolve({ action: "allow", _error: "pre-hook output too large" });
      try {
        const parsed = JSON.parse(out.trim() || "{}");
        resolve({ action: parsed.action === "block" ? "block" : "allow", arguments: parsed.arguments, message: parsed.message });
      } catch { resolve({ action: "allow", _error: `invalid pre-hook JSON: ${err.slice(0, 120)}` }); }
    });
    try { child.stdin.write(JSON.stringify(payload)); child.stdin.end(); } catch {}
  });
}

function createToolGate(opts = {}) {
  const denySet = opts.denySet || DEFAULT_DENY;
  const limiter = new RateLimiter(opts.maxToolCallsPerMinute || 60);
  const preHookPath = opts.preHookPath || null;
  const failPolicy = opts.preHookFailurePolicy === "block" ? "block" : "allow";
  const loopCounts = new Map();
  const maxRounds = opts.maxToolRounds || 50;

  // Loop guard: increment per-session round count. Returns { ok, count }.
  function loopGuard(sessionId) {
    const n = (loopCounts.get(sessionId) || 0) + 1;
    loopCounts.set(sessionId, n);
    return { ok: n <= maxRounds, count: n };
  }
  function resetLoop(sessionId) { loopCounts.delete(sessionId); }

  // Workspace-jail: resolve cwd, ensure it stays under projectRoot.
  function resolveCwd(cwd, projectRoot) {
    if (!projectRoot) return cwd || process.cwd();
    const resolved = path.resolve(projectRoot, cwd || ".");
    return resolved.startsWith(path.resolve(projectRoot)) ? resolved : null;
  }

  // Full 4-stage gate for a single tool call.
  async function check({ agentId, tool, args = {}, cwd, projectRoot, sessionId = "default" }) {
    // 1. authorize
    if (denySet.has(tool)) return { action: "block", message: `tool '${tool}' is denied by policy` };
    // 2. rate limit
    if (!limiter.allow(`${agentId}:${sessionId}`)) return { action: "block", message: "tool rate limit exceeded" };
    // 3. loop guard
    const lg = loopGuard(sessionId);
    if (!lg.ok) return { action: "block", message: `tool-round budget exceeded (${lg.count}/${maxRounds})` };
    // workspace jail
    const jailed = resolveCwd(cwd, projectRoot);
    if (jailed === null) return { action: "block", message: "working directory escapes project root" };
    // 4. pre-hook
    if (preHookPath) {
      const r = await runPreHook(preHookPath, { version: 1, agentId, tool, arguments: args, workingDirectory: jailed });
      if (r._error) {
        log.warn("toolgate", `pre-hook error (${failPolicy} policy) — ${r._error}`);
        if (failPolicy === "block") return { action: "block", message: `pre-hook failed: ${r._error}` };
      }
      if (r.action === "block") return { action: "block", message: r.message || "blocked by pre-hook" };
      return { action: "allow", arguments: r.arguments || args, cwd: jailed };
    }
    return { action: "allow", arguments: args, cwd: jailed };
  }

  return { check, loopGuard, resetLoop, filterAllowedTools: csv => filterAllowedTools(csv, denySet) };
}

module.exports = { filterAllowedTools, RateLimiter, runPreHook, createToolGate, DEFAULT_DENY };
