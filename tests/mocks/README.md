# Mock Data для PageAI

Этот каталог содержит моки данных для тестирования и разработки расширения без необходимости подключения к реальному Confluence.

## 📚 Структура файлов

### confluence-api-responses.json

Основной файл с моками Confluence API ответов.

**Структура**:

- `searchResults` — результаты поиска по страницам
- `pageContent` — содержимое отдельных страниц
- `currentUser` — информация о текущем пользователе
- `spaces` — доступные Confluence spaces

**Использование**:

```typescript
import mockResponses from './confluence-api-responses.json';

const results = mockResponses.searchResults;
const user = mockResponses.currentUser;
```

### llm-responses.json

Mock ответы LLM для тестирования интеграции с LM Studio.

**Структура**:

- `responses` — примеры ответов на различные запросы
- `errors` — примеры ошибок (timeout, not available)
- `completion_example` — пример OpenAI-совместимого ответа

**Использование**:

```typescript
import mockLLM from './llm-responses.json';

const response = mockLLM.responses[0]; // Какой-то пример ответа
```

### confluence-search-results.json

Результаты поиска по Confluence (дополнение к confluence-api-responses.json).

**Структура**: Array объектов с:

- `id` — ID страницы
- `key` — ключ space
- `name` — имя space
- `title` — заголовок страницы
- `excerpt` — краткое описание
- `url` — ссылка на страницу

### test-pages.json

Полное содержимое тестовых страниц для разработки.

**Структура**: Объект с массивом `pages`:

- `id` — ID страницы
- `title` — заголовок
- `spaceKey` — ключ space
- `content` — полное содержимое в Markdown
- `version` — номер версии
- `created`, `updated` — даты
- `author` — автор страницы

**Использование в коде**:

```typescript
import pages from './test-pages.json';

const page = pages.pages.find(p => p.id === '12345');
console.log(page.content); // Markdown контент
```

### user-fixtures.json

Mock данные о пользователях.

**Структура**: Array объектов пользователя:

- `username` — имя пользователя
- `email` — электронная почта
- `displayName` — отображаемое имя
- `avatarUrl` — аватар
- `profileUrl` — ссылка на профиль

### confluence-spaces.json

Mock данные о Confluence spaces (для сессии #5).

**Структура**:

- `spaces` — основной список spaces
- `allSpaces` — paginated ответ с пагинацией

## 🔧 Использование mock данных в коде

### В обычном коде (development)

```typescript
// Использование mock вместо API вызова
import mockData from '../mocks/confluence-api-responses.json';

// Вместо реального запроса:
// const results = await confluenceApi.search('test');

// Используем mock:
const results = mockData.searchResults;
```

### В тестах

```typescript
import mockResponses from '../../mocks/confluence-api-responses.json';
import mockLLM from '../../mocks/llm-responses.json';

describe('Search functionality', () => {
  test('returns search results', () => {
    const results = mockResponses.searchResults;
    expect(results).toHaveLength(3);
    expect(results[0].title).toBe('Getting Started with Confluence');
  });

  test('LLM response is valid', () => {
    const response = mockLLM.responses[0];
    expect(response).toHaveProperty('response');
    expect(response).toHaveProperty('tokens_used');
  });
});
```

## 🚀 Быстрый старт с mock данными

```bash
# 1. Ваш код видит эти файлы в tests/mocks/

# 2. Для разработки используйте:
import mockData from '../mocks/confluence-api-responses.json';

# 3. При готовности переключиться на реальное API:
# Замените import на вызов реального API клиента
const results = await confluenceApi.search(query);

# 4. Запуск тестов с мокой:
npm test
```

## 📝 Добавление новых mock данных

Если нужны новые mock данные для новой сессии:

1. Определите структуру данных
2. Создайте новый JSON файл в этой директории
3. Добавьте примеры данных с учётом реальной Confluence API
4. Документируйте структуру в этом README

**Пример**:

```bash
# Создать новый файл
cat > new-feature-mocks.json << 'EOF'
{
  "featureData": [...]
}
EOF
```

## 🧪 Тестирование с LM Studio

Mock LLM ответы используются для быстрого локального тестирования без запуска LM Studio:

```typescript
// Быстрый тест с mock
import mockLLM from './llm-responses.json';
const mockResponse = mockLLM.responses[0].response;

// Медленный тест с реальным LM Studio
const realResponse = await llmClient.chat('query');
```

## 🔐 Безопасность

- Mock данные НЕ содержат реальные API токены или пароли
- Используйте environment переменные для реальных учётных данных
- Mock данные могут содержать test URLs и dummy addresses

## 📊 Статистика mock данных

| Файл | Записей | Использование |
|------|---------|------|
| confluence-api-responses.json | 3 разных API + спецсервис | Основные API тесты |
| llm-responses.json | 3 примера | LLM интеграция |
| confluence-search-results.json | 4 результата | Поиск и ранжирование |
| test-pages.json | 3 полные страницы | Контент и парсинг |
| user-fixtures.json | 4 пользователя | Аутентификация и профили |
| confluence-spaces.json | 5 spaces | Фильтрация по space |

## 💡 Рекомендации

1. **Всегда использовать mock для разработки** — быстрее и не требует доступа к Confluence
2. **Обновлять mock при изменении API** — держать синхронизацию с реальностью
3. **Добавлять edge cases в mock** — offline, ошибки, пустые результаты
4. **Документировать структуру** — для новых разработчиков в команде

## 🔗 Связанные файлы

- [AGENTS.md](../../AGENTS.md) — описание цикла разработки
- [SESSIONS.md](../../SESSIONS.md) — текущие сессии разработки
- [agent.md](../../agent.md) — архитектурные принципы
