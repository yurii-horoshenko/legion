// ── i18n ───────────────────────────────────────────────────────────────────
// Strings live in /locales/{lang}.json.
// Call i18n.init() once on startup, then use i18n.t(key) synchronously.

const LOCALES = {};
let currentLang = localStorage.getItem('legion_lang') || 'en';

async function loadLocale(lang) {
  if (LOCALES[lang]) return;
  try {
    const r = await fetch(`/locales/${lang}.json`);
    LOCALES[lang] = await r.json();
  } catch {
    LOCALES[lang] = {};
  }
}

async function init() {
  await Promise.all([loadLocale('en'), loadLocale('ru')]);
  applyLang();
}

function t(key, vars = {}) {
  let str = LOCALES[currentLang]?.[key] ?? LOCALES.en?.[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replace(`{${k}}`, v);
  }
  return str;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('legion_lang', lang);
  applyLang();
}

function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = currentLang === 'en' ? 'RU' : 'EN';
}

async function translateText(text) {
  const pair = currentLang === 'ru' ? 'en|ru' : 'ru|en';
  const url  = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`;
  const res  = await fetch(url);
  const data = await res.json();
  return data?.responseData?.translatedText || text;
}

const i18n = {
  init,
  t,
  setLang,
  applyLang,
  translateText,
  get lang() { return currentLang; },
};

window.i18n = i18n;
export default i18n;
