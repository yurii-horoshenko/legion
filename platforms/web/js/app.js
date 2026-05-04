// ── Data ───────────────────────────────────────────────────────────────────

const PROJECTS = [
  { id: 'legion',     name: 'Legion Platform', status: 'ok',   agents: 7 },
  { id: 'visitime',   name: 'VisiTime',         status: 'ok',   agents: 3 },
  { id: 'bladeparry', name: 'BladeParry',        status: 'warn', agents: 2 },
];

const AGENTS = [
  {
    id: 'legion-01', group: 'System',
    name: 'LEGION-01',  role: 'Orchestrator',
    model: 'claude-opus-4-7', status: 'ok', color: '#FF4D00', tasks: 12, workers: 0,
    capabilities: ['orchestration','planning','routing','delegation'],
    channels: ['http','telegram'],
    description: 'Master orchestrator. Accepts tasks, decomposes, delegates to specialized agents.',
  },
  {
    id: 'architect', group: 'Development',
    name: 'Architect',  role: 'Solution Design',
    model: 'claude-sonnet-4-6', status: 'busy', color: '#0EA5E9', tasks: 7, workers: 1,
    capabilities: ['system design','architecture','trade-off analysis','documentation'],
    channels: ['http'],
    description: 'Designs system structure and makes architectural decisions before implementation.',
  },
  {
    id: 'developer', group: 'Development',
    name: 'Developer',  role: 'Code',
    model: 'claude-sonnet-4-6', status: 'ok', color: '#00B87A', tasks: 24, workers: 0,
    capabilities: ['swift','python','typescript','refactoring','debugging'],
    channels: ['http'],
    description: 'Writes, refactors, and debugs code. Receives architecture spec from Architect.',
  },
  {
    id: 'reviewer', group: 'Development',
    name: 'Reviewer',   role: 'Code Review',
    model: 'claude-sonnet-4-6', status: 'idle', color: '#F59E0B', tasks: 9, workers: 0,
    capabilities: ['code review','security','performance','best practices'],
    channels: ['http'],
    description: 'Reviews code from Developer. Checks quality, security, correctness.',
  },
  {
    id: 'qa', group: 'Development',
    name: 'QA',         role: 'Quality Assurance',
    model: 'claude-sonnet-4-6', status: 'idle', color: '#EC4899', tasks: 6, workers: 0,
    capabilities: ['test writing','edge cases','regression','integration'],
    channels: ['http'],
    description: 'Writes tests, covers edge cases, runs regression checks.',
  },
  {
    id: 'analyst', group: 'Research',
    name: 'Analyst',    role: 'Research & Docs',
    model: 'claude-sonnet-4-6', status: 'ok', color: '#8B5CF6', tasks: 5, workers: 0,
    capabilities: ['research','documentation','data analysis','summarization'],
    channels: ['http'],
    description: 'Researches topics, writes documentation, produces summaries.',
  },
  {
    id: 'assistant', group: 'Personal',
    name: 'Assistant',  role: 'Personal',
    model: 'ollama/qwen2.5', status: 'ok', color: '#94A3B8', tasks: 3, workers: 0,
    capabilities: ['scheduling','personal tasks','private data'],
    channels: ['telegram'],
    description: 'Private personal tasks. Runs locally — data never leaves device.',
  },
];

const ACTIVITY = [
  { type:'ok',   icon:'✓', text:'Developer finished: Add Channel router',             meta:'legion-01 → developer · 2m ago' },
  { type:'info', icon:'⚙', text:'Architect is designing Branch compaction logic',     meta:'legion-01 → architect · 5m ago' },
  { type:'warn', icon:'⚠', text:'QA: 2 edge cases need coverage in Worker tests',    meta:'reviewer → qa · 12m ago' },
  { type:'ok',   icon:'✓', text:'Reviewer approved: HTTP API route layer',            meta:'developer → reviewer · 18m ago' },
  { type:'info', icon:'⚙', text:'LEGION-01 received: Implement Visor bulletins',     meta:'operator · 24m ago' },
  { type:'ok',   icon:'✓', text:'Analyst completed: Overview document draft',        meta:'legion-01 → analyst · 1h ago' },
];

