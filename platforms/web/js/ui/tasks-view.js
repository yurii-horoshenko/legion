// ── Tasks view ─────────────────────────────────────────────────────────────

import { S, PROJECT_AGENTS } from '../modules/state.js';
import { $, $$, esc } from '../modules/utils.js';
import { fetchIntegrations, setIntegCache } from '../modules/api.js';
import { showView } from './dashboard.js';
import { renderTree } from './sidebar.js';

let _currentTaskSrc = 'local';
let _assignPending = {};

export function showTasks() {
  showView('view-tasks');
  _currentTaskSrc = 'local';
  $$('.tasks-src-btn').forEach(b => b.classList.toggle('on', b.dataset.src === 'local'));
  renderProjectTasks('local');
}

export function getCurrentTaskSrc() { return _currentTaskSrc; }

export async function renderProjectTasks(src) {
  if (!S.projectId) return;
  _currentTaskSrc = src;
  const body = $('#tasks-body');
  if (!body) return;
  body.innerHTML = '<div class="tasks-loading">Loading…</div>';

  try {
    if (src === 'local') {
      const r = await fetch(`/api/projects/${S.projectId}/tasks`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const tasks = await r.json();

      if (!tasks.length) {
        body.innerHTML = '<div class="tasks-empty">No tasks yet — add tasks to your agents.</div>';
        return;
      }

      const STATUSES   = ['in-progress', 'backlog', 'done', 'cancelled'];
      const STATUS_LBL = { 'in-progress': 'In Progress', backlog: 'Backlog', done: 'Done', cancelled: 'Cancelled' };
      const grouped    = {};
      for (const t of tasks) {
        const s = t.status || 'backlog';
        (grouped[s] = grouped[s] || []).push(t);
      }

      const taskMap = {};
      let html = '';
      for (const s of STATUSES) {
        const items = grouped[s];
        if (!items?.length) continue;
        for (const t of items) taskMap[t.id] = t;
        html += `<div class="tasks-group">
          <div class="tasks-group-header tg-collapsible">
            <span class="tasks-group-caret">▾</span>
            <span class="tasks-group-dot tasks-dot-${esc(s)}"></span>
            <span class="tasks-group-label">${STATUS_LBL[s] || s}</span>
            <span class="tasks-group-count">${items.length}</span>
          </div>
          <div class="tasks-group-body">
            ${items.map(t => `
              <div class="tasks-row" data-id="${esc(t.id)}" data-aid="${esc(t.agentId)}">
                <span class="tasks-row-title">${esc(t.title || 'Untitled')}</span>
                <span class="tasks-row-agent">${esc(t.agentEmoji || '🤖')} ${esc(t.agentName || '')}</span>
                ${t.priority ? `<span class="tasks-row-pri tasks-pri-${esc(t.priority)}">${esc(t.priority)}</span>` : ''}
                ${t.swarmId ? `<span class="tasks-row-swarm" title="Swarm task">⚡</span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>`;
      }
      body.innerHTML = html || '<div class="tasks-empty">No tasks found.</div>';

      $$('.tg-collapsible', body).forEach(header => {
        header.addEventListener('click', () => {
          const grpBody = header.nextElementSibling;
          const caret   = header.querySelector('.tasks-group-caret');
          const collapsed = grpBody.style.display === 'none';
          grpBody.style.display = collapsed ? '' : 'none';
          caret.textContent = collapsed ? '▾' : '▸';
        });
      });

      $$('.tasks-row', body).forEach(row => {
        row.addEventListener('click', () => {
          const task = taskMap[row.dataset.id];
          if (task) showTaskDetail(task);
        });
      });

    } else if (src === 'linear') {
      const integ = await fetchIntegrations();
      if (!integ.linear?.apiKey) {
        renderLinearSetup(body, integ);
        return;
      }
      const r = await fetch(`/api/projects/${S.projectId}/linear/issues`);
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || `HTTP ${r.status}`); }
      const issues = await r.json();

      if (!issues.length) {
        body.innerHTML = '<div class="tasks-empty">No Linear issues found.</div>';
        return;
      }

      const STATE_ORDER = ['started', 'inProgress', 'unstarted', 'backlog', 'completed', 'cancelled', 'triage'];
      const STATE_LBL   = { started: 'In Progress', inProgress: 'In Progress', unstarted: 'Todo', backlog: 'Backlog', completed: 'Done', cancelled: 'Cancelled', triage: 'Triage' };
      const grouped     = {};
      for (const issue of issues) {
        const st = issue.state?.type || 'backlog';
        (grouped[st] = grouped[st] || []).push(issue);
      }
      const allStates = [...new Set([...STATE_ORDER, ...Object.keys(grouped)])];
      const agents     = PROJECT_AGENTS[S.projectId] || [];
      const agentLabels = integ.agentLabels || [];

      const getIssueAgent = (issue) => {
        for (const lbl of (issue.labels?.nodes || [])) {
          const al = agentLabels.find(x => x.labelId === lbl.id);
          if (al) return al;
        }
        return null;
      };

      let html = `
        <div id="lin-conn-panel" style="display:none"></div>
        <div class="tasks-linear-toolbar">
          <span class="tasks-linear-count">${issues.length} issue${issues.length !== 1 ? 's' : ''}</span>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn-assign-tags" id="btn-manage-assign">⚙ Manage Assignments</button>
            <button class="btn-lin-conn" id="btn-lin-settings" title="Linear connection">◈</button>
          </div>
        </div>`;

      const issueMap = {};
      for (const st of allStates) {
        const items = grouped[st];
        if (!items?.length) continue;
        for (const iss of items) issueMap[iss.id] = iss;
        html += `<div class="tasks-group">
          <div class="tasks-group-header tg-collapsible">
            <span class="tasks-group-caret">▾</span>
            <span class="tasks-group-dot" style="background:${esc(items[0].state?.color || '#888')}"></span>
            <span class="tasks-group-label">${STATE_LBL[st] || st}</span>
            <span class="tasks-group-count">${items.length}</span>
          </div>
          <div class="tasks-group-body">
            ${items.map(issue => {
              const assigned = getIssueAgent(issue);
              const agentName = assigned ? (agents.find(a => a.id === assigned.agentId)?.name || assigned.agentName || '') : '';
              return `
              <div class="tasks-row linear-issue" data-id="${esc(issue.id)}">
                <span class="tasks-row-id">${esc(issue.identifier || '')}</span>
                <span class="tasks-row-title">${esc(issue.title || 'Untitled')}</span>
                ${agentName ? `<span class="tasks-row-assigned">→ ${esc(agentName)}</span>` : '<span class="tasks-row-unassigned">unassigned</span>'}
                <span class="linear-badge">Linear</span>
                ${issue.priorityLabel ? `<span class="tasks-row-pri">${esc(issue.priorityLabel)}</span>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }
      body.innerHTML = html;

      $$('.tg-collapsible', body).forEach(header => {
        header.addEventListener('click', () => {
          const grpBody = header.nextElementSibling;
          const caret   = header.querySelector('.tasks-group-caret');
          const collapsed = grpBody.style.display === 'none';
          grpBody.style.display = collapsed ? '' : 'none';
          caret.textContent = collapsed ? '▾' : '▸';
        });
      });

      $$('.linear-issue', body).forEach(row => {
        row.addEventListener('click', e => {
          if (e.target.closest('button, a, select')) return;
          const issue = issueMap[row.dataset.id];
          if (issue) showLinearDetail(issue);
        });
      });

      $('#btn-lin-settings')?.addEventListener('click', () => {
        const panel = $('#lin-conn-panel');
        const btn   = $('#btn-lin-settings');
        if (panel.style.display !== 'none') {
          panel.style.display = 'none';
          btn.classList.remove('on');
          panel.innerHTML = '';
        } else {
          panel.style.display = '';
          btn.classList.add('on');
          renderLinearConnPanel(panel, integ);
        }
      });
      $('#btn-manage-assign')?.addEventListener('click', () => openAssignmentPanel(issues, integ));
    }
  } catch (e) {
    body.innerHTML = `<div class="tasks-error">Failed to load: ${esc(e.message)}</div>`;
  }
}

// ── Task detail modal ──────────────────────────────────────────────────────

function closeTaskDetail() {
  document.getElementById('task-detail-overlay')?.remove();
}

function showTaskDetail(task) {
  closeTaskDetail();
  const overlay = document.createElement('div');
  overlay.className = 'overlay on';
  overlay.id = 'task-detail-overlay';
  overlay.innerHTML = `
    <div class="modal td-modal">
      <div class="td-head">
        <div class="td-meta">
          <span class="tasks-group-dot tasks-dot-${esc(task.status || 'backlog')}"></span>
          <span class="td-status">${esc(task.status || 'backlog')}</span>
          ${task.priority ? `<span class="tasks-row-pri tasks-pri-${esc(task.priority)}">${esc(task.priority)}</span>` : ''}
        </div>
        <button class="td-close" id="btn-close-td">✕</button>
      </div>
      <div class="td-title">${esc(task.title || 'Untitled')}</div>
      ${task.description
        ? `<div class="td-desc">${esc(task.description)}</div>`
        : `<div class="td-no-desc">No description</div>`}
      <div class="td-fields">
        ${task.agentName ? `<div class="td-field"><span class="td-field-lbl">Agent</span><span>${esc(task.agentEmoji || '🤖')} ${esc(task.agentName)}</span></div>` : ''}
        ${task.createdAt ? `<div class="td-field"><span class="td-field-lbl">Created</span><span>${new Date(task.createdAt).toLocaleDateString()}</span></div>` : ''}
        ${task.swarmId  ? `<div class="td-field"><span class="td-field-lbl">Swarm</span><span>⚡ ${esc(task.swarmId)}</span></div>` : ''}
      </div>
      ${task.agentId ? `
        <div class="td-footer">
          <button class="btn-cfg-save" id="btn-td-open">Open in agent →</button>
        </div>` : ''}
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-close-td').addEventListener('click', closeTaskDetail);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeTaskDetail(); });
  overlay.querySelector('#btn-td-open')?.addEventListener('click', () => {
    closeTaskDetail();
    S.agentId = task.agentId;
    renderTree();
    import('./agent-panel.js').then(({ selectAgent }) => {
      selectAgent(task.agentId);
      setTimeout(() => { $('[data-tab="tasks"].a-tab')?.click(); }, 80);
    });
  });
}

function showLinearDetail(issue) {
  closeTaskDetail();
  const overlay = document.createElement('div');
  overlay.className = 'overlay on';
  overlay.id = 'task-detail-overlay';
  overlay.innerHTML = `
    <div class="modal td-modal">
      <div class="td-head">
        <div class="td-meta">
          <span class="tasks-row-id">${esc(issue.identifier || '')}</span>
          <span class="tasks-group-dot" style="background:${esc(issue.state?.color || '#888')}"></span>
          <span class="td-status">${esc(issue.state?.name || '')}</span>
          ${issue.priorityLabel ? `<span class="tasks-row-pri">${esc(issue.priorityLabel)}</span>` : ''}
        </div>
        <button class="td-close" id="btn-close-td">✕</button>
      </div>
      <div class="td-title">${esc(issue.title || 'Untitled')}</div>
      ${issue.description
        ? `<div class="td-desc">${esc(issue.description)}</div>`
        : `<div class="td-no-desc">No description</div>`}
      <div class="td-fields">
        ${issue.team?.name ? `<div class="td-field"><span class="td-field-lbl">Team</span><span>${esc(issue.team.name)}</span></div>` : ''}
        ${issue.assignee?.name ? `<div class="td-field"><span class="td-field-lbl">Assignee</span><span>${esc(issue.assignee.name)}</span></div>` : ''}
        ${issue.createdAt ? `<div class="td-field"><span class="td-field-lbl">Created</span><span>${new Date(issue.createdAt).toLocaleDateString()}</span></div>` : ''}
        ${(issue.labels?.nodes?.length) ? `<div class="td-field"><span class="td-field-lbl">Labels</span><span>${issue.labels.nodes.map(l => esc(l.name)).join(', ')}</span></div>` : ''}
      </div>
      ${issue.url ? `
        <div class="td-footer">
          <a class="btn-cfg-save" href="${esc(issue.url)}" target="_blank" rel="noopener">Open in Linear ↗</a>
        </div>` : ''}
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-close-td').addEventListener('click', closeTaskDetail);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeTaskDetail(); });
}

// ── Linear connection helpers ───────────────────────────────────────────────

function renderLinearSetup(body, integ) {
  body.innerHTML = `
    <div class="linear-setup">
      <div class="linear-setup-icon">◈</div>
      <div class="linear-setup-title">Connect Linear</div>
      <div class="linear-setup-desc">Add your API key to pull issues as tasks</div>
      <div class="linear-setup-form">
        <div class="field">
          <label class="field-label">API Key</label>
          <input class="field-input field-mono" id="lin-key" type="password"
            placeholder="lin_api_…" autocomplete="off" />
        </div>
        <div class="field" id="lin-team-field" style="display:none">
          <label class="field-label">Default Team</label>
          <div style="display:flex;gap:8px">
            <select class="field-input" id="lin-team"><option value="">— Select team —</option></select>
            <button class="btn-cfg-save" id="lin-load-teams">Load Teams</button>
          </div>
        </div>
        <div class="linear-setup-actions">
          <button class="btn-cfg-save" id="lin-save">Connect</button>
        </div>
      </div>
    </div>`;
  wireLinearForm(integ);
}

function renderLinearConnPanel(container, integ) {
  const linear = integ.linear || {};
  container.innerHTML = `
    <div class="lin-conn-panel">
      <div class="field">
        <label class="field-label">API Key</label>
        <input class="field-input field-mono" id="lin-key" type="password"
          value="${esc(linear.apiKey || '')}" placeholder="lin_api_…" autocomplete="off" />
      </div>
      <div class="field" id="lin-team-field">
        <label class="field-label">Default Team</label>
        <div style="display:flex;gap:8px">
          <select class="field-input" id="lin-team">
            <option value="">— Select team —</option>
            ${(linear.teams || []).map(t => `<option value="${esc(t.id)}"${linear.defaultTeamId === t.id ? ' selected' : ''}>${esc(t.name)} (${esc(t.key)})</option>`).join('')}
          </select>
          <button class="btn-cfg-save" id="lin-load-teams">Load Teams</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
        <button class="btn-danger-sm" id="lin-disconnect">Disconnect</button>
        <button class="btn-cfg-save" id="lin-save">Save</button>
      </div>
    </div>`;
  wireLinearForm(integ);
  $('#lin-disconnect').addEventListener('click', async () => {
    const btn = $('#lin-disconnect');
    btn.disabled = true; btn.textContent = '…';
    const newInteg = { ...integ, linear: {} };
    try {
      const r = await fetch(`/api/projects/${S.projectId}/integrations`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newInteg),
      });
      if (!r.ok) throw new Error();
      setIntegCache(newInteg);
      renderProjectTasks('linear');
    } catch { btn.disabled = false; btn.textContent = 'Disconnect'; }
  });
}

function wireLinearForm(integ) {
  const linear = integ.linear || {};
  $('#lin-key')?.addEventListener('input', () => {
    const tf = $('#lin-team-field');
    if (tf) tf.style.display = $('#lin-key').value.trim() ? '' : 'none';
  });
  $('#lin-load-teams')?.addEventListener('click', async () => {
    const btn = $('#lin-load-teams');
    btn.disabled = true; btn.textContent = '…';
    try {
      const r     = await fetch(`/api/projects/${S.projectId}/linear/teams`);
      const teams = await r.json();
      if (!r.ok) throw new Error(teams.error || `HTTP ${r.status}`);
      const sel = $('#lin-team');
      sel.innerHTML = '<option value="">— Select team —</option>' +
        teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)} (${esc(t.key)})</option>`).join('');
      btn.textContent = '✓';
    } catch { btn.textContent = '✗'; }
    finally {
      btn.disabled = false;
      setTimeout(() => { const b = $('#lin-load-teams'); if (b) b.textContent = 'Load Teams'; }, 2000);
    }
  });
  $('#lin-save')?.addEventListener('click', async () => {
    const btn    = $('#lin-save');
    const apiKey = $('#lin-key').value.trim();
    if (!apiKey) return;
    const teamId   = $('#lin-team')?.value || '';
    const newInteg = { ...integ, linear: { apiKey, defaultTeamId: teamId, teams: linear.teams || [] } };
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const r = await fetch(`/api/projects/${S.projectId}/integrations`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newInteg),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setIntegCache(newInteg);
      renderProjectTasks('linear');
    } catch {
      btn.disabled = false;
      setTimeout(() => { const b = $('#lin-save'); if (b) { b.disabled = false; b.textContent = 'Save'; } }, 2000);
    }
  });
}

