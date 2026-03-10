# Анализ проекта PageAI: пробелы и рекомендации

Краткий разбор того, чего не хватает в расширении и как это реализовать в духе Local-first / BYOM.

---

## 1. Что не хватает

### 1.1 Поиск по сохранённым страницам (Retrieval-first)

**Факт:** Страницы индексируются (content → PAGE_INDEX → `storage.savePage`), в IndexedDB есть store `pages`. Реализованы `keywordSearch`, `rerank`, `getAllPages` / `getPagesByIds`. Background обрабатывает `SUMMARIZE` с `pageIds`. Но в UI нет ни поиска по сохранённым страницам, ни выбора страниц для саммари.

**Итог:** Пользователь не может «найти среди посещённых страниц» или «сделать выжимку по выбранным страницам» — только чат по текущей вкладке и общий чат.

**Как закрыть красиво:**

- Добавить в панель (panel/popup) отдельный режим или вкладку «Поиск»:
  - Поле ввода запроса → вызов `getAllPages()` в worker/UI, затем `keywordSearch(pages, query)` и при желании `rerank(results)`.
  - Список результатов: заголовок, URL, короткий сниппет; клик — добавить страницу в «выбранные».
  - Кнопка «Саммари по выбранным» → отправка `SUMMARIZE { pageIds, query? }` в background → показ ответа в чате или в отдельном блоке.
- Всё держать локально: поиск по данным из IndexedDB, без внешних API. Соответствует agent.md (Retrieval-first, zero backend).

---

### 1.2 Единая версия в manifest и package.json

**Факт:** В `package.json` указано `"version": "0.5.0"`, в `manifest.json` — `"version": "0.3.0"`.

**Как закрыть красиво:**

- Один источник правды: версию хранить в `package.json`, при сборке подставлять в manifest (например, в `scripts/dev.mjs` читать `version` из package.json и писать в `dist/manifest.json`). Либо скрипт `version-sync.js`, который по одному месту обновляет оба файла.

---

### 1.3 Таймаут fetch в браузере (TECH_DEBT / CODE_REVIEW)

**Факт:** В `src/llm/client.ts` для таймаута использовался вариант, не работающий в браузере. В среде расширения `fetch` не поддерживает опцию `timeout`; нужен `AbortController` + `setTimeout`.

**Как закрыть красиво:**

- В любом месте, где вызывается `fetch` к LLM, создавать `AbortController`, ставить `setTimeout(() => controller.abort(), timeoutMs)`, передавать `signal: controller.signal` в `fetch`. В `catch` обрабатывать `AbortError` и возвращать понятное сообщение («Timeout», «LLM не ответил за N сек»).

---

### 1.4 Дублирование panel / popup / options (TECH_DEBT)

**Факт:** Логика чата, настроек LLM и MCP повторяется в `panel.ts`, `popup.ts`, `options.ts` — много копипаста.

**Как закрыть красиво:**

- Вынести в общие модули, например:
  - `src/ui/shared/chat.ts` — отправка сообщения, отображение истории, placeholder/loading.
  - `src/ui/shared/settings-llm.ts` — загрузка/сохранение настроек LLM, fetch models, валидация.
  - `src/ui/shared/settings-mcp.ts` — загрузка MCP-конфига, список инструментов, тумблеры.
- В `panel.ts` / `popup.ts` / `options.ts` только инициализация DOM и вызовы этих функций. Так проще тестировать и сохранять единообразие (в т.ч. по UX из UX-USABILITY.md).

---

### 1.5 Тесты для background и page-extractor (TECH_DEBT / CODE_REVIEW)

**Факт:** Для `background/index.ts` и `content/page-extractor.ts` unit-тестов нет. Background зависит от `chrome.*` и storage; page-extractor — от `document`/DOM.

**Как закрыть красиво:**

- **Background:** мокать `chrome.runtime.onMessage`, `chrome.tabs`, `chrome.storage` (или обёртку над storage). Тестировать обработчики сообщений (PAGE_INDEX, CHAT_MESSAGE_CURRENT_PAGE, SUMMARIZE и т.д.) на уровне «сообщение на вход → ожидаемый ответ/вызов storage/llm».
- **page-extractor:** вынести чистые функции (например, `extractPageId(url)`, нормализация заголовка/текста) в отдельный модуль и покрыть тестами; парсинг DOM оставить в одном месте и тестировать в jsdom или через небольшие интеграционные тесты.

---

### 1.6 Юзабилити (UX-USABILITY.md)

Уже частично есть; чего может не хватать:

- **Подсказка в placeholder** — явно писать, что можно спросить про страницу или задать общий вопрос (уже есть `chat.placeholderCurrentPage` — проверить тексты в локалях).
- **Состояние загрузки** — в чате показывать «Думаю…»/спиннер в области сообщений (сейчас есть placeholder-сообщение «…» — можно оформить как отдельный блок с классом `.loading` и стилями).
- **Ошибки в интерфейсе** — показывать ошибки (LLM недоступен, таймаут, страница не загружена) как сообщение ассистента с короткой подсказкой (проверить настройки, перезагрузить страницу).
- **Очистка истории** — кнопка «Очистить историю» уже есть; при желании добавить подтверждение (confirm или модалка).
- **a11y** — убедиться, что у кнопки Send и у textarea есть `aria-label` / связанный `<label>`; при открытии панели опционально ставить фокус в поле ввода.

---

### 1.7 Side panel в manifest (Chrome)

**Факт:** Код открывает side panel через `chrome.sidePanel.setOptions` / `chrome.sidePanel.open`, но в `manifest.json` нет секции `side_panel`. В новых версиях Chrome для открытия side panel нужна декларация.

**Как закрыть красиво:**

- Добавить в `manifest.json` (для MV3):

```json
"side_panel": {
  "default_path": "panel.html"
}
```

- Тогда панель по умолчанию будет `panel.html`, и не нужно вызывать `setOptions` только ради path (при необходимости оставить вызов для динамики).

---

## 2. Приоритизация

| Приоритет | Что сделать | Зачем |
|-----------|-------------|--------|
| Высокий   | Единая версия (manifest ↔ package.json) | Корректные релизы и отображение версии. |
| Высокий   | Таймаут fetch через AbortController в llm/client | Предсказуемое поведение при «зависшем» LLM. |
| Высокий   | Side panel в manifest | Корректная работа в актуальном Chrome. |
| Средний   | Поиск по сохранённым страницам + саммари по выбранным | Реализация полноценного Retrieval-first сценария. |
| Средний   | Вынести общую логику panel/popup/options в shared | Меньше дублирования, проще поддержка и тесты. |
| Низкий    | Unit-тесты для background и page-extractor | Стабильность и регрессии. |
| Низкий    | Точечные правки по UX-USABILITY (подсказки, a11y, подтверждение очистки) | Удобство и доступность. |

---

## 3. Ссылки

- [agent.md](../agent.md) — архитектурные ограничения (Local-first, Retrieval-first, BYOM).
- [AGENTS.md](../AGENTS.md) — приоритеты и DoD.
- [TECH_DEBT.md](TECH_DEBT.md) — техдолг.
- [CODE_REVIEW.md](CODE_REVIEW.md) — ревью и покрытие тестами.
- [UX-USABILITY.md](UX-USABILITY.md) — юзабилити и UI.