const BULLETINS = [
  { agent:'LEGION-01', time:'10 min ago', text:'Team focused on core runtime. Architect designing compaction. Developer idle, waiting for spec. QA has 2 open items. No blockers detected.' },
  { agent:'Architect', time:'1h ago',     text:'Completed Branch/Worker protocol design. SQLite schema drafted. Visor bulletin interval 15min. Ready to hand off to Developer.' },
];

const WORKERS = [
  { id:'w-001', name:'Design Branch compaction logic', status:'running', time:'5m' },
  { id:'w-002', name:'HTTP API route layer review',     status:'done',    time:'18m' },
  { id:'w-003', name:'SQLite schema migration draft',   status:'done',    time:'1h' },
];

const MEMORIES = [
  { type:'visor', time:'10m ago', text:'Runtime core Sprint 1 in progress. Architect leading. No critical blockers.' },
  { type:'fact',  time:'2h ago',  text:'Project confirmed: Legion. Stack: Swift 6 + Python API + Vanilla JS web.' },
  { type:'user',  time:'1d ago',  text:'Founder prefers deterministic routing over LLM-based routing for reliability.' },
];

const TASKS = [
  { id:'t-001', name:'Implement Channel/Branch/Worker runtime', status:'running', date:'today' },
  { id:'t-002', name:'Design SQLite persistence schema',        status:'done',    date:'yesterday' },
  { id:'t-003', name:'HTTP API — core endpoints',               status:'pending', date:'tomorrow' },
  { id:'t-004', name:'Visor bulletin compaction',                status:'pending', date:'+2d' },
  { id:'t-005', name:'iOS SwiftUI client scaffold',              status:'pending', date:'+3d' },
];

// ── Agent registry: all known agents (mock + added from catalog) ───────────
const AGENT_REGISTRY = {};
AGENTS.forEach(a => { AGENT_REGISTRY[a.id] = a; });

// Per-project agent id lists
const PROJECT_AGENTS = {
  legion:     ['legion-01','architect','developer','reviewer','qa','analyst','assistant'],
  visitime:   [],
  bladeparry: [],
};

function projectAgents() {
  return (PROJECT_AGENTS[S.projectId] || [])
    .map(id => AGENT_REGISTRY[id])
    .filter(Boolean);
}

// ── State ──────────────────────────────────────────────────────────────────

const S = { projectId: PROJECTS[0].id, agentId: null, tab: 'overview', dropOpen: false };

// ── Utils ──────────────────────────────────────────────────────────────────

const $ = (s, ctx=document) => ctx.querySelector(s);
const $$ = (s, ctx=document) => [...ctx.querySelectorAll(s)];

function initials(name) {
  const p = name.trim().split(/[\s_-]+/).filter(Boolean);
  return p.length === 1 ? p[0].slice(0,2).toUpperCase() : (p[0][0]+p[1][0]).toUpperCase();
}

function groupBy(arr, key) {
  return arr.reduce((a, x) => { (a[x[key]] = a[x[key]] || []).push(x); return a; }, {});
}

// ── Project dropdown ───────────────────────────────────────────────────────

function renderProjBtn() {
  const p = PROJECTS.find(x => x.id === S.projectId);
  $('#proj-label').textContent = p.name;
}

function renderProjList(filter = '') {
  const f = filter.toLowerCase();
  $('#proj-list').innerHTML = PROJECTS
    .filter(p => p.name.toLowerCase().includes(f))
    .map(p => `
      <div class="proj-item ${p.id===S.projectId?'active':''}" data-id="${p.id}">
        <span class="proj-item-dot ${p.status}"></span>
        <span class="proj-item-name">${p.name}</span>
        <span class="proj-item-count">${p.agents} agents</span>
      </div>`).join('');

  $$('.proj-item').forEach(el => {
    el.addEventListener('click', () => {
      S.projectId = el.dataset.id;
      S.agentId = null;
      syncAddedIds();
      closeProj();
      renderProjBtn();
      renderTree();
      showDash();
    });
  });
}

