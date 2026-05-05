# Legion — AI Agent Platform

> Local platform for building and managing AI agent teams.  
> Starts with one command, runs in the browser, stores everything on disk.

---

## Current state (v0.1.0)

Fully working web portal with file-based storage and real AI chat. Modular Node.js server (lib/ + routes/). No Swift runtime yet — the platform manages agent configuration, catalog, pipelines, and metadata.

---

## Start

```bash
npm start          # start server + open browser
npm run dev        # without auto-opening browser
```

Server runs at `http://localhost:3000`.

---

## Architecture

```
legion/
├── bin/
│   ├── legion.js          ← CLI entry — argument parsing only
│   └── server.js          ← HTTP server setup, route registration, static serving
├── lib/
│   ├── catalog.js         ← Markdown catalog builder
│   ├── http.js            ← postJson, getJson, json(), readBody()
│   ├── io.js              ← all JSON read/write helpers (projects, agents, models…)
│   ├── agents-fs.js       ← agent file system operations
│   ├── ai.js              ← AI provider abstraction (all 6 providers)
│   └── visor.js           ← Visor bulletin checks
├── routes/
│   ├── projects.js        ← /api/projects
│   ├── agents.js          ← /api/projects/:pid/agents
│   ├── chat.js            ← /api/.../chat, /api/.../chat/intro, /api/proxy/v1/messages
│   ├── skills.js          ← /api/.../skills, suggest-skills
│   ├── config.js          ← /api/models, /api/providers, /api/config
│   ├── analysis.js        ← /api/projects/:pid/analyze (SSE)
│   ├── linear.js          ← /api/projects/:pid/linear/*
│   └── monitoring.js      ← /api/projects/:pid/visor, tasks, pipelines
├── core/
│   ├── agents/catalog/    ← 174+ agent .md files with YAML frontmatter
│   ├── config/
│   │   ├── projects.json
│   │   ├── agents/        ← one {pid}.json per project (auto-cleaned on delete)
│   │   ├── providers.json
│   │   ├── models.json
│   │   ├── .pkeys.json    ← provider API keys (gitignored)
│   │   └── .keys.json     ← model API keys (gitignored)
│   └── prompts/           ← AI analysis prompts
└── platforms/web/
    ├── index.html
    ├── js/
    │   ├── app.js         ← bootstrap & event listeners
    │   ├── i18n.js        ← EN / RU localization
    │   ├── modules/       ← state.js, utils.js, api.js
    │   ├── ui/            ← topbar, sidebar, dashboard, agent-panel, catalog, analyze
    │   ├── tabs/          ← one file per agent tab (chat, tasks, memories…)
    │   └── modals/        ← project, decompose, mini modals
    └── css/
        ├── base.css / layout.css / sidebar.css
        ├── dashboard.css / agent-panel.css
        ├── modals.css / settings.css
        ├── analyze.css / tasks-view.css
        └── app.css        ← kept for reference; index.html loads component files
```

### Project file storage

Each project can be linked to a folder on disk. On link, Legion creates:

```
<project-path>/
└── .legion/
    ├── LEGION.md              ← project metadata (frontmatter)
    └── agents/
        └── <agent-id>/
            ├── agent.md       ← agent frontmatter (id, model, added)
            ├── AGENTS.md      ← instructions for AI coding tools (Claude Code, Cursor…)
            ├── IDENTITY.md    ← persona and character
            ├── SOUL.md        ← values and principles
            ├── USER.md        ← project and user context
            ├── MEMORY.md      ← long-term memories (synced bidirectionally with the UI)
            ├── tasks.json     ← kanban tasks
            ├── cron.json      ← scheduled jobs
            ├── workers.json   ← background workers
            └── channels.json  ← HTTP, Telegram, Discord, MCP endpoints
```

`AGENTS.md` and `MEMORY.md` are plain markdown — Claude Code, Cursor, and any AI coding tool reads them directly.

---

## Server API

All endpoints return JSON. No auth required (localhost only).

### Projects

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create / update project |
| PATCH | `/api/projects/:id` | Update name / description / path |
| DELETE | `/api/projects/:id` | Delete project + agent config + .legion folder |
| DELETE | `/api/projects/:id/legion` | Delete only the .legion folder |
| GET | `/api/pick-folder` | Open native OS folder picker |

### Project agents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:pid/agents` | List agents in project |
| POST | `/api/projects/:pid/agents` | Add / update agent |
| DELETE | `/api/projects/:pid/agents/:aid` | Remove agent |
| POST | `/api/projects/:pid/agents/:aid/activate` | Write Claude Code settings for this agent |

### Agent files

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:pid/agents/:aid/files/:name` | Read an MD file |
| PUT | `/api/projects/:pid/agents/:aid/files/:name` | Save an MD file |

Available files: `agent.md`, `AGENTS.md`, `IDENTITY.md`, `SOUL.md`, `USER.md`, `MEMORY.md`

### Agent stores (Tasks / Cron / Workers / Channels / Memories)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:pid/agents/:aid/:store` | List items |
| POST | `/api/projects/:pid/agents/:aid/:store` | Add item |
| PATCH | `/api/projects/:pid/agents/:aid/:store/:id` | Update item |
| DELETE | `/api/projects/:pid/agents/:aid/:store/:id` | Delete item |

