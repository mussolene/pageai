# Ревью кода (сводка)

## Архитектура

- **Соответствие agent.md**: Local-first, BYOM, zero backend соблюдены.
- **Поток данных**: Content → Background (savePage / CHAT_MESSAGE) → LLM → UI. Чёткий, без лишних зависимостей.
- **Модули**: Разделение api / storage / llm / search / ui логичное. Дубли panel/popup — см. TECH_DEBT.

## Найденные проблемы

### Исправлено

1. **sources.ts**: В `createSourceListItems` использовалось `source.number` при отсутствии такого поля у `Source` (есть только `id`). Заменено на `source.id`.

### Рекомендации

1. **llm/client.ts**: `checkLmStudioHealth` — в браузере `fetch(..., { timeout: 5000 })` не поддерживается. Нужен AbortController + setTimeout для реального таймаута.
2. **background/index.ts**: Нет изоляции тестов; для unit-тестов потребуются моки `chrome.runtime.onMessage`, `chrome.tabs`, `storage`, `summarizePages`.
3. **api/confluence.ts**: `getConfig()` и `fetch` легко покрыть unit-тестами с моками chrome.storage и global.fetch.
4. **storage/indexdb.ts**: Класс `Storage` тестировать через fake-indexeddb или интеграционно в среде с IDB.
5. **content/page-extractor.ts**: Зависит от `document`/DOM — тесты в jsdom или вынести `extractPageId(url)` в отдельный модуль и тестировать его.

## Покрытие тестами

| Модуль | Есть тесты | Примечание |
|--------|------------|------------|
| llm/client.ts | Да (llm-client.test.ts) | vi.fn() для fetch, импорт vi в начале файла |
| search/sources.ts | Да (sources.test.ts) | Полное |
| ui/markdown.ts | Да (markdown.test.ts) | — |
| storage/spaces.ts | Да (spaces.test.ts) | Моки chrome.storage |
| search cache / indexdb | Частично (search-cache.test.ts, llm-cache.test.ts) | Логика без реального IDB |
| api/confluence.ts | Нет | Рекомендуется добавить |
| search/keyword.ts | Нет | Рекомендуется добавить |
| content/page-extractor.ts | Нет | Рекомендуется (хотя бы extractPageId) |
| background/index.ts | Нет | Сложные моки |

## Стиль и консистентность

- TypeScript: строгие типы, без any в ключевых местах.
- Async: корректное использование async/await и void для fire-and-forget.
- Именование: в целом по проекту (camelCase файлы, BEM в CSS) — ок.

## Безопасность

- **Исправления по аудиту (2025)**: проведён аудит; реализованы исправления по [docs/SECURITY_REMEDIATION.md](SECURITY_REMEDIATION.md): санитизация URL в markdown (только http/https), перенос секретов в chrome.storage.local, предупреждение при нелокальном LLM endpoint, экранирование CQL в Confluence, CSP в manifest, PRIVACY.md.
- Markdown: ссылки в ответах проверяются через `isSafeLinkUrl` (только http/https); опасные URL не рендерятся как кликабельные.
- API-ключи LLM и токены Confluence хранятся в chrome.storage.local (не синхронизируются).
- Источники: `validateSources` есть; при отображении ссылок используется rel="noopener noreferrer".
