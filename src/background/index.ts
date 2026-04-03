import { MessageFromContent, MessageFromPanel, ChatMessage, Page, type ReasoningStep } from "../types/messages";
import { Storage } from "../storage/indexdb";
import {
  summarizePages,
  chatWithLLM,
  chatWithLLMStream,
  chatWithLLMStreamWithTools,
  chatWithLLMOneRound,
  chatWithLLMSubtask,
  type LlmMessageForApi
} from "../llm/client";
import { buildSummaryPrompt } from "../llm/prompts";
import {
  getEnabledMcpToolsWithMap,
  type OpenAITool,
  type McpToolsLoadResult,
  type ToolServerBinding
} from "../mcp/agent-tools";
import {
  orchestrateStreamingAgent,
  orchestrateSyncAgent,
  type OrchestratorSubtaskHooks,
  type ToolCallSpec,
  type ToolExecutionResult
} from "../agent/orchestrator";
import {
  appendStandardOrchestratorBlock,
  appendSearchLexiconBlock,
  SUBTASK_PLAN_SYSTEM,
  SUBTASK_TOOL_RELEVANCE_SYSTEM,
  SUBTASK_VERIFY_SYSTEM
} from "../agent/standards";
import { buildEnrichedToolCatalogMarkdown, buildToolCatalogMarkdown } from "../agent/tool-catalog";
import {
  ORCHESTRATOR_SYNC_STORAGE_DEFAULTS,
  mergeOrchestratorSettings,
  type OrchestratorSyncSettings
} from "../agent/orchestrator-settings";
import { createToolContentFinalizer } from "../agent/context-compress";
import { getBrowserTools } from "../browser-tools";
import { callMcpTool } from "../mcp/client";

const storage = new Storage();

/** Диагностический инструмент: модель вызывает его по запросу "проверь инструменты". */
const MCP_DIAGNOSE_TOOL: OpenAITool = {
  type: "function",
  function: {
    name: "mcp_diagnose",
    description: "Run MCP tools connectivity check. Call when user asks to verify/check if tools are connected, e.g. 'проверь инструменты', 'check MCP', 'are tools connected'."
  }
};

const WEB_SEARCH_ENGINES: Record<string, (q: string) => string> = {
  duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  yandex: (q) => `https://yandex.ru/search/?text=${encodeURIComponent(q)}`
};

/** Поиск в интернете: открывает вкладку с результатами (DuckDuckGo, Google, Yandex). */
const WEB_SEARCH_TOOL: OpenAITool = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "User wants to search the web: find, look up, search internet. Opens search results in a new tab. Use DuckDuckGo, Google or Yandex.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query"
        },
        engine: {
          type: "string",
          description: "Optional: duckduckgo (default), google, yandex"
        }
      },
      required: ["query"]
    }
  }
};

async function runMcpDiagnose(): Promise<string> {
  const loaded = await getEnabledMcpToolsWithMap();
  if ("error" in loaded) return `Config error: ${loaded.error}`;
  if (loaded.tools.length > 0) {
    const names = loaded.tools.map((t) => t.function.name).join(", ");
    return `OK: ${loaded.tools.length} tool(s) loaded: ${names}`;
  }
  if (!loaded.mcpConfigured) return "No MCP servers configured.";
  const errs = loaded.loadErrors && Object.keys(loaded.loadErrors).length > 0
    ? Object.entries(loaded.loadErrors)
        .map(([n, m]) => `${n}: ${m}`)
        .join("\n")
    : "No specific errors captured.";
  return `Tools failed to load.\nErrors:\n${errs}\n\nSuggest: 1) Ensure the MCP server is running at the URL from Settings → MCP; 2) Or remove/disable that server in Settings → MCP if you don't use it.`;
}

const PAGE_LOAD_ERROR =
  "Please wait for the page to load completely, then try again.";
const PAGE_ACCESS_ERROR =
  "Could not access this tab. Refresh the page (F5) and try again, or use a different tab.";

/** Проверяет, спрашивает ли пользователь явно про текущую страницу. Только в этом случае парсим вкладку. */
function isQuestionAboutCurrentPage(text: string): boolean {
  const t = text.trim().toLowerCase();
  const phrases = [
    "этой страниц",
    "текущей страниц",
    "данные текущей страницы",
    "данные этой страницы",
    "этой странице",
    "на этой странице",
    "что на странице",
    "что здесь",
    "содержимое страницы",
    "контент страницы",
    "this page",
    "current page",
    "on this page",
    "what's on this page",
    "what is on this page",
    "page content",
    "summarize this",
    "резюмируй страницу",
    "перескажи страницу",
    "о чём эта страница",
    "о чем эта страница"
  ];
  return phrases.some((p) => t.includes(p));
}

interface GetCurrentPageResponse {
  ok: boolean;
  page?: Page;
  error?: string;
}

function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Receiving end does not exist") ||
    msg.includes("Could not establish connection") ||
    msg.includes("message port closed")
  );
}