function openProj() {
  S.dropOpen = true;
  $('#proj-btn').classList.add('open');
  $('#proj-menu').classList.add('open');
  $('#proj-search-input').value = '';
  renderProjList();
  $('#proj-search-input').focus();
}

function closeProj() {
  S.dropOpen = false;
  $('#proj-btn').classList.remove('open');
  $('#proj-menu').classList.remove('open');
}

// ── Agent tree ─────────────────────────────────────────────────────────────

function renderTree() {
  const agents = projectAgents();
  const groups = groupBy(agents, 'group');
  const entries = Object.entries(groups);

  if (entries.length === 0) {
    $('#agent-tree').innerHTML = `<div style="padding:16px 14px;font-size:11px;color:var(--rail-muted)">No agents yet — add from catalog</div>`;
    return;
  }

  $('#agent-tree').innerHTML = entries.map(([g, list]) => `
    <div class="agent-group" data-group="${g}">
      <div class="group-header">
        <span class="group-caret">▾</span>
        <span>${g}</span>
        <span style="margin-left:auto;font-size:9px">${list.length}</span>
      </div>
      <div class="group-body">
        ${list.map(a => `
          <div class="agent-row ${a.id===S.agentId?'active':''}" data-id="${a.id}">
            <span class="a-dot ${a.status||'idle'}"></span>
            <span class="a-name">${a.name}</span>
            ${(a.workers||0) > 0 ? `<span class="a-badge">${a.workers}w</span>` : ''}
          </div>`).join('')}
      </div>
    </div>`).join('');

  $$('.agent-row').forEach(el => el.addEventListener('click', () => selectAgent(el.dataset.id)));
  $$('.group-header').forEach(el => el.addEventListener('click', () => {
    el.closest('.agent-group').classList.toggle('collapsed');
  }));
}

// ── Dashboard ──────────────────────────────────────────────────────────────

function showDash() {
  $('#view-dash').style.display = '';
  $('#view-agent').classList.remove('on');
  renderDash();
}

function renderDash() {
  const pa = projectAgents();
  const totalWorkers = pa.reduce((s,a) => s+(a.workers||0), 0);
  $('#s-agents').textContent  = pa.length;
  $('#s-workers').textContent = totalWorkers;
  $('#s-tasks').textContent   = TASKS.length;
  $('#s-busy').textContent    = pa.filter(a=>a.status==='busy').length;

  $('#act-feed').innerHTML = ACTIVITY.map(a => `
    <div class="act-item">
      <div class="act-icon ${a.type}">${a.icon}</div>
      <div>
        <div class="act-text">${a.text}</div>
        <div class="act-meta">${a.meta}</div>
      </div>
    </div>`).join('');

  $('#bull-feed').innerHTML = BULLETINS.map(b => `
    <div class="bull">
      <div class="bull-head">
        <span class="bull-tag">Visor · ${b.agent}</span>
        <span class="bull-time">${b.time}</span>
      </div>
      <div class="bull-text">${b.text}</div>
    </div>`).join('');
}

// ── Agent detail ───────────────────────────────────────────────────────────

function selectAgent(id) {
  S.agentId = id;
  S.tab = 'overview';
  renderTree();

  const a = AGENT_REGISTRY[id];
  if (!a) return;

  $('#view-dash').style.display = 'none';
  $('#view-agent').classList.add('on');

  $('#a-ava').textContent = initials(a.name);
  $('#a-ava').style.cssText = `background:${a.color}18;color:${a.color};border:1px solid ${a.color}30`;
  $('#a-name').textContent = a.name;
  $('#a-role').textContent = a.role;
  $('#a-role').style.cssText = `background:${a.color}15;color:${a.color};border:1px solid ${a.color}30`;
  $('#a-model').textContent = a.model;
  $('#a-status-dot').className = `a-dot ${a.status}`;

  $$('.a-tab').forEach(t => t.classList.toggle('on', t.dataset.tab==='overview'));
  $$('.tab-body').forEach(b => b.classList.toggle('on', b.dataset.tab==='overview'));
  renderTab('overview', a);
}

