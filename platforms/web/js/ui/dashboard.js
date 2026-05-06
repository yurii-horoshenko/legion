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

  const COND_CLR = { on_success: 'tm-conn-success', on_failure: 'tm-conn-fail', always: 'tm-conn-always' };

  function cardStyle(color, dimmed) {
    return `background:${color}12;border:1.5px ${dimmed ? 'dashed' : 'solid'} ${color}55;opacity:${dimmed ? '.5' : '1'}`;
  }

  function card(a, dimmed = false) {
    const color = a.color || '#6366f1';
    const name  = a.name || a.id;
    const emoji = a.emoji ? `<span style="font-size:14px;flex-shrink:0;line-height:1">${a.emoji}</span>` : '';
    const op    = dimmed ? 'opacity:.45;' : '';
    return `
      <div data-id="${esc(a.id)}"
        style="${op}padding:10px 12px;background:${color}12;border:1.5px ${dimmed?'dashed':'solid'} ${color}55;border-radius:10px;cursor:pointer;width:180px;box-sizing:border-box"
        onmouseenter="this.style.filter='brightness(1.1)'" onmouseleave="this.style.filter=''"
        onclick="window.__legionSelectAgent && window.__legionSelectAgent('${esc(a.id)}')">
        <div style="display:flex;align-items:center;gap:6px">
          ${emoji}
          <span style="font-size:12px;font-weight:600;color:${color};line-height:1.35;word-break:break-word">${esc(name)}</span>
        </div>
      </div>`;
  }

  try {
    const r = await fetch(`/api/projects/${S.projectId}/pipelines`);
    const { agents, connections } = await r.json();

    const agentMap     = Object.fromEntries(agents.map(a => [a.id, a]));
    const connectedIds = new Set([...connections.map(c => c.from), ...connections.map(c => c.to)]);

    // ── Empty state ───────────────────────────────────────────────────────
    if (!connections.length) {
      const grid = agents.map(a => card(a, true)).join('');
      el.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:10px;padding-bottom:10px">${grid}</div>
        <div style="font-size:11px;color:var(--text-3);padding:4px 0">No pipeline connections yet — open an agent → Pipeline tab to connect agents.</div>`;
      return;
    }

    // ── BFS level assignment ──────────────────────────────────────────────
    const outEdges = {}, inEdges = {}, inDeg = {};
    for (const id of connectedIds) { outEdges[id] = []; inEdges[id] = []; inDeg[id] = 0; }
    for (const c of connections) {
      outEdges[c.from].push({ to: c.to, condition: c.condition || 'always' });
      inEdges[c.to].push(c.from);
      inDeg[c.to]++;
    }
    const level = {};
    const roots = [...connectedIds].filter(id => inDeg[id] === 0);
    const bfsQ  = roots.length ? roots : [[...connectedIds][0]];
    bfsQ.forEach(id => { level[id] = 0; });
    let qi = 0;
    while (qi < bfsQ.length) {
      const id = bfsQ[qi++];
      for (const { to } of outEdges[id]) {
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
    const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);

    // ── Build stage columns ───────────────────────────────────────────────
    const stagesHtml = levels.map((l, li) => {
      const ids   = byLevel[l];
      const label = `<div style="font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;text-align:center">Stage ${l + 1}</div>`;
      const cards = ids.map(id => {
        const a    = agentMap[id] || { id };
        const outs = outEdges[id] || [];
        const tags = outs.map(({ to, condition }) => {
          const tname = agentMap[to]?.name || to;
          const c = condition || 'always';
          const dot = c === 'on_success' ? '🟢' : c === 'on_failure' ? '🔴' : '';
          return `<div style="font-size:11px;color:var(--text-2);display:flex;align-items:center;gap:4px;padding:1px 0">
            <span style="color:var(--text-3);flex-shrink:0">→</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tname)}</span>
            ${dot ? `<span style="font-size:9px">${dot}</span>` : ''}
          </div>`;
        }).join('');
        const emoji = a.emoji ? `${a.emoji} ` : '';
        const busy  = a.status === 'busy' ? `<span style="width:6px;height:6px;border-radius:50%;background:#22c55e;flex-shrink:0;display:inline-block;margin-left:4px;vertical-align:middle"></span>` : '';
        const conns = tags ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">${tags}</div>` : '';
        return `<div data-id="${esc(id)}" onclick="window.__legionSelectAgent&&window.__legionSelectAgent('${esc(id)}')"
          style="padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;cursor:pointer;box-sizing:border-box;width:100%;transition:border-color .15s,box-shadow .15s"
          onmouseenter="this.style.borderColor='var(--text-3)';this.style.boxShadow='0 2px 8px rgba(0,0,0,.06)'"
          onmouseleave="this.style.borderColor='var(--border)';this.style.boxShadow=''">
          <div style="font-size:12px;font-weight:600;color:var(--text);line-height:1.35">${emoji}${esc(a.name || id)}${busy}</div>
          ${conns}
        </div>`;
      }).join('');

      const sep = li < levels.length - 1
        ? `<div style="display:flex;align-items:flex-start;justify-content:center;flex-shrink:0;width:32px;padding-top:42px;font-size:18px;color:var(--border-2);user-select:none">›</div>`
        : '';
      return `<div style="display:flex;flex-direction:column;flex:0 0 190px;width:190px;min-width:190px">${label}${cards}</div>${sep}`;
    }).join('');

    // ── Isolated agents ───────────────────────────────────────────────────
    const isolated = agents.filter(a => !connectedIds.has(a.id));
    const isoHtml  = isolated.length ? `
      <div style="margin-top:20px;padding-top:16px;border-top:1px dashed var(--border)">
        <div style="font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Not connected</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">${isolated.map(a => card(a, true)).join('')}</div>
      </div>` : '';

    el.innerHTML = `<div style="display:flex;flex-direction:row;flex-wrap:nowrap;align-items:flex-start;gap:0;overflow-x:auto;padding-bottom:8px">${stagesHtml}</div>${isoHtml}`;

  } catch {
    el.innerHTML = `<div class="tm-empty">Could not load team map.</div>`;
  }
}