async function getCurrentPageWithRetry(tabId: number, maxAttempts = 3): Promise<GetCurrentPageResponse> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return (await chrome.tabs.sendMessage(tabId, { type: "GET_CURRENT_PAGE" })) as GetCurrentPageResponse;
    } catch (err) {
      const lastAttempt = attempt === maxAttempts;
      if (lastAttempt && isConnectionError(err)) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content.js"]
          });
          await new Promise((r) => setTimeout(r, 400));
          const response = (await chrome.tabs.sendMessage(tabId, {
            type: "GET_CURRENT_PAGE"
          })) as GetCurrentPageResponse;
          return response;
        } catch (retryErr) {
          const e = new Error(PAGE_ACCESS_ERROR);
          (e as Error & { cause?: unknown }).cause = retryErr;
          throw e;
        }
      }
      if (lastAttempt) {
        const e = new Error(PAGE_LOAD_ERROR);
        (e as Error & { cause?: unknown }).cause = err;
        throw e;
      }
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  throw new Error(PAGE_LOAD_ERROR);
}

/** Отправка в порт без ошибки при отключённом порте (закрыт popup/panel). */
function safePortPost(port: chrome.runtime.Port, msg: object): void {
  try {
    port.postMessage(msg);
  } catch {
    // Port disconnected (e.g. user closed popup/panel)
  }
}

/** Отправить в порт; возвращает false, если порт отключён (клиент закрыл окно). */
function tryPortPost(port: chrome.runtime.Port, msg: object): boolean {
  try {
    port.postMessage(msg);
    return true;
  } catch {
    return false;
  }
}

/** Базовый системный промпт для чата (без инструментов). */
const BASE_CHAT_SYSTEM_PROMPT =
  "You are a helpful assistant. Answer the user's question concisely.";

/** Извлекает размышления и финальный текст из ответа модели (теги <think>...</think>). */
function parseThinkingFromText(text: string): { text: string; thinking?: string } {
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>([\s\S]*)/);
  if (thinkMatch) {
    return {
      text: thinkMatch[2].trim(),
      thinking: thinkMatch[1].trim() || undefined
    };
  }
  return { text };
}

/**
 * Формирует системный промпт с явным указанием статуса MCP-инструментов,
 * чтобы любой ИИ (LM Studio, OpenAI-совместимый и др.) знал о доступных инструментах.
 */
function buildSystemPromptWithToolStatus(
  loaded: {
    tools: OpenAITool[];
    mcpConfigured: boolean;
    loadErrors?: Record<string, string>;
  },
  browserTools: OpenAITool[] | undefined,
  basePrompt: string
): string {
  const browserList = (browserTools ?? []).map(
    (t) => `${t.function.name}${t.function.description ? ": " + t.function.description : ""}`
  );
  const mcpList = loaded.tools.map(
    (t) => `${t.function.name}${t.function.description ? ": " + t.function.description : ""}`
  );

  const hasBrowser = browserList.length > 0;
  const hasMcp = mcpList.length > 0;

  if (hasBrowser || hasMcp) {
    const sections: string[] = [];
    if (hasBrowser) {
      sections.push(`[BROWSER TOOLS] ${browserList.join("; ")}`);
    }
    if (hasMcp) {
      sections.push(`[MCP TOOLS] ${mcpList.join("; ")}`);
    }
    const toolsBlock = sections.join("\n\n");
    return `${basePrompt}

${toolsBlock}

[INTENT] Infer from natural language. Read/understand current page → page_read. Click/press/activate on page → page_click. Type/write/fill into a field → page_fill (field: search/comment/поиск/запрос, value: text). Navigate to URL → page_navigate (url). Search the web/look up/find online → web_search (query, optional engine: duckduckgo|google|yandex). Use tool_calls; no exact wording needed.`;
  }
  if (!hasMcp && loaded.mcpConfigured) {
    const errLines =
      loaded.loadErrors && Object.keys(loaded.loadErrors).length > 0
        ? "\nLoad errors: " +
          Object.entries(loaded.loadErrors)
            .map(([name, msg]) => `${name}: ${msg}`)
            .join("; ")
        : "";
    return `${basePrompt}

[MCP CONFIGURED] MCP tools are configured but could not be loaded.${errLines}

You have the mcp_diagnose tool. When the user asks to check/verify tools ("проверь инструменты", "check MCP", "are tools connected?", etc.) — call mcp_diagnose and report its result. Do NOT proactively say the server is unreachable.`;
  }
  return basePrompt;
}

async function buildBaseSystemPromptWithAgentMeta(): Promise<string> {
  const { agentRules, agentSkills } = await new Promise<{ agentRules: string; agentSkills: string }>((resolve) => {
    chrome.storage.sync.get(
      {
        agentRules: "",
        agentSkills: ""
      },
      (items) => {
        resolve({
          agentRules: (items.agentRules as string) || "",
          agentSkills: (items.agentSkills as string) || ""
        });
      }
    );
  });

  let prompt = BASE_CHAT_SYSTEM_PROMPT;
  if (agentRules && agentRules.trim() !== "") {
    prompt += `\n\n[RULES]\n${agentRules.trim()}`;
  }
  if (agentSkills && agentSkills.trim() !== "") {
    prompt += `\n\n[SKILLS]\n${agentSkills.trim()}`;
  }
  return prompt;
}

