// ── Agent Overview tab ─────────────────────────────────────────────────────

import { S, PROJECT_AGENTS, PROJECTS } from '../modules/state.js';
import { $, esc, initials } from '../modules/utils.js';
import { AGENT_REGISTRY, apiRemoveAgent } from '../modules/api.js';
import { renderTree } from '../ui/sidebar.js';
import { showDash } from '../ui/dashboard.js';
import i18n from '../i18n.js';

// addedAgentIds is managed in catalog.js; we need a shared reference
// We'll import a getter from catalog
import { getAddedAgentIds, removeFromAddedIds } from '../ui/catalog.js';

export async function renderAgentOverview(a) {
  const lang   = i18n.lang;
  const locale = a.locales?.[lang] || a.locales?.en || a;
  const desc   = locale.description || a.description || '';
  const vibe   = locale.vibe || a.vibe || '';
  const caps   = a.capabilities || [];

  const el = $('#tab-overview');
  el.innerHTML = `<div class="ov-loading">${esc(i18n.t('ov_loading'))}</div>`;

  const pid = S.projectId;
  const aid = a.id;
  const fetchStore = async (store) => {
    try { const r = await fetch(`/api/projects/${pid}/agents/${aid}/${store}`); return r.ok ? await r.json() : []; }
    catch { return []; }
  };
  const [tasks, memories, channels, cron, pipeline] = await Promise.all([
    fetchStore('tasks'), fetchStore('memories'), fetchStore('channels'),
    fetchStore('cron'),  fetchStore('pipeline'),
  ]);

  const avatarUrl = `/api/projects/${pid}/agents/${aid}/avatar?t=${Date.now()}`;
  let hasAvatar = false;
  try { const r = await fetch(avatarUrl, { method: 'HEAD' }); hasAvatar = r.ok; } catch {}

  const totalTasks    = tasks.length;
  const doneTasks     = tasks.filter(t => /done|completed|closed/i.test(t.status || '')).length;
  const failedTasks   = tasks.filter(t => /fail|rejected|blocked/i.test(t.status || '')).length;
  const inProgTasks   = tasks.filter(t => /progress|active|review/i.test(t.status || '')).length;

  const totalMems     = memories.length;
  const persistMems   = memories.filter(m => m.kind === 'persistent').length;
  const tempMems      = memories.filter(m => m.kind === 'temporary').length;
  const todoMems      = memories.filter(m => m.kind === 'todo').length;

  const activeCron    = cron.filter(c => c.enabled !== false).length;
  const pipeLinks     = pipeline.length;
  const chCount       = channels.length;

  function stat(val) { return Math.min(100, Math.round(Math.max(0, val))); }

  const T = k => i18n.t(k);
  const STATS = [
    {
      key: 'throughput',
      label: T('stat_valor_label'),
      icon: '⚔️',
      formula: T('stat_valor_formula'),
      desc: T('stat_valor_desc'),
      value: stat(totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0),
      color: '#22c55e',
    },
    {
      key: 'autonomy',
      label: T('stat_sorcery_label'),
      icon: '🔮',
      formula: T('stat_sorcery_formula'),
      desc: T('stat_sorcery_desc'),
      value: stat(activeCron * 20),
      color: '#8b5cf6',
    },
    {
      key: 'reach',
      label: T('stat_dominion_label'),
      icon: '🌐',
      formula: T('stat_dominion_formula'),
      desc: T('stat_dominion_desc'),
      value: stat((chCount * 12) + (pipeLinks * 15)),
      color: '#3b82f6',
    },
    {
      key: 'knowledge',
      label: T('stat_lore_label'),
      icon: '📜',
      formula: T('stat_lore_formula'),
      desc: T('stat_lore_desc'),
      value: stat(persistMems * 12),
      color: '#f59e0b',
    },
    {
      key: 'focus',
      label: T('stat_discipline_label'),
      icon: '🎯',
      formula: T('stat_discipline_formula'),
      desc: T('stat_discipline_desc'),
      value: stat(totalMems > 0 ? (persistMems / totalMems) * 100 : 0),
      color: '#06b6d4',
    },
    {
      key: 'soul',
      label: T('stat_soul_label'),
      icon: '✦',
      formula: T('stat_soul_formula'),
      desc: T('stat_soul_desc'),
      value: stat((todoMems + inProgTasks + failedTasks + tempMems) / Math.max(totalTasks + totalMems, 1) * 150),
      color: '#ef4444',
    },
  ];

  function statRow(s, last) {
    const pct = s.value;
    const glow = s.key === 'soul' && pct > 60 ? 'ov-stat-glow' : '';
    return `
      <div class="ov-stat-row ${glow}${last ? ' ov-stat-last' : ''}">
        <span class="ov-stat-icon">${s.icon}</span>
        <span class="ov-stat-name">${s.label}</span>
        <div class="ov-stat-bar-wrap">
          <div class="ov-stat-track">
            <div class="ov-stat-fill" style="width:${pct}%;background:${s.color}"></div>
          </div>
        </div>
        <span class="ov-stat-num" style="color:${s.color}">${pct}</span>
        <span class="ov-stat-info" data-tip="${esc(s.formula)}">ⓘ</span>
      </div>`;
  }

  el.innerHTML = `
    <div class="ov-layout">

      <!-- LEFT: character card -->
      <div class="ov-char">
        <div class="ov-char-frame" id="ov-avatar-wrap">
          <img class="ov-char-img" src="${hasAvatar ? avatarUrl : '/assets/characters/default.png'}" alt="avatar">
          <div class="ov-char-overlay">📷</div>
        </div>
        <input type="file" id="ov-avatar-input" accept="image/*" class="ov-file-hidden">
        <div class="ov-char-name">${esc(a.name)}</div>
        ${vibe ? `<div class="ov-char-vibe">"${esc(vibe)}"</div>` : ''}
        <div class="ov-char-meta">
          <div class="ov-char-meta-row">${esc(a.id)}</div>
          ${a.model ? `<div class="ov-char-meta-row">${esc(a.model)}</div>` : ''}
        </div>
        <button class="btn-danger btn-danger-sm" id="ov-remove-agent">${esc(i18n.t('ov_remove_btn'))}</button>
      </div>

      <!-- RIGHT: info panel -->
      <div class="ov-panel">

        <div class="ov-stats-label">${esc(i18n.t('ov_stats_label'))}</div>
        <div class="ov-stats">
          ${STATS.map((s, i) => statRow(s, i === STATS.length - 1)).join('')}
        </div>

        ${desc || caps.length ? `
        <div class="ov-about">
          ${desc ? `<div class="ov-about-desc">${esc(desc)}</div>` : ''}
          ${caps.length ? `<div class="ov-caps cap-list">${caps.map(c => `<span class="cap">${esc(c)}</span>`).join('')}</div>` : ''}
        </div>` : ''}
      </div>

    </div>`;

  // Avatar upload
  const wrap  = $('#ov-avatar-wrap');
  const input = $('#ov-avatar-input');
  wrap.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    wrap.style.opacity = '0.5';
    await fetch(`/api/projects/${pid}/agents/${aid}/avatar`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    wrap.style.opacity = '';
    renderAgentOverview(a);
  });

  $('#ov-remove-agent').addEventListener('click', async () => {
    if (!confirm(`Remove "${a.name}" from this project?`)) return;
    await apiRemoveAgent(S.projectId, a.id);
    if (PROJECT_AGENTS[S.projectId]) {
      PROJECT_AGENTS[S.projectId] = PROJECT_AGENTS[S.projectId].filter(x => x.id !== a.id);
      const p = PROJECTS.find(x => x.id === S.projectId);
      if (p) p.agents = PROJECT_AGENTS[S.projectId].length;
    }
    delete AGENT_REGISTRY[a.id];
    removeFromAddedIds(a.id);
    S.agentId = null;
    renderTree();
    showDash();
  });
}
