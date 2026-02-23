# PageAI

Расширение для Chrome: чат по контенту страниц (Confluence и любым) с **локальной** LLM (LM Studio, Ollama и др.). Данные не уходят в облако — только ваш Confluence и ваш LLM endpoint.

---

## Для пользователей

### Что умеет

- **Чат** по текущей странице и по wiki: задаёте вопрос — получаете ответ с ссылками на страницы Confluence.
- **Поиск** по Confluence через REST API и выбор пространства (space).
- **Локальная модель**: запросы идут на ваш endpoint (LM Studio, Ollama и т.п.), не в облако.
- **История чата** сохраняется в браузере (IndexedDB).
- **Многоязычность**: интерфейс подстраивается под язык браузера (EN/RU).

### Установка

1. Клонируйте репозиторий и соберите расширение:
   ```bash
   git clone https://github.com/mussolene/pageai.git
   cd pageai
   npm install && npm run dev
   ```
2. В Chrome откройте `chrome://extensions` → **Режим разработчика** → **Загрузить распакованное** → выберите папку **`dist/`**.

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

В Edge и Yandex используйте **popup** (клик по иконке). Подробнее про Яндекс.Браузер: [docs/YANDEX_BROWSER_GUIDE.md](docs/YANDEX_BROWSER_GUIDE.md).

### Безопасность и NDA

- Запросы к Confluence идут **только на ваш** Confluence (URL из настроек).
- Контент хранится локально в IndexedDB.
- LLM получает запросы **только на указанный вами** endpoint (рекомендуется localhost или внутренний сервер).
- Не указывайте публичные облачные API в настройках LLM, если это противоречит политике компании.

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

Опционально: скрипт `./start-session.sh` — интерактивная проверка LM Studio и подсказки по сессиям разработки (не обязателен для сборки и тестов).

### LM Studio (локальная проверка)

```bash
curl http://localhost:1234/v1/models
```

Рекомендуемая тестовая модель: `qwen/qwen3-4b-2507`. Endpoint в настройках: `http://localhost:1234/v1/chat/completions`.

### Документация

| Файл | Описание |
|------|----------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Workflow, стиль кода, тесты |
| [AGENTS.md](AGENTS.md) | Роли агентов (Аналитик / Разработчик / QA) |
| [agent.md](agent.md) | Архитектурные ограничения для агентов |
| [docs/README.md](docs/README.md) | Указатель по папке docs/ |
| [docs/SESSIONS.md](docs/SESSIONS.md) | Сессии разработки и статусы фич |
| [docs/TECH_DEBT.md](docs/TECH_DEBT.md) | Техдолг и приоритеты |
| [docs/MCP_AND_AGENTS.md](docs/MCP_AND_AGENTS.md) | MCP и агенты (Cursor/Continue) |

### CI и публикация на GitHub

- **GitHub Actions** (`.github/workflows/ci.yml`): на push в `main`/`master` и на PR — lint → test → build.
- **GitLab CI** (`.gitlab-ci.yml`): lint → test → build; артефакт `dist/`.
- Перед публикацией замените `your-username` в `package.json` и в этом README на ваш GitHub username (или URL репозитория).

---

## Лицензия и контрибьюция

Лицензия: [MIT](LICENSE). См. [CONTRIBUTING.md](CONTRIBUTING.md). Баги и идеи — через [Issues](https://github.com/mussolene/pageai/issues) репозитория.
