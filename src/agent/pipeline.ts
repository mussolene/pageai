/**
 * Фазы и метрики оркестратора: явные критерии прогресса и завершения.
 */

export type OrchestrationStopReason =
  | "user_answer"
  | "max_iterations"
  | "llm_error"
  | "verify_sufficient"
  | "verify_need_more_tools"
  | "verify_clarify";

export interface OrchestrationSubtaskStats {
  planExecuted: boolean;
  verifyRuns: number;
  /** Список MCP-инструментов сужен по TOOL_PLAN_JSON после подзадачи релевантности. */
  toolsNarrowed: boolean;
}

export interface OrchestrationMetrics {
  /** Версия схемы метрик (для UI / логов). */
  schemaVersion: 1;
  /** Сколько полных раундов вызова основной модели с инструментами. */
  mainLlmRounds: number;
  /** Сколько раундов, в которых реально выполнялись инструменты. */
  toolExecutionRounds: number;
  /** Подзадачи с «чистым» контекстом. */
  subtasks: OrchestrationSubtaskStats;
  stopReason: OrchestrationStopReason | "in_progress";
  /** Последняя зафиксированная фаза (для отладки). */
  lastPhase: "intake" | "tool_round" | "verify" | "final" | "plan";
  /** Результат последней verify-подзадачи (если была). */
  lastVerify?: VerifyParseResult | null;
}

export function createInitialMetrics(): OrchestrationMetrics {
  return {
    schemaVersion: 1,
    mainLlmRounds: 0,
    toolExecutionRounds: 0,
    subtasks: { planExecuted: false, verifyRuns: 0, toolsNarrowed: false },
    stopReason: "in_progress",
    lastPhase: "intake"
  };
}

export interface VerifyParseResult {
  sufficient: boolean;
  reason: string;
  suggestNext: "none" | "more_tools" | "clarify_user";
}

/** Парсинг ответа verify-подзадачи (устойчивый к лишнему тексту). */
export function parseVerifySubtaskJson(text: string): VerifyParseResult | null {
  const trimmed = text.trim();
  const tryParse = (s: string): VerifyParseResult | null => {
    try {
      const o = JSON.parse(s) as Record<string, unknown>;
      const sufficient = Boolean(o.sufficient);
      const reason = typeof o.reason === "string" ? o.reason : "";
      const sn = o.suggest_next;
      const suggestNext =
        sn === "more_tools" || sn === "clarify_user" || sn === "none" ? sn : "none";
      return { sufficient, reason, suggestNext };
    } catch {
      return null;
    }
  };
  let parsed = tryParse(trimmed);
  if (parsed) return parsed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    parsed = tryParse(trimmed.slice(start, end + 1));
  }
  return parsed;
}
