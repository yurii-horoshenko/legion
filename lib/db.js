"use strict";

const path = require("path");
const { DatabaseSync } = require("node:sqlite");

module.exports = function createDB(configDir) {
  const db = new DatabaseSync(path.join(configDir, "legion.db"));

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      ts   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      type TEXT    NOT NULL,
      pid  TEXT,
      aid  TEXT,
      data TEXT
    );
    CREATE INDEX IF NOT EXISTS ev_ts  ON events (ts DESC);
    CREATE INDEX IF NOT EXISTS ev_pid ON events (pid);
  `);

  const _insert = db.prepare(
    "INSERT INTO events (type, pid, aid, data) VALUES (?, ?, ?, ?)"
  );

  function log(type, pid, aid, payload) {
    _insert.run(
      type,
      pid  || null,
      aid  || null,
      payload !== undefined ? JSON.stringify(payload) : null
    );
  }

  function recent(pid, limit = 60) {
    const rows = pid
      ? db.prepare("SELECT * FROM events WHERE pid = ? ORDER BY ts DESC LIMIT ?").all(pid, limit)
      : db.prepare("SELECT * FROM events ORDER BY ts DESC LIMIT ?").all(limit);
    return rows.map(r => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
  }

  return { log, recent };
};
