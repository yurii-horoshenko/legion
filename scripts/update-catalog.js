#!/usr/bin/env node
"use strict";

/**
 * update-catalog.js — rerunnable importer of external agent definitions
 * into Legion's catalog (core/agents/catalog/<group>/imported-<slug>.md).
 *
 * Sources (priority order, first-wins on name collision):
 *   1. anthropics/claude-plugins-official     (GitHub tarball, plugins/<x>/agents/*.md)
 *   2. wshobson/agents                       (GitHub tarball, plugins/<x>/agents/*.md)
 *   3. VoltAgent/awesome-claude-code-subagents (GitHub tarball, categories/<x>/*.md)
 *   4. davila7/claude-code-templates          (docs/components.json, agents[] inline)
 *
 * Zero-dependency: Node stdlib + global fetch; shells out to `tar` only.
 * Idempotent: deletes all imported-*.md before re-importing.
 *
 * Usage: node scripts/update-catalog.js
 */

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT        = path.resolve(__dirname, "..");
const CATALOG_DIR = path.join(ROOT, "core", "agents", "catalog");

const MIN_DESC_LEN = 40;
const MIN_BODY_LEN = 200;
const MAX_DESC_LEN = 200;
const MAX_VIBE_LEN = 90;

const GROUP_EMOJI = {
  academic: "🎓", design: "🎨", engineering: "⚙️", finance: "💰",
  "game-development": "🎮", marketing: "📣", "paid-media": "📈",
  product: "📦", "project-management": "🗂️", sales: "🤝",
  "spatial-computing": "🥽", specialized: "🤖", support: "🛟", testing: "🧪",
};

// Ordered rules: first token match wins. Categories are tokenized on non-alphanumerics.
const GROUP_RULES = [
  ["testing",            ["test", "testing", "tdd", "qa", "quality"]],
  ["game-development",   ["game", "games", "unity", "unreal", "minecraft", "gamedev"]],
  ["design",             ["design", "ui", "ux", "accessibility", "accessibilit", "brand", "figma"]],
  ["product",            ["product"]],
  ["finance",            ["finance", "financial", "fintech", "payment", "payments", "quantitative", "trading", "banking", "accounting"]],
  ["sales",              ["sales", "crm"]],
  ["support",            ["support", "customer"]],
  ["marketing",          ["marketing", "business", "seo", "social", "growth", "advertising", "copywriting", "podcast", "startup"]],
  ["academic",           ["academic", "research", "education"]],
  ["project-management", ["project", "scrum", "agile", "kanban"]],
  ["engineering",        [
    "engineering", "engineer", "development", "developer", "dev", "code", "codebase", "coding",
    "backend", "frontend", "fullstack", "full", "api", "graphql", "rest", "web", "mobile",
    "data", "ai", "ml", "llm", "machine", "nlp", "devops", "infrastructure", "cloud", "kubernetes",
    "docker", "cicd", "ci", "cd", "deployment", "observability", "monitoring", "incident",
    "security", "compliance", "database", "db", "sql", "migrations", "migration", "modernization",
    "language", "languages", "programming", "python", "javascript", "typescript", "java", "jvm",
    "julia", "dotnet", "golang", "rust", "php", "ruby", "shell", "scripting", "systems",
    "blockchain", "web3", "crypto", "git", "debugging", "debug", "error", "refactoring",
    "documentation", "docs", "architecture", "architect", "scaffolding", "dependency",
    "performance", "realtime", "mcp", "orchestration", "microcontrollers", "embedded",
    "firmware", "functional", "reverse", "platform", "tools", "tooling", "electron",
  ]],
];

// ---------------------------------------------------------------- helpers ---

function normName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const ACRONYMS = {
  ai: "AI", ml: "ML", api: "API", apis: "APIs", ui: "UI", ux: "UX", qa: "QA",
  seo: "SEO", sql: "SQL", css: "CSS", html: "HTML", ios: "iOS", llm: "LLM",
  mcp: "MCP", cli: "CLI", devops: "DevOps", graphql: "GraphQL", db: "DB",
  javascript: "JavaScript", typescript: "TypeScript", php: "PHP", aws: "AWS",
  gcp: "GCP", tdd: "TDD", cicd: "CI/CD", sre: "SRE", nlp: "NLP", hr: "HR",
  crm: "CRM", etl: "ETL", grpc: "gRPC", wcag: "WCAG", c4: "C4", dx: "DX",
  arm: "ARM", jvm: "JVM", dotnet: ".NET", ffmpeg: "FFmpeg", ocr: "OCR",
};

