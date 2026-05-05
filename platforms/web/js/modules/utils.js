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
