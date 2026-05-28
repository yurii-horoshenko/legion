# Legion — Goals & Vision (canonical)

> **This is the single source of truth for what Legion is meant to be.** Other docs
> (`README.md`, `CLAUDE.md`, the Vault MOC) must point here and must not contradict
> it. When scope changes, edit this file first, then reconcile the rest.

Legion is a **local, zero-dependency platform for building and running teams of AI
agents** against a real project folder — configured through a web UI, driven through
chat, with agents that delegate to each other and visibly level up over time.

## The five goals

### Goal 1 — Configure a project + assemble its agents and skills, from the UI
Create a new project or point Legion at an **existing folder**, then have AI analyze
it and recommend agents from a 174-agent catalog, and assign **skills per agent** — all
in the web UI, without hand-editing JSON.
**Status: ✅ Implemented (~95%).**
Evidence: `routes/projects.js` (create + native folder picker), `routes/analysis.js`
(two-pass AI analysis + fuzzy catalog resolution), `routes/skills.js` (per-agent skills
+ Smithery/Skills.sh/SkillsMP suggestions), `lib/catalog.js`.
Gap: project bootstrap is UI-only (see Goal 4).

### Goal 2 — Agents know their dependencies; they split work and delegate
An orchestrator agent breaks a request into subtasks and delegates to the other agents
configured for that project; subtasks can declare **dependencies** so they run in the
right order; delegation can recurse; cycles and runaway fan-out are prevented.
**Status: ✅ Implemented (~90%).**
Evidence: pipeline store + `<DELEGATE>` flow in `routes/chat.js`; dependency-ordered
execution waves with dedup + 3-color-DFS cycle detection in `lib/dag.js`; recursion
depth cap + `MAX_DELEGATIONS`; shared parsers in `lib/orchestrator.js`.
Gap: dependencies are declared at runtime in the delegate block; `PIPELINE.md` is
generated as documentation but not read back as a static manifest.

### Goal 3 — RPG-hero UI: each agent's level, stats, strengths and weaknesses
Every agent is shown as an RPG hero whose **level/XP**, performance, and **weaknesses
("how confused / how often it fails")** are computed from real activity, so the user can
see where an agent is weak and reconfigure it to perform better.
**Status: ✅ Implemented (~80%).**
Evidence: hero cards with role-based character art (`platforms/web/js/modules/agent-characters.js`,
`platforms/web/css/agent-panel.css`); XP/level from real chat data and 7 stats incl.
**Disorientation** (failures/errors/stuck-tasks) and success stars in
`platforms/web/js/tabs/overview.js`; backend `db.getChatStats` (replies/errors); reset-state action.
Now also: per-agent **`STATS.md`** failure learning (ADR-0005 observation layer) —
`lib/stats.js` records attempts/successes and deduped failure modes to
`<project>/.legion/agents/<id>/STATS.md` (source of truth `stats.json`) on every
delegation outcome (`routes/chat.js`). Tests: `test/stats.test.js`.
Remaining: the periodic retrospective/analysis pass over STATS (ADR-0005 steps 2–3)
and a guided "improve this stat → open the right editor" workflow.

### Goal 4 — Drive it through chat, and configure tasks in Linear
Day-to-day work happens by chatting with agents; agents create and update **Linear**
issues mid-chat; Linear is configured per project.
**Status: 🟡 Partial (~70%).**
Evidence: per-agent chat (`routes/chat.js`, chat tab), Linear create/update via
`%%LINEAR_CREATE%%`/`%%LINEAR_UPDATES%%` blocks with identifier→UUID resolution,
per-project `integrations.json`.
Gap: chat covers task work, but **project setup, Linear keys, and model selection are
UI-only** — not reachable from chat. "Everything via chat" is not literally true yet.

### Goal 5 — New functionality auto-updates docs and gets code-reviewed
When an agent ships new functionality, the **documentation is updated** and the **code is
reviewed** for quality — as a guaranteed step, not an afterthought.
**Status: ✅ Implemented & ENFORCED (~85%) — branch `feat/competitor-ports`.**
Evidence: `lib/capture.js` runs a code-review pass + a docs/changelog pass **in code**
(not at the model's discretion) and archives the run to `<project>/.legion/sessions/`;
wired into the orchestrator in `routes/chat.js` (`runOrchestratorChat`), gated by
`config.autoReviewDocs` (default on) and a real implementation-intent heuristic so pure
Q&A runs don't trigger it. Output is appended to the reply as "🔍 Auto code review" +
"📝 Docs / changelog". Tests: `test/capture.test.js`.
The phased pipeline (`chat-orchestrator.md` Phase 6/8) and `code-reviewer`/
`technical-writer` catalog agents still exist as the richer, model-driven path.
Review/docs now **delegate to the project's `code-reviewer` / `technical-writer`
agents when present** (via the headless runner), falling back to built-in prompts
otherwise (`lib/capture.js` `findRoleAgent`). Remaining: surface review findings as
tracked tasks/issues automatically.

## How we stay aligned
- This file is canonical. `README.md` links here ("Vision & Goals"); `CLAUDE.md`
  references it; the Vault MOC (`Vault/10-Projects/Legion/index.md`) points here.
- Engineering hardening that supports these goals (provider failover, semantic memory,
  context compaction, tool/security gate, hooks, observability, cron runtime) is tracked
  in [`IMPROVEMENT-PLAN.md`](./IMPROVEMENT-PLAN.md) (Phases 0–6).
- Any new doc must state status honestly (✅ / 🟡 / ❌) and not claim a goal is met when
  it is only prompt-level.
