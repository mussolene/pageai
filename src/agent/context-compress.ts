import { chatWithLLMSubtask } from "../llm/client";
import { SUBTASK_TOOL_COMPRESS_SYSTEM } from "./standards";
import type { OrchestratorSyncSettings } from "./orchestrator-settings";
import { preshapeToolOutputForContext } from "./tool-output-preshape";

/** Усечь строку, сохранив начало и конец (для очень длинных сырьевых ответов). */
export function truncateMiddle(raw: string, maxLen: number): string {
  if (raw.length <= maxLen) return raw;
  const midLabel = "\n\n[... truncated ...]\n\n";
  const budget = maxLen - midLabel.length;
  const head = Math.max(1, Math.floor(budget * 0.5));
  const tail = Math.max(1, budget - head);
  return `${raw.slice(0, head)}${midLabel}${raw.slice(-tail)}`;
}

/**
 * Фабрика: для каждого tool-сообщения решает, оставить как есть, усечь или сжать через LLM.
 * Политика задаётся в OrchestratorSyncSettings (флаги и пороги из Options).
 */
export function createToolContentFinalizer(
  settings: OrchestratorSyncSettings,
  signal?: AbortSignal
): (toolName: string, raw: string, userGoal?: string) => Promise<string> {
  return async (toolName: string, raw: string, userGoal = ""): Promise<string> => {
    const working = preshapeToolOutputForContext(raw, {
      enabled: settings.orchestratorPreshapeEnabled,
      minChars: settings.orchestratorPreshapeMinChars,
      maxOutChars: settings.orchestratorPreshapeMaxChars,
      contextLines: settings.orchestratorPreshapeContextLines,
      userGoal
    });

    if (!settings.orchestratorCompressEnabled || working.length < settings.orchestratorCompressMinChars) {
      return working;
    }
    const maxIn = Math.max(2000, settings.orchestratorCompressMaxInputChars);
    const target = Math.max(400, settings.orchestratorCompressTargetChars);
    const prepared = working.length > maxIn ? truncateMiddle(working, maxIn) : working;

    if (settings.orchestratorCompressMode === "truncate") {
      const out = truncateMiddle(working, target);
      return out === working ? out : `[Truncated tool output — ${toolName}]\n${out}`;
    }

    const user = `Tool: ${toolName}
Approximate max length of your summary: ${target} characters (preserve critical data if slightly over).
Preserve: numbers, dates, URLs, errors, IDs, JSON keys.

---
${prepared}`;

    const maxTokens = Math.min(2048, Math.ceil(target / 2) + 256);
    const r = await chatWithLLMSubtask(user, {
      systemPrompt: SUBTASK_TOOL_COMPRESS_SYSTEM,
      maxTokens,
      temperature: 0.2,
      signal
    });

    if ("error" in r || !r.text.trim()) {
      const fallback = truncateMiddle(working, target);
      return `[Truncated tool output — ${toolName} (compress failed)]\n${fallback}`;
    }

    let out = r.text.trim();
    if (out.length > target * 1.25) {
      out = truncateMiddle(out, target);
    }
    return `[Compressed tool output — ${toolName}]\n${out}`;
  };
}
