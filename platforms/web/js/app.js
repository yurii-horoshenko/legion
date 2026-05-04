// ── Data ───────────────────────────────────────────────────────────────────

let PROJECTS = [];
let LEGION_CONFIG = {};

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

// Per-project agent lists (loaded from API)
const PROJECT_AGENTS = {};  // projectId → [agentObject]

function projectAgents() {
  return PROJECT_AGENTS[S.projectId] || [];
}

async function loadProjectAgents(projectId) {
  try {
    const res = await fetch(`/api/projects/${projectId}/agents`);
    const agents = await res.json();
    PROJECT_AGENTS[projectId] = agents;
    agents.forEach(a => { AGENT_REGISTRY[a.id] = a; });
  } catch { PROJECT_AGENTS[projectId] = []; }
}

async function apiAddAgent(projectId, agent) {
  await fetch(`/api/projects/${projectId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agent),
  });
}

async function apiRemoveAgent(projectId, agentId) {
  await fetch(`/api/projects/${projectId}/agents/${agentId}`, { method: 'DELETE' });
}

// ── State ──────────────────────────────────────────────────────────────────

const S = { projectId: null, agentId: null, tab: 'overview', dropOpen: false };

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

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function tabDescHtml(tab) {
  return `<p class="tab-desc">${esc(i18n.t(`tab_desc_${tab}`))}</p>`;
}

// ── Project dropdown ───────────────────────────────────────────────────────

function renderProjBtn() {
  const p = PROJECTS.find(x => x.id === S.projectId);
  $('#proj-label').textContent = p ? p.name : '—';
}

function renderProjList(filter = '') {
  const f = filter.toLowerCase();
  $('#proj-list').innerHTML = PROJECTS
    .filter(p => p.name.toLowerCase().includes(f))
    .map(p => `
      <div class="proj-item ${p.id===S.projectId?'active':''}" data-id="${p.id}">
        <span class="proj-item-dot ${p.status||'ok'}"></span>
        <div class="proj-item-info">
          <span class="proj-item-name">${esc(p.name)}</span>
          ${p.path ? `<span class="proj-item-path">${esc(p.path)}</span>` : ''}
        </div>
        <span class="proj-item-count">${p.agents||0} agents</span>
      </div>`).join('');

  $$('.proj-item').forEach(el => {
    el.addEventListener('click', async () => {
      S.projectId = el.dataset.id;
      S.agentId = null;
      if (!PROJECT_AGENTS[S.projectId]) await loadProjectAgents(S.projectId);
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
    <div class="agent-group" data-group="${esc(g)}">
      <div class="group-header">
        <span class="group-caret">▾</span>
        <span>${esc(g)}</span>
        <span style="margin-left:auto;font-size:9px">${list.length}</span>
      </div>
      <div class="group-body">
        ${list.map(a => `
          <div class="agent-row ${a.id===S.agentId?'active':''}" data-id="${a.id}">
            <span class="a-dot ${a.status||'idle'}"></span>
            <span class="a-name">${esc(a.name)}</span>
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

const VIEWS = ['view-dash', 'view-catalog', 'view-agent', 'view-settings', 'view-home', 'view-overview', 'view-analyze'];

function showView(name) {
  VIEWS.forEach(id => {
    const el = $(`#${id}`);
    if (!el) return;
    if (id === name) {
      el.style.display = '';
      el.classList.add('on');
    } else {
      el.style.display = 'none';
      el.classList.remove('on');
    }
  });
}

function showDash() {
  showView('view-dash');
  renderDash();
}

function renderDash() {
  const pa = projectAgents();
  const totalWorkers = pa.reduce((s,a) => s+(a.workers||0), 0);
  $('#s-agents').textContent  = pa.length;
  $('#s-workers').textContent = totalWorkers;
  $('#s-tasks').textContent   = pa.reduce((s,a) => s + (a.tasks||0), 0);
  $('#s-busy').textContent    = pa.filter(a=>a.status==='busy').length;

  $('#act-feed').innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:12px">No activity yet</div>`;

  $('#bull-feed').innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:12px">No bulletins yet</div>`;
}

// ── Agent detail ───────────────────────────────────────────────────────────

function selectAgent(id) {
  S.agentId = id;
  S.tab = 'overview';
  renderTree();

  const a = AGENT_REGISTRY[id];
  if (!a) return;

  showView('view-agent');

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

async function renderTab(tab, agent) {
  S.tab = tab;
  if (!agent) agent = AGENT_REGISTRY[S.agentId];
  if (!agent) return;

  if (tab==='overview')  renderAgentOverview(agent);
  if (tab==='workers')   renderWorkers(agent);
  if (tab==='memories')  renderMemories(agent);
  if (tab==='tasks')     renderTasks(agent);
  if (tab==='pipeline')  renderPipeline(agent);
  if (tab==='channels')  renderChannels(agent);
  if (tab==='cron')      renderCron(agent);
  if (tab==='chat')      renderChat(agent);
  if (tab==='config') {
    if (!MODELS.length || !PROVIDERS.length) await Promise.all([fetchProviders(), fetchModels()]);
    renderConfig(agent);
  }
}

function renderAgentOverview(a) {
  const lang   = i18n.lang;
  const locale = a.locales?.[lang] || a.locales?.en || a;
  const desc   = locale.description || a.description || '';
  const vibe   = locale.vibe || a.vibe || '';
  const caps   = a.capabilities || [];

  const el = $('#tab-overview');
  el.innerHTML = tabDescHtml('overview') + `
    <div class="ov-grid">
      <div class="ov-card">
        <div class="ov-card-label">Info</div>
        <div class="kv"><span class="kk">ID</span><span class="kv-val kv-mono">${esc(a.id)}</span></div>
        <div class="kv"><span class="kk">Group</span><span class="kv-val">${esc(a.group || '—')}</span></div>
        <div class="kv"><span class="kk">Model</span><span class="kv-val">${esc(a.model || '—')}</span></div>
        <div class="kv"><span class="kk">Source</span><span class="kv-val">${esc(a.source || 'catalog')}</span></div>
        ${a.prompt_file ? `<div class="kv"><span class="kk">Prompt</span><span class="kv-val kv-mono" style="font-size:10px">${esc(a.prompt_file)}</span></div>` : ''}
      </div>
      <div class="ov-card">
        <div class="ov-card-label">Description</div>
        <p class="ov-desc">${esc(desc || '—')}</p>
        ${vibe ? `<p class="ov-vibe">"${esc(vibe)}"</p>` : ''}
      </div>
      ${caps.length ? `
      <div class="ov-card" style="grid-column:1/-1">
        <div class="ov-card-label">Capabilities</div>
        <div class="cap-list">${caps.map(c=>`<span class="cap">${esc(c)}</span>`).join('')}</div>
      </div>` : ''}
    </div>
    <div class="ov-danger">
      <div class="danger-row">
        <div>
          <div class="danger-label">Remove from project</div>
          <div class="danger-hint">Detaches this agent from the current project and deletes its .legion/agents/ file</div>
        </div>
        <button class="btn-danger" id="ov-remove-agent">Remove agent</button>
      </div>
    </div>`;

  $('#ov-remove-agent').addEventListener('click', async () => {
    if (!confirm(`Remove "${a.name}" from this project?`)) return;
    await apiRemoveAgent(S.projectId, a.id);
    if (PROJECT_AGENTS[S.projectId]) {
      PROJECT_AGENTS[S.projectId] = PROJECT_AGENTS[S.projectId].filter(x => x.id !== a.id);
    }
    delete AGENT_REGISTRY[a.id];
    addedAgentIds.delete(a.id);
    S.agentId = null;
    renderTree();
    showDash();
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return '';
  const s = Math.round(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function agentStoreUrl(agentId, store, itemId) {
  const base = `/api/projects/${S.projectId}/agents/${agentId}/${store}`;
  return itemId ? `${base}/${itemId}` : base;
}

async function storeGet(agentId, store) {
  try { return await (await fetch(agentStoreUrl(agentId, store))).json(); } catch { return []; }
}
async function storePost(agentId, store, body) {
  return (await fetch(agentStoreUrl(agentId, store), { method: 'POST',
    headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })).json();
}
async function storePatch(agentId, store, itemId, body) {
  return (await fetch(agentStoreUrl(agentId, store, itemId), { method: 'PATCH',
    headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })).json();
}
async function storeDel(agentId, store, itemId) {
  return (await fetch(agentStoreUrl(agentId, store, itemId), { method: 'DELETE' })).json();
}

// ── Workers ────────────────────────────────────────────────────────────────

let workersPoll = null;

function stopWorkersPoll() {
  if (workersPoll) { clearInterval(workersPoll); workersPoll = null; }
}

const WK_STATUS = {
  running: { cls: 'wk-dot-running', label: 'Running' },
  queued:  { cls: 'wk-dot-queued',  label: 'Queued'  },
  done:    { cls: 'wk-dot-done',    label: 'Done'     },
  failed:  { cls: 'wk-dot-failed',  label: 'Failed'   },
};

async function renderWorkers(a) {
  const el = $('#tab-workers');
  const aid = a?.id || S.agentId;
  const desc = tabDescHtml('workers');
  el.innerHTML = desc + `<div class="tab-loading">Loading…</div>`;

  const items = await storeGet(aid, 'workers');

  if (!items.length) {
    el.innerHTML = desc + `
      <div class="tab-empty">
        <div class="tab-empty-icon">⚙</div>
        <div class="tab-empty-text">No workers spawned yet</div>
        <button class="btn-tab-add" id="wk-add">+ Add worker</button>
      </div>`;
  } else {
    el.innerHTML = desc + `
      <div class="store-toolbar">
        <span class="store-count">${items.length} worker${items.length!==1?'s':''}</span>
        <button class="btn-tab-add" id="wk-add">+ Add</button>
      </div>
      <div class="wk-list">
        ${items.map(w => {
          const st = WK_STATUS[w.status] || { cls: 'wk-dot-done', label: w.status };
          return `
          <div class="wk-card" data-id="${w.id}">
            <span class="wk-dot ${st.cls}"></span>
            <div class="wk-info">
              <div class="wk-name">${esc(w.name || 'Unnamed')}</div>
              ${w.report ? `<div class="wk-report">${esc(w.report)}</div>` : ''}
            </div>
            <div class="wk-meta">
              <span class="wk-label">${st.label}</span>
              <span class="wk-time">${relTime(w.updatedAt || w.createdAt)}</span>
            </div>
            <button class="wk-del" data-id="${w.id}" title="Delete">✕</button>
          </div>`;
        }).join('')}
      </div>`;

    el.addEventListener('click', async e => {
      const btn = e.target.closest('.wk-del');
      if (!btn) return;
      await storeDel(aid, 'workers', btn.dataset.id);
      renderWorkers(a);
    }, { once: true });
  }

  $('#wk-add') && $('#wk-add').addEventListener('click', () => openWorkerModal(a));
}

function openWorkerModal(a) {
  const aid = a?.id || S.agentId;
  showMiniModal({
    title: 'Add Worker',
    fields: [
      { id: 'wk-m-name',   label: 'Name',   placeholder: 'e.g. Design compaction logic' },
      { id: 'wk-m-status', label: 'Status', type: 'select',
        options: ['running','queued','done','failed'] },
      { id: 'wk-m-report', label: 'Report (optional)', placeholder: 'Latest output…' },
    ],
    onSave: async () => {
      const name   = $('#wk-m-name').value.trim();
      const status = $('#wk-m-status').value;
      const report = $('#wk-m-report').value.trim();
      if (!name) return;
      await storePost(aid, 'workers', { name, status, report });
      closeMiniModal();
      renderWorkers(a);
    }
  });
}

// ── Tasks (Kanban) ─────────────────────────────────────────────────────────

const TASK_COLS = ['in_progress','needs_review','ready','backlog','done','blocked','cancelled'];
const TASK_COL_LABELS = {
  in_progress: 'In Progress', needs_review: 'Needs Review', ready: 'Ready',
  backlog: 'Backlog', done: 'Done', blocked: 'Blocked', cancelled: 'Cancelled'
};

async function renderTasks(a) {
  const el = $('#tab-tasks');
  const aid = a?.id || S.agentId;
  const desc = tabDescHtml('tasks');
  el.innerHTML = desc + `<div class="tab-loading">Loading…</div>`;

  const items = await storeGet(aid, 'tasks');

  if (!items.length) {
    el.innerHTML = desc + `
      <div class="tab-empty">
        <div class="tab-empty-icon">✓</div>
        <div class="tab-empty-text">No tasks yet</div>
        <button class="btn-tab-add" id="task-add">+ New task</button>
      </div>`;
  } else {
    const buckets = {};
    for (const t of items) {
      const s = t.status || 'backlog';
      (buckets[s] = buckets[s] || []).push(t);
    }
    const cols = TASK_COLS.filter(s => buckets[s]?.length);

    el.innerHTML = desc + `
      <div class="store-toolbar">
        <span class="store-count">${items.length} task${items.length!==1?'s':''}</span>
        <button class="btn-tab-add" id="task-add">+ New task</button>
      </div>
      <div class="kanban-board">
        ${cols.map(status => `
          <div class="kanban-col">
            <div class="kanban-col-head">
              <span>${TASK_COL_LABELS[status] || status}</span>
              <span class="kanban-col-cnt">${buckets[status].length}</span>
            </div>
            ${buckets[status].map(t => `
              <div class="kanban-card" data-id="${t.id}">
                <div class="kanban-card-top">
                  <span class="kanban-id">#${t.id.slice(0,6)}</span>
                  <button class="kanban-del" data-id="${t.id}">✕</button>
                </div>
                <div class="kanban-title">${esc(t.title || 'Untitled')}</div>
                ${t.description ? `<div class="kanban-desc">${esc(t.description)}</div>` : ''}
                <div class="kanban-footer">
                  <span class="kanban-priority ${esc(t.priority||'')}">${esc(t.priority||'')}</span>
                  <span class="kanban-time">${relTime(t.updatedAt||t.createdAt)}</span>
                </div>
              </div>`).join('')}
          </div>`).join('')}
      </div>`;

    el.addEventListener('click', async e => {
      const btn = e.target.closest('.kanban-del');
      if (!btn) return;
      await storeDel(aid, 'tasks', btn.dataset.id);
      renderTasks(a);
    }, { once: true });
  }

  $('#task-add') && $('#task-add').addEventListener('click', () => openTaskModal(a));
}

function openTaskModal(a) {
  const aid = a?.id || S.agentId;
  showMiniModal({
    title: 'New Task',
    fields: [
      { id: 'tk-m-title', label: 'Title', placeholder: 'e.g. Implement routing layer' },
      { id: 'tk-m-desc',  label: 'Description (optional)', placeholder: '' },
      { id: 'tk-m-status', label: 'Status', type: 'select', options: TASK_COLS },
      { id: 'tk-m-priority', label: 'Priority', type: 'select', options: ['','high','medium','low'] },
    ],
    onSave: async () => {
      const title    = $('#tk-m-title').value.trim();
      const desc     = $('#tk-m-desc').value.trim();
      const status   = $('#tk-m-status').value || 'backlog';
      const priority = $('#tk-m-priority').value;
      if (!title) return;
      await storePost(aid, 'tasks', { title, description: desc, status, priority });
      closeMiniModal();
      renderTasks(a);
    }
  });
}

// ── Memories ───────────────────────────────────────────────────────────────

const MEM_KINDS = ['all','persistent','temporary','todo'];
const MEM_KIND_LABEL = { persistent: 'Persistent', temporary: 'Temporary', todo: 'Todo' };

async function syncMemoryFile(agentId, memories) {
  const sections = { persistent: [], temporary: [], todo: [] };
  for (const m of memories) {
    const k = m.kind || 'persistent';
    (sections[k] || sections.persistent).push(m);
  }
  const lines = ['# Memory\n'];
  if (sections.persistent.length) {
    lines.push('## Persistent');
    sections.persistent.forEach(m => {
      const imp = m.importance != null ? ` *(importance: ${m.importance})*` : '';
      lines.push(`- ${m.note || m.text || ''}${imp}`);
    });
    lines.push('');
  }
  if (sections.temporary.length) {
    lines.push('## Temporary');
    sections.temporary.forEach(m => lines.push(`- ${m.note || m.text || ''}`));
    lines.push('');
  }
  if (sections.todo.length) {
    lines.push('## Todo');
    sections.todo.forEach(m => lines.push(`- [ ] ${m.note || m.text || ''}`));
    lines.push('');
  }
  await fetch(`/api/projects/${S.projectId}/agents/${agentId}/files/MEMORY.md`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: lines.join('\n').trim() }),
  });
}

function memSectionKind(heading) {
  const h = heading.toLowerCase();
  if (/todo|task|action/i.test(h))              return 'todo';
  if (/temp|short|session|thread|open/i.test(h)) return 'temporary';
  return 'persistent';
}

async function importMemoriesFromFile(agentId) {
  try {
    const res = await fetch(`/api/projects/${S.projectId}/agents/${agentId}/files/MEMORY.md`);
    if (!res.ok) return [];
    const text = await res.text();
    const result = [];
    let kind = 'persistent';
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      const headM = line.match(/^#{1,3}\s+(.+)/);
      if (headM) { kind = memSectionKind(headM[1]); continue; }
      const todoM   = line.match(/^-\s*\[\s*\]\s+(.+)/);
      const bulletM = line.match(/^-\s+(.+)/);
      if (!todoM && !bulletM) continue;
      const raw_note = (todoM || bulletM)[1];
      // skip pure italic placeholders like _text_
      if (/^_[^_]+_$/.test(raw_note.trim())) continue;
      const impM = raw_note.match(/\*\(importance:\s*([\d.]+)\)\*\s*$/);
      const note = raw_note.replace(/\s*\*\(importance:[\s\d.]+\)\*\s*$/, '').trim();
      const importance = impM ? parseFloat(impM[1]) : 0.5;
      result.push({ note, kind: todoM ? 'todo' : kind, importance });
    }
    return result;
  } catch { return []; }
}

async function renderMemories(a) {
  const el = $('#tab-memories');
  const aid = a?.id || S.agentId;
  const desc = tabDescHtml('memories');
  el.innerHTML = desc + `<div class="tab-loading">Loading…</div>`;

  let all = await storeGet(aid, 'memories');

  if (!all.length) {
    const imported = await importMemoriesFromFile(aid);
    for (const m of imported) await storePost(aid, 'memories', m);
    if (imported.length) all = await storeGet(aid, 'memories');
  }

  let filter = 'all';

  function paint() {
    const items = filter === 'all' ? all : all.filter(m => m.kind === filter);
    el.innerHTML = desc + `
      <div class="store-toolbar">
        <div class="mem-filters">
          ${MEM_KINDS.map(k => `<button class="mem-filter${k===filter?' on':''}" data-kind="${k}">${k==='all'?'All':MEM_KIND_LABEL[k]||k}</button>`).join('')}
        </div>
        <button class="btn-tab-add" id="mem-add">+ Add</button>
      </div>
      ${!items.length ? `<div class="tab-empty"><div class="tab-empty-icon">◎</div><div class="tab-empty-text">No memories yet</div></div>` : `
      <div class="mem-list">
        ${items.map(m => `
          <div class="mem-card" data-id="${m.id}">
            <div class="mem-head">
              <span class="mem-badge ${esc(m.kind||'persistent')}">${esc(MEM_KIND_LABEL[m.kind]||m.kind||'Persistent')}</span>
              <span class="mem-time">${relTime(m.updatedAt||m.createdAt)}</span>
              <button class="mem-del" data-id="${esc(m.id)}">✕</button>
            </div>
            <div class="mem-text">${esc(m.note||m.text||'')}</div>
            ${m.summary ? `<div class="mem-summary">${esc(m.summary)}</div>` : ''}
            ${(m.importance||m.confidence) ? `<div class="mem-meta">
              ${m.importance ? `<span>importance: ${esc(String(m.importance))}</span>` : ''}
              ${m.confidence ? `<span>confidence: ${esc(String(m.confidence))}</span>` : ''}
            </div>` : ''}
          </div>`).join('')}
      </div>`}`;

    el.querySelectorAll('.mem-filter').forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.kind;
      paint();
    }));
    el.querySelectorAll('.mem-del').forEach(btn => btn.addEventListener('click', async () => {
      await storeDel(aid, 'memories', btn.dataset.id);
      all = all.filter(m => m.id !== btn.dataset.id);
      await syncMemoryFile(aid, all);
      paint();
    }));
    $('#mem-add') && $('#mem-add').addEventListener('click', () => openMemoryModal(a, () => {
      renderMemories(a);
    }));
  }

  paint();
}

function openMemoryModal(a, onDone) {
  const aid = a?.id || S.agentId;
  showMiniModal({
    title: 'Add Memory',
    fields: [
      { id: 'mem-m-note', label: 'Note', placeholder: 'What to remember…' },
      { id: 'mem-m-kind', label: 'Kind', type: 'select', options: ['persistent','temporary','todo'] },
      { id: 'mem-m-importance', label: 'Importance (0–1)', placeholder: '0.8' },
    ],
    onSave: async () => {
      const note       = $('#mem-m-note').value.trim();
      const kind       = $('#mem-m-kind').value;
      const importance = parseFloat($('#mem-m-importance').value) || 0.5;
      if (!note) return;
      await storePost(aid, 'memories', { note, kind, importance });
      const all = await storeGet(aid, 'memories');
      await syncMemoryFile(aid, all);
      closeMiniModal();
      onDone && onDone();
    }
  });
}

// ── Channels ───────────────────────────────────────────────────────────────

const CHANNEL_TYPES = [
  { type: 'http',     label: 'HTTP API',  icon: '⇌' },
  { type: 'telegram', label: 'Telegram',  icon: '✈' },
  { type: 'discord',  label: 'Discord',   icon: '◈' },
  { type: 'webhook',  label: 'Webhook',   icon: '⚡' },
  { type: 'mcp',      label: 'MCP',       icon: '⚒' },
];

async function renderChannels(a) {
  const el = $('#tab-channels');
  const aid = a?.id || S.agentId;
  const desc = tabDescHtml('channels');
  el.innerHTML = desc + `<div class="tab-loading">Loading…</div>`;

  let channels = await storeGet(aid, 'channels');

  function paint() {
    if (!channels.length) {
      el.innerHTML = desc + `
        <div class="tab-empty">
          <div class="tab-empty-icon">⇌</div>
          <div class="tab-empty-text">No channels configured</div>
          <button class="btn-tab-add" id="ch-add">+ Add channel</button>
        </div>`;
    } else {
      el.innerHTML = desc + `
        <div class="store-toolbar">
          <span class="store-count">${channels.length} channel${channels.length!==1?'s':''}</span>
          <button class="btn-tab-add" id="ch-add">+ Add channel</button>
        </div>
        <div class="ch-list">
          ${channels.map(ch => {
            const meta = CHANNEL_TYPES.find(t => t.type === ch.type) || { icon: '⇌', label: ch.type };
            return `
            <div class="ch-card ${ch.enabled ? 'ch-on' : 'ch-off'}" data-id="${ch.id}">
              <div class="ch-icon">${meta.icon}</div>
              <div class="ch-info">
                <div class="ch-label">${esc(meta.label)}${ch.name ? ` — ${esc(ch.name)}` : ''}</div>
                ${ch.channelId ? `<div class="ch-id">${esc(ch.channelId)}</div>` : ''}
                ${ch.endpoint  ? `<div class="ch-id">${esc(ch.endpoint)}</div>`  : ''}
              </div>
              <label class="ch-toggle">
                <input type="checkbox" data-id="${ch.id}" ${ch.enabled ? 'checked' : ''}/>
                <span class="ch-toggle-track"></span>
              </label>
              <button class="ch-del" data-id="${ch.id}">✕</button>
            </div>`;
          }).join('')}
        </div>`;
    }

    $('#ch-add') && $('#ch-add').addEventListener('click', () => openChannelModal(a, async () => {
      channels = await storeGet(aid, 'channels');
      paint();
    }));

    el.querySelectorAll('.ch-toggle input').forEach(cb => cb.addEventListener('change', async () => {
      await storePatch(aid, 'channels', cb.dataset.id, { enabled: cb.checked });
      const ch = channels.find(c => c.id === cb.dataset.id);
      if (ch) ch.enabled = cb.checked;
      paint();
    }));

    el.querySelectorAll('.ch-del').forEach(btn => btn.addEventListener('click', async () => {
      await storeDel(aid, 'channels', btn.dataset.id);
      channels = channels.filter(c => c.id !== btn.dataset.id);
      paint();
    }));
  }

  paint();
}

// ── Cron ───────────────────────────────────────────────────────────────────

async function renderCron(a) {
  const el = $('#tab-cron');
  const aid = a?.id || S.agentId;
  const desc = tabDescHtml('cron');
  el.innerHTML = desc + `<div class="tab-loading">Loading…</div>`;

  let jobs = await storeGet(aid, 'cron');

  function paint() {
    if (!jobs.length) {
      el.innerHTML = desc + `
        <div class="tab-empty">
          <div class="tab-empty-icon">⏱</div>
          <div class="tab-empty-text">No cron jobs yet</div>
          <button class="btn-tab-add" id="cron-add">+ New job</button>
        </div>`;
    } else {
      el.innerHTML = desc + `
        <div class="store-toolbar">
          <span class="store-count">${jobs.length} job${jobs.length!==1?'s':''}</span>
          <button class="btn-tab-add" id="cron-add">+ New job</button>
        </div>
        <div class="cron-list">
          ${jobs.map(j => `
            <div class="cron-row" data-id="${j.id}">
              <div class="cron-info">
                <code class="cron-schedule">${esc(j.schedule||'?')}</code>
                <span class="cron-command">${esc(j.command||'')}</span>
                ${j.channelId ? `<span class="cron-channel">→ ${esc(j.channelId)}</span>` : ''}
              </div>
              <div class="cron-actions">
                <label class="cron-toggle">
                  <input type="checkbox" data-id="${j.id}" ${j.enabled ? 'checked' : ''} />
                  <span class="cron-track"></span>
                </label>
                <span class="cron-status">${j.enabled ? 'Active' : 'Paused'}</span>
                <button class="cron-edit" data-id="${j.id}">Edit</button>
                <button class="cron-del" data-id="${j.id}">Delete</button>
              </div>
            </div>`).join('')}
        </div>`;
    }

    $('#cron-add') && $('#cron-add').addEventListener('click', () => openCronModal(a, null, async () => {
      jobs = await storeGet(aid, 'cron'); paint();
    }));

    el.querySelectorAll('.cron-toggle input').forEach(cb => cb.addEventListener('change', async () => {
      await storePatch(aid, 'cron', cb.dataset.id, { enabled: cb.checked });
      const j = jobs.find(x => x.id === cb.dataset.id);
      if (j) j.enabled = cb.checked;
      paint();
    }));

    el.querySelectorAll('.cron-edit').forEach(btn => btn.addEventListener('click', () => {
      const j = jobs.find(x => x.id === btn.dataset.id);
      if (!j) return;
      openCronModal(a, j, async () => { jobs = await storeGet(aid, 'cron'); paint(); });
    }));

    el.querySelectorAll('.cron-del').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Delete this cron job?')) return;
      await storeDel(aid, 'cron', btn.dataset.id);
      jobs = jobs.filter(x => x.id !== btn.dataset.id);
      paint();
    }));
  }

  paint();
}

