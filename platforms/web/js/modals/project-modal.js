// ── Project modal ──────────────────────────────────────────────────────────

import { S, PROJECTS, setProjects } from '../modules/state.js';
import { $ } from '../modules/utils.js';
import { renderProjBtn } from '../ui/topbar.js';
import { renderTree } from '../ui/sidebar.js';
import { showDash } from '../ui/dashboard.js';

export function openModal() {
  $('#modal').classList.add('on');
  $('#m-name').focus();
}

export function closeModal() {
  $('#modal').classList.remove('on');
  $('#m-name').value = '';
  $('#m-desc').value = '';
  $('#m-path').value = '';
}

export async function createProject() {
  const name = $('#m-name').value.trim();
  if (!name) return;
  const desc = $('#m-desc').value.trim();
  const path = $('#m-path').value.trim();

  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: desc, path, status: 'ok', agents: 0 }),
  });
  const project = await res.json();
  PROJECTS.push(project);
  S.projectId = project.id;
  S.agentId = null;
  renderProjBtn();
  renderTree();
  showDash();
  closeModal();
}