// ── Assignment Panel ───────────────────────────────────────────────────────

export function closeAssignmentPanel() {
  const el = $('#assign-panel-overlay');
  if (el) el.remove();
  _assignPending = {};
}

export function openAssignmentPanel(issues, integ) {
  closeAssignmentPanel();
  const agents     = PROJECT_AGENTS[S.projectId] || [];
  const agentLabels = integ.agentLabels || [];

  const getIssueAgent = (issue) => {
    for (const lbl of (issue.labels?.nodes || [])) {
      const al = agentLabels.find(x => x.labelId === lbl.id);
      if (al) return al.agentId;
    }
    return '';
  };

  const agentOpts = agents.map(a =>
    `<option value="${esc(a.id)}">${esc(a.linearLabelName || a.name)}</option>`
  ).join('');

  const rows = issues.map(issue => {
    const cur = getIssueAgent(issue);
    return `
      <tr class="assign-row" data-issue-id="${esc(issue.id)}">
        <td class="assign-id">${esc(issue.identifier || '')}</td>
        <td class="assign-title">${esc(issue.title || 'Untitled')}</td>
        <td class="assign-agent-cell">
          <select class="assign-agent-sel field-input" data-issue-id="${esc(issue.id)}">
            <option value="">— Unassigned —</option>
            ${agentOpts}
          </select>
        </td>
      </tr>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'overlay on';
  overlay.id = 'assign-panel-overlay';
  overlay.innerHTML = `
    <div class="modal assign-modal">
      <div class="assign-modal-head">
        <div class="modal-title">Manage Assignments</div>
        <div class="assign-modal-actions">
          <button class="btn-assign-ai" id="btn-auto-assign">⚡ AI Auto-assign</button>
          <button class="btn-assign-apply" id="btn-apply-assign" disabled>Apply to Linear</button>
          <button class="btn-cancel" id="btn-close-assign">Cancel</button>
        </div>
      </div>
      <div class="assign-ai-log" id="assign-ai-log" style="display:none"></div>
      <div class="assign-table-wrap">
        <table class="assign-table">
          <thead><tr>
            <th>ID</th><th>Issue</th><th>Assign to Agent</th>
          </tr></thead>
          <tbody id="assign-tbody">${rows}</tbody>
        </table>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Pre-fill current assignments
  for (const issue of issues) {
    const cur = getIssueAgent(issue);
    const sel = overlay.querySelector(`select[data-issue-id="${issue.id}"]`);
    if (sel && cur) sel.value = cur;
  }

  // Track changes
  overlay.querySelectorAll('.assign-agent-sel').forEach(sel => {
    sel.addEventListener('change', () => {
      _assignPending[sel.dataset.issueId] = sel.value;
      $('#btn-apply-assign').disabled = Object.keys(_assignPending).length === 0;
    });
  });

  $('#btn-close-assign').addEventListener('click', closeAssignmentPanel);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeAssignmentPanel(); });

  $('#btn-auto-assign').addEventListener('click', () => runAutoAssign(issues, agents, overlay));
  $('#btn-apply-assign').addEventListener('click', () => applyAssignments(issues, integ, overlay));
}

