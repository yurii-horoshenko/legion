"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

module.exports = function createSkillRoutes(ctx) {
  const { io, http, ai, agentFs } = ctx;

  return async function handle(urlPath, method, req, res, body) {

    // GET /api/projects/:pid/agents/:aid/suggest-skills  (EventSource — always GET)
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/suggest-skills$/) && method === "GET") {
      const parts = urlPath.split("/");
      const pid = parts[3];
      const aid = parts[5];

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      let aborted = false;
      req.on("close", () => { aborted = true; });

      const send     = (type, payload) => { if (!aborted) res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`); };
      const progress = (msg) => { console.log("[skills]", msg); send("progress", { message: msg }); };
      const done     = (result) => { send("done", { result }); res.end(); };
      const fail     = (err)    => { send("error", { message: err }); res.end(); };

      try {
        const cfg = io.readConfig();
        if (!cfg.defaultModelId) return fail("No default model configured in Settings → General");

        const projects = io.readProjects();
        const project  = projects.find(p => p.id === pid);
        if (!project)   return fail("Project not found");

        const models    = io.readModels();
        const providers = io.readProviders();
        const model     = models.find(m => m.id === cfg.defaultModelId);
        if (!model) return fail("Default model not found");
        const provider = providers.find(p => p.id === model.providerId);
        if (!provider) return fail("Provider not found");

        const agentsMap = io.readPAgents();
        const agent = (agentsMap[pid] || []).find(a => a.id === aid);
        if (!agent) return fail("Agent not found");

        // Read installed skills from SKILLS.md
        let installedSkills = "";
        if (project.path) {
          const skillsFile = path.join(project.path, ".legion", "agents", aid, "SKILLS.md");
          if (fs.existsSync(skillsFile)) installedSkills = fs.readFileSync(skillsFile, "utf8").slice(0, 1500);
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

        const promptFile = path.resolve(ctx.webRoot, "../../core/prompts/skill-suggest.md");
        let prompt = fs.readFileSync(promptFile, "utf8")
          .replace("{{agent_name}}", agent.name || aid)
          .replace("{{agent_role}}", agent.role || agent.description || "")
          .replace("{{agent_group}}", agent.group || "custom")
          .replace("{{capabilities}}", (agent.capabilities || []).join(", ") || "—")
          .replace("{{project_context}}", projectContext.slice(0, 2000) || "No project context available")
          .replace("{{installed_skills}}", installedSkills || "None");

        progress("Asking AI for skill recommendations…");

        const raw = await ai.callAI(model, provider, prompt);
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return fail("AI returned invalid response");
        const result = JSON.parse(jsonMatch[0]);

        progress(`Found ${result.skills?.length || 0} skill recommendations`);
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
