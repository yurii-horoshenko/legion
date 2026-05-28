"use strict";

const http  = require("http");
const https = require("https");
const log   = require("./log");

const LANG_NAMES = { ru: "Russian", en: "English", de: "German", fr: "French", uk: "Ukrainian", pl: "Polish" };

module.exports = function createAI(httpLib, io) {
  const { postJson, getJson, REQUEST_TIMEOUT_LOCAL_MS } = httpLib;

  function langDirective(lang) {
    if (!lang || lang === "en") return "";
    const name = LANG_NAMES[lang] || lang;
    return `\n\nAlways respond in ${name}, regardless of the language used in the conversation.`;
  }

  async function callAI(model, provider, prompt) {
    const elapsed = log.timer();
    const label = `${provider.type}/${model.modelId || model.id}`;
    log.info("ai", `start ${label}`);
    try {
      const result = await _callAI(model, provider, prompt);
      log.info("ai", `done  ${label} in ${elapsed()}`);
      return result;
    } catch (err) {
      log.error("ai", `fail  ${label} in ${elapsed()} — ${err.message}`);
      throw err;
    }
  }

  async function _callAI(model, provider, prompt, opts = {}) {
    const { type, endpoint } = provider;
    const key = model.key || provider.key;
    const messages = [{ role: "user", content: prompt }];
    switch (type) {
      case "anthropic": {
        const d = await postJson("https://api.anthropic.com/v1/messages", {
          "x-api-key": key, "anthropic-version": "2023-06-01",
        }, { model: model.modelId, max_tokens: 4096, messages });
        if (d.error) throw new Error(`Anthropic: ${d.error.message || JSON.stringify(d.error)}`);
        return d.content?.[0]?.text || "";
      }
      case "openai":
      case "mistral": {
        const base = endpoint || (type === "openai" ? "https://api.openai.com" : "https://api.mistral.ai");
        const d = await postJson(`${base.replace(/\/$/, "")}/v1/chat/completions`, {
          "Authorization": `Bearer ${key}`,
        }, { model: model.modelId, messages });
        if (d.error) throw new Error(`${type}: ${d.error.message || JSON.stringify(d.error)}`);
        return d.choices?.[0]?.message?.content || "";
      }
      case "google": {
        const d = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${model.modelId}:generateContent?key=${key}`,
          {},
          { contents: [{ parts: [{ text: prompt }] }] }
        );
        if (d.error) throw new Error(`Google: ${d.error.message || JSON.stringify(d.error)}`);
        return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
      case "ollama": {
        const base = (endpoint || "http://localhost:11434").replace(/\/$/, "");
        const d = await postJson(`${base}/api/chat`, {},
          { model: model.modelId, messages, stream: false }, REQUEST_TIMEOUT_LOCAL_MS);
        if (d.error) throw new Error(`Ollama: ${d.error}`);
        return d.message?.content || "";
      }
      case "claude-cli": {
        const modelFlag  = model.modelId ? ["--model", model.modelId] : [];
        // Strip dangerous tools (Bash, Shell, …) before granting with
        // --dangerously-skip-permissions. See lib/toolgate.js.
        const { filterAllowedTools } = require("./toolgate");
        const { allowed: toolsValue, removed } = filterAllowedTools(opts.allowedTools || "");
        if (removed.length) log.warn("ai:claude-cli", `blocked dangerous tools from allowlist: ${removed.join(",")}`);
        // When specific tools are allowed (e.g. read-only file access), add
        // --dangerously-skip-permissions so prompts don't block the subprocess.
        // This is safe because dangerous tools (Bash, Edit, Write) are NOT in the allowlist.
        const skipPerms  = toolsValue ? ["--dangerously-skip-permissions"] : [];
        const result = await new Promise((resolve, reject) => {
          const { spawn } = require("child_process");
          const child = spawn("claude", ["-p", "-", "--output-format", "text", "--tools", toolsValue, ...skipPerms, ...modelFlag], { shell: process.platform === "win32" });
          let stdout = "", stderr = "";
          const cliTimer = setTimeout(() => {
            log.warn("ai:claude-cli", `timeout 10min reached — killing subprocess (model=${model.modelId})`);
            child.kill();
            reject(new Error("claude-cli timeout after 10min"));
          }, 600000);
          child.stdout.on("data", d => { stdout += d; });
          child.stderr.on("data", d => { stderr += d; });
          child.on("error", err => { clearTimeout(cliTimer); reject(err); });
          child.on("close", code => {
            clearTimeout(cliTimer);
            if (code !== 0) reject(new Error(stderr.trim() || `claude exited with code ${code}`));
            else resolve(stdout.trim());
          });
          child.stdin.write(prompt);
          child.stdin.end();
        });
        return result;
      }
      default: throw new Error(`Unsupported provider type: ${type}`);
    }
  }

  // Helper: call AI with system prompt + messages array (multi-provider, proper system support)
  async function callAIMessages(model, provider, systemPrompt, messages, opts = {}) {
    const elapsed = log.timer();
    const label = `${provider.type}/${model.modelId || model.id}`;
    log.info("ai", `start ${label}`);
    try {
      const result = await _callAIMessages(model, provider, systemPrompt, messages, opts);
      log.info("ai", `done  ${label} in ${elapsed()}`);
      return result;
    } catch (err) {
      log.error("ai", `fail  ${label} in ${elapsed()} — ${err.message}`);
      throw err;
    }
  }

  async function _callAIMessages(model, provider, systemPrompt, messages, opts = {}) {
    const { type, endpoint } = provider;
    const key = model.key || provider.key;
    const maxTokens = opts.maxTokens || 4096;
    switch (type) {
      case "anthropic": {
        const reqBody = { model: model.modelId, max_tokens: maxTokens, messages };
        // Wrap system prompt in cache_control block so Anthropic caches it for 5 min
        if (systemPrompt) reqBody.system = [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }];
        const d = await postJson("https://api.anthropic.com/v1/messages",
          { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "prompt-caching-2024-07-31" }, reqBody);
        if (d.error) throw new Error(`Anthropic: ${d.error.message || JSON.stringify(d.error)}`);
        return d.content?.[0]?.text || "";
      }
      case "openai":
      case "mistral": {
        const base = endpoint || (type === "openai" ? "https://api.openai.com" : "https://api.mistral.ai");
        const msgs = systemPrompt ? [{ role: "system", content: systemPrompt }, ...messages] : messages;
        const d = await postJson(`${base.replace(/\/$/, "")}/v1/chat/completions`,
          { "Authorization": `Bearer ${key}` }, { model: model.modelId, messages: msgs });
        if (d.error) throw new Error(`${type}: ${d.error.message || JSON.stringify(d.error)}`);
        return d.choices?.[0]?.message?.content || "";
      }
      case "google": {
        const text = (systemPrompt ? systemPrompt + "\n\n" : "") + messages.map(m => m.content).join("\n");
        const d = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${model.modelId}:generateContent?key=${key}`,
          {}, { contents: [{ parts: [{ text }] }] });
        if (d.error) throw new Error(`Google: ${d.error.message || JSON.stringify(d.error)}`);
        return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
      case "ollama": {
        const base = (endpoint || "http://localhost:11434").replace(/\/$/, "");
        const msgs = systemPrompt ? [{ role: "system", content: systemPrompt }, ...messages] : messages;
        const d = await postJson(`${base}/api/chat`, {}, { model: model.modelId, messages: msgs, stream: false }, REQUEST_TIMEOUT_LOCAL_MS);
        if (d.error) throw new Error(`Ollama: ${d.error}`);
        return d.message?.content || "";
      }
      case "claude-cli": {
        const transcript = messages.map(m =>
          m.role === "assistant" ? `Assistant: ${m.content}` : `User: ${m.content}`
        ).join("\n\n");
        const prompt = systemPrompt ? `${systemPrompt}\n\n${transcript}` : transcript;
        return _callAI(model, provider, prompt, opts);
      }
      default: throw new Error(`Unsupported provider type: ${type}`);
    }
  }

  // Helper: stream Claude CLI response to HTTP res in Anthropic SSE format
  function streamClaudeCLIToAnthropicSSE(res, modelObj, prompt) {
    return new Promise((resolve) => {
      const { spawn } = require("child_process");
      const modelFlag = modelObj.modelId ? ["--model", modelObj.modelId] : [];
      const child = spawn("claude", ["-p", "-", "--output-format", "stream-json", "--tools", "", ...modelFlag], { shell: process.platform === "win32" });
      const msgId = `msg_${Date.now()}`;

      res.writeHead(200, {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      sse("message_start", { type: "message_start", message: { id: msgId, type: "message", role: "assistant", content: [], model: modelObj.modelId || "claude", stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } });
      sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      sse("ping", { type: "ping" });

      let buf = "";
      let emittedAny = false;
      const timer = setTimeout(() => {
        log.warn("ai:claude-cli", `stream timeout 10min reached — killing subprocess (model=${modelObj.modelId})`);
        child.kill();
        if (!res.writableEnded) res.end();
        resolve();
      }, 300000);

      child.stdout.on("data", chunk => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const d = JSON.parse(line);
            if (d.type === "assistant" && Array.isArray(d.message?.content)) {
              for (const block of d.message.content) {
                if (block.type === "text" && block.text) {
                  sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: block.text } });
                  emittedAny = true;
                }
              }
            }
            if (d.type === "result") {
              if (!emittedAny && d.result) {
                sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: d.result } });
              }
              sse("content_block_stop",  { type: "content_block_stop", index: 0 });
              sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } });
              sse("message_stop", { type: "message_stop" });
              clearTimeout(timer);
              res.end();
              resolve();
            }
          } catch {}
        }
      });

      child.on("error", err => {
        clearTimeout(timer);
        if (!res.writableEnded) {
          sse("error", { type: "error", error: { type: "api_error", message: err.message } });
          res.end();
        }
        resolve();
      });

      child.on("close", code => {
        clearTimeout(timer);
        if (!res.writableEnded) {
          if (code !== 0) {
            sse("error", { type: "error", error: { type: "api_error", message: `claude exited with code ${code}` } });
          } else {
            sse("content_block_stop",  { type: "content_block_stop", index: 0 });
            sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } });
            sse("message_stop", { type: "message_stop" });
          }
          res.end();
        }
        resolve();
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  // Helper: stream Ollama response to HTTP res in Anthropic SSE format
  function streamOllamaToAnthropicSSE(res, base, modelObj, messages) {
    return new Promise((resolve) => {
      const u = new URL(`${base}/api/chat`);
      const bodyData = JSON.stringify({ model: modelObj.modelId, messages, stream: true });
      const lib = u.protocol === "https:" ? https : http;
      const msgId = `msg_${Date.now()}`;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      sse("message_start", { type: "message_start", message: { id: msgId, type: "message", role: "assistant", content: [], model: modelObj.modelId, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } });
      sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      sse("ping", { type: "ping" });

      const ollamaReq = lib.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 11434),
        path: u.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyData) },
      }, ollamaRes => {
        let buf = "";
        ollamaRes.on("data", chunk => {
          buf += chunk.toString();
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const d = JSON.parse(line);
              if (d.message?.content) sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: d.message.content } });
              if (d.done) {
                sse("content_block_stop",  { type: "content_block_stop", index: 0 });
                sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: d.eval_count || 0 } });
                sse("message_stop", { type: "message_stop" });
                res.end();
                resolve();
              }
            } catch {}
          }
        });
        ollamaRes.on("end", () => { if (!res.writableEnded) { res.end(); } resolve(); });
        ollamaRes.on("error", err => {
          if (!res.writableEnded) { sse("error", { type: "error", error: { type: "api_error", message: err.message } }); res.end(); }
          resolve();
        });
      });
      ollamaReq.on("error", err => {
        if (!res.writableEnded) { sse("error", { type: "error", error: { type: "api_error", message: err.message } }); res.end(); }
        resolve();
      });
      ollamaReq.write(bodyData);
      ollamaReq.end();
    });
  }

  async function fetchRemoteModels(provider) {
    const { type, key, endpoint } = provider;
    try {
      switch (type) {
        case "anthropic": {
          const d = await getJson("https://api.anthropic.com/v1/models?limit=100", {
            "x-api-key": key, "anthropic-version": "2023-06-01",
          });
          return (d.data || []).map(m => ({ id: m.id, name: m.display_name || m.id }));
        }
        case "openai": {
          const d = await getJson("https://api.openai.com/v1/models", {
            "Authorization": `Bearer ${key}`,
          });
          const keep = /^(gpt|o1|o3|chatgpt)/;
          return (d.data || [])
            .filter(m => keep.test(m.id))
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(m => ({ id: m.id, name: m.id }));
        }
        case "google": {
          const d = await getJson(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
          );
          return (d.models || [])
            .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
            .map(m => ({ id: m.name.replace("models/", ""), name: m.displayName || m.name }));
        }
        case "mistral": {
          const d = await getJson("https://api.mistral.ai/v1/models", {
            "Authorization": `Bearer ${key}`,
          });
          return (d.data || []).map(m => ({ id: m.id, name: m.id }));
        }
        case "ollama": {
          const base = (endpoint || "http://localhost:11434").replace(/\/$/, "");
          const d = await getJson(`${base}/api/tags`);
          return (d.models || []).map(m => ({ id: m.name, name: m.name }));
        }
        case "claude-cli":
          return [
            { id: "claude-opus-4-7",          name: "Claude Opus 4.7" },
            { id: "claude-sonnet-4-6",         name: "Claude Sonnet 4.6" },
            { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
          ];
        default:
          return [];
      }
    } catch (err) {
      return { error: err.message };
    }
  }

  // ── Embeddings (best-effort; null when provider can't embed) ───────────────

  // Returns an array of vectors (number[][]) aligned to `texts`, or null if the
  // provider type has no embedding endpoint or the call fails. Semantic memory
  // treats embeddings as optional, so callers degrade to keyword search on null.
  async function embed(provider, texts, opts = {}) {
    const inputs = Array.isArray(texts) ? texts : [texts];
    if (!inputs.length) return [];
    const { type, endpoint } = provider;
    const key = provider.key;
    try {
      switch (type) {
        case "openai": {
          const base  = (endpoint || "https://api.openai.com").replace(/\/$/, "");
          const model = opts.embedModel || "text-embedding-3-small";
          const d = await postJson(`${base}/v1/embeddings`, { "Authorization": `Bearer ${key}` }, { model, input: inputs });
          if (d.error || !Array.isArray(d.data)) throw new Error(d.error?.message || "no data");
          return d.data.sort((a, b) => a.index - b.index).map(e => e.embedding);
        }
        case "ollama": {
          const base  = (endpoint || "http://localhost:11434").replace(/\/$/, "");
          const model = opts.embedModel || "nomic-embed-text";
          const d = await postJson(`${base}/api/embed`, {}, { model, input: inputs }, REQUEST_TIMEOUT_LOCAL_MS);
          if (d.error || !Array.isArray(d.embeddings)) throw new Error(d.error || "no embeddings");
          return d.embeddings;
        }
        case "google": {
          const model = opts.embedModel || "text-embedding-004";
          const out = [];
          for (const text of inputs) {
            const d = await postJson(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${key}`,
              {}, { content: { parts: [{ text }] } });
            if (d.error || !d.embedding?.values) throw new Error(d.error?.message || "no embedding");
            out.push(d.embedding.values);
          }
          return out;
        }
        default:
          return null; // anthropic, mistral, claude-cli: no embedding endpoint
      }
    } catch (err) {
      log.warn("ai:embed", `${type} embedding failed — ${err.message}`);
      return null;
    }
  }

  // ── Failover & degradation ladder ─────────────────────────────────────────

  // Build an ordered candidate list: the primary {model, provider} followed by
  // one model from each OTHER configured provider, capped at `max`. Lets a call
  // survive a provider outage (its breaker trips → we move to the next).
  function buildFailoverCandidates(primary, allModels, allProviders, max = 3) {
    const out = [primary];
    const seen = new Set([primary.provider.id]);
    for (const m of allModels) {
      if (out.length >= max) break;
      if (seen.has(m.providerId)) continue;
      const prov = allProviders.find(p => p.id === m.providerId);
      if (!prov) continue;
      out.push({ model: m, provider: prov });
      seen.add(m.providerId);
    }
    return out;
  }

  // Try each candidate in order; return the first success, throw the last error.
  async function callAIMessagesFailover(candidates, systemPrompt, messages, opts = {}) {
    if (!candidates?.length) throw new Error("No model candidates available");
    let lastErr;
    for (let i = 0; i < candidates.length; i++) {
      const { model, provider } = candidates[i];
      try {
        return await callAIMessages(model, provider, systemPrompt, messages, opts);
      } catch (err) {
        lastErr = err;
        const more = i < candidates.length - 1;
        log.warn("ai:failover", `${provider.type}/${model.modelId || model.id} failed — ${err.message}${more ? " → next provider" : ""}`);
      }
    }
    throw lastErr;
  }

  // Failover + a single repair retry when the model returns an empty reply
  // (transient empties happen). Mirrors Sloppy's degradation ladder
  // (watchdog → retry → fallback) minus the streaming-specific parts.
  async function callAIMessagesResilient(candidates, systemPrompt, messages, opts = {}) {
    const reply = await callAIMessagesFailover(candidates, systemPrompt, messages, opts);
    if (reply && reply.trim()) return reply;
    log.warn("ai", "empty response — one repair retry");
    const nudged = messages.map((m, i) =>
      i === messages.length - 1 && m.role === "user"
        ? { ...m, content: `${m.content}\n\n(Your previous answer was empty. Provide a complete response now.)` }
        : m
    );
    return callAIMessagesFailover(candidates, systemPrompt, nudged, opts);
  }

  return {
    callAI,
    callAIMessages,
    callAIMessagesFailover,
    callAIMessagesResilient,
    buildFailoverCandidates,
    embed,
    streamClaudeCLIToAnthropicSSE,
    streamOllamaToAnthropicSSE,
    fetchRemoteModels,
    langDirective,
  };
};