async function loadAgentToolsAndPrompt(): Promise<{
  mcpLoaded: McpToolsLoadResult;
  browserTools: OpenAITool[];
  systemPrompt: string;
  orchestrator: OrchestratorSyncSettings;
}> {
  const [settings, mcpLoadedRaw, basePrompt, orchestratorStored] = await Promise.all([
    new Promise<{ browserAutomationEnabled: boolean }>((resolve) => {
      chrome.storage.sync.get({ browserAutomationEnabled: false }, (items) => {
        resolve({
          browserAutomationEnabled: Boolean(items.browserAutomationEnabled)
        });
      });
    }),
    getEnabledMcpToolsWithMap(),
    buildBaseSystemPromptWithAgentMeta(),
    new Promise<Record<string, unknown>>((resolve) => {
      chrome.storage.sync.get(ORCHESTRATOR_SYNC_STORAGE_DEFAULTS, (items) => {
        resolve(items as Record<string, unknown>);
      });
    })
  ]);

  const mcpLoaded: McpToolsLoadResult =
    "error" in mcpLoadedRaw
      ? { tools: [], toolToServer: new Map(), mcpConfigured: false, loadErrors: undefined }
      : mcpLoadedRaw;
  const browserTools = getBrowserTools({
    browserAutomationEnabled: settings.browserAutomationEnabled
  });
  const orchestrator = mergeOrchestratorSettings(orchestratorStored);
  const pipelineBlock = appendStandardOrchestratorBlock(
    buildSystemPromptWithToolStatus(mcpLoaded, browserTools, basePrompt)
  );
  const systemPrompt = appendSearchLexiconBlock(pipelineBlock, orchestrator.agentSearchLexicon);
  return { mcpLoaded, browserTools, systemPrompt, orchestrator };
}

/** План, релевантность tools, verify — отдельные короткие вызовы LLM без tools. */
function createDefaultOrchestratorSubtasks(
  orchestrator: OrchestratorSyncSettings,
  signal: AbortSignal | undefined,
  toolCatalog: string
): OrchestratorSubtaskHooks {
  const cat = toolCatalog.trim();
  return {
    enablePlan: orchestrator.orchestratorPlanEnabled,
    enableVerify: orchestrator.orchestratorVerifyEnabled,
    enableToolRelevance: orchestrator.orchestratorToolRelevanceEnabled && cat.length > 0,
    runPlanSubtask: (userMessage: string) =>
      chatWithLLMSubtask(userMessage, { systemPrompt: SUBTASK_PLAN_SYSTEM, signal }),
    runToolRelevanceSubtask:
      cat.length > 0
        ? (userMessage: string, catalog: string) =>
            chatWithLLMSubtask(
              `User request:\n${userMessage}\n\nAvailable tools:\n${catalog}`,
              { systemPrompt: SUBTASK_TOOL_RELEVANCE_SYSTEM, maxTokens: 512, temperature: 0.25, signal }
            )
        : undefined,
    runVerifySubtask: ({ userGoal, toolResultsSummary }) =>
      chatWithLLMSubtask(
        `User request:\n${userGoal}\n\nTool outputs (summary):\n${toolResultsSummary}`,
        { systemPrompt: SUBTASK_VERIFY_SYSTEM, maxTokens: 256, temperature: 0.2, signal }
      )
  };
}

/** Результат одного вызова инструмента (реэкспорт для совместимости). */
export type ToolCallResult = ToolExecutionResult;

async function appendFinalizedToolMessage(
  finalizeToolContent: (toolName: string, raw: string) => Promise<string>,
  tc: ToolCallSpec,
  raw: string,
  messages: LlmMessageForApi[],
  results: ToolExecutionResult[],
  resultMeta: { name: string; serverName?: string; args: string }
): Promise<string> {
  const content = await finalizeToolContent(tc.name, raw);
  messages.push({ role: "tool", tool_call_id: tc.id, content });
  results.push({ ...resultMeta, result: content });
  return content;
}

/**
 * Выполнить один раунд вызовов инструментов и дописать сообщения в историю для следующего раунда LLM.
 */
