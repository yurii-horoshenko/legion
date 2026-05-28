"use strict";

const fs   = require("fs");
const path = require("path");

// Built-in file tools that Legion can ACTUALLY execute (not just describe in a
// prompt). Every path is workspace-jailed to the project root, so an agent
// cannot read/write outside the project it is working on. Executors return a
// short human-readable string that is fed back into the model loop.

const MAX_READ   = 12_000;   // chars returned from a single Read
const MAX_HITS   = 200;      // cap for Glob/Grep results
const MAX_WALK   = 5_000;    // cap files walked

class ToolError extends Error {}

// Resolve `p` under `root`; throw if it escapes the jail.
function jail(root, p) {
  if (!root) throw new ToolError("no project root configured");
  const abs = path.resolve(root, p || ".");
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new ToolError(`path escapes project root: ${p}`);
  return abs;
}

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (".+^${}()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}

function* walk(dir, root, depth = 0) {
  if (depth > 25) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full, root, depth + 1);
    else yield path.relative(root, full);
  }
}

const TOOLS = {
  Read({ path: p }, { root }) {
    const abs = jail(root, p);
    const data = fs.readFileSync(abs, "utf8");
    return data.length > MAX_READ ? data.slice(0, MAX_READ) + `\n…(truncated, ${data.length} chars total)` : data;
  },
  Write({ path: p, content }, { root }) {
    const abs = jail(root, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content ?? "", "utf8");
    return `Wrote ${Buffer.byteLength(content ?? "")} bytes to ${p}`;
  },
  Edit({ path: p, old, new: nw }, { root }) {
    const abs = jail(root, p);
    const data = fs.readFileSync(abs, "utf8");
    if (old == null || !data.includes(old)) throw new ToolError(`'old' text not found in ${p}`);
    fs.writeFileSync(abs, data.replace(old, nw ?? ""), "utf8");
    return `Edited ${p}`;
  },
  LS({ path: p }, { root }) {
    const abs = jail(root, p || ".");
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .map(e => e.isDirectory() ? e.name + "/" : e.name).sort();
    return entries.length ? entries.join("\n") : "(empty)";
  },
  Glob({ pattern }, { root }) {
    if (!pattern) throw new ToolError("pattern required");
    const re = globToRegExp(pattern);
    const out = [];
    let n = 0;
    for (const rel of walk(root, root)) {
      if (++n > MAX_WALK) break;
      if (re.test(rel) || re.test(path.basename(rel))) out.push(rel);
      if (out.length >= MAX_HITS) break;
    }
    return out.length ? out.join("\n") : "(no matches)";
  },
  Grep({ pattern, path: p }, { root }) {
    if (!pattern) throw new ToolError("pattern required");
    let re;
    try { re = new RegExp(pattern, "i"); } catch (e) { throw new ToolError(`bad regex: ${e.message}`); }
    const base = p ? jail(root, p) : root;
    const out = [];
    let n = 0;
    const files = fs.statSync(base).isDirectory() ? [...walk(base, root)] : [path.relative(root, base)];
    for (const rel of files) {
      if (++n > MAX_WALK || out.length >= MAX_HITS) break;
      let data;
      try { data = fs.readFileSync(path.resolve(root, rel), "utf8"); } catch { continue; }
      data.split("\n").forEach((line, i) => {
        if (out.length < MAX_HITS && re.test(line)) out.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`);
      });
    }
    return out.length ? out.join("\n") : "(no matches)";
  },
};

const READONLY = new Set(["Read", "LS", "Glob", "Grep"]);

// Execute a tool by name. Returns { ok, result } | { ok:false, error }.
function execute(name, args = {}, ctx = {}) {
  const fn = TOOLS[name];
  if (!fn) return { ok: false, error: `unknown tool: ${name}` };
  try { return { ok: true, result: fn(args, ctx) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// Human-readable tool docs + the %%TOOL%% protocol, injected into the system prompt.
function describe(allowed) {
  const names = [...(allowed || Object.keys(TOOLS))].filter(n => TOOLS[n]);
  if (!names.length) return "";
  const sigs = {
    Read: 'Read {"path":"rel/file"}', Write: 'Write {"path":"rel/file","content":"..."}',
    Edit: 'Edit {"path":"rel/file","old":"...","new":"..."}', LS: 'LS {"path":"."}',
    Glob: 'Glob {"pattern":"**/*.js"}', Grep: 'Grep {"pattern":"regex","path":"."}',
  };
  return `\n\n## Tools you can actually run\n` +
    `Available: ${names.join(", ")} (paths are relative to the project root; you cannot escape it).\n` +
    `To use a tool, reply with ONLY this block and nothing else:\n` +
    `%%TOOL%%{"name":"Read","args":{"path":"README.md"}}%%END_TOOL%%\n` +
    `Signatures: ${names.map(n => sigs[n]).join("; ")}.\n` +
    `You will receive the result in a %%TOOL_RESULT%% block, then continue. When done, reply normally without a tool block.`;
}

module.exports = { execute, describe, TOOLS, READONLY, jail, globToRegExp };