function renderTab(tab, agent) {
  S.tab = tab;
  if (!agent) agent = AGENT_REGISTRY[S.agentId];
  if (!agent) return;

  if (tab==='overview')  renderOverview(agent);
  if (tab==='workers')   renderWorkers();
  if (tab==='memories')  renderMemories();
  if (tab==='tasks')     renderTasks();
  if (tab==='chat')      renderChat(agent);
  if (tab==='config')    renderConfig(agent);
}

function renderOverview(a) {
  $('#tab-overview').innerHTML = `
    <div class="ov-grid">
      <div class="ov-card">
        <div class="ov-card-label">Info</div>
        <div class="kv"><span class="kk">ID</span><span class="kv-val">${a.id}</span></div>
        <div class="kv"><span class="kk">Role</span><span class="kv-val">${a.role}</span></div>
        <div class="kv"><span class="kk">Model</span><span class="kv-val">${a.model}</span></div>
        <div class="kv"><span class="kk">Status</span><span class="kv-val">${a.status}</span></div>
        <div class="kv"><span class="kk">Tasks</span><span class="kv-val">${a.tasks}</span></div>
        <div class="kv"><span class="kk">Workers</span><span class="kv-val">${a.workers}</span></div>
        <div class="kv"><span class="kk">Channels</span><span class="kv-val">${a.channels.join(', ')}</span></div>
      </div>
      <div class="ov-card">
        <div class="ov-card-label">Description</div>
        <p style="font-size:12px;color:var(--text-2);line-height:1.7">${a.description}</p>
      </div>
      <div class="ov-card" style="grid-column:1/-1">
        <div class="ov-card-label">Capabilities</div>
        <div class="cap-list">${a.capabilities.map(c=>`<span class="cap">${c}</span>`).join('')}</div>
      </div>
    </div>`;
}

function renderWorkers() {
  $('#tab-workers').innerHTML = WORKERS.map(w => `
    <div class="worker-card">
      <span class="wk-badge ${w.status}">${w.status}</span>
      <span class="wk-name">${w.name}</span>
      <span class="wk-time">${w.time}</span>
    </div>`).join('');
}

function renderMemories() {
  $('#tab-memories').innerHTML = MEMORIES.map(m => `
    <div class="mem-card">
      <div class="mem-head">
        <span class="mem-badge ${m.type}">${m.type}</span>
        <span class="mem-time">${m.time}</span>
      </div>
      <div class="mem-text">${m.text}</div>
    </div>`).join('');
}

function renderTasks() {
  $('#tab-tasks').innerHTML = TASKS.map(t => `
    <div class="task-row">
      <span class="t-dot ${t.status}"></span>
      <span class="t-name">${t.name}</span>
      <span class="t-date">${t.date}</span>
      <span class="t-arr">›</span>
    </div>`).join('');
}

