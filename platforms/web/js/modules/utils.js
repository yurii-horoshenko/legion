// ── Utils ──────────────────────────────────────────────────────────────────

import i18n from '../i18n.js';

export const $ = (s, ctx = document) => ctx.querySelector(s);
export const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

export function initials(name) {
  const p = name.trim().split(/[\s_-]+/).filter(Boolean);
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

export function groupBy(arr, key) {
  return arr.reduce((a, x) => { (a[x[key]] = a[x[key]] || []).push(x); return a; }, {});
}

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Popularity badge for a skill/MCP search result: ★ 1.2k (GitHub stars), ↓ 530 (downloads/uses)
const METRIC_ICONS  = { stars: '★', downloads: '↓', uses: '↓' };
const METRIC_TITLES = { stars: 'GitHub stars', downloads: 'downloads', uses: 'installs' };
const fmtCount = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);
export const skillPopBadge = s => s?.stars
  ? `<span class="sk-pop" title="${METRIC_TITLES[s.metric] || 'popularity'}">${METRIC_ICONS[s.metric] || '★'} ${fmtCount(s.stars)}</span>`
  : '';

// Honest assign-button feedback: ✓ installed/linked, ⚠ needs manual setup, ✗ failed.
// `r` is { ok, install } from the assign endpoint.
export function applyAssignResult(btn, r) {
  const st = r?.install?.status;
  if (!r?.ok) { btn.textContent = '✗'; btn.title = 'Request failed'; btn.disabled = false; return false; }
  if (st === 'failed') { btn.textContent = '✗'; btn.title = 'Install failed: ' + (r.install.message || 'unknown error'); return false; }
  if (st === 'manual') { btn.textContent = '⚠'; btn.title = 'Linked, but requires manual install: ' + (r.install.message || ''); return true; }
  btn.textContent = '✓'; btn.title = st === 'mcp-wired' ? r.install.message : '';
  return true;
}

export function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return '';
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function tabDescHtml(tab) {
  return `<p class="tab-desc">${esc(i18n.t(`tab_desc_${tab}`))}</p>`;
}

export function renderMd(raw) {
  return String(raw ?? '')
    .split('\n')
    .map(line => {
      const e = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const b = e.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      return /^\s*\* /.test(line) ? '• ' + b.replace(/^\s*\* /, '') : b;
    })
    .join('<br>');
}
