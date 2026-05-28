"use strict";

const log = require("./log");

// Lifecycle hook bus. Ported from ruflo hooks/src/{types,registry,executor}.
// The clever, worth-stealing parts: handlers run in priority order, any handler
// can `abort` to short-circuit the chain, and each handler can return `data`
// that is passed forward to later handlers — so e.g. a high-priority security
// hook can veto a tool call, or a hook can rewrite the payload mid-chain.

const EVENTS = {
  SESSION_START:   "session:start",
  SESSION_END:     "session:end",
  CHAT_START:      "chat:start",
  CHAT_REPLY:      "chat:reply",
  CHAT_ERROR:      "chat:error",
  PRE_ROUTE:       "route:pre",
  POST_ROUTE:      "route:post",
  PRE_TOOL:        "tool:pre",
  POST_TOOL:       "tool:post",
  AGENT_SPAWN:     "agent:spawn",
  AGENT_TERMINATE: "agent:terminate",
  DELEGATE_START:  "delegate:start",
  DELEGATE_END:    "delegate:end",
};

// Priority bands (higher runs first), mirroring ruflo HookPriority.
const PRIORITY = { CRITICAL: 1000, HIGH: 750, NORMAL: 500, LOW: 250, BACKGROUND: 1 };

function withTimeout(value, ms) {
  if (!ms || !value || typeof value.then !== "function") return Promise.resolve(value);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("hook timeout")), ms);
    Promise.resolve(value).then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

module.exports = function createHooks() {
  const registry = new Map(); // event -> [{ id, priority, fn, timeoutMs, continueOnError }]

  function register(event, fn, { id, priority = PRIORITY.NORMAL, timeoutMs = 5000, continueOnError = true } = {}) {
    if (typeof fn !== "function") throw new Error("hook fn required");
    const arr = registry.get(event) || [];
    const hid = id || `${event}#${arr.length}`;
    arr.push({ id: hid, priority, fn, timeoutMs, continueOnError });
    arr.sort((a, b) => b.priority - a.priority);
    registry.set(event, arr);
    return hid;
  }

  function unregister(event, id) {
    const arr = registry.get(event);
    if (arr) registry.set(event, arr.filter(h => h.id !== id));
  }

  // Run all handlers for `event` in priority order.
  // Each handler: async (data, meta) => undefined | { data } | { abort, message }.
  // Returns { aborted, data, message }.
  async function emit(event, data = {}, meta = {}) {
    const arr = registry.get(event);
    if (!arr || !arr.length) return { aborted: false, data };
    let acc = data;
    for (const h of arr) {
      try {
        const res = await withTimeout(h.fn(acc, meta), h.timeoutMs);
        if (res && typeof res === "object") {
          if (res.abort) {
            log.info("hooks", `${event} aborted by ${h.id}${res.message ? ` — ${res.message}` : ""}`);
            return { aborted: true, data: acc, message: res.message };
          }
          if (res.data !== undefined) acc = res.data;
        }
      } catch (err) {
        log.warn("hooks", `${event} handler ${h.id} failed — ${err.message}`);
        if (!h.continueOnError) throw err;
      }
    }
    return { aborted: false, data: acc };
  }

  const list = event => (registry.get(event) || []).map(h => h.id);

  return { register, unregister, emit, list, EVENTS, PRIORITY };
};
