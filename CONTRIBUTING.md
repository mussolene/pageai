# Contributing

## Conventional Commits

В проекте используются [Conventional Commits](https://www.conventionalcommits.org/). Сообщения коммитов формируют историю релизов: при создании тега `v*` GitHub Action собирает список изменений по типам и добавляет его в описание релиза.

**Формат**: `<type>(<scope>): <description>`

**Типы** (основные):

| Тип       | Описание |
|----------|----------|
| `feat`   | Новая фича |
| `fix`    | Исправление бага |
| `docs`   | Только документация (README, комментарии) |
| `chore`  | Обслуживание (зависимости, конфиг, скрипты) |
| `refactor` | Рефакторинг без изменения поведения |
| `style`  | Стиль кода (форматирование, пробелы) |
| `perf`   | Улучшение производительности |
| `test`   | Добавление/изменение тестов |
| `ci` / `build` | CI/CD или сборка |

**Примеры**:

```
feat(ui): add space selector dropdown
fix(api): handle empty search results
docs: add release workflow to README
chore(deps): update esbuild to 0.27
```

Опционально в конце тела коммита: `BREAKING CHANGE: описание` — для мажорных изменений.

## Workflow разработки

1. **Ветки**: фичи в `feature/short-name`, баги в `fix/short-name`.
2. **Коммиты**: в формате Conventional Commits (см. выше).
3. **Перед коммитом**: `npm run lint`, `npm test` и `npm run build` должны проходить.
3. **Секреты**: не коммитить реальные API-токены, пароли, ключи. Использовать `.env` (в .gitignore) и моки в `tests/mocks/`.
4. **Документация**: архитектурные решения и техдолг — в `docs/` (TECH_DEBT.md, CODE_REVIEW.md). Сессионные отчёты можно хранить в `docs/sessions/`.

## Стандарты кода

- **agent.md** и **AGENTS.md** — обязательные к прочтению: архитектура (Local-first, BYOM, zero backend), DoD, роли.
- TypeScript: строгий режим, явные типы, минимум зависимостей.
- Стиль: functional core, минимум мутаций. Константы — SCREAMING_SNAKE_CASE, файлы — camelCase где принято в проекте.
- CSS: BEM-подобные классы, переменные для темы (см. panel.css).

## Тестирование

- **Запуск тестов**: `npm test` (Vitest), `npm run test:coverage` — с отчётом покрытия.
- **Покрытие**: не ниже **90%** (lines, statements, functions) и не ниже **79%** (branches) для кода, входящего в отчёт (см. vitest.config.ts → coverage.exclude). Исключены: UI/background/content entry points, indexdb, types, page-extractor, markdown.
- **Моки**: в `tests/mocks/`. Confluence API и LLM — JSON-фикстуры. Для модулей с `chrome.*` или `fetch` — мокать в тестах (vi.fn, global fetch).
- **Охват**: при добавлении фичи — unit-тесты на новую логику; после изменений — `npm run test:coverage` должен проходить пороги.
- E2E: session-* тесты в tests/ — acceptance-спеки; для реального E2E — Playwright/Cypress и fake Confluence (см. README).

## Сборка и проверки

```bash
npm install
npm run lint   # ESLint (src, tests)
npm test       # Vitest
npm run test:coverage  # тесты + пороги покрытия
npm run dev    # разработка
npm run build  # production
```

## Агенты и MCP

- Роли и workflow: **AGENTS.md**.
- Настройка MCP и проверка связки агентов: **docs/MCP_AND_AGENTS.md**.

## Вопросы

- Баги и фичи: GitHub Issues.
- Архитектура и техдолг: см. docs/TECH_DEBT.md, docs/CODE_REVIEW.md.
