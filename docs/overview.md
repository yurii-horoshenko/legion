# Legion — AI Agent Platform

> Local platform for building and managing AI agent teams.  
> Starts with one command, runs in the browser, stores everything on disk.

> **Canonical docs:** product goals/status → [GOALS.md](GOALS.md); hardening (Phase 0–6
> subsystems + extended schema: memory/FTS5/embeddings/edges/outbox/recall-log, trace_id,
> hooks, toolgate, dag, cron) → [IMPROVEMENT-PLAN.md](IMPROVEMENT-PLAN.md). The architecture
> below describes the **core request flow**; it does not list every Phase 0–6 module.

---

## Architecture

```
legion/
├── bin/
│   ├── legion.js          ← CLI entry — argument parsing only
│   └── server.js          ← HTTP server setup, route registration, static serving
├── lib/
│   ├── catalog.js         ← Markdown catalog builder (runs at startup)
│   ├── http.js            ← postJson, getJson, json(res,status,body), readBody(req), resolveModel()
│   ├── db.js              ← SQLite layer via node:sqlite
│   ├── io.js              ← thin facade over db; API keys stored in gitignored files
│   ├── ws.js              ← zero-dep WebSocket server (RFC 6455 via node:crypto)
│   ├── agents-fs.js       ← read/write agent markdown files on disk
│   ├── ai.js              ← provider abstraction for all 6 providers + SSE streaming
│   └── log.js             ← structured logger; level set via LEGION_LOG env var
├── routes/
│   ├── projects.js        ← /api/projects
│   ├── agents.js          ← /api/projects/:pid/agents — CRUD, avatar, stores, activate
│   ├── chat.js            ← chat, intro, orchestrator, Linear block execution
│   ├── skills.js          ← suggest-skills (SSE), assign/unassign, available
│   ├── config.js          ← /api/models, /api/providers, /api/config
│   ├── analysis.js        ← /api/projects/:pid/analyze (two-pass SSE)
│   ├── linear.js          ← /api/projects/:pid/linear/* (teams, issues, states, labels)
│   └── monitoring.js      ← visor, tasks, pipelines
├── core/
│   ├── agents/catalog/    ← 174+ agent .md files (YAML frontmatter + description)
│   └── prompts/           ← AI prompts: analyze.md, analyze-pass1.md, skill-suggest.md,
│                             chat-orchestrator.md — edit to tune recommendation logic
├── .config/               ← all user data — fully gitignored, delete to reset
│   ├── legion.db          ← SQLite: projects, agents, models, providers, tasks, memories…
│   ├── .pkeys.json        ← provider API keys
│   └── .keys.json         ← model API keys
└── platforms/web/
    ├── index.html
    ├── js/
    │   ├── app.js         ← bootstrap & event listeners
    │   ├── i18n.js        ← EN / RU localization
    │   ├── modules/       ← state.js, utils.js, api.js
    │   ├── ui/            ← topbar, sidebar, dashboard, agent-panel, catalog, analyze
    │   ├── tabs/          ← one file per agent tab (chat, tasks, memories, skills…)
    │   └── modals/        ← project, decompose, mini modals
    └── css/               ← component CSS files loaded directly by index.html
```

### Project file storage

Each project can be linked to a folder on disk. On link, Legion creates:

```
<project-path>/
└── .legion/
    ├── LEGION.md              ← project metadata (frontmatter)
    └── agents/
        └── <agent-id>/
            ├── agent.md       ← agent frontmatter (id, model, linearEnabled, etc.)
            ├── AGENTS.md      ← instructions for AI coding tools (Claude Code, Cursor…)
            ├── IDENTITY.md    ← persona and character
            ├── SOUL.md        ← values and principles
            ├── USER.md        ← project and user context
            ├── MEMORY.md      ← long-term memories (synced bidirectionally with the UI)
            ├── SKILLS.md      ← assigned skills list
            ├── tasks.json     ← kanban tasks
            ├── cron.json      ← scheduled jobs
            ├── workers.json   ← background workers
            └── channels.json  ← HTTP, Webhook, MCP endpoints
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
| POST | `/api/projects/:pid/agents` | Add agent (defaults: model from config, linearEnabled, allowedTools) |
| DELETE | `/api/projects/:pid/agents/:aid` | Remove agent |
| POST | `/api/projects/:pid/agents/:aid/activate` | Write `.claude/settings.json` for this agent |

When adding a new agent, `agent.model` is resolved from the configured `defaultModelId` as a `modelId` string (e.g. `claude-sonnet-4-6`), not a record UUID.

### Agent files

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:pid/agents/:aid/files/:name` | Read a markdown file |
| PUT | `/api/projects/:pid/agents/:aid/files/:name` | Save a markdown file |

