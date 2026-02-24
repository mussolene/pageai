# Покрытие тестами

## Пороги (vitest.config.ts)

- **Lines / Statements**: ≥ 90%
- **Functions**: ≥ 90%
- **Branches**: ≥ 79%

## Запуск

```bash
npm test           # все тесты (в т.ч. session-*, search-cache, llm-cache, markdown)
npm run test:coverage   # только тесты, входящие в отчёт покрытия; пороги проверяются
```

При `npm run test:coverage` из прогона исключены тесты, требующие DOM/IndexedDB или нестабильные по времени: `session-*.test.ts`, `llm-cache.test.ts`, `markdown.test.ts`. Их можно запускать отдельно: `npx vitest run tests/markdown.test.ts` (с jsdom).

## Что входит в отчёт покрытия

- **Включено**: `src/i18n/index.ts`, `src/llm/client.ts`, `src/llm/prompts.ts`, `src/mcp/client.ts`, `src/search/*`.
- **Исключено** (не считаются в порогах): типы, UI entry points (panel, popup, options), background, content scripts, `indexdb.ts`, `page-extractor.ts`, `markdown.ts`.

## Добавленные тесты

- **mcp-client.test.ts** — `checkMcpConnection` (URL, протокол, fetch, JSON, таймаут).
- **llm-connection.test.ts** — `checkLlmConnection`, `getLMStudioModelsForEndpoint`, `checkLmStudioHealth`.
- **llm-prompts.test.ts** — `buildChatSystemPrompt`, `buildSummaryPrompt`, `buildSourceAwarePrompt`.
- **i18n.test.ts** — `getLocale`, `t`, `getStoredLocale`, `translate`, `setLocale`.
- **rerank.test.ts**, **embedding.test.ts** — заглушки модулей.

## Правки кода

- **sources.ts**: `highlightInlineCitations` — цитирования только `[1]`, `[2]`, … (регулярка `[1-9]\d*`), чтобы не оборачивать `Array[0]`.
- **llm-client.test.ts**: вызов `summarizePages([], { pageIds: [], query: "" })`, чтобы не читать `payload.query` у `undefined`.
