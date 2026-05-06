// ── Shared state ──────────────────────────────────────────────────────────────

export const S = { projectId: null, agentId: null, tab: 'overview', dropOpen: false };

// Per-agent chat state: persists across tab switches within one browser session
// agentId → { introFetched, introText, messages: [{html}], historyLoaded }
export const CHAT_STATE = {};

// Per-project agent lists (loaded from API)
export const PROJECT_AGENTS = {};  // projectId → [agentObject]

// Agent registry: all known agents (mock + added from catalog)
export const AGENT_REGISTRY = {};

export let MODELS = [];
export let PROVIDERS = [];
export let LEGION_CONFIG = {};
export let PROJECTS = [];
export let CATALOG_AGENTS = [];
export let catalogLoaded = false;
export let addedAgentIds = new Set();
export let catalogFilter = 'All';
export let catalogSearch = '';

export function setModels(m) { MODELS = m; }
export function setProviders(p) { PROVIDERS = p; }
export function setLegionConfig(c) { LEGION_CONFIG = c; }
export function setProjects(p) { PROJECTS = p; }
export function setCatalogAgents(a) { CATALOG_AGENTS = a; }
export function setCatalogLoaded(v) { catalogLoaded = v; }
export function setAddedAgentIds(s) { addedAgentIds = s; }
export function setCatalogFilter(v) { catalogFilter = v; }
export function setCatalogSearch(v) { catalogSearch = v; }