async function executeToolCallsAndAppendMessages(
  toolCalls: ToolCallSpec[],
  toolToServer: Map<string, ToolServerBinding>,
  messages: LlmMessageForApi[],
  finalizeToolContent: (toolName: string, raw: string) => Promise<string> = async (_, r) => r,
  hooks?: { onToolStart?: (tc: ToolCallSpec) => void; onToolEnd?: (tc: ToolCallSpec) => void }
): Promise<ToolExecutionResult[]> {
  const assistantToolCalls = toolCalls.map((tc) => ({
    id: tc.id,
    type: "function" as const,
    function: { name: tc.name, arguments: tc.arguments }
  }));
  messages.push({
    role: "assistant",
    content: null,
    tool_calls: assistantToolCalls
  });
  const results: ToolExecutionResult[] = [];
  /** Повторные одинаковые page_click/page_fill не выполняем дважды — подставляем результат первого. */
  const pageToolResultByKey = new Map<string, string>();
  for (const tc of toolCalls) {
    hooks?.onToolStart?.(tc);
    try {
      const argsStr = tc.arguments?.trim() ?? "";
      if (tc.name === "mcp_diagnose") {
        const raw = await runMcpDiagnose();
        await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
          name: tc.name,
          args: argsStr
        });
        continue;
      }
      if (tc.name === "page_read") {
      const tabs = await new Promise<chrome.tabs.Tab[]>((r) =>
        chrome.tabs.query({ active: true, currentWindow: true }, r)
      );
      const tabId = tabs[0]?.id;
      if (tabId == null) {
        const raw = "No active tab. Open the page you want to read, then try again.";
        await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
          name: tc.name,
          serverName: "page",
          args: argsStr
        });
        continue;
      }
      let mode: string | undefined;
      try {
        if (argsStr) {
          const parsed = JSON.parse(argsStr) as { mode?: string };
          mode = parsed.mode;
        }
      } catch {
        /* ignore */
      }
      try {
        const pageResponse = await getCurrentPageWithRetry(tabId);
        if (!pageResponse.ok || !pageResponse.page) {
          const raw =
            pageResponse.error ||
            "Could not read this page. Wait for it to load fully and try again.";
          await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
            name: tc.name,
            serverName: "page",
            args: argsStr
          });
          continue;
        }
        const page = pageResponse.page;
        if ((mode ?? "summary") === "full") {
          const raw = `Title: ${page.title}\nURL: ${page.url}\n\n${page.contentText ?? ""}`;
          await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
            name: tc.name,
            serverName: "page",
            args: argsStr
          });
        } else {
          const summary = await summarizePages([page], {
            pageIds: [page.id],
            query: "Кратко перескажи содержимое этой страницы."
          });
          if ("error" in summary) {
            const raw = summary.error ?? "Failed to summarize page.";
            await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
              name: tc.name,
              serverName: "page",
              args: argsStr
            });
          } else {
            const raw = summary.text ?? "No summary produced for this page.";
            await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
              name: tc.name,
              serverName: "page",
              args: argsStr
            });
          }
        }
      } catch (err) {
        const raw =
          (err instanceof Error ? err.message : String(err)) ||
          "Failed to read current page.";
        await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
          name: tc.name,
          serverName: "page",
          args: argsStr
        });
      }
      continue;
    }
    if (tc.name === "page_click") {
      const key = `page_click:${argsStr}`;
      const cached = pageToolResultByKey.get(key);
      if (cached != null) {
        messages.push({ role: "tool", tool_call_id: tc.id, content: cached });
        continue;
      }
      let args: { text?: string; selector?: string } = {};
      try {
        if (argsStr) args = JSON.parse(argsStr) as { text?: string; selector?: string };
      } catch {
        /* leave args {} */
      }
      const tabs = await new Promise<chrome.tabs.Tab[]>((r) =>
        chrome.tabs.query({ active: true, currentWindow: true }, r)
      );
      const tabId = tabs[0]?.id;
      if (tabId == null) {
        const raw = "No active tab. Open the page where you want to click, then try again.";
        await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
          name: tc.name,
          serverName: "page",
          args: argsStr
        });
        continue;
      }
      const response = await new Promise<{ ok?: boolean; error?: string; message?: string }>((resolve) => {
        chrome.tabs.sendMessage(
          tabId,
          { type: "PAGE_CLICK", payload: args },
          (res: { ok?: boolean; error?: string; message?: string } | undefined) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message ?? "Content script not ready. Reload the page." });
            } else {
              resolve(res ?? { ok: false, error: "No response" });
            }
          }
        );
      });
      const raw = response.ok ? (response.message ?? "Clicked") : (response.error ?? "Failed");
      const content = await appendFinalizedToolMessage(
        finalizeToolContent,
        tc,
        raw,
        messages,
        results,
        { name: tc.name, serverName: "page", args: argsStr }
      );
      pageToolResultByKey.set(key, content);
      continue;
    }
    if (tc.name === "page_fill") {
      const key = `page_fill:${argsStr}`;
      const cached = pageToolResultByKey.get(key);
      if (cached != null) {
        messages.push({ role: "tool", tool_call_id: tc.id, content: cached });
        continue;
      }
      let args: { field?: string; selector?: string; value?: string } = {};
      try {
        if (argsStr) args = JSON.parse(argsStr) as { field?: string; selector?: string; value?: string };
      } catch {
        /* leave args {} */
      }
      const tabs = await new Promise<chrome.tabs.Tab[]>((r) =>
        chrome.tabs.query({ active: true, currentWindow: true }, r)
      );
      const tabId = tabs[0]?.id;
      if (tabId == null) {
        const raw = "No active tab. Open the page where you want to fill the field, then try again.";
        await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
          name: tc.name,
          serverName: "page",
          args: argsStr
        });
        continue;
      }
      const response = await new Promise<{ ok?: boolean; error?: string; message?: string }>((resolve) => {
        chrome.tabs.sendMessage(
          tabId,
          { type: "PAGE_FILL", payload: args },
          (res: { ok?: boolean; error?: string; message?: string } | undefined) => {
            if (chrome.runtime.lastError) {
              resolve({
                ok: false,
                error: chrome.runtime.lastError.message ?? "Content script not ready. Reload the page."
              });
            } else {
              resolve(res ?? { ok: false, error: "No response" });
            }
          }
        );
      });
      const raw = response.ok ? (response.message ?? "Filled") : (response.error ?? "Failed");
      const content = await appendFinalizedToolMessage(
        finalizeToolContent,
        tc,
        raw,
        messages,
        results,
        { name: tc.name, serverName: "page", args: argsStr }
      );
      pageToolResultByKey.set(key, content);
      continue;
    }
    if (tc.name === "page_navigate") {
      let args: { url?: string } = {};
      try {
        if (argsStr) args = JSON.parse(argsStr) as { url?: string };
      } catch {
        /* leave args {} */
      }
      const url = (args.url ?? "").trim();
      if (!url) {
        const raw = "Missing url for page_navigate.";
        await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
          name: tc.name,
          serverName: "page",
          args: argsStr
        });
        continue;
      }
      const tabs = await new Promise<chrome.tabs.Tab[]>((r) =>
        chrome.tabs.query({ active: true, currentWindow: true }, r)
      );
      const tabId = tabs[0]?.id;
      if (tabId == null) {
        const raw = "No active tab. Open a tab where you want to navigate and try again.";
        await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
          name: tc.name,
          serverName: "page",
          args: argsStr
        });
        continue;
      }
      const response = await new Promise<{ ok?: boolean; error?: string; message?: string }>(
        (resolve) => {
          chrome.tabs.sendMessage(
            tabId,
            { type: "PAGE_NAVIGATE", payload: { url } },
            (res: { ok?: boolean; error?: string; message?: string } | undefined) => {
              if (chrome.runtime.lastError) {
                resolve({
                  ok: false,
                  error:
                    chrome.runtime.lastError.message ??
                    "Content script not ready. Reload the page."
                });
              } else {
                resolve(res ?? { ok: false, error: "No response" });
              }
            }
          );
        }
      );
      const raw = response.ok ? (response.message ?? "Navigated") : (response.error ?? "Failed");
      await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
        name: tc.name,
        serverName: "page",
        args: argsStr
      });
      continue;
    }
    if (tc.name === "web_search") {
      let args: { query?: string; engine?: string } = {};
      try {
        if (argsStr) args = JSON.parse(argsStr) as { query?: string; engine?: string };
      } catch {
        /* leave args {} */
      }
      const query = (args.query ?? "").trim();
      if (!query) {
        const raw = "Missing search query.";
        await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
          name: tc.name,
          serverName: "web",
          args: argsStr
        });
        continue;
      }
      const engineKey = (args.engine ?? "duckduckgo").toLowerCase();
      const buildUrl = WEB_SEARCH_ENGINES[engineKey] ?? WEB_SEARCH_ENGINES.duckduckgo;
      const url = buildUrl(query);
      try {
        await chrome.tabs.create({ url });
        const raw = `Opened search in new tab (${engineKey}).`;
        await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
          name: tc.name,
          serverName: "web",
          args: argsStr
        });
      } catch (err) {
        const raw = (err instanceof Error ? err.message : String(err)) || "Failed to open tab.";
        await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
          name: tc.name,
          serverName: "web",
          args: argsStr
        });
      }
      continue;
    }
    const binding = toolToServer.get(tc.name);
    if (!binding) {
      const raw = `Error: unknown tool "${tc.name}"`;
      await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
        name: tc.name,
        args: argsStr
      });
      continue;
    }
    let args: Record<string, unknown> = {};
    try {
      if (argsStr) args = JSON.parse(tc.arguments) as Record<string, unknown>;
    } catch {
      // leave args {}
    }
    const callResult = await callMcpTool(
      binding.serverUrl,
      tc.name,
      args,
      { headers: binding.headers }
    );
    const raw = "error" in callResult ? callResult.error : callResult.text;
    await appendFinalizedToolMessage(finalizeToolContent, tc, raw, messages, results, {
      name: tc.name,
      serverName: binding.serverName,
      args: argsStr
    });
    } finally {
      hooks?.onToolEnd?.(tc);
    }
  }
  return results;
}

