"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ── Catalog search helpers ─────────────────────────────────────────────────

// Quality floor for GitHub-derived sources: drop repos below this star count
// unless that would leave fewer than 3 results.
const MIN_STARS = 3;

// metric: what the numeric `stars` field actually measures for this source —
// "stars" (GitHub), "downloads" (aitmpl), "uses" (Smithery useCount).
function normalizeResult(name, source, desc, url, install, stars, metric) {
  return { name: (name || "").trim(), source, description: (desc || "").slice(0, 200), url: url || "", install: install || null, stars: stars || 0, metric: metric || "stars" };
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
      s.useCount,
      "uses"
    ));
  } catch (e) {
    console.error("[skills:smithery]", e.message);
    return [];
  }
}

// GitHub REST headers — unauthenticated by default (60 req/h), picks up a
// token from the environment when available for the higher rate limit.
function githubHeaders() {
  const headers = { "User-Agent": "Legion/1.0", Accept: "application/vnd.github.v3+json" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function searchSkillsSh(http, query) {
  const headers = githubHeaders();
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

// ── File cache for large static catalogs (24h TTL) ────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readCache(cacheFile, ttlMs = CACHE_TTL_MS) {
  try {
    const st = fs.statSync(cacheFile);
    if (Date.now() - st.mtimeMs < ttlMs) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {}
  return null;
}

function writeCache(cacheFile, data) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(data));
  } catch (e) {
    console.error("[skills:cache]", e.message);
  }
}

// Score query words against name (weight 2) + description (weight 1)
function scoreMatch(query, name, desc) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lname = (name || "").toLowerCase();
  const ldesc = (desc || "").toLowerCase();
  let score = 0;
  for (const w of words) {
    if (lname.includes(w)) score += 2;
    else if (ldesc.includes(w)) score += 1;
  }
  return score;
}

// Rank results: relevance (scoreMatch) first, popularity metric as tiebreak.
// With `floor: true` (GitHub-derived sources) drop entries below MIN_STARS,
// unless fewer than 3 results would remain — then keep the best available.
function rankResults(query, items, { floor = false } = {}) {
  const ranked = items
    .map(it => ({ it, score: scoreMatch(query, it.name, it.description) }))
    .sort((a, b) => b.score - a.score || (b.it.stars || 0) - (a.it.stars || 0))
    .map(x => x.it);
  if (!floor) return ranked;
  const kept = ranked.filter(it => (it.stars || 0) >= MIN_STARS);
  return kept.length >= 3 ? kept : ranked.slice(0, 3);
}

// ── Anthropic official skills (github.com/anthropics/skills) ──────────────

const ANTHROPIC_SKILLS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // changes rarely

// Fallback list — used when the GitHub contents API is unavailable.
const ANTHROPIC_SKILL_NAMES = [
  "algorithmic-art", "brand-guidelines", "canvas-design", "claude-api",
  "doc-coauthoring", "docx", "frontend-design", "internal-comms",
  "mcp-builder", "pdf", "pptx", "skill-creator", "slack-gif-creator",
  "theme-factory", "web-artifacts-builder", "webapp-testing", "xlsx",
];

