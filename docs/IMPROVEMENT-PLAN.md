# Legion Improvement Plan — Ports from ruflo & Sloppy

> Branch: `feat/competitor-ports`. Goal: port the genuinely useful, code-verified ideas from
> ruflo (TypeScript, ex-claude-flow) and Sloppy (Swift 6) into Legion, respecting the
> **zero-dependency Node stdlib** constraint. No new npm packages.
>
> Source review findings live in the session that produced this plan. Each item below cites
> the upstream file it derives from and the Legion file(s) it touches.

## Conventions
- Only `node:` stdlib (`node:sqlite`, `http`, `https`, `crypto`, `child_process`, `node:test`).
- New self-contained modules go in `lib/`. Tests go in `test/*.test.js` (run with `node --test`).
- `node --check <file>` after every edit. `lib/io.js` is the only DB-touching layer (keep it that way for new code where practical).
- No commit until the user explicitly asks.

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done

---

## Phase 0 — Robustness (quick, high-visibility) ✅
- [x] **0.1** Circuit breaker + retry/backoff → `lib/breaker.js` + rewritten `lib/http.js` (status-aware, retryable 408/429/5xx, Retry-After honored, per-host breaker). Tests: `test/breaker.test.js` (5 pass). Src: ruflo `providers/src/base-provider.ts:37`.
- [x] **0.2** Provider failover → `ai.buildFailoverCandidates` + `ai.callAIMessagesFailover`; wired into orchestrator analyze, synthesis, leaf sub-agents, and direct chat in `routes/chat.js`. Src: ruflo `integration/.../provider-adapter.ts:454/599`.
- [x] **0.3** Degradation ladder → `ai.callAIMessagesResilient` (failover + empty-response repair retry) + 12s `withHeartbeat` progress ping so UI never looks frozen. Src: Sloppy `RuntimeSystem.swift:466`. NOTE: true per-token UI streaming deferred — needs frontend (`platforms/web/js`) work; tracked as 0.3b.
- [x] **0.4** Re-scoped: claude-cli runs its own internal tool loop, so a Legion-level ToolLoopGuard belongs with the Phase 2 tool runtime. Phase-0 substitute: `MAX_DELEGATIONS=8` fan-out cap in `routes/chat.js`. Real loop guard → Phase 2.
- [ ] **0.3b** (follow-up) Per-token SSE streaming to the web UI.

## Phase 1 — Memory & context ✅
- [x] **1.1** `lib/vector.js` — cosine/normalize/topK/min-max-merge. DESIGN CALL: exact brute-force cosine over Float32, not HNSW — HNSW only pays off past ~10^5 vectors, which Legion won't hit; API is index-shaped so ANN can slot in later. Tests: `test/vector.test.js`. Src: ruflo `memory/src/hnsw-index.ts`.
- [x] **1.2** Hybrid recall → `lib/memory.js` + memory schema/methods in `lib/db.js` (`memories`, `memories_fts` FTS5 (confirmed available on Node 26), `memory_embeddings` Float32 BLOB, `memory_edges`). recall = FTS5 bm25 + cosine, weighted max-merge, 1-hop graph-expand, per-kind expiry. Embeddings via new `ai.embed()` (openai/ollama/google), best-effort → degrades to keyword. Tests: `test/memory.test.js`. Src: Sloppy `HybridMemoryStore.swift:134`.
- [x] **1.3** `lib/compactor.js` — threshold compaction (0.80/0.85/0.95), per-key single-drain, FNV-1a hash gate, backoff; injected summarize fn. Tests: `test/compactor.test.js`. Src: Sloppy `Compactor.swift`, `Visor.swift:685`.
- [x] **Wiring**: `ctx.memory`/`ctx.compactor` in `bin/server.js`; `routes/chat.js` now injects a recall block, compacts history instead of blind-slicing, and stores each turn. Boot + 20/20 tests verified.

