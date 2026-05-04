#!/usr/bin/env node

const http   = require("http");
const https  = require("https");
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");

// ── Catalog builder ────────────────────────────────────────────────────────

const GROUP_COLORS = {
  academic: "#8B5CF6", design: "#EC4899", engineering: "#0EA5E9",
  finance: "#10B981", "game-development": "#F97316", marketing: "#EF4444",
  "paid-media": "#F59E0B", product: "#6366F1", "project-management": "#14B8A6",
  sales: "#84CC16", "spatial-computing": "#A78BFA", specialized: "#64748B",
  strategy: "#F43F5E", support: "#22D3EE", testing: "#FB923C",
};

function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return fm;
}

function extractCapabilities(text, description) {
  const missionMatch = text.match(/##[^#].*?Mission[\s\S]*?\n([\s\S]*?)(?=\n##[^#]|$)/i);
  if (missionMatch) {
    const caps = [...missionMatch[1].matchAll(/^###\s+(.+)/gm)]
      .map(m => m[1].trim()).filter(c => c.length < 60).slice(0, 5);
    if (caps.length) return caps;
  }
  return description ? description.split(/[,;]/).map(s => s.trim()).filter(Boolean).slice(0, 5) : [];
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function readLocale(groupDir, file, lang) {
  const p = path.join(groupDir, lang, file);
  if (!fs.existsSync(p)) return null;
  return parseFrontmatter(fs.readFileSync(p, "utf8"));
}

function buildCatalog(webRoot) {
  // Look for catalog next to the package, then fall back to cwd
  let catalogDir = path.resolve(webRoot, "../../core/agents/catalog");
  if (!fs.existsSync(catalogDir)) {
    catalogDir = path.resolve(process.cwd(), "core/agents/catalog");
  }
  const outFile = path.join(webRoot, "data", "agents-catalog.json");
  if (!fs.existsSync(catalogDir)) {
    console.log("  Catalog: core/agents/catalog not found — skipping");
    return;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const agents = [];
  for (const group of fs.readdirSync(catalogDir).sort()) {
    const groupDir = path.join(catalogDir, group);
    if (!fs.statSync(groupDir).isDirectory()) continue;
    const color = GROUP_COLORS[group] || "#94A3B8";
    for (const file of fs.readdirSync(groupDir).filter(f => f.endsWith(".md")).sort()) {
      const text = fs.readFileSync(path.join(groupDir, file), "utf8");
      const fm   = parseFrontmatter(text);
      if (!fm.name) continue;

      const en = readLocale(groupDir, file, "en") || fm;
      const ru = readLocale(groupDir, file, "ru");

      agents.push({
        id:          slugify(fm.name),
        group,
        color:       fm.color || color,
        emoji:       fm.emoji || "🤖",
        capabilities: extractCapabilities(text, fm.description || ""),
        prompt_file: `catalog/${group}/${file}`,
        source:      "agency-agents",
        status:      "idle",
        // locale map: each lang has name/description/vibe/emoji/color
        locales: {
          en: {
            name:        en.name        || fm.name,
            description: en.description || fm.description || "",
            vibe:        en.vibe        || fm.vibe || "",
            emoji:       en.emoji       || fm.emoji || "🤖",
            color:       en.color       || fm.color || color,
          },
          ru: ru ? {
            name:        ru.name        || fm.name,
            description: ru.description || fm.description || "",
            vibe:        ru.vibe        || fm.vibe || "",
            emoji:       ru.emoji       || fm.emoji || "🤖",
            color:       ru.color       || fm.color || color,
          } : null,
        },
        // convenience flat fields for en (default)
        name:        en.name        || fm.name,
        description: en.description || fm.description || "",
        vibe:        en.vibe        || fm.vibe || "",
      });
    }
  }

  fs.writeFileSync(outFile, JSON.stringify(agents, null, 2));
  console.log(`  Catalog: ${agents.length} agents loaded from core/agents/catalog/`);
}

// ── CLI parsing ────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

const COMMANDS = {
  web:   cmdWeb,
  start: cmdWeb,
  help:  cmdHelp,
};

const fn = COMMANDS[cmd];
if (!fn) {
  if (cmd) console.error(`\n  Unknown command: ${cmd}\n`);
  cmdHelp();
  process.exit(cmd ? 1 : 0);
}

fn(args);

// ── Help ───────────────────────────────────────────────────────────────────

function cmdHelp() {
  console.log(`
  ┌─────────────────────────────────────────┐
  │  LEGION  AI Agent Platform  v0.1.0      │
  └─────────────────────────────────────────┘

  Usage:  legion <command> [options]

  Commands:
    web        Start the Legion web portal
    start      Alias for web
    help       Show this help

  Options (for web / start):
    --port, -p <number>   Port to listen on  (default: 3000)
    --no-open             Don't open browser automatically

  Examples:
    legion web
    legion web --port 8080
    legion web --no-open
`);
}

// ── Web server ─────────────────────────────────────────────────────────────

function cmdWeb(args) {
  // Parse flags
  let port    = 3000;
  let doOpen  = true;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--port" || args[i] === "-p") && args[i+1]) {
      port = parseInt(args[++i], 10);
    } else if (args[i] === "--no-open") {
      doOpen = false;
    }
  }

  const webRoot = path.resolve(__dirname, "..", "platforms", "web");

  if (!fs.existsSync(webRoot)) {
    console.error(`\n  Error: web platform not found at ${webRoot}\n`);
    process.exit(1);
  }

  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".png":  "image/png",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon",
    ".woff2":"font/woff2",
  };

  // Auto-build catalog from .md files before serving
  buildCatalog(webRoot);

  // ── Config store (core/config/) ──────────────────────────────────────────
  const configDir       = path.resolve(webRoot, "../../core/config");
  const modelsFile      = path.join(configDir, "models.json");
  const keysFile        = path.join(configDir, ".keys.json");
  const providersFile   = path.join(configDir, "providers.json");
  const pkeysFile       = path.join(configDir, ".pkeys.json");
  const projectsFile    = path.join(configDir, "projects.json");
  const pagentsFile     = path.join(configDir, "project-agents.json");
  const configFile      = path.join(configDir, "config.json");
  fs.mkdirSync(configDir, { recursive: true });

  // ── Project-agents helpers ──────────────────────────────────────────────
  function readPAgents() {
    if (!fs.existsSync(pagentsFile)) return {};
    try { return JSON.parse(fs.readFileSync(pagentsFile, "utf8")); } catch { return {}; }
  }
  function writePAgents(map) {
    const data = JSON.stringify(map, null, 2);
    const tmp = pagentsFile + ".tmp";
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, pagentsFile);
  }

  function agentMd(agent) {
    const now = new Date().toISOString().slice(0, 10);
    return [
      `---`,
      `id: ${agent.id}`,
      `catalog: ${agent.prompt_file || agent.group + "/" + agent.id + ".md"}`,
      `name: ${agent.name}`,
      `emoji: ${agent.emoji || "🤖"}`,
      `group: ${agent.group}`,
      `model: `,
      `added: ${now}`,
      `---`,
    ].join("\n");
  }

  function writeAgentFile(project, agent) {
    if (!project.path) return;
    const agentDir = path.join(project.path, ".legion", "agents", agent.id);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "agent.md"), agentMd(agent));

    const name = agent.name || agent.id;
    const desc = agent.description || "";

    const defaults = {
      "AGENTS.md": `# AGENTS.md — ${name}\n\nInstructions for AI coding agents working alongside this agent.\n\n## Role\n${desc}\n\n## Responsibilities\n- Define tasks clearly\n- Review outputs\n- Maintain context continuity\n`,
      "IDENTITY.md": `# IDENTITY.md — ${name}\n\nCore identity and persona definition.\n\n## Name\n${name}\n\n## Role\n${agent.role || agent.group || "Agent"}\n\n## Personality\nProfessional, concise, and focused on results.\n\n## Communication style\nClear, direct, and structured.\n`,
      "SOUL.md": `# SOUL.md — ${name}\n\nValues, principles, and behavioral guidelines.\n\n## Core values\n- Accuracy over speed\n- Transparency in reasoning\n- Continuous improvement\n\n## Principles\n- Always verify before acting\n- Prefer reversible actions\n- Ask when uncertain\n`,
      "USER.md": `# USER.md\n\nContext about the user and project for ${name}.\n\n## Project context\n_Fill in project description, goals, and constraints here._\n\n## User preferences\n_Language, tone, output format preferences._\n\n## Domain knowledge\n_Key facts, terminology, and conventions for this project._\n`,
      "MEMORY.md": `# MEMORY.md — ${name}\n\nLong-form narrative memory. Updated by the agent at the end of sessions or via checkpoints.\nMax ~3000 characters. The model reads this at the start of each session.\n\n## What I know\n_Key facts, decisions, and outcomes accumulated over time._\n\n## What to remember\n_Patterns, preferences, and lessons learned._\n\n## Open threads\n_Ongoing topics or unresolved questions._\n`,
      "CONTEXT.md": `# CONTEXT.md — ${name}\n\nProject-specific technical context. Read by the agent to understand the environment.\n\n## Tech stack\n_Languages, frameworks, libraries, runtime._\n\n## Architecture\n_Key components, modules, data flow._\n\n## Conventions\n_Naming, code style, commit format, file structure._\n\n## Current state\n_What's in progress, recent changes, known issues._\n`,
      "SKILLS.md": `# SKILLS.md — ${name}\n\nSkills and tools available to this agent.\n\n## Available skills\n_List installed skills with a short description of each._\n\n## Tools\n_External tools, APIs, or MCP servers this agent can call._\n\n## Invocation\n_How to trigger skills — slash commands, keywords, or conditions._\n`,
    };

    for (const [file, content] of Object.entries(defaults)) {
      const p = path.join(agentDir, file);
      if (!fs.existsSync(p)) fs.writeFileSync(p, content);
    }
  }

  function deleteAgentFile(project, agentId) {
    if (!project.path) return;
    const legionDir = path.join(project.path, ".legion");
    const agentDir  = path.join(legionDir, "agents", agentId);
    if (!agentDir.startsWith(legionDir + path.sep)) return;
    try { fs.rmSync(agentDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(path.join(legionDir, "agents", agentId + ".md")); } catch {}
  }

  function readProjects() {
    if (!fs.existsSync(projectsFile)) return [];
    try { return JSON.parse(fs.readFileSync(projectsFile, "utf8")); } catch { return []; }
  }
  function writeProjects(projects) {
    const data = JSON.stringify(projects, null, 2);
    const tmp = projectsFile + ".tmp";
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, projectsFile);
  }

  function readModels() {
    const models = fs.existsSync(modelsFile)
      ? (() => { try { return JSON.parse(fs.readFileSync(modelsFile, "utf8")); } catch { return []; } })()
      : [];
    const keys = fs.existsSync(keysFile)
      ? (() => { try { return JSON.parse(fs.readFileSync(keysFile, "utf8")); } catch { return {}; } })()
      : {};
    return models.map(m => ({ ...m, key: keys[m.id] || "" }));
  }

  function writeModels(models) {
    const keys = {};
    const safe = models.map(({ key, ...m }) => { if (key) keys[m.id] = key; return m; });
    const mData = JSON.stringify(safe, null, 2);
    const kData = JSON.stringify(keys, null, 2);
    const mTmp = modelsFile + ".tmp", kTmp = keysFile + ".tmp";
    fs.writeFileSync(mTmp, mData); fs.renameSync(mTmp, modelsFile);
    fs.writeFileSync(kTmp, kData); fs.renameSync(kTmp, keysFile);
  }

  function readProviders() {
    const providers = fs.existsSync(providersFile)
      ? (() => { try { return JSON.parse(fs.readFileSync(providersFile, "utf8")); } catch { return []; } })()
      : [];
    const keys = fs.existsSync(pkeysFile)
      ? (() => { try { return JSON.parse(fs.readFileSync(pkeysFile, "utf8")); } catch { return {}; } })()
      : {};
    return providers.map(p => ({ ...p, key: keys[p.id] || "" }));
  }

  function writeProviders(providers) {
    const keys = {};
    const safe = providers.map(({ key, ...p }) => { if (key) keys[p.id] = key; return p; });
    const pData = JSON.stringify(safe, null, 2);
    const kData = JSON.stringify(keys, null, 2);
    const pTmp = providersFile + ".tmp", kTmp = pkeysFile + ".tmp";
    fs.writeFileSync(pTmp, pData); fs.renameSync(pTmp, providersFile);
    fs.writeFileSync(kTmp, kData); fs.renameSync(kTmp, pkeysFile);
  }

  function readConfig() {
    try { return JSON.parse(fs.readFileSync(configFile, "utf8")); } catch { return {}; }
  }
  function writeConfig(cfg) {
    const tmp = configFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, configFile);
  }

  function postJson(url, headers, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const lib = u.protocol === "https:" ? https : http;
      const data = JSON.stringify(body);
      const req = lib.request({
        hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers },
      }, res => {
        let buf = "";
        res.on("data", c => { buf += c; });
        res.on("end", () => { try { resolve(JSON.parse(buf)); } catch(e) { reject(e); } });
      });
      req.on("error", reject);
      req.write(data);
      req.end();
    });
  }

  async function callAI(model, provider, prompt) {
    const { type, endpoint } = provider;
    const key = model.key || provider.key;
    const messages = [{ role: "user", content: prompt }];
    switch (type) {
      case "anthropic": {
        const d = await postJson("https://api.anthropic.com/v1/messages", {
          "x-api-key": key, "anthropic-version": "2023-06-01",
        }, { model: model.modelId, max_tokens: 4096, messages });
        if (d.error) throw new Error(`Anthropic: ${d.error.message || JSON.stringify(d.error)}`);
        return d.content?.[0]?.text || "";
      }
      case "openai":
      case "mistral": {
        const base = endpoint || (type === "openai" ? "https://api.openai.com" : "https://api.mistral.ai");
        const d = await postJson(`${base.replace(/\/$/, "")}/v1/chat/completions`, {
          "Authorization": `Bearer ${key}`,
        }, { model: model.modelId, messages });
        if (d.error) throw new Error(`${type}: ${d.error.message || JSON.stringify(d.error)}`);
        return d.choices?.[0]?.message?.content || "";
      }
      case "google": {
        const d = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${model.modelId}:generateContent?key=${key}`,
          {},
          { contents: [{ parts: [{ text: prompt }] }] }
        );
        if (d.error) throw new Error(`Google: ${d.error.message || JSON.stringify(d.error)}`);
        return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
      case "ollama": {
        const base = (endpoint || "http://localhost:11434").replace(/\/$/, "");
        const d = await postJson(`${base}/api/chat`, {},
          { model: model.modelId, messages, stream: false });
        if (d.error) throw new Error(`Ollama: ${d.error}`);
        return d.message?.content || "";
      }
      case "claude-cli": {
        const modelFlag = model.modelId ? ["--model", model.modelId] : [];
        const result = await new Promise((resolve, reject) => {
          const { spawn } = require("child_process");
          const child = spawn("claude", ["-p", "-", "--output-format", "text", ...modelFlag]);
          let stdout = "", stderr = "";
          const timer = setTimeout(() => { child.kill(); reject(new Error("claude-cli timeout after 5min")); }, 300000);
          child.stdout.on("data", d => { stdout += d; });
          child.stderr.on("data", d => { stderr += d; });
          child.on("error", err => { clearTimeout(timer); reject(err); });
          child.on("close", code => {
            clearTimeout(timer);
            if (code !== 0) reject(new Error(stderr.trim() || `claude exited with code ${code}`));
            else resolve(stdout.trim());
          });
          child.stdin.write(prompt);
          child.stdin.end();
        });
        return result;
      }
      default: throw new Error(`Unsupported provider type: ${type}`);
    }
  }

  function getJson(url, headers) {
    return new Promise((resolve, reject) => {
      const lib = url.startsWith("https") ? https : http;
      lib.get(url, { headers }, res => {
        let data = "";
        res.on("data", c => { data += c; });
        res.on("end", () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      }).on("error", reject);
    });
  }

  async function fetchRemoteModels(provider) {
    const { type, key, endpoint } = provider;
    try {
      switch (type) {
        case "anthropic": {
          const d = await getJson("https://api.anthropic.com/v1/models?limit=100", {
            "x-api-key": key, "anthropic-version": "2023-06-01",
          });
          return (d.data || []).map(m => ({ id: m.id, name: m.display_name || m.id }));
        }
        case "openai": {
          const d = await getJson("https://api.openai.com/v1/models", {
            "Authorization": `Bearer ${key}`,
          });
          const keep = /^(gpt|o1|o3|chatgpt)/;
          return (d.data || [])
            .filter(m => keep.test(m.id))
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(m => ({ id: m.id, name: m.id }));
        }
        case "google": {
          const d = await getJson(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
          );
          return (d.models || [])
            .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
            .map(m => ({ id: m.name.replace("models/", ""), name: m.displayName || m.name }));
        }
        case "mistral": {
          const d = await getJson("https://api.mistral.ai/v1/models", {
            "Authorization": `Bearer ${key}`,
          });
          return (d.data || []).map(m => ({ id: m.id, name: m.id }));
        }
        case "ollama": {
          const base = (endpoint || "http://localhost:11434").replace(/\/$/, "");
          const d = await getJson(`${base}/api/tags`);
          return (d.models || []).map(m => ({ id: m.name, name: m.name }));
        }
        case "claude-cli":
          return [
            { id: "claude-opus-4-7",          name: "Claude Opus 4.7" },
            { id: "claude-sonnet-4-6",         name: "Claude Sonnet 4.6" },
            { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
          ];
        default:
          return [];
      }
    } catch (err) {
      return { error: err.message };
    }
  }

  function initLegionFolder(project) {
    try {
      const legionDir = path.join(project.path, ".legion");
      fs.mkdirSync(legionDir, { recursive: true });
      const mdFile = path.join(legionDir, "LEGION.md");
      if (!fs.existsSync(mdFile)) {
        const now = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(mdFile, [
          `---`,
          `name: ${project.name}`,
          `description: ${project.description || ""}`,
          `created: ${now}`,
          `legion: 0.1.0`,
          `---`,
          ``,
          `# ${project.name}`,
          ``,
          `${project.description || ""}`,
          ``,
          `## Agents`,
          ``,
          `<!-- Agents assigned to this project will be listed here -->`,
          ``,
          `## Config`,
          ``,
          `<!-- Project-specific agent configuration goes here -->`,
        ].join("\n"));
      }
    } catch (err) {
      console.error(`  Warning: could not init .legion folder: ${err.message}`);
    }
  }

  function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise(resolve => {
      let buf = "", size = 0;
      req.on("data", c => {
        size += c.length;
        if (size > 1_000_000) { req.destroy(); resolve({}); return; }
        buf += c;
      });
      req.on("end", () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
    });
  }

  // ── HTTP server ───────────────────────────────────────────────────────────
  const server = http.createServer(async (req, res) => {
    try {
    const { method } = req;
    const urlPath = req.url.split("?")[0];

    // ── API routes ──────────────────────────────────────────────────────────

    // Landing page
    if (urlPath === "/home" && method === "GET") {
      const f = path.join(webRoot, "landing.html");
      fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
        res.end(data);
      });
      return;
    }

    // Folder picker (native OS dialog)
    if (urlPath === "/api/pick-folder" && method === "GET") {
      const cmds = {
        darwin: `osascript -e 'POSIX path of (choose folder with prompt "Select project folder")'`,
        linux:  `zenity --file-selection --directory --title="Select project folder" 2>/dev/null`,
        win32:  `powershell -command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.ShowDialog()|Out-Null; $d.SelectedPath"`,
      };
      const cmd = cmds[process.platform];
      if (!cmd) return json(res, 400, { error: "Unsupported platform" });
      try {
        const folderPath = await new Promise((resolve, reject) => {
          exec(cmd, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout.trim().replace(/\/$/, ""));
          });
        });
        return json(res, 200, { path: folderPath });
      } catch {
        return json(res, 200, { path: null });
      }
    }

    // Projects
    if (urlPath === "/api/projects" && method === "GET") {
      return json(res, 200, readProjects());
    }

    if (urlPath === "/api/projects" && method === "POST") {
      const body     = await readBody(req);
      const projects = readProjects();
      const project  = { ...body, id: body.id || crypto.randomUUID() };
      const exists   = projects.findIndex(p => p.id === project.id);
      if (exists >= 0) projects[exists] = project; else projects.push(project);
      writeProjects(projects);
      if (project.path) initLegionFolder(project);
      return json(res, 200, project);
    }

    if (urlPath.match(/^\/api\/projects\/[^/]+$/) && method === "PATCH") {
      const id       = urlPath.slice("/api/projects/".length);
      const body     = await readBody(req);
      const projects = readProjects();
      const idx      = projects.findIndex(p => p.id === id);
      if (idx < 0) return json(res, 404, { error: "Not found" });
      projects[idx]  = { ...projects[idx], ...body, id };
      writeProjects(projects);
      if (projects[idx].path) initLegionFolder(projects[idx]);
      return json(res, 200, projects[idx]);
    }

    if (urlPath.startsWith("/api/projects/") && urlPath.endsWith("/legion") && method === "DELETE") {
      const id      = urlPath.slice("/api/projects/".length, -"/legion".length);
      const project = readProjects().find(p => p.id === id);
      if (project?.path) {
        const legionDir = path.join(project.path, ".legion");
        try { fs.rmSync(legionDir, { recursive: true, force: true }); } catch {}
      }
      return json(res, 200, { ok: true });
    }

    // Project agents  (must be before generic project DELETE)
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents$/) && method === "GET") {
      const projectId = urlPath.split("/")[3];
      const map = readPAgents();
      return json(res, 200, map[projectId] || []);
    }

    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents$/) && method === "POST") {
      const projectId = urlPath.split("/")[3];
      const agent     = await readBody(req);
      const map       = readPAgents();
      if (!map[projectId]) map[projectId] = [];
      const existing  = map[projectId].findIndex(a => a.id === agent.id);
      const project   = readProjects().find(p => p.id === projectId);
      if (existing < 0) {
        map[projectId].push(agent);
        if (project) writeAgentFile(project, agent);
      } else {
        map[projectId][existing] = { ...map[projectId][existing], ...agent };
        // Update agent.md frontmatter model field
        if (project?.path) {
          const mdPath = path.join(project.path, ".legion", "agents", agent.id, "agent.md");
          if (fs.existsSync(mdPath)) {
            let content = fs.readFileSync(mdPath, "utf8");
            content = content.replace(/^model:.*$/m, `model: ${agent.model || ""}`);
            fs.writeFileSync(mdPath, content);
          }
        }
      }
      writePAgents(map);
      return json(res, 200, { ok: true });
    }

    // Agent doc files  GET/PUT /api/projects/:pid/agents/:aid/files/:filename
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/files\/[^/]+$/) && method === "GET") {
      const parts     = urlPath.split("/");
      const projectId = parts[3];
      const agentId   = parts[5];
      const filename  = parts[7];
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agentId)) return json(res, 400, { error: "Invalid agent ID" });
      const project   = readProjects().find(p => p.id === projectId);
      if (!project?.path) return json(res, 404, { error: "Project has no path" });
      const allowed = ["agent.md", "AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md", "CONTEXT.md", "SKILLS.md"];
      if (!allowed.includes(filename)) return json(res, 400, { error: "Invalid file" });
      const agentDir = path.join(project.path, ".legion", "agents", agentId);
      // Migrate flat file → directory if needed
      const legacyFlat = path.join(project.path, ".legion", "agents", agentId + ".md");
      if (!fs.existsSync(agentDir) && fs.existsSync(legacyFlat)) {
        fs.mkdirSync(agentDir, { recursive: true });
        fs.renameSync(legacyFlat, path.join(agentDir, "agent.md"));
        // Bootstrap doc files
        const map = readPAgents();
        const agent = (map[projectId] || []).find(a => a.id === agentId) || { id: agentId, name: agentId };
        writeAgentFile(project, agent);
      } else if (!fs.existsSync(agentDir)) {
        // Bootstrap from stored agent data
        const map = readPAgents();
        const agent = (map[projectId] || []).find(a => a.id === agentId) || { id: agentId, name: agentId };
        writeAgentFile(project, agent);
      }
      const filePath = path.join(agentDir, filename);
      const content  = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
      return json(res, 200, { content });
    }

    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/files\/[^/]+$/) && method === "PUT") {
      const parts     = urlPath.split("/");
      const projectId = parts[3];
      const agentId   = parts[5];
      const filename  = parts[7];
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agentId)) return json(res, 400, { error: "Invalid agent ID" });
      const project   = readProjects().find(p => p.id === projectId);
      if (!project?.path) return json(res, 404, { error: "Project has no path" });
      const allowed = ["agent.md", "AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md", "CONTEXT.md", "SKILLS.md"];
      if (!allowed.includes(filename)) return json(res, 400, { error: "Invalid file" });
      const body     = await readBody(req);
      const filePath = path.join(project.path, ".legion", "agents", agentId, filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, body.content || "");
      return json(res, 200, { ok: true });
    }

    // ── Agent data stores (tasks / cron / workers / channels / memories) ──────
    // Pattern: GET/POST/PATCH/DELETE /api/projects/:pid/agents/:aid/:store[/:itemId]
    const storeMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/agents\/([^/]+)\/(tasks|cron|workers|channels|memories)(?:\/([^/]+))?$/);
    if (storeMatch) {
      const [, projectId, agentId, store, itemId] = storeMatch;
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agentId)) return json(res, 400, { error: "Invalid agent ID" });
      const project = readProjects().find(p => p.id === projectId);

      function storeFile() {
        if (!project?.path) return null;
        const dir = path.join(project.path, ".legion", "agents", agentId);
        fs.mkdirSync(dir, { recursive: true });
        return path.join(dir, store + ".json");
      }
      function readStore() {
        const f = storeFile();
        if (!f || !fs.existsSync(f)) return [];
        try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return []; }
      }
      function writeStore(data) {
        const f = storeFile();
        if (!f) return;
        const d = JSON.stringify(data, null, 2);
        const tmp = f + ".tmp";
        fs.writeFileSync(tmp, d);
        fs.renameSync(tmp, f);
      }

      if (method === "GET" && !itemId) {
        return json(res, 200, readStore());
      }
      if (method === "POST" && !itemId) {
        const body = await readBody(req);
        const item = { ...body, id: body.id || crypto.randomUUID(), createdAt: new Date().toISOString() };
        const list = readStore();
        list.push(item);
        writeStore(list);
        return json(res, 200, item);
      }
      if ((method === "PATCH" || method === "PUT") && itemId) {
        const body = await readBody(req);
        const list = readStore();
        const idx  = list.findIndex(x => x.id === itemId);
        if (idx < 0) return json(res, 404, { error: "Not found" });
        list[idx] = { ...list[idx], ...body, id: itemId, updatedAt: new Date().toISOString() };
        writeStore(list);
        return json(res, 200, list[idx]);
      }
      if (method === "DELETE" && itemId) {
        const list = readStore().filter(x => x.id !== itemId);
        writeStore(list);
        return json(res, 200, { ok: true });
      }
    }

    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+$/) && method === "DELETE") {
      const parts     = urlPath.split("/");
      const projectId = parts[3];
      const agentId   = parts[5];
      const map       = readPAgents();
      if (map[projectId]) map[projectId] = map[projectId].filter(a => a.id !== agentId);
      writePAgents(map);
      const project = readProjects().find(p => p.id === projectId);
      if (project) deleteAgentFile(project, agentId);
      return json(res, 200, { ok: true });
    }

    if (urlPath.startsWith("/api/projects/") && method === "DELETE") {
      const id       = urlPath.slice("/api/projects/".length);
      const projects = readProjects();
      const project  = projects.find(p => p.id === id);
      writeProjects(projects.filter(p => p.id !== id));
      if (project?.path) {
        const legionDir = path.join(project.path, ".legion");
        try { fs.rmSync(legionDir, { recursive: true, force: true }); } catch {}
      }
      return json(res, 200, { ok: true });
    }

    // Models
    if (urlPath === "/api/models" && method === "GET") {
      return json(res, 200, readModels());
    }

    if (urlPath === "/api/models" && method === "POST") {
      const body   = await readBody(req);
      const models = readModels();
      const model  = { ...body, id: body.id || crypto.randomUUID() };
      const exists = models.findIndex(m => m.id === model.id);
      if (exists >= 0) models[exists] = model; else models.push(model);
      writeModels(models);
      return json(res, 200, model);
    }

    if (urlPath.startsWith("/api/models/") && method === "DELETE") {
      const id     = urlPath.slice("/api/models/".length);
      const models = readModels().filter(m => m.id !== id);
      writeModels(models);
      return json(res, 200, { ok: true });
    }

    // Providers
    if (urlPath === "/api/providers" && method === "GET") {
      return json(res, 200, readProviders());
    }

    if (urlPath === "/api/providers" && method === "POST") {
      const body      = await readBody(req);
      const providers = readProviders();
      const provider  = { ...body, id: body.id || crypto.randomUUID() };
      const exists    = providers.findIndex(p => p.id === provider.id);
      if (exists >= 0) providers[exists] = provider; else providers.push(provider);
      writeProviders(providers);
      return json(res, 200, provider);
    }

    if (urlPath.startsWith("/api/providers/") && method === "DELETE") {
      const id        = urlPath.slice("/api/providers/".length);
      const providers = readProviders().filter(p => p.id !== id);
      writeProviders(providers);
      return json(res, 200, { ok: true });
    }

    if (urlPath.startsWith("/api/providers/") && urlPath.endsWith("/models") && method === "GET") {
      const id       = urlPath.slice("/api/providers/".length, -"/models".length);
      const provider = readProviders().find(p => p.id === id);
      if (!provider) return json(res, 404, { error: "Provider not found" });
      const models = await fetchRemoteModels(provider);
      return json(res, 200, models);
    }

    // GET /api/config
    if (urlPath === "/api/config" && method === "GET") {
      return json(res, 200, readConfig());
    }

    // PUT /api/config
    if (urlPath === "/api/config" && method === "PUT") {
      const body = await readBody(req);
      const cfg = { ...readConfig(), ...body };
      writeConfig(cfg);
      return json(res, 200, cfg);
    }

    // POST /api/projects/:pid/analyze
    if (urlPath.match(/^\/api\/projects\/[^/]+\/analyze$/) && method === "POST") {
      const pid = urlPath.split("/")[3];

      // SSE setup — stream progress to client
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      let aborted = false;
      req.on("close", () => { aborted = true; });

      const send = (type, payload) => {
        if (!aborted) res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
      };
      const progress = (msg) => { console.log("[analyze]", msg); send("progress", { message: msg }); };
      const done     = (result) => { send("done", { result }); res.end(); };
      const fail     = (err)    => { send("error", { message: err }); res.end(); };

      try {
        progress("Validating configuration…");
        const projects = readProjects();
        const project  = projects.find(p => p.id === pid);
        if (!project) return fail("Project not found");

        const cfg = readConfig();
        if (!cfg.defaultModelId) return fail("No default model configured in Settings → General");

        const models    = readModels();
        const providers = readProviders();
        const model     = models.find(m => m.id === cfg.defaultModelId);
        if (!model) return fail("Default model not found");
        const provider = providers.find(p => p.id === model.providerId);
        if (!provider) return fail("Provider not found");
        const needsKey = !["ollama", "claude-cli"].includes(provider.type);
        if (needsKey && !provider.key && !model.key) return fail("Provider not configured or missing API key");

        // ── Domain detection groups ──────────────────────────────────────────
        const DOMAIN_GROUPS = {
          game:      new Set(['game-development', 'engineering', 'testing', 'project-management', 'design', 'specialized', 'spatial-computing']),
          web:       new Set(['engineering', 'design', 'testing', 'project-management', 'product', 'specialized', 'marketing']),
          mobile:    new Set(['engineering', 'design', 'testing', 'project-management', 'product', 'specialized']),
          backend:   new Set(['engineering', 'testing', 'project-management', 'specialized', 'product']),
          marketing: new Set(['marketing', 'design', 'product', 'specialized', 'paid-media', 'sales']),
          assistant: new Set(['specialized', 'support', 'project-management', 'academic']),
          general:   null, // all groups
        };

        function detectDomain(text) {
          const t = (text || '').toLowerCase();
          if (/unreal|unity|godot|\bgame\b|gameplay|mmo|fps|rpg|npc|loot|quest|level design|matchmaking/.test(t)) return 'game';
          if (/\bios\b|android|swift\b|kotlin|flutter|react native|mobile app/.test(t)) return 'mobile';
          if (/react|vue|angular|svelte|nextjs|frontend|web app|saas|dashboard|html|css/.test(t)) return 'web';
          if (/\bapi\b|microservice|postgresql|mongodb|redis|graphql|rest\b|fastapi|express|django/.test(t)) return 'backend';
          if (/marketing|seo|content strateg|social media|campaign|brand/.test(t)) return 'marketing';
          if (/personal assistant|calendar|email|reminder|schedule|note.tak/.test(t)) return 'assistant';
          return 'general';
        }

        function parseJson(raw) {
          const stripped = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
          const jsonStr  = stripped.startsWith("{") || stripped.startsWith("[")
            ? stripped
            : (stripped.match(/\{[\s\S]*\}/)?.[0] || "");
          if (!jsonStr) throw new Error(`Non-JSON response: ${raw.slice(0, 200)}`);
          return JSON.parse(jsonStr);
        }

        // ── Read existing agents ─────────────────────────────────────────────
        progress("Reading existing agents…");
        const pagents      = (() => { try { return JSON.parse(fs.readFileSync(pagentsFile, "utf8")); } catch { return {}; } })();
        const existingList = pagents[pid] || [];
        const existingAgents = existingList.length
          ? existingList.map(a => `- ${a.name}${a.role ? ` (${a.role})` : ""}`).join("\n")
          : "None yet";

        // ── Scan project docs ────────────────────────────────────────────────
        progress("Scanning project documentation…");
        const docParts = [];
        if (project.path) {
          // AGENTS.md intentionally excluded — may contain historical agent lists from other systems
          const docCandidates = ["README.md", "readme.md", "README.txt", "package.json", "pyproject.toml", "Cargo.toml", "CLAUDE.md"];
          for (const f of docCandidates) {
            const fp = path.join(project.path, f);
            if (fs.existsSync(fp)) {
              try { docParts.push(`### ${f}\n${fs.readFileSync(fp, "utf8").slice(0, 3000)}`); } catch {}
            }
          }
          const docsDir = path.join(project.path, "docs");
          if (fs.existsSync(docsDir)) {
            try {
              // Skip agent-list files — they describe historical/planned agents, not architecture
              const SKIP_DOCS = /^(agents|03-agents|agent-list|aifactory)/i;
              const files = fs.readdirSync(docsDir).filter(f => /\.(md|txt)$/i.test(f) && !SKIP_DOCS.test(f)).slice(0, 5);
              for (const f of files) {
                try { docParts.push(`### docs/${f}\n${fs.readFileSync(path.join(docsDir, f), "utf8").slice(0, 2000)}`); } catch {}
              }
            } catch {}
          }
        }
        const projectDocs = docParts.length
          ? `Found ${docParts.length} file(s): ${docParts.map(p => p.match(/^### (.+)/)?.[1]).join(", ")}\n\n` + docParts.join("\n\n")
          : "No documentation found.";
        progress(docParts.length ? `Read ${docParts.length} documentation file(s)` : "No documentation files found");

        // ── Load catalog (needed for both empty and normal paths) ─────────────
        const catalogFile   = path.join(webRoot, "data", "agents-catalog.json");
        const catalogAgents = fs.existsSync(catalogFile)
          ? (() => { try { return JSON.parse(fs.readFileSync(catalogFile, "utf8")); } catch { return []; } })()
          : [];

        // ── Exclude already-installed agents (by catalogId AND name) ──────────
        const existingIds   = new Set(existingList.map(a => a.catalogId).filter(Boolean));
        const existingNames = new Set(existingList.map(a => a.name.toLowerCase()));
        const notInstalled  = a => !existingIds.has(a.id) && !existingNames.has(a.name.toLowerCase());

        // ── SHORTCUT: no docs and no description → suggest Technical Writer ───
        const hasDesc = (project.description || '').trim().length > 20;
        if (!docParts.length && !hasDesc) {
          progress("No documentation found — suggesting a documentation agent first");
          const writer = catalogAgents.find(a => a.id === 'technical-writer') || catalogAgents.find(a => /technical.writer/i.test(a.name));
          const result = {
            analysis: `No documentation was found for "${project.name}". Before selecting a full agent team, start with a Technical Writer to create project documentation (README, architecture overview, requirements). Once documentation exists, re-run Analyze to get a complete, accurate team recommendation.`,
            agents: writer ? [{
              id: writer.id,
              name: writer.name,
              tier: "mandatory",
              covers: "Project documentation",
              reason: "No project documentation exists. A Technical Writer will create README, architecture docs, and requirements — enabling a proper analysis on the next run."
            }] : [],
            pipelines: [],
          };
          progress(`Done — suggested 1 agent (re-run Analyze after documentation is created)`);
          return done(result);
        }

        // ── Detect domain (server-side, no AI call) ──────────────────────────
        const domainHint = detectDomain((project.description || '') + ' ' + docParts.slice(0, 2).join(' '));
        progress(`Domain detected: ${domainHint}`);

        // ── Filter catalog by domain + exclude installed ──────────────────────
        progress("Loading agent catalog…");
        const allowedGroups = DOMAIN_GROUPS[domainHint];
        const available     = catalogAgents.filter(a => notInstalled(a) && (!allowedGroups || allowedGroups.has(a.group)));
        const catalogText   = available.map(a => {
          const caps = a.capabilities?.length ? ` | capabilities: ${a.capabilities.join(', ')}` : '';
          return `- id: "${a.id}" | group: ${a.group} | name: ${a.name}${caps} | ${a.description}`;
        }).join("\n");
        progress(`Catalog filtered: ${available.length} agents in ${[...new Set(available.map(a => a.group))].join(', ')}`);

        if (aborted) return;

        // ── PASS 1: extract functional areas ─────────────────────────────────
        progress("Pass 1 — Extracting functional requirements…");
        const pass1File = path.resolve(webRoot, "../../core/prompts/analyze-pass1.md");
        const pass1Tpl  = fs.existsSync(pass1File) ? fs.readFileSync(pass1File, "utf8") : "";
        const pass1Prompt = pass1Tpl
          .replace("{{project_name}}",        project.name)
          .replace("{{project_description}}", project.description || "No description")
          .replace("{{project_docs}}",        projectDocs)
          .replace("{{existing_agents}}",     existingAgents);

        const pass1Raw = await callAI(model, provider, pass1Prompt);
        if (aborted) return;
        const pass1    = parseJson(pass1Raw);
        const funcAreas = (pass1.functional_areas || []).join("\n- ");
        const covered   = (pass1.covered_by_existing || []).join("\n- ") || "Nothing yet";
        progress(`Found ${pass1.functional_areas?.length || 0} functional areas: ${(pass1.functional_areas || []).slice(0, 3).join(', ')}…`);

        // ── PASS 2: match agents to requirements ─────────────────────────────
        progress("Pass 2 — Matching agents to requirements…");
        const installedNote = existingList.length
          ? `\n\nDo NOT recommend any of these already-installed agents: ${existingList.map(a => a.name).join(', ')}.`
          : '';
        const pass2File = path.resolve(webRoot, "../../core/prompts/analyze.md");
        const pass2Tpl  = fs.existsSync(pass2File) ? fs.readFileSync(pass2File, "utf8") : "";
        const pass2Prompt = pass2Tpl
          .replace("{{project_name}}",        project.name)
          .replace("{{project_description}}", (project.description || "No description") + installedNote)
          .replace("{{tech_stack}}",          (pass1.tech_stack || []).join(', ') || "Unknown")
          .replace("{{functional_areas}}",    funcAreas ? `- ${funcAreas}` : "No specific areas identified")
          .replace("{{covered_by_existing}}", covered)
          .replace("{{existing_agents}}",     existingAgents)
          .replace("{{catalog}}",             catalogText);

        const pass2Raw = await callAI(model, provider, pass2Prompt);
        if (aborted) return;

        progress("Parsing response…");
        const result = parseJson(pass2Raw);
        // Final safety: strip any agents that are already installed
        if (result.agents) {
          result.agents = result.agents.filter(a => !existingNames.has(a.name.toLowerCase()) && !existingIds.has(a.id));
        }
        progress(`Done — ${result.agents?.length || 0} agents recommended, ${result.pipelines?.length || 0} pipelines suggested`);
        done(result);

      } catch (err) {
        console.error("[analyze]", err.message);
        fail(err.message);
      }
    }

    // Reject unknown API routes before falling through to static files
    if (urlPath.startsWith("/api/")) {
      return json(res, 404, { error: "Not found" });
    }

    // ── Static files ────────────────────────────────────────────────────────
    let filePath = path.join(webRoot, urlPath === "/" ? "/index.html" : urlPath);
    const ext    = path.extname(filePath).toLowerCase();

    if (!filePath.startsWith(webRoot)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      const etag = '"' + crypto.createHash("md5").update(data).digest("hex") + '"';
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304); res.end(); return;
      }
      res.writeHead(200, {
        "Content-Type":  MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma":        "no-cache",
        "ETag":          etag,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(data);
    });
    } catch (err) {
      console.error("Request error:", err.message);
      try { json(res, 500, { error: "Internal error" }); } catch {}
    }
  });

  server.listen(port, "localhost", () => {
    const url = `http://localhost:${port}`;

    console.log(`
  ┌─────────────────────────────────────────┐
  │  LEGION  Web Portal  v0.1.0             │
  └─────────────────────────────────────────┘

  Local:   ${url}
  Stop:    Ctrl+C
`);

    if (doOpen) openBrowser(url);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n  Error: port ${port} is already in use.\n  Try: legion web --port 3001\n`);
    } else {
      console.error(`\n  Server error: ${err.message}\n`);
    }
    process.exit(1);
  });

  process.on("SIGINT",  () => { console.log("\n  Stopped.\n"); process.exit(0); });
  process.on("SIGTERM", () => { process.exit(0); });
}

// ── Open browser (macOS / Linux / Windows) ────────────────────────────────

function openBrowser(url) {
  const cmds = {
    darwin: `open "${url}"`,
    linux:  `xdg-open "${url}"`,
    win32:  `start "" "${url}"`,
  };
  const c = cmds[process.platform];
  if (c) exec(c, (err) => { if (err) console.log(`  Open manually: ${url}`); });
}