async function searchAnthropicSkills(http, query, cacheDir) {
  try {
    const cacheFile = path.join(cacheDir, "anthropic-skills.json");
    let skills = readCache(cacheFile, ANTHROPIC_SKILLS_TTL_MS);
    if (!skills) {
      // Directory listing via GitHub API (1 call); fall back to the known list.
      let names = ANTHROPIC_SKILL_NAMES;
      try {
        const listing = await http.getJson("https://api.github.com/repos/anthropics/skills/contents/skills", githubHeaders());
        const dirs = (Array.isArray(listing) ? listing : []).filter(e => e.type === "dir").map(e => e.name);
        if (dirs.length) names = dirs;
      } catch {}
      // Raw SKILL.md fetches are not rate-limited — pull frontmatter in parallel, fail-soft per skill.
      skills = (await Promise.all(names.map(async dir => {
        try {
          const res = await fetch(`https://raw.githubusercontent.com/anthropics/skills/main/skills/${dir}/SKILL.md`, { headers: { "User-Agent": "Legion/1.0" } });
          if (!res.ok) return null;
          const fm = ((await res.text()).match(/^---\s*\n([\s\S]*?)\n---/) || [])[1] || "";
          const name = (fm.match(/^name:\s*(.+)$/m) || [])[1];
          const description = (fm.match(/^description:\s*(.+)$/m) || [])[1];
          return { dir, name: (name || dir).trim(), description: (description || "").trim().slice(0, 300) };
        } catch { return null; }
      }))).filter(Boolean);
      if (skills.length) writeCache(cacheFile, skills);
    }
    return skills
      .map(s => ({ s, score: scoreMatch(query, s.name, s.description) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ s }) => normalizeResult(
        s.name, "anthropic-official", s.description,
        `https://github.com/anthropics/skills/tree/main/skills/${s.dir}`,
        `npx skills add anthropics/skills@${s.dir}`, 0
      ));
  } catch (e) {
    console.error("[skills:anthropic-official]", e.message);
    return [];
  }
}

// ── Additional catalog sources ─────────────────────────────────────────────

async function searchMcpRegistry(http, query) {
  try {
    const url = `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(query)}&limit=12`;
    const data = await http.getJson(url, { Accept: "application/json" });
    return (data.servers || []).map(entry => {
      const s = entry.server || entry;
      const repoUrl = (s.repository && s.repository.url) || "";
      const pkg = (s.packages || [])[0];
      const install = pkg && pkg.registryType === "npm" ? `npx ${pkg.identifier}` : (repoUrl || null);
      return normalizeResult(s.name, "mcp-registry", s.description, repoUrl, install, 0);
    });
  } catch (e) {
    console.error("[skills:mcp-registry]", e.message);
    return [];
  }
}

async function searchGlama(http, query) {
  try {
    const url = `https://glama.ai/api/mcp/v1/servers?query=${encodeURIComponent(query)}&first=12`;
    const data = await http.getJson(url, { Accept: "application/json" });
    return (data.servers || []).map(s => {
      const repoUrl = (s.repository && s.repository.url) || "";
      return normalizeResult(s.name, "glama", s.description, s.url || repoUrl, repoUrl || null, 0);
    });
  } catch (e) {
    console.error("[skills:glama]", e.message);
    return [];
  }
}

async function searchClaudePluginsOfficial(http, query, cacheDir) {
  try {
    const cacheFile = path.join(cacheDir, "claude-plugins-official.json");
    let plugins = readCache(cacheFile);
    if (!plugins) {
      const data = await http.getJson(
        "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
        { "User-Agent": "Legion/1.0", Accept: "application/json" }
      );
      plugins = (data.plugins || []).map(p => ({
        name: p.name,
        description: (p.description || "").slice(0, 300),
        category: p.category || "",
        url: (p.source && p.source.url) || p.homepage || "",
      }));
      writeCache(cacheFile, plugins);
    }
    return plugins
      .map(p => ({ p, score: scoreMatch(query, p.name, `${p.description} ${p.category}`) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ p }) => normalizeResult(
        p.name, "claude-plugins-official", p.description, p.url,
        `/plugin install ${p.name}@claude-plugins-official`, 0
      ));
  } catch (e) {
    console.error("[skills:claude-plugins-official]", e.message);
    return [];
  }
}

