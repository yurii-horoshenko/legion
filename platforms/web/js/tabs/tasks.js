// ── Tasks tab (Kanban) ─────────────────────────────────────────────────────

import { S } from '../modules/state.js';
import { $, esc } from '../modules/utils.js';
import { relTime, tabDescHtml } from '../modules/utils.js';
import { storeGet, storeDel, storePost, _integCache } from '../modules/api.js';
import { showMiniModal, closeMiniModal } from '../modals/mini-modal.js';
import { openDecomposeModal } from '../modals/decompose-modal.js';

export const TASK_COLS = ['in_progress', 'needs_review', 'ready', 'backlog', 'done', 'blocked', 'cancelled'];
export const TASK_COL_LABELS = {
  in_progress: 'In Progress', needs_review: 'Needs Review', ready: 'Ready',
  backlog: 'Backlog', done: 'Done', blocked: 'Blocked', cancelled: 'Cancelled'
};

export async function renderTasks(a) {
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
        <span class="store-count">${items.length} task${items.length !== 1 ? 's' : ''}</span>
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
                  <span class="kanban-id">#${t.id.slice(0, 6)}</span>
                  <button class="kanban-decompose" data-id="${t.id}" data-aid="${aid}" data-title="${esc(t.title || '')}" title="Decompose with Swarm">⚡</button>
                  <button class="kanban-del" data-id="${t.id}">✕</button>
                </div>
                <div class="kanban-title">${esc(t.title || 'Untitled')}</div>
                ${t.description ? `<div class="kanban-desc">${esc(t.description)}</div>` : ''}
                <div class="kanban-footer">
                  <span class="kanban-priority ${esc(t.priority || '')}">${esc(t.priority || '')}</span>
                  ${t.swarmChildCount ? `<span class="kanban-swarm">↳ ${t.swarmChildCount} subtasks</span>` : ''}
                  <span class="kanban-time">${relTime(t.updatedAt || t.createdAt)}</span>
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

export async function appendLinearSection(el, a, integ) {
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

export function openTaskModal(a) {
  const aid = a?.id || S.agentId;
  showMiniModal({
    title: 'New Task',
    fields: [
      { id: 'tk-m-title',    label: 'Title',                    placeholder: 'e.g. Implement routing layer' },
      { id: 'tk-m-desc',     label: 'Description (optional)',   placeholder: '' },
      { id: 'tk-m-status',   label: 'Status',   type: 'select', options: TASK_COLS },
      { id: 'tk-m-priority', label: 'Priority', type: 'select', options: ['', 'high', 'medium', 'low'] },
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
