// ── Chat tab ───────────────────────────────────────────────────────────────

import { S, CHAT_STATE } from '../modules/state.js';
import { $, esc, initials, renderMd } from '../modules/utils.js';
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
        <button class="chat-btn chat-btn-clear" id="chat-clear" title="Clear chat history">🗑</button>
      </div>
    </div>`;

  const msgs  = $('#chat-msgs');
  const input = $('#chat-in');
  const btn   = $('#chat-send');

  // ── Per-agent state init ──────────────────────────────────────────────────
  if (!CHAT_STATE[a.id]) {
    CHAT_STATE[a.id] = { introFetched: false, introText: null, messages: [], historyLoaded: false };
  }
  const state = CHAT_STATE[a.id];

  // ── Intro ─────────────────────────────────────────────────────────────────
  const introEl  = document.getElementById('chat-intro-msg');
  const introBub = introEl?.querySelector('.msg-bub');

  if (state.introFetched) {
    if (introBub) {
      if (state.introText) {
        introBub.innerHTML = renderMd(state.introText);
        introBub.style.cssText = '';
      } else {
        introBub.textContent = 'Failed to load introduction';
        introBub.style.color = '#ef4444';
        introBub.style.fontStyle = 'italic';
      }
    }
  } else {
    const introAbort = new AbortController();
    const introTimer = setTimeout(() => introAbort.abort(), 240_000);

    fetch(`/api/projects/${S.projectId}/agents/${a.id}/chat/intro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: i18n.lang }),
      signal: introAbort.signal,
    })
      .then(r => r.json())
      .then(d => {
        clearTimeout(introTimer);
        state.introFetched = true;
        const el  = document.getElementById('chat-intro-msg');
        if (!el) return;
        const bub = el.querySelector('.msg-bub');
        if (d.intro) {
          state.introText = d.intro;
          bub.innerHTML = renderMd(d.intro);
          bub.style.cssText = '';
        } else {
          state.introText = null;
          bub.textContent = d.error || 'Failed to load introduction';
          bub.style.color = '#ef4444';
          bub.style.fontStyle = 'italic';
        }
      })
      .catch(err => {
        clearTimeout(introTimer);
        state.introFetched = true;
        state.introText = null;
        const el  = document.getElementById('chat-intro-msg');
        if (!el) return;
        const bub = el.querySelector('.msg-bub');
        bub.textContent = err.name === 'AbortError' ? 'Request timed out' : `Error: ${err.message}`;
        bub.style.color = '#ef4444';
        bub.style.fontStyle = 'italic';
      });
  }

  // ── Message history ───────────────────────────────────────────────────────
  if (state.messages.length > 0) {
    // Restore DOM from in-memory state (tab switch back)
    state.messages.forEach(m => msgs.insertAdjacentHTML('beforeend', m.html));
    msgs.scrollTop = msgs.scrollHeight;
  } else if (!state.historyLoaded) {
    // First open this session: load history from SQLite via backend
    state.historyLoaded = true;
    fetch(`/api/projects/${S.projectId}/agents/${a.id}/chat/history`)
      .then(r => r.json())
      .then(d => {
        const history = d.history || [];
        if (!history.length) return;
        const sepHtml = `<div style="text-align:center;color:var(--text-3);font-size:0.75rem;margin:8px 0;opacity:0.6">— previous conversation —</div>`;
        msgs.insertAdjacentHTML('beforeend', sepHtml);
        state.messages.push({ html: sepHtml });
        history.forEach(m => {
          const html = m.role === 'user'
            ? `<div class="msg you"><div class="msg-ava" style="background:var(--text);color:var(--bg-card)">YU</div><div class="msg-bub">${esc(m.content)}</div></div>`
            : `<div class="msg agent"><div class="msg-ava" style="background:${ac}18;color:${ac};border:1px solid ${ac}30">${initials(a.name)}</div><div class="msg-bub">${renderMd(m.content)}</div></div>`;
          msgs.insertAdjacentHTML('beforeend', html);
          state.messages.push({ html });
        });
        msgs.scrollTop = msgs.scrollHeight;
      })
      .catch(() => {});
  }

  // ── SSE orchestrator handler ──────────────────────────────────────────────
  async function readOrchestratorSSE(response, bub) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const steps = [];

    const renderProgress = () => {
      if (!bub) return;
      bub.style.cssText = '';
      bub.innerHTML = steps.map(s => {
        if (s.type === 'progress')    return `<div class="orch-step">${esc(s.text)}</div>`;
        if (s.type === 'delegate')    return `<div class="orch-step orch-delegating">→ <b>${esc(s.agentName)}</b>: <em>${esc((s.task || '').slice(0, 80))}${(s.task || '').length > 80 ? '…' : ''}</em></div>`;
        if (s.type === 'agent_reply') return `<div class="orch-step orch-done">← <b>${esc(s.agentName)}</b> responded</div>`;
        if (s.type === 'agent_error') return `<div class="orch-step orch-err">⚠ <b>${esc(s.agentName)}</b>: ${esc(s.error)}</div>`;
        return '';
      }).join('');
      msgs.scrollTop = msgs.scrollHeight;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          let data;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }

          if (data.type === 'reply') {
            if (bub) { bub.innerHTML = renderMd(data.text); bub.style.cssText = ''; }
            return;
          }
          if (data.type === 'error') {
            if (bub) {
              bub.textContent = `Error: ${data.error}`;
              bub.style.color = '#ef4444';
              bub.style.fontStyle = 'italic';
            }
            return;
          }
          steps.push(data);
          renderProgress();
        }
      }
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  async function send() {
    const text = input.value.trim();
    if (!text || btn.disabled) return;

    const userHtml = `<div class="msg you"><div class="msg-ava" style="background:var(--text);color:var(--bg-card)">YU</div><div class="msg-bub">${esc(text)}</div></div>`;
    msgs.insertAdjacentHTML('beforeend', userHtml);
    state.messages.push({ html: userHtml });

    input.value = '';
    input.style.height = 'auto';
    msgs.scrollTop = msgs.scrollHeight;

    const thinkingId = `thinking-${Date.now()}`;
    msgs.insertAdjacentHTML('beforeend', `
      <div class="msg agent" id="${thinkingId}">
        <div class="msg-ava" style="background:${ac}18;color:${ac};border:1px solid ${ac}30">${initials(a.name)}</div>
        <div class="msg-bub" style="color:var(--text-3);font-style:italic">Thinking…</div>
      </div>`);
    msgs.scrollTop = msgs.scrollHeight;
    btn.disabled = true;

    const sendAbort = new AbortController();
    const sendTimer = setTimeout(() => sendAbort.abort(), 300_000);
    try {
      const r = await fetch(`/api/projects/${S.projectId}/agents/${a.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, lang: i18n.lang }),
        signal: sendAbort.signal,
      });
      clearTimeout(sendTimer);

      const el  = document.getElementById(thinkingId);
      const bub = el?.querySelector('.msg-bub');

      if (r.headers.get('content-type')?.includes('text/event-stream')) {
        await readOrchestratorSSE(r, bub);
      } else {
        const d = await r.json();
        if (bub) {
          if (d.reply) { bub.innerHTML = renderMd(d.reply); bub.style.cssText = ''; }
          else { bub.textContent = d.error || 'No response'; bub.style.color = '#ef4444'; bub.style.fontStyle = 'italic'; }
        }
      }
    } catch (err) {
      clearTimeout(sendTimer);
      const el  = document.getElementById(thinkingId);
      const bub = el?.querySelector('.msg-bub');
      if (bub) {
        bub.textContent = err.name === 'AbortError' ? 'Request timed out' : `Error: ${err.message}`;
        bub.style.color = '#ef4444';
        bub.style.fontStyle = 'italic';
      }
    } finally {
      btn.disabled = false;
      msgs.scrollTop = msgs.scrollHeight;
      // Capture final state of the agent bubble for session persistence
      const el = document.getElementById(thinkingId);
      if (el) {
        el.removeAttribute('id');
        state.messages.push({ html: el.outerHTML });
      }
    }
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }

  async function clearChat() {
    await fetch(`/api/projects/${S.projectId}/agents/${a.id}/chat/history`, { method: 'DELETE' });
    state.messages = [];
    state.historyLoaded = true;
    // Remove all messages except intro
    msgs.querySelectorAll('.msg:not(#chat-intro-msg), div[style*="previous conversation"]').forEach(el => el.remove());
  }

  btn.addEventListener('click', send);
  $('#chat-clear').addEventListener('click', clearChat);
  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}