## Phase 2 — Tool / security runtime ✅
- [x] **2.1** `lib/toolgate.js` — 4-stage gate `authorize → rate-limit → loop-guard → pre-hook`, sliding-60s `RateLimiter`, workspace-jail. Also the `0.4` loop guard (per-session round budget). Tests: `test/toolgate.test.js`. Src: Sloppy `ToolAuthorizationService.swift`, `CoreService+Tools.swift:79`.
- [x] **2.2** `runPreHook` child-process JSON contract (stdin `{version,agentId,tool,arguments,workingDirectory}` → stdout `{action,arguments?,message?}`), timeout + max-output + allow/block failure policy. Tested with a real veto + arg-rewrite hook. Src: Sloppy `ToolPreHookService.swift`.
- [x] **2.3** `lib/defence.js` — threat regex (override/role/jailbreak/fake-system/exfiltration) + PII (email/ssn/cc/ip) + NFKC & zero-width strip; `wrapUntrusted`/`redactPII`. Wired: `ai.js` claude-cli now strips dangerous tools before `--dangerously-skip-permissions`; `chat.js` normalizes all external Linear content before it enters prompts. Tests: `test/defence.test.js`. Src: ruflo `aidefence/.../threat-detection-service.ts`.
- [x] **2.4** Fixed 4 Linear GraphQL string-interpolation sites in `routes/chat.js` (issue detail, resolveIssueId, state map, label map) → parameterized via `$id`/`$t` variables (`io.linearQuery` already supported `variables`).
- [x] **Wiring**: `ctx.defence`/`ctx.toolGate` in `bin/server.js`. Boot + 33/33 tests verified.

## Phase 3 — Hooks + observability + durable storage ✅
- [x] **3.1** `lib/hooks.js` — priority-ordered registry, `abort` short-circuit, `data` passthrough, per-hook timeout + continueOnError; EVENTS for session/chat/route/tool/agent/delegate lifecycle + PRIORITY bands. Wired: `ctx.hooks`; `chat.js` emits CHAT_START (can veto), CHAT_REPLY, CHAT_ERROR on both direct + orchestrator paths. Tests: `test/hooks.test.js`. Src: ruflo `hooks/src/{types,registry,executor}`.
- [x] **3.2** `trace_id` added to `events` + `chat_logs` (idempotent ALTER migration, verified on the real on-disk DB); `db.getTrace(traceId)` reconstructs a run. Boot no longer wipes `chat_logs` — replaced with bounded `pruneChatLogs` (30d / 20k rows). Direct path fully trace-tagged; orchestrator bookends tagged. Src: Sloppy EventBus→events.
- [x] **3.3** Transactional outbox: `memInsert(..., {enqueueEmbed})` commits canonical row + `memory_outbox` row atomically; `memory.startIndexer()` drains every 2s (single-drain guard, exponential backoff, `attempts`/`next_retry_at`). Pending rows survive restart = crash recovery (Legion has no long-running run state to replay beyond this — runs are request-scoped). Tests in `test/memory.test.js`. Src: Sloppy `MemoryOutboxIndexer.swift:441`, `RecoveryManager.swift`.

## Phase 4 — Orchestration depth ✅
- [x] **4.1** `lib/dag.js` — `validate(tasks,{maxDepth})`: dedup, dependency-existence, self-dep, 3-color DFS cycle check, depth bound, and parallel-wave layering. Wired into `routes/chat.js`: delegations now run in dependency-ordered waves; no-deps or invalid graph → flat parallel (backward-compatible). `chat-orchestrator.md` prompt updated to allow optional `id`/`dependencyIds`. Tests: `test/dag.test.js`. Src: Sloppy `SwarmPlanner.swift`/`SwarmCoordinator.swift:78`; ruflo `task-orchestrator.ts:283`.
- [x] **4.2** Branch-fork isolation in `callAgent`: each sub-agent gets a SCOPED context (task-specific memory recall + a bounded task-file excerpt) instead of the entire growing document (fixes token blowup); on conclude its result is stored as one memory with a `derivedFrom` edge to the run's parent memory node. Src: Sloppy `BranchRuntime.swift`.

