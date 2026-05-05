// ── Memories tab ───────────────────────────────────────────────────────────

import { S } from '../modules/state.js';
import { $, esc } from '../modules/utils.js';
import { relTime, tabDescHtml } from '../modules/utils.js';
import { storeGet, storeDel, storePost } from '../modules/api.js';
import { showMiniModal, closeMiniModal } from '../modals/mini-modal.js';

const MEM_KINDS = ['all', 'persistent', 'temporary', 'todo'];
const MEM_KIND_LABEL = { rule: 'Rule', persistent: 'Persistent', temporary: 'Temporary', todo: 'Todo' };

export async function syncMemoryFile(agentId, memories) {
  const sections = { rule: [], persistent: [], temporary: [], todo: [] };
  for (const m of memories) {
    const k = m.kind || 'persistent';
    (sections[k] || sections.persistent).push(m);
  }
  const lines = ['# Memory\n'];
  if (sections.rule.length) {
    lines.push('## Startup Instructions');
    sections.rule.forEach(m => lines.push(`- ${m.note || m.text || ''}`));
    lines.push('');
  }
  if (sections.persistent.length) {
    lines.push('## Persistent');
    sections.persistent.forEach(m => {
      const imp = m.importance != null ? ` *(importance: ${m.importance})*` : '';
      lines.push(`- ${m.note || m.text || ''}${imp}`);
    });
    lines.push('');
  }
  if (sections.temporary.length) {
    lines.push('## Temporary');
    sections.temporary.forEach(m => lines.push(`- ${m.note || m.text || ''}`));
    lines.push('');
  }
  if (sections.todo.length) {
    lines.push('## Todo');
    sections.todo.forEach(m => lines.push(`- [ ] ${m.note || m.text || ''}`));
    lines.push('');
  }
  await fetch(`/api/projects/${S.projectId}/agents/${agentId}/files/MEMORY.md`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: lines.join('\n').trim() }),
  });
}

function memSectionKind(heading) {
  const h = heading.toLowerCase();
  if (/startup|instruction|rule|always|before/i.test(h)) return 'rule';
  if (/todo|task|action/i.test(h))                       return 'todo';
  if (/temp|short|session|thread|open/i.test(h))         return 'temporary';
  return 'persistent';
}

export async function importMemoriesFromFile(agentId) {
  try {
    const res = await fetch(`/api/projects/${S.projectId}/agents/${agentId}/files/MEMORY.md`);
    if (!res.ok) return [];
    const text = await res.text();
    const result = [];
    let kind = 'persistent';
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      const headM = line.match(/^#{1,3}\s+(.+)/);
      if (headM) { kind = memSectionKind(headM[1]); continue; }
      const todoM   = line.match(/^-\s*\[\s*\]\s+(.+)/);
      const bulletM = line.match(/^-\s+(.+)/);
      if (!todoM && !bulletM) continue;
      const raw_note = (todoM || bulletM)[1];
      if (/^_[^_]+_$/.test(raw_note.trim())) continue;
      const impM = raw_note.match(/\*\(importance:\s*([\d.]+)\)\*\s*$/);
      const note = raw_note.replace(/\s*\*\(importance:[\s\d.]+\)\*\s*$/, '').trim();
      const importance = impM ? parseFloat(impM[1]) : 0.5;
      result.push({ note, kind: todoM ? 'todo' : kind, importance });
    }
    return result;
  } catch { return []; }
}

