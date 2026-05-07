// ── Analyze view ───────────────────────────────────────────────────────────

import { S, PROJECTS, LEGION_CONFIG, CATALOG_AGENTS } from '../modules/state.js';
import { $, esc } from '../modules/utils.js';
import { storePost, loadProjectAgents } from '../modules/api.js';
import { showView } from './dashboard.js';
import { renderTree } from './sidebar.js';
import { projectAgents } from './sidebar.js';
import { loadCatalog } from './catalog.js';

export function showAnalyze() {
  showView('view-analyze');
  renderAnalyze();
}

export function renderAnalyze() {
  const project = PROJECTS.find(p => p.id === S.projectId);
  const hasModel = !!LEGION_CONFIG.defaultModelId;
  $('#analyze-no-model').style.display = hasModel ? 'none' : 'block';
  $('#btn-analyze-run').disabled = !hasModel || !project;
  $('#analyze-body').innerHTML = '';

  // Show skill-match entry point if agents already exist (no need to re-run analysis)
  if (S.projectId && projectAgents().length > 0) {
    const n = projectAgents().length;
    const wrap = document.createElement('div');
    wrap.className = 'analyze-skills-section';
    wrap.innerHTML = `
      <div class="analyze-skills-header">
        <div>
          <div class="analyze-skills-header-title">Your team · ${n} agent${n === 1 ? '' : 's'}</div>
          <div class="analyze-skills-header-hint">Find the best skills for each agent in your project</div>
        </div>
        <button class="btn-analyze-all" id="btn-match-skills-standalone">✦ Match Skills to Agents</button>
      </div>
      <div id="analyze-skills-standalone-body"></div>`;
    $('#analyze-body').appendChild(wrap);
    wrap.querySelector('#btn-match-skills-standalone').addEventListener('click', function () {
      runSkillMatching(this, wrap.querySelector('#analyze-skills-standalone-body'));
    });
  }
}

let _analyzeController = null;

export function getAnalyzeController() { return _analyzeController; }
export function setAnalyzeControllerLocal(v) { _analyzeController = v; }

