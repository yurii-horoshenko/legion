// ── Skills tab ─────────────────────────────────────────────────────────────

import { S } from '../modules/state.js';
import { $, esc } from '../modules/utils.js';
import { tabDescHtml } from '../modules/utils.js';
import i18n from '../i18n.js';

export async function renderSkills(a) {
  const el = $('#tab-skills');
  if (!el) return;

  const SOURCE_LABELS = { skillsh: 'SKILLSH', smithery: 'SMITHERY', skillsmp: 'SKILLSMP', github: 'GitHub' };
  const SOURCE_COLORS = { skillsh: '#ea580c', smithery: '#7c3aed', skillsmp: '#0ea5e9', github: '#475569' };
  const TYPE_ICONS    = { skill: '⚡', mcp: '🔌' };

  el.innerHTML = `
    ${tabDescHtml('skills')}

    <div class="sk-sources-banner">
      <div class="sk-sources-left">
        <span class="sk-sources-label">Live catalog search</span>
        <span class="sk-sources-hint">Suggest Skills runs real-time queries across all three registries</span>
      </div>
      <div class="sk-sources-chips">
        <a class="sk-source-link" href="https://smithery.ai" target="_blank" rel="noopener"
           style="--sc:#7c3aed">
          🔌 <span>Smithery</span><span class="sk-chip-ext">↗</span>
        </a>
        <a class="sk-source-link" href="https://skills.sh" target="_blank" rel="noopener"
           style="--sc:#ea580c">
          ⚡ <span>Skills.sh</span><span class="sk-chip-ext">↗</span>
        </a>
        <a class="sk-source-link" href="https://skillsmp.com" target="_blank" rel="noopener"
           style="--sc:#0ea5e9">
          🎯 <span>SkillsMP</span><span class="sk-chip-ext">↗</span>
        </a>
      </div>
    </div>

    <div class="sk-section-header" id="sk-head-installed">
      <span class="sk-section-caret">▾</span>
      <span>Assigned to this agent</span>
    </div>
    <div id="sk-installed">Loading…</div>
    <div class="sk-section-header sk-section-header-mt sk-collapsed" id="sk-head-available">
      <span class="sk-section-caret">▸</span>
      <span>Available from your skills</span>
    </div>
    <div id="sk-available" style="display:none"></div>
    <div class="sk-section-header sk-section-header-mt" id="sk-head-suggest">
      <span class="sk-section-caret">▾</span>
      <span>AI recommendations</span>
      <button class="sk-suggest-btn" id="sk-suggest">✦ Suggest Skills</button>
    </div>
    <div id="sk-log" class="sk-log" style="display:none"></div>
    <div id="sk-results"></div>`;

  async function refreshSkillLists() {
    const installedEl = $('#sk-installed');
    const availableEl = $('#sk-available');
    try {
      const [agentSkillsRes, globalSkillsRes] = await Promise.all([
        fetch(`/api/projects/${S.projectId}/agents/${a.id}/skills`),
        fetch(`/api/skills/available`),
      ]);
      const agentSkills = await agentSkillsRes.json();
      const available   = await globalSkillsRes.json();
      if (!Array.isArray(agentSkills) || !Array.isArray(available))
        throw new Error(agentSkills.error || available.error || 'Invalid response');

      const descMap     = Object.fromEntries(available.map(s => [s.id, s.description]));
      const agentSkillSet = new Set(agentSkills);

      if (!installedEl) return;
      if (!agentSkills.length) {
        installedEl.innerHTML = `<div class="sk-empty">${i18n.t('sk_no_installed') || 'No skills assigned to this agent yet.'}</div>`;
      } else {
        installedEl.innerHTML = `<div class="sk-list">${agentSkills.map(id => `
          <div class="sk-card">
            <div class="sk-card-head">
              <span class="sk-type-icon">⚡</span>
              <span class="sk-card-name">${esc(id)}</span>
            </div>
            ${descMap[id] ? `<div class="sk-card-reason">${esc(descMap[id])}</div>` : ''}
            <div class="sk-card-foot">
              <button class="sk-pill-remove" data-skill="${esc(id)}">Remove</button>
            </div>
          </div>`).join('')}</div>`;
        installedEl.querySelectorAll('.sk-pill-remove').forEach(btn => {
          btn.addEventListener('click', async () => {
            btn.textContent = '…'; btn.disabled = true;
            await fetch(`/api/projects/${S.projectId}/agents/${a.id}/skills/${btn.dataset.skill}`, { method: 'DELETE' });
            refreshSkillLists();
          });
        });
      }

      if (!availableEl) return;
      const notAssigned = available.filter(s => !agentSkillSet.has(s.id));
      if (!notAssigned.length) {
        availableEl.innerHTML = `<div class="sk-empty">${i18n.t('sk_no_available') || 'All your skills are already assigned.'}</div>`;
      } else {
        availableEl.innerHTML = `<div class="sk-list">${notAssigned.map(s =>
          `<div class="sk-card">
            <div class="sk-card-head">
              <span class="sk-type-icon">⚡</span>
              <span class="sk-card-name">${esc(s.id)}</span>
            </div>
            ${s.description ? `<div class="sk-card-reason">${esc(s.description)}</div>` : ''}
            <div class="sk-card-foot">
              <button class="sk-avail-add" data-skill="${esc(s.id)}">+ Assign</button>
            </div>
          </div>`).join('')}</div>`;
        availableEl.querySelectorAll('.sk-avail-add').forEach(btn => {
          btn.addEventListener('click', async () => {
            btn.textContent = '…'; btn.disabled = true;
            await fetch(`/api/projects/${S.projectId}/agents/${a.id}/skills/${btn.dataset.skill}`, { method: 'POST' });
            await refreshSkillLists();
          });
        });
      }
    } catch (err) {
      console.error('[skills]', err);
      if (installedEl) installedEl.innerHTML = `<div class="sk-empty">⚠ ${esc(err.message)}</div>`;
      if (availableEl) availableEl.innerHTML = '';
    }
  }

  refreshSkillLists();

  function setupSkToggle(headId, contentId, startCollapsed) {
    const head    = $(`#${headId}`);
    const content = $(`#${contentId}`);
    if (!head || !content) return;
    let collapsed = startCollapsed;
    head.addEventListener('click', e => {
      if (e.target.closest('.sk-suggest-btn')) return;
      collapsed = !collapsed;
      content.style.display = collapsed ? 'none' : '';
      head.querySelector('.sk-section-caret').textContent = collapsed ? '▸' : '▾';
      head.classList.toggle('sk-collapsed', collapsed);
    });
  }
  setupSkToggle('sk-head-installed', 'sk-installed', false);
  setupSkToggle('sk-head-available', 'sk-available', true);

  let es = null;

  $('#sk-suggest').addEventListener('click', () => {
    const btn = $('#sk-suggest');
    if (es) { es.close(); es = null; btn.textContent = '✦ Suggest Skills'; return; }

    const log = $('#sk-log');
    const results = $('#sk-results');
    log.style.display = 'block';
    log.innerHTML = '';
    results.innerHTML = '';
    btn.textContent = '✦ Analyzing…';

    es = new EventSource(`/api/projects/${S.projectId}/agents/${a.id}/suggest-skills`);

    es.onmessage = (e) => {
      const d = JSON.parse(e.data);

      if (d.type === 'progress') {
        const row = document.createElement('div');
        row.className = 'sk-log-row';
        row.textContent = '→ ' + d.message;
        log.appendChild(row);
        log.scrollTop = log.scrollHeight;
      }

      if (d.type === 'done') {
        es.close(); es = null;
        btn.textContent = '✦ Suggest Skills';
        const r = d.result;
        if (!r?.skills?.length) { results.innerHTML = `<div class="sk-empty">${i18n.t('sk_no_results') || 'No skill recommendations found.'}</div>`; return; }

        results.innerHTML = `
          ${r.summary ? `<div class="sk-summary">${esc(r.summary)}</div>` : ''}
          <div class="sk-results-head">
            <span class="sk-results-count">${r.skills.length} ${r.skills.length === 1 ? 'skill' : 'skills'} recommended</span>
            <button class="sk-assign-all-btn" id="sk-assign-all">⚡ Assign All</button>
          </div>
          <div class="sk-list">
            ${r.skills.map(s => `
              <div class="sk-card">
                <div class="sk-card-head">
                  <span class="sk-type-icon">${TYPE_ICONS[s.type] || '⚡'}</span>
                  <span class="sk-card-name">${esc(s.name)}</span>
                  <span class="sk-source-badge" style="background:${SOURCE_COLORS[s.source] || '#6b7280'}20;color:${SOURCE_COLORS[s.source] || '#6b7280'};border-color:${SOURCE_COLORS[s.source] || '#6b7280'}40">
                    ${esc(SOURCE_LABELS[s.source] || s.source)}
                  </span>
                </div>
                <div class="sk-card-reason">${esc(s.reason)}</div>
                <div class="sk-card-foot">
                  ${s.install ? `<code class="sk-install">${esc(s.install)}</code>` : ''}
                  ${s.url ? `<a class="sk-link" href="${esc(s.url)}" target="_blank">↗ Open</a>` : ''}
                  <button class="sk-avail-add sk-card-assign" data-skill="${esc(s.name)}">+ Assign</button>
                </div>
              </div>`).join('')}
          </div>`;

        results.querySelectorAll('.sk-card-assign').forEach(assignBtn => {
          assignBtn.addEventListener('click', async () => {
            assignBtn.textContent = '…'; assignBtn.disabled = true;
            const res = await fetch(`/api/projects/${S.projectId}/agents/${a.id}/skills/${assignBtn.dataset.skill}`, { method: 'POST' });
            if (res.ok) { assignBtn.textContent = '✓'; refreshSkillLists(); }
            else { assignBtn.textContent = '✗'; assignBtn.disabled = false; }
          });
        });

        $('#sk-assign-all').addEventListener('click', async () => {
          const allBtn = $('#sk-assign-all');
          allBtn.textContent = '…'; allBtn.disabled = true;
          results.querySelectorAll('.sk-card-assign').forEach(b => { b.disabled = true; });
          await Promise.all(r.skills.map(s =>
            fetch(`/api/projects/${S.projectId}/agents/${a.id}/skills/${s.name}`, { method: 'POST' })
          ));
          results.querySelectorAll('.sk-card-assign').forEach(b => { b.textContent = '✓'; });
          allBtn.textContent = '✓ All assigned';
          refreshSkillLists();
        });
      }

      if (d.type === 'error') {
        es.close(); es = null;
        btn.textContent = '✦ Suggest Skills';
        log.innerHTML += `<div class="sk-log-row sk-log-err">✗ ${esc(d.message)}</div>`;
      }
    };

    es.onerror = () => {
      es.close(); es = null;
      btn.textContent = '✦ Suggest Skills';
    };
  });
}
