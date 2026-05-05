// ── Channels tab ───────────────────────────────────────────────────────────

import { S } from '../modules/state.js';
import { $, esc } from '../modules/utils.js';
import { tabDescHtml } from '../modules/utils.js';
import { storeGet, storeDel, storePatch, storePost } from '../modules/api.js';
import { showMiniModal, closeMiniModal } from '../modals/mini-modal.js';

export const CHANNEL_TYPES = [
  { type: 'http',    label: 'HTTP API', icon: '⇌' },
  { type: 'webhook', label: 'Webhook',  icon: '⚡' },
  { type: 'mcp',     label: 'MCP',      icon: '⚒' },
];

export async function renderChannels(a) {
  const el = $('#tab-channels');
  const aid = a?.id || S.agentId;
  const desc = tabDescHtml('channels');
  el.innerHTML = desc + `<div class="tab-loading">Loading…</div>`;

  let channels = await storeGet(aid, 'channels');

  function paint() {
    if (!channels.length) {
      el.innerHTML = desc + `
        <div class="tab-empty">
          <div class="tab-empty-icon">⇌</div>
          <div class="tab-empty-text">No channels configured</div>
          <button class="btn-tab-add" id="ch-add">+ Add channel</button>
        </div>`;
    } else {
      el.innerHTML = desc + `
        <div class="store-toolbar">
          <span class="store-count">${channels.length} channel${channels.length !== 1 ? 's' : ''}</span>
          <button class="btn-tab-add" id="ch-add">+ Add channel</button>
        </div>
        <div class="ch-list">
          ${channels.map(ch => {
            const meta = CHANNEL_TYPES.find(t => t.type === ch.type) || { icon: '⇌', label: ch.type };
            return `
            <div class="ch-card ${ch.enabled ? 'ch-on' : 'ch-off'}" data-id="${ch.id}">
              <div class="ch-icon">${meta.icon}</div>
              <div class="ch-info">
                <div class="ch-label">${esc(meta.label)}${ch.name ? ` — ${esc(ch.name)}` : ''}</div>
                ${ch.channelId ? `<div class="ch-id">${esc(ch.channelId)}</div>` : ''}
                ${ch.endpoint  ? `<div class="ch-id">${esc(ch.endpoint)}</div>`  : ''}
              </div>
              <label class="ch-toggle">
                <input type="checkbox" data-id="${ch.id}" ${ch.enabled ? 'checked' : ''}/>
                <span class="ch-toggle-track"></span>
              </label>
              <button class="ch-del" data-id="${ch.id}">✕</button>
            </div>`;
          }).join('')}
        </div>`;
    }

    $('#ch-add') && $('#ch-add').addEventListener('click', () => openChannelModal(a, async () => {
      channels = await storeGet(aid, 'channels');
      paint();
    }));

    el.querySelectorAll('.ch-toggle input').forEach(cb => cb.addEventListener('change', async () => {
      await storePatch(aid, 'channels', cb.dataset.id, { enabled: cb.checked });
      const ch = channels.find(c => c.id === cb.dataset.id);
      if (ch) ch.enabled = cb.checked;
      paint();
    }));

    el.querySelectorAll('.ch-del').forEach(btn => btn.addEventListener('click', async () => {
      await storeDel(aid, 'channels', btn.dataset.id);
      channels = channels.filter(c => c.id !== btn.dataset.id);
      paint();
    }));
  }

  paint();
}

export function openChannelModal(a, onDone) {
  const aid = a?.id || S.agentId;
  showMiniModal({
    title: 'Add Channel',
    fields: [
      { id: 'ch-m-type', label: 'Type', type: 'select',
        options: CHANNEL_TYPES.map(t => t.type) },
      { id: 'ch-m-name', label: 'Name (optional)', placeholder: 'e.g. main-bot' },
      { id: 'ch-m-cid',  label: 'Channel ID / Token', placeholder: '' },
      { id: 'ch-m-ep',   label: 'Endpoint (HTTP/Webhook)', placeholder: 'http://localhost:3000' },
    ],
    onSave: async () => {
      const type      = $('#ch-m-type').value;
      const name      = $('#ch-m-name').value.trim();
      const channelId = $('#ch-m-cid').value.trim();
      const endpoint  = $('#ch-m-ep').value.trim();
      await storePost(aid, 'channels', { type, name, channelId, endpoint, enabled: true });
      closeMiniModal();
      onDone && onDone();
    }
  });
}
