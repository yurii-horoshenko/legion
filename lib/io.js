"use strict";

const fs    = require("fs");
const path  = require("path");
const https = require("https");

module.exports = function createIO(configDir, db) {
  const agentsDir = path.join(configDir, "agents");
  const keysFile  = path.join(configDir, ".keys.json");
  const pkeysFile = path.join(configDir, ".pkeys.json");

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });

  // ── Key file helpers ───────────────────────────────────────────────────────

  function readKeys(file) {
    if (!fs.existsSync(file)) return {};
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
  }

  function writeKeys(file, keys) {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(keys, null, 2));
    fs.renameSync(tmp, file);
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  function readProjects() {
    return db.readProjects();
  }

  function writeProjects(list) {
    db.writeProjects(list);
  }

  // ── Agents ────────────────────────────────────────────────────────────────

  function readPAgents() {
    return db.readPAgents();
  }

  function writePAgents(map) {
    db.writePAgents(map);
  }

  // ── Models ────────────────────────────────────────────────────────────────

  function readModels() {
    const models = db.readModels();
    const keys   = readKeys(keysFile);
    return models.map(m => ({ ...m, key: keys[m.id] || "" }));
  }

  function writeModels(models) {
    const keys = {};
    const safe = models.map(({ key, ...m }) => { if (key) keys[m.id] = key; return m; });
    db.writeModels(safe);
    writeKeys(keysFile, keys);
  }

  // ── Providers ─────────────────────────────────────────────────────────────

  function readProviders() {
    const providers = db.readProviders();
    const keys      = readKeys(pkeysFile);
    return providers.map(p => ({ ...p, key: keys[p.id] || "" }));
  }

  function writeProviders(providers) {
    const keys = {};
    const safe = providers.map(({ key, ...p }) => { if (key) keys[p.id] = key; return p; });
    db.writeProviders(safe);
    writeKeys(pkeysFile, keys);
  }

  // ── Config ────────────────────────────────────────────────────────────────

  function readConfig() {
    return db.readConfig();
  }

  function writeConfig(cfg) {
    db.writeConfig(cfg);
  }

  // ── Integrations (project-specific, stays as file) ────────────────────────

  function integrationsFilePath(project) {
    return path.join(project.path, ".legion", "integrations.json");
  }

  function readIntegrations(project) {
    const f = integrationsFilePath(project);
    if (!fs.existsSync(f)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(f, "utf8"));
      // Default enableForAllAgents to true if linear is configured but key not set
      if (data.linear && data.linear.enableForAllAgents === undefined) {
        data.linear.enableForAllAgents = true;
      }
      return data;
    } catch { return {}; }
  }

  function writeIntegrations(project, data) {
    const f = integrationsFilePath(project);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, f);
  }

  // ── Linear ────────────────────────────────────────────────────────────────

  function linearQuery(apiKey, query, variables, timeoutMs = 15000) {
    if (variables === undefined) variables = {};
    return new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify({ query, variables }));
      const lreq = https.request({
        hostname: "api.linear.app",
        path:     "/graphql",
        method:   "POST",
        headers: {
          "Content-Type":   "application/json",
          "Authorization":  apiKey,
          "Content-Length": body.length,
        },
      }, (lres) => {
        let data = "";
        lres.on("data", c => data += c);
        lres.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error("Invalid JSON from Linear")); }
        });
      });
      lreq.setTimeout(timeoutMs, () => {
        lreq.destroy(new Error(`Linear API timeout after ${timeoutMs}ms`));
      });
      lreq.on("error", reject);
      lreq.write(body);
      lreq.end();
    });
  }

  // ── Export ────────────────────────────────────────────────────────────────

  return {
    agentsDir,
    readProjects,
    writeProjects,
    readPAgents,
    writePAgents,
    readModels,
    writeModels,
    readProviders,
    writeProviders,
    readConfig,
    writeConfig,
    readIntegrations,
    writeIntegrations,
    integrationsFilePath,
    linearQuery,
  };
};
