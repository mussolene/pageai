/** Ключи и дефолты для лимитов чата и rolling-summary (`chrome.storage.sync`). */

export const CHAT_CONTEXT_SYNC_DEFAULTS = {
  chatContextMaxMessages: 56,
  chatContextMaxChars: 100_000,
  chatRollingSummaryEnabled: true,
  chatRollingSummaryEvery: 16,
  chatRollingSummaryBatch: 8
} as const;

export type ChatContextSyncDefaultsKey = keyof typeof CHAT_CONTEXT_SYNC_DEFAULTS;
