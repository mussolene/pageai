import type { ConfluencePage } from "../types/messages";

export function buildChatSystemPrompt(): string {
  return `Ты — умный помощник для работы с Confluence. 

Твоя цель:
- Помогать пользователям понимать содержимое страниц Confluence
- Отвечать на вопросы о контенте в Wiki
- Предоставлять четкие и структурированные ответы
- Всегда указывать источники информации

Инструкции:
1. Отвечай на русском языке
2. Будь конкретен и точен
3. Используй форматирование для ясности (заголовки, списки, код)
4. Если информации недостаточно — скажи об этом

ВАЖНО: После основного ответа добавляй разделитель "---" и затем раздел "Источники:" со списком источников в формате:
[Номер]. [Название страницы](URL страницы)

Пример:
---
Источники:
1. [Getting Started](https://confluence.example.com/pages/viewpage.action?pageId=123)
2. [API Guide](https://confluence.example.com/pages/viewpage.action?pageId=456)`;
}

export function buildSummaryPrompt(pages: ConfluencePage[], query?: string): string {
  const header =
    "Ты — помощник для чтения и суммаризации страниц Confluence. Твоя задача — делать краткую, точную выжимку и всегда указывать ссылки на использованные страницы.\n\n";

  const queryPart = query
    ? `Запрос пользователя:\n${query}\n\n`
    : "Запрос пользователя: общий обзор содержимого.\n\n";

  const pagesPart = pages
    .map(
      (p, index) =>
        `Страница #${index + 1}\nТайтл: ${p.title}\nURL: ${p.url}\nТекст:\n${p.contentText.slice(
          0,
          4000
        )}\n---\n`
    )
    .join("\n");

  const instructions =
    "Сформируй выжимку по шагам:\n" +
    "1) Краткий ответ на запрос\n" +
    "2) Ключевые пункты (bullet list)\n" +
    "3) Раздел 'Источники:' со списком ссылок на использованные страницы в формате:\n" +
    "   [Номер]. [Название](URL)\n" +
    "Не выдумывай факты, опирайся только на текст страниц.\n";

  return header + queryPart + pagesPart + "\n" + instructions;
}

/**
 * Расширённый промпт для ответов с явным указанием источников
 * Используется когда нужно с уверенностью получить источники
 */
export function buildSourceAwarePrompt(userQuery: string, context?: string): string {
  return `${buildChatSystemPrompt()}

Клиентский контекст:
${context || "Нет доступного контекста"}

Запрос пользователя: ${userQuery}

ОБЯЗАТЕЛЬНО:
- Укажи в ответе номера источников как [1], [2] и т.д. рядом с фактами
- В конце ответа добавь разделитель "---"
- Затем раздел "Источники:" с полным списком использованных источников`;
}

