<p align="center">
  <img src="platforms/web/assets/characters/default.png" width="120" alt="Legion"/>
</p>

<h1 align="center">LEGION</h1>
<p align="center"><em>Local AI Agent Platform</em></p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D23-3c873a?style=flat-square&logo=node.js&logoColor=white"/>
  <img src="https://img.shields.io/badge/dependencies-zero-0ea5e9?style=flat-square"/>
  <img src="https://img.shields.io/badge/agents-174%2B-8b5cf6?style=flat-square"/>
  <img src="https://img.shields.io/badge/providers-6-f59e0b?style=flat-square"/>
  <img src="https://img.shields.io/badge/i18n-EN%20·%20RU-ec4899?style=flat-square"/>
  <img src="https://img.shields.io/badge/license-MIT-6b7280?style=flat-square"/>
</p>

<br/>

**Legion** is a local platform for building and managing AI agent teams.  
One command starts a web UI where you assemble agents, define pipelines, manage tasks and memories — all backed by SQLite, all running on your machine.

---

## Legion is right for you if

✅ You manage **multiple AI agents** across different projects and want one control plane

✅ You mix providers — **Claude, GPT, Gemini, Mistral, Ollama** — and hate configuring each tool separately

✅ You have a **Claude Max subscription** and don't want to burn API credits on orchestration work

✅ You want **AI to analyze your codebase** and recommend which agents to add — not guess manually

✅ You believe agents should have **explicit trigger chains**: who runs next, under what condition, in what order

✅ You want agent **memory to live in plain markdown files** that your coding tools already read

✅ You want something that starts in **one command** with nothing to install

---

## Start Legion in one command

```bash
git clone https://github.com/your-org/legion.git
cd legion
npm start
```

Opens `http://localhost:3000`. No `npm install`. No build step. No Docker.

```bash
npm run dev    # skip auto-opening the browser
```

---

## What Legion manages

| Concept | What it is |
|---------|------------|
| **Project** | A folder on disk with a `.legion/` directory inside |
| **Agent** | An AI persona with a model, identity, memory, tasks, and channels |
| **Pipeline** | A trigger chain — which agent fires after another, and under what condition |
| **Catalog** | 174+ ready-to-use agent definitions across 14 domains |
| **Provider** | An AI backend — Anthropic, OpenAI, Google, Mistral, Ollama, or Claude CLI |
| **Analyze** | AI-powered scan of your project that recommends which agents and skills to add |
| **Linear** | Per-project Linear integration — agents can create and update issues mid-chat |

---

## Six providers, one interface

| Provider | Auth | Notes |
|----------|------|-------|
| **Anthropic** | API key | Claude 3.5, 3.7, 4.x |
| **OpenAI** | API key | GPT-4o, o3, o4-mini |
| **Google** | API key | Gemini 2.x |
| **Mistral** | API key | Mistral Large / Medium |
| **Ollama** | None | Fully local, no internet required |
| **Claude CLI** | Max subscription | Uses your local `claude` binary — no API billing |

> Using a Claude Max subscription? Select **Claude CLI** as your provider. Legion pipes prompts through your existing `claude` session — no API credits consumed.

---

## Analyze: let AI build your agent team

Point Legion at any project. It reads your docs, scans your existing agents, and sends everything to your default model with the full catalog attached.

```
✦ Analyzing…
  Validating configuration…
  Scanning project documentation… 4 files found
  Domain detected: mobile
  Loading agent catalog… 174 agents across 14 groups
  Pass 1 — Extracting functional requirements…
  Pass 2 — Matching agents to requirements…
  Done — 11 agents recommended, 7 pipelines suggested
```

Recommendations stream live with a **Stop** button. Suggested agent IDs are resolved against the real catalog — if the AI drifts from exact catalog IDs the closest match is substituted automatically.

After analysis (or any time agents exist in the project), a **✦ Match Skills to Agents** button appears. It runs `suggest-skills` for every agent in the team and surfaces per-agent skill recommendations from Smithery, Skills.sh, and SkillsMP in one view — with **⚡ Apply All Skills** to assign everything at once.

---

## Pipelines: define what triggers what

Every agent can have outgoing trigger rules. After a task completes, Legion knows who to notify next.

```
Product Manager ──[on_success]──▶ Software Architect
                                        │
                           ┌────────────┼────────────┐
                    [parallel]     [parallel]    [parallel]
                           ▼            ▼            ▼
                     iOS Developer  Android Dev  Backend Dev
                                                     │
                                              [on_success]
                                                     ▼
                                               QA Engineer
```

Each connection carries a condition (`always` / `on_success` / `on_failure`) and a mode (`sequential` / `parallel`).

---

## Orchestrator agents

An agent with sub-agents in its pipeline becomes an **orchestrator**. When a user sends a message:

1. The orchestrator decides whether to answer directly or delegate via a `<DELEGATE>` JSON block.
2. Delegated tasks run against sub-agents in parallel.
3. The orchestrator synthesizes the results — and, if Linear is enabled, decides which tasks to create or update.

When `linearEnabled: true`, the orchestrator's synthesis prompt includes the full issue list and the `%%LINEAR_CREATE%%` / `%%LINEAR_UPDATES%%` block format. After synthesis Legion parses and executes those blocks automatically.