async function searchAitmpl(http, query, cacheDir) {
  try {
    const cacheFile = path.join(cacheDir, "aitmpl-components.json");
    let skills = readCache(cacheFile);
    if (!skills) {
      // ~15 MB with embedded file contents — cache only the slim fields we use
      const data = await http.getJson("https://www.aitmpl.com/components.json", { Accept: "application/json" });
      skills = (data.skills || []).map(s => ({
        name: s.name,
        description: (s.description || "").slice(0, 300),
        path: s.path || "",
        category: s.category || "",
        downloads: s.downloads || 0,
      }));
      writeCache(cacheFile, skills);
    }
    return skills
      .map(s => ({ s, score: scoreMatch(query, s.name, `${s.description} ${s.category}`) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || b.s.downloads - a.s.downloads)
      .slice(0, 12)
      .map(({ s }) => normalizeResult(
        s.name, "aitmpl", s.description,
        `https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/skills/${s.path}`,
        `npx claude-code-templates@latest --skill ${s.path}`,
        s.downloads,
        "downloads"
      ));
  } catch (e) {
    console.error("[skills:aitmpl]", e.message);
    return [];
  }
}

async function searchGithubTopics(http, query) {
  try {
    const data = await http.getJson(
      `https://api.github.com/search/repositories?q=topic:claude-skills+${encodeURIComponent(query)}&sort=updated&per_page=12`,
      githubHeaders()
    );
    return (data.items || []).map(r => normalizeResult(
      r.name, "github-topics", r.description, r.html_url, `npx skills add ${r.full_name}`, r.stargazers_count
    ));
  } catch (e) {
    console.error("[skills:github-topics]", e.message);
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
const METRIC_SYMBOL = { stars: "★", downloads: "↓", uses: "↓" };

function formatForPrompt(label, items) {
  if (!items.length) return `### ${label}\n(no results)\n`;
  const lines = items.slice(0, 12).map((it, i) =>
    `${i + 1}. [${it.source}] ${it.name}` +
    (it.stars ? ` ${METRIC_SYMBOL[it.metric] || "★"}${it.stars}` : "") +
    ` — ${it.description || "no description"}` +
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

        const cacheDir = path.resolve(ctx.webRoot, "../../.config/cache");
        const [
          anthropicResults, smitheryResults, rawSkillsSh, rawSkillsMp,
          officialPluginResults, aitmplResults, mcpRegistryResults, rawGlama, rawGhTopics,
        ] = await Promise.all([
          searchAnthropicSkills(http, query, cacheDir),
          searchSmithery(http, query),
          searchSkillsSh(http, query),
          searchSkillsMP(http, query),
          searchClaudePluginsOfficial(http, query, cacheDir),
          searchAitmpl(http, query, cacheDir),
          searchMcpRegistry(http, query),
          searchGlama(http, query),
          searchGithubTopics(http, query),
        ]);

        // Relevance + popularity ranking; star floor for GitHub-derived sources.
        // Curated tiers (anthropic-official, claude-plugins-official, mcp-registry)
        // and aitmpl (pre-sorted by score+downloads) are exempt.
        const skillsShResults = rankResults(query, rawSkillsSh, { floor: true });
        const ghTopicResults  = rankResults(query, rawGhTopics, { floor: true });
        const skillsMpResults = rankResults(query, rawSkillsMp);
        const smithery        = rankResults(query, smitheryResults);
        const glamaResults    = rankResults(query, rawGlama);

        const allResults = [
          // Curated sources first — order also drives prompt sections and dedup priority
          anthropicResults, officialPluginResults, aitmplResults, mcpRegistryResults, glamaResults,
          smithery, skillsShResults, ghTopicResults, skillsMpResults,
        ];
        const totalFound = allResults.reduce((n, r) => n + r.length, 0);
        progress(`Found ${totalFound} catalog items — asking AI to rank…`);

        const catalogSection = totalFound > 0
          ? formatForPrompt("Anthropic Official Skills (anthropics/skills)", anthropicResults) +
            formatForPrompt("Claude Plugins Official (Anthropic)", officialPluginResults) +
            formatForPrompt("aitmpl (claude-code-templates)", aitmplResults) +
            formatForPrompt("Official MCP Registry", mcpRegistryResults) +
            formatForPrompt("Glama (MCP servers)", glamaResults) +
            formatForPrompt("Smithery (MCP servers)", smithery) +
            formatForPrompt("Skills.sh via GitHub", skillsShResults) +
            formatForPrompt("GitHub topic:claude-skills", ghTopicResults) +
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
        const catalog = dedup(allResults.flat());
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

// Exposed for standalone testing of catalog fetchers
Object.assign(module.exports, {
  searchSmithery, searchSkillsSh, searchSkillsMP,
  searchMcpRegistry, searchGlama, searchClaudePluginsOfficial, searchAitmpl, searchGithubTopics,
  searchAnthropicSkills, rankResults, formatForPrompt,
});
