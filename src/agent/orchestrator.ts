/**
 * Оркестратор агента: единая точка принятия решений «есть ли вызовы инструментов → выполнить → следующий раунд LLM».
 * Реализации LLM и выполнения инструментов передаются снаружи (background), чтобы не тянуть chrome в тесты.
 * Опционально: подзадачи «план» и «verify» в чистом контексте + метрики фаз и остановки.
 */

import type { LlmMessageForApi } from "../llm/client";
import type { OpenAITool, ToolServerBinding } from "../mcp/agent-tools";
import type { ReasoningStep } from "../types/messages";
import {
  createInitialMetrics,
  parseVerifySubtaskJson,
  type OrchestrationMetrics
} from "./pipeline";
import {
  buildEnrichedToolCatalogMarkdown,
  narrowToolsByRelevancePlan,
  parseToolRelevancePlan
} from "./tool-catalog";

export const DEFAULT_MAX_AGENT_TOOL_ITERATIONS = 10;

/** После исчерпания основного лимита — столько доп. раундов LLM с инструментами (вердикт). */
export const VERDICT_EXTRA_TOOL_ROUNDS = 2;

/** Нормализованный вызов инструмента (из API или из XML в тексте). */
export type ToolCallSpec = { id: string; name: string; arguments: string };

/** Результат выполнения одного вызова (для UI и истории). */
export interface ToolExecutionResult {
  name: string;
  serverName?: string;
  args: string;
  result: string;
}

const TOOL_SUMMARY_PER_TOOL_MAX = 4000;
const TOOL_SUMMARY_TOTAL_MAX = 12000;

function buildToolResultsSummary(results: ToolExecutionResult[]): string {
  let total = 0;
  const parts: string[] = [];
  for (const r of results) {
    const header = `### ${r.name}${r.serverName ? ` (${r.serverName})` : ""}\nargs: ${r.args}\n---\n`;
    const body = r.result.slice(0, TOOL_SUMMARY_PER_TOOL_MAX);
    const chunk = header + body;
    if (total + chunk.length > TOOL_SUMMARY_TOTAL_MAX) break;
    parts.push(chunk);
    total += chunk.length + 2;
  }
  return parts.join("\n\n");
}

/** Подзадачи LLM без истории чата: план до раундов, проверка после инструментов. */
export interface OrchestratorSubtaskHooks {
  enablePlan?: boolean;
  enableVerify?: boolean;
  /** До основного цикла: какие tools уместны под запрос. */
  enableToolRelevance?: boolean;
  runPlanSubtask?: (userMessage: string) => Promise<{ text: string } | { error: string }>;
  runToolRelevanceSubtask?: (
    userMessage: string,
    toolCatalog: string
  ) => Promise<{ text: string } | { error: string }>;
  runVerifySubtask?: (input: {
    userGoal: string;
    toolResultsSummary: string;
  }) => Promise<{ text: string } | { error: string }>;
}

/**
 * Парсит из текста ответа модели вызовы в XML-подобном формате
 * (<function=name> <parameter=key>value</parameter> ... </function>).
 */