export async function renderMemories(a) {
  const el = $('#tab-memories');
  const aid = a?.id || S.agentId;
  const desc = tabDescHtml('memories');
  el.innerHTML = desc + `<div class="tab-loading">Loading…</div>`;

  let all = await storeGet(aid, 'memories');

  if (!all.length) {
    const imported = await importMemoriesFromFile(aid);
    for (const m of imported) await storePost(aid, 'memories', m);
    if (imported.length) all = await storeGet(aid, 'memories');
  }

  let filter = 'all';

  function paint() {
    const rules   = all.filter(m => m.kind === 'rule');
    const nonRule = filter === 'all'
      ? all.filter(m => m.kind !== 'rule')
      : all.filter(m => m.kind === filter);

    el.innerHTML = desc + `
      <div class="mem-rules-section">
        <div class="mem-rules-header">
          <span class="mem-rules-icon">⚡</span>
          <span class="mem-rules-title">Startup Rules</span>
          <span class="mem-rules-hint">Agent reads these before every session</span>
        </div>
        ${rules.length ? `<div class="mem-rules-list">${rules.map(m => `
          <div class="mem-rule-card" data-id="${m.id}">
            <span class="mem-rule-text">${esc(m.note || m.text || '')}</span>
            <button class="mem-del mem-rule-del" data-id="${esc(m.id)}">✕</button>
          </div>`).join('')}</div>` : `
          <div class="mem-rules-empty">No startup rules yet.</div>`}
        <div class="mem-rule-add-row">
          <input class="mem-rule-input" id="mem-rule-input"
            placeholder="e.g. Always read /docs/architecture.md before starting" />
          <button class="mem-rule-add-btn" id="mem-rule-add">+ Add</button>
        </div>
      </div>

      <div class="store-toolbar">
        <div class="mem-filters">
          ${MEM_KINDS.map(k => `<button class="mem-filter${k === filter ? ' on' : ''}" data-kind="${k}">${k === 'all' ? 'All' : MEM_KIND_LABEL[k] || k}</button>`).join('')}
        </div>
        <button class="btn-tab-add" id="mem-add">+ Add</button>
      </div>
      ${!nonRule.length ? `<div class="tab-empty"><div class="tab-empty-icon">◎</div><div class="tab-empty-text">No memories yet</div></div>` : `
      <div class="mem-list">
        ${nonRule.map(m => `
          <div class="mem-card" data-id="${m.id}">
            <div class="mem-head">
              <span class="mem-badge ${esc(m.kind || 'persistent')}">${esc(MEM_KIND_LABEL[m.kind] || m.kind || 'Persistent')}</span>
              <span class="mem-time">${relTime(m.updatedAt || m.createdAt)}</span>
              <button class="mem-del" data-id="${esc(m.id)}">✕</button>
            </div>
            <div class="mem-text">${esc(m.note || m.text || '')}</div>
            ${m.summary ? `<div class="mem-summary">${esc(m.summary)}</div>` : ''}
            ${(m.importance || m.confidence) ? `<div class="mem-meta">
              ${m.importance ? `<span>importance: ${esc(String(m.importance))}</span>` : ''}
              ${m.confidence ? `<span>confidence: ${esc(String(m.confidence))}</span>` : ''}
            </div>` : ''}
          </div>`).join('')}
      </div>`}`;

    el.querySelectorAll('.mem-filter').forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.kind;
      paint();
    }));

    el.querySelectorAll('.mem-del').forEach(btn => btn.addEventListener('click', async () => {
      await storeDel(aid, 'memories', btn.dataset.id);
      all = all.filter(m => m.id !== btn.dataset.id);
      await syncMemoryFile(aid, all);
      paint();
    }));

    $('#mem-add') && $('#mem-add').addEventListener('click', () => openMemoryModal(a, () => {
      renderMemories(a);
    }));

    const ruleInput = $('#mem-rule-input');
    const ruleBtn   = $('#mem-rule-add');

    async function addRule() {
      const note = ruleInput?.value.trim();
      if (!note) return;
      ruleInput.value = '';
      ruleInput.disabled = true;
      if (ruleBtn) ruleBtn.disabled = true;
      const item = await storePost(aid, 'memories', { note, kind: 'rule', importance: 1 });
      all.push(item);
      await syncMemoryFile(aid, all);
      ruleInput.disabled = false;
      if (ruleBtn) ruleBtn.disabled = false;
      paint();
      $('#mem-rule-input')?.focus();
    }

    ruleInput?.addEventListener('keydown', e => { if (e.key === 'Enter') addRule(); });
    ruleBtn?.addEventListener('click', addRule);
  }

  paint();
}

export function openMemoryModal(a, onDone) {
  const aid = a?.id || S.agentId;
  showMiniModal({
    title: 'Add Memory',
    fields: [
      { id: 'mem-m-note',       label: 'Note',             placeholder: 'What to remember…' },
      { id: 'mem-m-kind',       label: 'Kind', type: 'select', options: ['persistent', 'temporary', 'todo', 'rule'] },
      { id: 'mem-m-importance', label: 'Importance (0–1)', placeholder: '0.8' },
    ],
    onSave: async () => {
      const note       = $('#mem-m-note').value.trim();
      const kind       = $('#mem-m-kind').value;
      const importance = parseFloat($('#mem-m-importance').value) || 0.5;
      if (!note) return;
      await storePost(aid, 'memories', { note, kind, importance });
      const all = await storeGet(aid, 'memories');
      await syncMemoryFile(aid, all);
      closeMiniModal();
      onDone && onDone();
    }
  });
}
