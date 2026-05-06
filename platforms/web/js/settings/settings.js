// ── Settings view ───────────────────────────────────────────────────────────

import { S, PROJECTS, MODELS, PROVIDERS, LEGION_CONFIG, PROJECT_AGENTS,
         setLegionConfig, setProviders, setModels, setProjects } from '../modules/state.js';
import { $, $$, esc } from '../modules/utils.js';
import { fetchProviders, fetchModels, apiSaveProvider, apiDeleteProvider,
         apiFetchRemoteModels, apiSaveModel, apiDeleteModel } from '../modules/api.js';
import { showView, showDash } from '../ui/dashboard.js';
import { renderProjBtn } from '../ui/topbar.js';
import { renderTree } from '../ui/sidebar.js';
import i18n from '../i18n.js';

const PROVIDER_META = {
  anthropic:   { icon: '◆', color: '#D97706', label: 'Anthropic',  hasKey: true,  hasEndpoint: false },
  openai:      { icon: '⬡', color: '#10B981', label: 'OpenAI',     hasKey: true,  hasEndpoint: false },
  google:      { icon: '◉', color: '#3B82F6', label: 'Google',     hasKey: true,  hasEndpoint: false },
  mistral:     { icon: '◈', color: '#8B5CF6', label: 'Mistral',    hasKey: true,  hasEndpoint: false },
  ollama:      { icon: '◎', color: '#64748B', label: 'Ollama',     hasKey: false, hasEndpoint: true  },
  'claude-cli':{ icon: '▲', color: '#FF4D00', label: 'Claude CLI', hasKey: false, hasEndpoint: false },
  custom:      { icon: '◇', color: '#94A3B8', label: 'Custom',     hasKey: true,  hasEndpoint: true  },
};

export { PROVIDER_META };

let providerEditId = null;
let modelEditId = null;

// ── Settings entry ─────────────────────────────────────────────────────────

export async function showSettings() {
  showView('view-settings');
  await Promise.all([fetchProviders(), fetchModels()]);
  renderGeneral();
  renderProviders();
  renderModels();
}

export function hideSettings() {
  showDash();
}

// ── Overview ───────────────────────────────────────────────────────────────

export function showOverview() {
  import('../ui/dashboard.js').then(({ showDash }) => showDash());
}

export function renderOverview() {
  const p = PROJECTS.find(x => x.id === S.projectId);
  if (!p) { $('#overview-form').innerHTML = '<div style="color:var(--text-3);padding:24px 0">No project selected</div>'; return; }
  const hasLegion = !!p.path;
  $('#overview-form').innerHTML = `
    <div class="overview-fields">
      <div class="field">
        <label class="field-label">Project name</label>
        <input class="field-input" id="ov-name" type="text" value="${esc(p.name)}" />
      </div>
      <div class="field">
        <label class="field-label">Description</label>
        <input class="field-input" id="ov-desc" type="text" value="${esc(p.description || '')}" placeholder="Short description" />
      </div>
      <div class="field">
        <label class="field-label">Project folder</label>
        <div class="path-field-wrap">
          <input class="field-input field-mono" id="ov-path" type="text" value="${esc(p.path || '')}" placeholder="/path/to/project" />
          <button class="btn-browse" id="ov-browse" title="Browse">⌂</button>
        </div>
      </div>
      <div class="overview-actions">
        <button class="btn-ov-save" id="ov-save">Save changes</button>
      </div>
    </div>
    <div class="overview-danger">
      <div class="danger-title">Danger zone</div>
      <div class="danger-row">
        <div>
          <div class="danger-label">Delete .legion folder</div>
          <div class="danger-hint">Removes .legion/LEGION.md and all Legion config from the project folder</div>
        </div>
        <button class="btn-danger" id="ov-del-legion" ${!hasLegion ? 'disabled' : ''}>Delete .legion</button>
      </div>
      <div class="danger-row">
        <div>
          <div class="danger-label">Remove project</div>
          <div class="danger-hint">Removes this project from Legion (also deletes .legion folder if present)</div>
        </div>
        <button class="btn-danger" id="ov-del-project">Remove project</button>
      </div>
    </div>`;

  $('#ov-browse').addEventListener('click', async () => {
    $('#ov-browse').disabled = true;
    try {
      const res = await fetch('/api/pick-folder');
      const { path } = await res.json();
      if (path) {
        $('#ov-path').value = path;
        const folderName = path.split('/').filter(Boolean).pop();
        if (folderName && $('#ov-name').value === p.name) $('#ov-name').value = folderName;
      }
    } finally { $('#ov-browse').disabled = false; }
  });

  $('#ov-save').addEventListener('click', saveOverview);

  if (hasLegion) {
    $('#ov-del-legion').addEventListener('click', async () => {
      if (!confirm('Delete .legion folder from project directory?')) return;
      await fetch(`/api/projects/${p.id}/legion`, { method: 'DELETE' });
    });
  }

  $('#ov-del-project').addEventListener('click', async () => {
    if (!confirm(`Remove project "${p.name}" from Legion?`)) return;
    await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
    setProjects(PROJECTS.filter(x => x.id !== p.id));
    S.projectId = PROJECTS[0]?.id || null;
    renderProjBtn();
    renderTree();
    hideSettings();
    showDash();
  });
}

