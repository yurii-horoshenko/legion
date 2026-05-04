<p align="center">
  <img src="https://img.shields.io/badge/⚔️_LEGION-AI_Agent_Platform-000000?style=for-the-badge" alt="Legion"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-3c873a?style=flat-square&logo=node.js&logoColor=white"/>
  <img src="https://img.shields.io/badge/dependencies-zero-0ea5e9?style=flat-square"/>
  <img src="https://img.shields.io/badge/agents-174%2B-8b5cf6?style=flat-square"/>
  <img src="https://img.shields.io/badge/providers-6-f59e0b?style=flat-square"/>
  <img src="https://img.shields.io/badge/i18n-EN%20·%20RU-ec4899?style=flat-square"/>
  <img src="https://img.shields.io/badge/license-MIT-6b7280?style=flat-square"/>
</p>

<br/>

**Legion** is a local platform for building and managing AI agent teams.  
One command starts a web UI where you assemble agents, define pipelines, manage tasks and memories — all stored as plain files on disk, all running on your machine.

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
| **Analyze** | AI-powered scan of your project that recommends which agents to add |

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
  Loading agent catalog… 174 agents across 14 groups
  Sending prompt to Claude Sonnet 4.6…
  Done — 13 agents recommended, 9 pipelines suggested
```

Recommendations arrive as a live stream — with a **Stop** button if you want to cancel mid-run.

Mandatory agents adapt to context. A game project gets PM + Architect + QA. A personal assistant project gets only what its domain actually needs.

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
            ├── tasks.json     ← kanban tasks
            ├── cron.json      ← scheduled jobs
            ├── workers.json   ← background workers
            └── channels.json  ← HTTP, Telegram, Discord, MCP endpoints
```

`AGENTS.md` and `MEMORY.md` are plain markdown — Claude Code, Cursor, and any AI coding tool reads them directly. Legion is the management layer.

---

## Agent detail — 10 tabs

| Tab | What it does |
|-----|-------------|
| **Overview** | Description, capabilities, identity summary |
| **Chat** | Inline conversation using the agent's configured model |
| **Workers** | Persistent background processes with live status indicators |
| **Memories** | Persistent / Temporary / Todo memory, synced to `MEMORY.md` on disk |
| **Tasks** | Kanban board — Backlog → In Progress → Ready → Done |
| **Skills** | Skill registry *(runtime integration in progress)* |
| **Tools** | Tool configuration *(runtime integration in progress)* |
| **Channels** | HTTP · Telegram · Discord · Webhook · MCP |
| **Cron** | Scheduled jobs with cron expressions |
| **Config** | Model selection and markdown file editors |

---

## 174+ agents across 14 domains

Legion ships with the full [agency-agents](https://github.com/msitarzewski/agency-agents) catalog:

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
├── bin/legion.js              ← HTTP server — Node.js stdlib only, zero dependencies
├── core/
│   ├── agents/catalog/        ← 174+ agent .md files with YAML frontmatter
│   ├── config/                ← projects, agents, providers, models (JSON on disk)
│   └── prompts/analyze.md     ← AI analysis prompt — edit to change recommendation logic
└── platforms/web/
    ├── index.html             ← single HTML file — the entire frontend
    ├── js/app.js              ← full SPA, vanilla JS
    ├── js/i18n.js             ← EN / RU localization
    └── css/app.css            ← all styles
```

The server is a single file. The frontend is a single file. No framework, no bundler, no runtime dependencies.

Keys are stored in `core/config/.pkeys.json` and `core/config/.keys.json` — both gitignored, never leave your machine.

---

## Roadmap

| Feature | Status |
|---------|--------|
| Web portal + file-based storage | ✅ Done |
| 174+ agent catalog | ✅ Done |
| 6 AI providers incl. Claude CLI | ✅ Done |
| AI-powered Analyze with SSE streaming | ✅ Done |
| Agent pipelines | ✅ Done |
| Bidirectional memory sync | ✅ Done |
| EN / RU localization | ✅ Done |
| Swift runtime core (Channel / Branch / Worker) | 🔲 Planned |
| Real-time WebSocket activity feed | 🔲 Planned |
| Skills registry integration | 🔲 Planned |
| SQLite persistence layer | 🔲 Planned |
| Vector memory (ChromaDB) | 🔲 Planned |
| Telegram / Discord gateway | 🔲 Planned |
| Native macOS / iOS app | 🔲 Planned |

---

## License

MIT