/**
 * Стриминг с MCP: цикл (стрим -> при tool_calls выполняем инструменты -> снова стрим) с передачей чанков в port.
 * Отправляет reasoning_step после каждого раунда с tool_calls, чтобы UI сохранял все размышления и вызовы.
 */
async function runAgentStreamWithMcpTools(
  userMessage: string,
  toolsContext: {
    mcpLoaded: McpToolsLoadResult;
    browserTools: OpenAITool[];
    systemPrompt: string;
    orchestrator: OrchestratorSyncSettings;
  },
  port: chrome.runtime.Port,
  signal?: AbortSignal
): Promise<{ text: string; reasoningSteps: ReasoningStep[] } | { error: string }> {
  const { mcpLoaded: loaded, browserTools, systemPrompt, orchestrator } = toolsContext;
  const finalizeToolContent = createToolContentFinalizer(orchestrator, signal);
  let { tools, toolToServer } = loaded;
  if (tools.length === 0 && loaded.mcpConfigured) {
    tools = [MCP_DIAGNOSE_TOOL];
    toolToServer = new Map();
  }
  const builtins = [...browserTools, WEB_SEARCH_TOOL];
  const openAITools: OpenAITool[] =
    tools.length > 0 ? [...tools, ...builtins] : builtins.length > 0 ? builtins : [];
  if (tools.length === 0) {
    toolToServer = new Map();
  }
  if (openAITools.length === 0) {
    const result = await chatWithLLMStream(
      [{ role: "user", content: userMessage }],
      { systemPrompt, onChunk: (text) => safePortPost(port, { type: "chunk", text }), signal }
    );
    if ("error" in result) return result;
    const steps: ReasoningStep[] =
      result.thinking != null && result.thinking !== ""
        ? [{ type: "thinking", text: result.thinking }]
        : [];
    return { text: result.text, reasoningSteps: steps };
  }
  const toolCatalogMarkdown = buildEnrichedToolCatalogMarkdown(openAITools, toolToServer);
  return orchestrateStreamingAgent(
    userMessage,
    {
      systemPrompt,
      tools: openAITools,
      toolToServer,
      signal
    },
    {
      maxIterations: orchestrator.orchestratorMaxToolIterations,
      hasBrowserTools: browserTools.length > 0,
      narrowToolsToRelevance: orchestrator.orchestratorNarrowToolsToRelevance,
      onChunk: (text) => safePortPost(port, { type: "chunk", text }),
      callLlmWithTools: (messages, opts) =>
        chatWithLLMStreamWithTools(messages, {
          systemPrompt: opts.systemPrompt,
          tools: opts.tools,
          onChunk: opts.onChunk,
          signal: opts.signal
        }),
      executeTools: (calls, map, msgs) =>
        executeToolCallsAndAppendMessages(calls, map, msgs, finalizeToolContent, {
          onToolStart: (tc) =>
            safePortPost(port, {
              type: "tool_exec",
              phase: "start",
              toolCallId: tc.id,
              name: tc.name
            }),
          onToolEnd: (tc) =>
            safePortPost(port, { type: "tool_exec", phase: "end", toolCallId: tc.id, name: tc.name })
        }),
      onToolRoundComplete: (steps) => {
        safePortPost(port, { type: "reasoning_step", steps });
      },
      subtasks: createDefaultOrchestratorSubtasks(orchestrator, signal, toolCatalogMarkdown)
    }
  );
}