Available names: `agent.md`, `AGENTS.md`, `IDENTITY.md`, `SOUL.md`, `USER.md`, `MEMORY.md`

### Agent stores (Tasks / Cron / Workers / Channels / Memories)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:pid/agents/:aid/:store` | List items |
| POST | `/api/projects/:pid/agents/:aid/:store` | Add item |
| PATCH | `/api/projects/:pid/agents/:aid/:store/:id` | Update item |
| DELETE | `/api/projects/:pid/agents/:aid/:store/:id` | Delete item |

`:store` — one of: `tasks`, `cron`, `workers`, `channels`, `memories`, `pipeline`

### Chat

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects/:pid/agents/:aid/chat/intro` | Agent self-introduction (SSE) |
| POST | `/api/projects/:pid/agents/:aid/chat` | Send message, get AI response (SSE) |

Both endpoints use the model and provider configured for that agent. System prompt is built from the agent's IDENTITY.md, SOUL.md, and USER.md.

**Orchestrator flow** (agent has pipeline sub-agents):
1. Orchestrator decides to delegate via `<DELEGATE>[{"agentId":"...","task":"..."}]</DELEGATE>`.
2. Sub-agent tasks run in parallel.
3. Orchestrator synthesizes results (single delegate skips synthesis unless `linearEnabled`).
4. If `linearEnabled`, synthesis prompt includes the full issue list and Linear block format; any `%%LINEAR_CREATE%%` / `%%LINEAR_UPDATES%%` blocks in the reply are executed automatically.

### Claude Code proxy

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/proxy/v1/messages` | Anthropic-compatible endpoint routed to any provider |

Set `ANTHROPIC_BASE_URL=http://localhost:3000/api/proxy` in Claude Code's environment to route it through Legion's provider abstraction (enables Ollama, OpenAI, etc.).

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

### Skills

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:pid/agents/:aid/suggest-skills` | AI skill suggestions from Smithery, Skills.sh, SkillsMP (SSE) |
| GET | `/api/projects/:pid/agents/:aid/skills` | List assigned skills |
| POST | `/api/projects/:pid/agents/:aid/skills/:skillId` | Assign skill to agent |
| DELETE | `/api/projects/:pid/agents/:aid/skills/:skillId` | Remove skill from agent |
| GET | `/api/skills/available` | List skills installed in `~/.claude/skills/` |

### Analysis

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects/:pid/analyze` | Two-pass AI analysis (SSE) |

**Two-pass process:**
1. Pass 1 (`analyze-pass1.md`) — extracts functional areas and tech stack from project docs.
2. Pass 2 (`analyze.md`) — matches catalog agents to functional areas.

After the AI response, agent IDs are resolved against the real catalog (exact → name → partial word match) to prevent hallucinated IDs creating empty custom agents.

**Domain detection** narrows the catalog before Pass 2: `game`, `web`, `mobile`, `backend`, `marketing`, `assistant`, or `general` (all groups). Scanning reads `README.md`, `CLAUDE.md`, `package.json`, `pyproject.toml`, `Cargo.toml`.

### Linear

| Method | Path | Description |
|--------|------|-------------|
| GET/PUT | `/api/projects/:pid/integrations` | Read / write project integrations (Linear API key, teamId) |
| GET | `/api/projects/:pid/linear/teams` | List Linear teams |
| GET | `/api/projects/:pid/linear/issues` | List issues (filter by teamId, labelName) |
| GET | `/api/projects/:pid/linear/labels` | List labels |
| POST | `/api/projects/:pid/linear/labels` | Create label |
| GET | `/api/projects/:pid/linear/states` | List workflow states |
| POST | `/api/projects/:pid/linear/issues` | Create issue |
| PATCH | `/api/projects/:pid/linear/issues/:iid` | Update issue state / title / description |
| PATCH | `/api/projects/:pid/linear/issues/:iid/labels` | Set labels on issue |
| POST | `/api/projects/:pid/linear/auto-assign` | AI bulk assignment of issues to agents (SSE) |

