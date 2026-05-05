// ── Agent catalog ─────────────────────────────────────────────────────────

import { S, PROJECT_AGENTS, PROJECTS, AGENT_REGISTRY, CATALOG_AGENTS, addedAgentIds,
         setCatalogAgents, setCatalogLoaded, catalogLoaded, catalogFilter, catalogSearch,
         setAddedAgentIds } from '../modules/state.js';
import { $, $$, esc } from '../modules/utils.js';
import { apiAddAgent } from '../modules/api.js';
import { renderTree } from './sidebar.js';
import { showView, showDash } from './dashboard.js';
// selectAgent imported lazily to avoid circular with overview.js
import i18n from '../i18n.js';

export function getAddedAgentIds() { return addedAgentIds; }
export function removeFromAddedIds(id) { addedAgentIds.delete(id); }

export function syncAddedIds() {
  setAddedAgentIds(new Set((PROJECT_AGENTS[S.projectId] || []).map(a => a.id)));
}

export async function loadCatalog() {
  if (!catalogLoaded) {
    try {
      const res = await fetch('/data/agents-catalog.json');
      setCatalogAgents(await res.json());
      setCatalogLoaded(true);
    } catch (e) {
      console.warn('Could not load agents-catalog.json', e);
    }
  }
  renderCatalogFilters();
  renderCatalogGrid();
}

export function catalogGroups() {
  return ['All', ...new Set(CATALOG_AGENTS.map(a => a.group))];
}

export async function showCatalog() {
  showView('view-catalog');
  const el = $('#catalog-proj-name');
  if (el) el.textContent = PROJECTS.find(p => p.id === S.projectId)?.name || '—';
  await loadCatalog();
}

export function hideCatalog() {
  showDash();
}

export function renderCatalogFilters() {
  $('#catalog-filters').innerHTML = catalogGroups().map(g =>
    `<button class="cat-filter ${catalogFilter === g ? 'on' : ''}" data-group="${g}">${g}</button>`
  ).join('');
}

// Delegated — survives innerHTML re-renders
export function initCatalogFilterListener() {
  const filtersEl = $('#catalog-filters');
  if (!filtersEl) return;
  filtersEl.addEventListener('click', e => {
    const btn = e.target.closest('.cat-filter');
    if (!btn) return;
    // update catalogFilter in state
    import('../modules/state.js').then(({ setCatalogFilter }) => {
      // We do a direct module-level variable update trick via state
      // Since setCatalogFilter isn't in state yet we manage it locally
    });
    // For now: toggle classes and re-render using a closure variable
    const newFilter = btn.dataset.group;
    $$('.cat-filter').forEach(b => b.classList.toggle('on', b.dataset.group === newFilter));
    // Update module-level filter via the setter below
    _setCatalogFilter(newFilter);
    renderCatalogGrid();
  });
}

// Internal mutable filter state (mirrors state.js catalogFilter as init value)
let _catalogFilter = catalogFilter;
let _catalogSearch = catalogSearch;

function _setCatalogFilter(v) { _catalogFilter = v; }
export function setCatalogSearchLocal(v) { _catalogSearch = v; }

export function renderCatalogGrid() {
  const q = _catalogSearch.toLowerCase();
  const agents = CATALOG_AGENTS.filter(a => {
    const matchGroup  = _catalogFilter === 'All' || a.group === _catalogFilter;
    const matchSearch = !q || a.name.toLowerCase().includes(q) || (a.role || '').toLowerCase().includes(q) || a.capabilities.some(c => c.toLowerCase().includes(q));
    return matchGroup && matchSearch;
  });

  const total = CATALOG_AGENTS.length;
  const shown = agents.length;
  const projNameEl = $('#catalog-proj-name');
  if (projNameEl) projNameEl.textContent = PROJECTS.find(p => p.id === S.projectId)?.name || '—';
  const sub = $('#view-catalog .dash-meta');
  if (sub) sub.textContent = `${shown} of ${total} agents${_catalogFilter !== 'All' ? ` in ${_catalogFilter}` : ''}${q ? ` matching "${q}"` : ''}`;

  $('#catalog-grid').innerHTML = agents.map(a => {
    const added = addedAgentIds.has(a.id);
    const lang = i18n.lang;
    const locale = (a.locales && a.locales[lang]) ? a.locales[lang] : (a.locales && a.locales.en) || a;
    const desc = locale.description || a.description;
    const vibe = locale.vibe || a.vibe || a.group;
    const emoji = locale.emoji || a.emoji || '🤖';
    return `
    <div class="catalog-card ${added ? 'added' : ''}" data-id="${a.id}" style="--agent-color:${a.color}">
      <div class="cat-card-top">
        <div class="cat-ava" style="background:${a.color}18;color:${a.color};border:1px solid ${a.color}30">${esc(emoji)}</div>
        <div class="cat-card-info">
          <div class="cat-name">${esc(locale.name || a.name)}</div>
          <div class="cat-role" style="color:${a.color}">${esc(vibe)}</div>
        </div>
      </div>
      <div class="cat-desc">${esc(desc)}</div>
      <div class="cat-card-foot">
        <button class="cat-add-btn ${added ? 'added' : ''}" data-id="${a.id}">
          ${added ? i18n.t('catalog_added') : i18n.t('catalog_add')}
        </button>
      </div>
    </div>`;
  }).join('');

  $$('.cat-add-btn:not(.added)').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const agent = CATALOG_AGENTS.find(a => a.id === id);
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
      // Use window global to avoid circular import
      if (window.__legionSelectAgent) window.__legionSelectAgent(id);
    });
  });
}