function renderChat(a) {
  $('#tab-chat').innerHTML = `
    <div class="chat-wrap">
      <div class="chat-msgs" id="chat-msgs">
        <div class="msg agent">
          <div class="msg-ava" style="background:${a.color}18;color:${a.color};border:1px solid ${a.color}30">${initials(a.name)}</div>
          <div class="msg-bub">Hello. I'm ${a.name}. How can I assist?</div>
        </div>
      </div>
      <div class="chat-foot">
        <textarea class="chat-in" id="chat-in" rows="1" placeholder="Send a message…"></textarea>
        <button class="chat-btn" id="chat-send">Send</button>
      </div>
    </div>`;

  const input = $('#chat-in'), btn = $('#chat-send'), msgs = $('#chat-msgs');

  function send() {
    const text = input.value.trim();
    if (!text) return;
    msgs.insertAdjacentHTML('beforeend', `
      <div class="msg you">
        <div class="msg-ava" style="background:var(--text);color:var(--bg-card)">YU</div>
        <div class="msg-bub">${text}</div>
      </div>`);
    input.value = '';
    msgs.scrollTop = msgs.scrollHeight;
    setTimeout(() => {
      msgs.insertAdjacentHTML('beforeend', `
        <div class="msg agent">
          <div class="msg-ava" style="background:${a.color}18;color:${a.color};border:1px solid ${a.color}30">${initials(a.name)}</div>
          <div class="msg-bub" style="color:var(--text-3);font-style:italic">Processing… (connect Legion API for real responses)</div>
        </div>`);
      msgs.scrollTop = msgs.scrollHeight;
    }, 500);
  }

  btn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}

function renderConfig(a) {
  const yaml =
`id: ${a.id}
name: ${a.name}
role: ${a.role}
model: ${a.model}
status: ${a.status}

channels:
${a.channels.map(c=>`  - ${c}`).join('\n')}

capabilities:
${a.capabilities.map(c=>`  - ${c}`).join('\n')}

routing:
  mode: rule-based
  fallback: local-fast

memory:
  visor_interval: 15m
  vector_db: chromadb`;
  $('#tab-config').innerHTML = `<pre class="cfg-box">${yaml}</pre>`;
}

// ── Agent catalog ─────────────────────────────────────────────────────────

let CATALOG_AGENTS = [];
let catalogLoaded  = false;

async function loadCatalog() {
  if (catalogLoaded) { renderCatalogFilters(); renderCatalogGrid(); return; }
  try {
    const res  = await fetch('/data/agents-catalog.json');
    const data = await res.json();
    CATALOG_AGENTS = data;
    catalogLoaded  = true;
  } catch (e) {
    console.warn('Could not load agents-catalog.json', e);
  }
  renderCatalogFilters();
  renderCatalogGrid();
}

// IDs агентов добавленных в текущий проект (пересчитывается при смене проекта)
let addedAgentIds = new Set(PROJECT_AGENTS[S.projectId] || []);

function syncAddedIds() {
  addedAgentIds = new Set(PROJECT_AGENTS[S.projectId] || []);
}

let catalogFilter = 'All';
let catalogSearch = '';

function catalogGroups() {
  return ['All', ...new Set(CATALOG_AGENTS.map(a => a.group))];
}

function showCatalog() {
  $('#view-dash').style.display   = 'none';
  $('#view-agent').classList.remove('on');
  $('#view-catalog').classList.add('on');
  $('#catalog-proj-name').textContent = PROJECTS.find(p => p.id===S.projectId)?.name || '—';
  loadCatalog();
}

function hideCatalog() {
  $('#view-catalog').classList.remove('on');
  showDash();
}

function renderCatalogFilters() {
  $('#catalog-filters').innerHTML = catalogGroups().map(g => `
    <button class="cat-filter ${catalogFilter===g?'on':''}" data-group="${g}">${g}</button>
  `).join('');

  $$('.cat-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      catalogFilter = btn.dataset.group;
      $$('.cat-filter').forEach(b => b.classList.toggle('on', b.dataset.group===catalogFilter));
      renderCatalogGrid();
    });
  });
}