Issue identifiers (e.g. `VIS-33`) are resolved to internal UUIDs automatically via `issue(id:)` before mutation.

### Monitoring

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:pid/visor` | Visor bulletin status |
| GET | `/api/projects/:pid/tasks` | All tasks across all agents |
| GET | `/api/projects/:pid/pipelines` | Agent pipeline definitions |

---

## Linear block protocol

Agents with `linearEnabled: true` receive the block format in their system prompt. Blocks must appear at the **end** of the reply and use exact closing tags:

```
%%LINEAR_CREATE%%
[{"title":"...","description":"...","priority":"urgent|high|medium|low","labelNames":["Label"]}]
%%END_LINEAR_CREATE%%

%%LINEAR_UPDATES%%
[{"issueId":"PROJ-XX","stateName":"In Progress","title":"...","description":"..."}]
%%END_LINEAR_UPDATES%%
```

- `issueId` accepts display identifiers (`VIS-33`) or internal UUIDs — resolved automatically.
- Both blocks can appear together in one reply.
- Orchestrator synthesis prompts explicitly include the block format and issue list so the PM agent can decide what to update even when sub-agents don't know about Linear.

---

## Claude Code integration

### Activate agent in Claude Code

The **Config → Activate in Claude Code** button writes `.claude/settings.json` inside the project folder.

For **Claude CLI** provider:
```json
{ "model": "claude-sonnet-4-6" }
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

### Per-agent file access

When `agent.allowedTools` includes `Read,LS,Glob,Grep`, the agent's system prompt gets a file access block and `ai.callAIMessages` is invoked with those tools enabled. The Claude CLI provider handles tool calls natively via the `claude` binary.

---

## Web interface

### Screen structure

```
┌─────────────────────────────────────────────┐
│  Topbar: project ▾ · [+] · EN/RU · connected │
├──────────┬──────────────────────────────────┤
│  Rail    │  Main (one of five screens)       │
│          │                                  │
│  Agents  │  Dashboard  /  Catalog           │
│  ──────  │  Agent detail  /  Analyze        │
│  Nav     │  Settings                        │
└──────────┴──────────────────────────────────┘
```

`showView()` in `dashboard.js` switches all screens.

### Analyze screen

- **✦ Analyze** — two-pass AI analysis of the project; streams progress via SSE.
- Results: agents grid (mandatory/additional) + pipelines list + **✦ Match Skills to Agents**.
- **⚡ Add & Apply All** — adds all suggested agents and applies all suggested pipelines in one click.
- **✦ Match Skills to Agents** — runs `suggest-skills` sequentially for each project agent; shows per-agent cards with Smithery/Skills.sh/SkillsMP recommendations; **⚡ Apply All Skills** assigns everything at once.
- The "Match Skills" button also appears on the initial analyze screen when agents already exist (no re-analysis needed).

### Agent detail — 10 tabs

| Tab | What it does |
|-----|-------------|
| Overview | Description, capabilities, identity summary, Remove button |
| Chat | Real AI chat — agent introduces itself on open using its configured model |
| Workers | CRUD list of background workers with dot status indicator |
| Memories | List with filter (Persistent / Temporary / Todo), synced to MEMORY.md |
| Tasks | Kanban by status (Backlog / In Progress / Ready / Done) |
| Pipeline | Visual trigger chain — add connections to other agents with condition/mode |
| Skills | Assign skills, AI-powered suggestions, `~/.claude/skills` browser |
| Channels | CRUD channels (HTTP, Webhook, MCP) |
| Cron | CRUD scheduled jobs (schedule + command + channel) |
| Config | Model selection, Claude Code activation, markdown file editors |

---

## Localization

`js/i18n.js` — EN/RU. Toggle via topbar button. Catalog cards read locale from agent MD frontmatter.

---

## Logging

Set `LEGION_LOG=debug` to enable debug-level output. Default is `info`.  
Logs go to stdout/stderr only — no log files.