function openCronModal(a, existing, onDone) {
  const aid = a?.id || S.agentId;
  showMiniModal({
    title: existing ? 'Edit Cron Job' : 'New Cron Job',
    fields: [
      { id: 'cron-m-schedule', label: 'Schedule', placeholder: '*/5 * * * *' },
      { id: 'cron-m-command',  label: 'Command',  placeholder: 'ping' },
      { id: 'cron-m-channel',  label: 'Channel ID', placeholder: 'agent:id:session:…' },
    ],
    onSave: async () => {
      const schedule  = $('#cron-m-schedule').value.trim();
      const command   = $('#cron-m-command').value.trim();
      const channelId = $('#cron-m-channel').value.trim();
      if (!schedule || !command) return;
      if (existing) {
        await storePatch(aid, 'cron', existing.id, { schedule, command, channelId });
      } else {
        await storePost(aid, 'cron', { schedule, command, channelId, enabled: true });
      }
      closeMiniModal();
      onDone && onDone();
    }
  });
  if (existing) {
    setTimeout(() => {
      $('#cron-m-schedule') && ($('#cron-m-schedule').value = existing.schedule || '');
      $('#cron-m-command')  && ($('#cron-m-command').value  = existing.command  || '');
      $('#cron-m-channel')  && ($('#cron-m-channel').value  = existing.channelId || '');
    }, 10);
  }
}