/**
 * Run chat with MCP tools (non-stream path, for CHAT_MESSAGE): load enabled tools, loop until text or error.
 */
async function runAgentWithMcpTools(
  userMessage: string,
  toolsContext: {
    mcpLoaded: McpToolsLoadResult;
    browserTools: OpenAITool[];
    systemPrompt: string;
    orchestrator: OrchestratorSyncSettings;
  }
): Promise<{ text: string } | { error: string }> {
  const { mcpLoaded: loaded, browserTools, systemPrompt, orchestrator } = toolsContext;
  const finalizeToolContent = createToolContentFinalizer(orchestrator);
  let { tools, toolToServer } = loaded;
  if (tools.length === 0 && loaded.mcpConfigured) {
    tools = [MCP_DIAGNOSE_TOOL];
    toolToServer = new Map();
  }
  const builtinsForAgent = [...browserTools, WEB_SEARCH_TOOL];
  const openAIToolsForAgent: OpenAITool[] =
    tools.length > 0 ? [...tools, ...builtinsForAgent] : builtinsForAgent.length > 0 ? builtinsForAgent : [];
  if (tools.length === 0) {
    toolToServer = new Map();
  }
  if (openAIToolsForAgent.length === 0) {
    const result = await chatWithLLM([{ role: "user", content: userMessage }], {
      systemPrompt
    });
    if ("error" in result) return result;
    return { text: result.text };
  }

  const toolCatalogMarkdownSync = buildEnrichedToolCatalogMarkdown(openAIToolsForAgent, toolToServer);
  return orchestrateSyncAgent(
    userMessage,
    {
      systemPrompt,
      tools: openAIToolsForAgent,
      toolToServer
    },
    {
      maxIterations: orchestrator.orchestratorMaxToolIterations,
      hasBrowserTools: browserTools.length > 0,
      narrowToolsToRelevance: orchestrator.orchestratorNarrowToolsToRelevance,
      callLlmOneRound: (messages, opts) =>
        chatWithLLMOneRound(messages, {
          systemPrompt: opts.systemPrompt,
          tools: opts.tools
        }),
      executeTools: (calls, map, msgs) =>
        executeToolCallsAndAppendMessages(calls, map, msgs, finalizeToolContent),
      subtasks: createDefaultOrchestratorSubtasks(orchestrator, undefined, toolCatalogMarkdownSync)
    }
  );
}

const PING_RUNNER_URL = "ping-runner.html";

/** Открыть offscreen-документ для пингов (невидимый, сбрасывает 30s idle таймер SW). */
async function openStreamKeepaliveOffscreen(): Promise<boolean> {
  try {
    const offscreenUrl = chrome.runtime.getURL(PING_RUNNER_URL);
    const existing = await chrome.runtime.getContexts?.({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [offscreenUrl]
    });
    if (Array.isArray(existing) && existing.length > 0) return true;
    await chrome.offscreen.createDocument({
      url: PING_RUNNER_URL,
      reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
      justification: "Keepalive for long-running chat stream"
    });
    return true;
  } catch {
    return false;
  }
}

async function closeStreamKeepaliveOffscreen(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    /* уже закрыт или не открывался */
  }
}

const CHAT_READY_NOTIFICATION_PREFIX = "pageai-chat-ready-";

