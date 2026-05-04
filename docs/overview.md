# Legion — AI Agent Runtime Platform

> Personal AI operations platform. Structured like an engine, feels like a companion.

---

## Что такое Legion

Legion — это многоагентная платформа, которая объединяет:

- **структурированный runtime** (по образцу Sloppy): Channel/Branch/Worker, deterministic routing, Visor bulletins
- **визуальный персональный портал** (по образцу Agent Factory): комнаты, фазы работы, гибридный роутинг моделей

Запускается нативно на **macOS, iOS, Linux** и параллельно предоставляет **веб-интерфейс** для доступа с любого устройства через браузер.

---

## Ключевые принципы

| Принцип | Почему |
|---------|--------|
| Runtime-first | Агенты реально выполняют задачи, не просто генерируют документы |
| Deterministic routing | Решения о том, кто делает задачу, принимает система, а не LLM |
| Operator visibility | Всё что делает агент — видно оператору в реальном времени |
| Hybrid models | Локальные модели (Ollama) для рутины, облако (Claude/GPT) для сложных задач |
| Portable | Один codebase — нативные приложения + веб |

---

## Функциональность

### 1. Runtime-ядро (Swift 6)

Взято из Sloppy, адаптировано под Legion.

```
Channel         — точка входа (HTTP API, Telegram, Discord, iOS app)
  └── Branch    — сфокусированная задача (пишет код, анализирует, ревьюит)
        └── Worker — атомарное выполнение (вызов модели, инструмента, скрипта)
```

- **Rule-based роутинг** — каждый тип задачи маппится на агента через конфиг, не через LLM
- **Visor** — периодически сжимает историю событий в дайджест (что агент делал за последний час)
- **Compaction** — при достижении порога контекста автоматически суммаризирует и сбрасывает
- **SQLite persistence** — channels, tasks, events, artifacts, bulletins хранятся локально
- **Plugin SDK** — модели, инструменты, gateway подключаются как плагины, не хардкодятся

### 2. Агентная система

Взята из Agent Factory, переведена в реальное выполнение.

| Агент | Модель | Роль |
|-------|--------|------|
| LEGION-01 (Orchestrator) | Opus | Принимает задачу, декомпозирует, распределяет |
| Architect | Sonnet | Проектирует структуру решения |
| Developer | Sonnet / Code | Пишет и рефакторит код |
| Reviewer | Sonnet | Проверяет код, архитектуру |
| QA | Sonnet / local | Тесты, граничные случаи |
| Analyst | Sonnet | Исследование, документация |
| Personal (Medical, Photo) | Ollama local | Приватные задачи без облака |

**Pipeline выполнения:**
```
Задача → LEGION-01 → Architect → Developer(s) → Reviewer → QA → Done
```

Каждый шаг — отдельный Worker, результат сохраняется как артефакт.

### 3. Hybrid Model Routing

Взято из Agent Factory, расширено.

```yaml
# models.yaml
cloud-max:    claude-opus-4-7       # оркестрация, критичные решения
cloud-smart:  claude-sonnet-4-6     # код, архитектура, review
cloud-code:   claude-sonnet-4-6     # сложный рефакторинг
local-fast:   ollama/qwen2.5        # рутина, форматирование, QA
local-private: ollama/llama3.2     # приватные данные, без облака
```

**Логика выбора:**
- Задача приватная → local-private
- Задача простая → local-fast
- Архитектура / review → cloud-smart
- Оркестрация, полный контекст → cloud-max
- Облако недоступно → fallback на local-fast

### 4. Память агентов

| Уровень | Что хранит | Где |
|---------|-----------|-----|
| Краткосрочная | Контекст текущей задачи | RAM / Branch context |
| Среднесрочная | Visor bulletins (дайджесты) | SQLite |
| Долгосрочная | Векторные embeddings по проектам | ChromaDB |

### 5. Точки входа (Channels)

| Channel | Платформа | Статус |
|---------|-----------|--------|
| HTTP API | Все | Core |
| Web UI | Браузер | Core |
| iOS App | iPhone, iPad | Native Swift |
| macOS App | Desktop | Native Swift |
| Telegram | Mobile | Plugin |
| Discord | Desktop/Mobile | Plugin |

### 6. Веб-интерфейс

Inspired by Agent Factory UI, built on top of Legion API.

- **Dashboard** — статус всех агентов, активные задачи, Visor-дайджесты
- **Project Rooms** — визуальные комнаты по типу проекта (iOS, Game, AI, Web)
- **Live Log** — WebSocket стрим событий по каждому Worker
- **Artifact Browser** — файлы, документы, код, созданные агентами
- **Model Monitor** — какая модель используется, стоимость токенов, latency

