"use strict";

const http  = require("http");
const https = require("https");

const REQUEST_TIMEOUT_MS       = 30_000;
const REQUEST_TIMEOUT_LOCAL_MS = 300_000; // 5 min for local providers (Ollama, claude-cli)

function postJson(url, headers, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers },
      timeout: timeoutMs,
    }, res => {
      let buf = "";
      res.on("data", c => { buf += c; });
      res.on("end", () => { try { resolve(JSON.parse(buf)); } catch(e) { reject(e); } });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function getJson(url, headers) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers, timeout: REQUEST_TIMEOUT_MS }, res => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise(resolve => {
    let buf = "", size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > 1_000_000) { req.destroy(); resolve({}); return; }
      buf += c;
    });
    req.on("end", () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
  });
}

// Strip markdown fences and extract first JSON object/array from AI output
function parseAIJson(raw) {
  const stripped = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  const jsonStr  = stripped.startsWith("{") || stripped.startsWith("[")
    ? stripped
    : (stripped.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0] || "");
  if (!jsonStr) throw new Error(`Non-JSON response: ${raw.slice(0, 200)}`);
  return JSON.parse(jsonStr);
}

// Find model + provider by modelId (checks both model.id and model.modelId)
function resolveModel(models, providers, modelId) {
  const model = models.find(m => m.modelId === modelId || m.id === modelId);
  if (!model) return null;
  const provider = providers.find(p => p.id === model.providerId);
  return provider ? { model, provider } : null;
}

// Set up SSE response and return helpers; tag is used for server-side console logs
function createSSEHandler(res, req, tag) {
  let aborted = false;
  req.on("close", () => { aborted = true; });
  res.writeHead(200, {
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection":    "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  const send     = (type, payload) => { if (!aborted) res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`); };
  const progress = (msg)           => { if (tag) console.log(`[${tag}]`, msg); send("progress", { message: msg }); };
  const done     = (result)        => { send("done", { result }); res.end(); };
  const fail     = (err)           => { send("error", { message: err }); res.end(); };
  const isAborted = ()             => aborted;
  return { send, progress, done, fail, isAborted };
}

module.exports = { postJson, getJson, json, readBody, parseAIJson, resolveModel, createSSEHandler, REQUEST_TIMEOUT_LOCAL_MS };
