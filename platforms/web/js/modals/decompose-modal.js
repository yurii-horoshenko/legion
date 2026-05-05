// ── Swarm Decomposition modal ──────────────────────────────────────────────

import { S } from '../modules/state.js';
import { $, esc } from '../modules/utils.js';
import { AGENT_REGISTRY } from '../modules/api.js';
import { renderTasks } from '../tabs/tasks.js';

export function closeSwarmModal() {
  const el = $('#swarm-modal-overlay');
  if (el) el.remove();
}

export function openDecomposeModal(agentId, taskId, taskTitle) {
  closeSwarmModal();
  const el = document.createElement('div');
  el.className = 'overlay on';
  el.id = 'swarm-modal-overlay';
  el.innerHTML = `
    <div class="modal swarm-modal">
      <div class="modal-title">⚡ Decompose Task</div>
      <div class="swarm-task-title">"${esc(taskTitle || taskId)}"</div>
      <div class="swarm-log" id="swarm-log"></div>
      <div class="swarm-result" id="swarm-result"></div>
      <div class="modal-actions">
        <button class="btn-cancel" id="swarm-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) closeSwarmModal(); });
  $('#swarm-close').addEventListener('click', closeSwarmModal);

  const log = $('#swarm-log');
  let lastStep = null;
  function addLog(msg, type = 'step') {
    if (type === 'step' && lastStep) lastStep.classList.add('swarm-log-done');
    const line = document.createElement('div');
    line.className = `swarm-log-row swarm-log-${type}`;
    const icon = type === 'step' ? '›' : type === 'ok' ? '✓' : '✗';
    line.innerHTML = `<span class="swarm-log-icon">${icon}</span><span>${esc(msg)}</span>`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    if (type === 'step') lastStep = line;
    else if (lastStep) { lastStep.classList.add('swarm-log-done'); lastStep = null; }
  }

  (async () => {
    try {
      const res = await fetch(`/api/projects/${S.projectId}/agents/${agentId}/tasks/${taskId}/decompose`, { method: 'POST' });
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';
      let   result  = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'progress') addLog(ev.message, 'step');
            if (ev.type === 'error')    addLog(ev.message, 'err');
            if (ev.type === 'done')     result = ev.result;
          } catch {}
        }
      }

      if (!result) return;
      addLog(`${result.subtasks.length} subtasks created`, 'ok');

      const resultEl = $('#swarm-result');
      if (resultEl) {
        resultEl.innerHTML = `
          ${result.analysis ? `<div class="swarm-analysis">${esc(result.analysis)}</div>` : ''}
          <div class="swarm-subtasks">
            ${result.subtasks.map((s, i) => `
              <div class="swarm-subtask">
                <span class="swarm-order">${i + 1}</span>
                <span class="swarm-mode-badge ${esc(s.swarmMode || 'sequential')}">${(s.swarmMode || 'seq').slice(0, 3)}</span>
                <div class="swarm-subtask-info">
                  <div class="swarm-subtask-title">${esc(s.title)}</div>
                  <div class="swarm-subtask-agent">→ ${esc(s.agentName || s.agentId)}</div>
                </div>
              </div>`).join('')}
          </div>`;
      }

      const closeBtn = $('#swarm-close');
      if (closeBtn) closeBtn.textContent = 'Done';

      const agent = AGENT_REGISTRY[agentId];
      if (agent) setTimeout(() => renderTasks(agent), 300);
    } catch (err) {
      addLog('Error: ' + err.message, 'err');
    }
  })();
}
