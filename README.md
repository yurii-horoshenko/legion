<p align="center">
  <h1 align="center">⚔️ Legion</h1>
  <p align="center"><strong>AI Agent Platform — local, zero-dependency, one command away</strong></p>
  <p align="center">
    <a href="#quick-start"><img src="https://img.shields.io/badge/quick_start-→-000000?style=flat-square&logoColor=white" alt="Quick Start"/></a>
    <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="Node.js"/>
    <img src="https://img.shields.io/badge/dependencies-zero-blue?style=flat-square" alt="Zero Dependencies"/>
    <img src="https://img.shields.io/badge/agents-174%2B-8b5cf6?style=flat-square" alt="174+ Agents"/>
    <img src="https://img.shields.io/badge/license-MIT-gray?style=flat-square" alt="MIT License"/>
    <img src="https://img.shields.io/badge/i18n-EN%20%2F%20RU-orange?style=flat-square" alt="EN/RU"/>
  </p>
</p>

---

> **Legion** is a local operations platform for managing AI agent teams.  
> It runs in your browser, stores everything on disk, and needs nothing but Node.js.

---

## Legion is right for you if

✅ You want to manage a **team of AI agents** without setting up cloud infrastructure

✅ You run multiple projects and need **one place** to see all your agents, tasks, and memories

✅ You work across **Anthropic, OpenAI, Google, Mistral, Ollama** — and want to mix them freely

✅ You have a **Claude Max subscription** and don't want to burn API credits for orchestration

✅ You want **AI to recommend which agents** your project actually needs — based on your codebase and docs

✅ You think agent workflows should have **explicit pipelines**: who triggers whom, under what conditions

✅ You want agent **memories to sync bidirectionally** with markdown files your AI coding tools already read

✅ You believe a local-first tool should have **zero runtime dependencies** and start instantly

---

## What is Legion

Legion is a control plane for AI agent teams. You create projects, assemble agents from a 174+ catalog, configure their models and providers, define pipelines, and manage tasks — all from a clean web UI that runs entirely on your machine.

| Component | What it does |
|-----------|-------------|
| `bin/legion.js` | 🖥️ HTTP server — Node.js stdlib only, zero npm dependencies |
| `core/agents/catalog/` | 📦 174+ agent definitions across 14 domains |
| `core/config/` | 💾 File-based store — projects, agents, providers, models, keys |
| `platforms/web/` | 🌐 Vanilla JS SPA — one HTML file, no framework |
| `core/prompts/analyze.md` | 🤖 AI analysis prompt — recommends your agent team |

Every agent lives at `<project>/.legion/agents/<id>/` — plain files your IDE and coding agents can read directly.

---

## Features

| Feature | What you get |
|---------|-------------|
| 🤖 **Agent catalog** | 174+ agents across Engineering, Game Dev, Design, Marketing, and 10 more domains |
| 🧠 **AI-powered Analyze** | Point Legion at a project — it reads docs and recommends agents with context-aware reasoning |
| 🔗 **Agent pipelines** | Define trigger chains: who runs after whom, sequential or parallel, on success or failure |
| 💾 **Memory sync** | Bidirectional sync between the UI memory store and `MEMORY.md` on disk |
| 🔌 **Multi-provider** | Anthropic · OpenAI · Google · Mistral · Ollama · Claude CLI (Max subscription) |
| 📋 **10-tab agent detail** | Overview · Chat · Workers · Memories · Tasks · Skills · Tools · Channels · Cron · Config |
| 📡 **SSE streaming** | Long-running AI calls stream progress live — with a Stop button |
| 🌍 **EN / RU i18n** | Full localization, switchable in one click |
| 🔒 **Keys stay local** | API keys stored in gitignored `.pkeys.json` / `.keys.json` — never leave your machine |
| ⚡ **Zero dependencies** | One `node bin/legion.js` — nothing to install, nothing to configure |

---

## Quick Start

```bash
git clone https://github.com/your-org/legion.git
cd legion
npm start
```

Opens `http://localhost:3000` automatically.

```bash
npm run dev     # same, without auto-opening the browser
```

That's it. No build step, no `npm install`, no Docker.

---

## Providers

Legion connects to your existing accounts — you bring the key, Legion stores it locally.

| Provider | Type | Notes |
|----------|------|-------|
| **Anthropic** | API | Claude 3.5 / 3.7 / 4.x |
| **OpenAI** | API | GPT-4o, o3, o4-mini |
| **Google** | API | Gemini 2.x |
| **Mistral** | API | Mistral Large / Medium |
| **Ollama** | Local | No key needed — runs on your machine |
| **Claude CLI** | Max subscription | No API credits — uses your `claude` CLI auth |

> **Using Claude Max?** Select the Claude CLI provider — Legion pipes prompts directly into your `claude` session. No API billing.

---

## Agent Detail — 10 Tabs

Every agent in Legion has a full detail view with 10 tabs:

