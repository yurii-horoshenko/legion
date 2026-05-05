// ── Config tab ─────────────────────────────────────────────────────────────

import { S, MODELS, PROVIDERS, PROJECTS, PROJECT_AGENTS } from '../modules/state.js';
import { $, $$, esc } from '../modules/utils.js';
import { tabDescHtml } from '../modules/utils.js';
import i18n from '../i18n.js';

const DOC_DESCS = {
  'AGENTS.md':   'cfg_file_agents',
  'IDENTITY.md': 'cfg_file_identity',
  'SOUL.md':     'cfg_file_soul',
  'USER.md':     'cfg_file_user',
  'MEMORY.md':   'cfg_file_memory',
  'CONTEXT.md':  'cfg_file_context',
  'SKILLS.md':   'cfg_file_skills',
  'PIPELINE.md': 'cfg_file_pipeline',
};

export function renderConfig(a) {
  const el = $('#tab-config');
  const project = PROJECTS.find(p => p.id === S.projectId);
  const hasPath = !!project?.path;

  const modelOptions = MODELS.length
    ? MODELS.map(m => {
        const prov = PROVIDERS.find(p => p.id === m.providerId);
        const label = prov ? `${prov.name} / ${m.name}` : m.name;
        const sel = (a.model === m.modelId || a.modelId === m.modelId) ? ' selected' : '';
        return `<option value="${m.modelId}"${sel}>${label}</option>`;
      }).join('')
    : '<option value="">— No models configured —</option>';

  el.innerHTML = tabDescHtml('config') + `
    <div class="cfg-section">
      <div class="cfg-section-label">Model</div>
      <div class="cfg-model-row">
        <select class="field-input cfg-model-select" id="cfg-model-sel">
          <option value="">— Default —</option>
          ${modelOptions}
        </select>
        <button class="btn-cfg-save" id="cfg-model-save">Save</button>
        ${hasPath ? `<button class="btn-cfg-activate" id="cfg-model-activate" title="Write this model to .claude/settings.json so Claude Code uses it">⚡ Activate in Claude Code</button>` : ''}
      </div>
      ${!MODELS.length ? `<div class="cfg-hint">Add models in Settings → Models first</div>` : ''}
      ${hasPath ? `<div class="cfg-hint" id="cfg-activate-status"></div>` : ''}
    </div>

    <div class="cfg-section">
      <div class="cfg-section-label">Task Source</div>
      <div class="cfg-task-source-row">
        <label class="cfg-toggle-label">
          <input type="checkbox" id="cfg-linear-toggle" ${a.linearEnabled ? 'checked' : ''} />
          <span>Use Linear as task source</span>
        </label>
      </div>
      <div id="cfg-linear-fields" ${!a.linearEnabled ? 'style="display:none"' : ''}>
        <div class="cfg-linear-team-row">
          <input class="field-input" id="cfg-linear-label-name" type="text"
            value="${esc(a.linearLabelName || a.name || '')}" placeholder="Label name in Linear (default = agent name)" />
        </div>
        <div class="cfg-linear-team-row">
          <input class="field-input" id="cfg-linear-team-id" type="text"
            value="${esc(a.linearTeamId || '')}" placeholder="Team ID (leave empty for project default)" />
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:4px">
          <button class="btn-cfg-save" id="cfg-linear-save">Save</button>
        </div>
      </div>
      <div class="cfg-hint">Configure Linear API key in <b>Settings → Integrations</b>.</div>
    </div>

    ${hasPath ? `
    <div class="cfg-section cfg-files-section">
      <div class="cfg-section-label">Agent files</div>
      <div class="cfg-files-layout">
        <div class="cfg-file-list" id="cfg-file-tabs">
          <div class="cfg-file-loading">Loading…</div>
        </div>
        <div class="cfg-file-right">
          <div class="cfg-file-desc-block" id="cfg-file-desc">
            <div class="cfg-file-desc-name" id="cfg-file-desc-name"></div>
            <div class="cfg-file-desc-text" id="cfg-file-desc-text"></div>
          </div>
          <div class="cfg-editor-wrap">
            <textarea class="cfg-editor" id="cfg-editor" spellcheck="false" placeholder="Select a file…"></textarea>
            <div class="cfg-editor-foot">
              <span class="cfg-editor-status" id="cfg-editor-status"></span>
              <button class="btn-cfg-save" id="cfg-file-save">Save file</button>
            </div>
          </div>
        </div>
      </div>
    </div>` : `
    <div class="cfg-section">
      <div class="cfg-hint">Link a project folder in Settings → Overview to edit agent files.</div>
    </div>`}
  `;

  // Model save
  $('#cfg-model-save').addEventListener('click', async () => {
    const modelId = $('#cfg-model-sel').value;
    a.model = modelId;
    const map = (PROJECT_AGENTS[S.projectId] || []);
    const idx = map.findIndex(x => x.id === a.id);
    if (idx >= 0) { map[idx] = { ...map[idx], model: modelId }; a = map[idx]; }
    await fetch(`/api/projects/${S.projectId}/agents`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a) });
    const btn = $('#cfg-model-save');
    btn.textContent = 'Saved ✓'; setTimeout(() => btn.textContent = 'Save', 1500);
  });

  // Activate in Claude Code
  if (hasPath) {
    $('#cfg-model-activate').addEventListener('click', async () => {
      const activateBtn = $('#cfg-model-activate');
      const statusEl    = $('#cfg-activate-status');
      const modelId     = $('#cfg-model-sel').value;

      a.model = modelId;
      const map = (PROJECT_AGENTS[S.projectId] || []);
      const idx = map.findIndex(x => x.id === a.id);
      if (idx >= 0) { map[idx] = { ...map[idx], model: modelId }; a = map[idx]; }
      await fetch(`/api/projects/${S.projectId}/agents`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(a) });

      activateBtn.textContent = '…';
      try {
        const r = await fetch(`/api/projects/${S.projectId}/agents/${a.id}/activate`, { method: 'POST' });
        const d = await r.json();
        if (d.ok) {
          activateBtn.textContent = '⚡ Activate in Claude Code';
          statusEl.textContent = d.model
            ? `✓ Claude Code will use ${d.model} for this project`
            : '✓ Claude Code will use the default model';
          statusEl.style.color = 'var(--accent)';
        } else {
          throw new Error(d.error || 'Failed');
        }
      } catch (err) {
        activateBtn.textContent = '⚡ Activate in Claude Code';
        statusEl.textContent = `✗ ${err.message}`;
        statusEl.style.color = '#ef4444';
      }
    });
  }

  // Linear task source toggle
  const linearToggle = $('#cfg-linear-toggle');
  const linearFields = $('#cfg-linear-fields');
  if (linearToggle) {
    linearToggle.addEventListener('change', () => {
      if (linearFields) linearFields.style.display = linearToggle.checked ? '' : 'none';
    });
  }
  $('#cfg-linear-save')?.addEventListener('click', async () => {
    const btn       = $('#cfg-linear-save');
    const enabled   = $('#cfg-linear-toggle')?.checked || false;
    const labelName = $('#cfg-linear-label-name')?.value.trim() || '';
    const teamId    = $('#cfg-linear-team-id')?.value.trim() || '';
    const map = (PROJECT_AGENTS[S.projectId] || []);
    const idx = map.findIndex(x => x.id === a.id);
    if (idx >= 0) { map[idx] = { ...map[idx], linearEnabled: enabled, linearLabelName: labelName, linearTeamId: teamId }; a = map[idx]; }
    await fetch(`/api/projects/${S.projectId}/agents`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
    if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save'; }, 1500); }
  });

  if (!hasPath) return;

  let currentFile = '';

  function renderFileList(files) {
    const tabs = $('#cfg-file-tabs');
    if (!tabs) return;
    tabs.innerHTML = files.map((f, i) => `
      <button class="cfg-file-item${i === 0 ? ' on' : ''}" data-file="${f}">
        <span class="cfg-file-name">${f}</span>
      </button>`).join('');
    if (files.length) { currentFile = files[0]; updateFileDesc(files[0]); loadFile(files[0]); }
  }

  function updateFileDesc(filename) {
    const nameEl = $('#cfg-file-desc-name');
    const textEl = $('#cfg-file-desc-text');
    if (nameEl) nameEl.textContent = filename;
    if (textEl) textEl.textContent = i18n.t(DOC_DESCS[filename] || '');
  }

  async function loadFile(filename) {
    const status = $('#cfg-editor-status');
    if (!status) return;
    status.textContent = 'Loading…';
    try {
      const r = await fetch(`/api/projects/${S.projectId}/agents/${a.id}/files/${filename}`);
      const d = await r.json();
      $('#cfg-editor').value = d.content || '';
      status.textContent = '';
    } catch {
      status.textContent = '✗ Failed to load';
    }
  }

  // Fetch file list dynamically
  (async () => {
    try {
      const r = await fetch(`/api/projects/${S.projectId}/agents/${a.id}/files`);
      const d = await r.json();
      renderFileList(d.files?.length ? d.files : Object.keys(DOC_DESCS));
    } catch {
      renderFileList(Object.keys(DOC_DESCS));
    }
  })();

  $('#cfg-file-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.cfg-file-item');
    if (!btn) return;
    $$('.cfg-file-item').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    currentFile = btn.dataset.file;
    updateFileDesc(currentFile);
    loadFile(currentFile);
  });

  $('#cfg-file-save').addEventListener('click', async () => {
    const content = $('#cfg-editor').value;
    const status  = $('#cfg-editor-status');
    status.textContent = 'Saving…';
    try {
      await fetch(`/api/projects/${S.projectId}/agents/${a.id}/files/${currentFile}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      status.textContent = '✓ Saved';
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch {
      status.textContent = '✗ Save failed';
    }
  });
}
