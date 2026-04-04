/**
 * Определяет язык ответа по последнему сообщению пользователя и добавляет в system
 * явный блок [REPLY_LANGUAGE], чтобы локальные многоязычные модели (например Qwen)
 * не переключались на китайский из-за английского системного промпта.
 */

export type ReplyLanguageCode = "en" | "ru" | "uk" | "zh" | "ja" | "ko";

export type UiLocale = "en" | "ru";

/** Последнее непустое user-сообщение в ходе к API (с конца массива). */
export function findLastUserPlainText(
  messages: ReadonlyArray<{ role: string; content?: string | null }>
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const c = m.content;
    if (typeof c === "string" && c.trim() !== "") return c;
  }
  return null;
}

function latinTextLikelyEnglish(text: string): boolean {
  const lower = text.toLowerCase();
  const enHints =
    /\b(the|and|is|are|what|how|why|when|where|please|can you|could you|does|this|that|with|from|have|has|not|for|will|would|http|https|error|api|json|code|function)\b/;
  const ruHints = /\b(что|как|где|когда|почему|это|для|или|если|надо|нет|да|все|ещё|уже|привет|спасибо)\b/i;
  if (ruHints.test(text)) return false;
  if (enHints.test(lower)) return true;
  return false;
}

/**
 * Язык ответа: по письменности и простым эвристикам для латиницы; при неоднозначности — локаль UI расширения.
 */
export function detectReplyLanguageFromUserText(text: string, uiLocale: UiLocale): ReplyLanguageCode {
  const t = text.trim();
  if (!t) return uiLocale === "ru" ? "ru" : "en";

  if (/[іїєґІЇЄҐ]/.test(t)) return "uk";
  if (/[\u0400-\u04FF]/.test(t)) return "ru";
  if (/[\u3040-\u30ff]/.test(t)) return "ja";
  if (/[\uac00-\ud7af]/.test(t) || /[\u1100-\u11ff]/.test(t)) return "ko";
  if (/[\u4e00-\u9fff]/.test(t)) return "zh";

  if (/[a-z]/i.test(t)) {
    if (latinTextLikelyEnglish(t)) return "en";
    return uiLocale === "ru" ? "ru" : "en";
  }

  return uiLocale === "ru" ? "ru" : "en";
}

export function buildReplyLanguageEnforcementBlock(code: ReplyLanguageCode): string {
  const blocks: Record<ReplyLanguageCode, string> = {
    en: `[REPLY_LANGUAGE — host-enforced]
Mandatory output language: English (en). Write the entire response in English only (all headings, lists, explanations). Do not use Chinese characters unless quoting source text.`,
    ru: `[REPLY_LANGUAGE — host-enforced]
Mandatory output language: Russian (ru). Write the entire response in Russian only. Do not use Chinese, Japanese, or Korean for the answer text.
Обязательный язык ответа: русский. Весь ответ только на русском. Не отвечай китайским.`,
    uk: `[REPLY_LANGUAGE — host-enforced]
Mandatory output language: Ukrainian (uk). Write the entire response in Ukrainian only. Do not use Chinese characters for the answer text.
Обов'язкова мова відповіді: українська.`,
    zh: `[REPLY_LANGUAGE — host-enforced]
Mandatory output language: Chinese (zh). 请用中文撰写完整回复（标题、列表、正文）。`,
    ja: `[REPLY_LANGUAGE — host-enforced]
Mandatory output language: Japanese (ja). 応答の全文を日本語で書いてください。`,
    ko: `[REPLY_LANGUAGE — host-enforced]
Mandatory output language: Korean (ko). 전체 응답을 한국어로만 작성하세요.`
  };
  return blocks[code];
}

/** Добавляет к system явное требование языка; при отсутствии текста пользователя — язык UI. */
export function appendReplyLanguageToSystemPrompt(
  systemPrompt: string,
  lastUserPlainText: string | null,
  uiLocale: UiLocale
): string {
  const code =
    lastUserPlainText != null && lastUserPlainText.trim() !== ""
      ? detectReplyLanguageFromUserText(lastUserPlainText, uiLocale)
      : uiLocale === "ru"
        ? "ru"
        : "en";
  return `${systemPrompt}\n\n${buildReplyLanguageEnforcementBlock(code)}`;
}
