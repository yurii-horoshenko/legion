#!/usr/bin/env node

const http   = require("http");
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
  const configDir  = path.resolve(webRoot, "../../core/config");
  const modelsFile = path.join(configDir, "models.json");
  const keysFile   = path.join(configDir, ".keys.json");
  fs.mkdirSync(configDir, { recursive: true });

  function readModels() {
    const models = fs.existsSync(modelsFile)
      ? JSON.parse(fs.readFileSync(modelsFile, "utf8"))
      : [];
    const keys = fs.existsSync(keysFile)
      ? JSON.parse(fs.readFileSync(keysFile, "utf8"))
      : {};
    return models.map(m => ({ ...m, key: keys[m.id] || "" }));
  }

  function writeModels(models) {
    const keys = {};
    const safe = models.map(({ key, ...m }) => { if (key) keys[m.id] = key; return m; });
    fs.writeFileSync(modelsFile, JSON.stringify(safe, null, 2));
    fs.writeFileSync(keysFile,   JSON.stringify(keys, null, 2));
  }

  function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise(resolve => {
      let buf = "";
      req.on("data", c => { buf += c; });
      req.on("end",  () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
    });
  }

  // ── HTTP server ───────────────────────────────────────────────────────────
  const server = http.createServer(async (req, res) => {
    const { method } = req;
    const urlPath = req.url.split("?")[0];

    // ── API routes ──────────────────────────────────────────────────────────
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

    // ── Static files ────────────────────────────────────────────────────────
    let filePath = path.join(webRoot, urlPath === "/" ? "/index.html" : urlPath);
    const ext    = path.extname(filePath).toLowerCase();

    if (!filePath.startsWith(webRoot)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, {
        "Content-Type":  MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(data);
    });
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