| Tab | What it does |
|-----|-------------|
| **Overview** | Description, capabilities, vibe — and a Remove button |
| **Chat** | Inline conversation with the agent using its configured model |
| **Workers** | Manage persistent background processes with status indicators |
| **Memories** | Persistent / Temporary / Todo memory store, synced to `MEMORY.md` |
| **Tasks** | Kanban board — Backlog → In Progress → Ready → Done |
| **Skills** | Skill registry (runtime integration pending) |
| **Tools** | Tool configuration (runtime integration pending) |
| **Channels** | HTTP · Telegram · Discord · Webhook · MCP endpoints |
| **Cron** | Scheduled jobs with cron expressions |
| **Config** | Model selection + Markdown file editors (IDENTITY, SOUL, USER, AGENTS) |

---

## Agent Pipelines

Define how agents chain together after task completion:

```
Product Manager
    └──[on_success]──▶ Software Architect
                            └──[on_success, parallel]──▶ iOS Developer
                            └──[on_success, parallel]──▶ Android Developer
                            └──[on_success, parallel]──▶ Backend Developer
                                        └──[on_success]──▶ QA Engineer
```

Each connection carries a condition (`always` / `on_success` / `on_failure`) and a mode (`sequential` / `parallel`).

---

## AI Analyze

Point Legion at any project and it will:

1. Read your `README.md`, `CLAUDE.md`, `package.json`, and `docs/`
2. Scan your existing agent team
3. Send everything to your default model with the full 174-agent catalog
4. Stream back a structured recommendation — with tiered reasoning

```
✦ Analyzing…
  → Validating configuration…
  → Scanning project documentation… (3 files found)
  → Loading agent catalog… (174 agents, 14 groups)
  → Sending prompt to Claude Sonnet 4.6…
  → Done — 12 agents recommended, 8 pipelines suggested
```

Mandatory agents are context-aware: a game project gets PM + Architect + QA. A personal assistant project gets only what it actually needs.

---

## Project File Layout

```
<your-project>/
└── .legion/
    ├── LEGION.md              ← project metadata
    └── agents/
        └── <agent-id>/
            ├── agent.md       ← id, model, added date
            ├── AGENTS.md      ← instructions for AI coding tools
            ├── IDENTITY.md    ← agent character and persona
            ├── SOUL.md        ← values and principles
            ├── USER.md        ← user and project context
            ├── tasks.json     ← kanban tasks
            ├── cron.json      ← scheduled jobs
            ├── workers.json   ← worker records
            ├── channels.json  ← channel configs
            └── memories.json  ← long-term memory store
```

The `AGENTS.md` and `MEMORY.md` files are readable by Claude Code, Cursor, and any AI coding agent — Legion is the management layer, not the runtime.

---

## Architecture

```
legion/
├── bin/legion.js              ← HTTP server (Node.js stdlib, zero deps)
├── core/
│   ├── agents/catalog/        ← 174+ agents (.md files with frontmatter)
│   ├── config/                ← projects, agents, providers, models
│   └── prompts/analyze.md     ← AI analysis prompt template
└── platforms/web/
    ├── index.html             ← single HTML file
    ├── js/app.js              ← full SPA (~2100 lines, vanilla JS)
    ├── js/i18n.js             ← EN/RU localization
    └── css/app.css            ← all styles (~2000 lines)
```

The server is a single Node.js file. No Express, no Fastify, no build toolchain. The frontend is a single HTML file. No React, no Vue, no bundler.

---

## FAQ

### Do I need to install anything besides Node.js?

No. `npm start` is the only command. There's no `npm install` because there are no dependencies.

### Where are API keys stored?

In `core/config/.pkeys.json` (provider keys) and `core/config/.keys.json` (model-specific keys). Both are gitignored and never leave your machine.

### Can I use it with my Claude Max subscription?

Yes. Add a Claude CLI provider — Legion will pipe prompts into your local `claude` binary using your existing Max auth. No API billing.

### What's the agent catalog?

174 agents from the [agency-agents](https://github.com/msitarzewski/agency-agents) collection, organized across 14 groups: Engineering, Game Development, Design, Marketing, Testing, Project Management, Finance, Sales, and more.

### Does it work offline?

The platform itself is fully local. AI calls obviously require connectivity to whatever provider you're using — except Ollama, which is fully offline.

### Is there a native app or mobile client?

Not yet. Web UI only for now. Native macOS and iOS clients are on the roadmap.

---

## Roadmap

| Component | Status |
|-----------|--------|
| Web portal + file storage | ✅ Shipped |
| 174+ agent catalog | ✅ Shipped |
| Multi-provider AI (6 providers) | ✅ Shipped |
| AI-powered project Analyze (SSE) | ✅ Shipped |
| Agent pipelines | ✅ Shipped |
| Bidirectional memory sync | ✅ Shipped |
| Claude CLI / Max subscription | ✅ Shipped |
| Swift runtime core (Channel / Branch / Worker) | 🔲 Planned |
| WebSocket live log | 🔲 Planned |
| Skills tab (registry integration) | 🔲 Planned |
| Real Chat (model connection) | 🔲 Planned |
| Dashboard live activity feed | 🔲 Planned |
| iOS / macOS native app | 🔲 Planned |
| SQLite persistence | 🔲 Planned |
| Vector memory (ChromaDB) | 🔲 Planned |
| Telegram / Discord gateway | 🔲 Planned |

---

## License

MIT — see [LICENSE](LICENSE)