/** Показать уведомление о готовности ответа (popup был закрыт, ответ сохранён в чат). */
function showChatReadyNotification(): void {
  const api = chrome.notifications;
  if (!api?.create) return;
  const id = CHAT_READY_NOTIFICATION_PREFIX + Date.now();
  const iconUrl = chrome.runtime.getURL("icons/icon128.png");
  const title = chrome.i18n.getMessage("notificationChatReadyTitle") || "PageAI";
  const message = chrome.i18n.getMessage("notificationChatReadyBody") || "Answer is ready. Open the extension to view.";
  const options: chrome.notifications.NotificationOptions<true> = {
    type: "basic",
    iconUrl,
    title,
    message,
    priority: 1
  };
  try {
    api.create(id, options, (_createdId: string | undefined) => {
      if (chrome.runtime.lastError) {
        console.warn("[PageAI] Notification create failed:", chrome.runtime.lastError.message);
      }
    });
  } catch (e) {
    console.warn("[PageAI] Notification create threw:", e);
  }
}

chrome.notifications.onClicked.addListener((notificationId: string) => {
  if (!notificationId.startsWith(CHAT_READY_NOTIFICATION_PREFIX)) return;
  chrome.action.openPopup?.();
});

/** Очередь задач чата: до MAX_CONCURRENT_CHAT_TASKS выполняются параллельно, остальные ждут. */
const MAX_CONCURRENT_CHAT_TASKS = 2;
interface ChatStreamTask {
  id: string;
  queryText: string;
  port: chrome.runtime.Port;
  abortController: AbortController;
}
const chatTaskQueue: ChatStreamTask[] = [];
let activeChatTasks = 0;

async function runOneChatStreamTask(task: ChatStreamTask): Promise<void> {
  const { port, queryText, abortController } = task;
  let keepaliveOffscreenOpened = false;
  try {
    keepaliveOffscreenOpened = await openStreamKeepaliveOffscreen();

    let userMessage = queryText;
    let sourcesForDone: { title: string; url: string }[] | undefined;

    if (isQuestionAboutCurrentPage(queryText)) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0] || !tabs[0].id) {
        safePortPost(port, { type: "error", error: "No active tab found" });
        return;
      }
      let currentPageResponse: GetCurrentPageResponse;
      try {
        currentPageResponse = await getCurrentPageWithRetry(tabs[0].id);
      } catch (err) {
        safePortPost(port, { type: "error", error: (err as Error).message || PAGE_LOAD_ERROR });
        return;
      }
      if (!currentPageResponse.ok || !currentPageResponse.page) {
        safePortPost(port, { type: "error", error: currentPageResponse.error || "Could not get current page." });
        return;
      }
      const currentPage = currentPageResponse.page;
      userMessage = buildSummaryPrompt([currentPage], queryText);
      sourcesForDone = [{ title: currentPage.title, url: currentPage.url }];
    }

    const { mcpLoaded, browserTools, systemPrompt, orchestrator } = await loadAgentToolsAndPrompt();
    const hasAnyTools = mcpLoaded.tools.length > 0 || browserTools.length > 0;

    if (hasAnyTools) {
      const result = await runAgentStreamWithMcpTools(
        userMessage,
        { mcpLoaded, browserTools, systemPrompt, orchestrator },
        port,
        abortController.signal
      );
      if ("error" in result) {
        safePortPost(port, { type: "error", error: result.error });
        return;
      }
      const doneMessage: ChatMessage = {
        role: "assistant",
        content: result.text,
        timestamp: new Date().toISOString(),
        ...(result.reasoningSteps.length > 0 ? { reasoningSteps: result.reasoningSteps } : {}),
        ...(sourcesForDone ? { sources: sourcesForDone } : {}),
        orchestrationMetrics: result.metrics
      };
      const sentMcp = tryPortPost(port, { type: "done", message: doneMessage });
      if (!sentMcp) {
        await storage.saveChatMessage(doneMessage);
        showChatReadyNotification();
      }
      return;
    }

    const result = await chatWithLLMStream(
      [{ role: "user", content: userMessage }],
      {
        systemPrompt,
        onChunk: (text: string) => safePortPost(port, { type: "chunk", text }),
        signal: abortController.signal
      }
    );
    if ("error" in result) {
      safePortPost(port, { type: "error", error: result.error });
      return;
    }
    const doneMsg: ChatMessage = {
      role: "assistant",
      content: result.text,
      timestamp: new Date().toISOString(),
      ...(result.thinking != null && result.thinking !== "" ? { thinking: result.thinking } : {}),
      ...(sourcesForDone ? { sources: sourcesForDone } : {})
    };
    const sentStream = tryPortPost(port, { type: "done", message: doneMsg });
    if (!sentStream) {
      await storage.saveChatMessage(doneMsg);
      showChatReadyNotification();
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    safePortPost(port, { type: "error", error: (error as Error).message });
  } finally {
    if (keepaliveOffscreenOpened) {
      await closeStreamKeepaliveOffscreen();
    }
    activeChatTasks -= 1;
    if (chatTaskQueue.length > 0) {
      const next = chatTaskQueue.shift()!;
      activeChatTasks += 1;
      void runOneChatStreamTask(next);
    }
  }
}

