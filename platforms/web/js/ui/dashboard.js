// ── Dashboard ──────────────────────────────────────────────────────────────

import { S } from '../modules/state.js';
import { $, esc } from '../modules/utils.js';
import { relTime } from '../modules/utils.js';
import { projectAgents } from './sidebar.js';

const VIEWS = ['view-dash', 'view-catalog', 'view-agent', 'view-settings', 'view-home', 'view-overview', 'view-analyze', 'view-tasks'];

export function showView(name) {
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

export function showDash() {
  showView('view-dash');
  renderDash();
  import('../settings/settings.js').then(({ renderOverview }) => renderOverview());
}

export function renderDash() {
  const pa = projectAgents();
  const totalWorkers = pa.reduce((s, a) => s + (a.workers || 0), 0);
  $('#s-agents').textContent  = pa.length;
  $('#s-workers').textContent = totalWorkers;
  $('#s-tasks').textContent   = pa.reduce((s, a) => s + (a.tasks || 0), 0);
  $('#s-busy').textContent    = pa.filter(a => a.status === 'busy').length;

  const feed = $('#act-feed');
  if (feed && !feed.dataset.live) {
    feed.dataset.live = '1';
    feed.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3);font-size:12px">No activity yet</div>`;
  }
  loadVisorBulletins();
}

const ACTIVITY_ICONS = {
  'agent:added':    '＋',
  'agent:updated':  '✎',
  'agent:removed':  '✕',
  'task:created':   '◎',
  'task:updated':   '●',
  'task:deleted':   '○',
  'chat:message':   '✉',
};

export function pushActivity(msg) {
  const feed = $('#act-feed');
  if (!feed) return;

  const placeholder = feed.querySelector('div[style]');
  if (placeholder && feed.children.length === 1) placeholder.remove();

  const icon  = ACTIVITY_ICONS[msg.type] || '·';
  const label = msg.agentName || msg.name || msg.aid || '';
  const detail = msg.task?.title || msg.task?.status || msg.preview || '';
  const time   = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const item = document.createElement('div');
  item.className = 'act-item';
  item.innerHTML = `
    <span class="act-icon">${esc(icon)}</span>
    <span class="act-body">
      <span class="act-label">${esc(label)}</span>
      ${detail ? `<span class="act-detail">${esc(detail)}</span>` : ''}
    </span>
    <span class="act-time">${esc(time)}</span>`;

  feed.insertBefore(item, feed.firstChild);

  // Keep max 40 items
  while (feed.children.length > 40) feed.removeChild(feed.lastChild);
}

