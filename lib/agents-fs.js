"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

module.exports = function createAgentFs(io, agentsBaseDir, webRoot) {
  function agentMd(agent) {
    const now = new Date().toISOString().slice(0, 10);
    return [
      `---`,
      `id: ${agent.id}`,
      `catalog: ${agent.prompt_file || agent.group + "/" + agent.id + ".md"}`,
      `name: ${agent.name}`,
      `emoji: ${agent.emoji || "🤖"}`,
      `group: ${agent.group}`,
      `model: ${agent.model || ""}`,
      `added: ${now}`,
      `---`,
    ].join("\n");
  }

  // Build .claude/agents/{id}.md from Legion config files (IDENTITY, SOUL, CONTEXT, MEMORY)
  function buildClaudeAgentMd(project, agentId) {
    if (!project?.path) return;
    try {
      const agentDir       = path.join(project.path, ".legion", "agents", agentId);
      const claudeAgentPath = path.join(project.path, ".claude", "agents", agentId + ".md");
      if (!fs.existsSync(agentDir)) return;

      // Parse agent.md frontmatter
      const agentMdPath = path.join(agentDir, "agent.md");
      const agentMdRaw  = fs.existsSync(agentMdPath) ? fs.readFileSync(agentMdPath, "utf8") : "";
      const nameMatch   = agentMdRaw.match(/^name:\s*(.+)/m);
      const catalogMatch = agentMdRaw.match(/^catalog:\s*(.+)/m);
      const name = nameMatch ? nameMatch[1].trim() : agentId;

      // Get role from stored agent data for the description field
      const agentMap = io.readPAgents();
      const agentObj = Object.values(agentMap).flat().find(a => a.id === agentId) || {};
      const role = (agentObj.role || agentObj.description || "").replace(/\n/g, " ").trim();
      const description = role.slice(0, 300) || name;

      // Helper: read a Legion config file, stripping its title header
      const readSection = (filename) => {
        const p = path.join(agentDir, filename);
        if (!fs.existsSync(p)) return "";
        return fs.readFileSync(p, "utf8").trim()
          .replace(/^#[^\n]*\n/, "")   // strip "# FILENAME — AgentName" header
          .trim();
      };

      // Catalog prompt (from original catalog file) used as base if available
      const catalogPath = catalogMatch ? path.join(agentsBaseDir, catalogMatch[1].trim()) : null;
      const hasCatalog  = catalogPath && fs.existsSync(catalogPath);

      let body;
      if (hasCatalog) {
        // Use catalog as core personality, append all Legion config files on top
        const catalogRaw = fs.readFileSync(catalogPath, "utf8");
        // Strip frontmatter block from catalog
        const catalogBody = catalogRaw.replace(/^---[\s\S]*?---\n/, "").trim();
        const identity = readSection("IDENTITY.md");
        const soul     = readSection("SOUL.md");
        const context  = readSection("CONTEXT.md");
        const memory   = readSection("MEMORY.md");
        const skills   = readSection("SKILLS.md");
        const extra    = [identity, soul, context, memory, skills].filter(Boolean);
        body = extra.length
          ? catalogBody + "\n\n---\n\n" + extra.join("\n\n---\n\n")
          : catalogBody;
      } else {
        // Build entirely from Legion files
        const identity = readSection("IDENTITY.md");
        const soul     = readSection("SOUL.md");
        const context  = readSection("CONTEXT.md");
        const memory   = readSection("MEMORY.md");
        const skills   = readSection("SKILLS.md");
        body = [identity, soul, context, memory, skills].filter(Boolean).join("\n\n---\n\n");
      }

      fs.mkdirSync(path.dirname(claudeAgentPath), { recursive: true });
      fs.writeFileSync(claudeAgentPath,
        `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
    } catch (e) {
      console.error(`  Warning: could not build .claude/agents/${agentId}.md: ${e.message}`);
    }
  }

  function writeAgentFile(project, agent) {
    if (!project.path) return;
    const agentDir = path.join(project.path, ".legion", "agents", agent.id);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "agent.md"), agentMd(agent));

    const name = agent.name || agent.id;
    const desc = agent.description || "";

    const defaults = {
      "IDENTITY.md": `# IDENTITY.md — ${name}\n\nCore identity and persona definition.\n\n## Name\n${name}\n\n## Role\n${agent.role || agent.group || "Agent"}\n\n## Personality\nProfessional, concise, and focused on results.\n\n## Communication style\nClear, direct, and structured.\n`,
      "SOUL.md": `# SOUL.md — ${name}\n\nValues, principles, and behavioral guidelines.\n\n## Core values\n- Accuracy over speed\n- Transparency in reasoning\n- Continuous improvement\n\n## Principles\n- Always verify before acting\n- Prefer reversible actions\n- Ask when uncertain\n`,
      "USER.md": `# USER.md\n\nContext about the user and project for ${name}.\n\n## Project context\n_Fill in project description, goals, and constraints here._\n\n## User preferences\n_Language, tone, output format preferences._\n\n## Domain knowledge\n_Key facts, terminology, and conventions for this project._\n`,
      "MEMORY.md": `# MEMORY.md — ${name}\n\nLong-form narrative memory. Updated by the agent at the end of sessions or via checkpoints.\nMax ~3000 characters. The model reads this at the start of each session.\n\n## What I know\n_Key facts, decisions, and outcomes accumulated over time._\n\n## What to remember\n_Patterns, preferences, and lessons learned._\n\n## Open threads\n_Ongoing topics or unresolved questions._\n`,
      "CONTEXT.md": `# CONTEXT.md — ${name}\n\nProject-specific technical context. Read by the agent to understand the environment.\n\n## Tech stack\n_Languages, frameworks, libraries, runtime._\n\n## Architecture\n_Key components, modules, data flow._\n\n## Conventions\n_Naming, code style, commit format, file structure._\n\n## Current state\n_What's in progress, recent changes, known issues._\n`,
      "SKILLS.md": `# SKILLS.md — ${name}\n\nSkills and tools available to this agent.\n\n## Available skills\n_List installed skills with a short description of each._\n\n## Tools\n_External tools, APIs, or MCP servers this agent can call._\n\n## Invocation\n_How to trigger skills — slash commands, keywords, or conditions._\n`,
    };

    for (const [file, content] of Object.entries(defaults)) {
      const p = path.join(agentDir, file);
      if (!fs.existsSync(p)) fs.writeFileSync(p, content);
    }
    buildClaudeAgentMd(project, agent.id);
  }

  function deleteAgentFile(project, agentId) {
    if (!project.path) return;
    const legionDir = path.join(project.path, ".legion");
    const agentDir  = path.join(legionDir, "agents", agentId);
    if (!agentDir.startsWith(legionDir + path.sep)) return;
    try { fs.rmSync(agentDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(path.join(legionDir, "agents", agentId + ".md")); } catch {}
    // Remove Claude Code native sub-agent
    try { fs.unlinkSync(path.join(project.path, ".claude", "agents", agentId + ".md")); } catch {}
  }

  function syncClaudeAgents() {
    const projects = io.readProjects();
    let synced = 0;
    for (const project of projects) {
      if (!project.path) continue;
      const legionAgentsDir = path.join(project.path, ".legion", "agents");
      if (!fs.existsSync(legionAgentsDir)) continue;

      for (const agentId of fs.readdirSync(legionAgentsDir)) {
        const stat = fs.statSync(path.join(legionAgentsDir, agentId));
        if (!stat.isDirectory()) continue;
        const agentMdPath = path.join(legionAgentsDir, agentId, "agent.md");
        if (!fs.existsSync(agentMdPath)) continue;
        buildClaudeAgentMd(project, agentId);
        synced++;
      }
    }
    if (synced > 0) console.log(`  Synced ${synced} agent(s) → .claude/agents/`);
  }

  function initLegionFolder(project) {
    try {
      const legionDir = path.join(project.path, ".legion");
      fs.mkdirSync(legionDir, { recursive: true });
      const mdFile = path.join(legionDir, "LEGION.md");
      if (!fs.existsSync(mdFile)) {
        const now = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(mdFile, [
          `---`,
          `name: ${project.name}`,
          `description: ${project.description || ""}`,
          `created: ${now}`,
          `legion: 0.1.0`,
          `---`,
          ``,
          `# ${project.name}`,
          ``,
          `${project.description || ""}`,
          ``,
          `## Agents`,
          ``,
          `<!-- Agents assigned to this project will be listed here -->`,
          ``,
          `## Config`,
          ``,
          `<!-- Project-specific agent configuration goes here -->`,
        ].join("\n"));
      }
    } catch (err) {
      console.error(`  Warning: could not init .legion folder: ${err.message}`);
    }
  }

  function syncLegionMd(project, pid) {
    try {
      if (!project?.path) return;
      const legionDir = path.join(project.path, ".legion");
      fs.mkdirSync(legionDir, { recursive: true });

      const agents = (io.readPAgents()[pid] || []);
      const now    = new Date().toISOString().slice(0, 10);

      // Collect pipeline connections across all agents
      const pipelineRows = [];
      const cronRows     = [];

      for (const agent of agents) {
        const agentDir = path.join(legionDir, "agents", agent.id);

        // Pipeline
        const pipelineFile = path.join(agentDir, "pipeline.json");
        if (fs.existsSync(pipelineFile)) {
          try {
            const links = JSON.parse(fs.readFileSync(pipelineFile, "utf8"));
            for (const l of links) {
              const toAgent = agents.find(a => a.id === l.targetAgentId);
              pipelineRows.push(`| ${agent.name || agent.id} | ${toAgent?.name || l.targetAgentId} | ${l.condition || "always"} | ${l.mode || "sequential"} |`);
            }
          } catch {}
        }

        // Cron
        const cronFile = path.join(agentDir, "cron.json");
        if (fs.existsSync(cronFile)) {
          try {
            const jobs = JSON.parse(fs.readFileSync(cronFile, "utf8"));
            for (const j of jobs) {
              cronRows.push(`| ${agent.name || agent.id} | \`${j.schedule || "?"}\` | ${j.task || j.description || "—"} |`);
            }
          } catch {}
        }
      }

      // Build agent table
      const agentRows = agents.map(a => {
        const skills  = (a.skills || []).join(", ") || "—";
        const model   = a.model || "—";
        const role    = (a.role || a.description || "").replace(/\n/g, " ").slice(0, 80);
        return `| ${a.name || a.id} | ${role} | ${skills} | ${model} |`;
      });

      const lines = [
        `---`,
        `name: ${project.name}`,
        `description: ${project.description || ""}`,
        `updated: ${now}`,
        `agents: ${agents.length}`,
        `---`,
        ``,
        `# ${project.name} — Agent Team`,
        ``,
        project.description ? `> ${project.description}\n` : "",
        `## Agents`,
        ``,
        agents.length
          ? [`| Agent | Role | Skills | Model |`, `|-------|------|--------|-------|`, ...agentRows].join("\n")
          : `_No agents configured yet._`,
        ``,
        `## Pipelines`,
        ``,
        pipelineRows.length
          ? [`| From | To | Condition | Mode |`, `|------|----|-----------|------|`, ...pipelineRows].join("\n")
          : `_No pipeline connections configured._`,
        ``,
        `## Cron Jobs`,
        ``,
        cronRows.length
          ? [`| Agent | Schedule | Task |`, `|-------|----------|------|`, ...cronRows].join("\n")
          : `_No scheduled jobs configured._`,
      ].filter(l => l !== undefined);

      const mdPath = path.join(legionDir, "LEGION.md");
      fs.writeFileSync(mdPath, lines.join("\n") + "\n");
    } catch (err) {
      console.error(`  Warning: syncLegionMd failed: ${err.message}`);
    }
  }

  function syncSkillsMd(project, agent) {
    if (!project?.path) return;
    const agentDir = path.join(project.path, ".legion", "agents", agent.id);
    if (!fs.existsSync(agentDir)) return;

    const skills = agent.skills || [];
    const userSkillsDir = path.join(os.homedir(), ".claude", "skills");
    const name = agent.name || agent.id;

    const lines = [
      `# SKILLS.md — ${name}`,
      ``,
      `Skills and tools available to this agent.`,
      ``,
      `## Assigned skills`,
      ``,
    ];

    if (!skills.length) {
      lines.push(`_No skills assigned yet._`, ``);
    } else {
      for (const skillId of skills) {
        const skillMd = path.join(userSkillsDir, skillId, "SKILL.md");
        let description = "";
        if (fs.existsSync(skillMd)) {
          const content = fs.readFileSync(skillMd, "utf8").slice(0, 600);
          const match = content.match(/^description:\s*(.+)/m);
          if (match) description = match[1].trim().replace(/^["']|["']$/g, "");
        }
        lines.push(`### ${skillId}`);
        if (description) lines.push(``, description, ``);
        else lines.push(``);
      }
    }

    lines.push(
      `## Tools`,
      ``,
      `_External tools, APIs, or MCP servers this agent can call._`,
      ``,
      `## Invocation`,
      ``,
      `_How to trigger skills — slash commands, keywords, or conditions._`,
    );

    try {
      fs.writeFileSync(path.join(agentDir, "SKILLS.md"), lines.join("\n") + "\n");
    } catch (e) {
      console.error(`  Warning: could not write SKILLS.md for ${agent.id}: ${e.message}`);
    }
  }

  return {
    agentMd,
    writeAgentFile,
    deleteAgentFile,
    syncClaudeAgents,
    initLegionFolder,
    syncLegionMd,
    syncSkillsMd,
    buildClaudeAgentMd,
  };
};
