// ── Topbar / Project dropdown ──────────────────────────────────────────────

import { S, PROJECT_AGENTS, PROJECTS } from '../modules/state.js';
import { $, $$, esc } from '../modules/utils.js';
import { loadProjectAgents } from '../modules/api.js';
import { renderTree } from './sidebar.js';
import { showDash } from './dashboard.js';

export function renderProjBtn() {
  const p = PROJECTS.find(x => x.id === S.projectId);
  $('#proj-label').textContent = p ? p.name : '—';
}

export function renderProjList(filter = '') {
  const f = filter.toLowerCase();
  $('#proj-list').innerHTML = PROJECTS
    .filter(p => p.name.toLowerCase().includes(f))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => `
      <div class="proj-item ${p.id === S.projectId ? 'active' : ''}" data-id="${p.id}">
        <span class="proj-item-dot ${p.status || 'ok'}"></span>
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
      // Update addedAgentIds for the new project
      const { syncAddedIds } = await import('./catalog.js');
      syncAddedIds();
      closeProj();
      renderProjBtn();
      renderTree();
      showDash();
    });
  });
}

export function openProj() {
  S.dropOpen = true;
  $('#proj-btn').classList.add('open');
  $('#proj-menu').classList.add('open');
  $('#proj-search-input').value = '';
  renderProjList();
  $('#proj-search-input').focus();
}

export function closeProj() {
  S.dropOpen = false;
  $('#proj-btn').classList.remove('open');
  $('#proj-menu').classList.remove('open');
}