function openChannelModal(a, onDone) {
  const aid = a?.id || S.agentId;
  showMiniModal({
    title: 'Add Channel',
    fields: [
      { id: 'ch-m-type', label: 'Type', type: 'select',
        options: CHANNEL_TYPES.map(t => t.type) },
      { id: 'ch-m-name', label: 'Name (optional)', placeholder: 'e.g. main-bot' },
      { id: 'ch-m-cid',  label: 'Channel ID / Token', placeholder: '' },
      { id: 'ch-m-ep',   label: 'Endpoint (HTTP/Webhook)', placeholder: 'http://localhost:3000' },
    ],
    onSave: async () => {
      const type      = $('#ch-m-type').value;
      const name      = $('#ch-m-name').value.trim();
      const channelId = $('#ch-m-cid').value.trim();
      const endpoint  = $('#ch-m-ep').value.trim();
      await storePost(aid, 'channels', { type, name, channelId, endpoint, enabled: true });
      closeMiniModal();
      onDone && onDone();
    }
  });
}

// ── Mini modal (shared) ────────────────────────────────────────────────────

function showMiniModal({ title, fields, onSave }) {
  closeMiniModal();
  const el = document.createElement('div');
  el.className = 'overlay on';
  el.id = 'mini-modal-overlay';
  el.innerHTML = `
    <div class="modal">
      <div class="modal-title">${title}</div>
      ${fields.map(f => `
        <div class="field">
          <label class="field-label" for="${f.id}">${f.label}</label>
          ${f.type === 'select'
            ? `<select class="field-input" id="${f.id}">
                ${f.options.map(o => typeof o === 'object'
                  ? `<option value="${esc(o.value)}">${esc(o.label)}</option>`
                  : `<option value="${esc(o)}">${o || '—'}</option>`).join('')}
               </select>`
            : `<input class="field-input" id="${f.id}" type="text" placeholder="${f.placeholder||''}" />`}
        </div>`).join('')}
      <div class="modal-actions">
        <button class="btn-cancel" id="mini-modal-cancel">Cancel</button>
        <button class="btn-create" id="mini-modal-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) closeMiniModal(); });
  $('#mini-modal-cancel').addEventListener('click', closeMiniModal);
  $('#mini-modal-save').addEventListener('click', onSave);
  // Focus first input
  const first = el.querySelector('input');
  if (first) setTimeout(() => first.focus(), 50);
}

function closeMiniModal() {
  const el = $('#mini-modal-overlay');
  if (el) el.remove();
}

async function renderPipeline(a) {
  const el = $('#tab-pipeline');
  const aid = a?.id || S.agentId;
  const desc = tabDescHtml('pipeline');
  el.innerHTML = desc + `<div class="tab-loading">Loading…</div>`;

  let triggers = await storeGet(aid, 'pipeline');

  const COND_LABEL = {
    always:     i18n.t('pipe_cond_always'),
    on_success: i18n.t('pipe_cond_success'),
    on_failure: i18n.t('pipe_cond_failure'),
  };
  const MODE_LABEL = {
    sequential: i18n.t('pipe_mode_seq'),
    parallel:   i18n.t('pipe_mode_par'),
  };

  function agentName(id) {
    return projectAgents().find(x => x.id === id)?.name || id;
  }

  function paint() {
    el.innerHTML = desc + `
      <div class="store-toolbar">
        <span class="pipe-toolbar-hint">${esc(i18n.t('pipe_event_task'))}</span>
        <button class="btn-tab-add" id="pipe-add">${esc(i18n.t('pipe_add'))}</button>
      </div>
      ${!triggers.length
        ? `<div class="tab-empty"><div class="tab-empty-icon">⇢</div><div class="tab-empty-text">${esc(i18n.t('ph_pipeline'))}</div></div>`
        : `<div class="pipe-list">
            ${triggers.map(t => `
              <div class="pipe-card" data-id="${esc(t.id)}">
                <div class="pipe-event-dot"></div>
                <div class="pipe-connector"></div>
                <div class="pipe-body">
                  <div class="pipe-target">${esc(agentName(t.targetAgentId))}</div>
                  <div class="pipe-badges">
                    <span class="pipe-badge pipe-badge-cond">${esc(COND_LABEL[t.condition] || t.condition)}</span>
                    <span class="pipe-badge pipe-badge-mode">${esc(MODE_LABEL[t.mode] || t.mode)}</span>
                  </div>
                </div>
                <button class="pipe-del" data-id="${esc(t.id)}">✕</button>
              </div>`).join('')}
          </div>`}`;

    el.querySelector('#pipe-add')?.addEventListener('click', () => openPipelineModal(a, () => renderPipeline(a)));
    el.querySelectorAll('.pipe-del').forEach(btn => btn.addEventListener('click', async () => {
      await storeDel(aid, 'pipeline', btn.dataset.id);
      triggers = triggers.filter(t => t.id !== btn.dataset.id);
      paint();
    }));
  }

  paint();
}

function openPipelineModal(a, onDone) {
  const aid = a?.id || S.agentId;
  const agents = projectAgents().filter(x => x.id !== aid);
  if (!agents.length) {
    alert('No other agents in this project to trigger.');
    return;
  }
  showMiniModal({
    title: 'Add Trigger',
    fields: [
      { id: 'pipe-m-agent',     label: 'Target agent',
        type: 'select', options: agents.map(ag => ({ value: ag.id, label: ag.name })) },
      { id: 'pipe-m-condition', label: 'Condition',
        type: 'select', options: [
          { value: 'always',     label: i18n.t('pipe_cond_always')  },
          { value: 'on_success', label: i18n.t('pipe_cond_success') },
          { value: 'on_failure', label: i18n.t('pipe_cond_failure') },
        ]},
      { id: 'pipe-m-mode',      label: 'Mode',
        type: 'select', options: [
          { value: 'sequential', label: i18n.t('pipe_mode_seq') },
          { value: 'parallel',   label: i18n.t('pipe_mode_par') },
        ]},
    ],
    onSave: async () => {
      const targetAgentId = $('#pipe-m-agent').value;
      const condition     = $('#pipe-m-condition').value;
      const mode          = $('#pipe-m-mode').value;
      if (!targetAgentId) return;
      await storePost(aid, 'pipeline', { targetAgentId, condition, mode, event: 'task_complete' });
      closeMiniModal();
      onDone && onDone();
    },
  });
}

function renderChat(a) {
  $('#tab-chat').innerHTML = tabDescHtml('chat') + `
    <div class="chat-wrap">
      <div class="chat-msgs" id="chat-msgs">
        <div class="msg agent">
          <div class="msg-ava" style="background:${a.color}18;color:${a.color};border:1px solid ${a.color}30">${initials(a.name)}</div>
          <div class="msg-bub">Hello. I'm ${esc(a.name)}. How can I assist?</div>
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
        <div class="msg-bub">${esc(text)}</div>
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
  const el = $('#tab-config');
  const project = PROJECTS.find(p => p.id === S.projectId);
  const hasPath = !!project?.path;

  const modelOptions = MODELS.length
    ? MODELS.map(m => {
        const prov = PROVIDERS.find(p => p.id === m.providerId);
        const label = prov ? `${prov.name} / ${m.name}` : m.name;
        const sel = (a.model === m.modelId || a.modelId === m.modelId) ? ' selected' : '';
        return `<option value="${m.modelId}"${sel}>${label}</option>`;
      }).join('')
    : '<option value="">— No models configured —</option>';

  const DOC_FILES = {
    'AGENTS.md':   'cfg_file_agents',
    'IDENTITY.md': 'cfg_file_identity',
    'SOUL.md':     'cfg_file_soul',
    'USER.md':     'cfg_file_user',
    'MEMORY.md':   'cfg_file_memory',
    'CONTEXT.md':  'cfg_file_context',
    'SKILLS.md':   'cfg_file_skills',
  };
  const fileNames = Object.keys(DOC_FILES);

  el.innerHTML = tabDescHtml('config') + `
    <div class="cfg-section">
      <div class="cfg-section-label">Model</div>
      <div class="cfg-model-row">
        <select class="field-input cfg-model-select" id="cfg-model-sel">
          <option value="">— Default —</option>
          ${modelOptions}
        </select>
        <button class="btn-cfg-save" id="cfg-model-save">Save</button>
      </div>
      ${!MODELS.length ? `<div class="cfg-hint">Add models in Settings → Models first</div>` : ''}
    </div>

    ${hasPath ? `
    <div class="cfg-section cfg-files-section">
      <div class="cfg-section-label">Agent files</div>
      <div class="cfg-files-layout">
        <div class="cfg-file-list" id="cfg-file-tabs">
          ${fileNames.map((f, i) => `
            <button class="cfg-file-item${i===0?' on':''}" data-file="${f}">
              <span class="cfg-file-name">${f}</span>
            </button>`).join('')}
        </div>
        <div class="cfg-file-right">
          <div class="cfg-file-desc-block" id="cfg-file-desc">
            <div class="cfg-file-desc-name" id="cfg-file-desc-name">${fileNames[0]}</div>
            <div class="cfg-file-desc-text" id="cfg-file-desc-text">${i18n.t(DOC_FILES[fileNames[0]])}</div>
          </div>
          <div class="cfg-editor-wrap">
            <textarea class="cfg-editor" id="cfg-editor" spellcheck="false" placeholder="Loading…"></textarea>
            <div class="cfg-editor-foot">
              <span class="cfg-editor-status" id="cfg-editor-status"></span>
              <button class="btn-cfg-save" id="cfg-file-save">Save file</button>
            </div>
          </div>
        </div>
      </div>
    </div>` : `
    <div class="cfg-section">
      <div class="cfg-hint">Link a project folder in Settings → Overview to edit agent files.</div>
    </div>`}
  `;

  // Model save
  $('#cfg-model-save').addEventListener('click', async () => {
    const modelId = $('#cfg-model-sel').value;
    a.model = modelId;
    // Persist: update agent in project-agents list
    const map = (PROJECT_AGENTS[S.projectId] || []);
    const idx = map.findIndex(x => x.id === a.id);
    if (idx >= 0) { map[idx] = { ...map[idx], model: modelId }; a = map[idx]; }
    await fetch(`/api/projects/${S.projectId}/agents`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a) });
    $('#cfg-editor-status') && ($('#cfg-editor-status').textContent = '');
    const btn = $('#cfg-model-save');
    btn.textContent = 'Saved ✓'; setTimeout(() => btn.textContent = 'Save', 1500);
  });

  if (!hasPath) return;

  function updateFileDesc(filename) {
    const nameEl = $('#cfg-file-desc-name');
    const textEl = $('#cfg-file-desc-text');
    if (nameEl) nameEl.textContent = filename;
    if (textEl) textEl.textContent = i18n.t(DOC_FILES[filename] || '');
  }

  let currentFile = fileNames[0];

  async function loadFile(filename) {
    const status = $('#cfg-editor-status');
    status.textContent = 'Loading…';
    try {
      const r = await fetch(`/api/projects/${S.projectId}/agents/${a.id}/files/${filename}`);
      const d = await r.json();
      $('#cfg-editor').value = d.content || '';
      status.textContent = '';
    } catch {
      status.textContent = '✗ Failed to load';
    }
  }

  loadFile(currentFile);

  $('#cfg-file-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.cfg-file-item');
    if (!btn) return;
    $$('.cfg-file-item').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    currentFile = btn.dataset.file;
    updateFileDesc(currentFile);
    loadFile(currentFile);
  });

  $('#cfg-file-save').addEventListener('click', async () => {
    const content = $('#cfg-editor').value;
    const status  = $('#cfg-editor-status');
    status.textContent = 'Saving…';
    try {
      await fetch(`/api/projects/${S.projectId}/agents/${a.id}/files/${currentFile}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      status.textContent = '✓ Saved';
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch {
      status.textContent = '✗ Save failed';
    }
  });
}

// ── Agent catalog ─────────────────────────────────────────────────────────

let CATALOG_AGENTS = [];
let catalogLoaded  = false;

async function loadCatalog() {
  if (!catalogLoaded) {
    try {
      const res  = await fetch('/data/agents-catalog.json');
      CATALOG_AGENTS = await res.json();
      catalogLoaded  = true;
    } catch (e) {
      console.warn('Could not load agents-catalog.json', e);
    }
  }
  renderCatalogFilters();
  renderCatalogGrid();
}

// IDs агентов добавленных в текущий проект (пересчитывается при смене проекта)
let addedAgentIds = new Set();

function syncAddedIds() {
  addedAgentIds = new Set((PROJECT_AGENTS[S.projectId] || []).map(a => a.id));
}

let catalogFilter = 'All';
let catalogSearch = '';

function catalogGroups() {
  return ['All', ...new Set(CATALOG_AGENTS.map(a => a.group))];
}

async function showCatalog() {
  showView('view-catalog');
  const el = $('#catalog-proj-name');
  if (el) el.textContent = PROJECTS.find(p => p.id===S.projectId)?.name || '—';
  await loadCatalog();
}

function hideCatalog() {
  showDash();
}

function renderCatalogFilters() {
  $('#catalog-filters').innerHTML = catalogGroups().map(g =>
    `<button class="cat-filter ${catalogFilter===g?'on':''}" data-group="${g}">${g}</button>`
  ).join('');
}

// Delegated — survives innerHTML re-renders
function initCatalogFilterListener() {
  $('#catalog-filters').addEventListener('click', e => {
    const btn = e.target.closest('.cat-filter');
    if (!btn) return;
    catalogFilter = btn.dataset.group;
    $$('.cat-filter').forEach(b => b.classList.toggle('on', b.dataset.group === catalogFilter));
    renderCatalogGrid();
  });
}

function renderCatalogGrid() {
  const q = catalogSearch.toLowerCase();
  const agents = CATALOG_AGENTS.filter(a => {
    const matchGroup  = catalogFilter==='All' || a.group===catalogFilter;
    const matchSearch = !q || a.name.toLowerCase().includes(q) || (a.role||'').toLowerCase().includes(q) || a.capabilities.some(c=>c.toLowerCase().includes(q));
    return matchGroup && matchSearch;
  });

  const total = CATALOG_AGENTS.length;
  const shown = agents.length;
  const projNameEl = $('#catalog-proj-name');
  if (projNameEl) projNameEl.textContent = PROJECTS.find(p=>p.id===S.projectId)?.name || '—';
  const sub = $('#view-catalog .dash-meta');
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
        <div class="cat-ava" style="background:${a.color}18;color:${a.color};border:1px solid ${a.color}30">${esc(emoji)}</div>
        <div class="cat-card-info">
          <div class="cat-name">${esc(locale.name || a.name)}</div>
          <div class="cat-role" style="color:${a.color}">${esc(vibe)}</div>
        </div>
      </div>
      <div class="cat-desc">${esc(desc)}</div>
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

      AGENT_REGISTRY[id] = agent;
      if (!PROJECT_AGENTS[S.projectId]) PROJECT_AGENTS[S.projectId] = [];
      PROJECT_AGENTS[S.projectId].push(agent);
      addedAgentIds.add(id);
      apiAddAgent(S.projectId, agent);

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
      selectAgent(id);
    });
  });
}

// ── Modal ──────────────────────────────────────────────────────────────────

function openModal() { $('#modal').classList.add('on'); $('#m-name').focus(); }
function closeModal() {
  $('#modal').classList.remove('on');
  $('#m-name').value = '';
  $('#m-desc').value = '';
  $('#m-path').value = '';
}

async function createProject() {
  const name = $('#m-name').value.trim();
  if (!name) return;
  const desc = $('#m-desc').value.trim();
  const path = $('#m-path').value.trim();

  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: desc, path, status: 'ok', agents: 0 }),
  });
  const project = await res.json();
  PROJECTS.push(project);
  S.projectId = project.id;
  S.agentId = null;
  renderProjBtn();
  renderTree();
  showDash();
  closeModal();
}

// ── Settings ───────────────────────────────────────────────────────────────

// ── Overview tab ───────────────────────────────────────────────────────────

function renderOverview() {
  const p = PROJECTS.find(x => x.id === S.projectId);
  if (!p) { $('#overview-form').innerHTML = '<div style="color:var(--text-3);padding:24px 0">No project selected</div>'; return; }
  const hasLegion = !!p.path;
  $('#overview-form').innerHTML = `
    <div class="overview-fields">
      <div class="field">
        <label class="field-label">Project name</label>
        <input class="field-input" id="ov-name" type="text" value="${esc(p.name)}" />
      </div>
      <div class="field">
        <label class="field-label">Description</label>
        <input class="field-input" id="ov-desc" type="text" value="${esc(p.description || '')}" placeholder="Short description" />
      </div>
      <div class="field">
        <label class="field-label">Project folder</label>
        <div class="path-field-wrap">
          <input class="field-input field-mono" id="ov-path" type="text" value="${esc(p.path || '')}" placeholder="/path/to/project" />
          <button class="btn-browse" id="ov-browse" title="Browse">⌂</button>
        </div>
      </div>
      <div class="overview-actions">
        <button class="btn-ov-save" id="ov-save">Save changes</button>
      </div>
    </div>
    <div class="overview-danger">
      <div class="danger-title">Danger zone</div>
      <div class="danger-row">
        <div>
          <div class="danger-label">Delete .legion folder</div>
          <div class="danger-hint">Removes .legion/LEGION.md and all Legion config from the project folder</div>
        </div>
        <button class="btn-danger" id="ov-del-legion" ${!hasLegion ? 'disabled' : ''}>Delete .legion</button>
      </div>
      <div class="danger-row">
        <div>
          <div class="danger-label">Remove project</div>
          <div class="danger-hint">Removes this project from Legion (also deletes .legion folder if present)</div>
        </div>
        <button class="btn-danger" id="ov-del-project">Remove project</button>
      </div>
    </div>`;

  $('#ov-browse').addEventListener('click', async () => {
    $('#ov-browse').disabled = true;
    try {
      const res = await fetch('/api/pick-folder');
      const { path } = await res.json();
      if (path) {
        $('#ov-path').value = path;
        const folderName = path.split('/').filter(Boolean).pop();
        if (folderName && $('#ov-name').value === p.name) $('#ov-name').value = folderName;
      }
    } finally { $('#ov-browse').disabled = false; }
  });

  $('#ov-save').addEventListener('click', saveOverview);

  if (hasLegion) {
    $('#ov-del-legion').addEventListener('click', async () => {
      if (!confirm('Delete .legion folder from project directory?')) return;
      await fetch(`/api/projects/${p.id}/legion`, { method: 'DELETE' });
      // update local path to trigger re-render
    });
  }

  $('#ov-del-project').addEventListener('click', async () => {
    if (!confirm(`Remove project "${p.name}" from Legion?`)) return;
    await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
    PROJECTS = PROJECTS.filter(x => x.id !== p.id);
    S.projectId = PROJECTS[0]?.id || null;
    renderProjBtn();
    renderTree();
    hideSettings();
    showDash();
  });
}

async function saveOverview() {
  const p = PROJECTS.find(x => x.id === S.projectId);
  if (!p) return;
  const name        = $('#ov-name').value.trim() || p.name;
  const description = $('#ov-desc').value.trim();
  const path        = $('#ov-path').value.trim();

  const res = await fetch(`/api/projects/${p.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, path }),
  });
  const updated = await res.json();
  const idx = PROJECTS.findIndex(x => x.id === p.id);
  if (idx >= 0) PROJECTS[idx] = updated;
  renderProjBtn();
  renderOverview();
}