## Phase 5 — Hygiene (cross-cutting) ✅
- [x] **5.1** `node:test` suite — **54 tests across 9 files**: breaker, vector, memory (+outbox), compactor, defence, toolgate, hooks, dag, orchestrator. Run with `node --test`.
- [x] **5.2** `lib/orchestrator.js` — shared pure parsers (`parseDelegate`, `stripDelegate`, `parseLinearBlock`, `PRIORITY_MAP`), the single source of truth now used by BOTH `routes/chat.js` and `bin/legion.js` (removes the drift-prone duplicated regex+JSON). Also fixed the same Linear GraphQL injection sites in `bin/legion.js` for consistency with 2.4. Tests: `test/orchestrator.test.js`. NOTE: full engine dedup (the CLI's `runDelegations`/`buildSystemPrompt` still mirror chat.js) deferred — high-risk rewrite, lower-traffic path; parsers were the drift hotspot.
- [x] **5.3** `readBody` distinguishes empty body ({}) from malformed JSON (`{__invalidJson:true}`) → server returns 400; cross-origin browser requests to `/api/` are rejected 403 (localhost Origin + server-to-server allowed). Verified at runtime.

---

## Phase 6 — Further improvements (post-review) ✅
- [x] **6.1a** Built-in **defence hook** — opt-in (`config.defenceBlockCritical`) `CHAT_START` hook at CRITICAL priority that aborts on critical injection markers; uses the Phase 3 hooks abort contract + Phase 2 `defence`.
- [x] **6.1b** **Failover on the intro endpoint** (was the last single-call path).
- [x] **6.1c** **Recall telemetry** — `memory_recall_log` table + `memory.recall` logs latency + winning ids per query (Sloppy `memory_recall_log`).
- [x] **6.1d** **Run-timeline API** — `GET /api/trace/:traceId` reconstructs a run from `chat_logs` via `db.getTrace` (UI tab still TODO).
- [x] **6.2** **Memory maintenance daemon** — `memory.startMaintenance()` runs expiry-prune + `db.memDecay` (importance decay toward a floor) hourly; ruflo `consolidator` / Sloppy Visor decay in spirit. Tests in `test/memory.test.js`.
- [x] **6.3** **Cron runtime** (activates the previously inert cron UI): `lib/cron.js` (5-field matcher: `*`,`*/n`,`a-b`,`a,b`, DOW 0/7, OR-semantics), `lib/runner.js` (headless direct agent run w/ failover + memory), `lib/scheduler.js` (60s tick, per-job/minute dedup, fires due enabled jobs). Wired in `bin/server.js`. Tests: `test/cron.test.js`, `test/scheduler.test.js`.

### Phase 6 — deferred to a later pass (documented, not done)
- **MCP client** (connect external MCP servers as tools) — biggest remaining capability gap vs both competitors; L.
- **Executable workers / channels runtime** — `workers` store is a status tracker (no `command`) and `channels` need inbound HTTP routing + auth; both need a small schema/security decision before wiring. The headless `runner` is ready to power them.
- **Server auth token**, **async-sqlite offload**, **HTTP-flow integration tests**, **per-token UI streaming (0.3b)**, **trace UI tab**.

---

## Phase 7 — Product-goal closure ✅
- [x] **7.1 Goal 5 enforced** — `lib/capture.js`: in-code code-review pass + docs/changelog pass + session-note archive to `<project>/.legion/sessions/`, wired into `routes/chat.js` orchestrator (config `autoReviewDocs`, default on; implementation-intent gated). Replaces the prompt-only Phase 6/8. Tests: `test/capture.test.js`. See [GOALS.md](./GOALS.md) Goal 5.
- [x] **7.2 Review/docs via catalog agents** — `capture.findRoleAgent` delegates review/docs to the project's `code-reviewer`/`technical-writer` agents (headless runner) when present, else built-in prompts.
- [x] **8.1 Agent STATS.md (ADR-0005 observation)** — `lib/stats.js` records attempts/successes/deduped failure modes per agent to `.legion/agents/<id>/STATS.md` on every delegation outcome. Tests: `test/stats.test.js`.
- [x] **9.1 Real tool-execution loop** — `lib/tools.js` (jailed Read/Write/Edit/LS/Glob/Grep), `orchestrator.parseToolCall`, `lib/agentloop.js` (model→`%%TOOL%%`→execute via `toolGate`→`%%TOOL_RESULT%%`→repeat, round/budget capped). Wired into the leaf agent path for non-claude-cli providers; config `toolExecution` = `false` | `"readonly"` (default) | `"full"`. Gives API-provider agents real file work and is the substrate MCP plugs into. Tests: `test/tools.test.js`, `test/agentloop.test.js`.
- [ ] **planned** — MCP client (now unblocked — register MCP tools into the same loop); Goal 4 chat-driven setup; ADR-0005 retrospective pass; surface review findings as Linear issues.

## Phase 10 — UI surfacing (make the new backend visible) ✅
The backend grew through Phases 0–9 but the UI was blind to most of it. Surfaced:
- [x] **Tool calls in chat** — `tool` SSE events now render as `🔧 <name> ✓/✗` in the orchestrator stream (`chat.js` + `.orch-tool` CSS).
- [x] **Agent STATS in Overview** — new `GET /api/projects/:pid/agents/:aid/stats` (reads `lib/stats`); Overview hero card shows attempts / success-rate / top failure patterns and raises a "recurring failure" insight (closes the visible side of ADR-0005 / Goal 3 weaknesses).
- [x] **Runtime config in Settings → General** — `toolExecution` (off/read-only/full), `autoReviewDocs`, `defenceBlockCritical` toggles (PUT `/api/config`). The tool-write product decision is now a UI control.
- [x] **Provider health endpoint** — `GET /api/health` exposes circuit-breaker states (failover visibility).
- [x] **Run-trace viewer** (Phase 11) — agent replies carry their `trace`; a collapsible "🔍 Run trace" under the reply lazy-loads `/api/trace/:id` and renders the run timeline (`chat.js` + CSS).
- [x] **Cron live status** (Phase 11) — scheduler tags `cron:*` events with `jobId`; `GET /api/projects/:pid/cron-runs` returns last status per job; the Cron tab shows "✓/✗ Nm ago" per job.
- [ ] (planned) per-provider health badge in Settings (endpoint exists); semantic-memory / recall-log inspector; cron tab auto-refresh.

> UI changes are syntax-checked + boot-verified, but need a **live visual pass** (no UI test harness).

> Canonical product goals + status: [GOALS.md](./GOALS.md).

---

## Summary
Phases 0–7 implemented on branch `feat/competitor-ports`. New modules: `lib/{breaker,vector,memory,compactor,defence,toolgate,hooks,dag,orchestrator,cron,runner,scheduler,capture,stats,tools,agentloop}.js`. Schema additions in `lib/db.js` (memory + FTS5 + embeddings + edges + outbox + recall-log + trace_id). Wiring in `bin/server.js`, `routes/chat.js`, `routes/monitoring.js`, `lib/ai.js`, `lib/http.js`, `bin/legion.js`. **93/93 tests green; server boots clean (indexer + maintenance + scheduler running); on-disk migration verified.** Not committed (awaiting review). Live end-to-end run with real LLM keys still pending.

## Explicitly NOT porting
- PBFT/Raft/Gossip consensus (multi-process trust; overkill for local).
- ML embeddings hype / AgentDB-as-core / "89% routing" (marketing / optional wrappers).
- Neural/WASM SONA, federation mTLS (high maintenance, no current ROI).
- YAML agent format (Legion markdown is cleaner).