export async function saveOverview() {
  const p = PROJECTS.find(x => x.id === S.projectId);
  if (!p) return;
  const name        = $('#ov-name').value.trim() || p.name;
  const description = $('#ov-desc').value.trim();
  const path        = $('#ov-path').value.trim();

  const res = await fetch(`/api/projects/${p.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, path }),
  });
  const updated = await res.json();
  const idx = PROJECTS.findIndex(x => x.id === p.id);
  if (idx >= 0) PROJECTS[idx] = updated;
  renderProjBtn();
  renderOverview();
}

// ── General tab ────────────────────────────────────────────────────────────

export function renderGeneral() {
  const sel = $('#general-default-model');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select a model —</option>' +
    MODELS.map(m => {
      const prov = PROVIDERS.find(p => p.id === m.providerId);
      const label = prov ? `${prov.name} / ${m.name}` : m.name;
      const selected = LEGION_CONFIG.defaultModelId === m.id ? ' selected' : '';
      return `<option value="${esc(m.id)}"${selected}>${esc(label)}</option>`;
    }).join('');

  const saveBtn = $('#general-save');
  saveBtn.onclick = async () => {
    const modelId = sel.value;
    if (!modelId) {
      saveBtn.textContent = 'Select a model first';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const r = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultModelId: modelId }),
      });
      if (!r.ok) throw new Error(`Server error ${r.status}`);
      setLegionConfig(await r.json());
      saveBtn.textContent = '✓ Saved';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
    } catch (e) {
      console.error('Config save failed:', e);
      saveBtn.textContent = '✗ Error';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 2000);
    } finally {
      saveBtn.disabled = false;
    }
  };

  // ── Auto-apply toggle (ON by default) ──────────────────────────────────
  const toggle = $('#general-auto-apply');
  if (toggle) {
    toggle.checked = LEGION_CONFIG.autoApplyModel !== false;
    toggle.addEventListener('change', async () => {
      const updated = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoApplyModel: toggle.checked }),
      }).then(r => r.json()).catch(() => null);
      if (updated) setLegionConfig(updated);
    });
  }

  // ── Linear "all agents" toggle ─────────────────────────────────────────
  const linAllToggle = $('#general-linear-all');
  if (linAllToggle && S.projectId) {
    fetch(`/api/projects/${S.projectId}/integrations`)
      .then(r => r.json())
      .then(integ => {
        linAllToggle.checked = (integ.linear?.enableForAllAgents !== false);
        linAllToggle.addEventListener('change', async () => {
          const current = await fetch(`/api/projects/${S.projectId}/integrations`).then(r => r.json()).catch(() => ({}));
          const updated = { ...current, linear: { ...(current.linear || {}), enableForAllAgents: linAllToggle.checked } };
          await fetch(`/api/projects/${S.projectId}/integrations`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated),
          }).catch(() => {});
        });
      }).catch(() => {
        linAllToggle.checked = true;
      });
  }
}

// ── Providers ──────────────────────────────────────────────────────────────

export function renderProviders() {
  const list = $('#providers-list');
  if (!PROVIDERS.length) {
    list.innerHTML = `<div class="models-empty">
      <div class="models-empty-icon">◈</div>
      <div>No providers configured yet</div>
      <div style="margin-top:6px;font-size:11px;opacity:.6">Add Anthropic, OpenAI, Ollama, or other providers</div>
    </div>`;
    return;
  }
  list.innerHTML = PROVIDERS.map(p => {
    const meta = PROVIDER_META[p.type] || PROVIDER_META.custom;
    const hasCredential = meta.hasKey ? !!p.key : !!p.endpoint;
    const credLabel = meta.hasKey
      ? (p.key ? '● key set' : '○ no key')
      : (p.endpoint || '○ no endpoint');
    return `
    <div class="model-row" data-id="${p.id}">
      <div class="model-provider-icon" style="background:${meta.color}18;color:${meta.color}">${meta.icon}</div>
      <div class="model-info">
        <div class="model-name">${esc(p.name || meta.label)}</div>
        <div class="model-id">${esc(meta.label)}</div>
      </div>
      <div class="model-key-badge ${hasCredential ? 'set' : ''}">${credLabel}</div>
      <div class="model-actions">
        <button class="model-btn" data-action="edit" data-id="${p.id}">Edit</button>
        <button class="model-btn danger" data-action="delete" data-id="${p.id}">Delete</button>
      </div>
    </div>`;
  }).join('');

  $$('#providers-list .model-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (btn.dataset.action === 'delete') {
        await apiDeleteProvider(id);
        setProviders(PROVIDERS.filter(p => p.id !== id));
        renderProviders();
      } else {
        openProviderModal(id);
      }
    });
  });
}

export function openProviderModal(editId = null) {
  providerEditId = editId;
  const p = editId ? PROVIDERS.find(x => x.id === editId) : null;

  $('#pm-title').textContent = p ? 'Edit Provider' : 'Add Provider';
  $('#pm-name').value     = p?.name     || '';
  $('#pm-key').value      = p?.key      || '';
  $('#pm-endpoint').value = p?.endpoint || '';

  const type = p?.type || 'anthropic';
  $$('#pm-types .provider-pill').forEach(pill => pill.classList.toggle('on', pill.dataset.provider === type));
  updateProviderModalFields(type);
  if (!p) $('#pm-name').value = PROVIDER_META[type]?.label || '';

  $('#provider-modal').classList.add('on');
  $('#pm-name').focus();
}

export function closeProviderModal() {
  $('#provider-modal').classList.remove('on');
  providerEditId = null;
}

export function updateProviderModalFields(type) {
  const meta = PROVIDER_META[type] || PROVIDER_META.custom;
  $('#pm-field-key').style.display      = meta.hasKey      ? '' : 'none';
  $('#pm-field-endpoint').style.display = meta.hasEndpoint ? '' : 'none';
}

export async function saveProvider() {
  const type     = $$('#pm-types .provider-pill').find(p => p.classList.contains('on'))?.dataset.provider || 'custom';
  const meta     = PROVIDER_META[type] || PROVIDER_META.custom;
  const name     = $('#pm-name').value.trim() || meta.label;
  const key      = $('#pm-key').value.trim();
  const endpoint = $('#pm-endpoint').value.trim();

  const provider = providerEditId
    ? { ...(PROVIDERS.find(x => x.id === providerEditId) || {}), type, name, key, endpoint }
    : { type, name, key, endpoint };

  const saved = await apiSaveProvider(provider);
  if (providerEditId) {
    const idx = PROVIDERS.findIndex(x => x.id === providerEditId);
    if (idx >= 0) PROVIDERS[idx] = saved; else PROVIDERS.push(saved);
  } else {
    PROVIDERS.push(saved);
  }
  closeProviderModal();
  renderProviders();
}

// ── Models ─────────────────────────────────────────────────────────────────

export function renderModels() {
  const list = $('#models-list');
  if (!MODELS.length) {
    list.innerHTML = `<div class="models-empty">
      <div class="models-empty-icon">⬡</div>
      <div>No models configured yet</div>
      <div style="margin-top:6px;font-size:11px;opacity:.6">Configure a provider first, then add models from it</div>
    </div>`;
    return;
  }
  list.innerHTML = MODELS.map(m => {
    const providerObj = PROVIDERS.find(p => p.id === m.providerId);
    const meta = PROVIDER_META[providerObj?.type] || PROVIDER_META.custom;
    return `
    <div class="model-row" data-id="${m.id}">
      <div class="model-provider-icon" style="background:${meta.color}18;color:${meta.color}">${meta.icon}</div>
      <div class="model-info">
        <div class="model-name">${esc(m.name)}</div>
        <div class="model-id">${esc(m.modelId)}</div>
      </div>
      <div class="model-notes">${esc(m.notes || '')}</div>
      <div class="model-key-badge set" style="opacity:.5">${esc(providerObj?.name || '—')}</div>
      <div class="model-actions">
        <button class="model-btn" data-action="edit" data-id="${m.id}">Edit</button>
        <button class="model-btn danger" data-action="delete" data-id="${m.id}">Delete</button>
      </div>
    </div>`;
  }).join('');

  $$('#models-list .model-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (btn.dataset.action === 'delete') {
        await apiDeleteModel(id);
        setModels(MODELS.filter(m => m.id !== id));
        renderModels();
      } else {
        openModelModal(id);
      }
    });
  });
}

export function openModelModal(editId = null) {
  modelEditId = editId;
  const m = editId ? MODELS.find(x => x.id === editId) : null;

  $('#mm-title').textContent = m ? 'Edit Model' : 'Add Model';
  $('#mm-name').value    = m?.name    || '';
  $('#mm-notes').value   = m?.notes   || '';

  const sel = $('#mm-provider');
  sel.innerHTML = PROVIDERS.map(p => {
    const meta = PROVIDER_META[p.type] || PROVIDER_META.custom;
    return `<option value="${p.id}">${meta.icon} ${p.name}</option>`;
  }).join('');
  if (m?.providerId) sel.value = m.providerId;

  $('#mm-model-select').style.display = 'none';
  $('#mm-model-id').style.display = '';
  $('#mm-model-id').value = m?.modelId || '';
  $('#mm-fetch-status').textContent = '';

  $('#model-modal').classList.add('on');
}

export function closeModelModal() {
  $('#model-modal').classList.remove('on');
  modelEditId = null;
}

export async function fetchModelsForModal() {
  const providerId = $('#mm-provider').value;
  if (!providerId) return;
  const status = $('#mm-fetch-status');
  status.textContent = 'Loading…';
  $('#mm-fetch-btn').disabled = true;

  const result = await apiFetchRemoteModels(providerId);

  $('#mm-fetch-btn').disabled = false;
  if (result?.error) { status.textContent = '✗ ' + result.error; return; }
  if (!result?.length) { status.textContent = '✗ No models returned'; return; }

  status.textContent = `✓ ${result.length} models`;
  const sel = $('#mm-model-select');
  sel.innerHTML = result.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
  sel.style.display = '';
  $('#mm-model-id').style.display = 'none';

  sel.onchange = () => {
    const chosen = result.find(r => r.id === sel.value);
    if (chosen) $('#mm-name').value = chosen.name;
  };
  if (result[0]) $('#mm-name').value = result[0].name;
}

export async function saveModel() {
  const providerId = $('#mm-provider').value;
  const name       = $('#mm-name').value.trim();
  const modelSel   = $('#mm-model-select');
  const modelId    = modelSel.style.display !== 'none'
    ? modelSel.value
    : $('#mm-model-id').value.trim();
  const notes      = $('#mm-notes').value.trim();

  if (!name || !modelId) {
    if (!name) $('#mm-name').focus(); else $('#mm-model-id').focus();
    return;
  }

  const model = modelEditId
    ? { ...(MODELS.find(x => x.id === modelEditId) || {}), providerId, name, modelId, notes }
    : { providerId, name, modelId, notes };

  const saved = await apiSaveModel(model);
  if (modelEditId) {
    const idx = MODELS.findIndex(x => x.id === modelEditId);
    if (idx >= 0) MODELS[idx] = saved; else MODELS.push(saved);
  } else {
    MODELS.push(saved);
  }
  closeModelModal();
  renderModels();
}

