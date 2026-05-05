"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ── Catalog search helpers ─────────────────────────────────────────────────

function normalizeResult(name, source, desc, url, install, stars) {
  return { name: (name || "").trim(), source, description: (desc || "").slice(0, 200), url: url || "", install: install || null, stars: stars || 0 };
}

async function searchSmithery(http, query) {
  try {
    const url = `https://registry.smithery.ai/servers?q=${encodeURIComponent(query)}&pageSize=12`;
    const data = await http.getJson(url, { Accept: "application/json" });
    return (data.servers || []).map(s => normalizeResult(
      s.displayName || s.qualifiedName,
      "smithery",
      s.description,
      `https://smithery.ai/server/${s.qualifiedName}`,
      `npx @smithery/cli install ${s.qualifiedName}`,
      s.useCount
    ));
  } catch (e) {
    console.error("[skills:smithery]", e.message);
    return [];
  }
}

async function searchSkillsSh(http, query) {
  const headers = { "User-Agent": "Legion/1.0", Accept: "application/vnd.github.v3+json" };
  const toResults = items => (items || []).map(r => normalizeResult(
    r.name, "skillsh", r.description, r.html_url, `npx skills add ${r.full_name}`, r.stargazers_count
  ));
  try {
    // First try: topic:claude-skill tag (strict, high quality)
    const strict = await http.getJson(
      `https://api.github.com/search/repositories?q=topic:claude-skill+${encodeURIComponent(query)}&per_page=10&sort=stars`,
      headers
    );
    if ((strict.items || []).length > 0) return toResults(strict.items);

    // Fallback: broader search for SKILL.md files in claude-skill repos
    const broad = await http.getJson(
      `https://api.github.com/search/repositories?q=claude-skill+${encodeURIComponent(query)}+filename:SKILL.md&per_page=8&sort=stars`,
      headers
    );
    return toResults(broad.items);
  } catch (e) {
    console.error("[skills:skillsh]", e.message);
    return [];
  }
}

async function searchSkillsMP(http, query) {
  try {
    const url = `https://skillsmp.com/api/v1/skills/search?q=${encodeURIComponent(query)}&limit=10`;
    const data = await http.getJson(url, { Accept: "application/json" });
    // Response: { success, data: { skills: [...] } }
    const items = (data.data && data.data.skills) || data.skills || [];
    return items.map(s => {
      // Derive install command from githubUrl if available
      // githubUrl format: https://github.com/owner/repo/tree/main/skills/skill-name
      let install = null;
      if (s.githubUrl) {
        const m = s.githubUrl.match(/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/[^/]+\/skills\/(.+))?/);
        if (m) install = m[3] ? `npx skills add ${m[1]}/${m[2]}@${m[3]}` : `npx skills add ${m[1]}/${m[2]}`;
      }
      return normalizeResult(
        s.name || s.title,
        "skillsmp",
        s.description || s.summary,
        s.skillUrl || s.githubUrl || `https://skillsmp.com/skills/${s.id || ""}`,
        install,
        s.stars || 0
      );
    });
  } catch (e) {
    console.error("[skills:skillsmp]", e.message);
    return [];
  }
}

// Deduplicate by lowercased name, keep highest-starred duplicate
function dedup(items) {
  const seen = new Map();
  for (const it of items) {
    const key = it.name.toLowerCase();
    if (!seen.has(key) || (it.stars > (seen.get(key).stars || 0))) seen.set(key, it);
  }
  return [...seen.values()];
}

// Extract 1–2 meaningful search terms from agent profile
function buildQuery(agent) {
  const parts = [];
  const group = (agent.group || "").replace(/^custom$/i, "").trim();
  if (group) parts.push(group.toLowerCase());

  const techRx = /\b(kotlin|swift|typescript|javascript|python|rust|golang|java|react|vue|angular|node\.?js|docker|kubernetes|aws|gcp|azure|postgresql|mongodb|redis|graphql|openapi|llm|ml|devops|security|testing|documentation|architecture|design|mobile|ios|android)\b/i;
  const techHit = (agent.role || "").match(techRx) || (agent.capabilities || []).join(" ").match(techRx);
  if (techHit) parts.push(techHit[0].toLowerCase());

  if (!parts.length) parts.push(((agent.name || agent.role || "developer").split(/\s+/)[0]).toLowerCase());
  return parts.join(" ");
}

