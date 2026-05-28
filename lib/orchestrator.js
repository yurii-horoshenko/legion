"use strict";

// Shared, pure parsing for the orchestration/Linear block protocol. Both the
// web path (routes/chat.js) and the CLI path (bin/legion.js) reimplemented these
// regex+JSON parsers, and they had already drifted. Centralizing them here is
// the single source of truth so the two paths can't diverge again.

const DELEGATE_RE = /<DELEGATE>([\s\S]*?)<\/DELEGATE>/;

// Returns { tasks: [...], raw, invalid? } or null when no block is present.
function parseDelegate(reply) {
  const m = reply.match(DELEGATE_RE);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1].trim());
    return { tasks: Array.isArray(obj.tasks) ? obj.tasks : [], raw: m[0] };
  } catch {
    return { tasks: [], raw: m[0], invalid: true };
  }
}

function stripDelegate(reply) {
  return reply.replace(/<DELEGATE>[\s\S]*?<\/DELEGATE>/g, "").trim();
}

// Parse a %%LINEAR_<kind>%% … %%END_LINEAR_<kind>%% block.
// kind: "UPDATES" | "CREATE". Returns { found, invalid?, items, cleanedReply }.
function parseLinearBlock(reply, kind) {
  const re   = new RegExp(`%%LINEAR_${kind}%%([\\s\\S]*?)%%END_LINEAR_${kind}%%`);
  const reG  = new RegExp(`%%LINEAR_${kind}%%[\\s\\S]*?%%END_LINEAR_${kind}%%`, "g");
  const m = reply.match(re);
  if (!m) return { found: false, items: null, cleanedReply: reply };
  const cleanedReply = reply.replace(reG, "").trim();
  let items;
  try { items = JSON.parse(m[1].trim()); }
  catch { return { found: true, invalid: true, items: null, cleanedReply }; }
  return { found: true, items: Array.isArray(items) ? items : [], cleanedReply };
}

const PRIORITY_MAP = { urgent: 1, high: 2, medium: 3, low: 4 };

const TOOL_RE = /%%TOOL%%([\s\S]*?)%%END_TOOL%%/;

// Parse a tool-call block. Returns { name, args, raw } | { invalid, raw } | null.
function parseToolCall(reply) {
  const m = reply.match(TOOL_RE);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1].trim());
    if (!obj || !obj.name) return { invalid: true, raw: m[0] };
    return { name: obj.name, args: obj.args || {}, raw: m[0] };
  } catch { return { invalid: true, raw: m[0] }; }
}

module.exports = { parseDelegate, stripDelegate, parseLinearBlock, parseToolCall, PRIORITY_MAP, DELEGATE_RE, TOOL_RE };
