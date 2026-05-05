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
    // Keep PROJECTS count in sync
    const p = PROJECTS.find(x => x.id === projectId);
    if (p) p.agents = agents.length;
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
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => `
      <div class="proj-item ${p.id===S.projectId?'active':''}" data-id="${p.id}">
        <span class="proj-item-dot ${p.status||'ok'}"></span>
        <div class="proj-item-info">
          <span class="proj-item-name">${esc(p.name)}</span>
          ${p.path ? `<span class="proj-item-path">${esc(p.path)}</span>` : ''}
        </div>
        <span class="proj-item-count">${PROJECT_AGENTS[p.id]?.length ?? p.agents ?? 0} agents</span>
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

  // Update count badge in header
  const countEl = $('#rail-agents-count');
  if (countEl) countEl.textContent = agents.length ? `(${agents.length})` : '';

  if (agents.length === 0) {
    $('#agent-tree').innerHTML = `<div class="tree-empty">No agents yet — add from catalog</div>`;
    return;
  }

  $('#agent-tree').innerHTML = agents.map(a => `
    <div class="agent-row ${a.id===S.agentId?'active':''}" data-id="${a.id}">
      <span class="a-dot ${a.status||'idle'}"></span>
      <span class="a-name">${esc(a.name)}</span>
      ${(a.workers||0) > 0 ? `<span class="a-badge">${a.workers}w</span>` : ''}
    </div>`).join('');

  $$('.agent-row').forEach(el => el.addEventListener('click', () => selectAgent(el.dataset.id)));
}

function initAgentsHeaderToggle() {
  const header = $('#rail-agents-header');
  const tree   = $('#agent-tree');
  const caret  = $('#rail-agents-caret');
  if (!header || !tree) return;
  let collapsed = false;
  header.addEventListener('click', e => {
    if (e.target.id === 'btn-add-agent') return; // don't collapse on + click
    collapsed = !collapsed;
    tree.style.display = collapsed ? 'none' : '';
    caret.textContent  = collapsed ? '▸' : '▾';
  });
}

// ── Dashboard ──────────────────────────────────────────────────────────────

const VIEWS = ['view-dash', 'view-catalog', 'view-agent', 'view-settings', 'view-home', 'view-overview', 'view-analyze', 'view-tasks'];

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
  loadVisorBulletins();
  renderTeamMap();
}

async function loadVisorBulletins() {
  const el = $('#bull-feed');
  if (!el || !S.projectId) return;
  try {
    const r = await fetch(`/api/projects/${S.projectId}/visor`);
    if (!r.ok) throw new Error('fetch failed');
    const bulletins = await r.json();
    if (!bulletins.length) {
      el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:12px">No bulletins yet</div>`;
      return;
    }
    el.innerHTML = bulletins.slice(0, 8).map(b => {
      const hcls = b.health === 'healthy' ? 'healthy' : b.health === 'critical' ? 'critical' : 'degraded';
      const hIcon = b.health === 'healthy' ? '●' : b.health === 'critical' ? '⚠' : '◐';
      const agents = b.agentReports || [];
      return `
        <div class="bull-item">
          <div class="bull-head">
            <span class="bull-health ${hcls}">${hIcon} ${b.health}</span>
            <span class="bull-time">${relTime(b.timestamp)}</span>
          </div>
          <div class="bull-text">${esc(b.summary)}</div>
          ${agents.length ? `<div class="bull-agents">${agents.map(a =>
            `<span class="bull-agent-warn">${esc(a.emoji || '🤖')} ${esc(a.name)}: ${[
              a.staleWorkers  ? `${a.staleWorkers} stale`  : '',
              a.failedWorkers ? `${a.failedWorkers} failed` : '',
              a.stuckTasks    ? `${a.stuckTasks} stuck`    : '',
            ].filter(Boolean).join(', ')}</span>`
          ).join('')}</div>` : ''}
        </div>`;
    }).join('');
  } catch {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:12px">Could not load bulletins</div>`;
  }
}

async function renderTeamMap() {
  const el = $('#team-map');
  if (!el) return;
  el.innerHTML = `<div class="tm-empty">Loading…</div>`;

  try {
    const r = await fetch(`/api/projects/${S.projectId}/pipelines`);
    const { agents, connections } = await r.json();

    if (!connections.length) {
      el.innerHTML = `<div class="tm-empty">No pipeline connections yet. Add pipelines to agents to see the call hierarchy.</div>`;
      return;
    }

    const NODE_W = 162, NODE_H = 56, H_GAP = 108, V_GAP = 20, PAD = 28;
    const agentMap = Object.fromEntries(agents.map(a => [a.id, a]));

    // ── Level assignment (BFS) ────────────────────────────────────────────
    const connectedIds = new Set([...connections.map(c => c.from), ...connections.map(c => c.to)]);
    const outEdges = {}, inEdges = {}, inDeg = {};
    for (const id of connectedIds) { outEdges[id] = []; inEdges[id] = []; inDeg[id] = 0; }
    for (const c of connections) {
      outEdges[c.from].push(c.to);
      inEdges[c.to].push(c.from);
      inDeg[c.to]++;
    }
    const level = {};
    const bfsQ = [...connectedIds].filter(id => inDeg[id] === 0);
    if (!bfsQ.length) bfsQ.push([...connectedIds][0]);
    bfsQ.forEach(id => { level[id] = 0; });
    let qi = 0;
    while (qi < bfsQ.length) {
      const id = bfsQ[qi++];
      for (const to of outEdges[id]) {
        if (level[to] === undefined || level[to] <= level[id]) {
          level[to] = level[id] + 1;
          if (!bfsQ.includes(to)) bfsQ.push(to);
        }
      }
    }

    const byLevel = {};
    for (const id of connectedIds) {
      const l = level[id] ?? 0;
      (byLevel[l] = byLevel[l] || []).push(id);
    }

    // ── Barycenter crossing minimisation (3 forward + backward passes) ────
    const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
    const bary = (ids, srcIds, srcPos) => {
      return ids.map(id => {
        const nbrs = srcIds.filter(s => srcPos[s] !== undefined);
        const vals = nbrs.map(s => srcPos[s]);
        return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : 0;
      });
    };
    for (let pass = 0; pass < 3; pass++) {
      // Forward: sort by median of incoming neighbour positions in prev level
      for (let li = 1; li < levels.length; li++) {
        const l = levels[li], prevL = levels[li - 1];
        const prevPos = Object.fromEntries(byLevel[prevL].map((id, i) => [id, i]));
        byLevel[l].sort((a, b) => {
          const ma = inEdges[a].filter(s => level[s] === prevL);
          const mb = inEdges[b].filter(s => level[s] === prevL);
          const ra = ma.length ? ma.reduce((s, x) => s + (prevPos[x] ?? 0), 0) / ma.length : Infinity;
          const rb = mb.length ? mb.reduce((s, x) => s + (prevPos[x] ?? 0), 0) / mb.length : Infinity;
          return ra - rb;
        });
      }
      // Backward: sort by median of outgoing neighbour positions in next level
      for (let li = levels.length - 2; li >= 0; li--) {
        const l = levels[li], nextL = levels[li + 1];
        const nextPos = Object.fromEntries(byLevel[nextL].map((id, i) => [id, i]));
        byLevel[l].sort((a, b) => {
          const ma = outEdges[a].filter(t => level[t] === nextL);
          const mb = outEdges[b].filter(t => level[t] === nextL);
          const ra = ma.length ? ma.reduce((s, x) => s + (nextPos[x] ?? 0), 0) / ma.length : Infinity;
          const rb = mb.length ? mb.reduce((s, x) => s + (nextPos[x] ?? 0), 0) / mb.length : Infinity;
          return ra - rb;
        });
      }
    }

    // ── Node positions ────────────────────────────────────────────────────
    const numLevels = Math.max(...levels) + 1;
    const maxPerLvl = Math.max(...Object.values(byLevel).map(v => v.length));
    const totalH = PAD * 2 + maxPerLvl * NODE_H + (maxPerLvl - 1) * V_GAP;
    const totalW = PAD * 2 + numLevels * NODE_W + (numLevels - 1) * H_GAP;
    const pos = {};
    for (const [l, ids] of Object.entries(byLevel)) {
      const lNum = Number(l);
      const colH = ids.length * NODE_H + (ids.length - 1) * V_GAP;
      const startY = (totalH - colH) / 2;
      ids.forEach((id, i) => {
        pos[id] = { x: PAD + lNum * (NODE_W + H_GAP), y: startY + i * (NODE_H + V_GAP) };
      });
    }

    // ── Port spreading (each edge gets its own vertical slot on node edge) ─
    // Sort outgoing edges by target Y → assign ports top-to-bottom on right side
    // Sort incoming edges by source Y → assign ports top-to-bottom on left side
    const outPort = {}, inPort = {};    // connection index → y-offset from node centre
    const nodeOutIdx = {}, nodeInIdx = {};
    connections.forEach((c, i) => {
      (nodeOutIdx[c.from] = nodeOutIdx[c.from] || []).push(i);
      (nodeInIdx[c.to]    = nodeInIdx[c.to]    || []).push(i);
    });
    const assignPorts = (nodeIdxMap, getNeighbourY, portMap) => {
      for (const [nodeId, idxs] of Object.entries(nodeIdxMap)) {
        idxs.sort((a, b) => getNeighbourY(a) - getNeighbourY(b));
        const n = idxs.length;
        const step = n > 1 ? Math.min(13, (NODE_H - 14) / (n - 1)) : 0;
        const start = -step * (n - 1) / 2;
        idxs.forEach((ci, i) => { portMap[ci] = start + i * step; });
      }
    };
    assignPorts(nodeOutIdx, i => (pos[connections[i].to]?.y   ?? 0) + NODE_H / 2, outPort);
    assignPorts(nodeInIdx,  i => (pos[connections[i].from]?.y ?? 0) + NODE_H / 2, inPort);

    // ── SVG defs ──────────────────────────────────────────────────────────
    const EDGE_CLR = { on_success: '#4ade80', on_failure: '#f87171', always: '#94a3b8' };
    const ARR_IDS  = ['arr-success', 'arr-fail', 'arr-default'];
    const ARR_CLRS = ['#4ade80',    '#f87171',  '#94a3b8'];
    const defs = `<defs>
      ${ARR_IDS.map((id, i) => `
        <marker id="${id}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="${ARR_CLRS[i]}" opacity=".9"/>
        </marker>`).join('')}
    </defs>`;

    // ── Edges (orthogonal elbow routing) ─────────────────────────────────
    // Path: exit right from source port → midpoint column → enter left at target port
    // If y1 ≈ y2: straight line. Otherwise: right → corner → vertical → corner → right
    let edges = '';
    connections.forEach((c, i) => {
      const pf = pos[c.from], pt = pos[c.to];
      if (!pf || !pt) return;
      const x1 = pf.x + NODE_W, y1 = pf.y + NODE_H / 2 + (outPort[i] ?? 0);
      const x2 = pt.x,          y2 = pt.y + NODE_H / 2 + (inPort[i]  ?? 0);
      const cond = c.condition || 'always';
      const clr  = EDGE_CLR[cond] || EDGE_CLR.always;
      const arrId = cond === 'on_success' ? 'arr-success' : cond === 'on_failure' ? 'arr-fail' : 'arr-default';
      const lbl  = cond !== 'always' ? cond : '';

      const xm = (x1 + x2) / 2;
      const r  = 7;
      let d;
      if (Math.abs(y2 - y1) < 3) {
        d = `M${x1},${y1} H${x2}`;
      } else {
        const dir = y2 > y1 ? 1 : -1;
        d = `M${x1},${y1} H${xm - r} Q${xm},${y1} ${xm},${y1 + dir * r} V${y2 - dir * r} Q${xm},${y2} ${xm + r},${y2} H${x2}`;
      }
      const opacity = cond === 'always' ? '.45' : '.7';

      // Label: small pill badge at midpoint of vertical segment
      const lx = xm, ly = (y1 + y2) / 2;
      edges += `
        <path d="${d}" fill="none" stroke="${clr}" stroke-width="1.5" opacity="${opacity}" marker-end="url(#${arrId})"/>
        ${lbl ? `<rect x="${lx - 30}" y="${ly - 9}" width="60" height="16" rx="5" fill="${clr}" opacity=".12"/>
                 <text x="${lx}" y="${ly + 3.5}" text-anchor="middle" font-size="9" font-weight="600"
                   fill="${clr}" font-family="inherit" opacity=".9">${esc(lbl)}</text>` : ''}`;
    });

    // ── Nodes ─────────────────────────────────────────────────────────────
    let nodes = '';
    for (const id of connectedIds) {
      const { x, y } = pos[id];
      const a      = agentMap[id] || {};
      const color  = a.color || '#6366f1';
      const name   = (a.name || id).slice(0, 22);
      const group  = (a.group || '').slice(0, 18);
      const outDeg = (outEdges[id] || []).length;
      const inDg   = (inEdges[id]  || []).length;
      // Slightly thicker border for hub nodes (high connectivity)
      const sw     = (outDeg + inDg) >= 4 ? '2' : '1.5';
      const dot    = a.status === 'busy' ? `<circle cx="${x + NODE_W - 11}" cy="${y + 11}" r="4" fill="#22c55e"/>` : '';
      nodes += `
        <g class="tm-node" data-id="${esc(id)}" style="cursor:pointer" onclick="selectAgent('${esc(id)}')">
          <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="10"
            fill="${color}12" stroke="${color}" stroke-width="${sw}" stroke-opacity=".8"/>
          <text x="${x + NODE_W / 2}" y="${y + 24}" text-anchor="middle"
            font-size="12" font-weight="700" fill="${color}" font-family="inherit">${esc(name)}</text>
          <text x="${x + NODE_W / 2}" y="${y + 40}" text-anchor="middle"
            font-size="10" fill="#94a3b8" font-family="inherit">${esc(group)}</text>
          ${dot}
        </g>`;
    }

    el.innerHTML = `
      <svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}"
        style="max-width:100%;overflow:visible;display:block">
        ${defs}${edges}${nodes}
      </svg>`;

  } catch {
    el.innerHTML = `<div class="tm-empty">Could not load team map.</div>`;
  }
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
  if (tab==='skills')    renderSkills(agent);
  if (tab==='config') {
    if (!MODELS.length || !PROVIDERS.length) await Promise.all([fetchProviders(), fetchModels()]);
    renderConfig(agent);
  }
}

