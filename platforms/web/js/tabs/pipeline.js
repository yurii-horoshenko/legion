// ── Pipeline tab ───────────────────────────────────────────────────────────

import { S } from '../modules/state.js';
import { $, esc } from '../modules/utils.js';
import { tabDescHtml } from '../modules/utils.js';
import { storeGet, storeDel, storePost } from '../modules/api.js';
import { projectAgents } from '../ui/sidebar.js';
import { showMiniModal, closeMiniModal } from '../modals/mini-modal.js';
import i18n from '../i18n.js';

export async function renderPipeline(a) {
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

  let recES = null;
  let recommendations = [];

  function paint() {
    el.innerHTML = desc + `
      <div class="store-toolbar">
        <span class="pipe-toolbar-hint">${esc(i18n.t('pipe_event_task'))}</span>
        <div style="display:flex;gap:8px">
          <button class="btn-tab-secondary" id="pipe-suggest">✦ Suggest</button>
          <button class="btn-tab-add" id="pipe-add">${esc(i18n.t('pipe_add'))}</button>
        </div>
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
          </div>`}
      <div id="pipe-rec-area"></div>`;

    el.querySelector('#pipe-add')?.addEventListener('click', () => openPipelineModal(a, () => renderPipeline(a)));
    el.querySelectorAll('.pipe-del').forEach(btn => btn.addEventListener('click', async () => {
      await storeDel(aid, 'pipeline', btn.dataset.id);
      triggers = triggers.filter(t => t.id !== btn.dataset.id);
      paint();
    }));

    el.querySelector('#pipe-suggest')?.addEventListener('click', () => {
      const btn = el.querySelector('#pipe-suggest');
      const area = $('#pipe-rec-area');
      if (recES) { recES.close(); recES = null; btn.textContent = '✦ Suggest'; return; }

      recommendations = [];
      btn.textContent = '✦ Analysing…';
      area.innerHTML = `<div class="pipe-rec-loading">Analysing team structure…</div>`;

      recES = new EventSource(`/api/projects/${S.projectId}/agents/${aid}/recommend-pipeline`);
      recES.onmessage = e => {
        const d = JSON.parse(e.data);
        if (d.type === 'progress') {
          area.innerHTML = `<div class="pipe-rec-loading">${esc(d.message)}</div>`;
        }
        if (d.type === 'done') {
          recES.close(); recES = null;
          btn.textContent = '✦ Suggest';
          recommendations = d.result?.recommendations || [];
          renderRecs(area);
        }
        if (d.type === 'error') {
          recES.close(); recES = null;
          btn.textContent = '✦ Suggest';
          area.innerHTML = `<div class="pipe-rec-error">⚠ ${esc(d.message)}</div>`;
        }
      };
      recES.onerror = () => {
        recES.close(); recES = null;
        btn.textContent = '✦ Suggest';
        area.innerHTML = `<div class="pipe-rec-error">⚠ Connection error</div>`;
      };
    });

    if (recommendations.length) renderRecs($('#pipe-rec-area'));
  }

  function renderRecs(area) {
    if (!recommendations.length) {
      area.innerHTML = `<div class="pipe-rec-empty">No additional connections recommended for this agent.</div>`;
      return;
    }
    area.innerHTML = `
      <div class="pipe-rec-section">
        <div class="pipe-rec-header">
          <span class="pipe-rec-title">Suggested connections</span>
          <button class="pipe-rec-apply-all" id="pipe-apply-all">Apply all</button>
        </div>
        <div class="pipe-rec-list">
          ${recommendations.map((r, i) => `
            <div class="pipe-rec-card" data-idx="${i}">
              <label class="pipe-rec-check-wrap">
                <input type="checkbox" class="pipe-rec-check" data-idx="${i}" checked>
              </label>
              <div class="pipe-rec-body">
                <div class="pipe-rec-target">${esc(agentName(r.targetAgentId))}</div>
                <div class="pipe-badges" style="margin:4px 0">
                  <span class="pipe-badge pipe-badge-cond">${esc(COND_LABEL[r.condition] || r.condition)}</span>
                  <span class="pipe-badge pipe-badge-mode">${esc(MODE_LABEL[r.mode] || r.mode)}</span>
                </div>
                <div class="pipe-rec-reason">${esc(r.reason)}</div>
              </div>
              <button class="pipe-rec-add" data-idx="${i}">+ Add</button>
            </div>`).join('')}
        </div>
      </div>`;

    area.querySelectorAll('.pipe-rec-add').forEach(btn => btn.addEventListener('click', async () => {
      const rec = recommendations[+btn.dataset.idx];
      if (!rec) return;
      await applyRec(rec);
      btn.closest('.pipe-rec-card').remove();
      recommendations.splice(+btn.dataset.idx, 1);
      if (!area.querySelectorAll('.pipe-rec-card').length) area.innerHTML = '';
    }));

    area.querySelector('#pipe-apply-all')?.addEventListener('click', async () => {
      const checked = [...area.querySelectorAll('.pipe-rec-check:checked')].map(cb => +cb.dataset.idx);
      if (!checked.length) return;
      const btn = area.querySelector('#pipe-apply-all');
      btn.textContent = 'Applying…'; btn.disabled = true;
      for (const idx of checked) {
        if (recommendations[idx]) await applyRec(recommendations[idx]);
      }
      recommendations = recommendations.filter((_, i) => !checked.includes(i));
      triggers = await storeGet(aid, 'pipeline');
      paint();
    });
  }

  async function applyRec(rec) {
    await storePost(aid, 'pipeline', {
      targetAgentId: rec.targetAgentId,
      condition: rec.condition,
      mode: rec.mode,
      event: 'task_complete',
    });
    triggers = await storeGet(aid, 'pipeline');
  }

  paint();
}

export function openPipelineModal(a, onDone) {
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
