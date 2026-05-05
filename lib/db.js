"use strict";

const fs   = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

module.exports = function createDB(configDir) {
  fs.mkdirSync(configDir, { recursive: true });
  const db = new DatabaseSync(path.join(configDir, "legion.db"));

  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");

  function transaction(fn) {
    db.exec("BEGIN");
    try { fn(); db.exec("COMMIT"); }
    catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id   TEXT PRIMARY KEY,
      data TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS agents (
      id   TEXT NOT NULL,
      pid  TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      PRIMARY KEY (id, pid)
    );
    CREATE INDEX IF NOT EXISTS ag_pid ON agents (pid);

    CREATE TABLE IF NOT EXISTS providers (
      id   TEXT PRIMARY KEY,
      data TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS models (
      id   TEXT PRIMARY KEY,
      data TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS config_kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stores (
      id         TEXT NOT NULL,
      pid        TEXT NOT NULL,
      aid        TEXT NOT NULL,
      store      TEXT NOT NULL,
      data       TEXT DEFAULT '{}',
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (id, pid, aid, store)
    );
    CREATE INDEX IF NOT EXISTS st_pad  ON stores (pid, aid, store);
    CREATE INDEX IF NOT EXISTS st_ps   ON stores (pid, store);

    CREATE TABLE IF NOT EXISTS events (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      ts   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      type TEXT,
      pid  TEXT,
      aid  TEXT,
      data TEXT
    );
    CREATE INDEX IF NOT EXISTS ev_ts  ON events (ts DESC);
    CREATE INDEX IF NOT EXISTS ev_pid ON events (pid);
  `);

  // ── Migration ─────────────────────────────────────────────────────────────

  const migrated = db.prepare("SELECT value FROM config_kv WHERE key = 'migrated_v1'").get();
  if (!migrated) {
    const runMigration = db.prepare("INSERT OR IGNORE INTO config_kv (key, value) VALUES ('migrated_v1', 'true')");

    // Helper reads
    function readJSON(file, fallback) {
      if (!fs.existsSync(file)) return fallback;
      try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
    }

    const insertProject  = db.prepare("INSERT OR IGNORE INTO projects (id, data) VALUES (?, ?)");
    const insertAgent    = db.prepare("INSERT OR IGNORE INTO agents (id, pid, data) VALUES (?, ?, ?)");
    const insertProvider = db.prepare("INSERT OR IGNORE INTO providers (id, data) VALUES (?, ?)");
    const insertModel    = db.prepare("INSERT OR IGNORE INTO models (id, data) VALUES (?, ?)");
    const insertConfig   = db.prepare("INSERT OR IGNORE INTO config_kv (key, value) VALUES (?, ?)");
    const insertStore    = db.prepare(
      "INSERT OR IGNORE INTO stores (id, pid, aid, store, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    const migrate = () => transaction(() => {
      // projects.json
      const projects = readJSON(path.join(configDir, "projects.json"), []);
      for (const p of projects) {
        insertProject.run(p.id, JSON.stringify(p));
      }

      // agents/*.json
      const agentsDir = path.join(configDir, "agents");
      if (fs.existsSync(agentsDir)) {
        for (const file of fs.readdirSync(agentsDir)) {
          if (!file.endsWith(".json")) continue;
          const pid = file.slice(0, -5);
          const agentList = readJSON(path.join(agentsDir, file), []);
          for (const a of agentList) {
            insertAgent.run(a.id, pid, JSON.stringify(a));
          }
        }
      }

      // providers.json — strip key field
      const providers = readJSON(path.join(configDir, "providers.json"), []);
      for (const p of providers) {
        const { key, ...safe } = p;
        insertProvider.run(p.id, JSON.stringify(safe));
      }

      // models.json — strip key field
      const models = readJSON(path.join(configDir, "models.json"), []);
      for (const m of models) {
        const { key, ...safe } = m;
        insertModel.run(m.id, JSON.stringify(safe));
      }

      // config.json — each key/value pair
      const cfg = readJSON(path.join(configDir, "config.json"), {});
      for (const [k, v] of Object.entries(cfg)) {
        insertConfig.run(k, JSON.stringify(v));
      }

      // For each project with a path, migrate store files
      const STORES = ["tasks", "memories", "workers", "channels", "cron", "pipeline"];
      for (const p of projects) {
        if (!p.path) continue;
        const legionDir = path.join(p.path, ".legion", "agents");
        if (!fs.existsSync(legionDir)) continue;
        let agentIds = [];
        try { agentIds = fs.readdirSync(legionDir); } catch { continue; }
        for (const aid of agentIds) {
          const agentDir = path.join(legionDir, aid);
          let stat;
          try { stat = fs.statSync(agentDir); } catch { continue; }
          if (!stat.isDirectory()) continue;
          for (const store of STORES) {
            const storeFile = path.join(agentDir, store + ".json");
            if (!fs.existsSync(storeFile)) continue;
            let items;
            try { items = JSON.parse(fs.readFileSync(storeFile, "utf8")); } catch { continue; }
            if (!Array.isArray(items)) continue;
            for (const item of items) {
              if (!item.id) continue;
              insertStore.run(
                item.id,
                p.id,
                aid,
                store,
                JSON.stringify(item),
                item.createdAt || new Date().toISOString(),
                item.updatedAt || null
              );
            }
          }
        }
      }

      runMigration.run();
    });

    migrate();
  }

  // ── Prepared statements cache ──────────────────────────────────────────────

  const _evInsert = db.prepare(
    "INSERT INTO events (type, pid, aid, data) VALUES (?, ?, ?, ?)"
  );

  // ── Projects ──────────────────────────────────────────────────────────────

  function readProjects() {
    const rows = db.prepare("SELECT data FROM projects").all();
    return rows.map(r => JSON.parse(r.data)).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }

  function writeProjects(projects) {
    const del = db.prepare("DELETE FROM projects");
    const ins = db.prepare("INSERT OR REPLACE INTO projects (id, data) VALUES (?, ?)");
    transaction(() => {
      del.run();
      for (const p of projects) ins.run(p.id, JSON.stringify(p));
    });
  }

  function upsertProject(project) {
    db.prepare("INSERT OR REPLACE INTO projects (id, data) VALUES (?, ?)").run(project.id, JSON.stringify(project));
  }

  function deleteProject(id) {
    transaction(() => {
      db.prepare("DELETE FROM projects WHERE id = ?").run(id);
      db.prepare("DELETE FROM agents WHERE pid = ?").run(id);
      db.prepare("DELETE FROM stores WHERE pid = ?").run(id);
    });
  }

  // ── Agents ────────────────────────────────────────────────────────────────

  function readPAgents() {
    const rows = db.prepare("SELECT id, pid, data FROM agents").all();
    const map = {};
    for (const r of rows) {
      if (!map[r.pid]) map[r.pid] = [];
      map[r.pid].push(JSON.parse(r.data));
    }
    return map;
  }

  function writePAgents(map) {
    const del = db.prepare("DELETE FROM agents WHERE pid = ?");
    const ins = db.prepare("INSERT OR REPLACE INTO agents (id, pid, data) VALUES (?, ?, ?)");
    transaction(() => {
      for (const [pid, agents] of Object.entries(map)) {
        del.run(pid);
        for (const a of agents) ins.run(a.id, pid, JSON.stringify(a));
      }
    });
  }

  function upsertAgent(pid, agent) {
    db.prepare("INSERT OR REPLACE INTO agents (id, pid, data) VALUES (?, ?, ?)").run(agent.id, pid, JSON.stringify(agent));
  }

  function deleteAgent(pid, aid) {
    transaction(() => {
      db.prepare("DELETE FROM agents WHERE id = ? AND pid = ?").run(aid, pid);
      db.prepare("DELETE FROM stores WHERE pid = ? AND aid = ?").run(pid, aid);
    });
  }

  function getAgents(pid) {
    const rows = db.prepare("SELECT data FROM agents WHERE pid = ?").all(pid);
    return rows.map(r => JSON.parse(r.data));
  }

  // ── Providers ─────────────────────────────────────────────────────────────

  function readProviders() {
    const rows = db.prepare("SELECT data FROM providers").all();
    return rows.map(r => JSON.parse(r.data));
  }

  function writeProviders(providers) {
    const del = db.prepare("DELETE FROM providers");
    const ins = db.prepare("INSERT OR REPLACE INTO providers (id, data) VALUES (?, ?)");
    transaction(() => {
      del.run();
      for (const p of providers) {
        const { key, ...safe } = p;
        ins.run(p.id, JSON.stringify(safe));
      }
    });
  }

  // ── Models ────────────────────────────────────────────────────────────────

  function readModels() {
    const rows = db.prepare("SELECT data FROM models").all();
    return rows.map(r => JSON.parse(r.data));
  }

  function writeModels(models) {
    const del = db.prepare("DELETE FROM models");
    const ins = db.prepare("INSERT OR REPLACE INTO models (id, data) VALUES (?, ?)");
    transaction(() => {
      del.run();
      for (const m of models) {
        const { key, ...safe } = m;
        ins.run(m.id, JSON.stringify(safe));
      }
    });
  }

  // ── Config ────────────────────────────────────────────────────────────────

  function readConfig() {
    const rows = db.prepare("SELECT key, value FROM config_kv WHERE key != 'migrated_v1'").all();
    const cfg = {};
    for (const r of rows) {
      try { cfg[r.key] = JSON.parse(r.value); } catch { cfg[r.key] = r.value; }
    }
    return cfg;
  }

  function writeConfig(cfg) {
    const del = db.prepare("DELETE FROM config_kv WHERE key != 'migrated_v1'");
    const ins = db.prepare("INSERT OR REPLACE INTO config_kv (key, value) VALUES (?, ?)");
    transaction(() => {
      del.run();
      for (const [k, v] of Object.entries(cfg)) {
        ins.run(k, JSON.stringify(v));
      }
    });
  }

  // ── Agent Stores ──────────────────────────────────────────────────────────

  function storeGet(pid, aid, store) {
    const rows = db.prepare(
      "SELECT data FROM stores WHERE pid = ? AND aid = ? AND store = ? ORDER BY created_at ASC"
    ).all(pid, aid, store);
    return rows.map(r => JSON.parse(r.data));
  }

  function storePost(pid, aid, store, item) {
    db.prepare(
      "INSERT OR REPLACE INTO stores (id, pid, aid, store, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      item.id,
      pid,
      aid,
      store,
      JSON.stringify(item),
      item.createdAt || new Date().toISOString(),
      item.updatedAt || null
    );
    return item;
  }

  function storePatch(pid, aid, store, id, patch) {
    const row = db.prepare(
      "SELECT data FROM stores WHERE id = ? AND pid = ? AND aid = ? AND store = ?"
    ).get(id, pid, aid, store);
    if (!row) return null;
    const existing = JSON.parse(row.data);
    const updated = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    db.prepare(
      "UPDATE stores SET data = ?, updated_at = ? WHERE id = ? AND pid = ? AND aid = ? AND store = ?"
    ).run(JSON.stringify(updated), updated.updatedAt, id, pid, aid, store);
    return updated;
  }

  function storeDel(pid, aid, store, id) {
    db.prepare(
      "DELETE FROM stores WHERE id = ? AND pid = ? AND aid = ? AND store = ?"
    ).run(id, pid, aid, store);
  }

  function getProjectStores(pid, store) {
    const rows = db.prepare(
      "SELECT aid, data FROM stores WHERE pid = ? AND store = ? ORDER BY created_at ASC"
    ).all(pid, store);
    return rows.map(r => ({ ...JSON.parse(r.data), aid: r.aid }));
  }

  // ── Events ────────────────────────────────────────────────────────────────

  function log(type, pid, aid, payload) {
    _evInsert.run(
      type,
      pid   || null,
      aid   || null,
      payload !== undefined ? JSON.stringify(payload) : null
    );
  }

  function recent(pid, limit = 60) {
    const rows = pid
      ? db.prepare("SELECT * FROM events WHERE pid = ? ORDER BY ts DESC LIMIT ?").all(pid, limit)
      : db.prepare("SELECT * FROM events ORDER BY ts DESC LIMIT ?").all(limit);
    return rows.map(r => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
  }

  // ── Export ────────────────────────────────────────────────────────────────

  return {
    // Projects
    readProjects,
    writeProjects,
    upsertProject,
    deleteProject,
    // Agents
    readPAgents,
    writePAgents,
    upsertAgent,
    deleteAgent,
    getAgents,
    // Providers
    readProviders,
    writeProviders,
    // Models
    readModels,
    writeModels,
    // Config
    readConfig,
    writeConfig,
    // Stores
    storeGet,
    storePost,
    storePatch,
    storeDel,
    getProjectStores,
    // Events
    log,
    recent,
  };
};