---

## Linear integration

Each project can connect to a Linear workspace via Settings → Integrations. Once configured, any `linearEnabled` agent can manage issues mid-chat using structured blocks at the end of its reply:

```
%%LINEAR_CREATE%%
[{"title":"Task title","description":"Markdown description","priority":"high","labelNames":["backend"]}]
%%END_LINEAR_CREATE%%

%%LINEAR_UPDATES%%
[{"issueId":"VIS-33","stateName":"In Progress","description":"Updated plan"}]
%%END_LINEAR_UPDATES%%
```

Issue identifiers (e.g. `VIS-33`) are resolved to internal UUIDs automatically before mutation.

---

## What each agent stores

Every agent in a project gets its own directory:

```
<your-project>/
└── .legion/
    └── agents/
        └── senior-developer/
            ├── AGENTS.md      ← instructions for AI coding tools (Claude Code, Cursor…)
            ├── IDENTITY.md    ← persona and character
            ├── SOUL.md        ← values and principles
            ├── USER.md        ← project and user context
            ├── MEMORY.md      ← long-term memories (synced bidirectionally with the UI)
            ├── SKILLS.md      ← assigned skills list
            └── tasks.json     ← kanban tasks
```

`AGENTS.md` and `MEMORY.md` are plain markdown — Claude Code, Cursor, and any AI coding tool reads them directly. Legion is the management layer.

---

## Agent detail — 10 tabs

| Tab | What it does |
|-----|-------------|
| **Overview** | Description, capabilities, identity summary |
| **Chat** | Real AI chat — agent introduces itself on open using its configured model |
| **Workers** | Persistent background processes with live status indicators |
| **Memories** | Persistent / Temporary / Todo memory, synced to `MEMORY.md` on disk |
| **Tasks** | Kanban board — Backlog → In Progress → Ready → Done |
| **Pipeline** | Visual trigger chain editor — add connections to other agents |
| **Skills** | Assign skills, AI-powered suggestions from Smithery / Skills.sh / SkillsMP |
| **Channels** | HTTP · Webhook · MCP |
| **Cron** | Scheduled jobs with cron expressions |
| **Config** | Model selection, Claude Code activation, markdown file editors |

---

## 174+ agents across 14 domains

| Domain | Example agents |
|--------|---------------|
| Engineering | Senior Developer, Software Architect, DevOps Automator, Security Engineer |
| Game Development | Game Designer, Level Designer, Narrative Designer, Technical Artist |
| Project Management | Product Manager, Senior Project Manager |
| Testing | QA Engineer, Performance Benchmarker |
| Design | UI/UX Designer, Brand Strategist |
| Marketing | Content Strategist, SEO Specialist, Social Media Manager |
| + 8 more | Finance, Sales, Support, Academic, and specialized roles |

---

## Architecture

```
legion/
├── bin/
│   ├── legion.js          ← CLI entry point — argument parsing only
│   └── server.js          ← HTTP server setup, route registration, static serving
├── lib/
│   ├── catalog.js         ← Markdown catalog builder (runs at startup)
│   ├── http.js            ← postJson, getJson, json(), readBody(), resolveModel()
│   ├── db.js              ← SQLite layer (node:sqlite — projects, agents, stores, events)
│   ├── io.js              ← thin facade over db; API keys stored in gitignored files
│   ├── ws.js              ← zero-dep WebSocket server (RFC 6455 via node:crypto)
│   ├── agents-fs.js       ← read/write agent markdown files on disk
│   ├── ai.js              ← provider abstraction for all 6 providers + SSE streaming
│   └── log.js             ← structured logger; level set via LEGION_LOG env var
├── routes/
│   ├── projects.js        ← /api/projects
│   ├── agents.js          ← /api/projects/:pid/agents — CRUD, avatar, stores, activate
│   ├── chat.js            ← chat, intro, orchestrator, Linear block execution
│   ├── skills.js          ← suggest-skills (SSE), assign/unassign
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

No framework. No bundler. No runtime dependencies. Node.js stdlib only.

---

## Roadmap

| Feature | Status |
|---------|--------|
| Web portal + file-based storage | ✅ Done |
| 174+ agent catalog | ✅ Done |
| 6 AI providers incl. Claude CLI | ✅ Done |
| AI-powered Analyze with two-pass SSE | ✅ Done |
| Analyze: domain detection + catalog fuzzy ID resolution | ✅ Done |
| Match Skills to Agents (bulk, one screen) | ✅ Done |
| Agent pipelines + orchestrator mode | ✅ Done |
| Bidirectional memory sync | ✅ Done |
| EN / RU localization | ✅ Done |
| Real AI chat with per-agent model routing | ✅ Done |
| Ollama proxy for Claude Code (`/api/proxy/v1/messages`) | ✅ Done |
| Modular server architecture (lib/ + routes/) | ✅ Done |
| Skills tab (assign, AI suggest, `~/.claude/skills`) | ✅ Done |
| SQLite persistence layer | ✅ Done |
| Real-time WebSocket activity feed | ✅ Done |
| Linear integration (create / update issues mid-chat) | ✅ Done |
| Per-agent file access for Claude Code CLI agents | ✅ Done |

---

## License

MIT
