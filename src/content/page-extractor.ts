import type { PageIndexPayload } from "../types/messages";

export function extractPageId(url: string): string {
  // Используем URL как ID, но убираем хэш и query параметры для стабильности
  try {
    const urlObj = new URL(url);
    return `${urlObj.origin}${urlObj.pathname}`;
  } catch {
    return url;
  }
}

function extractTextFromPage(): string {
  // Удаляем элементы, которые обычно не содержат полезного контента
  const unwantedSelectors = [
    "script",
    "style",
    "nav",
    "header",
    "footer",
    "aside",
    ".sidebar",
    ".navigation",
    ".menu",
    ".ad",
    ".advertisement",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    "[role='complementary']"
  ];

  // Клонируем body для безопасного удаления элементов
  const bodyClone = document.body.cloneNode(true) as HTMLElement;
  
  // Удаляем нежелательные элементы
  unwantedSelectors.forEach(selector => {
    const elements = bodyClone.querySelectorAll(selector);
    elements.forEach(el => el.remove());
  });

  // Приоритетные селекторы для основного контента
  const contentSelectors = [
    'main',
    'article',
    '[role="main"]',
    '.content',
    '#content',
    '.main-content',
    '#main-content',
    '.post',
    '.entry',
    '.article-content',
    '[id="main-content"]',
    '.ak-renderer-document', // Confluence
    '.wiki-content', // Confluence
    '#content' // Общий
  ];

  // Пробуем найти основной контент
  for (const selector of contentSelectors) {
    const el = bodyClone.querySelector(selector);
    if (el) {
      const text = el.textContent?.trim() ?? "";
      if (text.length > 100) { // Минимум 100 символов для считания контентом
        return text;
      }
    }
  }

  // Если не нашли специфичный контент, берем весь body
  const allText = bodyClone.textContent?.trim() ?? "";
  
  // Убираем слишком короткие строки (вероятно, навигация)
  const lines = allText.split('\n').filter(line => line.trim().length > 10);
  
  return lines.join('\n');
}

function extractTitle(): string {
  // Пробуем разные источники заголовка
  const ogTitle = document.querySelector('meta[property="og:title"]') as HTMLMetaElement;
  if (ogTitle?.content) return ogTitle.content;

  const h1 = document.querySelector('h1');
  if (h1?.textContent) return h1.textContent.trim();

  return document.title || "Untitled page";
}

export function buildPagePayload(): PageIndexPayload {
  const url = window.location.href;
  const title = extractTitle();
  const now = new Date().toISOString();
  const contentText = extractTextFromPage();

  return {
    id: extractPageId(url),
    url,
    title,
    spaceKey: undefined, // Не используется для обычных страниц
    createdAt: now,
    updatedAt: now,
    contentText
  };
}
