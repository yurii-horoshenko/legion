# Legion — AI Agent Platform

> Локальная операционная платформа для управления AI-агентами.  
> Запускается одной командой, работает в браузере, хранит всё на диске.

---

## Текущее состояние (v0.1.0)

Работающий веб-портал с файловым хранилищем. Runtime-ядра (Swift) пока нет — платформа управляет конфигурацией, каталогом и метаданными агентов.

---

## Запуск

```bash
npm start          # запустить сервер + открыть браузер
npm run dev        # без автооткрытия браузера
```

Сервер стартует на `http://localhost:3000`.

---

## Архитектура

```
legion/
├── bin/legion.js              — HTTP-сервер (Node.js stdlib, без зависимостей)
├── core/
│   ├── agents/catalog/        — каталог агентов (Markdown frontmatter)
│   └── config/
│       ├── projects.json      — список проектов
│       ├── project-agents.json — агенты по проектам
│       ├── providers.json     — AI-провайдеры (без ключей)
│       ├── models.json        — сконфигурированные модели
│       ├── .pkeys.json        — API ключи провайдеров (gitignored)
│       └── .keys.json         — API ключи моделей (gitignored)
├── platforms/web/
│   ├── index.html             — один HTML-файл, без фреймворков
│   ├── js/app.js              — весь фронтенд (~1700 строк, vanilla JS)
│   ├── js/i18n.js             — локализация EN/RU
│   └── css/app.css            — все стили (~2000 строк)
└── docs/
    ├── overview.md            — этот файл
    └── web-setup.md
```

### Файловое хранилище проекта

Каждый проект может быть привязан к папке на диске. При привязке создаётся:

```
<project-path>/
└── .legion/
    ├── LEGION.md              — метаданные проекта (frontmatter)
    └── agents/
        └── <agent-id>/
            ├── agent.md       — frontmatter агента (id, model, added)
            ├── AGENTS.md      — инструкции для AI coding agents
            ├── IDENTITY.md    — идентичность и персонаж агента
            ├── SOUL.md        — ценности и принципы агента
            ├── USER.md        — контекст пользователя и проекта
            ├── tasks.json     — задачи агента (Kanban)
            ├── cron.json      — scheduled jobs
            ├── workers.json   — записи workers
            ├── channels.json  — каналы (HTTP, Telegram, Discord…)
            └── memories.json  — долгосрочная память
```

---

## API сервера

Все эндпоинты — JSON, без авторизации (localhost only).

### Проекты

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/projects` | Список проектов |
| POST | `/api/projects` | Создать / обновить проект |
| PATCH | `/api/projects/:id` | Изменить имя/описание/путь |
| DELETE | `/api/projects/:id` | Удалить проект + .legion папку |
| DELETE | `/api/projects/:id/legion` | Удалить только .legion папку |

### Агенты проекта

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/projects/:pid/agents` | Агенты проекта |
| POST | `/api/projects/:pid/agents` | Добавить агента / обновить |
| DELETE | `/api/projects/:pid/agents/:aid` | Удалить агента |

### Файлы агента

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/projects/:pid/agents/:aid/files/:name` | Прочитать MD-файл |
| PUT | `/api/projects/:pid/agents/:aid/files/:name` | Сохранить MD-файл |

Доступные файлы: `agent.md`, `AGENTS.md`, `IDENTITY.md`, `SOUL.md`, `USER.md`

### Хранилища агента (Tasks / Cron / Workers / Channels / Memories)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/projects/:pid/agents/:aid/:store` | Получить список |
| POST | `/api/projects/:pid/agents/:aid/:store` | Добавить запись |
| PATCH | `/api/projects/:pid/agents/:aid/:store/:id` | Обновить запись |
| DELETE | `/api/projects/:pid/agents/:aid/:store/:id` | Удалить запись |

`:store` — одно из: `tasks`, `cron`, `workers`, `channels`, `memories`

### Провайдеры и модели

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/providers` | Список провайдеров |
| POST | `/api/providers` | Создать/обновить провайдера |
| DELETE | `/api/providers/:id` | Удалить провайдера |
| GET | `/api/providers/:id/models` | Загрузить доступные модели с API |
| GET | `/api/models` | Список моделей |
| POST | `/api/models` | Создать/обновить модель |
| DELETE | `/api/models/:id` | Удалить модель |

Поддерживаемые провайдеры: **Anthropic, OpenAI, Google, Mistral, Ollama, Custom**

### Утилиты

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/pick-folder` | Открыть Finder (macOS) для выбора папки |

---

## Веб-интерфейс

### Структура экранов

```
┌─────────────────────────────────────────────┐
│  Topbar: проект ▾ · [+] · RU/EN · connected │
├──────────┬──────────────────────────────────┤
│  Rail    │  Main (один из четырёх экранов)  │
│          │                                  │
│  Agents  │  Dashboard  /  Catalog           │
│  ──────  │  Agent detail  /  Settings       │
│  Nav     │                                  │
└──────────┴──────────────────────────────────┘
```

Активен ровно один экран одновременно (`showView()` переключает все сразу).

### Dashboard

- Счётчики: агенты / workers / задачи / busy
- Activity feed (mock)
- Visor bulletins (mock)

### Catalog (Add Agent)

- 174+ агентов из [agency-agents](https://github.com/msitarzewski/agency-agents)
- Фильтры по группам (14 категорий)
- Поиск по имени
- Локализация карточек EN/RU
- Кнопка добавить → агент добавляется в проект, создаются файлы в .legion

### Agent detail

10 вкладок:

| Вкладка | Что делает |
|---------|-----------|
| Overview | Описание, vibe, capabilities, кнопка Remove |
| Chat | Базовый чат (без реального backend) |
| Workers | CRUD список workers с dot-индикатором статуса |
| Memories | Список с фильтром (Persistent / Temporary / Todo) |
| Tasks | Kanban по статусам (In Progress / Ready / Backlog / Done…) |
| Skills | Заглушка (ждёт Legion API runtime) |
| Tools | Заглушка (ждёт Legion API runtime) |
| Channels | CRUD каналов (HTTP, Telegram, Discord, Webhook, MCP) |
| Cron | CRUD scheduled jobs (schedule + command + channel) |
| Config | Выбор модели из Settings + редактор MD-файлов агента |

### Settings

3 вкладки:

| Вкладка | Что делает |
|---------|-----------|
| Overview | Имя/описание/путь проекта + кнопки Delete legion / Remove project |
| Providers | CRUD провайдеров с API ключами (хранятся отдельно, gitignored) |
| Models | CRUD моделей, загрузка списка с API провайдера |

---

## Локализация

Файл `js/i18n.js` — EN/RU. Переключается кнопкой в топбаре. Карточки каталога берут локаль из frontmatter MD-файлов агентов.

---

## Что запланировано (не реализовано)

| Компонент | Статус |
|-----------|--------|
| Swift runtime core (Channel/Branch/Worker) | Не начат |
| WebSocket live log | Не начат |
| Skills tab (GitHub registry) | Заглушка |
| Tools tab | Заглушка |
| Реальный Chat (подключение к модели) | Mock |
| Dashboard activity feed (реальные данные) | Mock |
| Visor bulletins (реальные данные) | Mock |
| iOS / macOS нативное приложение | Не начато |
| SQLite persistence | Не начато |
| ChromaDB vector memory | Не начато |
| Telegram / Discord gateway | Не начато |