export function parseXmlStyleToolCalls(text: string): ToolCallSpec[] {
  const out: ToolCallSpec[] = [];
  const seenKeys = new Set<string>();
  const funcRegex = /<function=(\w+)>([\s\S]*?)<\/function>/gi;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = funcRegex.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    if (
      name !== "page_read" &&
      name !== "page_click" &&
      name !== "page_fill" &&
      name !== "page_navigate" &&
      name !== "web_search"
    )
      continue;
    const inner = m[2];
    const args: Record<string, string> = {};
    const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = paramRegex.exec(inner)) !== null) {
      args[pm[1].toLowerCase()] = pm[2].trim();
    }
    if (name !== "page_read" && Object.keys(args).length === 0) continue;
    const argsStr = JSON.stringify(args);
    const key = `${name}:${argsStr}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push({
      id: `xml-${i++}`,
      name,
      arguments: argsStr
    });
  }
  return out;
}

/**
 * Решение оркестратора после одного ответа модели: какие инструменты запускать (если есть).
 * Приоритет: нативные tool_calls из API, иначе XML в тексте (только если включены browser tools).
 */
export function resolveToolCallsForRound(
  result: { text?: string; tool_calls?: ToolCallSpec[] },
  options: { hasBrowserTools: boolean }
): ToolCallSpec[] | null {
  const api = result.tool_calls;
  if (api != null && api.length > 0) return api;
  if (!options.hasBrowserTools) return null;
  const xml = parseXmlStyleToolCalls(result.text ?? "");
  return xml.length > 0 ? xml : null;
}

function toolResultsToReasoningSteps(results: ToolExecutionResult[]): ReasoningStep[] {
  return results.map((tr) => {
    const serverName =
      tr.serverName != null && String(tr.serverName).trim() !== ""
        ? String(tr.serverName).trim()
        : "mcp";
    return {
      type: "tool_call" as const,
      name: tr.name,
      serverName,
      args: tr.args || undefined,
      result: tr.result
    };
  });
}

export interface StreamingOrchestratorInput {
  systemPrompt: string;
  tools: OpenAITool[];
  toolToServer: Map<string, ToolServerBinding>;
  signal?: AbortSignal;
}

export interface StreamingOrchestratorDeps {
  /** Лимит раундов «LLM → инструменты» (включительно). */
  maxIterations?: number;
  hasBrowserTools: boolean;
  onChunk: (text: string) => void;
  callLlmWithTools: (
    messages: LlmMessageForApi[],
    opts: {
      systemPrompt: string;
      tools: OpenAITool[];
      onChunk: (text: string) => void;
      signal?: AbortSignal;
    }
  ) => Promise<
    | { error: string }
    | { text: string; thinking?: string; tool_calls?: ToolCallSpec[] }
  >;
  executeTools: (
    calls: ToolCallSpec[],
    toolToServer: Map<string, ToolServerBinding>,
    messages: LlmMessageForApi[]
  ) => Promise<ToolExecutionResult[]>;
  /** Перед выполнением инструментов (для UI: индикатор без полного перерисовывания). */
  onToolRoundStart?: () => void;
  onToolRoundComplete: (steps: ReasoningStep[]) => void;
  /** План / verify в отдельных вызовах модели (короткий system + один user). */
  subtasks?: OrchestratorSubtaskHooks;
  /** После релевантности сужать MCP-инструменты по TOOL_PLAN_JSON (по умолчанию true). */
  narrowToolsToRelevance?: boolean;
}

function lastUserPlainFromConversation(conversation: LlmMessageForApi[]): string {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const m = conversation[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

/**
 * Цикл агента со стримингом: каждый раунд — запрос к LLM, при необходимости выполнение инструментов, снова LLM.
 * @param conversation — история user/assistant (и при необходимости tool), последнее сообщение должно быть от user (текущий запрос).
 */
export async function orchestrateStreamingAgent(
  conversation: LlmMessageForApi[],
  input: StreamingOrchestratorInput,
  deps: StreamingOrchestratorDeps
): Promise<
  | { text: string; reasoningSteps: ReasoningStep[]; metrics: OrchestrationMetrics }
  | { error: string; metrics: OrchestrationMetrics }
> {
  const metrics = createInitialMetrics();
  const maxIt = deps.maxIterations ?? DEFAULT_MAX_AGENT_TOOL_ITERATIONS;
  const userMessage = lastUserPlainFromConversation(conversation);
  if (!userMessage.trim()) {
    metrics.stopReason = "llm_error";
    metrics.lastPhase = "final";
    return { error: "Conversation is empty or has no user message at the end.", metrics };
  }
  const messages: LlmMessageForApi[] = conversation.map((m) => {
    if (m.role === "tool") return { ...m };
    if (m.role === "assistant") return { ...m };
    return { ...m };
  });
  const reasoningSteps: ReasoningStep[] = [];
  let effectiveSystem = input.systemPrompt;
  const sub = deps.subtasks;
  let activeTools = input.tools;
  let activeToolMap = new Map(input.toolToServer);

  if (sub?.enablePlan || (sub?.enableToolRelevance && sub.runToolRelevanceSubtask && input.tools.length > 0)) {
    metrics.lastPhase = "plan";
    const catalog =
      sub?.enableToolRelevance && sub.runToolRelevanceSubtask && input.tools.length > 0
        ? buildEnrichedToolCatalogMarkdown(input.tools, input.toolToServer)
        : "";
    const [planResult, relResult] = await Promise.all([
      sub?.enablePlan && sub.runPlanSubtask
        ? sub.runPlanSubtask(userMessage)
        : Promise.resolve(null),
      catalog && sub?.runToolRelevanceSubtask
        ? sub.runToolRelevanceSubtask(userMessage, catalog)
        : Promise.resolve(null)
    ]);
    if (planResult && !("error" in planResult) && planResult.text.trim() !== "") {
      effectiveSystem = `${input.systemPrompt}\n\n[SUB-PLAN — guidance for tool rounds]\n${planResult.text.trim()}\n[/SUB-PLAN]`;
      metrics.subtasks.planExecuted = true;
    }
    if (relResult && !("error" in relResult) && relResult.text.trim() !== "") {
      effectiveSystem = `${effectiveSystem}\n\n[TOOL_RELEVANCE — match tools to this request first]\n${relResult.text.trim()}\n[/TOOL_RELEVANCE]`;
      if (deps.narrowToolsToRelevance !== false) {
        const plan = parseToolRelevancePlan(relResult.text);
        if (plan.mode === "narrow") {
          const narrowed = narrowToolsByRelevancePlan(activeTools, activeToolMap, plan);
          activeTools = narrowed.tools;
          activeToolMap = narrowed.toolToServer;
          metrics.subtasks.toolsNarrowed = true;
        }
      }
    }
  }

  for (let round = 0; round < maxIt; round++) {
    metrics.lastPhase = "tool_round";
    metrics.mainLlmRounds += 1;
    const result = await deps.callLlmWithTools(messages, {
      systemPrompt: effectiveSystem,
      tools: activeTools,
      onChunk: deps.onChunk,
      signal: input.signal
    });

    if ("error" in result) {
      metrics.stopReason = "llm_error";
      metrics.lastPhase = "final";
      return { error: result.error, metrics };
    }

    const toRun = resolveToolCallsForRound(result, { hasBrowserTools: deps.hasBrowserTools });

    if (toRun != null && toRun.length > 0) {
      const roundSteps: ReasoningStep[] = [];
      if (result.thinking != null && result.thinking !== "") {
        const think: ReasoningStep = { type: "thinking", text: result.thinking };
        reasoningSteps.push(think);
        roundSteps.push(think);
      }
      deps.onToolRoundStart?.();
      const toolResults = await deps.executeTools(toRun, activeToolMap, messages);
      metrics.toolExecutionRounds += 1;
      const toolSteps = toolResultsToReasoningSteps(toolResults);
      for (const s of toolSteps) {
        reasoningSteps.push(s);
        roundSteps.push(s);
      }
      deps.onToolRoundComplete(roundSteps);

      if (sub?.enableVerify && sub.runVerifySubtask && toolResults.length > 0) {
        metrics.lastPhase = "verify";
        const summary = buildToolResultsSummary(toolResults);
        const vr = await sub.runVerifySubtask({ userGoal: userMessage, toolResultsSummary: summary });
        metrics.subtasks.verifyRuns += 1;
        if ("text" in vr) {
          const parsed = parseVerifySubtaskJson(vr.text);
          metrics.lastVerify = parsed;
          if (parsed && !parsed.sufficient && round < maxIt - 1) {
            if (parsed.suggestNext === "more_tools") {
              metrics.stopReason = "verify_need_more_tools";
              messages.push({
                role: "user",
                content: `[Orchestrator follow-up] Prior tool outputs may be insufficient (${parsed.reason}). If more tools can obtain missing evidence, call them this round; otherwise answer with what you have.`
              });
            } else if (parsed.suggestNext === "clarify_user") {
              metrics.stopReason = "verify_clarify";
              messages.push({
                role: "user",
                content: `[Orchestrator follow-up] The request may be ambiguous (${parsed.reason}). Ask the user one short clarifying question if needed, or proceed if you can answer.`
              });
            }
          }
        }
      }
      continue;
    }

    if (result.thinking != null && result.thinking !== "") {
      reasoningSteps.push({ type: "thinking", text: result.thinking });
    }
    metrics.lastPhase = "final";
    metrics.stopReason =
      metrics.lastVerify?.sufficient === true ? "verify_sufficient" : "user_answer";
    return { text: result.text, reasoningSteps, metrics };
  }

  metrics.stopReason = "max_iterations";

  messages.push({
    role: "user",
    content: `[Orchestrator — verdict] The main tool budget (${maxIt} model rounds that may invoke tools) is exhausted. Read the full thread (user request + tool results).
