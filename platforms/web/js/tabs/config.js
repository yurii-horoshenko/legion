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
        const sel = (a.model === m.modelId || a.model === m.id || a.modelId === m.modelId) ? ' selected' : '';
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
      </div>
      ${!MODELS.length ? `<div class="cfg-hint">Add models in Settings → Models first</div>` : ''}
    </div>

    <div class="cfg-section">
      <div class="cfg-section-label">Task Source</div>
      <div class="cfg-auto-apply-row">
        <label class="cfg-switch">
          <input type="checkbox" id="cfg-linear-toggle" ${a.linearEnabled ? 'checked' : ''}>
          <span class="cfg-switch-track"></span>
        </label>
        <div class="cfg-auto-apply-title">Linear</div>
      </div>
      <div class="cfg-hint">Configure Linear API key in <b>Settings → Integrations</b>.</div>
    </div>

    <div class="cfg-section">
      <div class="cfg-section-label">Capabilities</div>
      <div class="cfg-auto-apply-row">
        <label class="cfg-switch">
          <input type="checkbox" id="cfg-file-access-toggle" ${a.allowedTools ? 'checked' : ''}>
          <span class="cfg-switch-track"></span>
        </label>
        <div>
          <div class="cfg-auto-apply-title">Allow reading project files</div>
          <div class="cfg-hint" style="margin-top:3px">Gives this agent access to Read, Glob, Grep via Claude Code CLI. Enable for architects, analysts, developers.</div>
        </div>
      </div>
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
              <button class="btn-cfg-init" id="cfg-auto-fill" title="AI fills all files based on project docs">✦ Auto-fill</button>
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

  // Linear task source toggle — auto-save on change
  const linearToggle = $('#cfg-linear-toggle');
  if (linearToggle) {
    linearToggle.addEventListener('change', async () => {
      const enabled = linearToggle.checked;
      const map = (PROJECT_AGENTS[S.projectId] || []);
      const idx = map.findIndex(x => x.id === a.id);
      if (idx >= 0) { map[idx] = { ...map[idx], linearEnabled: enabled }; a = map[idx]; }
      await fetch(`/api/projects/${S.projectId}/agents`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
    });
  }

  // File access toggle — auto-save on change
  const fileAccessToggle = $('#cfg-file-access-toggle');
  if (fileAccessToggle) {
    fileAccessToggle.addEventListener('change', async () => {
      const allowedTools = fileAccessToggle.checked ? 'Read,LS,Glob,Grep' : '';
      const map = (PROJECT_AGENTS[S.projectId] || []);
      const idx = map.findIndex(x => x.id === a.id);
      if (idx >= 0) { map[idx] = { ...map[idx], allowedTools }; a = map[idx]; }
      await fetch(`/api/projects/${S.projectId}/agents`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
    });
  }

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

  $('#cfg-auto-fill').addEventListener('click', async () => {
    const btn    = $('#cfg-auto-fill');
    const status = $('#cfg-editor-status');
    btn.disabled = true;
    btn.textContent = '…';
    status.textContent = 'Initializing…';

    try {
      const es = new EventSource(`/api/projects/${S.projectId}/agents/${a.id}/initialize`, { withCredentials: false });
      // POST via fetch-SSE pattern: EventSource only does GET, so we use POST + poll
      es.close();

      const res = await fetch(`/api/projects/${S.projectId}/agents/${a.id}/initialize`, { method: 'POST' });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'progress') status.textContent = ev.message;
              if (ev.type === 'done') {
                status.textContent = '✓ All files filled';
                // Reload current file in editor
                loadFile(currentFile);
                setTimeout(() => { status.textContent = ''; }, 3000);
              }
              if (ev.type === 'fail') {
                status.textContent = '✗ ' + ev.message;
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      status.textContent = '✗ ' + err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '✦ Auto-fill';
    }
  });
}