function enqueueChatStreamTask(task: ChatStreamTask): void {
  if (activeChatTasks < MAX_CONCURRENT_CHAT_TASKS) {
    activeChatTasks += 1;
    void runOneChatStreamTask(task);
  } else {
    chatTaskQueue.push(task);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "pageai-stream-keepalive") {
    port.onMessage.addListener(() => { /* пинги от ping-runner окна — только сброс idle таймера SW */ });
    return;
  }
  if (port.name !== "pageai-chat-stream") return;
  const abortController = new AbortController();
  port.onMessage.addListener((msg: { type: string; payload?: { text: string } }) => {
    if (msg.type === "ping") return;
    if (msg.type === "STOP_STREAM") {
      abortController.abort();
      return;
    }
    if (msg.type !== "CHAT_STREAM_REQUEST" || !msg.payload?.text?.trim()) {
      safePortPost(port, { type: "error", error: "Invalid request" });
      return;
    }
    const queryText = msg.payload.text.trim();
    const task: ChatStreamTask = {
      id: `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      queryText,
      port,
      abortController
    };
    enqueueChatStreamTask(task);
  });
});

chrome.runtime.onMessage.addListener((message: MessageFromContent | MessageFromPanel | { type: string }, _sender, sendResponse) => {
  (async () => {
    if (message.type === "PAGE_INDEX") {
      const msg = message as Extract<MessageFromContent, { type: "PAGE_INDEX" }>;
      await storage.savePage(msg.payload);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CHAT_MESSAGE_CURRENT_PAGE") {
      const msg = message as MessageFromPanel & { type: "CHAT_MESSAGE_CURRENT_PAGE" };
      const queryText = msg.payload.text?.trim() ?? "";

      try {
        // Парсим текущую страницу только если в вопросе явно просят про неё
        if (!isQuestionAboutCurrentPage(queryText)) {
          const { mcpLoaded, browserTools, systemPrompt, orchestrator } = await loadAgentToolsAndPrompt();
          const hasAnyTools = mcpLoaded.tools.length > 0 || browserTools.length > 0;

          const result = hasAnyTools
            ? await runAgentWithMcpTools(queryText, { mcpLoaded, browserTools, systemPrompt, orchestrator })
            : await chatWithLLM([{ role: "user", content: queryText }], { systemPrompt });

          if ("error" in result) {
            sendResponse({ ok: false, error: result.error });
            return;
          }
          const { text: finalText, thinking } = parseThinkingFromText(result.text);
          sendResponse({
            ok: true,
            message: {
              role: "assistant",
              content: finalText,
              timestamp: new Date().toISOString(),
              ...(thinking != null && thinking !== "" ? { thinking } : {}),
              ...(hasAnyTools && "metrics" in result ? { orchestrationMetrics: result.metrics } : {})
            }
          });
          return;
        }

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0] || !tabs[0].id) {
          sendResponse({ ok: false, error: "No active tab found" });
          return;
        }

        const tabId = tabs[0].id;
        let currentPageResponse: GetCurrentPageResponse;
        try {
          currentPageResponse = await getCurrentPageWithRetry(tabId);
        } catch (err) {
          sendResponse({ ok: false, error: (err as Error).message || PAGE_LOAD_ERROR });
          return;
        }

        if (!currentPageResponse.ok || !currentPageResponse.page) {
          const errorMsg = currentPageResponse.error || "Could not get current page. Wait for the page to load or try another page.";
          sendResponse({ ok: false, error: errorMsg });
          return;
        }

        const currentPage = currentPageResponse.page;

        const summary = await summarizePages([currentPage], {
          pageIds: [currentPage.id],
          query: queryText
        });

        if ("error" in summary) {
          sendResponse({ ok: false, error: summary.error });
          return;
        }

        const chatResponse: ChatMessage = {
          role: "assistant",
          content: summary.text,
          timestamp: new Date().toISOString(),
          sources: [{ title: currentPage.title, url: currentPage.url }]
        };

        sendResponse({ ok: true, message: chatResponse });
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes("Could not establish connection")) {
          sendResponse({ ok: false, error: "Please reload the page and try again, or open the assistant on the tab you want to ask about." });
        } else {
          sendResponse({ ok: false, error: errorMessage });
        }
      }
      return;
    }

    if (message.type === "SUMMARIZE") {
      const msg = message as MessageFromPanel & { type: "SUMMARIZE" };
      const pages = await storage.getPagesByIds(msg.payload.pageIds);
      const summary = await summarizePages(pages, msg.payload);
      sendResponse({ ok: true, summary });
      return;
    }

    if (message.type === "OPEN_SIDE_PANEL") {
      try {
        if (chrome.sidePanel) {
          try {
            const win = await chrome.windows.getCurrent();
            if (win?.id != null) {
              await chrome.sidePanel.setOptions({ path: "panel.html" });
              await chrome.sidePanel.open({ windowId: win.id });
            }
            sendResponse({ ok: true });
          } catch {
            sendResponse({ ok: false, error: "Side panel disabled, fallback to popup" });
          }
        } else {
          sendResponse({ ok: false, error: "Side panel not supported" });
        }
      } catch {
        sendResponse({ ok: false, error: "Side panel not available" });
      }
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  return true;
});
