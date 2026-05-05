// ── Workers tab ────────────────────────────────────────────────────────────

import { S } from '../modules/state.js';
import { $, esc } from '../modules/utils.js';
import { relTime, tabDescHtml } from '../modules/utils.js';
import { storeGet, storeDel, storePost } from '../modules/api.js';
import { showMiniModal, closeMiniModal } from '../modals/mini-modal.js';

let workersPoll = null;

export function stopWorkersPoll() {
  if (workersPoll) { clearInterval(workersPoll); workersPoll = null; }
}

const WK_STATUS = {
  running: { cls: 'wk-dot-running', label: 'Running' },
  queued:  { cls: 'wk-dot-queued',  label: 'Queued'  },
  done:    { cls: 'wk-dot-done',    label: 'Done'     },
  failed:  { cls: 'wk-dot-failed',  label: 'Failed'   },
};

export async function renderWorkers(a) {
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
        <span class="store-count">${items.length} worker${items.length !== 1 ? 's' : ''}</span>
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

export function openWorkerModal(a) {
  const aid = a?.id || S.agentId;
  showMiniModal({
    title: 'Add Worker',
    fields: [
      { id: 'wk-m-name',   label: 'Name',   placeholder: 'e.g. Design compaction logic' },
      { id: 'wk-m-status', label: 'Status', type: 'select',
        options: ['running', 'queued', 'done', 'failed'] },
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
