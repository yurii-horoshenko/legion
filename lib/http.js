"use strict";

const http  = require("http");
const https = require("https");
const { withResilience } = require("./breaker");

const REQUEST_TIMEOUT_MS       = 30_000;
const REQUEST_TIMEOUT_LOCAL_MS = 300_000; // 5 min for local providers (Ollama, claude-cli)

class HttpError extends Error {
  constructor(message, { status, body, retryable, retryAfterMs } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.retryable = !!retryable;
    if (Number.isFinite(retryAfterMs)) this.retryAfterMs = retryAfterMs;
  }
}

// Retry-After is either delta-seconds or an HTTP-date.
function parseRetryAfter(h) {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return secs * 1000;
  const when = Date.parse(h);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : undefined;
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function rawRequest(method, url, headers, data, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const reqHeaders = { ...headers };
    if (data != null) {
      reqHeaders["Content-Type"] = reqHeaders["Content-Type"] || "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(data);
    }
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: reqHeaders,
      timeout: timeoutMs,
    }, res => {
      let buf = "";
      res.on("data", c => { buf += c; });
      res.on("end", () => {
        const status = res.statusCode || 0;
        let parsed;
        try { parsed = buf ? JSON.parse(buf) : {}; } catch { parsed = undefined; }

        if (status >= 200 && status < 300) {
          if (parsed === undefined) return reject(new HttpError("Invalid JSON response", { status }));
          return resolve(parsed);
        }
        const msg = parsed?.error?.message || parsed?.error || buf.slice(0, 200) || `HTTP ${status}`;
        if (isRetryableStatus(status)) {
          return reject(new HttpError(`HTTP ${status}: ${msg}`, {
            status, body: parsed, retryable: true,
            retryAfterMs: parseRetryAfter(res.headers["retry-after"]),
          }));
        }
        // Non-retryable non-2xx: preserve the old contract — resolve the parsed
        // body so callers that inspect `d.error` keep working.
        if (parsed !== undefined) return resolve(parsed);
        return reject(new HttpError(`HTTP ${status}: ${msg}`, { status }));
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new HttpError("Request timed out", { retryable: true })); });
    req.on("error", err => reject(new HttpError(err.message, { retryable: true })));
    if (data != null) req.write(data);
    req.end();
  });
}

function postJson(url, headers, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  const key = new URL(url).hostname;
  return withResilience(key, () => rawRequest("POST", url, headers, JSON.stringify(body), timeoutMs));
}

function getJson(url, headers, timeoutMs = REQUEST_TIMEOUT_MS) {
  const key = new URL(url).hostname;
  return withResilience(key, () => rawRequest("GET", url, headers, null, timeoutMs));
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

// Resolves the parsed JSON body, or {} for an empty body. A non-empty body that
// fails to parse resolves to a sentinel { __invalidJson: true } so the server
// can reject it with 400 instead of silently treating it as {}.
function readBody(req) {
  return new Promise(resolve => {
    let buf = "", size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > 1_000_000) { req.destroy(); resolve({ __invalidJson: true }); return; }
      buf += c;
    });
    req.on("end", () => {
      if (!buf.trim()) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { resolve({ __invalidJson: true }); }
    });
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

module.exports = { postJson, getJson, json, readBody, parseAIJson, resolveModel, createSSEHandler, HttpError, REQUEST_TIMEOUT_LOCAL_MS };
