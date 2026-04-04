import type { LlmMessageForApi } from "../llm/client";

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "have",
  "what",
  "when",
  "your",
  "как",
  "что",
  "это",
  "для",
  "или",
  "все",
  "вот",
  "так",
  "где",
  "при",
  "ли",
  "не",
  "на",
  "по",
  "из",
  "за",
  "до",
  "от",
  "об",
  "вы",
  "мы",
  "он",
  "она",
  "они"
]);

/** Последний user-текст в треде (для выбора релевантных строк из сырого tool output). */
export function lastUserContentFromApiMessages(messages: LlmMessageForApi[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

/** Токены из запроса пользователя для «мягкого grep» (без regex). */
export function tokenizeQueryHints(userGoal: string, maxHints = 24): string[] {
  const raw = userGoal
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ");
  const parts = raw.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (p.length < 3) continue;
    if (STOP.has(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= maxHints) break;
  }
  return out;
}

function lineMatches(line: string, hints: string[]): boolean {
  const low = line.toLowerCase();
  return hints.some((h) => low.includes(h));
}

/**
 * Вырезает фрагменты строк, где встречаются hints, с контекстом ±contextLines.
 * Возвращает null, если совпадений нет или слишком мало материала.
 */
export function grepRelevantExcerpt(
  text: string,
  hints: string[],
  maxChars: number,
  contextLines: number
): string | null {
  if (!text || hints.length === 0 || maxChars < 200) return null;
  const lines = text.split(/\n/);
  const hit = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (lineMatches(lines[i] ?? "", hints)) {
      for (let j = Math.max(0, i - contextLines); j <= Math.min(lines.length - 1, i + contextLines); j++) {
        hit.add(j);
      }
    }
  }
  if (hit.size === 0) return null;

  const sorted = [...hit].sort((a, b) => a - b);
  const chunks: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let k = 1; k < sorted.length; k++) {
    const idx = sorted[k]!;
    if (idx <= prev + 1) {
      prev = idx;
    } else {
      chunks.push(lines.slice(start, prev + 1).join("\n"));
      start = idx;
      prev = idx;
    }
  }
  chunks.push(lines.slice(start, prev + 1).join("\n"));

  let out = chunks.join("\n\n[...]\n\n");
  const label = `[Relevant lines (keyword match from user request)]\n`;
  if (out.length + label.length > maxChars) {
    out = out.slice(0, Math.max(0, maxChars - label.length - 80)) + "\n[...cut...]";
  }
  return label + out;
}

/**
 * Дешёвое сжатие без LLM: нормализация пробелов + опционально grep.
 */
export function preshapeToolOutputForContext(
  raw: string,
  options: {
    enabled: boolean;
    minChars: number;
    maxOutChars: number;
    contextLines: number;
    userGoal: string;
  }
): string {
  let body = raw.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n");
  if (!options.enabled || body.length < options.minChars) return body;

  const hints = tokenizeQueryHints(options.userGoal);
  if (hints.length === 0) return body;

  const excerpt = grepRelevantExcerpt(body, hints, options.maxOutChars, options.contextLines);
  if (excerpt == null) return body;

  /** Использовать выжимку только если заметно короче сырья (иначе шум/ложная экономия). */
  if (excerpt.length > body.length * 0.85) return body;

  return excerpt;
}
