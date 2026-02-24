# Исправления по аудиту безопасности

Основной рабочий документ по устранению проблем безопасности. Обновлять таблицу статусов по мере выполнения.

## Краткая сводка аудита

| Приоритет | Находка |
|-----------|---------|
| Критичный | XSS через ссылки в Markdown: URL подставляется в `href` без проверки (`javascript:`, `data:` и т.д.) |
| Высокий | Секреты (API-ключи LLM, MCP headers) в `chrome.storage.sync` без шифрования |
| Высокий | LLM endpoint не валидируется — возможна отправка данных на произвольный URL без предупреждения |
| Средний | Нет явной Content-Security-Policy в manifest |
| Низкий | Нет явной политики конфиденциальности (PRIVACY.md) |

## Таблица статусов

| ID | Описание | Файлы | Статус | Примечания |
|----|----------|-------|--------|------------|
| 1 | XSS через ссылки в Markdown | src/ui/markdown.ts, tests/markdown.test.ts | Сделано | isSafeLinkUrl, только http/https |
| 2 | Хранение секретов | llm/client.ts, options.ts, AGENTS.md | Сделано | Секреты в storage.local |
| 3 | Валидация LLM endpoint | llm/client.ts, options.ts | Сделано | isLocalLlmEndpoint, предупреждение в UI |
| 4 | CSP в manifest | manifest.json | Сделано | extension_pages |
| 5 | Политика конфиденциальности | PRIVACY.md | Сделано | — |
| 6 | Обновление документации | CODE_REVIEW.md, TECH_DEBT.md | Сделано | — |

## Детальные рекомендации и DoD

### Задача 1: XSS через ссылки в Markdown (критично)

**Файл:** `src/ui/markdown.ts`, функция `parseInlineMarkdown` (строки 35–62).

- Добавить `isSafeLinkUrl(url: string): boolean` — разрешать только протоколы `http:` и `https:` (проверка через `try { new URL(url) }` и `protocol`).
- В разборе ссылок: если URL не безопасный — рендерить только текст (без тега `<a>`), иначе — `<a href="..." class="md-link" target="_blank" rel="noopener noreferrer">`.
- **DoD:** В `tests/markdown.test.ts` кейсы: `[x](javascript:alert(1))` и `[x](data:text/html,<script>)` не дают кликабельную ссылку с опасным href; `[x](https://ok.com)` даёт кликабельную ссылку.

### Задача 2: Хранение секретов (высокий)

**Файлы:** `src/llm/client.ts` (getLlmConfig), `src/ui/options.ts`, `AGENTS.md`.

- Секреты хранить в `chrome.storage.local`: `llmApiKey`. MCP config с headers — либо вынести headers в local, либо оставить в sync с явным предупреждением в документации.
- При сохранении настроек в options.ts писать секреты в `chrome.storage.local`; при чтении в llm/client.ts — читать из local (при отсутствии не подставлять из sync).
- **DoD:** Секреты не сохраняются и не читаются из sync; в AGENTS.md формулировка про шифрование приведена в соответствие (уточнено: секреты в local, без синхронизации).

### Задача 3: Валидация LLM endpoint (высокий)

**Файлы:** `src/llm/client.ts`, `src/ui/options.ts`.

- Функция `isLocalLlmEndpoint(url: string): boolean`: парсинг URL, проверка `hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'`.
- При сохранении нелокального endpoint в options показывать предупреждение: «Данные чата и контент страниц будут отправлены на указанный сервер. Продолжить?» Сохранять флаг согласия в storage, чтобы не спрашивать повторно.
- **DoD:** При первом сохранении нелокального URL показывается предупреждение; после подтверждения настройка сохраняется.

### Задача 4: Content-Security-Policy (средний)

**Файл:** `manifest.json`.

- Добавить `content_security_policy` для Manifest V3: `extension_pages` с политикой без inline script, источники скриптов только `self`.
- **DoD:** Расширение собирается и работает; inline script на странице расширения блокируется.

### Задача 5: Политика конфиденциальности (низкий)

**Файл:** `PRIVACY.md` (корень репозитория).

- Описать: что хранится локально (чат, контент страниц, кеш); куда отправляются данные при настройке LLM/MCP; использование sync vs local; что не передаётся без настройки пользователя.
- **DoD:** Документ доступен в репозитории.

### Задача 6: Обновление документации

- **CODE_REVIEW.md:** В разделе «Безопасность» исправить утверждение про javascript: URL; добавить ссылку на этот документ и перечень исправлений.
- **TECH_DEBT.md:** Добавить строку со ссылкой на docs/SECURITY_REMEDIATION.md.

## Ссылки

- [TECH_DEBT.md](TECH_DEBT.md)
- [CODE_REVIEW.md](CODE_REVIEW.md)
- [AGENTS.md](../AGENTS.md)