const PROVIDER_META = {
  anthropic: { icon: '◆', color: '#D97706', label: 'Anthropic', hasKey: true,  hasEndpoint: false },
  openai:    { icon: '⬡', color: '#10B981', label: 'OpenAI',    hasKey: true,  hasEndpoint: false },
  google:    { icon: '◉', color: '#3B82F6', label: 'Google',    hasKey: true,  hasEndpoint: false },
  mistral:   { icon: '◈', color: '#8B5CF6', label: 'Mistral',   hasKey: true,  hasEndpoint: false },
  ollama:      { icon: '◎', color: '#64748B', label: 'Ollama',      hasKey: false, hasEndpoint: true  },
  'claude-cli': { icon: '▲', color: '#FF4D00', label: 'Claude CLI', hasKey: false, hasEndpoint: false },
  custom:      { icon: '◇', color: '#94A3B8', label: 'Custom',      hasKey: true,  hasEndpoint: true  },
};

// ── Providers ──────────────────────────────────────────────────────────────

let PROVIDERS = [];
let providerEditId = null;

async function fetchProviders() {
  try { const r = await fetch('/api/providers'); PROVIDERS = await r.json(); } catch { PROVIDERS = []; }
}
async function apiSaveProvider(p) {
  const r = await fetch('/api/providers', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(p) });
  return r.json();
}
async function apiDeleteProvider(id) { await fetch(`/api/providers/${id}`, { method: 'DELETE' }); }
async function apiFetchRemoteModels(providerId) {
  const r = await fetch(`/api/providers/${providerId}/models`);
  return r.json();
}

