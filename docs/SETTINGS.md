# Настройки расширения

Где править параметры и что куда сохраняется.

## Где открыть

| Место | Назначение |
|-------|------------|
| **Страница Options** расширения | Полный набор: несколько профилей LLM, весь оркестратор, лексикон поиска, длинные поля. |
| **Вкладка Settings** в side panel / popup | Те же разделы в сжатом виде; часть оркестратора + ссылка «Открыть параметры…» на Options. |

Порядок разделов везде одинаковый: **LLM → Chat → Browser → Agent → MCP → Instructions**.

## Разделы (смысл)

- **LLM** — активный профиль (endpoint, модель), max tokens для запросов. Редактирование списка профилей и API keys — в Options («Add…»).
- **Chat** — лимиты контекста для модели (`chatContextMaxMessages`, `chatContextMaxChars` в `chrome.storage.sync`), опции **rolling summary** (сжатие старых реплик в локальную «память» в `chrome.storage.local`). См. `src/chat/chat-context-sync.ts`, `src/chat/rolling-summary.ts`.
- **Browser** — включение встроенных инструментов клика/заполнения страницы (`browserAutomationEnabled`).
- **Agent** — в Options: план/проверка/релевантность инструментов, сжатие вывода tools, лексикон. В panel/popup: короткие переключатели (plan, verify, max rounds) + переход в Options.
- **MCP** — JSON конфиг серверов, тумблеры серверов, опция **включать промпты MCP в системный промпт** (`mcpAgentPromptsEnabled`).
- **Instructions** — один текст для пользовательских правил и описания возможностей. В storage основной ключ — `agentRules` (`chrome.storage.sync`). Устаревший `agentSkills` при отображении **склеивается** с rules; при сохранении из объединённого поля skills очищается. В системном промпте — один блок `[AGENT_INSTRUCTIONS]` (см. `buildBaseSystemPromptWithAgentMeta` в `src/background/index.ts`).

## Очистка чата

Кнопка «Очистить чат» сбрасывает историю в IndexedDB **и** rolling-summary (ключи в `chrome.storage.local`, плюс epoch отмены отложенной записи саммари).

## Прочее хранилище

- **IndexedDB** (`src/storage/indexdb.ts`) — история сообщений чата, кеш ответов LLM (если используется).
- **`chrome.storage.sync`** — конфиги LLM, оркестратор, MCP, инструкции, лимиты чата, тема (синхронизируется с аккаунтом Chrome, если включено).
- **`chrome.storage.local`** — API keys по id профиля LLM, состояние rolling-summary, прочее чувствительное/крупное.
