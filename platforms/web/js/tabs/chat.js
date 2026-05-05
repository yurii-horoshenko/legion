// ── Chat tab ───────────────────────────────────────────────────────────────

import { S } from '../modules/state.js';
import { $, esc, initials } from '../modules/utils.js';
import { tabDescHtml } from '../modules/utils.js';
import i18n from '../i18n.js';

export function renderChat(a) {
  const ac = a.color || '#6366F1';
  $('#tab-chat').innerHTML = tabDescHtml('chat') + `
    <div class="chat-wrap">
      <div class="chat-msgs" id="chat-msgs">
        <div class="msg agent" id="chat-intro-msg">
          <div class="msg-ava" style="background:${ac}18;color:${ac};border:1px solid ${ac}30">${initials(a.name)}</div>
          <div class="msg-bub" style="color:var(--text-3);font-style:italic">…</div>
        </div>
      </div>
      <div class="chat-foot">
        <textarea class="chat-in" id="chat-in" rows="1" placeholder="Send a message…"></textarea>
        <button class="chat-btn" id="chat-send">Send</button>
      </div>
    </div>`;

  fetch(`/api/projects/${S.projectId}/agents/${a.id}/chat/intro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang: i18n.lang }),
  })
    .then(r => r.json())
    .then(d => {
      const introEl = document.getElementById('chat-intro-msg');
      if (!introEl) return;
      const bub = introEl.querySelector('.msg-bub');
      if (d.intro) {
        bub.textContent = d.intro;
        bub.style.cssText = '';
      } else {
        bub.textContent = d.error || 'Failed to load introduction';
        bub.style.color = '#ef4444';
        bub.style.fontStyle = 'italic';
      }
    })
    .catch(err => {
      const introEl = document.getElementById('chat-intro-msg');
      if (introEl) {
        const bub = introEl.querySelector('.msg-bub');
        bub.textContent = `Error: ${err.message}`;
        bub.style.color = '#ef4444';
        bub.style.fontStyle = 'italic';
      }
    });

  const input = $('#chat-in'), btn = $('#chat-send'), msgs = $('#chat-msgs');

  async function send() {
    const text = input.value.trim();
    if (!text || btn.disabled) return;
    msgs.insertAdjacentHTML('beforeend', `
      <div class="msg you">
        <div class="msg-ava" style="background:var(--text);color:var(--bg-card)">YU</div>
        <div class="msg-bub">${esc(text)}</div>
      </div>`);
    input.value = '';
    msgs.scrollTop = msgs.scrollHeight;

    const thinkingId = `thinking-${Date.now()}`;
    msgs.insertAdjacentHTML('beforeend', `
      <div class="msg agent" id="${thinkingId}">
        <div class="msg-ava" style="background:${ac}18;color:${ac};border:1px solid ${ac}30">${initials(a.name)}</div>
        <div class="msg-bub" style="color:var(--text-3);font-style:italic">Thinking…</div>
      </div>`);
    msgs.scrollTop = msgs.scrollHeight;
    btn.disabled = true;

    try {
      const r = await fetch(`/api/projects/${S.projectId}/agents/${a.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, lang: i18n.lang }),
      });
      const d = await r.json();
      const el = document.getElementById(thinkingId);
      if (el) {
        const bub = el.querySelector('.msg-bub');
        if (d.reply) {
          bub.textContent = d.reply;
          bub.style.cssText = '';
        } else {
          bub.textContent = d.error || 'No response';
          bub.style.color = '#ef4444';
          bub.style.fontStyle = 'italic';
        }
      }
    } catch (err) {
      const el = document.getElementById(thinkingId);
      if (el) {
        const bub = el.querySelector('.msg-bub');
        bub.textContent = `Error: ${err.message}`;
        bub.style.color = '#ef4444';
        bub.style.fontStyle = 'italic';
      }
    } finally {
      btn.disabled = false;
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  btn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}