function renderProviders() {
  const list = $('#providers-list');
  if (!PROVIDERS.length) {
    list.innerHTML = `<div class="models-empty">
      <div class="models-empty-icon">◈</div>
      <div>No providers configured yet</div>
      <div style="margin-top:6px;font-size:11px;opacity:.6">Add Anthropic, OpenAI, Ollama, or other providers</div>
    </div>`;
    return;
  }
  list.innerHTML = PROVIDERS.map(p => {
    const meta = PROVIDER_META[p.type] || PROVIDER_META.custom;
    const hasCredential = meta.hasKey ? !!p.key : !!p.endpoint;
    const credLabel = meta.hasKey
      ? (p.key ? '● key set' : '○ no key')
      : (p.endpoint || '○ no endpoint');
    return `
    <div class="model-row" data-id="${p.id}">
      <div class="model-provider-icon" style="background:${meta.color}18;color:${meta.color}">${meta.icon}</div>
      <div class="model-info">
        <div class="model-name">${esc(p.name || meta.label)}</div>
        <div class="model-id">${esc(meta.label)}</div>
      </div>
      <div class="model-key-badge ${hasCredential ? 'set' : ''}">${credLabel}</div>
      <div class="model-actions">
        <button class="model-btn" data-action="edit" data-id="${p.id}">Edit</button>
        <button class="model-btn danger" data-action="delete" data-id="${p.id}">Delete</button>
      </div>
    </div>`;
  }).join('');

  $$('#providers-list .model-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (btn.dataset.action === 'delete') {
        await apiDeleteProvider(id);
        PROVIDERS = PROVIDERS.filter(p => p.id !== id);
        renderProviders();
      } else {
        openProviderModal(id);
      }
    });
  });
}

