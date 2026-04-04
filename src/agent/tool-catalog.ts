import type { OpenAITool, ToolServerBinding } from "../mcp/agent-tools";

/** Встроенные инструменты расширения — не сужаются подзадачей релевантности. */
export const BUILTIN_ORCHESTRATOR_TOOL_NAMES = new Set([
  "page_read",
  "page_click",
  "page_fill",
  "page_navigate",
  "open_search_tab",
  "web_research",
  "mcp_diagnose"
]);

/** Краткий каталог имён и описаний для подзадач (релевантность, план). */
export function buildToolCatalogMarkdown(tools: OpenAITool[]): string {
  if (tools.length === 0) return "(no tools registered)";
  return tools
    .map((t) => {
      const name = t.function.name;
      const desc = (t.function.description ?? "").trim() || "(no description)";
      return `- ${name}: ${desc}`;
    })
    .join("\n");
}

/**
 * Каталог для подзадачи релевантности: источник (MCP-сервер или built-in) + описание из MCP.
 */
export function buildEnrichedToolCatalogMarkdown(
  tools: OpenAITool[],
  toolToServer: Map<string, ToolServerBinding>
): string {
  if (tools.length === 0) return "(no tools registered)";
  return tools
    .map((t) => {
      const name = t.function.name;
      const desc = (t.function.description ?? "").trim() || "(no description)";
      const bind = toolToServer.get(name);
      const origin =
        bind != null
          ? `MCP server «${bind.serverName}»`
          : BUILTIN_ORCHESTRATOR_TOOL_NAMES.has(name)
            ? "built-in (browser / extension)"
            : "extension";
      return `- **${name}** (${origin}): ${desc}`;
    })
    .join("\n");
}

/** Результат разбора TOOL_PLAN_JSON из ответа подзадачи релевантности. */
export type ToolRelevancePlanParse =
  | { mode: "none" }
  | { mode: "narrow"; allow: string[] };

/**
 * Ищет в конце ответа строку `TOOL_PLAN_JSON: {"allow":["tool_a",...]}`.
 * allow=[] означает «ни один MCP-инструмент не нужен» (останутся только built-in).
 */
export function parseToolRelevancePlan(text: string): ToolRelevancePlanParse {
  const lines = text.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim() ?? "";
    const prefix = "TOOL_PLAN_JSON:";
    if (!line.startsWith(prefix)) continue;
    const jsonPart = line.slice(prefix.length).trim();
    try {
      const j = JSON.parse(jsonPart) as { allow?: unknown };
      if (!Array.isArray(j.allow)) return { mode: "none" };
      const allow = j.allow
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean);
      return { mode: "narrow", allow };
    } catch {
      return { mode: "none" };
    }
  }
  return { mode: "none" };
}

/** Сужает список инструментов для основного цикла по allow (имена как в API). */
export function narrowToolsByRelevancePlan(
  tools: OpenAITool[],
  toolToServer: Map<string, ToolServerBinding>,
  plan: ToolRelevancePlanParse
): { tools: OpenAITool[]; toolToServer: Map<string, ToolServerBinding> } {
  if (plan.mode === "none") {
    return { tools, toolToServer: new Map(toolToServer) };
  }
  const allowSet = new Set(plan.allow);
  const nextTools: OpenAITool[] = [];
  const nextMap = new Map<string, ToolServerBinding>();
  for (const t of tools) {
    const n = t.function.name;
    if (BUILTIN_ORCHESTRATOR_TOOL_NAMES.has(n)) {
      nextTools.push(t);
      continue;
    }
    if (!toolToServer.has(n)) {
      nextTools.push(t);
      continue;
    }
    if (plan.allow.length === 0) {
      continue;
    }
    if (allowSet.has(n)) {
      nextTools.push(t);
      const b = toolToServer.get(n);
      if (b) nextMap.set(n, b);
    }
  }
  return { tools: nextTools, toolToServer: nextMap };
}
