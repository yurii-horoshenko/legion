"use strict";

const fs    = require("fs");
const path  = require("path");
const https = require("https");

module.exports = function createIO(configDir) {
  const agentsDir     = path.join(configDir, "agents");
  const modelsFile    = path.join(configDir, "models.json");
  const keysFile      = path.join(configDir, ".keys.json");
  const providersFile = path.join(configDir, "providers.json");
  const pkeysFile     = path.join(configDir, ".pkeys.json");
  const projectsFile  = path.join(configDir, "projects.json");
  const configFile    = path.join(configDir, "config.json");

  fs.mkdirSync(configDir,  { recursive: true });
  fs.mkdirSync(agentsDir,  { recursive: true });

  function readProjects() {
    if (!fs.existsSync(projectsFile)) return [];
    try { return JSON.parse(fs.readFileSync(projectsFile, "utf8")); } catch { return []; }
  }

  function writeProjects(projects) {
    const data = JSON.stringify(projects, null, 2);
    const tmp = projectsFile + ".tmp";
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, projectsFile);
  }

  function readPAgents() {
    const map = {};
    if (!fs.existsSync(agentsDir)) return map;
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith(".json")) continue;
      const pid = file.slice(0, -5);
      try { map[pid] = JSON.parse(fs.readFileSync(path.join(agentsDir, file), "utf8")); } catch {}
    }
    return map;
  }

  function writePAgents(map) {
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const [pid, agents] of Object.entries(map)) {
      const file = path.join(agentsDir, `${pid}.json`);
      const tmp  = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(agents, null, 2));
      fs.renameSync(tmp, file);
    }
  }

  function readModels() {
    const models = fs.existsSync(modelsFile)
      ? (() => { try { return JSON.parse(fs.readFileSync(modelsFile, "utf8")); } catch { return []; } })()
      : [];
    const keys = fs.existsSync(keysFile)
      ? (() => { try { return JSON.parse(fs.readFileSync(keysFile, "utf8")); } catch { return {}; } })()
      : {};
    return models.map(m => ({ ...m, key: keys[m.id] || "" }));
  }

  function writeModels(models) {
    const keys = {};
    const safe = models.map(({ key, ...m }) => { if (key) keys[m.id] = key; return m; });
    const mData = JSON.stringify(safe, null, 2);
    const kData = JSON.stringify(keys, null, 2);
    const mTmp = modelsFile + ".tmp", kTmp = keysFile + ".tmp";
    fs.writeFileSync(mTmp, mData); fs.renameSync(mTmp, modelsFile);
    fs.writeFileSync(kTmp, kData); fs.renameSync(kTmp, keysFile);
  }

  function readProviders() {
    const providers = fs.existsSync(providersFile)
      ? (() => { try { return JSON.parse(fs.readFileSync(providersFile, "utf8")); } catch { return []; } })()
      : [];
    const keys = fs.existsSync(pkeysFile)
      ? (() => { try { return JSON.parse(fs.readFileSync(pkeysFile, "utf8")); } catch { return {}; } })()
      : {};
    return providers.map(p => ({ ...p, key: keys[p.id] || "" }));
  }

  function writeProviders(providers) {
    const keys = {};
    const safe = providers.map(({ key, ...p }) => { if (key) keys[p.id] = key; return p; });
    const pData = JSON.stringify(safe, null, 2);
    const kData = JSON.stringify(keys, null, 2);
    const pTmp = providersFile + ".tmp", kTmp = pkeysFile + ".tmp";
    fs.writeFileSync(pTmp, pData); fs.renameSync(pTmp, providersFile);
    fs.writeFileSync(kTmp, kData); fs.renameSync(kTmp, pkeysFile);
  }

  function readConfig() {
    try { return JSON.parse(fs.readFileSync(configFile, "utf8")); } catch { return {}; }
  }

  function writeConfig(cfg) {
    const tmp = configFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, configFile);
  }

  function integrationsFilePath(project) {
    return path.join(project.path, ".legion", "integrations.json");
  }

  function readIntegrations(project) {
    const f = integrationsFilePath(project);
    if (!fs.existsSync(f)) return {};
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; }
  }

  function writeIntegrations(project, data) {
    const f = integrationsFilePath(project);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, f);
  }

  function linearQuery(apiKey, query, variables) {
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
      lreq.on("error", reject);
      lreq.write(body);
      lreq.end();
    });
  }

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