export async function runAnalyze() {
  const project = PROJECTS.find(p => p.id === S.projectId);
  if (!project) return;

  const runBtn  = $('#btn-analyze-run');
  const stopBtn = $('#btn-analyze-stop');
  runBtn.disabled = true;
  runBtn.textContent = '✦ Analyzing…';
  if (stopBtn) stopBtn.style.display = 'inline-flex';

  // Build collapsible log block
  const logWrap = document.createElement('div');
  logWrap.className = 'analyze-log-wrap';
  logWrap.innerHTML = `
    <div class="analyze-log-header">
      <span class="analyze-log-title">Process Log</span>
      <button class="analyze-log-toggle" title="Collapse">▾</button>
    </div>
    <div class="analyze-log-body"></div>`;
  $('#analyze-body').innerHTML = '';
  $('#analyze-body').appendChild(logWrap);

  const logBody   = logWrap.querySelector('.analyze-log-body');
  const toggleBtn = logWrap.querySelector('.analyze-log-toggle');
  let   collapsed = false;
  let   lastStep  = null;

  toggleBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    logBody.style.display = collapsed ? 'none' : '';
    toggleBtn.textContent = collapsed ? '▸' : '▾';
    toggleBtn.title = collapsed ? 'Expand' : 'Collapse';
  });

  const addLog = (msg, type = 'step') => {
    if (type === 'step' && lastStep) {
      lastStep.classList.add('analyze-log-done');
      lastStep.querySelector('.analyze-log-icon').textContent = '✓';
    }
    const line = document.createElement('div');
    line.className = `analyze-log-line analyze-log-${type}`;
    const icon = type === 'step' ? '›' : type === 'ok' ? '✓' : '✗';
    line.innerHTML = `<span class="analyze-log-icon">${icon}</span><span class="analyze-log-text">${msg}</span>`;
    logBody.appendChild(line);
    if (type === 'step') lastStep = line;
    if (type !== 'step' && lastStep) {
      lastStep.classList.add('analyze-log-done');
      lastStep.querySelector('.analyze-log-icon').textContent = '✓';
      lastStep = null;
    }
  };

  _analyzeController = new AbortController();

  try {
    const res = await fetch(`/api/projects/${S.projectId}/analyze`, {
      method: 'POST', signal: _analyzeController.signal,
    });

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

    const agents    = result.agents    || [];
    const pipelines = result.pipelines || [];
    const newCount  = agents.filter(ag => !projectAgents().some(a => a.name.toLowerCase() === ag.name.toLowerCase())).length;
    addLog(`${agents.length} agents recommended (${newCount} new), ${pipelines.length} pipelines suggested`, 'ok');

    // Collapse log so results are immediately visible below
    collapsed = true;
    logBody.style.display = 'none';
    toggleBtn.textContent = '▸';
    toggleBtn.title = 'Expand';

    const existingNames = () => new Set(projectAgents().map(a => a.name.toLowerCase()));

    function agentCardHtml(ag, i) {
      const exists = existingNames().has(ag.name.toLowerCase());
      const tier   = ag.tier === 'mandatory'
        ? `<span class="analyze-tier mandatory">mandatory</span>`
        : `<span class="analyze-tier additional">additional</span>`;
      return `
        <div class="analyze-card" data-idx="${i}">
          <div class="analyze-card-head">
            <div class="analyze-card-name">${esc(ag.name)}</div>
            ${exists
              ? `<span class="analyze-exists">✓ exists</span>`
              : `<button class="btn-analyze-add" data-idx="${i}">+ Add</button>`}
          </div>
          <div class="analyze-card-meta">
            ${tier}
            ${ag.id ? `<span class="analyze-card-id">${esc(ag.id)}</span>` : ''}
          </div>
          ${ag.covers ? `<div class="analyze-card-covers">↳ ${esc(ag.covers)}</div>` : ''}
          <div class="analyze-card-reason">${esc(ag.reason)}</div>
        </div>`;
    }

    function pipeHtml(p, i) {
      return `
        <div class="analyze-pipe" data-idx="${i}">
          <div class="analyze-pipe-flow">
            <span class="analyze-pipe-agent">${esc(p.from)}</span>
            <span class="analyze-pipe-arrow">→</span>
            <span class="analyze-pipe-agent">${esc(p.to)}</span>
          </div>
          <div class="analyze-pipe-meta">
            <span class="pipe-badge pipe-badge-cond">${esc(p.condition)}</span>
            <span class="pipe-badge pipe-badge-mode">${esc(p.mode)}</span>
          </div>
          <div class="analyze-card-reason">${esc(p.reason)}</div>
          <button class="btn-analyze-pipe" data-idx="${i}">Apply</button>
        </div>`;
    }

    const aHalf  = Math.ceil(agents.length / 2);
    const aCol1  = agents.slice(0, aHalf);
    const aCol2  = agents.slice(aHalf);
    const pHalf  = Math.ceil(pipelines.length / 2);
    const pCol1  = pipelines.slice(0, pHalf);
    const pCol2  = pipelines.slice(pHalf);

    const resultsEl = document.createElement('div');
    resultsEl.className = 'analyze-results';
    resultsEl.innerHTML = `
      ${result.analysis ? `<div class="analyze-summary">${esc(result.analysis)}</div>` : ''}
      <div class="analyze-stats-bar">
        <div class="analyze-stats-counts">
          <span class="analyze-stat"><strong>${agents.length}</strong> agents recommended</span>
          <span class="analyze-stat-sep">·</span>
          <span class="analyze-stat"><strong>${newCount}</strong> new</span>
          <span class="analyze-stat-sep">·</span>
          <span class="analyze-stat"><strong>${pipelines.length}</strong> pipelines</span>
        </div>
        ${newCount > 0 || pipelines.length > 0
          ? `<button class="btn-analyze-all" id="btn-add-apply-all">⚡ Add & Apply All</button>`
          : ''}
      </div>
      <div class="analyze-columns">
        <div class="analyze-section-group">
          <div class="analyze-group-label">Agents <span class="analyze-group-count">${agents.length}</span></div>
          <div class="analyze-group-cols">
            <div class="analyze-col">
              ${aCol1.map((ag, i) => agentCardHtml(ag, i)).join('')}
            </div>
            <div class="analyze-col">
              ${aCol2.map((ag, i) => agentCardHtml(ag, i + aHalf)).join('')}
            </div>
          </div>
        </div>
        <div class="analyze-section-group">
          <div class="analyze-group-label">Pipelines <span class="analyze-group-count">${pipelines.length}</span></div>
          <div class="analyze-group-cols">
            <div class="analyze-col">
              ${pCol1.map((p, i) => pipeHtml(p, i)).join('')}
              ${!pCol1.length ? `<div class="analyze-empty">No pipelines suggested</div>` : ''}
            </div>
            <div class="analyze-col">
              ${pCol2.map((p, i) => pipeHtml(p, i + pHalf)).join('')}
            </div>
          </div>
        </div>
      </div>`;
    $('#analyze-body').appendChild(resultsEl);

    // Skills section — always shown after analysis
    const skillsSection = document.createElement('div');
    skillsSection.className = 'analyze-skills-section';
    skillsSection.innerHTML = `
      <div class="analyze-skills-header">
        <div>
          <div class="analyze-skills-header-title">Skills for your team</div>
          <div class="analyze-skills-header-hint">AI-powered recommendations from Smithery, Skills.sh and SkillsMP</div>
        </div>
        <button class="btn-analyze-all" id="btn-match-skills-results">✦ Match Skills to Agents</button>
      </div>
      <div id="analyze-skills-results-body"></div>`;
    resultsEl.appendChild(skillsSection);
    skillsSection.querySelector('#btn-match-skills-results').addEventListener('click', function () {
      runSkillMatching(this, skillsSection.querySelector('#analyze-skills-results-body'));
    });

    async function addAgent(ag, btn) {
      if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
      await loadCatalog();
      const catalogEntry = CATALOG_AGENTS.find(c => c.id === ag.id) ||
                           CATALOG_AGENTS.find(c => c.name.toLowerCase() === ag.name.toLowerCase());
      const slugId = ag.id || ag.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const payload = catalogEntry
        ? { ...catalogEntry, role: ag.role || ag.reason, status: 'idle' }
        : { id: slugId, name: ag.name, role: ag.role || ag.reason, catalogId: ag.id || null, status: 'idle', group: 'custom' };

      const r = await fetch(`/api/projects/${S.projectId}/agents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (btn) btn.textContent = r.ok ? '✓ Added' : '✗ Failed';
      if (r.ok) { await loadProjectAgents(S.projectId); renderTree(); }
      else if (btn) { btn.disabled = false; console.error('addAgent failed', await r.text?.().catch(() => '')); }
      return r.ok;
    }

    async function applyPipe(p, btn) {
      if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }
      const fromAgent = projectAgents().find(a => a.name.toLowerCase() === p.from.toLowerCase());
      const toAgent   = projectAgents().find(a => a.name.toLowerCase() === p.to.toLowerCase());
      if (!fromAgent || !toAgent) { if (btn) btn.textContent = '✗ Not found'; return false; }
      await storePost(fromAgent.id, 'pipeline', { targetAgentId: toAgent.id, condition: p.condition, mode: p.mode, event: 'task_complete' });
      if (btn) btn.textContent = '✓ Applied';
      return true;
    }

    resultsEl.querySelectorAll('.btn-analyze-add').forEach(btn => {
      btn.addEventListener('click', () => addAgent(agents[+btn.dataset.idx], btn));
    });

    resultsEl.querySelectorAll('.btn-analyze-pipe').forEach(btn => {
      btn.addEventListener('click', () => applyPipe(pipelines[+btn.dataset.idx], btn));
    });

    const allBtn = resultsEl.querySelector('#btn-add-apply-all');
    if (allBtn) {
      allBtn.addEventListener('click', async () => {
        allBtn.disabled = true;

        allBtn.textContent = 'Adding agents…';
        const toAdd = agents.filter(ag => !projectAgents().some(a => a.name.toLowerCase() === ag.name.toLowerCase()));
        for (const ag of toAdd) {
          const cardBtn = resultsEl.querySelector(`.btn-analyze-add[data-idx="${agents.indexOf(ag)}"]`);
          await addAgent(ag, cardBtn);
        }

        await loadProjectAgents(S.projectId);
        renderTree();

        allBtn.textContent = 'Applying pipelines…';
        for (const p of pipelines) {
          const pipeBtn = resultsEl.querySelector(`.btn-analyze-pipe[data-idx="${pipelines.indexOf(p)}"]`);
          await applyPipe(p, pipeBtn);
        }

        allBtn.textContent = '✓ Done';
      });
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      addLog('Analysis stopped', 'err');
    } else {
      addLog(err.message, 'err');
    }
  } finally {
    _analyzeController = null;
    runBtn.disabled = false;
    runBtn.textContent = '✦ Analyze';
    if (stopBtn) stopBtn.style.display = 'none';
  }
}

// ── Skill matching for all project agents ────────────────────────────────────

async function runSkillMatching(btn, container) {
  const agents = projectAgents();
  if (!agents.length) {
    container.innerHTML = '<div class="analyze-empty">No agents in this project yet. Add agents first.</div>';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Matching…';
  container.innerHTML = '';

  const allResults = {}; // agentId → skills[]

  // Grid of per-agent cards
  const grid = document.createElement('div');
  grid.className = 'analyze-skills-grid';
  container.appendChild(grid);

  for (const agent of agents) {
    const card = document.createElement('div');
    card.className = 'analyze-skills-agent-card';
    card.innerHTML = `
      <div class="analyze-skills-agent-head">
        <span class="analyze-skills-agent-name">${esc(agent.name)}</span>
        <div class="analyze-skills-head-right">
          <span class="analyze-skills-agent-status" id="sk-status-${esc(agent.id)}">⏳ Loading…</span>
        </div>
      </div>
      <div class="analyze-skills-list" id="sk-list-${esc(agent.id)}"></div>`;
    grid.appendChild(card);
  }

  // Run suggest-skills per agent sequentially to avoid rate limits
  for (const agent of agents) {
    const statusEl = container.querySelector(`#sk-status-${agent.id}`);
    const listEl   = container.querySelector(`#sk-list-${agent.id}`);

    await new Promise(resolve => {
      const es = new EventSource(`/api/projects/${S.projectId}/agents/${agent.id}/suggest-skills`);

      es.onmessage = e => {
        const d = JSON.parse(e.data);

        if (d.type === 'progress' && statusEl) {
          statusEl.textContent = `⏳ ${d.message}`;
        }

        if (d.type === 'done') {
          es.close();
          const skills = d.result?.skills || [];
          allResults[agent.id] = skills;

          const headRight = statusEl?.closest('.analyze-skills-head-right');
          if (statusEl) statusEl.textContent = skills.length
            ? `${skills.length} skill${skills.length === 1 ? '' : 's'} found`
            : 'none found';

          if (!skills.length) {
            if (listEl) listEl.innerHTML = '<div class="analyze-empty">No recommendations found.</div>';
          } else {
            // Inject "Assign All" button into card header
            if (headRight) {
              const assignAllBtn = document.createElement('button');
              assignAllBtn.className = 'btn-analyze-agent-assign-all';
              assignAllBtn.textContent = '⚡ Assign All';
              headRight.appendChild(assignAllBtn);
              assignAllBtn.addEventListener('click', async () => {
                assignAllBtn.disabled = true; assignAllBtn.textContent = 'Assigning…';
                await Promise.all(skills.map(s =>
                  fetch(`/api/projects/${S.projectId}/agents/${agent.id}/skills/${encodeURIComponent(s.name)}`, { method: 'POST' })
                ));
                assignAllBtn.textContent = '✓ Done';
                listEl?.querySelectorAll('.btn-assign-one-skill').forEach(b => { b.textContent = '✓'; b.disabled = true; });
              });
            }

            // Chips only in the list
            if (listEl) {
              listEl.innerHTML = `
                <div class="analyze-skills-chips">
                  ${skills.map(s => `
                    <div class="analyze-skill-chip">
                      <div class="analyze-skill-chip-top">
                        <span class="sk-type-icon">${s.type === 'mcp' ? '🔌' : '⚡'}</span>
                        <span class="analyze-skill-name">${esc(s.name)}</span>
                        ${s.source ? `<span class="analyze-skill-source">${esc(s.source)}</span>` : ''}
                        <button class="btn-assign-one-skill" data-agent="${esc(agent.id)}" data-skill="${esc(s.name)}">+ Assign</button>
                      </div>
                      ${s.reason ? `<div class="analyze-skill-reason">${esc(s.reason)}</div>` : ''}
                      ${s.install ? `<code class="sk-install">${esc(s.install)}</code>` : ''}
                    </div>`).join('')}
                </div>`;

              listEl.querySelectorAll('.btn-assign-one-skill').forEach(b => {
                b.addEventListener('click', async () => {
                  b.textContent = '…'; b.disabled = true;
                  const r = await fetch(`/api/projects/${S.projectId}/agents/${b.dataset.agent}/skills/${encodeURIComponent(b.dataset.skill)}`, { method: 'POST' });
                  b.textContent = r.ok ? '✓' : '✗';
                });
              });
            }
          }
          resolve();
        }

        if (d.type === 'error') {
          es.close();
          if (statusEl) statusEl.textContent = '✗ Error';
          if (listEl) listEl.innerHTML = `<div class="analyze-empty">✗ ${esc(d.message)}</div>`;
          resolve();
        }
      };

      es.onerror = () => {
        es.close();
        if (statusEl) statusEl.textContent = '✗ Failed';
        resolve();
      };
    });
  }

  btn.disabled = false;
  btn.textContent = '✓ Done — run again?';

  // Apply All button — appended at the bottom after all agents loaded
  const applyAllWrap = document.createElement('div');
  applyAllWrap.className = 'analyze-skills-apply-row';
  applyAllWrap.innerHTML = `<button class="btn-analyze-all" id="btn-skills-apply-all">⚡ Apply All Skills</button>`;
  container.appendChild(applyAllWrap);

  const applyAllBtn = applyAllWrap.querySelector('#btn-skills-apply-all');
  applyAllBtn.addEventListener('click', async () => {
    applyAllBtn.disabled = true; applyAllBtn.textContent = 'Applying all…';
    for (const [agentId, skills] of Object.entries(allResults)) {
      await Promise.all(skills.map(s =>
        fetch(`/api/projects/${S.projectId}/agents/${agentId}/skills/${encodeURIComponent(s.name)}`, { method: 'POST' })
      ));
    }
    container.querySelectorAll('.btn-assign-one-skill').forEach(b => { b.textContent = '✓'; b.disabled = true; });
    container.querySelectorAll('.btn-analyze-agent-assign-all').forEach(b => { b.textContent = '✓ Done'; b.disabled = true; });
    applyAllBtn.textContent = '✓ All Skills Applied';
  });
}