function titleCase(slug) {
  return slug.split("-").filter(Boolean)
    .map(w => ACRONYMS[w] || (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function colorFromName(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return hslToHex(h % 360, 62, 52);
}

function oneLine(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp  = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, "") + "…";
}

function makeVibe(description) {
  let s = oneLine(description)
    .replace(/^use\s+this\s+agent\s+(proactively\s+)?(when|for|to|if)\s+/i, "")
    .replace(/^use\s+(when|for|to)\s+/i, "");
  s = s.charAt(0).toUpperCase() + s.slice(1);
  const dot = s.indexOf(". ");
  if (dot > 20) s = s.slice(0, dot + 1);
  return truncate(s, MAX_VIBE_LEN);
}

// Minimal YAML frontmatter parser: single-line values + |/> block scalars.
function parseFrontmatter(text) {
  const m = String(text).match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { fm: {}, body: String(text).trim() };
  const fm    = {};
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line)) continue;            // continuation handled by block scan
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val   = line.slice(idx + 1).trim();
    if (val === "|" || val === ">" || val === "|-" || val === ">-") {
      const block = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === "")) {
        block.push(lines[++i].trim());
      }
      val = block.join(" ").trim();
    }
    fm[key] = val.replace(/^['"]|['"]$/g, "");
  }
  return { fm, body: String(text).slice(m[0].length).trim() };
}

function mapGroup(category) {
  const tokens = new Set(String(category).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  for (const [group, keywords] of GROUP_RULES) {
    if (keywords.some(k => tokens.has(k))) return group;
  }
  return "specialized";
}

// ----------------------------------------------------------------- fetch ----

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": "legion-catalog-updater" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchTarball(repo, destDir) {
  const buf = await fetchBuffer(`https://codeload.github.com/${repo}/tar.gz/HEAD`);
  const tgz = path.join(destDir, "src.tgz");
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(tgz, buf);
  execFileSync("tar", ["xzf", tgz, "-C", destDir, "--strip-components=1"]);
  fs.unlinkSync(tgz);
}

// --------------------------------------------------------------- sources ----
// Each loader returns [{ name, description, body, category }]

// Anthropic's official plugin marketplace hosts agent definitions in-repo
// under plugins/<plugin>/agents/*.md (same layout as wshobson/agents).
async function loadAnthropicOfficial(tmpRoot) {
  const dir = path.join(tmpRoot, "anthropic-official");
  await fetchTarball("anthropics/claude-plugins-official", dir);
  const out = [];
  const pluginsDir = path.join(dir, "plugins");
  if (!fs.existsSync(pluginsDir)) return out;
  for (const plugin of fs.readdirSync(pluginsDir).sort()) {
    const agentsDir = path.join(pluginsDir, plugin, "agents");
    if (!fs.existsSync(agentsDir) || !fs.statSync(agentsDir).isDirectory()) continue;
    for (const file of fs.readdirSync(agentsDir).filter(f => f.endsWith(".md")).sort()) {
      const { fm, body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, file), "utf8"));
      out.push({
        name:        titleCase(slugify(fm.name || file.replace(/\.md$/, ""))),
        description: fm.description || "",
        body,
        category:    plugin,
      });
    }
  }
  return out;
}

async function loadWshobson(tmpRoot) {
  const dir = path.join(tmpRoot, "wshobson");
  await fetchTarball("wshobson/agents", dir);
  const out = [];
  const pluginsDir = path.join(dir, "plugins");
  for (const plugin of fs.readdirSync(pluginsDir).sort()) {
    const agentsDir = path.join(pluginsDir, plugin, "agents");
    if (!fs.existsSync(agentsDir) || !fs.statSync(agentsDir).isDirectory()) continue;
    for (const file of fs.readdirSync(agentsDir).filter(f => f.endsWith(".md")).sort()) {
      const { fm, body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, file), "utf8"));
      // fm.name is plugin-prefixed (e.g. backend-api-security-backend-architect) — use the filename.
      out.push({
        name:        titleCase(file.replace(/\.md$/, "")),
        description: fm.description || "",
        body,
        category:    plugin,
      });
    }
  }
  return out;
}

async function loadVoltAgent(tmpRoot) {
  const dir = path.join(tmpRoot, "voltagent");
  await fetchTarball("VoltAgent/awesome-claude-code-subagents", dir);
  const out = [];
  const catDir = path.join(dir, "categories");
  for (const cat of fs.readdirSync(catDir).sort()) {
    const sub = path.join(catDir, cat);
    if (!fs.statSync(sub).isDirectory()) continue;
    const category = cat.replace(/^\d+-/, "");
    for (const file of fs.readdirSync(sub).sort()) {
      if (!file.endsWith(".md") || file.toLowerCase() === "readme.md") continue;
      const { fm, body } = parseFrontmatter(fs.readFileSync(path.join(sub, file), "utf8"));
      out.push({
        name:        titleCase(slugify(fm.name || file.replace(/\.md$/, ""))),
        description: fm.description || "",
        body,
        category,
      });
    }
  }
  return out;
}

async function loadDavila7() {
  const buf  = await fetchBuffer("https://raw.githubusercontent.com/davila7/claude-code-templates/main/docs/components.json");
  const json = JSON.parse(buf.toString("utf8"));
  const out  = [];
  for (const item of json.agents || []) {
    const { fm, body } = parseFrontmatter(item.content || "");
    out.push({
      name:        titleCase(slugify(item.name || fm.name || "")),
      description: fm.description || item.description || "",
      body,
      category:    item.category || "",
    });
  }
  return out;
}

