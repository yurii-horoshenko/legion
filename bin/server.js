"use strict";

const http   = require("http");
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");

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

module.exports = function startServer({ port, doOpen, webRoot }) {
  const configDir     = path.resolve(webRoot, "../../.config");
  const agentsBaseDir = path.resolve(webRoot, "../../core/agents");

  const httpLib  = require("../lib/http");
  const log      = require("../lib/log");
  const db       = require("../lib/db")(configDir);

  db.clearChatLogs();
  log.info("server", "chat logs cleared for this session");
  const io       = require("../lib/io")(configDir, db);
  const aiLib    = require("../lib/ai")(httpLib, io);
  const agentFs  = require("../lib/agents-fs")(io, agentsBaseDir, webRoot);
  const visor    = require("../lib/visor")(io, aiLib);

  // Sync .legion/agents → .claude/agents/ for native Claude Code pickup
  agentFs.syncClaudeAgents();

  const ctx = { io, http: httpLib, ai: aiLib, agentFs, visor, db, webRoot, agentsBaseDir, port, exec };

  const handlers = [
    require("../routes/projects")(ctx),
    require("../routes/agents")(ctx),
    require("../routes/chat")(ctx),
    require("../routes/skills")(ctx),
    require("../routes/config")(ctx),
    require("../routes/analysis")(ctx),
    require("../routes/linear")(ctx),
    require("../routes/monitoring")(ctx),
  ];

  const server = http.createServer(async (req, res) => {
    try {
      const { method } = req;
      const urlPath = req.url.split("?")[0];

      if (urlPath.startsWith("/api/")) {
        const reqTimer = log.timer();
        res.on("finish", () => {
          const s = res.statusCode;
          // HEAD /avatar → 404 is expected when no custom avatar is set
          if (method === "HEAD" && urlPath.endsWith("/avatar") && s === 404) return;
          const lvl = s >= 500 ? "error" : s >= 400 ? "warn" : "info";
          log[lvl]("http", `${method} ${urlPath} → ${s} in ${reqTimer()}`);
        });
      }

      // OPTIONS
      if (method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin":  "*",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key,anthropic-version",
        });
        res.end();
        return;
      }

      // Read body once for methods that may have one
      let body = {};
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        // Avatar PUT uses raw binary — skip JSON parsing for that route
        if (!urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/avatar$/)) {
          body = await httpLib.readBody(req);
        }
      }

      // Try all route handlers
      for (const handler of handlers) {
        if (await handler(urlPath, method, req, res, body)) return;
      }

      // Reject unknown API routes before falling through to static files
      if (urlPath.startsWith("/api/")) {
        httpLib.json(res, 404, { error: "Not found" });
        return;
      }

      // Static files
      let filePath = path.join(webRoot, decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath));
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
      try { httpLib.json(res, 500, { error: "Internal error" }); } catch {}
    }
  });

  // WebSocket upgrade
  const ws = require("../lib/ws")(server);
  ctx.ws = ws;

  // GET /api/events?pid=&limit=  — recent activity from SQLite
  handlers.unshift(async (urlPath, method, req, res) => {
    if (urlPath !== "/api/events" || method !== "GET") return false;
    const qs    = new URL(req.url, "http://x").searchParams;
    const pid   = qs.get("pid") || undefined;
    const limit = Math.min(parseInt(qs.get("limit") || "60", 10), 200);
    httpLib.json(res, 200, db.recent(pid, limit));
    return true;
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
};

// ── Open browser (macOS / Linux / Windows) ────────────────────────────────

function openBrowser(url) {
  const cmds = {
    darwin: `open "${url}"`,
    linux:  `xdg-open "${url}"`,
    win32:  `start "" "${url}"`,
  };
  const c = cmds[process.platform];
  if (c) require("child_process").exec(c, (err) => { if (err) console.log(`  Open manually: ${url}`); });
}