- If you can answer the user completely, respond with plain text only (no tools).
- If critical facts are still missing, you may call tools in at most ${VERDICT_EXTRA_TOOL_ROUNDS} more rounds — only when essential; then answer in text.`
  });

  for (let vr = 0; vr < VERDICT_EXTRA_TOOL_ROUNDS; vr++) {
    metrics.mainLlmRounds += 1;
    metrics.lastPhase = "tool_round";
    const vResult = await deps.callLlmWithTools(messages, {
      systemPrompt: effectiveSystem,
      tools: activeTools,
      onChunk: deps.onChunk,
      signal: input.signal
    });
    if ("error" in vResult) {
      metrics.stopReason = "llm_error";
      metrics.lastPhase = "final";
      return { error: vResult.error, metrics };
    }
    const toRunV = resolveToolCallsForRound(vResult, { hasBrowserTools: deps.hasBrowserTools });
    if (toRunV != null && toRunV.length > 0) {
      const roundSteps: ReasoningStep[] = [];
      if (vResult.thinking != null && vResult.thinking !== "") {
        const think: ReasoningStep = { type: "thinking", text: vResult.thinking };
        reasoningSteps.push(think);
        roundSteps.push(think);
      }
      deps.onToolRoundStart?.();
      const toolResultsV = await deps.executeTools(toRunV, activeToolMap, messages);
      metrics.toolExecutionRounds += 1;
      const toolStepsV = toolResultsToReasoningSteps(toolResultsV);
      for (const s of toolStepsV) {
        reasoningSteps.push(s);
        roundSteps.push(s);
      }
      deps.onToolRoundComplete(roundSteps);
      if (sub?.enableVerify && sub.runVerifySubtask && toolResultsV.length > 0) {
        metrics.lastPhase = "verify";
        const summaryV = buildToolResultsSummary(toolResultsV);
        const vrSub = await sub.runVerifySubtask({
          userGoal: userMessage,
          toolResultsSummary: summaryV
        });
        metrics.subtasks.verifyRuns += 1;
        if ("text" in vrSub) {
          metrics.lastVerify = parseVerifySubtaskJson(vrSub.text);
        }
      }
      continue;
    }
    if (vResult.thinking != null && vResult.thinking !== "") {
      reasoningSteps.push({ type: "thinking", text: vResult.thinking });
    }
    const verdictText = (vResult.text ?? "").trim();
    if (verdictText !== "") {
      metrics.lastPhase = "final";
      metrics.stopReason = "user_answer";
      return { text: vResult.text, reasoningSteps, metrics };
    }
  }

  messages.push({
    role: "user",
    content: `[Orchestrator — final synthesis] Using only the messages above, write the complete answer for the user. Do not call tools. If the question cannot be fully answered from this context, say what is missing.`
  });
  metrics.mainLlmRounds += 1;
  metrics.lastPhase = "final";
  const synth = await deps.callLlmWithTools(messages, {
    systemPrompt: effectiveSystem,
    tools: [],
    onChunk: deps.onChunk,
    signal: input.signal
  });
  if ("error" in synth) {
    metrics.stopReason = "llm_error";
    return { error: synth.error, metrics };
  }
  if (synth.thinking != null && synth.thinking !== "") {
    reasoningSteps.push({ type: "thinking", text: synth.thinking });
  }
  const out = (synth.text ?? "").trim();
  if (out !== "") {
    metrics.stopReason = "user_answer";
    return { text: synth.text, reasoningSteps, metrics };
  }
  metrics.stopReason = "max_iterations";
  return {
    error:
      "Agent could not produce a final answer after the tool limit, verdict rounds, and synthesis.",
    metrics
  };
}

export interface SyncOrchestratorInput {
  systemPrompt: string;
  tools: OpenAITool[];
  toolToServer: Map<string, ToolServerBinding>;
}

export interface SyncOrchestratorDeps {
  maxIterations?: number;
  hasBrowserTools: boolean;
  callLlmOneRound: (
    messages: LlmMessageForApi[],
    opts: { systemPrompt: string; tools: OpenAITool[] }
  ) => Promise<{ text: string } | { tool_calls: ToolCallSpec[] } | { error: string }>;
  executeTools: StreamingOrchestratorDeps["executeTools"];
  subtasks?: OrchestratorSubtaskHooks;
  narrowToolsToRelevance?: boolean;
}

/**
 * Тот же цикл агента без стриминга (например, для CHAT_MESSAGE из content).
 */
export async function orchestrateSyncAgent(
  userMessage: string,
  input: SyncOrchestratorInput,
  deps: SyncOrchestratorDeps
): Promise<
  | { text: string; metrics: OrchestrationMetrics }
  | { error: string; metrics: OrchestrationMetrics }
> {
  const metrics = createInitialMetrics();
  const maxIt = deps.maxIterations ?? DEFAULT_MAX_AGENT_TOOL_ITERATIONS;
  const messages: LlmMessageForApi[] = [{ role: "user", content: userMessage }];
  let effectiveSystem = input.systemPrompt;
  const sub = deps.subtasks;
  let activeTools = input.tools;
  let activeToolMap = new Map(input.toolToServer);

  if (sub?.enablePlan || (sub?.enableToolRelevance && sub.runToolRelevanceSubtask && input.tools.length > 0)) {
    metrics.lastPhase = "plan";
    const catalogSync =
      sub?.enableToolRelevance && sub.runToolRelevanceSubtask && input.tools.length > 0
        ? buildEnrichedToolCatalogMarkdown(input.tools, input.toolToServer)
        : "";
    const [planResultS, relResultS] = await Promise.all([
      sub?.enablePlan && sub.runPlanSubtask
        ? sub.runPlanSubtask(userMessage)
        : Promise.resolve(null),
      catalogSync && sub?.runToolRelevanceSubtask
        ? sub.runToolRelevanceSubtask(userMessage, catalogSync)
        : Promise.resolve(null)
    ]);
    if (planResultS && !("error" in planResultS) && planResultS.text.trim() !== "") {
      effectiveSystem = `${input.systemPrompt}\n\n[SUB-PLAN — guidance for tool rounds]\n${planResultS.text.trim()}\n[/SUB-PLAN]`;
      metrics.subtasks.planExecuted = true;
    }
    if (relResultS && !("error" in relResultS) && relResultS.text.trim() !== "") {
      effectiveSystem = `${effectiveSystem}\n\n[TOOL_RELEVANCE — match tools to this request first]\n${relResultS.text.trim()}\n[/TOOL_RELEVANCE]`;
      if (deps.narrowToolsToRelevance !== false) {
        const planS = parseToolRelevancePlan(relResultS.text);
        if (planS.mode === "narrow") {
          const narrowedS = narrowToolsByRelevancePlan(activeTools, activeToolMap, planS);
          activeTools = narrowedS.tools;
          activeToolMap = narrowedS.toolToServer;
          metrics.subtasks.toolsNarrowed = true;
        }
      }
    }
  }

  for (let round = 0; round < maxIt; round++) {
    metrics.lastPhase = "tool_round";
    metrics.mainLlmRounds += 1;
    const result = await deps.callLlmOneRound(messages, {
      systemPrompt: effectiveSystem,
      tools: activeTools
    });

    if ("error" in result) {
      metrics.stopReason = "llm_error";
      metrics.lastPhase = "final";
      return { error: result.error, metrics };
    }

    if ("tool_calls" in result && result.tool_calls && result.tool_calls.length > 0) {
      const toolResults = await deps.executeTools(result.tool_calls, activeToolMap, messages);
      metrics.toolExecutionRounds += 1;
      if (sub?.enableVerify && sub.runVerifySubtask && toolResults.length > 0) {
        metrics.lastPhase = "verify";
        const vr = await sub.runVerifySubtask({
          userGoal: userMessage,
          toolResultsSummary: buildToolResultsSummary(toolResults)
        });
        metrics.subtasks.verifyRuns += 1;
        if ("text" in vr) {
          const parsed = parseVerifySubtaskJson(vr.text);
          metrics.lastVerify = parsed;
          if (parsed && !parsed.sufficient && round < maxIt - 1) {
            if (parsed.suggestNext === "more_tools") {
              metrics.stopReason = "verify_need_more_tools";
              messages.push({
                role: "user",
                content: `[Orchestrator follow-up] Prior tool outputs may be insufficient (${parsed.reason}). If more tools can obtain missing evidence, call them this round; otherwise answer with what you have.`
              });
            } else if (parsed.suggestNext === "clarify_user") {
              metrics.stopReason = "verify_clarify";
              messages.push({
                role: "user",
                content: `[Orchestrator follow-up] The request may be ambiguous (${parsed.reason}). Ask the user one short clarifying question if needed, or proceed if you can answer.`
              });
            }
          }
        }
      }
      continue;
    }

    if ("text" in result) {
      const toRun = resolveToolCallsForRound(
        { text: result.text, tool_calls: undefined },
        { hasBrowserTools: deps.hasBrowserTools }
      );
      if (toRun != null && toRun.length > 0) {
        const toolResults = await deps.executeTools(toRun, activeToolMap, messages);
        metrics.toolExecutionRounds += 1;
        if (sub?.enableVerify && sub.runVerifySubtask && toolResults.length > 0) {
          metrics.lastPhase = "verify";
          const vr = await sub.runVerifySubtask({
            userGoal: userMessage,
            toolResultsSummary: buildToolResultsSummary(toolResults)
          });
          metrics.subtasks.verifyRuns += 1;
          if ("text" in vr) {
            const parsed = parseVerifySubtaskJson(vr.text);
            metrics.lastVerify = parsed;
            if (parsed && !parsed.sufficient && round < maxIt - 1) {
              if (parsed.suggestNext === "more_tools") {
                metrics.stopReason = "verify_need_more_tools";
                messages.push({
                  role: "user",
                  content: `[Orchestrator follow-up] Prior tool outputs may be insufficient (${parsed.reason}). If more tools can obtain missing evidence, call them this round; otherwise answer with what you have.`
                });
              } else if (parsed.suggestNext === "clarify_user") {
                metrics.stopReason = "verify_clarify";
                messages.push({
                  role: "user",
                  content: `[Orchestrator follow-up] The request may be ambiguous (${parsed.reason}). Ask the user one short clarifying question if needed, or proceed if you can answer.`
                });
              }
            }
          }
        }
        continue;
      }
      metrics.lastPhase = "final";
      metrics.stopReason =
        metrics.lastVerify?.sufficient === true ? "verify_sufficient" : "user_answer";
      return { text: result.text, metrics };
    }

    metrics.stopReason = "llm_error";
    metrics.lastPhase = "final";
    return { error: "Unexpected LLM response shape", metrics };
  }

  metrics.stopReason = "max_iterations";

  messages.push({
    role: "user",
    content: `[Orchestrator — verdict] The main tool budget (${maxIt} model rounds that may invoke tools) is exhausted. Read the full thread.
