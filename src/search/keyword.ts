import type { ConfluencePage, SearchResult } from "../types/messages";

interface KeywordSearchOptions {
  limit?: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zA-Zа-яА-Я0-9]+/u)
    .filter(Boolean);
}

export function keywordSearch(
  query: string,
  pages: ConfluencePage[],
  options: KeywordSearchOptions = {}
): SearchResult[] {
  const { limit = 20 } = options;
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];

  const scored: SearchResult[] = pages.map((page) => {
    const pageTokens = tokenize(`${page.title} ${page.contentText}`);
    let score = 0;
    for (const token of pageTokens) {
      if (queryTokens.has(token)) {
        score += 1;
      }
    }
    return { page, score };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