// ------------------------------------------------------------------ main ----

function collectExistingNames() {
  const names = new Set();
  for (const group of fs.readdirSync(CATALOG_DIR)) {
    const groupDir = path.join(CATALOG_DIR, group);
    if (!fs.statSync(groupDir).isDirectory()) continue;
    for (const file of fs.readdirSync(groupDir)) {
      if (!file.endsWith(".md") || file.startsWith("imported-")) continue;
      const full = path.join(groupDir, file);
      if (!fs.statSync(full).isFile()) continue;
      const { fm } = parseFrontmatter(fs.readFileSync(full, "utf8"));
      if (fm.name) names.add(normName(fm.name));
      names.add(normName(file.replace(/\.md$/, "")));
    }
  }
  return names;
}

function deleteImported() {
  let n = 0;
  for (const group of fs.readdirSync(CATALOG_DIR)) {
    const groupDir = path.join(CATALOG_DIR, group);
    if (!fs.statSync(groupDir).isDirectory()) continue;
    for (const file of fs.readdirSync(groupDir)) {
      if (file.startsWith("imported-") && file.endsWith(".md")) {
        fs.unlinkSync(path.join(groupDir, file));
        n++;
      }
    }
  }
  return n;
}

function writeAgent(agent, group) {
  const slug  = slugify(agent.name);
  const desc  = truncate(oneLine(agent.description), MAX_DESC_LEN);
  const emoji = GROUP_EMOJI[group] || "🤖";
  const color = colorFromName(agent.name);
  const vibe  = makeVibe(agent.description);
  const text = [
    "---",
    `name: ${agent.name}`,
    `description: ${desc}`,
    `color: "${color}"`,
    `emoji: ${emoji}`,
    `vibe: ${vibe}`,
    "---",
    "",
    agent.body.trim(),
    "",
  ].join("\n");
  const groupDir = path.join(CATALOG_DIR, group);
  fs.mkdirSync(groupDir, { recursive: true });
  fs.writeFileSync(path.join(groupDir, `imported-${slug}.md`), text);
}

async function main() {
  if (!fs.existsSync(CATALOG_DIR)) {
    console.error(`Catalog dir not found: ${CATALOG_DIR}`);
    process.exit(1);
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "legion-catalog-"));
  const removed = deleteImported();
  console.log(`Removed ${removed} previously imported file(s).`);

  const seen = collectExistingNames();
  console.log(`Existing (non-imported) catalog names: ${seen.size}`);

  const sources = [
    { label: "anthropics/claude-plugins-official",   load: () => loadAnthropicOfficial(tmpRoot) },
    { label: "wshobson/agents",                      load: () => loadWshobson(tmpRoot) },
    { label: "VoltAgent/awesome-claude-code-subagents", load: () => loadVoltAgent(tmpRoot) },
    { label: "davila7/claude-code-templates",        load: () => loadDavila7() },
  ];

  const groupCounts = {};
  const report      = [];

  for (const source of sources) {
    let agents;
    try {
      agents = await source.load();
    } catch (err) {
      console.error(`FAILED to load ${source.label}: ${err.message}`);
      report.push({ label: source.label, fetched: 0, imported: 0, dupe: 0, quality: 0, failed: true });
      continue;
    }
    const stat = { label: source.label, fetched: agents.length, imported: 0, dupe: 0, quality: 0 };
    for (const agent of agents) {
      if (!agent.name) { stat.quality++; continue; }
      const desc = oneLine(agent.description);
      const body = (agent.body || "").trim();
      if (desc.length < MIN_DESC_LEN || body.length < MIN_BODY_LEN) { stat.quality++; continue; }
      const key = normName(agent.name);
      if (seen.has(key)) { stat.dupe++; continue; }
      seen.add(key);
      const group = mapGroup(agent.category);
      writeAgent({ ...agent, description: desc, body }, group);
      groupCounts[group] = (groupCounts[group] || 0) + 1;
      stat.imported++;
    }
    report.push(stat);
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  // ---- report ----
  console.log("\n=== Import report ===");
  for (const r of report) {
    if (r.failed) { console.log(`${r.label}: FAILED`); continue; }
    console.log(`${r.label}: fetched ${r.fetched}, imported ${r.imported}, skipped-dupe ${r.dupe}, skipped-quality ${r.quality}`);
  }
  console.log("\nImported per group:");
  for (const g of Object.keys(groupCounts).sort()) {
    console.log(`  ${g}: ${groupCounts[g]}`);
  }
  let total = 0;
  for (const group of fs.readdirSync(CATALOG_DIR)) {
    const groupDir = path.join(CATALOG_DIR, group);
    if (!fs.statSync(groupDir).isDirectory()) continue;
    total += fs.readdirSync(groupDir).filter(f => f.endsWith(".md") && fs.statSync(path.join(groupDir, f)).isFile()).length;
  }
  console.log(`\nTotal catalog files (top-level, excl. locales): ${total}`);
}

main().catch(err => { console.error(err); process.exit(1); });
