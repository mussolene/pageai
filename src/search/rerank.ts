import type { SearchResult } from "../types/messages.js";

// Семантический rerank — опциональный этап.
// Сейчас просто возвращаем keyword-результаты без изменений.

export function rerank(results: SearchResult[]): SearchResult[] {
  return results;
}

