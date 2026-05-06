# Legion Web — Setup & Launch

## Requirements

- **Node.js 23+** — install via [brew](https://brew.sh): `brew install node`

---

## Commands

```bash
npm start               # start server + open browser at http://localhost:3000
npm run dev             # start server, skip auto-opening browser
```

Or with global install:

```bash
npm install -g .        # register `legion` CLI globally (run once)
legion web              # same as npm start
legion web --port 8080  # custom port
legion web --no-open    # skip browser open
```

---

## What happens on start

1. `bin/legion.js` parses CLI arguments
2. `lib/catalog.js` builds `platforms/web/data/agents-catalog.json` from `core/agents/catalog/*.md`
3. `bin/server.js` starts a local HTTP server (Node.js stdlib, zero external deps):
   - Instantiates factory modules: `createDB`, `createIO`, `createHTTP`, `createAI`, `createAgentFs`, `createVisor`
   - Registers route handlers from `routes/` — each receives a shared `ctx` object
   - Serves `platforms/web/` as static files
4. Opens `http://localhost:3000` in your default browser

---

## Config file locations

All config is stored in `.config/` at the Legion repo root — **fully gitignored**.  
Delete this folder to reset everything.

| File | Contents |
|------|----------|
| `legion.db` | SQLite database — projects, agents, providers, models, tasks, memories, chat logs |
| `.pkeys.json` | Provider API keys |
| `.keys.json` | Model API keys |

Keys never leave your machine.

---

## Server architecture

```
bin/server.js
│
├── lib/db.js          SQLite layer (node:sqlite) — projects, agents, providers, models,
│                      config_kv, stores, events, chat_logs
│
├── lib/io.js          readProjects / writeProjects / readPAgents / writePAgents
│                      readModels / writeModels / readProviders / writeProviders
│                      readConfig / writeConfig / readIntegrations / writeIntegrations
│                      linearQuery(apiKey, gql, vars)
│
├── lib/http.js        postJson / getJson / json(res,status,body) / readBody(req)
│                      resolveModel(models, providers, modelId)  ← accepts UUID or modelId string
│                      createSSEHandler(res, req, tag)
│
├── lib/ai.js          callAI / callAIMessages / streamOllamaToAnthropicSSE
│                      fetchRemoteModels / langDirective
│
├── lib/agents-fs.js   writeAgentFile / deleteAgentFile / agentMd
│                      syncLegionMd / syncSkillsMd / initLegionFolder
│
├── lib/log.js         info/warn/error/debug — level via LEGION_LOG env var
│
└── routes/            Each: module.exports = function(ctx) { return async handle(...) }
    ├── projects.js    /api/projects (CRUD + folder picker)
    ├── agents.js      /api/projects/:pid/agents (CRUD, avatar, files, stores, activate)
    ├── chat.js        /api/.../chat, intro, orchestrator + Linear block execution
    ├── config.js      /api/models, /api/providers, /api/config
    ├── analysis.js    /api/projects/:pid/analyze (two-pass SSE + fuzzy catalog resolution)
    ├── skills.js      /api/.../suggest-skills, assign, unassign, available
    ├── linear.js      /api/projects/:pid/linear/* (teams, issues, states, labels, auto-assign)
    └── monitoring.js  /api/projects/:pid/visor, tasks, pipelines
```

All modules use Node.js stdlib only — no `npm install` ever needed.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LEGION_LOG` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `PORT` | `3000` | HTTP port (also set via `--port` flag) |

---

## Claude Code proxy

Set in your project's `.claude/settings.json` (written automatically by **Config → Activate in Claude Code**):

```json
{
  "model": "<modelId>",
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3000/api/proxy",
    "ANTHROPIC_API_KEY": "legion"
  }
}
```

This routes Claude Code's API calls through Legion's provider abstraction, enabling Ollama, OpenAI, and other providers to work transparently with Claude Code.