function renderCatalogGrid() {
  const q = catalogSearch.toLowerCase();
  const agents = CATALOG_AGENTS.filter(a => {
    const matchGroup  = catalogFilter==='All' || a.group===catalogFilter;
    const matchSearch = !q || a.name.toLowerCase().includes(q) || (a.role||'').toLowerCase().includes(q) || a.capabilities.some(c=>c.toLowerCase().includes(q));
    return matchGroup && matchSearch;
  });

  // Update subtitle with count
  const total = CATALOG_AGENTS.length;
  const shown = agents.length;
  $('#catalog-proj-name').textContent = PROJECTS.find(p=>p.id===S.projectId)?.name || '—';
  const sub = document.querySelector('#view-catalog .dash-meta');
  if (sub) sub.textContent = `${shown} of ${total} agents${catalogFilter!=='All' ? ` in ${catalogFilter}` : ''}${q ? ` matching "${q}"` : ''}`;

  $('#catalog-grid').innerHTML = agents.map(a => {
    const added = addedAgentIds.has(a.id);
    const lang = i18n.lang;
    const locale = (a.locales && a.locales[lang]) ? a.locales[lang] : (a.locales && a.locales.en) || a;
    const desc = locale.description || a.description;
    const vibe = locale.vibe || a.vibe || a.group;
    const emoji = locale.emoji || a.emoji || '🤖';
    return `
    <div class="catalog-card ${added?'added':''}" data-id="${a.id}" style="--agent-color:${a.color}">
      <div class="cat-card-top">
        <div class="cat-ava" style="background:${a.color}18;color:${a.color};border:1px solid ${a.color}30">${emoji}</div>
        <div class="cat-card-info">
          <div class="cat-name">${locale.name || a.name}</div>
          <div class="cat-role" style="color:${a.color}">${vibe}</div>
        </div>
      </div>
      <div class="cat-desc">${desc}</div>
      <div class="cat-card-foot">
        <button class="cat-add-btn ${added?'added':''}" data-id="${a.id}">
          ${added ? i18n.t('catalog_added') : i18n.t('catalog_add')}
        </button>
      </div>
    </div>`;
  }).join('');

  $$('.cat-add-btn:not(.added)').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const agent = CATALOG_AGENTS.find(a => a.id===id);
      if (!agent || addedAgentIds.has(id)) return;

      // Register in global registry
      if (!AGENT_REGISTRY[id]) AGENT_REGISTRY[id] = agent;

      // Add to current project's agent list
      if (!PROJECT_AGENTS[S.projectId]) PROJECT_AGENTS[S.projectId] = [];
      if (!PROJECT_AGENTS[S.projectId].includes(id)) {
        PROJECT_AGENTS[S.projectId].push(id);
      }

      addedAgentIds.add(id);

      btn.textContent = i18n.t('catalog_added');
      btn.classList.add('added');
      btn.closest('.catalog-card').classList.add('added');
      renderTree();
    });
  });

  $$('.catalog-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.classList.contains('cat-add-btn')) return;
      const id = card.dataset.id;
      hideCatalog();
      selectAgent(id);
    });
  });
}

// ── Modal ──────────────────────────────────────────────────────────────────

function openModal() { $('#modal').classList.add('on'); $('#m-name').focus(); }
function closeModal() { $('#modal').classList.remove('on'); $('#m-name').value=''; $('#m-desc').value=''; }

function createProject() {
  const name = $('#m-name').value.trim();
  if (!name) return;
  const id = name.toLowerCase().replace(/\s+/g,'-');
  PROJECTS.push({ id, name, status:'ok', agents:0 });
  S.projectId = id;
  S.agentId = null;
  renderProjBtn();
  renderTree();
  showDash();
  closeModal();
}

// ── Settings / Models ──────────────────────────────────────────────────────

const PROVIDER_META = {
  anthropic: { icon: '◆', color: '#D97706', label: 'Anthropic', hasKey: true,  hasEndpoint: false },
  openai:    { icon: '⬡', color: '#10B981', label: 'OpenAI',    hasKey: true,  hasEndpoint: false },
  google:    { icon: '◉', color: '#3B82F6', label: 'Google',    hasKey: true,  hasEndpoint: false },
  mistral:   { icon: '◈', color: '#8B5CF6', label: 'Mistral',   hasKey: true,  hasEndpoint: false },
  ollama:    { icon: '◎', color: '#64748B', label: 'Ollama',    hasKey: false, hasEndpoint: true  },
  custom:    { icon: '◇', color: '#94A3B8', label: 'Custom',    hasKey: true,  hasEndpoint: true  },
};