### 7. Наблюдаемость (Operator Visibility)

- Каждый агент производит **events** (старт, инструмент, ответ, ошибка)
- **Visor** публикует bulletins каждые N минут / по триггеру
- **Dashboard** показывает живой граф: кто что делает прямо сейчас
- **Артефакты** сохраняются с метаданными (агент, время, задача)
- **Детектор зависаний** — если Worker молчит > threshold → alert оператору

---

## Архитектура

```
┌─────────────────────────────────────────────────┐
│  Clients                                        │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ iOS App  │ │macOS App │ │  Web Browser   │  │
│  │ (Swift)  │ │ (Swift)  │ │ (HTML + JS)    │  │
│  └────┬─────┘ └────┬─────┘ └───────┬────────┘  │
└───────┼────────────┼───────────────┼────────────┘
        │            │               │
        └────────────┴───────────────┘
                     │ HTTP / WebSocket
                     ▼
┌─────────────────────────────────────────────────┐
│  Legion Core (Swift 6)                          │
│  ┌───────────────────────────────────────────┐  │
│  │  Channel Layer (HTTP API + Gateway)       │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  Router (rule-based)               │  │  │
│  │  │  ┌──────────┐  ┌────────────────┐  │  │  │
│  │  │  │ Branch 1 │  │   Branch 2     │  │  │  │
│  │  │  │ Worker   │  │ Worker Worker  │  │  │  │
│  │  │  └──────────┘  └────────────────┘  │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  │  Visor  │  Compactor  │  Persistence      │  │
│  └──────────────────────┬────────────────────┘  │
│                         │                       │
│  Plugin Layer           │                       │
│  ┌──────────┐ ┌────────┐│┌──────────────────┐   │
│  │ Models   │ │ Tools  │││ Gateways         │   │
│  │ Claude   │ │ Shell  │││ Telegram/Discord │   │
│  │ Ollama   │ │ Files  │││                  │   │
│  │ OpenAI   │ │ MCP    │││                  │   │
│  └──────────┘ └────────┘└┴──────────────────┘   │
│                                                 │
│  Storage: SQLite + ChromaDB + Filesystem        │
└─────────────────────────────────────────────────┘
```

---

## Стек технологий

| Компонент | Технология | Обоснование |
|-----------|-----------|------------|
| Runtime core | Swift 6 | Native performance, async/await, Linux support |
| iOS / macOS app | SwiftUI | Один codebase, нативный UX |
| Web backend | Swift (Vapor) или thin Python | API для веб-клиента |
| Web frontend | Vanilla JS + WebSocket | Минимум зависимостей, полный контроль |
| LLM routing | LiteLLM | Единый прокси, легко добавить провайдера |
| Local models | Ollama | Уже установлен, работает офлайн |
| Persistence | SQLite | Без отдельного сервиса, embedded |
| Vector memory | ChromaDB | Локальный, Python-native |
| Agent config | YAML | Читаемо, редактируется без компиляции |
| Remote access | Tailscale | Безопасный туннель MacBook ↔ Mac Mini |

---

## Что берём из каждого проекта

### Из Sloppy ★
- Channel / Branch / Worker runtime модель
- Rule-based routing (не LLM-based)
- Visor bulletins и compaction
- Plugin SDK с чёткими boundaries
- SQLite persistence как first-class
- Native Swift iOS/macOS app
- Multi-gateway support (Telegram, Discord)

### Из Agent Factory ★
- Визуальный портал с комнатами и фазами
- YAML-конфиги агентов (читаемые, без компиляции)
- models.yaml алиасы с Ollama fallback
- WebSocket live log
- 6-фазный рабочий процесс (идея → чертёж → обсуждение → комната → агенты → готово)
- Концепция персональных агентов под приватные задачи
- Tailscale как сетевой слой

---

## Фазы разработки

| Фаза | Что | Приоритет |
|------|-----|-----------|
| 1 — Core Runtime | Channel/Branch/Worker + SQLite + HTTP API | P0 |
| 2 — Web UI | Dashboard + Live Log + Project Rooms | P0 |
| 3 — Agent Pipeline | LEGION-01 + реальное выполнение задач | P1 |
| 4 — iOS / macOS App | SwiftUI клиент поверх того же API | P1 |
| 5 — Memory | Visor bulletins + ChromaDB | P2 |
| 6 — Plugins | Telegram, Discord, MCP tools | P2 |
| 7 — Model Monitor | Cost tracking, latency, fallback alerts | P3 |