- If you can answer the user completely, respond with plain text only (no tools).
- If critical facts are still missing, you may call tools in at most ${VERDICT_EXTRA_TOOL_ROUNDS} more rounds — only when essential; then answer in text.`
  });

  for (let vr = 0; vr < VERDICT_EXTRA_TOOL_ROUNDS; vr++) {
    metrics.mainLlmRounds += 1;
    metrics.lastPhase = "tool_round";
    const vRes = await deps.callLlmOneRound(messages, {
      systemPrompt: effectiveSystem,
      tools: activeTools
    });
    if ("error" in vRes) {
      metrics.stopReason = "llm_error";
      metrics.lastPhase = "final";
      return { error: vRes.error, metrics };
    }
    if ("tool_calls" in vRes && vRes.tool_calls && vRes.tool_calls.length > 0) {
      const trV = await deps.executeTools(vRes.tool_calls, activeToolMap, messages);
      metrics.toolExecutionRounds += 1;
      if (sub?.enableVerify && sub.runVerifySubtask && trV.length > 0) {
        metrics.lastPhase = "verify";
        const vrVer = await sub.runVerifySubtask({
          userGoal: userMessage,
          toolResultsSummary: buildToolResultsSummary(trV)
        });
        metrics.subtasks.verifyRuns += 1;
        if ("text" in vrVer) {
          metrics.lastVerify = parseVerifySubtaskJson(vrVer.text);
        }
      }
      continue;
    }
    if ("text" in vRes) {
      const toRunV = resolveToolCallsForRound(
        { text: vRes.text, tool_calls: undefined },
        { hasBrowserTools: deps.hasBrowserTools }
      );
      if (toRunV != null && toRunV.length > 0) {
        const trX = await deps.executeTools(toRunV, activeToolMap, messages);
        metrics.toolExecutionRounds += 1;
        if (sub?.enableVerify && sub.runVerifySubtask && trX.length > 0) {
          metrics.lastPhase = "verify";
          const vrVer2 = await sub.runVerifySubtask({
            userGoal: userMessage,
            toolResultsSummary: buildToolResultsSummary(trX)
          });
          metrics.subtasks.verifyRuns += 1;
          if ("text" in vrVer2) {
            metrics.lastVerify = parseVerifySubtaskJson(vrVer2.text);
          }
        }
        continue;
      }
      const vt = (vRes.text ?? "").trim();
      if (vt !== "") {
        metrics.lastPhase = "final";
        metrics.stopReason = "user_answer";
        return { text: vRes.text, metrics };
      }
    }
  }

  messages.push({
    role: "user",
    content: `[Orchestrator — final synthesis] Using only the messages above, write the complete answer for the user. Do not call tools. If the question cannot be fully answered from this context, say what is missing.`
  });
  metrics.mainLlmRounds += 1;
  metrics.lastPhase = "final";
  const synthS = await deps.callLlmOneRound(messages, {
    systemPrompt: effectiveSystem,
    tools: []
  });
  if ("error" in synthS) {
    metrics.stopReason = "llm_error";
    return { error: synthS.error, metrics };
  }
  if ("text" in synthS) {
    const st = (synthS.text ?? "").trim();
    if (st !== "") {
      metrics.stopReason = "user_answer";
      return { text: synthS.text, metrics };
    }
  }
  metrics.stopReason = "max_iterations";
  return {
    error:
      "Agent could not produce a final answer after the tool limit, verdict rounds, and synthesis.",
    metrics
  };
}