function openProviderModal(editId = null) {
  providerEditId = editId;
  const p = editId ? PROVIDERS.find(x => x.id === editId) : null;

  $('#pm-title').textContent = p ? 'Edit Provider' : 'Add Provider';
  $('#pm-name').value     = p?.name     || '';
  $('#pm-key').value      = p?.key      || '';
  $('#pm-endpoint').value = p?.endpoint || '';

  const type = p?.type || 'anthropic';
  $$('#pm-types .provider-pill').forEach(pill => pill.classList.toggle('on', pill.dataset.provider === type));
  updateProviderModalFields(type);
  if (!p) $('#pm-name').value = PROVIDER_META[type]?.label || '';

  $('#provider-modal').classList.add('on');
  $('#pm-name').focus();
}

function closeProviderModal() {
  $('#provider-modal').classList.remove('on');
  providerEditId = null;
}

function updateProviderModalFields(type) {
  const meta = PROVIDER_META[type] || PROVIDER_META.custom;
  $('#pm-field-key').style.display      = meta.hasKey      ? '' : 'none';
  $('#pm-field-endpoint').style.display = meta.hasEndpoint ? '' : 'none';
}

async function saveProvider() {
  const type     = $$('#pm-types .provider-pill').find(p => p.classList.contains('on'))?.dataset.provider || 'custom';
  const meta     = PROVIDER_META[type] || PROVIDER_META.custom;
  const name     = $('#pm-name').value.trim() || meta.label;
  const key      = $('#pm-key').value.trim();
  const endpoint = $('#pm-endpoint').value.trim();

  const provider = providerEditId
    ? { ...(PROVIDERS.find(x => x.id === providerEditId) || {}), type, name, key, endpoint }
    : { type, name, key, endpoint };

  const saved = await apiSaveProvider(provider);
  if (providerEditId) {
    const idx = PROVIDERS.findIndex(x => x.id === providerEditId);
    if (idx >= 0) PROVIDERS[idx] = saved; else PROVIDERS.push(saved);
  } else {
    PROVIDERS.push(saved);
  }
  closeProviderModal();
  renderProviders();
}