let MODELS = [];
let modelEditId = null;

async function fetchModels() {
  try {
    const res = await fetch('/api/models');
    MODELS = await res.json();
  } catch { MODELS = []; }
}

async function apiSaveModel(model) {
  const res = await fetch('/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  });
  return res.json();
}

async function apiDeleteModel(id) {
  await fetch(`/api/models/${id}`, { method: 'DELETE' });
}

async function showSettings() {
  $('#view-dash').style.display   = 'none';
  $('#view-agent').classList.remove('on');
  $('#view-catalog').classList.remove('on');
  $('#view-settings').classList.add('on');
  await fetchModels();
  renderModels();
}

function hideSettings() {
  $('#view-settings').classList.remove('on');
}

function renderModels() {
  const list = $('#models-list');
  if (!MODELS.length) {
    list.innerHTML = `<div class="models-empty">
      <div class="models-empty-icon">⬡</div>
      <div>No models configured yet</div>
      <div style="margin-top:6px;font-size:11px;opacity:.6">Add Anthropic, OpenAI, or a local model to get started</div>
    </div>`;
    return;
  }
  list.innerHTML = MODELS.map(m => {
    const p = PROVIDER_META[m.provider] || PROVIDER_META.custom;
    const keyLabel = p.hasKey
      ? (m.key ? '●●●● set' : 'no key')
      : (m.endpoint || 'no endpoint');
    const keySet = p.hasKey ? !!m.key : !!m.endpoint;
    return `
    <div class="model-row" data-id="${m.id}">
      <div class="model-provider-icon" style="background:${p.color}18;color:${p.color}">${p.icon}</div>
      <div class="model-info">
        <div class="model-name">${m.name}</div>
        <div class="model-id">${m.modelId || m.provider}</div>
      </div>
      <div class="model-notes">${m.notes || ''}</div>
      <div class="model-key-badge ${keySet?'set':''}">${keySet ? '● key set' : '○ no key'}</div>
      <div class="model-actions">
        <button class="model-btn" data-action="edit" data-id="${m.id}">Edit</button>
        <button class="model-btn danger" data-action="delete" data-id="${m.id}">Delete</button>
      </div>
    </div>`;
  }).join('');

  $$('#models-list .model-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (btn.dataset.action === 'delete') {
        await apiDeleteModel(id);
        MODELS = MODELS.filter(m => m.id !== id);
        renderModels();
      } else {
        openModelModal(id);
      }
    });
  });
}

function openModelModal(editId = null) {
  modelEditId = editId;
  const m = editId ? MODELS.find(x => x.id === editId) : null;

  $('#mm-title').textContent = m ? 'Edit Model' : 'Add Model';
  $('#mm-name').value      = m?.name      || '';
  $('#mm-model-id').value  = m?.modelId   || '';
  $('#mm-key').value       = m?.key       || '';
  $('#mm-endpoint').value  = m?.endpoint  || '';
  $('#mm-notes').value     = m?.notes     || '';

  // Set provider pill
  const provider = m?.provider || 'anthropic';
  $$('.provider-pill').forEach(p => p.classList.toggle('on', p.dataset.provider === provider));
  updateModalFields(provider);

  $('#model-modal').classList.add('on');
  $('#mm-name').focus();
}

function closeModelModal() {
  $('#model-modal').classList.remove('on');
  modelEditId = null;
}

function updateModalFields(provider) {
  const p = PROVIDER_META[provider] || PROVIDER_META.custom;
  $('#mm-field-key').style.display      = p.hasKey      ? '' : 'none';
  $('#mm-field-endpoint').style.display = p.hasEndpoint ? '' : 'none';
}

