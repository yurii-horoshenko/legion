# Legion Web — Setup & Launch

## Requirements

- **Node.js 18+** — install via [brew](https://brew.sh): `brew install node`

---

## Install

From the project root:

```bash
npm install -g .
```

This registers the `legion` command globally. Done once.

---

## Commands

```bash
legion web              # Start portal on http://localhost:3000
legion start            # Same as web
legion web --port 8080  # Custom port
legion web --no-open    # Don't auto-open browser
legion help             # Show all commands
```

Or without global install:

```bash
npm start               # legion web (opens browser)
npm run dev             # legion web --no-open
```

---

## Uninstall

```bash
npm uninstall -g @legion-ai/legion
```

---

## Reinstall after code changes

```bash
npm install -g .
```

---

## What happens on `legion web`

1. `bin/legion.js` parses CLI arguments
2. `lib/catalog.js` builds `catalog.json` from `core/agents/catalog/*.md` files
3. `bin/server.js` starts a local HTTP server (Node.js stdlib, zero external deps):
   - Instantiates factory modules: `createIO`, `createHTTP`, `createAI`, `createAgentFs`, `createVisor`
   - Registers route handlers from `routes/` — each receives a shared `ctx` object
   - Serves `platforms/web/` as static files
4. Opens `http://localhost:3000` in your default browser
5. `Ctrl+C` to stop

---

## Server architecture

```
bin/server.js
│
├── lib/io.js          readProjects / writeProjects / readPAgents / writePAgents
│                      readModels / writeModels / readProviders / writeProviders
│                      readIntegrations / writeIntegrations / linearQuery
│
├── lib/http.js        postJson / getJson / json(res, status, body) / readBody(req)
│
├── lib/ai.js          callAI / callAIMessages / streamOllamaToAnthropicSSE
│                      fetchRemoteModels / langDirective
│
├── lib/agents-fs.js   writeAgentFile / deleteAgentFile / agentMd
│                      syncClaudeAgents / initLegionFolder / syncLegionMd
│
├── lib/visor.js       runVisorCheck / getBulletins
│
└── routes/            Each file: module.exports = function(ctx) { return async handle(...) }
    ├── projects.js    /api/projects (CRUD + folder picker)
    ├── agents.js      /api/projects/:pid/agents (CRUD, avatar, files, stores, activate)
    ├── chat.js        /api/.../chat, /api/.../chat/intro, /api/proxy/v1/messages
    ├── config.js      /api/models, /api/providers, /api/config
    ├── analysis.js    /api/projects/:pid/analyze (SSE)
    ├── skills.js      /api/.../skills, /api/.../suggest-skills
    ├── linear.js      /api/projects/:pid/linear/*
    └── monitoring.js  /api/projects/:pid/visor, tasks, pipelines
```

All modules use Node.js stdlib only — no `npm install` ever needed.

---

## Config file locations

All config is stored in `.config/` at the Legion repo root — **fully gitignored**.  
To reset all settings, delete this folder and restart.

| File | Contents |
|------|----------|
| `legion.db` | SQLite database — projects, agents, providers, models, tasks, memories… |
| `.pkeys.json` | Provider API keys |
| `.keys.json` | Model API keys |

Keys never leave your machine.

---

## Future: publish to npm

Once ready to share publicly:

```bash
npm publish --access public
```

Then anyone installs with:

```bash
npm install -g @legion-ai/legion
legion web
```

## Future: Homebrew formula

After npm publish, a Homebrew formula can wrap it:

```ruby
class Legion < Formula
  desc "Legion AI agent platform"
  homepage "https://github.com/yourorg/legion"
  url "https://registry.npmjs.org/@legion-ai/legion/-/legion-0.1.0.tgz"

  def install
    system "npm", "install", "-g", "--prefix", prefix, "."
  end
end
```

Then: `brew install legion-ai/tap/legion`
