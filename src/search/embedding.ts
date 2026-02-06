// Placeholder for optional semantic search via local embeddings.
// Архитектурно: этот модуль НЕ обязателен для MVP.
// Если будешь подключать embeddings, соблюдай:
// - локальный провайдер
// - явный индекс в IndexedDB/FAISS WASM

export interface EmbeddingProviderConfig {
  endpoint: string;
  apiKey?: string;
  model: string;
}

export async function embedTexts(_texts: string[], _config: EmbeddingProviderConfig): Promise<number[][]> {
  // Реализацию можно добавить позже.
  return [];
}