async function saveModel() {
  const provider = $$('.provider-pill').find(p => p.classList.contains('on'))?.dataset.provider || 'anthropic';
  const name     = $('#mm-name').value.trim();
  const modelId  = $('#mm-model-id').value.trim();
  const key      = $('#mm-key').value.trim();
  const endpoint = $('#mm-endpoint').value.trim();
  const notes    = $('#mm-notes').value.trim();

  if (!name) { $('#mm-name').focus(); return; }

  const model = modelEditId
    ? { ...(MODELS.find(x => x.id === modelEditId) || {}), provider, name, modelId, key, endpoint, notes }
    : { provider, name, modelId, key, endpoint, notes };

  const saved = await apiSaveModel(model);
  if (modelEditId) {
    const idx = MODELS.findIndex(x => x.id === modelEditId);
    if (idx >= 0) MODELS[idx] = saved; else MODELS.push(saved);
  } else {
    MODELS.push(saved);
  }
  closeModelModal();
  renderModels();
}

// ── Init ───────────────────────────────────────────────────────────────────

function init() {
  // Project dropdown
  $('#proj-btn').addEventListener('click', e => { e.stopPropagation(); S.dropOpen ? closeProj() : openProj(); });
  document.addEventListener('click', e => { if (!e.target.closest('.proj-wrap')) closeProj(); });
  $('#proj-search-input').addEventListener('input', e => renderProjList(e.target.value));

  // Language toggle
  $('#lang-toggle').addEventListener('click', () => {
    i18n.setLang(i18n.lang === 'en' ? 'ru' : 'en');
    renderCatalogGrid();
  });

  // Add agent button in rail
  $('#btn-add-agent').addEventListener('click', e => {
    e.stopPropagation();
    closeProj();
    showCatalog();
  });

  // Catalog back + search
  $('#catalog-back').addEventListener('click', hideCatalog);
  $('#catalog-search').addEventListener('input', e => {
    catalogSearch = e.target.value;
    renderCatalogGrid();
  });

  // Add project
  const openNew = () => { closeProj(); openModal(); };
  $('#top-add-btn').addEventListener('click', e => { e.stopPropagation(); openNew(); });
  $('#proj-add-from-menu').addEventListener('click', openNew);

  // Modal
  $('#m-cancel').addEventListener('click', closeModal);
  $('#m-create').addEventListener('click', createProject);
  $('#m-name').addEventListener('keydown', e => { if (e.key==='Enter') createProject(); });
  $('#modal').addEventListener('click', e => { if (e.target===e.currentTarget) closeModal(); });

  // Tabs
  $$('.a-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.a-tab').forEach(t => t.classList.remove('on'));
      $$('.tab-body').forEach(b => b.classList.remove('on'));
      tab.classList.add('on');
      $(`[data-tab="${tab.dataset.tab}"].tab-body`).classList.add('on');
      renderTab(tab.dataset.tab);
    });
  });

  // Rail nav
  $$('.rail-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.rail-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      if (item.dataset.view === 'dash') {
        S.agentId = null; renderTree(); showDash();
        hideSettings();
      }
      if (item.dataset.view === 'settings') {
        showSettings();
      }
    });
  });

  // Settings tabs
  $$('.s-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.s-tab').forEach(t => t.classList.remove('on'));
      $$('.stab-body').forEach(b => b.classList.remove('on'));
      tab.classList.add('on');
      $(`[data-stab="${tab.dataset.stab}"].stab-body`).classList.add('on');
    });
  });

  // Add model button
  $('#btn-add-model').addEventListener('click', () => openModelModal());

  // Provider pills in modal
  $$('.provider-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('.provider-pill').forEach(p => p.classList.remove('on'));
      pill.classList.add('on');
      updateModalFields(pill.dataset.provider);
    });
  });

  // Model modal actions
  $('#mm-cancel').addEventListener('click', closeModelModal);
  $('#mm-save').addEventListener('click', saveModel);
  $('#model-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModelModal(); });
  $('#mm-name').addEventListener('keydown', e => { if (e.key === 'Enter') saveModel(); });

  renderProjBtn();
  renderTree();
  renderDash();
}

document.addEventListener('DOMContentLoaded', init);
