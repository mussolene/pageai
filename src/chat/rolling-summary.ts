import { chatWithLLMSubtask } from "../llm/client";
import { SUBTASK_CHAT_HISTORY_SUMMARY_SYSTEM } from "../agent/standards";
import type { ChatMessage } from "../types/messages";
import { CHAT_ROLLING_SUMMARY_KEYS } from "./chat-llm-context";

export interface RollingSummaryPolicy {
  enabled: boolean;
  /** Новых сообщений в истории с момента covers — порог для шага саммари */
  everyMessages: number;
  /** Сколько подряд ChatMessage сжать за один вызов */
  batchMessages: number;
}

export async function resetRollingChatSummaryStorage(): Promise<void> {
  await chrome.storage.local.remove([CHAT_ROLLING_SUMMARY_KEYS.text, CHAT_ROLLING_SUMMARY_KEYS.covers]);
}

/**
 * Эвристика без сигнала от модели: если с прошлого саммари накопилось ≥ everyMessages сообщений — сжимаем пачку в local storage.
 * Вызывать после успешного ответа ассистента (fire-and-forget).
 */
export async function maybeRefreshRollingChatSummary(
  history: ChatMessage[],
  policy: RollingSummaryPolicy,
  signal?: AbortSignal
): Promise<void> {
  if (!policy.enabled || history.length < 2) return;

  const local = await chrome.storage.local.get({
    [CHAT_ROLLING_SUMMARY_KEYS.text]: "",
    [CHAT_ROLLING_SUMMARY_KEYS.covers]: 0
  });
  const covers = Number(local[CHAT_ROLLING_SUMMARY_KEYS.covers]) || 0;
  const prevSummary = String(local[CHAT_ROLLING_SUMMARY_KEYS.text] ?? "");

  if (covers > history.length) {
    await resetRollingChatSummaryStorage();
    return;
  }

  const gap = history.length - covers;
  if (gap < policy.everyMessages) return;

  const batchSize = Math.max(2, Math.min(policy.batchMessages, Math.max(2, Math.floor(policy.everyMessages * 0.6))));
  const batch = history.slice(covers, covers + batchSize);
  if (batch.length === 0) return;

  const lines = batch.map((m) => {
    const role = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : m.role;
    const body = (m.content ?? "").trim();
    return `${role}: ${body.slice(0, 14_000)}`;
  }).join("\n\n---\n\n");

  const user = prevSummary.trim()
    ? `Previous memory:\n${prevSummary}\n\nNew lines to merge:\n${lines}\n\nWrite a single updated memory block (replaces previous).`
    : `Lines to turn into memory:\n${lines}`;

  const r = await chatWithLLMSubtask(user, {
    systemPrompt: SUBTASK_CHAT_HISTORY_SUMMARY_SYSTEM,
    maxTokens: 1536,
    temperature: 0.15,
    signal
  });
  if ("error" in r || !r.text.trim()) return;

  const nextCovers = covers + batch.length;
  await chrome.storage.local.set({
    [CHAT_ROLLING_SUMMARY_KEYS.text]: r.text.trim(),
    [CHAT_ROLLING_SUMMARY_KEYS.covers]: nextCovers
  });
}
