"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

module.exports = function createChatRoutes(ctx) {
  const { io, http, ai, db, ws } = ctx;

  return async function handle(urlPath, method, req, res, body) {

    // POST /api/projects/:pid/agents/:aid/chat/intro
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/chat\/intro$/) && method === "POST") {
      const parts = urlPath.split("/");
      const pid = parts[3], aid = parts[5];
      const map   = io.readPAgents();
      const agent = (map[pid] || []).find(a => a.id === aid);
      if (!agent) { http.json(res, 404, { error: "Agent not found" }); return true; }

      const cfg     = io.readConfig();
      const modelId = agent.model || cfg.defaultModelId;
      if (!modelId) { http.json(res, 400, { error: "No model configured for this agent" }); return true; }

      const resolved = http.resolveModel(io.readModels(), io.readProviders(), modelId);
      if (!resolved) { http.json(res, 404, { error: `Model '${modelId}' not found or provider not configured` }); return true; }
      const { model: modelObj, provider } = resolved;

      // Skill names + descriptions
      const userSkillsDir = path.join(os.homedir(), ".claude", "skills");
      const skillEntries = (agent.skills || []).map(skillId => {
        if (fs.existsSync(userSkillsDir)) {
          const skillMd = path.join(userSkillsDir, skillId, "SKILL.md");
          if (fs.existsSync(skillMd)) {
            const content = fs.readFileSync(skillMd, "utf8").slice(0, 400);
            const m = content.match(/^description:\s*(.+)/m);
            if (m) return `**${skillId}** — ${m[1].trim().replace(/^["']|["']$/g, "")}`;
          }
        }
        return `**${skillId}**`;
      });
      const skillsLine = skillEntries.length ? skillEntries.join(", ") : "None configured";

      // IDENTITY.md excerpt
      const project = io.readProjects().find(p => p.id === pid);
      let identitySection = "";
      if (project?.path) {
        const identityFile = path.join(project.path, ".legion", "agents", aid, "IDENTITY.md");
        if (fs.existsSync(identityFile)) {
          const raw = fs.readFileSync(identityFile, "utf8").slice(0, 1200);
          identitySection = `## Identity (from IDENTITY.md)\n\n${raw}`;
        }
      }

      // Model display name
      const modelName     = modelObj.name || modelObj.modelId || modelId;
      const providerLabel = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", mistral: "Mistral", ollama: "Ollama", "claude-cli": "Claude CLI" }[provider.type] || provider.type;

      // Load and fill prompt template
      const promptFile = path.resolve(__dirname, "../core/prompts/chat-intro.md");
      const systemPrompt = fs.readFileSync(promptFile, "utf8")
        .replace("{{agent_name}}",    agent.name || aid)
        .replace("{{agent_role}}",    agent.role || agent.description || "General-purpose agent")
        .replace("{{model_name}}",    modelName)
        .replace("{{provider_type}}", providerLabel)
        .replace("{{skills_line}}",   skillsLine)
        .replace("{{identity_section}}", identitySection)
        .replace("{{lang_directive}}",   ai.langDirective(body.lang) || "");

      try {
        const intro = await ai.callAIMessages(modelObj, provider, systemPrompt, [{ role: "user", content: "Introduce yourself." }]);
        http.json(res, 200, { intro });
      } catch (err) {
        http.json(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /api/projects/:pid/agents/:aid/chat
    if (urlPath.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/chat$/) && method === "POST") {
      const parts = urlPath.split("/");
      const pid = parts[3], aid = parts[5];
      const map   = io.readPAgents();
      const agent = (map[pid] || []).find(a => a.id === aid);
      if (!agent) { http.json(res, 404, { error: "Agent not found" }); return true; }
      const { message } = body;
      if (!message?.trim()) { http.json(res, 400, { error: "message is required" }); return true; }

      const cfg     = io.readConfig();
      const modelId = agent.model || cfg.defaultModelId;
      if (!modelId) { http.json(res, 400, { error: "No model configured for this agent. Set one in Settings → Models." }); return true; }

      const resolved = http.resolveModel(io.readModels(), io.readProviders(), modelId);
      if (!resolved) { http.json(res, 404, { error: `Model '${modelId}' not found or provider not configured` }); return true; }
      const { model: modelObj, provider } = resolved;

      const systemPrompt = `You are ${agent.name}. ${agent.role}${ai.langDirective(body.lang)}`;
      try {
        const reply = await ai.callAIMessages(modelObj, provider, systemPrompt, [{ role: "user", content: message.trim() }]);
        db?.log("chat:message", pid, aid, { role: "user", preview: message.slice(0, 80) });
        ws?.broadcast("chat:message", { pid, aid, agentName: agent.name, preview: message.slice(0, 80) });
        http.json(res, 200, { reply });
      } catch (err) {
        http.json(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /api/proxy/v1/messages — Anthropic-compatible proxy routing to Legion providers
    if (urlPath === "/api/proxy/v1/messages" && method === "POST") {
      const { model: modelId, messages = [], max_tokens, system, stream } = body;

      const resolved = http.resolveModel(io.readModels(), io.readProviders(), modelId);
      if (!resolved) { http.json(res, 404, { error: { type: "not_found_error", message: `Model '${modelId}' not found or provider not configured. Check Settings → Models.` } }); return true; }
      const { model: modelObj, provider } = resolved;

      const allMessages = system ? [{ role: "system", content: system }, ...messages] : messages;

      if (provider.type === "ollama") {
        const base = (provider.endpoint || "http://localhost:11434").replace(/\/$/, "");
        if (stream) {
          await ai.streamOllamaToAnthropicSSE(res, base, modelObj, allMessages);
          return true;
        }
        const d = await http.postJson(`${base}/api/chat`, {}, { model: modelObj.modelId, messages: allMessages, stream: false });
        if (d.error) { http.json(res, 500, { error: { type: "api_error", message: `Ollama: ${d.error}` } }); return true; }
        http.json(res, 200, {
          id: `msg_${Date.now()}`, type: "message", role: "assistant",
          content: [{ type: "text", text: d.message?.content || "" }],
          model: modelId, stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        });
        return true;
      }

      if (provider.type === "anthropic") {
        const key = modelObj.key || provider.key;
        if (!key) { http.json(res, 401, { error: { type: "authentication_error", message: "No Anthropic API key configured" } }); return true; }
        const reqBody = { model: modelObj.modelId, max_tokens: max_tokens || 4096, messages };
        if (system) reqBody.system = system;
        const d = await http.postJson("https://api.anthropic.com/v1/messages",
          { "x-api-key": key, "anthropic-version": "2023-06-01" }, reqBody);
        http.json(res, 200, d);
        return true;
      }

      if (provider.type === "claude-cli") {
        const lastUser = messages.filter(m => m.role === "user").pop()?.content || "";
        const prompt = system ? `${system}\n\nUser: ${lastUser}` : lastUser;
        if (stream) {
          await ai.streamClaudeCLIToAnthropicSSE(res, modelObj, prompt);
          return true;
        }
        try {
          const text = await ai.callAIMessages(modelObj, provider, system || "", messages);
          http.json(res, 200, {
            id: `msg_${Date.now()}`, type: "message", role: "assistant",
            content: [{ type: "text", text }],
            model: modelId, stop_reason: "end_turn", stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          });
        } catch (err) {
          http.json(res, 500, { error: { type: "api_error", message: err.message } });
        }
        return true;
      }

      http.json(res, 400, { error: { type: "invalid_request_error", message: `Provider type '${provider.type}' is not supported via the Anthropic-compatible proxy` } });
      return true;
    }

    return false;
  };
};
