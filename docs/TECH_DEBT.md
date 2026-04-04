# Технический долг

Сводный список из документации и ревью. Обновлять при закрытии пунктов.

## Средний

| Пункт | Где | Действие |
|-------|-----|----------|
| Нет unit-тестов для background | src/background/index.ts | Добавить тесты с моками chrome.* и storage |
| Нет unit-тестов для page-extractor | src/content/page-extractor.ts | Тесты в jsdom или вынести чистые функции (extractPageId) |
| Остаточное дублирование panel.ts / popup.ts | src/ui/ | Часть настроек вынесена в `inline-extension-settings.ts`; дальше — общие хелперы чата/рендера по мере роста |
| Отдельный MCP handshake на каждый `listMcpTools` / `listMcpPrompts` / `getMcpPrompt` | src/mcp/client.ts, agent-prompts | Один `initialize` на сервер и одна сессия на запрос для tools + prompts (см. docs/MCP_AND_AGENTS.md) |

## Низкий

| Пункт | Где | Действие |
|-------|-----|----------|
| Много session-* e2e без реального браузера | tests/ | Переименовать в spec/ или описать как acceptance-критерии |
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
