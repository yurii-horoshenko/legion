"use strict";

const fs   = require("fs");
const path = require("path");
const log  = require("./log");

// Goal 5 — enforced docs-update + code-review on new functionality.
// When an orchestrator run looks like an implementation, this runs a code-review
// pass and a docs/changelog pass (in code, not left to the model's discretion),
// and archives the run as a session note on disk. Mirrors the phased pipeline's
// Phase 6 (Review) + Phase 8 (Capture), but ENFORCED rather than prompt-only.

// ASCII words need \b boundaries (avoid "prefix"→"fix"); Cyrillic stems can't use
// \b (Cyrillic isn't a \w char in JS regex) so they match as substrings.
const IMPL_EN = /\b(implement|build|create|add|fix|refactor|ship|feature|code)\b/i;
const IMPL_RU = /(реализ|сдела|постро|добав|почини|испра|внедр|напиши код)/i;

// Heuristic: did this run produce/change functionality worth reviewing?
function isImplementationRun(message, results = []) {
  const m = message || "";
  if (IMPL_EN.test(m) || IMPL_RU.test(m)) return true;
  return results.some(r => /dev|engineer|architect|backend|frontend|mobile|coder|programmer|qa/i.test(r.agentName || ""));
}

function slug(s) {
  return (s || "task").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "task";
}

// Find a project agent that plays a review or docs role, if one exists.
function findRoleAgent(agents, kind) {
  const re = kind === "review"
    ? /(code[-\s]?review|reviewer|qa)/i
    : /(technical[-\s]?writer|tech[-\s]?writer|documentation|\bdocs?\b|writer)/i;
  return (agents || []).find(a => re.test(`${a.name || ""} ${a.role || ""} ${a.catalogId || a.id || ""}`)) || null;
}

// Run review + docs passes. Prefers delegating to a dedicated project agent
// (via the headless runner) when one exists; else uses a built-in prompt.
// Returns { review, docs, reviewedBy, documentedBy } — never throws.
async function reviewAndDocument({ ai, candidates, message, finalReply, runner, pid, reviewerAgent, writerAgent }) {
  const ctx = `Original request: "${message}"\n\nTeam result:\n${finalReply}`;
  const reviewSys =
    "You are a senior code reviewer. Review the work below for correctness, edge cases, security, and quality. " +
    "Be specific and concise (bullets). If there is no code to review, reply exactly: No code to review.";
  const docsSys =
    "You are a technical writer. Write a concise changelog/doc note (2–5 bullets) describing what changed and any follow-ups. Output only the note.";

  async function pass(kind, sys, agent, maxTokens) {
    try {
      if (runner && pid && agent) return (await runner.run(pid, agent, `${sys}\n\n${ctx}`)).trim();
      return (await ai.callAIMessagesResilient(candidates, sys, [{ role: "user", content: ctx }], { maxTokens })).trim();
    } catch (e) { return `(${kind} skipped: ${e.message})`; }
  }

  const review = await pass("review", reviewSys, reviewerAgent, 600);
  const docs   = await pass("docs", docsSys, writerAgent, 500);
  return { review, docs, reviewedBy: reviewerAgent?.name || "built-in", documentedBy: writerAgent?.name || "built-in" };
}

// Archive the run to <project>/.legion/sessions/. Best-effort; returns path or null.
function writeSessionNote(project, { message, finalReply, review, docs }) {
  if (!project?.path) return null;
  try {
    const dir = path.join(project.path, ".legion", "sessions");
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date();
    const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const file = path.join(dir, `${stamp}-${slug(message)}.md`);
    const body = [
      `# Session — ${now.toISOString()}`, ``,
      `## Request`, message || "(none)", ``,
      `## Outcome`, finalReply || "(none)", ``,
      `## Code review`, review || "(none)", ``,
      `## Docs / changelog`, docs || "(none)", ``,
    ].join("\n");
    fs.writeFileSync(file, body, "utf8");
    log.info("capture", `session note written: ${file}`);
    return file;
  } catch (e) {
    log.warn("capture", `session note failed — ${e.message}`);
    return null;
  }
}

module.exports = { isImplementationRun, slug, reviewAndDocument, writeSessionNote, findRoleAgent, IMPL_EN, IMPL_RU };
