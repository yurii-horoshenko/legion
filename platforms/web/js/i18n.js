const TRANSLATIONS = {
  en: {
    // Topbar
    connected: "connected",
    // Rail
    agents: "Agents",
    nav_dashboard: "Dashboard",
    nav_pipeline: "Pipeline",
    nav_memory: "Memory",
    nav_settings: "Settings",
    // Dashboard
    dash_title: "Overview",
    stat_agents: "Agents",
    stat_workers: "Workers",
    stat_tasks: "Tasks",
    stat_busy: "Busy",
    stat_hint_agents: "in this project",
    stat_hint_workers: "active now",
    stat_hint_tasks: "total",
    stat_hint_busy: "agents working",
    panel_activity: "Activity",
    panel_activity_link: "See all",
    panel_visor: "Visor Bulletins",
    panel_visor_link: "History",
    // Agent tabs
    tab_overview: "Overview",
    tab_chat: "Chat",
    tab_workers: "Workers",
    tab_memories: "Memories",
    tab_tasks: "Tasks",
    tab_skills: "Skills",
    tab_tools: "Tools",
    tab_channels: "Channels",
    tab_cron: "Cron",
    tab_config: "Config",
    // Agent overview
    ov_info: "Info",
    ov_description: "Description",
    ov_capabilities: "Capabilities",
    kv_id: "ID",
    kv_role: "Role",
    kv_model: "Model",
    kv_status: "Status",
    kv_tasks: "Tasks",
    kv_workers: "Workers",
    kv_channels: "Channels",
    // Agent placeholders
    ph_skills: "Skills appear once connected to Legion API",
    ph_tools: "Tools registered by this agent",
    ph_channels: "Active channels: HTTP, Telegram, Discord",
    ph_cron: "Scheduled jobs for this agent",
    // Chat
    chat_placeholder: "Send a message…",
    chat_send: "Send",
    chat_greeting: "Hello. I'm {name}. How can I assist?",
    chat_mock: "Processing… (connect Legion API for real responses)",
    // Catalog
    catalog_title: "Add Agent",
    catalog_subtitle: "Choose agents to add to",
    catalog_back: "← Back",
    catalog_search: "Search agents…",
    catalog_loading: "Loading catalog…",
    catalog_add: "+ Add",
    catalog_added: "✓ Added",
    catalog_filter_all: "All",
    // Modal
    modal_title: "New Project",
    modal_name_label: "Project name",
    modal_name_placeholder: "e.g. BladeParry",
    modal_desc_label: "Description",
    modal_desc_placeholder: "Short description",
    modal_cancel: "Cancel",
    modal_create: "Create",
    // Translate button
    btn_translate: "Translate",
    btn_original: "Original",
    translating: "Translating…",
  },

  ru: {
    connected: "подключено",
    agents: "Агенты",
    nav_dashboard: "Дашборд",
    nav_pipeline: "Пайплайн",
    nav_memory: "Память",
    nav_settings: "Настройки",
    dash_title: "Обзор",
    stat_agents: "Агенты",
    stat_workers: "Воркеры",
    stat_tasks: "Задачи",
    stat_busy: "Активны",
    stat_hint_agents: "в этом проекте",
    stat_hint_workers: "прямо сейчас",
    stat_hint_tasks: "всего",
    stat_hint_busy: "работают",
    panel_activity: "Активность",
    panel_activity_link: "Все",
    panel_visor: "Бюллетени Визора",
    panel_visor_link: "История",
    tab_overview: "Обзор",
    tab_chat: "Чат",
    tab_workers: "Воркеры",
    tab_memories: "Память",
    tab_tasks: "Задачи",
    tab_skills: "Скиллы",
    tab_tools: "Инструменты",
    tab_channels: "Каналы",
    tab_cron: "Расписание",
    tab_config: "Конфиг",
    ov_info: "Инфо",
    ov_description: "Описание",
    ov_capabilities: "Возможности",
    kv_id: "ID",
    kv_role: "Роль",
    kv_model: "Модель",
    kv_status: "Статус",
    kv_tasks: "Задач",
    kv_workers: "Воркеров",
    kv_channels: "Каналы",
    ph_skills: "Скиллы появятся после подключения Legion API",
    ph_tools: "Инструменты зарегистрированные агентом",
    ph_channels: "Активные каналы: HTTP, Telegram, Discord",
    ph_cron: "Расписание задач агента",
    chat_placeholder: "Написать сообщение…",
    chat_send: "Отправить",
    chat_greeting: "Привет. Я {name}. Чем могу помочь?",
    chat_mock: "Обработка… (подключите Legion API для реальных ответов)",
    catalog_title: "Добавить агента",
    catalog_subtitle: "Выберите агентов для проекта",
    catalog_back: "← Назад",
    catalog_search: "Поиск агентов…",
    catalog_loading: "Загрузка каталога…",
    catalog_add: "+ Добавить",
    catalog_added: "✓ Добавлен",
    catalog_filter_all: "Все",
    modal_title: "Новый проект",
    modal_name_label: "Название проекта",
    modal_name_placeholder: "например, BladeParry",
    modal_desc_label: "Описание",
    modal_desc_placeholder: "Краткое описание",
    modal_cancel: "Отмена",
    modal_create: "Создать",
    btn_translate: "Перевести",
    btn_original: "Оригинал",
    translating: "Перевод…",
  },
};

let currentLang = localStorage.getItem("legion_lang") || "en";

function t(key, vars = {}) {
  let str = TRANSLATIONS[currentLang]?.[key] ?? TRANSLATIONS.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replace(`{${k}}`, v);
  }
  return str;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem("legion_lang", lang);
  applyLang();
}

function applyLang() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // Update lang toggle button
  const btn = document.getElementById("lang-toggle");
  if (btn) btn.textContent = currentLang === "en" ? "RU" : "EN";
}

// Free translation via MyMemory API (no key needed, 1000 req/day)
async function translateText(text) {
  const pair = currentLang === "ru" ? "en|ru" : "ru|en";
  const url  = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`;
  const res  = await fetch(url);
  const data = await res.json();
  return data?.responseData?.translatedText || text;
}

window.i18n = { t, setLang, applyLang, translateText, get lang() { return currentLang; } };
