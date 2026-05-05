// ── Sidebar / Agent tree ───────────────────────────────────────────────────

import { S, PROJECT_AGENTS } from '../modules/state.js';
import { $, $$, esc } from '../modules/utils.js';

// selectAgent imported lazily to avoid circular (agent-panel imports sidebar)
let _selectAgent = null;
export function registerSelectAgent(fn) { _selectAgent = fn; }

export function projectAgents() {
  return PROJECT_AGENTS[S.projectId] || [];
}

export function renderTree() {
  const agents = projectAgents();

  const countEl = $('#rail-agents-count');
  if (countEl) countEl.textContent = agents.length ? `(${agents.length})` : '';

  if (agents.length === 0) {
    $('#agent-tree').innerHTML = `<div class="tree-empty">No agents yet — add from catalog</div>`;
    return;
  }

  $('#agent-tree').innerHTML = agents.map(a => `
    <div class="agent-row ${a.id === S.agentId ? 'active' : ''}" data-id="${a.id}">
      <span class="a-dot ${a.status || 'idle'}"></span>
      <span class="a-name">${esc(a.name)}</span>
      ${(a.workers || 0) > 0 ? `<span class="a-badge">${a.workers}w</span>` : ''}
    </div>`).join('');

  $$('.agent-row').forEach(el => el.addEventListener('click', () => {
    if (_selectAgent) _selectAgent(el.dataset.id);
  }));
}

export function initAgentsHeaderToggle() {
  const header = $('#rail-agents-header');
  const tree   = $('#agent-tree');
  const caret  = $('#rail-agents-caret');
  if (!header || !tree) return;
  let collapsed = false;
  header.addEventListener('click', e => {
    if (e.target.id === 'btn-add-agent') return;
    collapsed = !collapsed;
    tree.style.display = collapsed ? 'none' : '';
    caret.textContent  = collapsed ? '▸' : '▾';
  });
}
