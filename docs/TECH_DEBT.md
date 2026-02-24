# Технический долг

Сводный список из документации и ревью. Обновлять при закрытии пунктов.

## Критичный

| Пункт | Где | Действие |
|-------|-----|----------|
| Тесты не запускаются из npm | package.json `"test": "echo \"No automated tests yet\""` | Подключить Vitest, см. CONTRIBUTING.md |
| `fetch` без timeout в среде без AbortController | src/llm/client.ts `timeout: 5000` в options | В браузере `fetch` не поддерживает timeout; обернуть в AbortController + setTimeout |

## Средний

| Пункт | Где | Действие |
|-------|-----|----------|
| Нет unit-тестов для background | src/background/index.ts | Добавить тесты с моками chrome.* и storage |
| Нет unit-тестов для Confluence API | src/api/confluence.ts | Мок fetch + getConfig (chrome.storage) |
| Нет unit-тестов для page-extractor | src/content/page-extractor.ts | Тесты в jsdom или вынести чистые функции (extractPageId) |
| Нет unit-тестов для keyword search | src/search/keyword.ts | Чистые функции — добавить keyword.test.ts |
| Дублирование panel.ts / popup.ts | src/ui/ | Вынести общую логику в shared модуль |
| Линтер не настроен | package.json lint script | Добавить ESLint + Prettier |

## Низкий

| Пункт | Где | Действие |
|-------|-----|----------|
| Много session-* e2e без реального браузера | tests/ | Переименовать в spec/ или описать как acceptance-критерии |
| Документация разбросана | SESSION-*.md, DOCUMENTATION_INDEX | Хранить в docs/, индекс в README |
| MCP в .continue, не в Cursor | .continue/mcpServers/ | См. docs/MCP_AND_AGENTS.md |

## Уже закрыто

- ~~sources.ts: source.number → source.id~~ (исправлено)
- Popup parity с panel (FINAL_REVIEW.md)
- Исправления по аудиту безопасности — см. [docs/SECURITY_REMEDIATION.md](SECURITY_REMEDIATION.md)

## Ссылки

- AGENTS.md — приоритеты и DoD
- [SECURITY_REMEDIATION.md](SECURITY_REMEDIATION.md) — план и статус исправлений безопасности
- PROJECT_SUMMARY.md — Future Improvements
- CODE_REVIEW.md — детали ревью