async function renderAgentOverview(a) {
  const lang   = i18n.lang;
  const locale = a.locales?.[lang] || a.locales?.en || a;
  const desc   = locale.description || a.description || '';
  const vibe   = locale.vibe || a.vibe || '';
  const caps   = a.capabilities || [];

  const el = $('#tab-overview');
  el.innerHTML = `<div class="ov-loading">${esc(i18n.t('ov_loading'))}</div>`;

  // Fetch all stores in parallel for live stats
  const pid = S.projectId;
  const aid = a.id;
  const fetchStore = async (store) => {
    try { const r = await fetch(`/api/projects/${pid}/agents/${aid}/${store}`); return r.ok ? await r.json() : []; }
    catch { return []; }
  };
  const [tasks, memories, channels, cron, pipeline] = await Promise.all([
    fetchStore('tasks'), fetchStore('memories'), fetchStore('channels'),
    fetchStore('cron'),  fetchStore('pipeline'),
  ]);

  // Check avatar
  const avatarUrl = `/api/projects/${pid}/agents/${aid}/avatar?t=${Date.now()}`;
  let hasAvatar = false;
  try { const r = await fetch(avatarUrl, { method: 'HEAD' }); hasAvatar = r.ok; } catch {}

  // ── Compute live stats ────────────────────────────────────────────────────
  const totalTasks    = tasks.length;
  const doneTasks     = tasks.filter(t => /done|completed|closed/i.test(t.status || '')).length;
  const failedTasks   = tasks.filter(t => /fail|rejected|blocked/i.test(t.status || '')).length;
  const inProgTasks   = tasks.filter(t => /progress|active|review/i.test(t.status || '')).length;

  const totalMems     = memories.length;
  const persistMems   = memories.filter(m => m.kind === 'persistent').length;
  const tempMems      = memories.filter(m => m.kind === 'temporary').length;
  const todoMems      = memories.filter(m => m.kind === 'todo').length;

  const activeCron    = cron.filter(c => c.enabled !== false).length;
  const pipeLinks     = pipeline.length;
  const chCount       = channels.length;

  function stat(val) { return Math.min(100, Math.round(Math.max(0, val))); }

  const T = k => i18n.t(k);
  const STATS = [
    {
      key: 'throughput',
      label: T('stat_valor_label'),
      icon: '⚔️',
      formula: T('stat_valor_formula'),
      desc: T('stat_valor_desc'),
      value: stat(totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0),
      color: '#22c55e',
    },
    {
      key: 'autonomy',
      label: T('stat_sorcery_label'),
      icon: '🔮',
      formula: T('stat_sorcery_formula'),
      desc: T('stat_sorcery_desc'),
      value: stat(activeCron * 20),
      color: '#8b5cf6',
    },
    {
      key: 'reach',
      label: T('stat_dominion_label'),
      icon: '🌐',
      formula: T('stat_dominion_formula'),
      desc: T('stat_dominion_desc'),
      value: stat((chCount * 12) + (pipeLinks * 15)),
      color: '#3b82f6',
    },
    {
      key: 'knowledge',
      label: T('stat_lore_label'),
      icon: '📜',
      formula: T('stat_lore_formula'),
      desc: T('stat_lore_desc'),
      value: stat(persistMems * 12),
      color: '#f59e0b',
    },
    {
      key: 'focus',
      label: T('stat_discipline_label'),
      icon: '🎯',
      formula: T('stat_discipline_formula'),
      desc: T('stat_discipline_desc'),
      value: stat(totalMems > 0 ? (persistMems / totalMems) * 100 : 0),
      color: '#06b6d4',
    },
    {
      key: 'soul',
      label: T('stat_soul_label'),
      icon: '✦',
      formula: T('stat_soul_formula'),
      desc: T('stat_soul_desc'),
      value: stat((todoMems + inProgTasks + failedTasks + tempMems) / Math.max(totalTasks + totalMems, 1) * 150),
      color: '#ef4444',
    },
  ];

  function statRow(s, last) {
    const pct = s.value;
    const glow = s.key === 'soul' && pct > 60 ? 'ov-stat-glow' : '';
    return `
      <div class="ov-stat-row ${glow}${last ? ' ov-stat-last' : ''}">
        <span class="ov-stat-icon">${s.icon}</span>
        <span class="ov-stat-name">${s.label}</span>
        <div class="ov-stat-bar-wrap">
          <div class="ov-stat-track">
            <div class="ov-stat-fill" style="width:${pct}%;background:${s.color}"></div>
          </div>
        </div>
        <span class="ov-stat-num" style="color:${s.color}">${pct}</span>
        <span class="ov-stat-info" data-tip="${esc(s.formula)}">ⓘ</span>
      </div>`;
  }

  el.innerHTML = `
    <div class="ov-layout">

      <!-- LEFT: character card -->
      <div class="ov-char">
        <div class="ov-char-frame" id="ov-avatar-wrap">
          <img class="ov-char-img" src="${hasAvatar ? avatarUrl : '/assets/characters/default.png'}" alt="avatar">
          <div class="ov-char-overlay">📷</div>
        </div>
        <input type="file" id="ov-avatar-input" accept="image/*" class="ov-file-hidden">
        <div class="ov-char-name">${esc(a.name)}</div>
        ${vibe ? `<div class="ov-char-vibe">"${esc(vibe)}"</div>` : ''}
        <div class="ov-char-meta">
          <div class="ov-char-meta-row">${esc(a.id)}</div>
          ${a.model ? `<div class="ov-char-meta-row">${esc(a.model)}</div>` : ''}
        </div>
        <button class="btn-danger btn-danger-sm" id="ov-remove-agent">${esc(i18n.t('ov_remove_btn'))}</button>
      </div>

      <!-- RIGHT: info panel -->
      <div class="ov-panel">

        <div class="ov-stats-label">${esc(i18n.t('ov_stats_label'))}</div>
        <div class="ov-stats">
          ${STATS.map((s, i) => statRow(s, i === STATS.length - 1)).join('')}
        </div>

        ${desc || caps.length ? `
        <div class="ov-about">
          ${desc ? `<div class="ov-about-desc">${esc(desc)}</div>` : ''}
          ${caps.length ? `<div class="ov-caps cap-list">${caps.map(c => `<span class="cap">${esc(c)}</span>`).join('')}</div>` : ''}
        </div>` : ''}
      </div>

    </div>`;

  // Avatar upload
  const wrap  = $('#ov-avatar-wrap');
  const input = $('#ov-avatar-input');
  wrap.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    wrap.style.opacity = '0.5';
    await fetch(`/api/projects/${pid}/agents/${aid}/avatar`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    wrap.style.opacity = '';
    renderAgentOverview(a);
  });

  $('#ov-remove-agent').addEventListener('click', async () => {
    if (!confirm(`Remove "${a.name}" from this project?`)) return;
    await apiRemoveAgent(S.projectId, a.id);
    if (PROJECT_AGENTS[S.projectId]) {
      PROJECT_AGENTS[S.projectId] = PROJECT_AGENTS[S.projectId].filter(x => x.id !== a.id);
      const p = PROJECTS.find(x => x.id === S.projectId);
      if (p) p.agents = PROJECT_AGENTS[S.projectId].length;
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
              <div class="kanban-card" data-id="${t.id}" data-aid="${aid}">
                <div class="kanban-card-top">
                  <span class="kanban-id">#${t.id.slice(0,6)}</span>
                  <button class="kanban-decompose" data-id="${t.id}" data-aid="${aid}" data-title="${esc(t.title||'')}" title="Decompose with Swarm">⚡</button>
                  <button class="kanban-del" data-id="${t.id}">✕</button>
                </div>
                <div class="kanban-title">${esc(t.title || 'Untitled')}</div>
                ${t.description ? `<div class="kanban-desc">${esc(t.description)}</div>` : ''}
                <div class="kanban-footer">
                  <span class="kanban-priority ${esc(t.priority||'')}">${esc(t.priority||'')}</span>
                  ${t.swarmChildCount ? `<span class="kanban-swarm">↳ ${t.swarmChildCount} subtasks</span>` : ''}
                  <span class="kanban-time">${relTime(t.updatedAt||t.createdAt)}</span>
                </div>
              </div>`).join('')}
          </div>`).join('')}
      </div>`;

    el.addEventListener('click', async e => {
      const del = e.target.closest('.kanban-del');
      if (del) { await storeDel(aid, 'tasks', del.dataset.id); renderTasks(a); return; }
      const dec = e.target.closest('.kanban-decompose');
      if (dec) { openDecomposeModal(dec.dataset.aid, dec.dataset.id, dec.dataset.title); }
    }, { once: true });
  }

  $('#task-add') && $('#task-add').addEventListener('click', () => openTaskModal(a));

  // Append Linear section if enabled for this agent
  const integ = _integCache || {};
  if (a.linearEnabled && integ.linear?.apiKey) {
    appendLinearSection(el, a, integ);
  }
}

async function appendLinearSection(el, a, integ) {
  const labelName = a.linearLabelName || a.name;
  const section   = document.createElement('div');
  section.className = 'agent-linear-section';
  section.innerHTML = `
    <div class="agent-linear-header">
      <span class="linear-badge">Linear</span>
      <span class="agent-linear-title">Issues tagged "${esc(labelName)}"</span>
      <span class="agent-linear-count" id="alin-count"></span>
    </div>
    <div class="agent-linear-body" id="alin-body">
      <div class="tab-loading">Loading…</div>
    </div>`;
  el.appendChild(section);

  try {
    const params = new URLSearchParams({ labelName, limit: '50' });
    if (integ.linear.defaultTeamId) params.set('teamId', integ.linear.defaultTeamId);
    const r = await fetch(`/api/projects/${S.projectId}/linear/issues?${params}`);
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || `HTTP ${r.status}`); }
    const issues  = await r.json();
    const bodyEl  = section.querySelector('#alin-body');
    const countEl = section.querySelector('#alin-count');
    if (countEl) countEl.textContent = issues.length;

    if (!issues.length) {
      bodyEl.innerHTML = `<div class="agent-linear-empty">No issues with label "${esc(labelName)}"</div>`;
      return;
    }

    const STATE_CLR = { completed: '#4ade80', cancelled: '#6b7280', started: '#22d3ee', inProgress: '#22d3ee' };
    bodyEl.innerHTML = issues.map(issue => `
      <div class="agent-linear-row">
        <span class="agent-linear-dot" style="background:${esc(issue.state?.color || '#888')}"></span>
        <span class="tasks-row-id">${esc(issue.identifier || '')}</span>
        <span class="agent-linear-row-title">${esc(issue.title || 'Untitled')}</span>
        ${issue.priorityLabel ? `<span class="tasks-row-pri">${esc(issue.priorityLabel)}</span>` : ''}
        ${issue.url ? `<a class="agent-linear-link" href="${esc(issue.url)}" target="_blank" rel="noopener">↗</a>` : ''}
      </div>`).join('');
  } catch (e) {
    const bodyEl = section.querySelector('#alin-body');
    if (bodyEl) bodyEl.innerHTML = `<div class="tasks-error">Error: ${esc(e.message)}</div>`;
  }
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

// ── Swarm Decomposition ────────────────────────────────────────────────────

function closeSwarmModal() {
  const el = $('#swarm-modal-overlay');
  if (el) el.remove();
}

function openDecomposeModal(agentId, taskId, taskTitle) {
  closeSwarmModal();
  const el = document.createElement('div');
  el.className = 'overlay on';
  el.id = 'swarm-modal-overlay';
  el.innerHTML = `
    <div class="modal swarm-modal">
      <div class="modal-title">⚡ Decompose Task</div>
      <div class="swarm-task-title">"${esc(taskTitle || taskId)}"</div>
      <div class="swarm-log" id="swarm-log"></div>
      <div class="swarm-result" id="swarm-result"></div>
      <div class="modal-actions">
        <button class="btn-cancel" id="swarm-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) closeSwarmModal(); });
  $('#swarm-close').addEventListener('click', closeSwarmModal);

  const log = $('#swarm-log');
  let lastStep = null;
  function addLog(msg, type = 'step') {
    if (type === 'step' && lastStep) lastStep.classList.add('swarm-log-done');
    const line = document.createElement('div');
    line.className = `swarm-log-row swarm-log-${type}`;
    const icon = type === 'step' ? '›' : type === 'ok' ? '✓' : '✗';
    line.innerHTML = `<span class="swarm-log-icon">${icon}</span><span>${esc(msg)}</span>`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    if (type === 'step') lastStep = line;
    else if (lastStep) { lastStep.classList.add('swarm-log-done'); lastStep = null; }
  }

  (async () => {
    try {
      const res = await fetch(`/api/projects/${S.projectId}/agents/${agentId}/tasks/${taskId}/decompose`, { method: 'POST' });
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
      addLog(`${result.subtasks.length} subtasks created`, 'ok');

      const resultEl = $('#swarm-result');
      if (resultEl) {
        resultEl.innerHTML = `
          ${result.analysis ? `<div class="swarm-analysis">${esc(result.analysis)}</div>` : ''}
          <div class="swarm-subtasks">
            ${result.subtasks.map((s, i) => `
              <div class="swarm-subtask">
                <span class="swarm-order">${i + 1}</span>
                <span class="swarm-mode-badge ${esc(s.swarmMode || 'sequential')}">${(s.swarmMode || 'seq').slice(0,3)}</span>
                <div class="swarm-subtask-info">
                  <div class="swarm-subtask-title">${esc(s.title)}</div>
                  <div class="swarm-subtask-agent">→ ${esc(s.agentName || s.agentId)}</div>
                </div>
              </div>`).join('')}
          </div>`;
      }

      const closeBtn = $('#swarm-close');
      if (closeBtn) closeBtn.textContent = 'Done';

      const agent = AGENT_REGISTRY[agentId];
      if (agent) setTimeout(() => renderTasks(agent), 300);
    } catch (err) {
      addLog('Error: ' + err.message, 'err');
    }
  })();
}

