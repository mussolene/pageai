import type { ConfluencePage } from "../types/messages";

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
    "3) Список ссылок на использованные страницы формата: [Тайтл](URL)\n" +
    "Не выдумывай факты, опирайся только на текст страниц.\n";

  return header + queryPart + pagesPart + "\n" + instructions;
}

