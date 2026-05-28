// ── Agent Overview tab ─────────────────────────────────────────────────────

import { S, PROJECT_AGENTS, PROJECTS, CHAT_STATE } from '../modules/state.js';
import { $, esc } from '../modules/utils.js';
import { AGENT_REGISTRY } from '../modules/state.js';
import { apiRemoveAgent } from '../modules/api.js';
import { renderTree } from '../ui/sidebar.js';
import { showDash } from '../ui/dashboard.js';
import i18n from '../i18n.js';
import { removeFromAddedIds } from '../ui/catalog.js';
import { getAgentCharacter } from '../modules/agent-characters.js';

const RANK_NAMES = [
  'Recruit','Apprentice','Apprentice','Operative','Operative',
  'Specialist','Specialist','Specialist','Expert','Expert',
  'Expert','Expert','Veteran','Veteran','Veteran','Veteran','Master',
];

// Extracts real (non-template) content metrics from a markdown file string
function parseFile(raw) {
  const text  = raw || '';
  const lines = text.split('\n');

  const real = lines.filter(l => {
    const t = l.trim();
    if (!t) return false;
    if (t.startsWith('#')) return false;                         // section headers
    if (/^_.*_$/.test(t)) return false;                         // italic placeholder lines
    if (/^max\s*~/i.test(t)) return false;                      // "Max ~3000 chars"
    if (/^(updated|read)\s+by\s/i.test(t)) return false;        // template instructions
    if (/^(the\s+model|long-form|project-specific)/i.test(t)) return false;
    return true;
  });

  const words     = real.join(' ').split(/\s+/).filter(Boolean).length;
  const bullets   = real.filter(l => /^[-*•]\s|\d+\.\s/.test(l.trim())).length;
  const sections  = (text.match(/^#{1,3}\s/gm) || []).length;
  const todos     = (text.match(/\bTODO\b|\bTBD\b/g) || []).length;
  // Table data rows — captures tool/invocation tables in SKILLS.md (| Tool | ... |)
  const tableRows = real.filter(l => /^\|/.test(l.trim()) && !/^\|[-\s|:]+\|/.test(l.trim())).length;

  return { words, bullets, sections, todos, tableRows };
}

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
    try { const r = await fetch(`/api/projects/${pid}/agents/${aid}/${store}`); return r.ok ? r.json() : []; }
    catch { return []; }
  };
  const fetchFile = async (name) => {
    try {
      const r = await fetch(`/api/projects/${pid}/agents/${aid}/files/${name}`);
      if (!r.ok) return '';
      return (await r.json()).content || '';
    } catch { return ''; }
  };

  const [storeData, fileData, chatStats, agentStats, hasAvatar] = await Promise.all([
    Promise.all([fetchStore('tasks'), fetchStore('memories'), fetchStore('channels'), fetchStore('cron'), fetchStore('pipeline')]),
    Promise.all([fetchFile('IDENTITY.md'), fetchFile('SOUL.md'), fetchFile('CONTEXT.md'), fetchFile('MEMORY.md'), fetchFile('SKILLS.md'), fetchFile('USER.md')]),
    fetch(`/api/projects/${pid}/agents/${aid}/chat-stats`).then(r => r.ok ? r.json() : { replies: 0, errors: 0 }).catch(() => ({ replies: 0, errors: 0 })),
    fetch(`/api/projects/${pid}/agents/${aid}/stats`).then(r => r.ok ? r.json() : { attempted: 0, succeeded: 0, failures: [] }).catch(() => ({ attempted: 0, succeeded: 0, failures: [] })),
    fetch(`/api/projects/${pid}/agents/${aid}/avatar`, { method: 'HEAD' }).then(r => r.ok).catch(() => false),
  ]);

  const [tasks, memories, channels, cron, pipeline]                    = storeData;
  const [fIdentity, fSoul, fContext, fMemory, fSkills, fUser]          = fileData;
  const chatReplies = chatStats.replies || 0;
  const chatErrors  = chatStats.errors  || 0;
  const avatarUrl = `/api/projects/${pid}/agents/${aid}/avatar?t=${Date.now()}`;

  // ── Runtime data ──────────────────────────────────────────────────────────
  const totalTasks  = tasks.length;
  const doneTasks   = tasks.filter(t => /done|completed|closed/i.test(t.status || '')).length;
  const failedTasks = tasks.filter(t => /fail|rejected|blocked/i.test(t.status || '')).length;
  const inProgTasks = tasks.filter(t => /progress|active|review/i.test(t.status || '')).length;

  const totalMems   = memories.length;
  const persistMems = memories.filter(m => m.kind === 'persistent').length;
  const tempMems    = memories.filter(m => m.kind === 'temporary').length;
  const todoMems    = memories.filter(m => m.kind === 'todo').length;

  const activeCron  = cron.filter(c => c.enabled !== false).length;
  const pipeLinks   = pipeline.length;
  const smartPipes  = pipeline.filter(p => p.condition === 'on_success').length;
  const chCount     = channels.length;
  const skillCount  = (a.skills || []).length;

  // ── Agent age ─────────────────────────────────────────────────────────────
  const ageDays = a.added ? Math.floor((Date.now() - new Date(a.added).getTime()) / 86400000) : -1;

  // ── File analysis ─────────────────────────────────────────────────────────
  const id = parseFile(fIdentity);
  const so = parseFile(fSoul);
  const cx = parseFile(fContext);
  const me = parseFile(fMemory);
  const sk = parseFile(fSkills);
  const us = parseFile(fUser);

  const descLen       = desc.length;
  // Count integration/API keywords in CONTEXT.md — shows how connected this agent's world is
  const integKeywords = (fContext.match(/\b(api|webhook|oauth|slack|github|linear|jira|notion|discord|telegram|database|redis|sql|graphql|http|rest|endpoint)\b/gi) || []).length;
  const allTodos      = id.todos + so.todos + cx.todos + me.todos + sk.todos;

  // No upper cap — 100 is a milestone (bar fills), stats can grow beyond it
  function stat(v) { return Math.round(Math.max(0, v)); }

  // ── Stat formulas ─────────────────────────────────────────────────────────
  // Target ranges: fresh well-configured agent 50–80 · active agent 80–120 · elite 120+

  // Valor — identity depth (words + execution rule bullets) + task track record
  // 100-word identity + 3 exec rules = ~60 base; perfect completion on 20 tasks = +80 → ~140
  const valor = stat(
    id.words * 0.5 +
    id.bullets * 3 +
    (totalTasks > 0 ? (doneTasks / totalTasks) * 80 : 0)
  );

  // Sorcery — assigned skills + tool table rows in SKILLS.md + bullets + cron
  // Real agents use ### headers (not bullets) and | table | rows for tools — count both
  // 8 skills + 17 table rows ≈ 74; 9 skills + 20 table rows + 1 cron ≈ 95
  const sorcery = stat(skillCount * 5 + sk.tableRows * 2 + sk.bullets * 3 + activeCron * 10);

  // Dominion — channels, pipelines, integration keywords in CONTEXT.md + user context
  // 2 pipelines + 10 keywords + context + user = ~77; 5 channels + 5 pipelines ≈ 134
  const dominion = stat(
    chCount * 12 + pipeLinks * 10 + integKeywords * 3 +
    (cx.words > 50 ? 15 : cx.words > 20 ? 8 : 0) +
    (us.words > 20 ? 12 : 0) +
    smartPipes * 5
  );

  // Lore — persistent memories + MEMORY.md + CONTEXT.md + USER.md domain knowledge
  // 90 MEMORY words + 180 CONTEXT words + 75 USER words ≈ 129; sparse ≈ 15–40
  const lore = stat(persistMems * 8 + me.words * 0.5 + cx.words * 0.3 + us.words * 0.4);

  // Soul — values/personality in SOUL.md + description richness
  // 7 bullets + 4 sections + 200-char desc ≈ 87; sparse ≈ 15–30
  const soul = stat(so.bullets * 5 + so.sections * 8 + descLen * 0.1);

  // Discipline — structural completeness across ALL config files + USER.md + pipeline
  // All files filled + USER.md + 2 pipeline links ≈ 79; sparse (only IDENTITY+SOUL) ≈ 20–35
  const discipline = stat(
    id.sections * 4 + so.sections * 3 + sk.sections * 3 + cx.sections * 2 +
    (us.words > 15 ? 15 : us.words > 0 ? 8 : 0) +
    (me.words > 30 ? 10 : 0) +
    (pipeLinks > 0 ? Math.min(pipeLinks * 4, 20) : 0) +
    (totalMems > 0 ? (persistMems / totalMems) * 30 : 0)
  );

  // Disorientation — chaos: TODOs, file failures, stuck tasks, low-quality memories, chat errors
  const disorient = stat(allTodos * 8 + failedTasks * 20 + inProgTasks * 8 + tempMems * 6 + todoMems * 4 + chatErrors * 10);

  // ── Level / XP ────────────────────────────────────────────────────────────
  // XP comes from real chat interactions (chat_logs), not artificial task records
  const xp    = chatReplies * 50;
  const level = Math.floor(Math.sqrt(xp / 80));
  const xpCur = level * level * 80;
  const xpNxt = (level + 1) * (level + 1) * 80;
  const xpPct = Math.round((xp - xpCur) / Math.max(1, xpNxt - xpCur) * 100);

  // ── Stars (0–5) ──────────────────────────────────────────────────────────
  // Stars reflect quality: how clean is the agent's work (low errors) + how active
  const errorRate = (chatReplies + chatErrors) > 0 ? chatErrors / (chatReplies + chatErrors) : 0;
  const perf  = chatReplies > 0 ? (1 - errorRate) * 100 * 0.6 + Math.max(0, 100 - disorient) * 0.4 : 0;
  const stars = Math.min(5, Math.max(0, Math.ceil(perf / 20)));

  const rank = RANK_NAMES[Math.min(level, RANK_NAMES.length - 1)];

  const T = k => i18n.t(k);
  const STATS = [
    { key: 'valor',      label: T('stat_valor_label'),     icon: '⚔️', formula: T('stat_valor_formula'),     value: valor,     color: '#22c55e' },
    { key: 'sorcery',    label: T('stat_sorcery_label'),   icon: '🔮', formula: T('stat_sorcery_formula'),   value: sorcery,   color: '#8b5cf6' },
    { key: 'dominion',   label: T('stat_dominion_label'),  icon: '🌐', formula: T('stat_dominion_formula'),  value: dominion,  color: '#3b82f6' },
    { key: 'lore',       label: T('stat_lore_label'),      icon: '📜', formula: T('stat_lore_formula'),      value: lore,      color: '#f59e0b' },
    { key: 'soul',       label: T('stat_soul_label'),      icon: '✦',  formula: T('stat_soul_formula'),      value: soul,      color: '#ef4444' },
    { key: 'discipline', label: T('stat_discipline_label'),icon: '🎯', formula: T('stat_discipline_formula'),value: discipline, color: '#06b6d4' },
    { key: 'disorient',  label: T('stat_disorient_label'), icon: '🌀', formula: T('stat_disorient_formula'), value: disorient, color: '#f97316' },
  ];

  function statRow(s, last) {
    // Disorient bar is inverted: high chaos = empty bar (visual warning), number stays honest
    const barPct = s.key === 'disorient'
      ? Math.max(0, 100 - Math.min(100, s.value))
      : Math.min(100, s.value);
    let glowCls = '';
    if (s.key === 'soul'     && s.value > 80) glowCls = 'ov-stat-glow';
    if (s.key === 'disorient'&& s.value > 60) glowCls = 'ov-stat-disorient-glow';
    return `
      <div class="ov-stat-row ${glowCls}${last ? ' ov-stat-last' : ''}">
        <span class="ov-stat-icon">${s.icon}</span>
        <span class="ov-stat-name">${s.label}</span>
        <div class="ov-stat-bar-wrap">
          <div class="ov-stat-track">
            <div class="ov-stat-fill" style="width:${barPct}%;background:${s.color}"></div>
          </div>
        </div>
        <span class="ov-stat-num" style="color:${s.color}">${s.value}</span>
        <span class="ov-stat-info" data-tip="${esc(s.formula)}">ⓘ</span>
      </div>`;
  }

  // ── Contextual insights ───────────────────────────────────────────────────
  const insights = [];
  if (disorient > 60 && soul > 40)                       insights.push({ t: 'warn', msg: T('insight_disorient_soul') });
  if (totalTasks > 3 && doneTasks < totalTasks * 0.25)   insights.push({ t: 'warn', msg: T('insight_stuck') });
  if ((me.words + cx.words) < 30 && totalTasks > 5)      insights.push({ t: 'warn', msg: T('insight_no_lore') });
  if (us.words === 0)                                     insights.push({ t: 'warn', msg: T('insight_no_user') });
  if (valor > 90 && lore > 70)                           insights.push({ t: 'good', msg: T('insight_peak') });
  if (sorcery > 80 && dominion > 60)                     insights.push({ t: 'good', msg: T('insight_network') });
  // ADR-0005: surface a recurring failure pattern as a weakness insight.
  const _recur = (agentStats.failures || []).find(f => (f.count || 0) >= 2);
  if (_recur) insights.push({ t: 'warn', msg: `Recurring failure: ${_recur.pattern} (×${_recur.count})` });

  // ── Frame color reflects overall health ───────────────────────────────────
  let frameStyle = '';
  if (valor > 70)          frameStyle = 'border:2px solid #22c55e;';
  else if (disorient > 70) frameStyle = 'border:2px solid #f59e0b;';

  const starsHtml = Array.from({ length: 5 }, (_, i) =>
    `<span class="ov-star${i < stars ? ' ov-star-on' : ''}">★</span>`).join('');

  // ── Activity summary ──────────────────────────────────────────────────────
  const ageStr = ageDays < 0  ? '' :
                 ageDays === 0 ? T('ov_act_age_today') :
                 ageDays === 1 ? T('ov_act_age_1day') :
                 i18n.t('ov_act_age_days', { n: ageDays });

  // Chat-based activity line — reflects real work from chat_logs
  const tasksLine = chatReplies === 0
    ? `<span class="ov-act-dim">${T('ov_act_no_tasks')}</span>`
    : `<span class="ov-act-done">${chatReplies} ${T('ov_act_replies')}</span>`
    + (chatErrors > 0 ? ` <span class="ov-act-sep">·</span> <span class="ov-act-fail">${chatErrors} ${T('ov_act_errors')}</span>` : '');

  // Dynamic memories (DB store) vs static MEMORY.md file — show whichever has data
  const memsLine = totalMems > 0
    ? `<span class="ov-act-val">${persistMems} ${T('ov_act_persist')}</span>`
      + ((tempMems + todoMems) > 0 ? ` <span class="ov-act-sep">·</span> <span class="ov-act-dim">${tempMems + todoMems} ${T('ov_act_temp')}</span>` : '')
    : me.words > 0
      ? `<span class="ov-act-val">${me.words} ${T('ov_act_mem_words')}</span>`
      : `<span class="ov-act-dim">${T('ov_act_no_mems')}</span>`;

  const activityHtml = `
    <div class="ov-activity">
      <div class="ov-act-row">
        <span class="ov-act-icon">📋</span>
        <span class="ov-act-body">${tasksLine}</span>
        ${ageStr ? `<span class="ov-act-age">${esc(ageStr)}</span>` : ''}
      </div>
      <div class="ov-act-row">
        <span class="ov-act-icon">🧠</span>
        <span class="ov-act-body">${memsLine}</span>
      </div>
    </div>`;

  // ── Track record (ADR-0005 STATS.md) ──────────────────────────────────────
  const att = agentStats.attempted || 0, suc = agentStats.succeeded || 0;
  const failed = Math.max(0, att - suc);
  const sr  = att > 0 ? Math.round(suc / att * 100) : null;
  const topFails = (agentStats.failures || []).slice(0, 3);
  // Always show the track record (attempts / successes / failures), even at zero.
  const trackHtml = `
    <div class="ov-track-label">Track record</div>
    <div class="ov-activity">
      <div class="ov-act-row">
        <span class="ov-act-icon">📈</span>
        <span class="ov-act-body">
          <span class="ov-act-val">${att} attempts</span>
          <span class="ov-act-sep">·</span>
          <span class="ov-act-done">${suc} ok</span>
          <span class="ov-act-sep">·</span>
          <span class="${failed ? 'ov-act-fail' : 'ov-act-dim'}">${failed} failed</span>
          ${sr !== null ? ` <span class="ov-act-sep">·</span> <span class="ov-act-val">${sr}% success</span>` : ''}
        </span>
      </div>
      ${att === 0 ? `<div class="ov-act-row"><span class="ov-act-icon">·</span><span class="ov-act-body ov-act-dim">No tasks run yet — chat with this agent to start tracking.</span></div>` : ''}
      ${topFails.length ? `<div class="ov-act-row"><span class="ov-act-icon">⚠️</span><span class="ov-act-body">${topFails.map(f => `<span class="ov-act-fail" title="${esc(f.description || '')}">${esc(f.pattern)} ×${f.count}</span>`).join(' <span class="ov-act-sep">·</span> ')}</span></div>` : ''}
    </div>`;

  el.innerHTML = `
    <div class="ov-layout">

      <!-- LEFT: character card -->
      <div class="ov-char">
        <div class="ov-char-frame" id="ov-avatar-wrap" style="${frameStyle}">
          <img class="ov-char-img" src="${hasAvatar ? avatarUrl : getAgentCharacter(a.catalogId || a.id)}" alt="avatar">
          <div class="ov-char-overlay">📷</div>
          <div class="ov-level-badge">Lv.${level}</div>
        </div>
        <input type="file" id="ov-avatar-input" accept="image/*" class="ov-file-hidden">
        <div class="ov-char-name">${esc(a.name)}</div>
        <div class="ov-stars">${starsHtml}</div>
        <div class="ov-rank-tag">${esc(rank)}</div>
        <div class="ov-xp-wrap">
          <div class="ov-xp-track"><div class="ov-xp-fill" style="width:${xpPct}%"></div></div>
          <span class="ov-xp-label">${xp} XP · ${xpNxt - xp} XP to Lv.${level + 1}</span>
        </div>
        ${vibe ? `<div class="ov-char-vibe">"${esc(vibe)}"</div>` : ''}
        <div class="ov-char-meta">
          <div class="ov-char-meta-row">${esc(a.id)}</div>
          ${a.model ? `<div class="ov-char-meta-row">${esc(a.model)}</div>` : ''}
        </div>
        <button class="btn-reset-state btn-danger-sm" id="ov-reset-state">↺ Reset state</button>
        <button class="btn-danger btn-danger-sm" id="ov-remove-agent">${esc(i18n.t('ov_remove_btn'))}</button>
      </div>

      <!-- RIGHT: info panel -->
      <div class="ov-panel">

        ${insights.length ? `<div class="ov-insights">${insights.map(ins =>
          `<div class="ov-insight ov-insight-${ins.t}">${esc(ins.msg)}</div>`).join('')}</div>` : ''}

        ${activityHtml}
        ${trackHtml}

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

  $('#ov-reset-state').addEventListener('click', async () => {
    if (!confirm(`Reset "${a.name}" state?\n\nThis will clear: tasks, memories, chat history.\nSkills, Soul, and Identity files are not touched.`)) return;
    const btn = $('#ov-reset-state');
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const del = (store, id) => fetch(`/api/projects/${pid}/agents/${aid}/${store}/${id}`, { method: 'DELETE' });
      const [ts, ms] = await Promise.all([
        fetch(`/api/projects/${pid}/agents/${aid}/tasks`).then(r => r.json()).catch(() => []),
        fetch(`/api/projects/${pid}/agents/${aid}/memories`).then(r => r.json()).catch(() => []),
      ]);
      await Promise.all([
        ...ts.map(t => del('tasks',    t.id)),
        ...ms.map(m => del('memories', m.id)),
        fetch(`/api/projects/${pid}/agents/${aid}/chat/history`, { method: 'DELETE' }),
      ]);
      // Clear in-memory chat state so intro re-fetches on next visit
      delete CHAT_STATE[aid];
    } finally {
      renderAgentOverview(a);
    }
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
