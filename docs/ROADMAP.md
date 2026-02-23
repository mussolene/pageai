# План развития PageAI

Краткий список запланированных улучшений (по приоритету).

---

## В работе / ближайшие

- (следующие по приоритету из бэклога)

## Уже сделано

- **Модель под окном чата** — выбор модели под полем ввода (panel + popup), синхронизация с lastFetchedModels.
- **Стриминг «размышлений»** — сворачиваемый блок «Размышления» с потоком ответа ассистента в реальном времени (порт + SSE в LLM).
- **Чат в Markdown** — списки (ul/ol), код-блоки (pre с md-code-block), таблицы, цитаты, заголовки; экранирование XSS в выводе; тесты обновлены.
- **Список MCP с тумблерами** — парсинг mcpServers из JSON, список серверов с чекбоксом вкл/выкл (mcpServersEnabled в storage), panel/popup/options.
- **Сворачиваемый список tools** — под каждым MCP блок «Tools» (details); по открытию запрос tools/list к серверу, вывод имени, описания и параметров (inputSchema).
- Единый JSON-контракт MCP (`mcpServers`), проверка по первому серверу с `url`.
- Fetch models обёрнут в try/catch во всех UI (panel, popup, options).
- Линтер (ESLint), CI с lint + test (GitHub Actions, GitLab CI).
- Переименование проекта в PageAI.
- Тесты на MCP: `checkMcpConnection` (в т.ч. с headers), `parseMcpServersConfigForCheck`, `getDefaultMcpServersConfig`.

---

## Ссылки

- [README](../README.md) — установка и использование.
- [CONTRIBUTING](../CONTRIBUTING.md) — как запускать lint и тесты.
- [MCP_AND_AGENTS.md](MCP_AND_AGENTS.md) — настройка MCP.
