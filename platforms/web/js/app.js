// ── Bootstrap ──────────────────────────────────────────────────────────────
// Imports all modules, wires up event listeners, runs init()

import './i18n.js';
import i18n from './i18n.js';

import { S, setLegionConfig } from './modules/state.js';
import { $, $$ } from './modules/utils.js';
import { loadProjects } from './modules/api.js';

import { renderProjBtn, renderProjList, openProj, closeProj } from './ui/topbar.js';
import { renderTree, initAgentsHeaderToggle, registerSelectAgent } from './ui/sidebar.js';
import { showView, showDash, renderDash, loadVisorBulletins } from './ui/dashboard.js';
import { selectAgent, renderTab } from './ui/agent-panel.js';
import { showCatalog, hideCatalog, renderCatalogFilters, renderCatalogGrid,
         initCatalogFilterListener, setCatalogSearchLocal, syncAddedIds } from './ui/catalog.js';
import { showAnalyze, runAnalyze, getAnalyzeController } from './ui/analyze.js';
import { showTasks, renderProjectTasks, getCurrentTaskSrc } from './ui/tasks-view.js';

import { openModal, closeModal, createProject } from './modals/project-modal.js';

import { showSettings, hideSettings, renderGeneral, renderProviders, renderModels,
         openProviderModal, closeProviderModal, updateProviderModalFields, saveProvider,
         openModelModal, closeModelModal, fetchModelsForModal, saveModel,
         renderIntegrations, showOverview, renderOverview } from './settings/settings.js';

// Register selectAgent for sidebar clicks & team map
registerSelectAgent(selectAgent);
window.__legionSelectAgent = selectAgent;

async function init() {
  await i18n.init();

  // ── Project dropdown ─────────────────────────────────────────────────────
  $('#proj-btn').addEventListener('click', e => { e.stopPropagation(); S.dropOpen ? closeProj() : openProj(); });
  document.addEventListener('click', e => { if (!e.target.closest('.proj-wrap')) closeProj(); });
  $('#proj-search-input').addEventListener('input', e => renderProjList(e.target.value));

  // ── Language toggle ──────────────────────────────────────────────────────
  $('#lang-toggle').addEventListener('click', () => {
    const newLang = i18n.lang === 'en' ? 'ru' : 'en';
    i18n.setLang(newLang);
    import('./modules/state.js').then(m => {
      if (m.catalogLoaded) {
        renderCatalogFilters();
        renderCatalogGrid();
      }
    });
    if (S.agentId) renderTab(S.tab);
  });

  // ── Add agent button in rail ─────────────────────────────────────────────
  $('#btn-add-agent').addEventListener('click', e => {
    e.stopPropagation();
    closeProj();
    showCatalog();
  });

  // ── Catalog ──────────────────────────────────────────────────────────────
  initCatalogFilterListener();
  initAgentsHeaderToggle();
  $('#catalog-back').addEventListener('click', hideCatalog);
  $('#catalog-search').addEventListener('input', e => {
    setCatalogSearchLocal(e.target.value);
    renderCatalogGrid();
  });

  // ── Add project ──────────────────────────────────────────────────────────
  const openNew = () => { closeProj(); openModal(); };
  $('#top-add-btn').addEventListener('click', e => { e.stopPropagation(); openNew(); });
  $('#proj-add-from-menu').addEventListener('click', openNew);

  // ── New project modal ────────────────────────────────────────────────────
  $('#m-cancel').addEventListener('click', closeModal);
  $('#m-create').addEventListener('click', createProject);
  $('#m-name').addEventListener('keydown', e => { if (e.key === 'Enter') createProject(); });
  $('#modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
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

  // ── Agent tabs ───────────────────────────────────────────────────────────
  $$('.a-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.a-tab').forEach(t => t.classList.remove('on'));
      $$('.tab-body').forEach(b => b.classList.remove('on'));
      tab.classList.add('on');
      $(`[data-tab="${tab.dataset.tab}"].tab-body`).classList.add('on');
      renderTab(tab.dataset.tab);
    });
  });

  // ── Rail project items (Overview / Analyze / Tasks) ──────────────────────
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

  // ── Rail nav ─────────────────────────────────────────────────────────────
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

  // ── Settings tabs ─────────────────────────────────────────────────────────
  $$('.s-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.s-tab').forEach(t => t.classList.remove('on'));
      $$('.stab-body').forEach(b => b.classList.remove('on'));
      tab.classList.add('on');
      $(`[data-stab="${tab.dataset.stab}"].stab-body`).classList.add('on');
      if (tab.dataset.stab === 'general')      renderGeneral();
      if (tab.dataset.stab === 'integrations') renderIntegrations();
    });
  });

  // ── Provider modal ────────────────────────────────────────────────────────
  $('#btn-add-provider').addEventListener('click', () => openProviderModal());
  $$('#pm-types .provider-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const currentType = $$('#pm-types .provider-pill').find(p => p.classList.contains('on'))?.dataset.provider;
      const currentName = $('#pm-name').value;
      import('./settings/settings.js').then(({ PROVIDER_META: PM }) => {
        const wasDefault  = !currentName || currentName === (PM[currentType]?.label || '');
        $$('#pm-types .provider-pill').forEach(p => p.classList.remove('on'));
        pill.classList.add('on');
        updateProviderModalFields(pill.dataset.provider);
        if (wasDefault) $('#pm-name').value = PM[pill.dataset.provider]?.label || '';
      });
    });
  });
  $('#pm-cancel').addEventListener('click', closeProviderModal);
  $('#pm-save').addEventListener('click', saveProvider);
  $('#provider-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeProviderModal(); });

  // ── Model modal ───────────────────────────────────────────────────────────
  $('#btn-add-model').addEventListener('click', () => openModelModal());
  $('#mm-fetch-btn').addEventListener('click', fetchModelsForModal);
  $('#mm-cancel').addEventListener('click', closeModelModal);
  $('#mm-save').addEventListener('click', saveModel);
  $('#model-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModelModal(); });
  $('#mm-name').addEventListener('keydown', e => { if (e.key === 'Enter') saveModel(); });

  // ── Tasks source bar + refresh ────────────────────────────────────────────
  $$('.tasks-src-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tasks-src-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      renderProjectTasks(btn.dataset.src);
    });
  });
  $('#btn-tasks-refresh').addEventListener('click', () => {
    renderProjectTasks(getCurrentTaskSrc());
  });

  // ── Visor check button ────────────────────────────────────────────────────
  $('#btn-visor-check').addEventListener('click', async () => {
    const btn = $('#btn-visor-check');
    if (!S.projectId) return;
    btn.disabled = true; btn.textContent = '…';
    try {
      await fetch(`/api/projects/${S.projectId}/visor/check`, { method: 'POST' });
      await loadVisorBulletins();
    } finally { btn.disabled = false; btn.textContent = 'Run Check'; }
  });

  // ── Analyze buttons ───────────────────────────────────────────────────────
  $('#btn-analyze-run').addEventListener('click', runAnalyze);
  $('#btn-analyze-stop').addEventListener('click', () => { getAnalyzeController()?.abort(); });

  // ── Bootstrap data ────────────────────────────────────────────────────────
  setLegionConfig(await fetch('/api/config').then(r => r.json()).catch(() => ({})));

  await loadProjects();
  renderProjBtn();
  renderTree();
  renderDash();
}

document.addEventListener('DOMContentLoaded', () => init());