async function runAutoAssign(issues, agents, overlay) {
  const btn    = overlay.querySelector('#btn-auto-assign');
  const logEl  = overlay.querySelector('#assign-ai-log');
  const tbody  = overlay.querySelector('#assign-tbody');
  btn.disabled = true; btn.textContent = '…';
  logEl.style.display = '';
  logEl.innerHTML = '';

  const setStatus = (msg) => {
    logEl.innerHTML = `<div class="assign-log-row">${esc(msg)}</div>`;
  };

  let assigned = 0;

  try {
    const r = await fetch(`/api/projects/${S.projectId}/linear/auto-assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issues }),
    });

    const reader = r.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const d = JSON.parse(line.slice(5).trim());

          if (d.type === 'assignment') {
            const row = tbody?.querySelector(`.assign-row[data-issue-id="${d.issueId}"]`);
            const sel = overlay.querySelector(`select[data-issue-id="${d.issueId}"]`);
            if (sel && d.agentId) {
              sel.value = d.agentId;
              if (sel.value === d.agentId) {
                _assignPending[d.issueId] = d.agentId;
                assigned++;
                if (row) row.classList.add('assign-row-done');
                if (d.reason) {
                  let tip = row?.querySelector('.assign-reason');
                  if (!tip) {
                    tip = document.createElement('span');
                    tip.className = 'assign-reason';
                    row?.querySelector('.assign-title')?.appendChild(tip);
                  }
                  tip.textContent = ' — ' + d.reason;
                }
              }
            }
            setStatus(`Applying… ${assigned} assigned`);
          }

          if (d.type === 'assignment-error') {
            const row = tbody?.querySelector(`.assign-row[data-issue-id="${d.issueId}"]`);
            if (row) { row.classList.remove('assign-row-active'); row.classList.add('assign-row-err'); }
          }

          if (d.type === 'progress') {
            setStatus(d.message);
          }

          if (d.type === 'done') {
            tbody?.querySelectorAll('.assign-row').forEach(r => r.classList.remove('assign-row-active'));
            setStatus(`✓ Done — ${assigned}/${issues.length} assigned`);
            logEl.querySelector('.assign-log-row')?.classList.add('assign-log-ok');
            $('#btn-apply-assign').disabled = assigned === 0;
          }

          if (d.type === 'error') {
            setStatus(d.message);
            logEl.querySelector('.assign-log-row')?.classList.add('assign-log-err');
          }
        } catch {}
      }
    }
  } catch (e) {
    setStatus('Error: ' + e.message);
    logEl.querySelector('.assign-log-row')?.classList.add('assign-log-err');
  } finally {
    btn.disabled = false; btn.textContent = '⚡ AI Auto-assign';
  }
}

async function applyAssignments(issues, integ, overlay) {
  const btn      = overlay.querySelector('#btn-apply-assign');
  const logEl    = overlay.querySelector('#assign-ai-log');
  const agents   = PROJECT_AGENTS[S.projectId] || [];
  const agentLabelsCurrent = integ.agentLabels || [];
  logEl.style.display = '';
  btn.disabled = true; btn.textContent = 'Applying…';

  const log = (msg, cls = '') => {
    logEl.innerHTML += `<div class="assign-log-row ${cls}">${esc(msg)}</div>`;
    logEl.scrollTop = logEl.scrollHeight;
  };

  try {
    const allAgentLabelIds = agentLabelsCurrent.map(x => x.labelId);
    const teamId = integ.linear?.defaultTeamId || '';
    let changed = 0;

    for (const [issueId, agentId] of Object.entries(_assignPending)) {
      if (!agentId) continue;
      const agent  = agents.find(a => a.id === agentId);
      if (!agent) continue;
      const lName  = agent.linearLabelName || agent.name;

      let labelEntry = agentLabelsCurrent.find(x => x.agentId === agentId);
      if (!labelEntry) {
        log(`Creating label "${lName}" in Linear…`);
        const cr = await fetch(`/api/projects/${S.projectId}/linear/labels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: lName, color: agent.color || '#94A3B8', teamId, agentId }),
        });
        if (!cr.ok) {
          const e = await cr.json();
          if (/duplicate/i.test(e.error || '')) {
            // Label already exists in Linear — fetch all labels and find it by name
            log(`Label "${lName}" already exists, looking it up…`);
            const lr = await fetch(`/api/projects/${S.projectId}/linear/labels${teamId ? `?teamId=${teamId}` : ''}`);
            if (lr.ok) {
              const allLabels = await lr.json();
              const existing = allLabels.find(l => l.name.toLowerCase() === lName.toLowerCase());
              if (existing) {
                labelEntry = { agentId, labelId: existing.id, labelName: existing.name };
                agentLabelsCurrent.push(labelEntry);
                allAgentLabelIds.push(existing.id);
                setIntegCache({ ...integ, agentLabels: agentLabelsCurrent });
              }
            }
            if (!labelEntry) { log(`✗ Could not resolve label "${lName}"`, 'assign-log-err'); continue; }
          } else {
            log(`✗ Failed to create label: ${e.error}`, 'assign-log-err'); continue;
          }
        } else {
          const newLabel = await cr.json();
          labelEntry = { agentId, labelId: newLabel.id, labelName: newLabel.name };
          agentLabelsCurrent.push(labelEntry);
          allAgentLabelIds.push(newLabel.id);
          setIntegCache({ ...integ, agentLabels: agentLabelsCurrent });
        }
      }

      const issue = issues.find(i => i.id === issueId);
      const curLabels = (issue?.labels?.nodes || []).map(l => l.id);
      const newLabels = [...curLabels.filter(id => !allAgentLabelIds.includes(id)), labelEntry.labelId];

      log(`Assigning "${lName}" → ${issue?.identifier || issueId}…`);
      const pr = await fetch(`/api/projects/${S.projectId}/linear/issues/${issueId}/labels`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labelIds: newLabels }),
      });
      if (!pr.ok) { const e = await pr.json(); log(`✗ ${e.error}`, 'assign-log-err'); continue; }
      changed++;
    }

    log(`✓ Applied ${changed} assignment${changed !== 1 ? 's' : ''}`, 'assign-log-ok');
    _assignPending = {};
    btn.textContent = '✓ Done';
    setTimeout(() => { closeAssignmentPanel(); renderProjectTasks('linear'); }, 1500);
  } catch (e) {
    log(`Error: ${e.message}`, 'assign-log-err');
    btn.disabled = false; btn.textContent = 'Apply to Linear';
  }
}