// ── Memories ───────────────────────────────────────────────────────────────

const MEM_KINDS = ['all','persistent','temporary','todo'];
const MEM_KIND_LABEL = { rule: 'Rule', persistent: 'Persistent', temporary: 'Temporary', todo: 'Todo' };

async function syncMemoryFile(agentId, memories) {
  const sections = { rule: [], persistent: [], temporary: [], todo: [] };
  for (const m of memories) {
    const k = m.kind || 'persistent';
    (sections[k] || sections.persistent).push(m);
  }
  const lines = ['# Memory\n'];
  if (sections.rule.length) {
    lines.push('## Startup Instructions');
    sections.rule.forEach(m => lines.push(`- ${m.note || m.text || ''}`));
    lines.push('');
  }
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
  if (/startup|instruction|rule|always|before/i.test(h)) return 'rule';
  if (/todo|task|action/i.test(h))                       return 'todo';
  if (/temp|short|session|thread|open/i.test(h))         return 'temporary';
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
    const rules   = all.filter(m => m.kind === 'rule');
    const nonRule = filter === 'all'
      ? all.filter(m => m.kind !== 'rule')
      : all.filter(m => m.kind === filter);

    el.innerHTML = desc + `
      <div class="mem-rules-section">
        <div class="mem-rules-header">
          <span class="mem-rules-icon">⚡</span>
          <span class="mem-rules-title">Startup Rules</span>
          <span class="mem-rules-hint">Agent reads these before every session</span>
        </div>
        ${rules.length ? `<div class="mem-rules-list">${rules.map(m => `
          <div class="mem-rule-card" data-id="${m.id}">
            <span class="mem-rule-text">${esc(m.note || m.text || '')}</span>
            <button class="mem-del mem-rule-del" data-id="${esc(m.id)}">✕</button>
          </div>`).join('')}</div>` : `
          <div class="mem-rules-empty">No startup rules yet.</div>`}
        <div class="mem-rule-add-row">
          <input class="mem-rule-input" id="mem-rule-input"
            placeholder="e.g. Always read /docs/architecture.md before starting" />
          <button class="mem-rule-add-btn" id="mem-rule-add">+ Add</button>
        </div>
      </div>

      <div class="store-toolbar">
        <div class="mem-filters">
          ${MEM_KINDS.map(k => `<button class="mem-filter${k===filter?' on':''}" data-kind="${k}">${k==='all'?'All':MEM_KIND_LABEL[k]||k}</button>`).join('')}
        </div>
        <button class="btn-tab-add" id="mem-add">+ Add</button>
      </div>
      ${!nonRule.length ? `<div class="tab-empty"><div class="tab-empty-icon">◎</div><div class="tab-empty-text">No memories yet</div></div>` : `
      <div class="mem-list">
        ${nonRule.map(m => `
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

    const ruleInput = $('#mem-rule-input');
    const ruleBtn   = $('#mem-rule-add');

    async function addRule() {
      const note = ruleInput?.value.trim();
      if (!note) return;
      ruleInput.value = '';
      ruleInput.disabled = true;
      if (ruleBtn) ruleBtn.disabled = true;
      const item = await storePost(aid, 'memories', { note, kind: 'rule', importance: 1 });
      all.push(item);
      await syncMemoryFile(aid, all);
      ruleInput.disabled = false;
      if (ruleBtn) ruleBtn.disabled = false;
      paint();
      $('#mem-rule-input')?.focus();
    }

    ruleInput?.addEventListener('keydown', e => { if (e.key === 'Enter') addRule(); });
    ruleBtn?.addEventListener('click', addRule);
  }

  paint();
}

function openMemoryModal(a, onDone) {
  const aid = a?.id || S.agentId;
  showMiniModal({
    title: 'Add Memory',
    fields: [
      { id: 'mem-m-note', label: 'Note', placeholder: 'What to remember…' },
      { id: 'mem-m-kind', label: 'Kind', type: 'select', options: ['persistent','temporary','todo','rule'] },
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
  const ac = a.color || '#6366F1';
  $('#tab-chat').innerHTML = tabDescHtml('chat') + `
    <div class="chat-wrap">
      <div class="chat-msgs" id="chat-msgs">
        <div class="msg agent" id="chat-intro-msg">
          <div class="msg-ava" style="background:${ac}18;color:${ac};border:1px solid ${ac}30">${initials(a.name)}</div>
          <div class="msg-bub" style="color:var(--text-3);font-style:italic">…</div>
        </div>
      </div>
      <div class="chat-foot">
        <textarea class="chat-in" id="chat-in" rows="1" placeholder="Send a message…"></textarea>
        <button class="chat-btn" id="chat-send">Send</button>
      </div>
    </div>`;

  fetch(`/api/projects/${S.projectId}/agents/${a.id}/chat/intro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang: i18n.lang }),
  })
    .then(r => r.json())
    .then(d => {
      const introEl = document.getElementById('chat-intro-msg');
      if (!introEl) return;
      const bub = introEl.querySelector('.msg-bub');
      if (d.intro) {
        bub.textContent = d.intro;
        bub.style.cssText = '';
      } else {
        bub.textContent = d.error || 'Failed to load introduction';
        bub.style.color = '#ef4444';
        bub.style.fontStyle = 'italic';
      }
    })
    .catch(err => {
      const introEl = document.getElementById('chat-intro-msg');
      if (introEl) {
        const bub = introEl.querySelector('.msg-bub');
        bub.textContent = `Error: ${err.message}`;
        bub.style.color = '#ef4444';
        bub.style.fontStyle = 'italic';
      }
    });

  const input = $('#chat-in'), btn = $('#chat-send'), msgs = $('#chat-msgs');

  async function send() {
    const text = input.value.trim();
    if (!text || btn.disabled) return;
    msgs.insertAdjacentHTML('beforeend', `
      <div class="msg you">
        <div class="msg-ava" style="background:var(--text);color:var(--bg-card)">YU</div>
        <div class="msg-bub">${esc(text)}</div>
      </div>`);
    input.value = '';
    msgs.scrollTop = msgs.scrollHeight;

    const thinkingId = `thinking-${Date.now()}`;
    msgs.insertAdjacentHTML('beforeend', `
      <div class="msg agent" id="${thinkingId}">
        <div class="msg-ava" style="background:${ac}18;color:${ac};border:1px solid ${ac}30">${initials(a.name)}</div>
        <div class="msg-bub" style="color:var(--text-3);font-style:italic">Thinking…</div>
      </div>`);
    msgs.scrollTop = msgs.scrollHeight;
    btn.disabled = true;

    try {
      const r = await fetch(`/api/projects/${S.projectId}/agents/${a.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, lang: i18n.lang }),
      });
      const d = await r.json();
      const el = document.getElementById(thinkingId);
      if (el) {
        const bub = el.querySelector('.msg-bub');
        if (d.reply) {
          bub.textContent = d.reply;
          bub.style.cssText = '';
        } else {
          bub.textContent = d.error || 'No response';
          bub.style.color = '#ef4444';
          bub.style.fontStyle = 'italic';
        }
      }
    } catch (err) {
      const el = document.getElementById(thinkingId);
      if (el) {
        const bub = el.querySelector('.msg-bub');
        bub.textContent = `Error: ${err.message}`;
        bub.style.color = '#ef4444';
        bub.style.fontStyle = 'italic';
      }
    } finally {
      btn.disabled = false;
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  btn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}

async function renderSkills(a) {
  const el = $('#tab-skills');
  if (!el) return;

  const SOURCE_LABELS = { skillsh: 'skills.sh', github: 'GitHub', smithery: 'Smithery' };
  const SOURCE_COLORS = { skillsh: '#6366f1', github: '#374151', smithery: '#0ea5e9' };
  const TYPE_ICONS    = { skill: '⚡', mcp: '🔌' };

  el.innerHTML = `
    ${tabDescHtml('skills')}
    <div class="sk-section-header" id="sk-head-installed">
      <span class="sk-section-caret">▾</span>
      <span>${i18n.t('sk_installed_label')}</span>
    </div>
    <div id="sk-installed">${i18n.t('sk_loading')}</div>
    <div class="sk-section-header sk-section-header-mt sk-collapsed" id="sk-head-available">
      <span class="sk-section-caret">▸</span>
      <span>${i18n.t('sk_available_label')}</span>
    </div>
    <div id="sk-available" style="display:none"></div>
    <div class="sk-section-header sk-section-header-mt" id="sk-head-suggest">
      <span class="sk-section-caret">▾</span>
      <span>${i18n.t('sk_suggest_label')}</span>
      <button class="sk-suggest-btn" id="sk-suggest">✦ ${i18n.t('sk_suggest')}</button>
    </div>
    <div id="sk-log" class="sk-log" style="display:none"></div>
    <div id="sk-results"></div>`;

  async function loadSkillsState() {
    const [installedRes, availableRes] = await Promise.all([
      fetch(`/api/projects/${S.projectId}/skills`),
      fetch(`/api/skills/available`),
    ]);
    return {
      installed: await installedRes.json(),
      available: await availableRes.json(),
    };
  }

  async function refreshSkillLists() {
    const installedEl = $('#sk-installed');
    const availableEl = $('#sk-available');
    try {
      const [agentSkillsRes, globalSkillsRes] = await Promise.all([
        fetch(`/api/projects/${S.projectId}/agents/${a.id}/skills`),
        fetch(`/api/skills/available`),
      ]);
      const agentSkills = await agentSkillsRes.json();  // ["skill-id", ...]
      const available   = await globalSkillsRes.json(); // [{id, description}, ...]
      if (!Array.isArray(agentSkills) || !Array.isArray(available))
        throw new Error(agentSkills.error || available.error || 'Invalid response');

      const descMap     = Object.fromEntries(available.map(s => [s.id, s.description]));
      const agentSkillSet = new Set(agentSkills);

      // Installed: skills assigned to THIS agent
      if (!installedEl) return;
      if (!agentSkills.length) {
        installedEl.innerHTML = `<div class="sk-empty">${i18n.t('sk_no_installed')}</div>`;
      } else {
        installedEl.innerHTML = `<div class="sk-pill-list">${agentSkills.map(id => `
          <div class="sk-pill">
            <span class="sk-pill-name">⚡ ${esc(id)}</span>
            ${descMap[id] ? `<span class="sk-avail-desc">${esc(descMap[id])}</span>` : ''}
            <button class="sk-pill-remove" data-skill="${esc(id)}">✕</button>
          </div>`).join('')}</div>`;
        installedEl.querySelectorAll('.sk-pill-remove').forEach(btn => {
          btn.addEventListener('click', async () => {
            btn.textContent = '…';
            await fetch(`/api/projects/${S.projectId}/agents/${a.id}/skills/${btn.dataset.skill}`, { method: 'DELETE' });
            refreshSkillLists();
          });
        });
      }

      // Available: user skills NOT yet assigned to this agent — card layout
      if (!availableEl) return;
      const notAssigned = available.filter(s => !agentSkillSet.has(s.id));
      if (!notAssigned.length) {
        availableEl.innerHTML = `<div class="sk-empty">${i18n.t('sk_no_available')}</div>`;
      } else {
        availableEl.innerHTML = `<div class="sk-list">${notAssigned.map(s =>
          `<div class="sk-card">
            <div class="sk-card-head">
              <span class="sk-type-icon">⚡</span>
              <span class="sk-card-name">${esc(s.id)}</span>
            </div>
            ${s.description ? `<div class="sk-card-reason">${esc(s.description)}</div>` : ''}
            <div class="sk-card-foot">
              <button class="sk-avail-add" data-skill="${esc(s.id)}">${i18n.t('sk_add')}</button>
            </div>
          </div>`).join('')}</div>`;
        availableEl.querySelectorAll('.sk-avail-add').forEach(btn => {
          btn.addEventListener('click', async () => {
            btn.textContent = '…'; btn.disabled = true;
            await fetch(`/api/projects/${S.projectId}/agents/${a.id}/skills/${btn.dataset.skill}`, { method: 'POST' });
            refreshSkillLists();
          });
        });
      }
    } catch (err) {
      console.error('[skills]', err);
      if (installedEl) installedEl.innerHTML = `<div class="sk-empty">⚠ ${esc(err.message)}</div>`;
      if (availableEl) availableEl.innerHTML = '';
    }
  }

  refreshSkillLists();

  // Section toggle logic
  function setupSkToggle(headId, contentId, startCollapsed) {
    const head    = $(`#${headId}`);
    const content = $(`#${contentId}`);
    if (!head || !content) return;
    let collapsed = startCollapsed;
    head.addEventListener('click', e => {
      if (e.target.closest('.sk-suggest-btn')) return;
      collapsed = !collapsed;
      content.style.display = collapsed ? 'none' : '';
      head.querySelector('.sk-section-caret').textContent = collapsed ? '▸' : '▾';
      head.classList.toggle('sk-collapsed', collapsed);
    });
  }
  setupSkToggle('sk-head-installed', 'sk-installed', false);
  setupSkToggle('sk-head-available', 'sk-available', true);

  let es = null;

  $('#sk-suggest').addEventListener('click', () => {
    const btn = $('#sk-suggest');
    if (es) { es.close(); es = null; btn.textContent = `✦ ${i18n.t('sk_suggest')}`; return; }

    const log = $('#sk-log');
    const results = $('#sk-results');
    log.style.display = 'block';
    log.innerHTML = '';
    results.innerHTML = '';
    btn.textContent = i18n.t('sk_suggesting');

    es = new EventSource(`/api/projects/${S.projectId}/agents/${a.id}/suggest-skills`);

    es.onmessage = (e) => {
      const d = JSON.parse(e.data);

      if (d.type === 'progress') {
        const row = document.createElement('div');
        row.className = 'sk-log-row';
        row.textContent = '→ ' + d.message;
        log.appendChild(row);
        log.scrollTop = log.scrollHeight;
      }

      if (d.type === 'done') {
        es.close(); es = null;
        btn.textContent = `✦ ${i18n.t('sk_suggest')}`;
        const r = d.result;
        if (!r?.skills?.length) { results.innerHTML = `<div class="sk-empty">${i18n.t('sk_no_results')}</div>`; return; }

        results.innerHTML = `
          ${r.summary ? `<div class="sk-summary">${esc(r.summary)}</div>` : ''}
          <div class="sk-results-head">
            <span class="sk-results-count">${r.skills.length} ${r.skills.length === 1 ? 'skill' : 'skills'} recommended</span>
            <button class="sk-assign-all-btn" id="sk-assign-all">${i18n.t('sk_assign_all')}</button>
          </div>
          <div class="sk-list">
            ${r.skills.map(s => `
              <div class="sk-card">
                <div class="sk-card-head">
                  <span class="sk-type-icon">${TYPE_ICONS[s.type] || '⚡'}</span>
                  <span class="sk-card-name">${esc(s.name)}</span>
                  <span class="sk-source-badge" style="background:${SOURCE_COLORS[s.source] || '#6b7280'}20;color:${SOURCE_COLORS[s.source] || '#6b7280'};border-color:${SOURCE_COLORS[s.source] || '#6b7280'}40">
                    ${esc(SOURCE_LABELS[s.source] || s.source)}
                  </span>
                </div>
                <div class="sk-card-reason">${esc(s.reason)}</div>
                <div class="sk-card-foot">
                  ${s.install ? `<code class="sk-install">${esc(s.install)}</code>` : ''}
                  ${s.url ? `<a class="sk-link" href="${esc(s.url)}" target="_blank">↗ Open</a>` : ''}
                  <button class="sk-avail-add sk-card-assign" data-skill="${esc(s.name)}">${i18n.t('sk_assign')}</button>
                </div>
              </div>`).join('')}
          </div>`;

        // Individual assign buttons
        results.querySelectorAll('.sk-card-assign').forEach(assignBtn => {
          assignBtn.addEventListener('click', async () => {
            assignBtn.textContent = '…'; assignBtn.disabled = true;
            const res = await fetch(`/api/projects/${S.projectId}/agents/${a.id}/skills/${assignBtn.dataset.skill}`, { method: 'POST' });
            if (res.ok) { assignBtn.textContent = '✓'; refreshSkillLists(); }
            else { assignBtn.textContent = '✗'; assignBtn.disabled = false; }
          });
        });

        // Assign All button
        $('#sk-assign-all').addEventListener('click', async () => {
          const allBtn = $('#sk-assign-all');
          allBtn.textContent = '…'; allBtn.disabled = true;
          results.querySelectorAll('.sk-card-assign').forEach(b => { b.disabled = true; });
          await Promise.all(r.skills.map(s =>
            fetch(`/api/projects/${S.projectId}/agents/${a.id}/skills/${s.name}`, { method: 'POST' })
          ));
          results.querySelectorAll('.sk-card-assign').forEach(b => { b.textContent = '✓'; });
          allBtn.textContent = i18n.t('sk_all_assigned');
          refreshSkillLists();
        });
      }

      if (d.type === 'error') {
        es.close(); es = null;
        btn.textContent = `✦ ${i18n.t('sk_suggest')}`;
        log.innerHTML += `<div class="sk-log-row sk-log-err">✗ ${esc(d.message)}</div>`;
      }
    };

    es.onerror = () => {
      es.close(); es = null;
      btn.textContent = `✦ ${i18n.t('sk_suggest')}`;
    };
  });
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

  const DOC_DESCS = {
    'AGENTS.md':   'cfg_file_agents',
    'IDENTITY.md': 'cfg_file_identity',
    'SOUL.md':     'cfg_file_soul',
    'USER.md':     'cfg_file_user',
    'MEMORY.md':   'cfg_file_memory',
    'CONTEXT.md':  'cfg_file_context',
    'SKILLS.md':   'cfg_file_skills',
    'PIPELINE.md': 'cfg_file_pipeline',
  };

  el.innerHTML = tabDescHtml('config') + `
    <div class="cfg-section">
      <div class="cfg-section-label">Model</div>
      <div class="cfg-model-row">
        <select class="field-input cfg-model-select" id="cfg-model-sel">
          <option value="">— Default —</option>
          ${modelOptions}
        </select>
        <button class="btn-cfg-save" id="cfg-model-save">Save</button>
        ${hasPath ? `<button class="btn-cfg-activate" id="cfg-model-activate" title="Write this model to .claude/settings.json so Claude Code uses it">⚡ Activate in Claude Code</button>` : ''}
      </div>
      ${!MODELS.length ? `<div class="cfg-hint">Add models in Settings → Models first</div>` : ''}
      ${hasPath ? `<div class="cfg-hint" id="cfg-activate-status"></div>` : ''}
    </div>

    <div class="cfg-section">
      <div class="cfg-section-label">Task Source</div>
      <div class="cfg-task-source-row">
        <label class="cfg-toggle-label">
          <input type="checkbox" id="cfg-linear-toggle" ${a.linearEnabled ? 'checked' : ''} />
          <span>Use Linear as task source</span>
        </label>
      </div>
      <div id="cfg-linear-fields" ${!a.linearEnabled ? 'style="display:none"' : ''}>
        <div class="cfg-linear-team-row">
          <input class="field-input" id="cfg-linear-label-name" type="text"
            value="${esc(a.linearLabelName || a.name || '')}" placeholder="Label name in Linear (default = agent name)" />
        </div>
        <div class="cfg-linear-team-row">
          <input class="field-input" id="cfg-linear-team-id" type="text"
            value="${esc(a.linearTeamId || '')}" placeholder="Team ID (leave empty for project default)" />
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:4px">
          <button class="btn-cfg-save" id="cfg-linear-save">Save</button>
        </div>
      </div>
      <div class="cfg-hint">Configure Linear API key in <b>Settings → Integrations</b>.</div>
    </div>

    ${hasPath ? `
    <div class="cfg-section cfg-files-section">
      <div class="cfg-section-label">Agent files</div>
      <div class="cfg-files-layout">
        <div class="cfg-file-list" id="cfg-file-tabs">
          <div class="cfg-file-loading">Loading…</div>
        </div>
        <div class="cfg-file-right">
          <div class="cfg-file-desc-block" id="cfg-file-desc">
            <div class="cfg-file-desc-name" id="cfg-file-desc-name"></div>
            <div class="cfg-file-desc-text" id="cfg-file-desc-text"></div>
          </div>
          <div class="cfg-editor-wrap">
            <textarea class="cfg-editor" id="cfg-editor" spellcheck="false" placeholder="Select a file…"></textarea>
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
    const map = (PROJECT_AGENTS[S.projectId] || []);
    const idx = map.findIndex(x => x.id === a.id);
    if (idx >= 0) { map[idx] = { ...map[idx], model: modelId }; a = map[idx]; }
    await fetch(`/api/projects/${S.projectId}/agents`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a) });
    const btn = $('#cfg-model-save');
    btn.textContent = 'Saved ✓'; setTimeout(() => btn.textContent = 'Save', 1500);
  });

  // Activate in Claude Code — writes model to .claude/settings.json
  if (hasPath) {
    $('#cfg-model-activate').addEventListener('click', async () => {
      const activateBtn = $('#cfg-model-activate');
      const statusEl    = $('#cfg-activate-status');
      const modelId     = $('#cfg-model-sel').value;

      // First save the model to agent config
      a.model = modelId;
      const map = (PROJECT_AGENTS[S.projectId] || []);
      const idx = map.findIndex(x => x.id === a.id);
      if (idx >= 0) { map[idx] = { ...map[idx], model: modelId }; a = map[idx]; }
      await fetch(`/api/projects/${S.projectId}/agents`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(a) });

      // Then activate — write to .claude/settings.json
      activateBtn.textContent = '…';
      try {
        const r = await fetch(`/api/projects/${S.projectId}/agents/${a.id}/activate`, { method: 'POST' });
        const d = await r.json();
        if (d.ok) {
          activateBtn.textContent = '⚡ Activate in Claude Code';
          statusEl.textContent = d.model
            ? `✓ Claude Code will use ${d.model} for this project`
            : '✓ Claude Code will use the default model';
          statusEl.style.color = 'var(--accent)';
        } else {
          throw new Error(d.error || 'Failed');
        }
      } catch (err) {
        activateBtn.textContent = '⚡ Activate in Claude Code';
        statusEl.textContent = `✗ ${err.message}`;
        statusEl.style.color = '#ef4444';
      }
    });
  }

  // Linear task source toggle
  const linearToggle = $('#cfg-linear-toggle');
  const linearFields = $('#cfg-linear-fields');
  if (linearToggle) {
    linearToggle.addEventListener('change', () => {
      if (linearFields) linearFields.style.display = linearToggle.checked ? '' : 'none';
    });
  }
  $('#cfg-linear-save')?.addEventListener('click', async () => {
    const btn       = $('#cfg-linear-save');
    const enabled   = $('#cfg-linear-toggle')?.checked || false;
    const labelName = $('#cfg-linear-label-name')?.value.trim() || '';
    const teamId    = $('#cfg-linear-team-id')?.value.trim() || '';
    const map = (PROJECT_AGENTS[S.projectId] || []);
    const idx = map.findIndex(x => x.id === a.id);
    if (idx >= 0) { map[idx] = { ...map[idx], linearEnabled: enabled, linearLabelName: labelName, linearTeamId: teamId }; a = map[idx]; }
    await fetch(`/api/projects/${S.projectId}/agents`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
    if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save'; }, 1500); }
  });

  if (!hasPath) return;

  let currentFile = '';

  function renderFileList(files) {
    const tabs = $('#cfg-file-tabs');
    if (!tabs) return;
    tabs.innerHTML = files.map((f, i) => `
      <button class="cfg-file-item${i===0?' on':''}" data-file="${f}">
        <span class="cfg-file-name">${f}</span>
      </button>`).join('');
    if (files.length) { currentFile = files[0]; updateFileDesc(files[0]); loadFile(files[0]); }
  }

  function updateFileDesc(filename) {
    const nameEl = $('#cfg-file-desc-name');
    const textEl = $('#cfg-file-desc-text');
    if (nameEl) nameEl.textContent = filename;
    if (textEl) textEl.textContent = i18n.t(DOC_DESCS[filename] || '');
  }

  async function loadFile(filename) {
    const status = $('#cfg-editor-status');
    if (!status) return;
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

  // Fetch file list dynamically
  (async () => {
    try {
      const r = await fetch(`/api/projects/${S.projectId}/agents/${a.id}/files`);
      const d = await r.json();
      renderFileList(d.files?.length ? d.files : Object.keys(DOC_DESCS));
    } catch {
      renderFileList(Object.keys(DOC_DESCS));
    }
  })();

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

// ── Tasks view ─────────────────────────────────────────────────────────────

let _currentTaskSrc = 'local';

function showTasks() {
  showView('view-tasks');
  _currentTaskSrc = 'local';
  $$('.tasks-src-btn').forEach(b => b.classList.toggle('on', b.dataset.src === 'local'));
  renderProjectTasks('local');
}

async function renderProjectTasks(src) {
  if (!S.projectId) return;
  _currentTaskSrc = src;
  const body = $('#tasks-body');
  if (!body) return;
  body.innerHTML = '<div class="tasks-loading">Loading…</div>';

  try {
    if (src === 'local') {
      const r = await fetch(`/api/projects/${S.projectId}/tasks`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const tasks = await r.json();

      if (!tasks.length) {
        body.innerHTML = '<div class="tasks-empty">No tasks yet — add tasks to your agents.</div>';
        return;
      }

      const STATUSES   = ['in-progress', 'backlog', 'done', 'cancelled'];
      const STATUS_LBL = { 'in-progress': 'In Progress', backlog: 'Backlog', done: 'Done', cancelled: 'Cancelled' };
      const grouped    = {};
      for (const t of tasks) {
        const s = t.status || 'backlog';
        (grouped[s] = grouped[s] || []).push(t);
      }

      let html = '';
      for (const s of STATUSES) {
        const items = grouped[s];
        if (!items?.length) continue;
        html += `<div class="tasks-group">
          <div class="tasks-group-header">
            <span class="tasks-group-dot tasks-dot-${esc(s)}"></span>
            <span class="tasks-group-label">${STATUS_LBL[s] || s}</span>
            <span class="tasks-group-count">${items.length}</span>
          </div>
          <div class="tasks-group-body">
            ${items.map(t => `
              <div class="tasks-row" data-id="${esc(t.id)}" data-aid="${esc(t.agentId)}">
                <span class="tasks-row-title">${esc(t.title || 'Untitled')}</span>
                <span class="tasks-row-agent">${esc(t.agentEmoji || '🤖')} ${esc(t.agentName || '')}</span>
                ${t.priority ? `<span class="tasks-row-pri tasks-pri-${esc(t.priority)}">${esc(t.priority)}</span>` : ''}
                ${t.swarmId ? `<span class="tasks-row-swarm" title="Swarm task">⚡</span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>`;
      }
      body.innerHTML = html || '<div class="tasks-empty">No tasks found.</div>';

      $$('.tasks-row', body).forEach(row => {
        row.addEventListener('click', () => {
          const aid   = row.dataset.aid;
          const agent = (PROJECT_AGENTS[S.projectId] || []).find(a => a.id === aid);
          if (!agent) return;
          S.agentId = aid;
          renderTree();
          showAgent(agent);
          setTimeout(() => { $('[data-tab="tasks"].a-tab')?.click(); }, 80);
        });
      });

    } else if (src === 'linear') {
      const integ = await fetchIntegrations();
      if (!integ.linear?.apiKey) {
        body.innerHTML = `<div class="tasks-empty">Linear not configured. Go to <b>Settings → Integrations</b> to add your API key.</div>`;
        return;
      }
      const r = await fetch(`/api/projects/${S.projectId}/linear/issues`);
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || `HTTP ${r.status}`); }
      const issues = await r.json();

      if (!issues.length) {
        body.innerHTML = '<div class="tasks-empty">No Linear issues found.</div>';
        return;
      }

      const STATE_ORDER = ['started', 'inProgress', 'unstarted', 'backlog', 'completed', 'cancelled', 'triage'];
      const STATE_LBL   = { started: 'In Progress', inProgress: 'In Progress', unstarted: 'Todo', backlog: 'Backlog', completed: 'Done', cancelled: 'Cancelled', triage: 'Triage' };
      const grouped     = {};
      for (const issue of issues) {
        const st = issue.state?.type || 'backlog';
        (grouped[st] = grouped[st] || []).push(issue);
      }
      const allStates = [...new Set([...STATE_ORDER, ...Object.keys(grouped)])];
      const agents     = PROJECT_AGENTS[S.projectId] || [];
      const agentLabels = integ.agentLabels || [];

      // Determine current agent assignment per issue
      const getIssueAgent = (issue) => {
        for (const lbl of (issue.labels?.nodes || [])) {
          const al = agentLabels.find(x => x.labelId === lbl.id);
          if (al) return al;
        }
        return null;
      };

      let html = `<div class="tasks-linear-toolbar">
        <span class="tasks-linear-count">${issues.length} issue${issues.length !== 1 ? 's' : ''}</span>
        <button class="btn-assign-tags" id="btn-manage-assign">⚙ Manage Assignments</button>
      </div>`;

      for (const st of allStates) {
        const items = grouped[st];
        if (!items?.length) continue;
        html += `<div class="tasks-group">
          <div class="tasks-group-header">
            <span class="tasks-group-dot" style="background:${esc(items[0].state?.color || '#888')}"></span>
            <span class="tasks-group-label">${STATE_LBL[st] || st}</span>
            <span class="tasks-group-count">${items.length}</span>
          </div>
          <div class="tasks-group-body">
            ${items.map(issue => {
              const assigned = getIssueAgent(issue);
              const agentName = assigned ? (agents.find(a => a.id === assigned.agentId)?.name || assigned.agentName || '') : '';
              return `
              <div class="tasks-row linear-issue">
                <span class="tasks-row-id">${esc(issue.identifier || '')}</span>
                <span class="tasks-row-title">${esc(issue.title || 'Untitled')}</span>
                ${agentName ? `<span class="tasks-row-assigned">→ ${esc(agentName)}</span>` : '<span class="tasks-row-unassigned">unassigned</span>'}
                <span class="linear-badge">Linear</span>
                ${issue.priorityLabel ? `<span class="tasks-row-pri">${esc(issue.priorityLabel)}</span>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }
      body.innerHTML = html;

      $('#btn-manage-assign')?.addEventListener('click', () => openAssignmentPanel(issues, integ));
    }
  } catch (e) {
    body.innerHTML = `<div class="tasks-error">Failed to load: ${esc(e.message)}</div>`;
  }
}

// ── Assignment Panel ───────────────────────────────────────────────────────

let _assignPending = {}; // issueId → agentId (pending changes)

function closeAssignmentPanel() {
  const el = $('#assign-panel-overlay');
  if (el) el.remove();
  _assignPending = {};
}

function openAssignmentPanel(issues, integ) {
  closeAssignmentPanel();
  const agents     = PROJECT_AGENTS[S.projectId] || [];
  const agentLabels = integ.agentLabels || [];

  const getIssueAgent = (issue) => {
    for (const lbl of (issue.labels?.nodes || [])) {
      const al = agentLabels.find(x => x.labelId === lbl.id);
      if (al) return al.agentId;
    }
    return '';
  };

  const agentOpts = agents.map(a =>
    `<option value="${esc(a.id)}">${esc(a.linearLabelName || a.name)}</option>`
  ).join('');

  const rows = issues.map(issue => {
    const cur = getIssueAgent(issue);
    return `
      <tr class="assign-row" data-issue-id="${esc(issue.id)}">
        <td class="assign-id">${esc(issue.identifier || '')}</td>
        <td class="assign-title">${esc(issue.title || 'Untitled')}</td>
        <td class="assign-agent-cell">
          <select class="assign-agent-sel field-input" data-issue-id="${esc(issue.id)}">
            <option value="">— Unassigned —</option>
            ${agentOpts}
          </select>
        </td>
      </tr>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'overlay on';
  overlay.id = 'assign-panel-overlay';
  overlay.innerHTML = `
    <div class="modal assign-modal">
      <div class="assign-modal-head">
        <div class="modal-title">Manage Assignments</div>
        <div class="assign-modal-actions">
          <button class="btn-assign-ai" id="btn-auto-assign">⚡ AI Auto-assign</button>
          <button class="btn-assign-apply" id="btn-apply-assign" disabled>Apply to Linear</button>
          <button class="btn-cancel" id="btn-close-assign">Cancel</button>
        </div>
      </div>
      <div class="assign-ai-log" id="assign-ai-log" style="display:none"></div>
      <div class="assign-table-wrap">
        <table class="assign-table">
          <thead><tr>
            <th>ID</th><th>Issue</th><th>Assign to Agent</th>
          </tr></thead>
          <tbody id="assign-tbody">${rows}</tbody>
        </table>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Pre-fill current assignments
  for (const issue of issues) {
    const cur = getIssueAgent(issue);
    const sel = overlay.querySelector(`select[data-issue-id="${issue.id}"]`);
    if (sel && cur) sel.value = cur;
  }

  // Track changes
  overlay.querySelectorAll('.assign-agent-sel').forEach(sel => {
    sel.addEventListener('change', () => {
      _assignPending[sel.dataset.issueId] = sel.value;
      $('#btn-apply-assign').disabled = Object.keys(_assignPending).length === 0;
    });
  });

  $('#btn-close-assign').addEventListener('click', closeAssignmentPanel);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeAssignmentPanel(); });

  // AI auto-assign
  $('#btn-auto-assign').addEventListener('click', () => runAutoAssign(issues, agents, overlay));

  // Apply to Linear
  $('#btn-apply-assign').addEventListener('click', () => applyAssignments(issues, integ, overlay));
}

async function runAutoAssign(issues, agents, overlay) {
  const btn    = overlay.querySelector('#btn-auto-assign');
  const logEl  = overlay.querySelector('#assign-ai-log');
  btn.disabled = true; btn.textContent = '…';
  logEl.style.display = '';
  logEl.innerHTML = '<div class="assign-log-row">Starting AI analysis…</div>';

  try {
    const es = new EventSource(`/api/projects/${S.projectId}/linear/auto-assign`);
    // SSE needs POST, so use fetch + manual SSE decode
    es.close();

    const r = await fetch(`/api/projects/${S.projectId}/linear/auto-assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issues }),
    });

    const reader = r.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';
    let   result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const d = JSON.parse(line.slice(5).trim());
          if (d.type === 'progress') {
            logEl.innerHTML += `<div class="assign-log-row">${esc(d.message)}</div>`;
            logEl.scrollTop = logEl.scrollHeight;
          }
          if (d.type === 'done')  result = d.result;
          if (d.type === 'error') { logEl.innerHTML += `<div class="assign-log-row assign-log-err">${esc(d.message)}</div>`; }
        } catch {}
      }
    }

    if (result?.assignments?.length) {
      let applied = 0;
      for (const asgn of result.assignments) {
        const sel = overlay.querySelector(`select[data-issue-id="${asgn.issueId}"]`);
        if (sel && asgn.agentId) {
          sel.value = asgn.agentId;
          if (sel.value === asgn.agentId) {
            _assignPending[asgn.issueId] = asgn.agentId;
            applied++;
          }
        }
      }
      logEl.innerHTML += `<div class="assign-log-row assign-log-ok">✓ ${applied} assignments suggested — review and click "Apply to Linear"</div>`;
      $('#btn-apply-assign').disabled = applied === 0;
    }
  } catch (e) {
    logEl.innerHTML += `<div class="assign-log-row assign-log-err">Error: ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '⚡ AI Auto-assign';
  }
}

async function applyAssignments(issues, integ, overlay) {
  const btn      = overlay.querySelector('#btn-apply-assign');
  const logEl    = overlay.querySelector('#assign-ai-log');
  const agents   = PROJECT_AGENTS[S.projectId] || [];
  const agentLabelsCurrent = integ.agentLabels || [];
  logEl.style.display = '';
  btn.disabled = true; btn.textContent = 'Applying…';

  const log = (msg, cls = '') => {
    logEl.innerHTML += `<div class="assign-log-row ${cls}">${esc(msg)}</div>`;
    logEl.scrollTop = logEl.scrollHeight;
  };

  try {
    // Collect all agent label IDs (to remove them before adding new one)
    const allAgentLabelIds = agentLabelsCurrent.map(x => x.labelId);
    const teamId = integ.linear?.defaultTeamId || '';
    let changed = 0;

    for (const [issueId, agentId] of Object.entries(_assignPending)) {
      if (!agentId) continue;
      const agent  = agents.find(a => a.id === agentId);
      if (!agent) continue;
      const lName  = agent.linearLabelName || agent.name;

      // Check if label exists
      let labelEntry = agentLabelsCurrent.find(x => x.agentId === agentId);
      if (!labelEntry) {
        log(`Creating label "${lName}" in Linear…`);
        const cr = await fetch(`/api/projects/${S.projectId}/linear/labels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: lName, color: agent.color || '#94A3B8', teamId, agentId }),
        });
        if (!cr.ok) { const e = await cr.json(); log(`✗ Failed to create label: ${e.error}`, 'assign-log-err'); continue; }
        const newLabel = await cr.json();
        labelEntry = { agentId, labelId: newLabel.id, labelName: newLabel.name };
        agentLabelsCurrent.push(labelEntry);
        allAgentLabelIds.push(newLabel.id);
        // Refresh cache
        _integCache = { ..._integCache, agentLabels: agentLabelsCurrent };
      }

      // Compute new label list for this issue: keep non-agent labels + add this agent's label
      const issue = issues.find(i => i.id === issueId);
      const curLabels = (issue?.labels?.nodes || []).map(l => l.id);
      const newLabels = [...curLabels.filter(id => !allAgentLabelIds.includes(id)), labelEntry.labelId];

      log(`Assigning "${lName}" → ${issue?.identifier || issueId}…`);
      const pr = await fetch(`/api/projects/${S.projectId}/linear/issues/${issueId}/labels`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labelIds: newLabels }),
      });
      if (!pr.ok) { const e = await pr.json(); log(`✗ ${e.error}`, 'assign-log-err'); continue; }
      changed++;
    }

    log(`✓ Applied ${changed} assignment${changed !== 1 ? 's' : ''}`, 'assign-log-ok');
    _assignPending = {};
    btn.textContent = '✓ Done';
    setTimeout(() => { closeAssignmentPanel(); renderProjectTasks('linear'); }, 1500);
  } catch (e) {
    log(`Error: ${e.message}`, 'assign-log-err');
    btn.disabled = false; btn.textContent = 'Apply to Linear';
  }
}

