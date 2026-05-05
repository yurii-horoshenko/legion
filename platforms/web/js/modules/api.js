// ── API helpers ────────────────────────────────────────────────────────────

import { S, PROJECT_AGENTS, PROJECTS, AGENT_REGISTRY, PROVIDERS, setProviders, MODELS, setModels,
         setProjects, setAddedAgentIds } from './state.js';

// ── Agent store helpers ────────────────────────────────────────────────────

export function agentStoreUrl(agentId, store, itemId) {
  const base = `/api/projects/${S.projectId}/agents/${agentId}/${store}`;
  return itemId ? `${base}/${itemId}` : base;
}

export async function storeGet(agentId, store) {
  try { return await (await fetch(agentStoreUrl(agentId, store))).json(); } catch { return []; }
}
export async function storePost(agentId, store, body) {
  return (await fetch(agentStoreUrl(agentId, store), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).json();
}
export async function storePatch(agentId, store, itemId, body) {
  return (await fetch(agentStoreUrl(agentId, store, itemId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).json();
}
export async function storeDel(agentId, store, itemId) {
  return (await fetch(agentStoreUrl(agentId, store, itemId), { method: 'DELETE' })).json();
}

// ── Project agents ─────────────────────────────────────────────────────────

export async function loadProjectAgents(projectId) {
  try {
    const res = await fetch(`/api/projects/${projectId}/agents`);
    const agents = await res.json();
    PROJECT_AGENTS[projectId] = agents;
    agents.forEach(a => { AGENT_REGISTRY[a.id] = a; });
    // Keep PROJECTS count in sync
    const p = PROJECTS.find(x => x.id === projectId);
    if (p) p.agents = agents.length;
  } catch { PROJECT_AGENTS[projectId] = []; }
}

export async function apiAddAgent(projectId, agent) {
  await fetch(`/api/projects/${projectId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agent),
  });
}

export async function apiRemoveAgent(projectId, agentId) {
  await fetch(`/api/projects/${projectId}/agents/${agentId}`, { method: 'DELETE' });
}

// ── Providers ──────────────────────────────────────────────────────────────

export async function fetchProviders() {
  try {
    const r = await fetch('/api/providers');
    const data = await r.json();
    setProviders(data);
  } catch { setProviders([]); }
}

export async function apiSaveProvider(p) {
  const r = await fetch('/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
  return r.json();
}

export async function apiDeleteProvider(id) {
  await fetch(`/api/providers/${id}`, { method: 'DELETE' });
}

export async function apiFetchRemoteModels(providerId) {
  const r = await fetch(`/api/providers/${providerId}/models`);
  return r.json();
}

// ── Models ─────────────────────────────────────────────────────────────────

export async function fetchModels() {
  try {
    const r = await fetch('/api/models');
    const data = await r.json();
    setModels(data);
  } catch { setModels([]); }
}

export async function apiSaveModel(model) {
  const r = await fetch('/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  });
  return r.json();
}

export async function apiDeleteModel(id) {
  await fetch(`/api/models/${id}`, { method: 'DELETE' });
}

// ── Projects ───────────────────────────────────────────────────────────────

export async function loadProjects() {
  let projects = [];
  try {
    const res = await fetch('/api/projects');
    projects = await res.json();
  } catch { projects = []; }
  projects.sort((a, b) => a.name.localeCompare(b.name));
  setProjects(projects);
  if (projects.length) {
    S.projectId = projects[0].id;
    await loadProjectAgents(S.projectId);
    setAddedAgentIds(new Set((PROJECT_AGENTS[S.projectId] || []).map(a => a.id)));
  }
  return projects;
}

// ── Integrations ───────────────────────────────────────────────────────────

export let _integCache = null;

export async function fetchIntegrations() {
  if (!S.projectId) return {};
  try {
    const r = await fetch(`/api/projects/${S.projectId}/integrations`);
    if (!r.ok) return {};
    _integCache = await r.json();
    return _integCache;
  } catch { return {}; }
}

export function setIntegCache(val) { _integCache = val; }

// ── WebSocket activity feed ────────────────────────────────────────────────

let _wsHandlers = [];
let _wsSocket   = null;

export function onActivity(fn) { _wsHandlers.push(fn); }

export function connectActivityWS() {
  if (_wsSocket) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock  = new WebSocket(`${proto}://${location.host}/ws`);
  _wsSocket = sock;

  sock.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      _wsHandlers.forEach(fn => fn(msg));
    } catch {}
  };

  sock.onclose = () => {
    _wsSocket = null;
    // Reconnect after 3s
    setTimeout(connectActivityWS, 3000);
  };

  sock.onerror = () => sock.close();
}
