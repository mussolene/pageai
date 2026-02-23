# PageAI

[![CI](https://github.com/mussolene/pageai/actions/workflows/ci.yml/badge.svg)](https://github.com/mussolene/pageai/actions/workflows/ci.yml)
[![Release](https://github.com/mussolene/pageai/actions/workflows/release.yml/badge.svg)](https://github.com/mussolene/pageai/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](tsconfig.json)

Расширение для Chrome: чат по контенту страниц (Confluence и любым) с **локальной** LLM (LM Studio, Ollama и др.). Данные не уходят в облако — только ваш Confluence и ваш LLM endpoint.

---

## Возможности расширения

| Область | Возможности |
|--------|--------------|
| **Чат** | Вопросы по текущей странице и по wiki; ответы с ссылками на страницы Confluence. История сообщений в рамках страницы. |
| **Поиск** | REST API Confluence: полнотекстовый поиск, **выбор пространства (space)** из списка, кеширование результатов с TTL. |
| **LLM** | **LM Studio**, **Ollama** или любой OpenAI-совместимый endpoint. Запросы только на ваш сервер (localhost или внутренняя сеть). Поддержка streaming и обычных ответов, temperature, max_tokens, system prompt. |
| **Ответы** | **Markdown**: списки, заголовки, код, таблицы, ссылки. **Ссылки на источники** в конце ответа (кликабельные, с переходом в Confluence). |
| **Хранение** | IndexedDB: история чата (per-page), кеш поиска, список spaces, настройки. Всё локально в браузере. |
| **Интерфейс** | Side panel (Chrome) или popup (Edge, Yandex). Многоязычность (EN/RU по языку браузера). Настройки Confluence (URL, API Token) и LLM (endpoint, модель). |

### Безопасность и NDA

- Запросы к Confluence — **только на ваш** Confluence (URL из настроек).
- Контент хранится **локально** в IndexedDB.
- LLM получает запросы **только на указанный вами** endpoint (рекомендуется localhost или внутренний сервер).
- Не используйте публичные облачные API в настройках LLM, если это противоречит политике компании.

---

## Для пользователей

### Установка

1. Клонируйте репозиторий и соберите расширение:
   ```bash
   git clone https://github.com/mussolene/pageai.git
   cd pageai
   npm install && npm run dev
   ```
2. В Chrome откройте `chrome://extensions` → **Режим разработчика** → **Загрузить распакованное** → выберите папку **`dist/`**.

**Релизы**: готовые сборки можно брать из [Releases](https://github.com/mussolene/pageai/releases) — при пуше тега `v*` создаётся автоматический релиз с архивом `dist.zip` и историей изменений (см. ниже).

### Первый запуск

1. Откройте любую страницу Confluence.
2. Откроется боковая панель (или нажмите на иконку расширения).
3. **Настройте Confluence**:
   - **Confluence Base URL** — например `https://your-domain.atlassian.net/wiki`
   - **API Token** — [создать в Atlassian](https://id.atlassian.com/manage-profile/security/api-tokens)
   - При необходимости укажите **Username** (email для Basic Auth).
   - Нажмите **Save & Connect**.
4. **Настройте LLM** (в разделе Settings):
   - **LLM Endpoint** — например `http://localhost:1234/v1/chat/completions` (LM Studio) или `http://localhost:11434/v1/chat/completions` (Ollama).
   - **Model** — имя модели (для LM Studio можно нажать **Fetch models**).
   - Сохраните настройки.
5. Введите вопрос в чат — расширение найдёт страницы в Confluence и ответит через вашу модель, с источниками.

### Браузеры

| Браузер      | Боковая панель | Чат | История      |
|-------------|----------------|-----|--------------|
| **Chrome**  | ✅             | ✅  | ✅           |
| **Edge**    | ❌             | ✅ (popup) | ⚠️ сессия |
| **Yandex**  | ❌             | ✅ (popup) | ⚠️ сессия |
| **Firefox** | ❌             | ❌  | ❌           |

В Edge и Yandex используйте **popup** (клик по иконке). Подробнее: [docs/YANDEX_BROWSER_GUIDE.md](docs/YANDEX_BROWSER_GUIDE.md).

---

## Для разработчиков

### Стек и принципы

- **Local-first**: контент не уходит во внешние облака.
- **Retrieval-first**: сначала поиск по Confluence, затем (опционально) LLM.
- **BYOM**: Bring Your Own Model (Ollama, LM Studio, любой OpenAI-совместимый endpoint).
- **Zero backend**: отдельного сервера не требуется.

### Структура проекта (кратко)

| Часть            | Назначение |
|------------------|------------|
| `src/content/`   | Content script: извлечение контента страницы, открытие панели |
| `src/api/confluence.ts` | REST API Confluence: поиск, страницы, spaces |
| `src/background/`| Service worker: индексация, поиск, чат, LLM |
| `src/ui/`        | Side panel / popup: чат, настройки Confluence и LLM |
| `src/llm/`       | Клиент LLM (OpenAI-совместимый API) |
| `src/storage/`   | IndexedDB: история чата, кеш поиска, spaces |

### Сборка, линт и тесты

```bash
npm install
npm run dev          # сборка в dist/ (watch)
npm run build        # production-сборка
npm run lint         # ESLint (src, tests)
npm test             # Vitest
npm run test:coverage # тесты + отчёт покрытия (пороги в vitest.config.ts)
```

Загрузка в Chrome: `chrome://extensions` → Load unpacked → **dist/**.

Опционально: скрипт `./start-session.sh` — интерактивная проверка LM Studio и подсказки по сессиям разработки.

### LM Studio (локальная проверка)

```bash
curl http://localhost:1234/v1/models
```

Рекомендуемая тестовая модель: `qwen/qwen3-4b-2507`. Endpoint в настройках: `http://localhost:1234/v1/chat/completions`.

### Релизы и Conventional Commits

- **Релизы по тегам**: при пуше тега вида `v*` (например `v0.2.0`) запускается [Release workflow](.github/workflows/release.yml): lint → test → build → создание GitHub Release с архивом `dist.zip` и **историей изменений** из коммитов.
- **Conventional Commits**: в проекте принят формат [Conventional Commits](https://www.conventionalcommits.org/). Сообщения коммитов (`feat:`, `fix:`, `docs:`, `chore:` и т.д.) автоматически группируются в разделы релиза (Features, Bug Fixes, Documentation, Other). Подробнее — в [CONTRIBUTING.md](CONTRIBUTING.md#conventional-commits).

**Пример создания релиза**:

```bash
git tag v0.2.0
git push origin v0.2.0
```

### Документация

| Файл | Описание |
|------|----------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Workflow, Conventional Commits, стиль кода, тесты |
| [AGENTS.md](AGENTS.md) | Роли агентов (Аналитик / Разработчик / QA) |
| [agent.md](agent.md) | Архитектурные ограничения для агентов |
| [docs/README.md](docs/README.md) | Указатель по папке docs/ |
| [docs/SESSIONS.md](docs/SESSIONS.md) | Сессии разработки и статусы фич |
| [docs/TECH_DEBT.md](docs/TECH_DEBT.md) | Техдолг и приоритеты |
| [docs/MCP_AND_AGENTS.md](docs/MCP_AND_AGENTS.md) | MCP и агенты (Cursor/Continue) |

### CI

- **CI** (`.github/workflows/ci.yml`): на push в `main`/`master` и на PR — lint → test → build.
- **Release** (`.github/workflows/release.yml`): на push тега `v*` — сборка, генерация changelog из Conventional Commits, создание релиза с `dist.zip`.
- **GitLab CI** (`.gitlab-ci.yml`): lint → test → build; артефакт `dist/`.

Перед публикацией замените `mussolene` в `package.json` и в этом README на ваш GitHub username (или URL репозитория).

---

## Лицензия и контрибьюция

Лицензия: [MIT](LICENSE). См. [CONTRIBUTING.md](CONTRIBUTING.md). Баги и идеи — через [Issues](https://github.com/mussolene/pageai/issues).

---

## Статистика и бейджи

| Метрика | Значение |
|--------|----------|
| **Тесты** | Vitest; пороги покрытия: lines/functions/statements ≥ 90%, branches ≥ 79% (см. `vitest.config.ts`) |
| **Линт** | ESLint (src, tests) |
| **Сборка** | esbuild, Node ≥ 20 |
| **Релизы** | По тегам `v*`, changelog из Conventional Commits |

Бейджи в шапке: [CI](https://github.com/mussolene/pageai/actions/workflows/ci.yml) · [Release](https://github.com/mussolene/pageai/actions/workflows/release.yml) · [MIT](LICENSE) · Node 20+ · TypeScript.
