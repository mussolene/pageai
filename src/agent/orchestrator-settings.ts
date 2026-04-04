/**
 * Настройки оркестратора из chrome.storage.sync (флаги, лимиты сжатия, лексикон поиска).
 */

export type OrchestratorCompressMode = "llm" | "truncate";

export interface OrchestratorSyncSettings {
  orchestratorPlanEnabled: boolean;
  orchestratorVerifyEnabled: boolean;
  orchestratorCompressEnabled: boolean;
  /** Сжимать только если сырой вывод инструмента не короче этого (символы). */
  orchestratorCompressMinChars: number;
  /** Сколько символов максимум отдать в LLM-сжиматель (остальное режется до вызова). */
  orchestratorCompressMaxInputChars: number;
  /** Целевая длина после сжатия (ориентир для промпта и усечения хвоста). */
  orchestratorCompressTargetChars: number;
  orchestratorCompressMode: OrchestratorCompressMode;
  /** До LLM-сжатия: вырезать строки по ключевым словам из последнего user-сообщения (дешёвое ужатие контекста). */
  orchestratorPreshapeEnabled: boolean;
  /** Минимальный размер сырого tool output, чтобы запускать preshape. */
  orchestratorPreshapeMinChars: number;
  /** Максимум символов после grep-выжимки. */
  orchestratorPreshapeMaxChars: number;
  /** Сколько соседних строк брать вокруг совпадения. */
  orchestratorPreshapeContextLines: number;
  /** Синонимы / предпочитаемые термины для web_search и извлечения ключевых слов. */
  agentSearchLexicon: string;
  /** Короткая подзадача «какие tools уместны» до основного цикла. */
  orchestratorToolRelevanceEnabled: boolean;
  /** После релевантности оставить в API только MCP-инструменты из TOOL_PLAN_JSON (встроенные всегда доступны). */
  orchestratorNarrowToolsToRelevance: boolean;
  /** Макс. раундов основной модели с возможностью вызова инструментов. */
  orchestratorMaxToolIterations: number;
}

/** Ключи и значения по умолчанию для chrome.storage.sync.get. */
export const ORCHESTRATOR_SYNC_STORAGE_DEFAULTS: Record<string, unknown> = {
  orchestratorPlanEnabled: true,
  orchestratorVerifyEnabled: true,
  orchestratorCompressEnabled: false,
  orchestratorCompressMinChars: 8000,
  orchestratorCompressMaxInputChars: 28000,
  orchestratorCompressTargetChars: 4000,
  orchestratorCompressMode: "llm",
  orchestratorPreshapeEnabled: true,
  orchestratorPreshapeMinChars: 6000,
  orchestratorPreshapeMaxChars: 14_000,
  orchestratorPreshapeContextLines: 2,
  agentSearchLexicon: "",
  orchestratorToolRelevanceEnabled: true,
  orchestratorNarrowToolsToRelevance: true,
  orchestratorMaxToolIterations: 10
};

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function mergeOrchestratorSettings(stored: Record<string, unknown>): OrchestratorSyncSettings {
  const d = ORCHESTRATOR_SYNC_STORAGE_DEFAULTS;
  const modeRaw = stored.orchestratorCompressMode;
  const mode: OrchestratorCompressMode = modeRaw === "truncate" ? "truncate" : "llm";
  return {
    orchestratorPlanEnabled: stored.orchestratorPlanEnabled !== false,
    orchestratorVerifyEnabled: stored.orchestratorVerifyEnabled !== false,
    orchestratorCompressEnabled: stored.orchestratorCompressEnabled === true,
    orchestratorCompressMinChars: clampInt(
      Number(stored.orchestratorCompressMinChars ?? d.orchestratorCompressMinChars),
      1000,
      500_000
    ),
    orchestratorCompressMaxInputChars: clampInt(
      Number(stored.orchestratorCompressMaxInputChars ?? d.orchestratorCompressMaxInputChars),
      2000,
      500_000
    ),
    orchestratorCompressTargetChars: clampInt(
      Number(stored.orchestratorCompressTargetChars ?? d.orchestratorCompressTargetChars),
      400,
      100_000
    ),
    orchestratorCompressMode: mode,
    orchestratorPreshapeEnabled: stored.orchestratorPreshapeEnabled !== false,
    orchestratorPreshapeMinChars: clampInt(
      Number(stored.orchestratorPreshapeMinChars ?? d.orchestratorPreshapeMinChars),
      500,
      500_000
    ),
    orchestratorPreshapeMaxChars: clampInt(
      Number(stored.orchestratorPreshapeMaxChars ?? d.orchestratorPreshapeMaxChars),
      2000,
      500_000
    ),
    orchestratorPreshapeContextLines: clampInt(
      Number(stored.orchestratorPreshapeContextLines ?? d.orchestratorPreshapeContextLines),
      0,
      12
    ),
    agentSearchLexicon: typeof stored.agentSearchLexicon === "string" ? stored.agentSearchLexicon : "",
    orchestratorToolRelevanceEnabled: stored.orchestratorToolRelevanceEnabled !== false,
    orchestratorNarrowToolsToRelevance: stored.orchestratorNarrowToolsToRelevance !== false,
    orchestratorMaxToolIterations: clampInt(
      Number(stored.orchestratorMaxToolIterations ?? d.orchestratorMaxToolIterations),
      3,
      40
    )
  };
}
