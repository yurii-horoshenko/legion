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
