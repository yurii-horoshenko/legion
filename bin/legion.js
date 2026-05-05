#!/usr/bin/env node

"use strict";

const fs   = require("fs");
const path = require("path");

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
  let port   = 3000;
  let doOpen = true;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) {
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

  // Auto-build catalog from .md files before serving
  require("../lib/catalog").buildCatalog(webRoot);

  require("./server").startServer({ port, doOpen, webRoot });
}