// Format catalog results for the AI prompt (compact, token-efficient)
function formatForPrompt(label, items) {
  if (!items.length) return `### ${label}\n(no results)\n`;
  const lines = items.slice(0, 12).map((it, i) =>
    `${i + 1}. [${it.source}] ${it.name} — ${it.description || "no description"}` +
    (it.install ? `\n   install: ${it.install}` : "") +
    (it.url ? `\n   url: ${it.url}` : "")
  );
  return `### ${label}\n${lines.join("\n")}\n`;
}

module.exports = function createSkillRoutes(ctx) {
  const { io, http, ai, agentFs } = ctx;

  return async function handle(urlPath, method, req, res, body) {

    // GET /api/projects/:pid/agents/:aid/suggest-skills  (EventSource — always GET)
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/suggest-skills$/) && method === "GET") {
      const parts = urlPath.split("/");
      const pid = parts[3];
      const aid = parts[5];

      const { progress, done, fail } = http.createSSEHandler(res, req, "skills");

      try {
        const cfg = io.readConfig();
        if (!cfg.defaultModelId) return fail("No default model configured in Settings → General");

        const project = io.readProjects().find(p => p.id === pid);
        if (!project)  return fail("Project not found");

        const resolved = http.resolveModel(io.readModels(), io.readProviders(), cfg.defaultModelId);
        if (!resolved) return fail("Default model not found or provider not configured");
        const { model, provider } = resolved;

        const agentsMap = io.readPAgents();
        const agent = (agentsMap[pid] || []).find(a => a.id === aid);
        if (!agent) return fail("Agent not found");

        // Read installed skills from SKILLS.md and agent identity from IDENTITY.md
        let installedSkills = "";
        let agentIdentity = "";
        if (project.path) {
          const agentDir = path.join(project.path, ".legion", "agents", aid);
          const skillsFile = path.join(agentDir, "SKILLS.md");
          const identityFile = path.join(agentDir, "IDENTITY.md");
          if (fs.existsSync(skillsFile)) installedSkills = fs.readFileSync(skillsFile, "utf8").slice(0, 1500);
          if (fs.existsSync(identityFile)) agentIdentity = fs.readFileSync(identityFile, "utf8").slice(0, 2000);
        }

        // Build project context from docs
        let projectContext = project.description || "";
        if (project.path) {
          const docsDir = path.join(project.path, "docs");
          if (fs.existsSync(docsDir)) {
            const docFiles = fs.readdirSync(docsDir).filter(f => f.endsWith(".md")).slice(0, 2);
            for (const f of docFiles) {
              try { projectContext += "\n" + fs.readFileSync(path.join(docsDir, f), "utf8").slice(0, 800); } catch {}
            }
          }
        }

        progress("Reading agent profile…");

        // ── Live catalog search ─────────────────────────────────────────────
        const query = buildQuery(agent);
        progress(`Searching catalogs for "${query}"…`);

        const [smitheryResults, skillsShResults, skillsMpResults] = await Promise.all([
          searchSmithery(http, query),
          searchSkillsSh(http, query),
          searchSkillsMP(http, query),
        ]);

        const totalFound = smitheryResults.length + skillsShResults.length + skillsMpResults.length;
        progress(`Found ${totalFound} catalog items — asking AI to rank…`);

        const catalogSection = totalFound > 0
          ? formatForPrompt("Smithery (MCP servers)", smitheryResults) +
            formatForPrompt("Skills.sh via GitHub", skillsShResults) +
            formatForPrompt("SkillsMP", skillsMpResults)
          : "(all catalog searches returned no results — generate recommendations from knowledge)";

        const promptFile = path.resolve(ctx.webRoot, "../../core/prompts/skill-suggest.md");
        let prompt = fs.readFileSync(promptFile, "utf8")
          .replace("{{agent_name}}", agent.name || aid)
          .replace("{{agent_role}}", agent.role || agent.description || "")
          .replace("{{agent_group}}", agent.group || "custom")
          .replace("{{capabilities}}", (agent.capabilities || []).join(", ") || "—")
          .replace("{{project_context}}", projectContext.slice(0, 2000) || "No project context available")
          .replace("{{agent_identity}}", agentIdentity || "Not available")
          .replace("{{installed_skills}}", installedSkills || "None")
          .replace("{{catalog_results}}", catalogSection);

        progress("Asking AI to select best matches…");

        const raw = await ai.callAI(model, provider, prompt);
        const result = http.parseAIJson(raw);

        // Attach real catalog metadata (url, install) where AI matched by name
        const catalog = dedup([...smitheryResults, ...skillsShResults, ...skillsMpResults]);
        (result.skills || []).forEach(sk => {
          const match = catalog.find(c => c.name.toLowerCase() === sk.name.toLowerCase());
          if (match) {
            if (!sk.url     && match.url)     sk.url     = match.url;
            if (!sk.install && match.install) sk.install = match.install;
            if (!sk.source  && match.source)  sk.source  = match.source;
          }
        });

        progress(`Selected ${result.skills?.length || 0} skill recommendations`);
        done(result);
      } catch (err) {
        console.error("[skills]", err.message);
        fail("Request error: " + err.message);
      }
      return true;
    }

    // GET /api/skills/available — list user-level skills from ~/.claude/skills/
    if (urlPath === "/api/skills/available" && method === "GET") {
      const userSkillsDir = path.join(os.homedir(), ".claude", "skills");
      const skills = [];
      if (fs.existsSync(userSkillsDir)) {
        for (const name of fs.readdirSync(userSkillsDir).sort()) {
          const skillDir = path.join(userSkillsDir, name);
          try { if (!fs.statSync(skillDir).isDirectory()) continue; } catch { continue; }
          const skillMd = path.join(skillDir, "SKILL.md");
          let description = "";
          if (fs.existsSync(skillMd)) {
            const content = fs.readFileSync(skillMd, "utf8").slice(0, 500);
            const match = content.match(/^description:\s*(.+)/m);
            if (match) description = match[1].trim().replace(/^["']|["']$/g, "");
          }
          skills.push({ id: name, description, global: true });
        }
      }
      http.json(res, 200, skills);
      return true;
    }

    // GET /api/projects/:pid/agents/:aid/skills — agent's assigned skill refs
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/skills$/) && method === "GET") {
      const parts = urlPath.split("/");
      const pid = parts[3], aid = parts[5];
      const map = io.readPAgents();
      const agent = (map[pid] || []).find(a => a.id === aid);
      if (!agent) { http.json(res, 404, { error: "Agent not found" }); return true; }
      http.json(res, 200, agent.skills || []);
      return true;
    }

    // POST /api/projects/:pid/agents/:aid/skills/:skillId — assign skill to agent
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/skills\/[^/]+$/) && method === "POST") {
      const parts = urlPath.split("/");
      const pid = parts[3], aid = parts[5], skillId = parts[7];
      const map = io.readPAgents();
      const agents = map[pid] || [];
      const idx = agents.findIndex(a => a.id === aid);
      if (idx === -1) { http.json(res, 404, { error: "Agent not found" }); return true; }
      const agent = { ...agents[idx] };
      const skills = agent.skills || [];
      if (!skills.includes(skillId)) {
        agent.skills = [...skills, skillId];
        agents[idx] = agent;
        map[pid] = agents;
        io.writePAgents(map);
        const proj = io.readProjects().find(p => p.id === pid);
        if (proj) { agentFs.syncLegionMd(proj, pid); agentFs.syncSkillsMd(proj, agent); }
      }
      http.json(res, 200, { ok: true, skills: agent.skills });
      return true;
    }

    // DELETE /api/projects/:pid/agents/:aid/skills/:skillId — unassign skill from agent
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/skills\/[^/]+$/) && method === "DELETE") {
      const parts = urlPath.split("/");
      const pid = parts[3], aid = parts[5], skillId = parts[7];
      const map = io.readPAgents();
      const agents = map[pid] || [];
      const idx = agents.findIndex(a => a.id === aid);
      if (idx === -1) { http.json(res, 404, { error: "Agent not found" }); return true; }
      const agent = { ...agents[idx] };
      agent.skills = (agent.skills || []).filter(s => s !== skillId);
      agents[idx] = agent;
      map[pid] = agents;
      io.writePAgents(map);
      const proj = io.readProjects().find(p => p.id === pid);
      if (proj) { agentFs.syncLegionMd(proj, pid); agentFs.syncSkillsMd(proj, agent); }
      http.json(res, 200, { ok: true, skills: agent.skills });
      return true;
    }

    return false;
  };
};
