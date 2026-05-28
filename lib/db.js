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

    CREATE TABLE IF NOT EXISTS chat_logs (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ts      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      pid     TEXT,
      aid     TEXT,
      type    TEXT,
      actor   TEXT,
      content TEXT,
      ms      INTEGER
    );
    CREATE INDEX IF NOT EXISTS cl_pid_ts ON chat_logs (pid, ts DESC);
  `);

  // ── Semantic memory schema (Phase 1) ───────────────────────────────────────
  // Canonical store + edges + embeddings. FTS5 is best-effort: if the bundled
  // SQLite lacks it, keyword search falls back to LIKE (see memKeywordSearch).
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id         TEXT PRIMARY KEY,
      pid        TEXT NOT NULL,
      aid        TEXT,
      kind       TEXT DEFAULT 'note',
      class      TEXT,
      content    TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      confidence REAL DEFAULT 1.0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      expires_at INTEGER,
      deleted    INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS mem_pid ON memories (pid, deleted);
    CREATE INDEX IF NOT EXISTS mem_exp ON memories (expires_at);

    CREATE TABLE IF NOT EXISTS memory_embeddings (
      memory_id TEXT PRIMARY KEY,
      dim       INTEGER NOT NULL,
      vec       BLOB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_edges (
      src    TEXT NOT NULL,
      dst    TEXT NOT NULL,
      rel    TEXT DEFAULT 'related',
      weight REAL DEFAULT 1.0,
      PRIMARY KEY (src, dst, rel)
    );
    CREATE INDEX IF NOT EXISTS mem_edge_src ON memory_edges (src);

    -- Transactional outbox: a memory write commits its canonical row AND an
    -- outbox row atomically; a background indexer drives embedding upserts with
    -- retry, so the embedding provider can be down without losing work, and
    -- pending rows resume after a restart (crash recovery).
    CREATE TABLE IF NOT EXISTS memory_outbox (
      memory_id    TEXT PRIMARY KEY,
      content      TEXT NOT NULL,
      attempts     INTEGER DEFAULT 0,
      next_retry_at INTEGER DEFAULT 0,
      last_error   TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS mem_outbox_retry ON memory_outbox (next_retry_at);

    -- Retrieval-quality telemetry: one row per recall (latency + which ids won).
    CREATE TABLE IF NOT EXISTS memory_recall_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      pid        TEXT,
      query      TEXT,
      latency_ms INTEGER,
      result_ids TEXT
    );
    CREATE INDEX IF NOT EXISTS mem_recall_ts ON memory_recall_log (ts DESC);
  `);

  // Add trace_id columns for run reconstruction (idempotent — ignore if exists).
  for (const t of ["events", "chat_logs"]) {
    try { db.exec(`ALTER TABLE ${t} ADD COLUMN trace_id TEXT`); } catch { /* already present */ }
  }

  let ftsEnabled = false;
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, content);`);
    ftsEnabled = true;
  } catch (e) {
    log_fts_unavailable(e);
  }
  function log_fts_unavailable(e) {
    try { require("./log").warn("db", `FTS5 unavailable, keyword search falls back to LIKE — ${e.message}`); } catch {}
  }

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

  // ── Config defaults (INSERT OR IGNORE — never overwrite user values) ───────

  const CONFIG_DEFAULTS = {
    autoApplyModel: true,
  };

  const _defInsert = db.prepare("INSERT OR IGNORE INTO config_kv (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(CONFIG_DEFAULTS)) {
    _defInsert.run(k, JSON.stringify(v));
  }

  // ── Prepared statements cache ──────────────────────────────────────────────

  const _evInsert = db.prepare(
    "INSERT INTO events (type, pid, aid, data, trace_id) VALUES (?, ?, ?, ?, ?)"
  );

  const _clInsert = db.prepare(
    "INSERT INTO chat_logs (pid, aid, type, actor, content, ms, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
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

  // ── Conversation History ──────────────────────────────────────────────────

  const _histGet = db.prepare(
    "SELECT data FROM stores WHERE id='__history__' AND pid=? AND aid=? AND store='chat_history'"
  );
  const _histSet = db.prepare(
    "INSERT OR REPLACE INTO stores (id,pid,aid,store,data,created_at,updated_at) VALUES ('__history__',?,?,?,?,?,?)"
  );

  function getChatHistory(pid, aid) {
    const row = _histGet.get(pid, aid);
    if (!row) return [];
    try { return JSON.parse(row.data); } catch { return []; }
  }

  function appendChatHistory(pid, aid, role, content, maxMessages = 40) {
    const history = getChatHistory(pid, aid);
    history.push({ role, content });
    const trimmed = history.slice(-maxMessages);
    const now = new Date().toISOString();
    _histSet.run(pid, aid, 'chat_history', JSON.stringify(trimmed), now, now);
  }

  function clearChatHistory(pid, aid) {
    db.prepare(
      "DELETE FROM stores WHERE id='__history__' AND pid=? AND aid=? AND store='chat_history'"
    ).run(pid, aid);
  }

  // ── Events ────────────────────────────────────────────────────────────────

  function log(type, pid, aid, payload, traceId) {
    _evInsert.run(
      type,
      pid   || null,
      aid   || null,
      payload !== undefined ? JSON.stringify(payload) : null,
      traceId || null
    );
  }

  function recent(pid, limit = 60) {
    const rows = pid
      ? db.prepare("SELECT * FROM events WHERE pid = ? ORDER BY ts DESC LIMIT ?").all(pid, limit)
      : db.prepare("SELECT * FROM events ORDER BY ts DESC LIMIT ?").all(limit);
    return rows.map(r => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
  }

  // ── Chat Logs ─────────────────────────────────────────────────────────────

  function chatLog(pid, aid, type, actor, content, ms, traceId) {
    _clInsert.run(pid || null, aid || null, type, actor || null, content || null, ms || null, traceId || null);
  }

  function getChatLogs(pid, limit = 200) {
    const rows = pid
      ? db.prepare("SELECT * FROM chat_logs WHERE pid = ? ORDER BY ts ASC LIMIT ?").all(pid, limit)
      : db.prepare("SELECT * FROM chat_logs ORDER BY ts ASC LIMIT ?").all(limit);
    return rows;
  }

  function clearChatLogs() {
    db.exec("DELETE FROM chat_logs");
  }

  // Bounded retention instead of wiping on boot: drop rows older than maxAgeMs
  // and cap total row count. Returns rows pruned.
  function pruneChatLogs({ maxAgeMs = 30 * 24 * 3600 * 1000, maxRows = 20000 } = {}) {
    let pruned = db.prepare("DELETE FROM chat_logs WHERE ts < ?").run(Date.now() - maxAgeMs).changes || 0;
    const count = db.prepare("SELECT COUNT(*) AS n FROM chat_logs").get().n;
    if (count > maxRows) {
      pruned += db.prepare("DELETE FROM chat_logs WHERE id IN (SELECT id FROM chat_logs ORDER BY ts ASC LIMIT ?)").run(count - maxRows).changes || 0;
    }
    return pruned;
  }

  // Reconstruct a single run's timeline from its trace id.
  function getTrace(traceId) {
    return db.prepare("SELECT * FROM chat_logs WHERE trace_id = ? ORDER BY ts ASC").all(traceId);
  }

  // Returns { replies, errors } counts for a specific agent — used for XP calculation
  function getChatStats(pid, aid) {
    const replies = db.prepare(
      "SELECT COUNT(*) AS n FROM chat_logs WHERE pid = ? AND aid = ? AND type IN ('direct_reply','final_reply')"
    ).get(pid, aid)?.n || 0;
    const errors = db.prepare(
      "SELECT COUNT(*) AS n FROM chat_logs WHERE pid = ? AND aid = ? AND type = 'error'"
    ).get(pid, aid)?.n || 0;
    return { replies, errors };
  }

  // ── Semantic memory (Phase 1) ──────────────────────────────────────────────

  const _memIns = db.prepare(`
    INSERT OR REPLACE INTO memories (id, pid, aid, kind, class, content, importance, confidence, created_at, expires_at, deleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);

  function memInsert(m, opts = {}) {
    const id = m.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const created = m.createdAt || Date.now();
    transaction(() => {
      _memIns.run(id, m.pid, m.aid || null, m.kind || "note", m.class || null,
        m.content, m.importance ?? 0.5, m.confidence ?? 1.0, created, m.expiresAt ?? null);
      if (ftsEnabled) {
        db.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
        db.prepare("INSERT INTO memories_fts (id, content) VALUES (?, ?)").run(id, m.content);
      }
      // Atomic outbox enqueue — canonical row + pending embedding commit together.
      if (opts.enqueueEmbed) {
        db.prepare("INSERT OR REPLACE INTO memory_outbox (memory_id, content, attempts, next_retry_at) VALUES (?, ?, 0, 0)").run(id, m.content);
      }
    });
    return id;
  }

  // ── Memory outbox (durable embedding queue) ────────────────────────────────

  function memOutboxPending(limit = 10, now = Date.now()) {
    return db.prepare("SELECT memory_id, content, attempts FROM memory_outbox WHERE next_retry_at <= ? ORDER BY created_at ASC LIMIT ?").all(now, limit);
  }
  function memOutboxDone(memoryId) {
    db.prepare("DELETE FROM memory_outbox WHERE memory_id = ?").run(memoryId);
  }
  function memOutboxFail(memoryId, err, nextRetryAt) {
    db.prepare("UPDATE memory_outbox SET attempts = attempts + 1, last_error = ?, next_retry_at = ? WHERE memory_id = ?").run(String(err).slice(0, 300), nextRetryAt, memoryId);
  }
  function memOutboxCount() {
    return db.prepare("SELECT COUNT(*) AS n FROM memory_outbox").get().n;
  }

  function memSetEmbedding(id, vec) {
    const f32 = vec instanceof Float32Array ? vec : Float32Array.from(vec);
    const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    db.prepare("INSERT OR REPLACE INTO memory_embeddings (memory_id, dim, vec) VALUES (?, ?, ?)").run(id, f32.length, buf);
  }

  function memById(id) {
    return db.prepare("SELECT * FROM memories WHERE id = ? AND deleted = 0").get(id) || null;
  }

  function memHydrate(ids) {
    if (!ids.length) return new Map();
    const ph = ids.map(() => "?").join(",");
    const rows = db.prepare(`SELECT * FROM memories WHERE id IN (${ph}) AND deleted = 0`).all(...ids);
    return new Map(rows.map(r => [r.id, r]));
  }

  // Keyword search → [{ id, score }], higher score = more relevant.
  // FTS5 bm25 when available, else a LIKE term-hit count.
  function memKeywordSearch(pid, query, limit = 20) {
    const terms = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(t => t.length > 1);
    if (!terms.length) return [];
    if (ftsEnabled) {
      const match = terms.map(t => `"${t}"`).join(" OR ");
      try {
        const rows = db.prepare(`
          SELECT f.id AS id, bm25(memories_fts) AS bm
          FROM memories_fts f JOIN memories m ON m.id = f.id
          WHERE memories_fts MATCH ? AND m.pid = ? AND m.deleted = 0
          ORDER BY bm ASC LIMIT ?
        `).all(match, pid, limit);
        return rows.map(r => ({ id: r.id, score: -r.bm })); // bm25: lower is better
      } catch { /* fall through to LIKE */ }
    }
    const like = terms.map(() => "content LIKE ?").join(" OR ");
    const args = terms.map(t => `%${t}%`);
    const rows = db.prepare(`SELECT id, content FROM memories WHERE pid = ? AND deleted = 0 AND (${like}) LIMIT 200`).all(pid, ...args);
    return rows.map(r => {
      const c = r.content.toLowerCase();
      const hits = terms.reduce((n, t) => n + (c.includes(t) ? 1 : 0), 0);
      return { id: r.id, score: hits };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // All live embeddings for a project → [{ id, dim, vec: Float32Array }].
  function memEmbeddings(pid) {
    const rows = db.prepare(`
      SELECT e.memory_id AS id, e.dim AS dim, e.vec AS vec
      FROM memory_embeddings e JOIN memories m ON m.id = e.memory_id
      WHERE m.pid = ? AND m.deleted = 0
    `).all(pid);
    return rows.map(r => ({ id: r.id, dim: r.dim, vec: new Float32Array(r.vec.buffer, r.vec.byteOffset, r.dim) }));
  }

  function memEdgesFrom(ids) {
    if (!ids.length) return [];
    const ph = ids.map(() => "?").join(",");
    return db.prepare(`SELECT src, dst, rel, weight FROM memory_edges WHERE src IN (${ph})`).all(...ids);
  }

  function memAddEdge(src, dst, rel = "related", weight = 1.0) {
    db.prepare("INSERT OR REPLACE INTO memory_edges (src, dst, rel, weight) VALUES (?, ?, ?, ?)").run(src, dst, rel, weight);
  }

  function memPruneExpired(now = Date.now()) {
    return db.prepare("UPDATE memories SET deleted = 1 WHERE deleted = 0 AND expires_at IS NOT NULL AND expires_at < ?").run(now).changes || 0;
  }

  function memList(pid, limit = 100) {
    return db.prepare("SELECT * FROM memories WHERE pid = ? AND deleted = 0 ORDER BY created_at DESC LIMIT ?").all(pid, limit);
  }

  // Importance decay (maintenance): nudge all live memories toward a floor so
  // unreinforced memories gradually lose ranking weight. Returns rows touched.
  function memDecay(factor = 0.98, floor = 0.1) {
    return db.prepare("UPDATE memories SET importance = MAX(?, importance * ?) WHERE deleted = 0").run(floor, factor).changes || 0;
  }

  function memRecallLog({ pid, query, latencyMs, resultIds }) {
    db.prepare("INSERT INTO memory_recall_log (pid, query, latency_ms, result_ids) VALUES (?, ?, ?, ?)")
      .run(pid || null, (query || "").slice(0, 500), latencyMs | 0, JSON.stringify(resultIds || []));
  }

  // ── Export────────────────────────────────────────────────────────────────

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
    // Chat logs
    chatLog,
    getChatLogs,
    getChatStats,
    clearChatLogs,
    pruneChatLogs,
    getTrace,
    // Conversation history
    getChatHistory,
    appendChatHistory,
    clearChatHistory,
    // Semantic memory
    memInsert,
    memSetEmbedding,
    memById,
    memHydrate,
    memKeywordSearch,
    memEmbeddings,
    memEdgesFrom,
    memAddEdge,
    memPruneExpired,
    memList,
    memDecay,
    memRecallLog,
    memOutboxPending,
    memOutboxDone,
    memOutboxFail,
    memOutboxCount,
    ftsEnabled,
  };
};
