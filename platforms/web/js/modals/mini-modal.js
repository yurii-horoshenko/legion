// ── Mini modal (shared) ────────────────────────────────────────────────────

import { $ } from '../modules/utils.js';
import { esc } from '../modules/utils.js';

export function showMiniModal({ title, fields, onSave }) {
  closeMiniModal();
  const el = document.createElement('div');
  el.className = 'overlay on';
  el.id = 'mini-modal-overlay';
  el.innerHTML = `
    <div class="modal">
      <div class="modal-title">${title}</div>
      ${fields.map(f => `
        <div class="field">
          <label class="field-label" for="${f.id}">${f.label}</label>
          ${f.type === 'select'
            ? `<select class="field-input" id="${f.id}">
                ${f.options.map(o => typeof o === 'object'
                  ? `<option value="${esc(o.value)}">${esc(o.label)}</option>`
                  : `<option value="${esc(o)}">${o || '—'}</option>`).join('')}
               </select>`
            : `<input class="field-input" id="${f.id}" type="text" placeholder="${f.placeholder || ''}" />`}
        </div>`).join('')}
      <div class="modal-actions">
        <button class="btn-cancel" id="mini-modal-cancel">Cancel</button>
        <button class="btn-create" id="mini-modal-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) closeMiniModal(); });
  $('#mini-modal-cancel').addEventListener('click', closeMiniModal);
  $('#mini-modal-save').addEventListener('click', onSave);
  const first = el.querySelector('input');
  if (first) setTimeout(() => first.focus(), 50);
}

export function closeMiniModal() {
  const el = $('#mini-modal-overlay');
  if (el) el.remove();
}
