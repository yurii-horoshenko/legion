// ── Agent Overview tab ─────────────────────────────────────────────────────

import { S, PROJECT_AGENTS, PROJECTS } from '../modules/state.js';
import { $, esc } from '../modules/utils.js';
import { AGENT_REGISTRY } from '../modules/state.js';
import { apiRemoveAgent } from '../modules/api.js';
import { renderTree } from '../ui/sidebar.js';
import { showDash } from '../ui/dashboard.js';
import i18n from '../i18n.js';
import { removeFromAddedIds } from '../ui/catalog.js';

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

  const words   = real.join(' ').split(/\s+/).filter(Boolean).length;
  const bullets = real.filter(l => /^[-*•]\s|\d+\.\s/.test(l.trim())).length;
  const sections= (text.match(/^#{1,3}\s/gm) || []).length;
  const todos   = (text.match(/\bTODO\b|\bTBD\b/gi) || []).length;

  return { words, bullets, sections, todos };
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

  const [storeData, fileData, hasAvatar] = await Promise.all([
    Promise.all([fetchStore('tasks'), fetchStore('memories'), fetchStore('channels'), fetchStore('cron'), fetchStore('pipeline')]),
    Promise.all([fetchFile('IDENTITY.md'), fetchFile('SOUL.md'), fetchFile('CONTEXT.md'), fetchFile('MEMORY.md'), fetchFile('SKILLS.md')]),
    fetch(`/api/projects/${pid}/agents/${aid}/avatar`, { method: 'HEAD' }).then(r => r.ok).catch(() => false),
  ]);

  const [tasks, memories, channels, cron, pipeline]             = storeData;
  const [fIdentity, fSoul, fContext, fMemory, fSkills]          = fileData;
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
  const chCount     = channels.length;
  const skillCount  = (a.skills || []).length;

  // ── File analysis ─────────────────────────────────────────────────────────
  const id = parseFile(fIdentity);
  const so = parseFile(fSoul);
  const cx = parseFile(fContext);
  const me = parseFile(fMemory);
  const sk = parseFile(fSkills);

  const descLen       = desc.length;
  // Count integration/API keywords in CONTEXT.md — shows how connected this agent's world is
  const integKeywords = (fContext.match(/\b(api|webhook|oauth|slack|github|linear|jira|notion|discord|telegram|database|redis|sql|graphql|http|rest|endpoint)\b/gi) || []).length;
  const allTodos      = id.todos + so.todos + cx.todos + me.todos + sk.todos;

  function stat(v) { return Math.min(100, Math.round(Math.max(0, v))); }

  // ── Stat formulas: file content is the base, runtime activity grows them ──
  //
  // Valor  — how well-defined this agent is + task performance
  const valor = stat(id.words * 1.2 + (totalTasks > 0 ? (doneTasks / totalTasks) * 50 : 0));

  // Sorcery — tool/skill power from SKILLS.md + assigned skills + automation
  const sorcery = stat(sk.bullets * 8 + skillCount * 18 + activeCron * 12);

  // Dominion — channels, pipelines, and integrations in CONTEXT
  const dominion = stat(chCount * 18 + pipeLinks * 15 + integKeywords * 4 + (cx.words > 30 ? 15 : 0));

  // Lore — accumulated knowledge written into MEMORY.md / CONTEXT.md + store
  const lore = stat((me.words + cx.words) * 2 + persistMems * 10);

  // Soul — depth of values in SOUL.md + personality richness
  const soul = stat(so.bullets * 8 + so.sections * 10 + descLen / 15);

  // Discipline — how well-structured the configuration files are + memory quality
  const discipline = stat(id.sections * 8 + so.sections * 6 + (totalMems > 0 ? (persistMems / totalMems) * 40 : 0));

  // Disorientation — chaos: TODOs, failures, stuck work, noise in memory
  const disorient = stat(allTodos * 8 + failedTasks * 20 + inProgTasks * 8 + tempMems * 6 + todoMems * 4);

  // ── Level / XP ────────────────────────────────────────────────────────────
  // Only completed tasks count — configuration (skills, cron, pipelines) is not earned XP
  const xp    = doneTasks * 50;
  const level = Math.floor(Math.sqrt(xp / 80));
  const xpCur = level * level * 80;
  const xpNxt = (level + 1) * (level + 1) * 80;
  const xpPct = Math.round((xp - xpCur) / Math.max(1, xpNxt - xpCur) * 100);

  // ── Stars (0–5) ──────────────────────────────────────────────────────────
  // Earned through work: 0 if no activity, then scales with task success rate
  const taskScore = totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0;
  const perf  = xp > 0 ? taskScore * 0.6 + Math.max(0, 100 - disorient) * 0.4 : 0;
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
    const pct = s.value;
    let glowCls = '';
    if (s.key === 'soul'     && pct > 60) glowCls = 'ov-stat-glow';
    if (s.key === 'disorient'&& pct > 70) glowCls = 'ov-stat-disorient-glow';
    return `
      <div class="ov-stat-row ${glowCls}${last ? ' ov-stat-last' : ''}">
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

  // ── Contextual insights ───────────────────────────────────────────────────
  const insights = [];
  if (disorient > 70 && soul > 40)       insights.push({ t: 'warn', msg: T('insight_disorient_soul') });
  if (valor < 20 && totalTasks > 3)      insights.push({ t: 'warn', msg: T('insight_stuck') });
  if (lore === 0 && totalTasks > 5)      insights.push({ t: 'warn', msg: T('insight_no_lore') });
  if (valor > 70 && lore > 50)           insights.push({ t: 'good', msg: T('insight_peak') });
  if (sorcery > 60 && dominion > 50)     insights.push({ t: 'good', msg: T('insight_network') });

  // ── Frame color reflects overall health ───────────────────────────────────
  let frameStyle = '';
  if (valor > 70)          frameStyle = 'border:2px solid #22c55e;';
  else if (disorient > 70) frameStyle = 'border:2px solid #f59e0b;';

  const starsHtml = Array.from({ length: 5 }, (_, i) =>
    `<span class="ov-star${i < stars ? ' ov-star-on' : ''}">★</span>`).join('');

  el.innerHTML = `
    <div class="ov-layout">

      <!-- LEFT: character card -->
      <div class="ov-char">
        <div class="ov-char-frame" id="ov-avatar-wrap" style="${frameStyle}">
          <img class="ov-char-img" src="${hasAvatar ? avatarUrl : '/assets/characters/default.png'}" alt="avatar">
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
        <button class="btn-danger btn-danger-sm" id="ov-remove-agent">${esc(i18n.t('ov_remove_btn'))}</button>
      </div>

      <!-- RIGHT: info panel -->
      <div class="ov-panel">

        ${insights.length ? `<div class="ov-insights">${insights.map(ins =>
          `<div class="ov-insight ov-insight-${ins.t}">${esc(ins.msg)}</div>`).join('')}</div>` : ''}

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
