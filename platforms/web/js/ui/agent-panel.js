// ── Agent detail panel ─────────────────────────────────────────────────────

import { S, MODELS, PROVIDERS, PROJECT_AGENTS, PROJECTS } from '../modules/state.js';
import { $, $$, esc, initials } from '../modules/utils.js';
import { AGENT_REGISTRY } from '../modules/state.js';
import { apiRemoveAgent, fetchProviders, fetchModels } from '../modules/api.js';
import { renderTree } from './sidebar.js';
import { showView, showDash } from './dashboard.js';
import { renderAgentOverview } from '../tabs/overview.js';
import { renderWorkers } from '../tabs/workers.js';
import { renderMemories } from '../tabs/memories.js';
import { renderTasks } from '../tabs/tasks.js';
import { renderPipeline } from '../tabs/pipeline.js';
import { renderChannels } from '../tabs/channels.js';
import { renderCron } from '../tabs/cron.js';
import { renderChat } from '../tabs/chat.js';
import { renderSkills } from '../tabs/skills.js';
import { renderConfig } from '../tabs/config.js';

// showAgent is an alias for selectAgent (used by tasks-view)
export function showAgent(a) { selectAgent(a.id); }

export function selectAgent(id) {
  S.agentId = id;
  S.tab = 'overview';
  renderTree();

  const a = AGENT_REGISTRY[id];
  if (!a) return;

  showView('view-agent');

  $('#a-ava').textContent = initials(a.name);
  $('#a-ava').style.cssText = `background:${a.color}18;color:${a.color};border:1px solid ${a.color}30`;
  $('#a-name').textContent = a.name;
  $('#a-role').textContent = a.role;
  $('#a-role').style.cssText = `background:${a.color}15;color:${a.color};border:1px solid ${a.color}30`;
  $('#a-model').textContent = a.model;
  $('#a-status-dot').className = `a-dot ${a.status}`;

  $$('.a-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === 'overview'));
  $$('.tab-body').forEach(b => b.classList.toggle('on', b.dataset.tab === 'overview'));
  renderTab('overview', a);
}

export async function renderTab(tab, agent) {
  S.tab = tab;
  if (!agent) agent = AGENT_REGISTRY[S.agentId];
  if (!agent) return;

  if (tab === 'overview')  renderAgentOverview(agent);
  if (tab === 'workers')   renderWorkers(agent);
  if (tab === 'memories')  renderMemories(agent);
  if (tab === 'tasks')     renderTasks(agent);
  if (tab === 'pipeline')  renderPipeline(agent);
  if (tab === 'channels')  renderChannels(agent);
  if (tab === 'cron')      renderCron(agent);
  if (tab === 'chat')      renderChat(agent);
  if (tab === 'skills')    renderSkills(agent);
  if (tab === 'config') {
    if (!MODELS.length || !PROVIDERS.length) await Promise.all([fetchProviders(), fetchModels()]);
    renderConfig(agent);
  }
}
