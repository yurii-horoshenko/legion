// ── Cron tab ───────────────────────────────────────────────────────────────

import { S } from '../modules/state.js';
import { $, esc } from '../modules/utils.js';
import { tabDescHtml } from '../modules/utils.js';
import { storeGet, storeDel, storePatch, storePost } from '../modules/api.js';
import { showMiniModal, closeMiniModal } from '../modals/mini-modal.js';

export async function renderCron(a) {
  const el = $('#tab-cron');
  const aid = a?.id || S.agentId;
  const desc = tabDescHtml('cron');
  el.innerHTML = desc + `<div class="tab-loading">Loading…</div>`;

  let jobs = await storeGet(aid, 'cron');

  function paint() {
    if (!jobs.length) {
      el.innerHTML = desc + `
        <div class="tab-empty">
          <div class="tab-empty-icon">⏱</div>
          <div class="tab-empty-text">No cron jobs yet</div>
          <button class="btn-tab-add" id="cron-add">+ New job</button>
        </div>`;
    } else {
      el.innerHTML = desc + `
        <div class="store-toolbar">
          <span class="store-count">${jobs.length} job${jobs.length !== 1 ? 's' : ''}</span>
          <button class="btn-tab-add" id="cron-add">+ New job</button>
        </div>
        <div class="cron-list">
          ${jobs.map(j => `
            <div class="cron-row" data-id="${j.id}">
              <div class="cron-info">
                <code class="cron-schedule">${esc(j.schedule || '?')}</code>
                <span class="cron-command">${esc(j.command || '')}</span>
                ${j.channelId ? `<span class="cron-channel">→ ${esc(j.channelId)}</span>` : ''}
              </div>
              <div class="cron-actions">
                <label class="cron-toggle">
                  <input type="checkbox" data-id="${j.id}" ${j.enabled ? 'checked' : ''} />
                  <span class="cron-track"></span>
                </label>
                <span class="cron-status">${j.enabled ? 'Active' : 'Paused'}</span>
                <button class="cron-edit" data-id="${j.id}">Edit</button>
                <button class="cron-del" data-id="${j.id}">Delete</button>
              </div>
            </div>`).join('')}
        </div>`;
    }

    $('#cron-add') && $('#cron-add').addEventListener('click', () => openCronModal(a, null, async () => {
      jobs = await storeGet(aid, 'cron'); paint();
    }));

    el.querySelectorAll('.cron-toggle input').forEach(cb => cb.addEventListener('change', async () => {
      await storePatch(aid, 'cron', cb.dataset.id, { enabled: cb.checked });
      const j = jobs.find(x => x.id === cb.dataset.id);
      if (j) j.enabled = cb.checked;
      paint();
    }));

    el.querySelectorAll('.cron-edit').forEach(btn => btn.addEventListener('click', () => {
      const j = jobs.find(x => x.id === btn.dataset.id);
      if (!j) return;
      openCronModal(a, j, async () => { jobs = await storeGet(aid, 'cron'); paint(); });
    }));

    el.querySelectorAll('.cron-del').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Delete this cron job?')) return;
      await storeDel(aid, 'cron', btn.dataset.id);
      jobs = jobs.filter(x => x.id !== btn.dataset.id);
      paint();
    }));
  }

  paint();
}

export function openCronModal(a, existing, onDone) {
  const aid = a?.id || S.agentId;
  showMiniModal({
    title: existing ? 'Edit Cron Job' : 'New Cron Job',
    fields: [
      { id: 'cron-m-schedule', label: 'Schedule',   placeholder: '*/5 * * * *' },
      { id: 'cron-m-command',  label: 'Command',    placeholder: 'ping' },
      { id: 'cron-m-channel',  label: 'Channel ID', placeholder: 'agent:id:session:…' },
    ],
    onSave: async () => {
      const schedule  = $('#cron-m-schedule').value.trim();
      const command   = $('#cron-m-command').value.trim();
      const channelId = $('#cron-m-channel').value.trim();
      if (!schedule || !command) return;
      if (existing) {
        await storePatch(aid, 'cron', existing.id, { schedule, command, channelId });
      } else {
        await storePost(aid, 'cron', { schedule, command, channelId, enabled: true });
      }
      closeMiniModal();
      onDone && onDone();
    }
  });
  if (existing) {
    setTimeout(() => {
      $('#cron-m-schedule') && ($('#cron-m-schedule').value = existing.schedule || '');
      $('#cron-m-command')  && ($('#cron-m-command').value  = existing.command  || '');
      $('#cron-m-channel')  && ($('#cron-m-channel').value  = existing.channelId || '');
    }, 10);
  }
}