`:store` — one of: `tasks`, `cron`, `workers`, `channels`, `memories`

### Chat

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects/:pid/agents/:aid/chat/intro` | Agent self-introduction (SSE stream) |
| POST | `/api/projects/:pid/agents/:aid/chat` | Send message, get AI response (SSE stream) |

Both endpoints use the model and provider configured for that agent. System prompt is built from the agent's IDENTITY.md, SOUL.md, and USER.md files.

### Claude Code proxy (Ollama → Anthropic format)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/proxy/v1/messages` | Anthropic-compatible endpoint that routes to any provider |

Used when `ANTHROPIC_BASE_URL=http://localhost:3000/api/proxy` is set in Claude Code's environment. This lets Claude Code use non-Anthropic models (Ollama, OpenAI, etc.) through Legion's provider abstraction.

### Providers and models

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/providers` | List providers |
| POST | `/api/providers` | Create / update provider |
| DELETE | `/api/providers/:id` | Delete provider |
| GET | `/api/providers/:id/models` | Fetch available models from provider API |
| GET | `/api/models` | List configured models |
| POST | `/api/models` | Create / update model |
| DELETE | `/api/models/:id` | Delete model |

Supported providers: **Anthropic, OpenAI, Google, Mistral, Ollama, Claude CLI**

### Analysis

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:pid/analyze` | Stream AI analysis of project (SSE) |

### Monitoring

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:pid/visor` | Visor bulletin status |
| GET | `/api/projects/:pid/tasks` | All tasks across all agents |
| GET | `/api/projects/:pid/pipelines` | Agent pipeline definitions |

---

## Claude Code integration

### Activate agent in Claude Code

The **Config → Activate in Claude Code** button writes a `.claude/settings.json` inside the project folder:

For **Claude CLI** provider:
```json
{
  "model": "claude-sonnet-4-6"
}
```

For **any other provider** (Ollama, OpenAI, etc.):
```json
{
  "model": "<modelId>",
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3000/api/proxy",
    "ANTHROPIC_API_KEY": "legion"
  }
}
```

When `ANTHROPIC_BASE_URL` is set, Claude Code routes all its API calls through Legion's proxy, which translates the Anthropic Messages API format to the target provider's format and streams the response back in SSE format that Claude Code expects.

### Using Ollama with Claude Code

1. Configure an Ollama provider in Settings → Providers (base URL: `http://mac-mini.local:11434`)
2. Add the model in Settings → Models (select Ollama provider)
3. Assign the model to an agent in agent Config tab
4. Click "Activate in Claude Code"
5. Open a terminal in the project folder — Claude Code will use the Ollama model

---

## Web interface

### Screen structure

```
┌─────────────────────────────────────────────┐
│  Topbar: project ▾ · [+] · EN/RU · connected │
├──────────┬──────────────────────────────────┤
│  Rail    │  Main (one of four screens)       │
│          │                                  │
│  Agents  │  Dashboard  /  Catalog           │
│  ──────  │  Agent detail  /  Settings       │
│  Nav     │                                  │
└──────────┴──────────────────────────────────┘
```

Exactly one screen is active at a time (`showView()` switches all at once).

### Dashboard

- Counters: agents / workers / tasks / busy
- Activity feed
- Visor bulletins

### Catalog (Add Agent)

- 174+ agents from [agency-agents](https://github.com/msitarzewski/agency-agents)
- Group filters (14 categories)
- Search by name
- EN/RU card localization
- Add button → agent is added to project, files created in .legion

### Agent detail

10 tabs:

| Tab | What it does |
|-----|-------------|
| Overview | Description, capabilities, identity summary, Remove button |
| Chat | Real AI chat — agent introduces itself on open using its configured model |
| Workers | CRUD list of workers with dot status indicator |
| Memories | List with filter (Persistent / Temporary / Todo), synced to MEMORY.md |
| Tasks | Kanban by status (Backlog / In Progress / Ready / Done) |
| Skills | Skill registry *(runtime integration in progress)* |
| Tools | Tool configuration *(runtime integration in progress)* |
| Channels | CRUD channels (HTTP, Telegram, Discord, Webhook, MCP) |
| Cron | CRUD scheduled jobs (schedule + command + channel) |
| Config | Model selection, Claude Code activation, markdown file editors |

### Settings

3 tabs:

| Tab | What it does |
|-----|-------------|
| Overview | Project name/description/path + Delete legion / Remove project buttons |
| Providers | CRUD providers with API keys (stored separately, gitignored) |
| Models | CRUD models, fetch list from provider API |

---

## Localization

File `js/i18n.js` — EN/RU. Toggle via topbar button. Catalog cards read locale from agent MD file frontmatter.

---

## Planned (not yet implemented)

| Component | Status |
|-----------|--------|
| Swift runtime core (Channel/Branch/Worker) | Not started |
| Real-time WebSocket activity feed | Not started |
| Skills registry integration | Stub |
| Tools tab | Stub |
| SQLite persistence layer | Not started |
| Vector memory (ChromaDB) | Not started |
| Telegram / Discord gateway | Not started |
| Native macOS / iOS app | Not started |