export async function loadVisorBulletins() {
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

export async function renderTeamMap() {
  const el = $('#team-map');
  if (!el) return;
  el.innerHTML = `<div class="tm-empty">Loading…</div>`;

  let _selectAgent = null;
  renderTeamMap._setSelectAgent = fn => { _selectAgent = fn; };

  try {
    const r = await fetch(`/api/projects/${S.projectId}/pipelines`);
    const { agents, connections } = await r.json();

    const agentMap    = Object.fromEntries(agents.map(a => [a.id, a]));
    const connectedIds = new Set([...connections.map(c => c.from), ...connections.map(c => c.to)]);

    const NODE_W = 162, NODE_H = 60, H_GAP = 108, V_GAP = 20, PAD = 28;

    const EDGE_CLR = { on_success: '#4ade80', on_failure: '#f87171', always: '#94a3b8' };
    const ARR_IDS  = ['arr-success', 'arr-fail', 'arr-default'];
    const ARR_CLRS = ['#4ade80', '#f87171', '#94a3b8'];
    const defs = `<defs>
      ${ARR_IDS.map((id, i) => `
        <marker id="${id}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="${ARR_CLRS[i]}" opacity=".9"/>
        </marker>`).join('')}
    </defs>`;

    const nodeEl = (a, x, y, w, h, sw, dimmed = false) => {
      const color = a.color || '#6366f1';
      const name  = (a.name || a.id).slice(0, 20);
      const emoji = a.emoji || '';
      const dot   = a.status === 'busy' ? `<circle cx="${x + w - 11}" cy="${y + 11}" r="4" fill="#22c55e"/>` : '';
      const dash  = dimmed ? ' stroke-dasharray="5 3"' : '';
      const op    = dimmed ? ' opacity=".45"' : '';
      return `
        <g class="tm-node" data-id="${esc(a.id)}" style="cursor:pointer"${op}
          onclick="window.__legionSelectAgent && window.__legionSelectAgent('${esc(a.id)}')">
          <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"
            fill="${color}${dimmed ? '0d' : '12'}" stroke="${color}" stroke-width="${sw}" stroke-opacity=".8"${dash}/>
          ${emoji ? `<text x="${x + 11}" y="${y + 18}" font-size="14" font-family="inherit" opacity=".75">${emoji}</text>` : ''}
          <text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle"
            font-size="12" font-weight="700" fill="${color}" font-family="inherit">${esc(name)}</text>
          ${dot}
        </g>`;
    };

    // ── Empty state — show all agents as a grid ───────────────────────────
    if (!connections.length) {
      const cols = Math.min(agents.length, 5);
      const rows = Math.ceil(agents.length / cols);
      const GAP  = 16;
      const w = PAD * 2 + cols * NODE_W + (cols - 1) * GAP;
      const h = PAD * 2 + rows * NODE_H + (rows - 1) * GAP;
      const grid = agents.map((a, i) => {
        const cx = PAD + (i % cols) * (NODE_W + GAP);
        const cy = PAD + Math.floor(i / cols) * (NODE_H + GAP);
        return nodeEl(a, cx, cy, NODE_W, NODE_H, '1.5', true);
      }).join('');
      el.innerHTML = `
        <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="max-width:100%;overflow:visible;display:block">
          ${defs}${grid}
        </svg>
        <div class="tm-hint" style="padding:8px 16px 16px">No pipeline connections yet. Open an agent → Pipeline tab to connect agents.</div>`;
      return;
    }

    // ── Level assignment (BFS) ────────────────────────────────────────────
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
    for (let pass = 0; pass < 3; pass++) {
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

    // ── Port spreading ────────────────────────────────────────────────────
    const outPort = {}, inPort = {};
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

    // ── Edges ─────────────────────────────────────────────────────────────
    let edges = '';
    connections.forEach((c, i) => {
      const pf = pos[c.from], pt = pos[c.to];
      if (!pf || !pt) return;
      const x1 = pf.x + NODE_W, y1 = pf.y + NODE_H / 2 + (outPort[i] ?? 0);
      const x2 = pt.x,          y2 = pt.y + NODE_H / 2 + (inPort[i]  ?? 0);
      const cond  = c.condition || 'always';
      const clr   = EDGE_CLR[cond] || EDGE_CLR.always;
      const arrId = cond === 'on_success' ? 'arr-success' : cond === 'on_failure' ? 'arr-fail' : 'arr-default';
      const lbl   = cond !== 'always' ? cond : '';
      const xm = (x1 + x2) / 2, r = 7;
      let d;
      if (Math.abs(y2 - y1) < 3) {
        d = `M${x1},${y1} H${x2}`;
      } else {
        const dir = y2 > y1 ? 1 : -1;
        d = `M${x1},${y1} H${xm - r} Q${xm},${y1} ${xm},${y1 + dir * r} V${y2 - dir * r} Q${xm},${y2} ${xm + r},${y2} H${x2}`;
      }
      const opacity = cond === 'always' ? '.45' : '.7';
      const lx = xm, ly = (y1 + y2) / 2;
      edges += `
        <path d="${d}" fill="none" stroke="${clr}" stroke-width="1.5" opacity="${opacity}" marker-end="url(#${arrId})"/>
        ${lbl ? `<rect x="${lx - 30}" y="${ly - 9}" width="60" height="16" rx="5" fill="${clr}" opacity=".12"/>
                 <text x="${lx}" y="${ly + 3.5}" text-anchor="middle" font-size="9" font-weight="600"
                   fill="${clr}" font-family="inherit" opacity=".9">${esc(lbl)}</text>` : ''}`;
    });

    // ── Connected nodes ───────────────────────────────────────────────────
    let nodes = '';
    for (const id of connectedIds) {
      const { x, y } = pos[id];
      const a      = agentMap[id] || {};
      const outDeg = (outEdges[id] || []).length;
      const inDg   = (inEdges[id]  || []).length;
      nodes += nodeEl(a, x, y, NODE_W, NODE_H, (outDeg + inDg) >= 4 ? '2' : '1.5');
    }

    // ── Isolated agents (no pipeline connections) ─────────────────────────
    const isolated = agents.filter(a => !connectedIds.has(a.id));
    let isolatedSvg = '', extraH = 0;
    if (isolated.length) {
      const ISO_W = 148, ISO_H = 52, ISO_GAP = 12;
      const isoY = totalH + 36;
      extraH = ISO_H + 52;
      isolatedSvg = `
        <line x1="${PAD}" y1="${totalH + 18}" x2="${totalW - PAD}" y2="${totalH + 18}"
          stroke="#334155" stroke-width="1" opacity=".4" stroke-dasharray="4 4"/>
        <text x="${PAD}" y="${isoY - 8}" font-size="9" fill="#475569" font-family="inherit"
          letter-spacing=".8" font-weight="600">NOT CONNECTED</text>
        ${isolated.map((a, i) => nodeEl(a, PAD + i * (ISO_W + ISO_GAP), isoY, ISO_W, ISO_H, '1', true)).join('')}`;
    }

    // ── Legend ────────────────────────────────────────────────────────────
    const usedConds = new Set(connections.map(c => c.condition || 'always'));
    const legendItems = [
      { cond: 'on_success', clr: '#4ade80', label: 'on_success' },
      { cond: 'on_failure', clr: '#f87171', label: 'on_failure' },
      { cond: 'always',     clr: '#94a3b8', label: 'always'     },
    ].filter(item => usedConds.has(item.cond));

    const legX = totalW - 108, legY = 10;
    const legend = legendItems.length > 1 ? `
      <g opacity=".75">
        ${legendItems.map((item, i) => `
          <line x1="${legX}" y1="${legY + i * 16 + 5}" x2="${legX + 20}" y2="${legY + i * 16 + 5}"
            stroke="${item.clr}" stroke-width="1.5" opacity="${item.cond === 'always' ? '.45' : '1'}"/>
          <text x="${legX + 24}" y="${legY + i * 16 + 9}" font-size="9" fill="#64748b" font-family="inherit">${item.label}</text>`).join('')}
      </g>` : '';

    const svgH = totalH + extraH;
    el.innerHTML = `
      <svg width="${totalW}" height="${svgH}" viewBox="0 0 ${totalW} ${svgH}"
        style="max-width:100%;overflow:visible;display:block">
        ${defs}${edges}${nodes}${isolatedSvg}${legend}
      </svg>`;

  } catch {
    el.innerHTML = `<div class="tm-empty">Could not load team map.</div>`;
  }
}