// ── Models ─────────────────────────────────────────────────────────────────

let MODELS = [];
let modelEditId = null;

async function fetchModels() {
  try { const r = await fetch('/api/models'); MODELS = await r.json(); } catch { MODELS = []; }
}
async function apiSaveModel(model) {
  const r = await fetch('/api/models', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(model) });
  return r.json();
}
async function apiDeleteModel(id) { await fetch(`/api/models/${id}`, { method: 'DELETE' }); }

function showOverview() {
  showView('view-overview');
  renderOverview();
}

function showAnalyze() {
  showView('view-analyze');
  renderAnalyze();
}

function renderAnalyze() {
  const project = PROJECTS.find(p => p.id === S.projectId);
  const hasModel = !!LEGION_CONFIG.defaultModelId;
  $('#analyze-no-model').style.display = hasModel ? 'none' : 'block';
  $('#btn-analyze-run').disabled = !hasModel || !project;
  $('#analyze-body').innerHTML = '';
}

let _analyzeController = null;

async function runAnalyze() {
  const project = PROJECTS.find(p => p.id === S.projectId);
  if (!project) return;

  const runBtn  = $('#btn-analyze-run');
  const stopBtn = $('#btn-analyze-stop');
  runBtn.disabled = true;
  runBtn.textContent = '✦ Analyzing…';
  if (stopBtn) stopBtn.style.display = 'inline-flex';

  const logEl = document.createElement('div');
  logEl.className = 'analyze-log';
  $('#analyze-body').innerHTML = '';
  $('#analyze-body').appendChild(logEl);

  const addLog = (msg, type = 'step') => {
    const line = document.createElement('div');
    line.className = `analyze-log-line analyze-log-${type}`;
    line.textContent = (type === 'step' ? '› ' : type === 'ok' ? '✓ ' : '✗ ') + msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  };

  _analyzeController = new AbortController();

  try {
    const res = await fetch(`/api/projects/${S.projectId}/analyze`, {
      method: 'POST', signal: _analyzeController.signal,
    });

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';
    let   result  = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'progress') addLog(ev.message, 'step');
          if (ev.type === 'error')    addLog(ev.message, 'err');
          if (ev.type === 'done')     result = ev.result;
        } catch {}
      }
    }

    if (!result) return;

    const agents    = result.agents    || [];
    const pipelines = result.pipelines || [];
    const newCount  = agents.filter(ag => !projectAgents().some(a => a.name.toLowerCase() === ag.name.toLowerCase())).length;
    addLog(`${agents.length} agents recommended (${newCount} new), ${pipelines.length} pipelines suggested`, 'ok');

    const existingNames = () => new Set(projectAgents().map(a => a.name.toLowerCase()));

    function agentCardHtml(ag, i) {
      const exists = existingNames().has(ag.name.toLowerCase());
      const tier   = ag.tier === 'mandatory' ? `<span class="analyze-tier mandatory">mandatory</span>` : `<span class="analyze-tier additional">additional</span>`;
      return `
        <div class="analyze-card" data-idx="${i}">
          <div class="analyze-card-head">
            <div class="analyze-card-name">${esc(ag.name)}</div>
            ${exists
              ? `<span class="analyze-exists">✓ exists</span>`
              : `<button class="btn-analyze-add" data-idx="${i}">+ Add</button>`}
          </div>
          <div class="analyze-card-meta">
            ${tier}
            ${ag.id ? `<span class="analyze-card-id">${esc(ag.id)}</span>` : ''}
          </div>
          <div class="analyze-card-reason">${esc(ag.reason)}</div>
        </div>`;
    }

    function pipeHtml(p, i) {
      return `
        <div class="analyze-pipe" data-idx="${i}">
          <div class="analyze-pipe-flow">
            <span class="analyze-pipe-agent">${esc(p.from)}</span>
            <span class="analyze-pipe-arrow">→</span>
            <span class="analyze-pipe-agent">${esc(p.to)}</span>
          </div>
          <div class="analyze-pipe-meta">
            <span class="pipe-badge pipe-badge-cond">${esc(p.condition)}</span>
            <span class="pipe-badge pipe-badge-mode">${esc(p.mode)}</span>
          </div>
          <div class="analyze-card-reason">${esc(p.reason)}</div>
          <button class="btn-analyze-pipe" data-idx="${i}">Apply</button>
        </div>`;
    }

    const half   = Math.ceil(agents.length / 2);
    const col1   = agents.slice(0, half);
    const col2   = agents.slice(half);

    const resultsEl = document.createElement('div');
    resultsEl.className = 'analyze-results';
    resultsEl.innerHTML = `
      ${result.analysis ? `<div class="analyze-summary">${esc(result.analysis)}</div>` : ''}
      <div class="analyze-stats-bar">
        <div class="analyze-stats-counts">
          <span class="analyze-stat"><strong>${agents.length}</strong> agents recommended</span>
          <span class="analyze-stat-sep">·</span>
          <span class="analyze-stat"><strong>${newCount}</strong> new</span>
          <span class="analyze-stat-sep">·</span>
          <span class="analyze-stat"><strong>${pipelines.length}</strong> pipelines</span>
        </div>
        ${newCount > 0 || pipelines.length > 0
          ? `<button class="btn-analyze-all" id="btn-add-apply-all">⚡ Add & Apply All</button>`
          : ''}
      </div>
      <div class="analyze-columns">
        <div class="analyze-col">
          ${col1.map((ag, i) => agentCardHtml(ag, i)).join('')}
        </div>
        <div class="analyze-col">
          ${col2.map((ag, i) => agentCardHtml(ag, i + half)).join('')}
        </div>
        <div class="analyze-col analyze-col-pipes">
          <div class="analyze-col-label">Pipelines</div>
          ${pipelines.length
            ? pipelines.map((p, i) => pipeHtml(p, i)).join('')
            : `<div class="analyze-empty">No pipelines suggested</div>`}
        </div>
      </div>`;
    $('#analyze-body').appendChild(resultsEl);

    async function addAgent(ag, btn) {
      if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
      const r = await fetch(`/api/projects/${S.projectId}/agents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ag.name, role: ag.reason, catalogId: ag.id || null, status: 'idle' }),
      });
      if (btn) btn.textContent = r.ok ? '✓ Added' : '✗ Failed';
      if (r.ok) { await loadProjectAgents(S.projectId); renderTree(); }
      else if (btn) btn.disabled = false;
      return r.ok;
    }

    async function applyPipe(p, btn) {
      if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }
      const fromAgent = projectAgents().find(a => a.name.toLowerCase() === p.from.toLowerCase());
      const toAgent   = projectAgents().find(a => a.name.toLowerCase() === p.to.toLowerCase());
      if (!fromAgent || !toAgent) { if (btn) btn.textContent = '✗ Not found'; return false; }
      await storePost(fromAgent.id, 'pipeline', { targetAgentId: toAgent.id, condition: p.condition, mode: p.mode, event: 'task_complete' });
      if (btn) btn.textContent = '✓ Applied';
      return true;
    }

    resultsEl.querySelectorAll('.btn-analyze-add').forEach(btn => {
      btn.addEventListener('click', () => addAgent(agents[+btn.dataset.idx], btn));
    });

    resultsEl.querySelectorAll('.btn-analyze-pipe').forEach(btn => {
      btn.addEventListener('click', () => applyPipe(pipelines[+btn.dataset.idx], btn));
    });

    const allBtn = resultsEl.querySelector('#btn-add-apply-all');
    if (allBtn) {
      allBtn.addEventListener('click', async () => {
        allBtn.disabled = true;
        allBtn.textContent = 'Adding agents…';
        const toAdd = agents.filter(ag => !projectAgents().some(a => a.name.toLowerCase() === ag.name.toLowerCase()));
        for (const ag of toAdd) {
          const cardBtn = resultsEl.querySelector(`.btn-analyze-add[data-idx="${agents.indexOf(ag)}"]`);
          await addAgent(ag, cardBtn);
        }
        allBtn.textContent = 'Applying pipelines…';
        for (const p of pipelines) {
          const pipeBtn = resultsEl.querySelector(`.btn-analyze-pipe[data-idx="${pipelines.indexOf(p)}"]`);
          await applyPipe(p, pipeBtn);
        }
        allBtn.textContent = '✓ Done';
      });
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      addLog('Analysis stopped', 'err');
    } else {
      addLog(err.message, 'err');
    }
  } finally {
    _analyzeController = null;
    runBtn.disabled = false;
    runBtn.textContent = '✦ Analyze';
    if (stopBtn) stopBtn.style.display = 'none';
  }
}

async function showSettings() {
  showView('view-settings');
  await Promise.all([fetchProviders(), fetchModels()]);
  renderGeneral();
  renderProviders();
  renderModels();
}

function renderGeneral() {
  const sel = $('#general-default-model');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select a model —</option>' +
    MODELS.map(m => {
      const prov = PROVIDERS.find(p => p.id === m.providerId);
      const label = prov ? `${prov.name} / ${m.name}` : m.name;
      const selected = LEGION_CONFIG.defaultModelId === m.id ? ' selected' : '';
      return `<option value="${esc(m.id)}"${selected}>${esc(label)}</option>`;
    }).join('');

  const saveBtn = $('#general-save');
  saveBtn.onclick = async () => {
    const modelId = sel.value;
    if (!modelId) {
      saveBtn.textContent = 'Select a model first';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const r = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultModelId: modelId }),
      });
      if (!r.ok) throw new Error(`Server error ${r.status}`);
      LEGION_CONFIG = await r.json();
      saveBtn.textContent = '✓ Saved';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
    } catch (e) {
      console.error('Config save failed:', e);
      saveBtn.textContent = '✗ Error';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 2000);
    } finally {
      saveBtn.disabled = false;
    }
  };
}

function hideSettings() {
  showDash();
}

function renderModels() {
  const list = $('#models-list');
  if (!MODELS.length) {
    list.innerHTML = `<div class="models-empty">
      <div class="models-empty-icon">⬡</div>
      <div>No models configured yet</div>
      <div style="margin-top:6px;font-size:11px;opacity:.6">Configure a provider first, then add models from it</div>
    </div>`;
    return;
  }
  list.innerHTML = MODELS.map(m => {
    const providerObj = PROVIDERS.find(p => p.id === m.providerId);
    const meta = PROVIDER_META[providerObj?.type] || PROVIDER_META.custom;
    return `
    <div class="model-row" data-id="${m.id}">
      <div class="model-provider-icon" style="background:${meta.color}18;color:${meta.color}">${meta.icon}</div>
      <div class="model-info">
        <div class="model-name">${esc(m.name)}</div>
        <div class="model-id">${esc(m.modelId)}</div>
      </div>
      <div class="model-notes">${esc(m.notes || '')}</div>
      <div class="model-key-badge set" style="opacity:.5">${esc(providerObj?.name || '—')}</div>
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
  $('#mm-name').value    = m?.name    || '';
  $('#mm-notes').value   = m?.notes   || '';

  // Populate provider select
  const sel = $('#mm-provider');
  sel.innerHTML = PROVIDERS.map(p => {
    const meta = PROVIDER_META[p.type] || PROVIDER_META.custom;
    return `<option value="${p.id}">${meta.icon} ${p.name}</option>`;
  }).join('');
  if (m?.providerId) sel.value = m.providerId;

  // Reset model select/input
  $('#mm-model-select').style.display = 'none';
  $('#mm-model-id').style.display = '';
  $('#mm-model-id').value = m?.modelId || '';
  $('#mm-fetch-status').textContent = '';

  $('#model-modal').classList.add('on');
}

function closeModelModal() {
  $('#model-modal').classList.remove('on');
  modelEditId = null;
}

async function fetchModelsForModal() {
  const providerId = $('#mm-provider').value;
  if (!providerId) return;
  const status = $('#mm-fetch-status');
  status.textContent = 'Loading…';
  $('#mm-fetch-btn').disabled = true;

  const result = await apiFetchRemoteModels(providerId);

  $('#mm-fetch-btn').disabled = false;
  if (result?.error) { status.textContent = '✗ ' + result.error; return; }
  if (!result?.length) { status.textContent = '✗ No models returned'; return; }

  status.textContent = `✓ ${result.length} models`;
  const sel = $('#mm-model-select');
  sel.innerHTML = result.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
  sel.style.display = '';
  $('#mm-model-id').style.display = 'none';

  sel.onchange = () => {
    const chosen = result.find(r => r.id === sel.value);
    if (chosen) $('#mm-name').value = chosen.name;
  };
  if (result[0]) $('#mm-name').value = result[0].name;
}

async function saveModel() {
  const providerId = $('#mm-provider').value;
  const name       = $('#mm-name').value.trim();
  const modelSel   = $('#mm-model-select');
  const modelId    = modelSel.style.display !== 'none'
    ? modelSel.value
    : $('#mm-model-id').value.trim();
  const notes      = $('#mm-notes').value.trim();

  if (!name || !modelId) {
    if (!name) $('#mm-name').focus(); else $('#mm-model-id').focus();
    return;
  }

  const model = modelEditId
    ? { ...(MODELS.find(x => x.id === modelEditId) || {}), providerId, name, modelId, notes }
    : { providerId, name, modelId, notes };

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

async function init() {
  await i18n.init();

  // Project dropdown
  $('#proj-btn').addEventListener('click', e => { e.stopPropagation(); S.dropOpen ? closeProj() : openProj(); });
  document.addEventListener('click', e => { if (!e.target.closest('.proj-wrap')) closeProj(); });
  $('#proj-search-input').addEventListener('input', e => renderProjList(e.target.value));

  // Language toggle
  $('#lang-toggle').addEventListener('click', () => {
    const newLang = i18n.lang === 'en' ? 'ru' : 'en';
    i18n.setLang(newLang);
    if (catalogLoaded) {
      renderCatalogFilters();
      renderCatalogGrid();
    }
    if (S.agentId) renderTab(S.tab);
  });

  // Add agent button in rail
  $('#btn-add-agent').addEventListener('click', e => {
    e.stopPropagation();
    closeProj();
    showCatalog();
  });

  // Catalog filters (delegated) + back + search
  initCatalogFilterListener();
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
  $('#m-browse').addEventListener('click', async () => {
    const btn = $('#m-browse');
    btn.disabled = true;
    try {
      const res = await fetch('/api/pick-folder');
      const { path } = await res.json();
      if (path) {
        $('#m-path').value = path;
        const folderName = path.split('/').filter(Boolean).pop() || path.split('\\').filter(Boolean).pop();
        if (folderName && !$('#m-name').value) {
          $('#m-name').value = folderName;
        }
      }
    } finally {
      btn.disabled = false;
    }
  });

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

  // Project items in rail (Overview)
  $$('.rail-proj-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.rail-proj-item').forEach(i => i.classList.remove('active'));
      $$('.rail-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      if (item.dataset.view === 'overview') showOverview();
      if (item.dataset.view === 'analyze')  showAnalyze();
    });
  });

  // Rail nav
  $$('.rail-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.rail-nav-item').forEach(i => i.classList.remove('active'));
      $$('.rail-proj-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      if (item.dataset.view === 'dash') {
        S.agentId = null; renderTree(); showDash();
      }
      if (item.dataset.view === 'settings') {
        showSettings();
      }
      if (item.dataset.view === 'home') {
        showView('view-home');
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
      if (tab.dataset.stab === 'general') renderGeneral();
    });
  });

  // Provider modal
  $('#btn-add-provider').addEventListener('click', () => openProviderModal());
  $$('#pm-types .provider-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const currentType = $$('#pm-types .provider-pill').find(p => p.classList.contains('on'))?.dataset.provider;
      const currentName = $('#pm-name').value;
      const wasDefault  = !currentName || currentName === (PROVIDER_META[currentType]?.label || '');
      $$('#pm-types .provider-pill').forEach(p => p.classList.remove('on'));
      pill.classList.add('on');
      updateProviderModalFields(pill.dataset.provider);
      if (wasDefault) $('#pm-name').value = PROVIDER_META[pill.dataset.provider]?.label || '';
    });
  });
  $('#pm-cancel').addEventListener('click', closeProviderModal);
  $('#pm-save').addEventListener('click', saveProvider);
  $('#provider-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeProviderModal(); });

  // Model modal
  $('#btn-add-model').addEventListener('click', () => openModelModal());
  $('#mm-fetch-btn').addEventListener('click', fetchModelsForModal);
  $('#mm-cancel').addEventListener('click', closeModelModal);
  $('#mm-save').addEventListener('click', saveModel);
  $('#model-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModelModal(); });
  $('#mm-name').addEventListener('keydown', e => { if (e.key === 'Enter') saveModel(); });

  // Analyze button
  $('#btn-analyze-run').addEventListener('click', runAnalyze);
  $('#btn-analyze-stop').addEventListener('click', () => { _analyzeController?.abort(); });

  LEGION_CONFIG = await fetch('/api/config').then(r => r.json()).catch(() => ({}));

  await loadProjects();
  renderProjBtn();
  renderTree();
  renderDash();
}

async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    PROJECTS = await res.json();
  } catch { PROJECTS = []; }
  if (PROJECTS.length) {
    S.projectId = PROJECTS[0].id;
    await loadProjectAgents(S.projectId);
    syncAddedIds();
  }
}

document.addEventListener('DOMContentLoaded', () => init());