// ── Integrations ───────────────────────────────────────────────────────────

let _integCache = null;

async function fetchIntegrations() {
  if (!S.projectId) return {};
  try {
    const r = await fetch(`/api/projects/${S.projectId}/integrations`);
    if (!r.ok) return {};
    _integCache = await r.json();
    return _integCache;
  } catch { return {}; }
}

async function renderIntegrations() {
  const el = $('#stab-integrations');
  if (!el) return;
  if (!S.projectId) {
    el.innerHTML = '<div class="integ-empty">Select a project to manage integrations.</div>';
    return;
  }
  el.innerHTML = '<div class="cfg-hint">Loading…</div>';

  const integ  = await fetchIntegrations();
  const linear = integ.linear || {};

  el.innerHTML = `
    <div class="integ-card" id="integ-linear">
      <div class="integ-card-head">
        <div class="integ-card-info">
          <div class="integ-card-icon">◈</div>
          <div>
            <div class="integ-card-name">Linear</div>
            <div class="integ-card-desc">Pull issues as tasks and sync agent work</div>
          </div>
        </div>
        <div class="integ-status${linear.apiKey ? ' integ-status-on' : ''}">${linear.apiKey ? '● Connected' : '○ Not configured'}</div>
      </div>
      <div class="integ-card-body">
        <div class="field">
          <label class="field-label">API Key</label>
          <input class="field-input field-mono" id="integ-linear-key" type="password"
            value="${esc(linear.apiKey || '')}" placeholder="lin_api_…" autocomplete="off" />
        </div>
        <div class="field" id="integ-linear-team-field"${!linear.apiKey ? ' style="display:none"' : ''}>
          <label class="field-label">Default Team</label>
          <div style="display:flex;gap:8px">
            <select class="field-input" id="integ-linear-team">
              <option value="">— Select team —</option>
              ${(linear.teams || []).map(t => `<option value="${esc(t.id)}"${linear.defaultTeamId === t.id ? ' selected' : ''}>${esc(t.name)} (${esc(t.key)})</option>`).join('')}
            </select>
            <button class="btn-cfg-save" id="integ-linear-load-teams">Load Teams</button>
          </div>
        </div>
        <div class="integ-card-actions">
          <button class="btn-cfg-save" id="integ-linear-save">Save</button>
        </div>
      </div>
    </div>
  `;

  $('#integ-linear-load-teams').addEventListener('click', async () => {
    const btn = $('#integ-linear-load-teams');
    btn.disabled = true; btn.textContent = '…';
    try {
      const r = await fetch(`/api/projects/${S.projectId}/linear/teams`);
      const teams = await r.json();
      if (!r.ok) throw new Error(teams.error || `HTTP ${r.status}`);
      const sel = $('#integ-linear-team');
      sel.innerHTML = '<option value="">— Select team —</option>' +
        teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)} (${esc(t.key)})</option>`).join('');
      btn.textContent = '✓ Loaded';
    } catch (e) {
      btn.textContent = `✗ ${String(e.message).slice(0, 30)}`;
    } finally {
      btn.disabled = false;
      setTimeout(() => { const b = $('#integ-linear-load-teams'); if (b) b.textContent = 'Load Teams'; }, 2500);
    }
  });

  $('#integ-linear-save').addEventListener('click', async () => {
    const btn     = $('#integ-linear-save');
    const apiKey  = $('#integ-linear-key').value.trim();
    const teamSel = $('#integ-linear-team');
    const teamId  = teamSel?.value || '';
    const curTeams = linear.teams || [];
    const teams    = curTeams.length ? curTeams : (teamId ? [{ id: teamId, name: teamId, key: '' }] : []);
    const newInteg = { ...integ, linear: apiKey ? { apiKey, defaultTeamId: teamId, teams } : {} };

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const r = await fetch(`/api/projects/${S.projectId}/integrations`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newInteg),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _integCache = newInteg;
      btn.textContent = '✓ Saved';
      if (apiKey) { const tf = $('#integ-linear-team-field'); if (tf) tf.style.display = ''; }
      setTimeout(() => renderIntegrations(), 1500);
    } catch (e) {
      btn.textContent = '✗ Error';
      setTimeout(() => { btn.disabled = false; btn.textContent = 'Save'; }, 2000);
    }
  });
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

  // Build collapsible log block
  const logWrap = document.createElement('div');
  logWrap.className = 'analyze-log-wrap';
  logWrap.innerHTML = `
    <div class="analyze-log-header">
      <span class="analyze-log-title">Process Log</span>
      <button class="analyze-log-toggle" title="Collapse">▾</button>
    </div>
    <div class="analyze-log-body"></div>`;
  $('#analyze-body').innerHTML = '';
  $('#analyze-body').appendChild(logWrap);

  const logBody   = logWrap.querySelector('.analyze-log-body');
  const toggleBtn = logWrap.querySelector('.analyze-log-toggle');
  let   collapsed = false;
  let   lastStep  = null;

  toggleBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    logBody.style.display = collapsed ? 'none' : '';
    toggleBtn.textContent = collapsed ? '▸' : '▾';
    toggleBtn.title = collapsed ? 'Expand' : 'Collapse';
  });

  const addLog = (msg, type = 'step') => {
    // Mark previous step as done when a new step arrives
    if (type === 'step' && lastStep) {
      lastStep.classList.add('analyze-log-done');
      lastStep.querySelector('.analyze-log-icon').textContent = '✓';
    }
    const line = document.createElement('div');
    line.className = `analyze-log-line analyze-log-${type}`;
    const icon = type === 'step' ? '›' : type === 'ok' ? '✓' : '✗';
    line.innerHTML = `<span class="analyze-log-icon">${icon}</span><span class="analyze-log-text">${msg}</span>`;
    logBody.appendChild(line);
    if (type === 'step') lastStep = line;
    if (type !== 'step' && lastStep) {
      lastStep.classList.add('analyze-log-done');
      lastStep.querySelector('.analyze-log-icon').textContent = '✓';
      lastStep = null;
    }
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
      const tier   = ag.tier === 'mandatory'
        ? `<span class="analyze-tier mandatory">mandatory</span>`
        : `<span class="analyze-tier additional">additional</span>`;
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
          ${ag.covers ? `<div class="analyze-card-covers">↳ ${esc(ag.covers)}</div>` : ''}
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

    const aHalf  = Math.ceil(agents.length / 2);
    const aCol1  = agents.slice(0, aHalf);
    const aCol2  = agents.slice(aHalf);
    const pHalf  = Math.ceil(pipelines.length / 2);
    const pCol1  = pipelines.slice(0, pHalf);
    const pCol2  = pipelines.slice(pHalf);

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
        <div class="analyze-section-group">
          <div class="analyze-group-label">Agents <span class="analyze-group-count">${agents.length}</span></div>
          <div class="analyze-group-cols">
            <div class="analyze-col">
              ${aCol1.map((ag, i) => agentCardHtml(ag, i)).join('')}
            </div>
            <div class="analyze-col">
              ${aCol2.map((ag, i) => agentCardHtml(ag, i + aHalf)).join('')}
            </div>
          </div>
        </div>
        <div class="analyze-section-group">
          <div class="analyze-group-label">Pipelines <span class="analyze-group-count">${pipelines.length}</span></div>
          <div class="analyze-group-cols">
            <div class="analyze-col">
              ${pCol1.map((p, i) => pipeHtml(p, i)).join('')}
              ${!pCol1.length ? `<div class="analyze-empty">No pipelines suggested</div>` : ''}
            </div>
            <div class="analyze-col">
              ${pCol2.map((p, i) => pipeHtml(p, i + pHalf)).join('')}
            </div>
          </div>
        </div>
      </div>`;
    $('#analyze-body').appendChild(resultsEl);

    async function addAgent(ag, btn) {
      if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
      // Use full catalog object if available (has id, color, emoji, etc.)
      // Fall back to synthesized object with a slug id derived from the catalog id or name
      const catalogEntry = CATALOG_AGENTS.find(c => c.id === ag.id) ||
                           CATALOG_AGENTS.find(c => c.name.toLowerCase() === ag.name.toLowerCase());
      const slugId = ag.id || ag.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const payload = catalogEntry
        ? { ...catalogEntry, role: ag.reason, status: 'idle' }
        : { id: slugId, name: ag.name, role: ag.reason, catalogId: ag.id || null, status: 'idle', group: 'custom' };

      const r = await fetch(`/api/projects/${S.projectId}/agents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (btn) btn.textContent = r.ok ? '✓ Added' : '✗ Failed';
      if (r.ok) { await loadProjectAgents(S.projectId); renderTree(); }
      else if (btn) { btn.disabled = false; console.error('addAgent failed', await r.text?.().catch(()=>'')); }
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

        // Step 1: add all new agents sequentially
        allBtn.textContent = 'Adding agents…';
        const toAdd = agents.filter(ag => !projectAgents().some(a => a.name.toLowerCase() === ag.name.toLowerCase()));
        for (const ag of toAdd) {
          const cardBtn = resultsEl.querySelector(`.btn-analyze-add[data-idx="${agents.indexOf(ag)}"]`);
          await addAgent(ag, cardBtn);
        }

        // Step 2: reload agent list so all new agents are visible before pipeline lookup
        await loadProjectAgents(S.projectId);
        renderTree();

        // Step 3: apply all pipelines
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
  initAgentsHeaderToggle();
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
      if (item.dataset.view === 'tasks')    showTasks();
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
      if (tab.dataset.stab === 'general')       renderGeneral();
      if (tab.dataset.stab === 'integrations') renderIntegrations();
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

  // Tasks source bar + refresh
  $$('.tasks-src-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tasks-src-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      renderProjectTasks(btn.dataset.src);
    });
  });
  $('#btn-tasks-refresh').addEventListener('click', () => {
    renderProjectTasks(_currentTaskSrc);
  });

  // Visor check button
  $('#btn-visor-check').addEventListener('click', async () => {
    const btn = $('#btn-visor-check');
    if (!S.projectId) return;
    btn.disabled = true; btn.textContent = '…';
    try {
      await fetch(`/api/projects/${S.projectId}/visor/check`, { method: 'POST' });
      await loadVisorBulletins();
    } finally { btn.disabled = false; btn.textContent = 'Run Check'; }
  });

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
  PROJECTS.sort((a, b) => a.name.localeCompare(b.name));
  if (PROJECTS.length) {
    S.projectId = PROJECTS[0].id;
    await loadProjectAgents(S.projectId);
    syncAddedIds();
  }
}

document.addEventListener('DOMContentLoaded', () => init());
