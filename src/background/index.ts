import { MessageFromContent, MessageFromPanel, ChatMessage, Page, type ReasoningStep } from "../types/messages";
import { Storage } from "../storage/indexdb";
import { summarizePages, chatWithLLM, chatWithLLMStream, chatWithLLMStreamWithTools, chatWithLLMOneRound, type LlmMessageForApi } from "../llm/client";
import { buildSummaryPrompt } from "../llm/prompts";
import { getEnabledMcpToolsWithMap, type OpenAITool } from "../mcp/agent-tools";
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

/** Клик по элементу на текущей вкладке. */
const PAGE_CLICK_TOOL: OpenAITool = {
  type: "function",
  function: {
    name: "page_click",
    description:
      "User wants to activate something on the page: click, press, open, submit. Use for buttons, links, tabs, any clickable. Pass visible text or selector.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Visible text/label of element (e.g. 'Submit', 'Войти')"
        },
        selector: {
          type: "string",
          description: "CSS selector if text is ambiguous"
        }
      }
    }
  }
};

/** Ввод текста в поле на странице. */
const PAGE_FILL_TOOL: OpenAITool = {
  type: "function",
  function: {
    name: "page_fill",
    description:
      "User wants to put text into a field: type, write, fill, insert, paste. Use for search, comment, form inputs, any input/textarea. Infer field from context (search, comment, query, etc.).",
    parameters: {
      type: "object",
      properties: {
        field: {
          type: "string",
          description: "How to find field: placeholder/label/name (e.g. search, comment, query, поиск, запрос)"
        },
        selector: {
          type: "string",
          description: "CSS selector if needed"
        },
        value: {
          type: "string",
          description: "Text to put in the field"
        }
      },
      required: ["value"]
    }
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
  return `Tools failed to load.\nErrors:\n${errs}\n\nSuggest: 1) Start 1C configurator (1c -config [path] -start); 2) Verify MCP server is running; 3) Check Settings → MCP.`;
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

const MAX_AGENT_TOOL_ITERATIONS = 5;

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
  basePrompt: string
): string {
  if (loaded.tools.length > 0) {
    const toolList = loaded.tools
      .map((t) => `${t.function.name}${t.function.description ? ": " + t.function.description : ""}`)
      .join("; ");
    return `${basePrompt}

[TOOLS] ${toolList}

[INTENT] Infer from natural language. Click/press/activate on page → page_click. Type/write/fill into a field → page_fill (field: search/comment/поиск/запрос, value: text). Search the web/look up/find online → web_search (query, optional engine: duckduckgo|google|yandex). Use tool_calls; no exact wording needed.`;
  }
  if (loaded.mcpConfigured) {
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

/** Результат одного вызова инструмента для отображения в цепочке рассуждений. */
export interface ToolCallResult {
  name: string;
  serverName?: string;
  args: string;
  result: string;
}

/**
 * Парсит из текста ответа модели вызовы в XML-подобном формате
 * (<function=name> <parameter=key>value</parameter> ... </function>)
 * и возвращает массив tool_calls для выполнения.
 */
function parseXmlStyleToolCalls(
  text: string
): Array<{ id: string; name: string; arguments: string }> {
  const out: Array<{ id: string; name: string; arguments: string }> = [];
  const seenKeys = new Set<string>();
  const funcRegex = /<function=(\w+)>([\s\S]*?)<\/function>/gi;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = funcRegex.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    if (name !== "page_click" && name !== "page_fill" && name !== "web_search") continue;
    const inner = m[2];
    const args: Record<string, string> = {};
    const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = paramRegex.exec(inner)) !== null) {
      args[pm[1].toLowerCase()] = pm[2].trim();
    }
    if (Object.keys(args).length === 0) continue;
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
 * Выполнить один раунд вызовов MCP по tool_calls и добавить сообщения в массив.
 * Возвращает список { name, args, result } для отображения в UI.
 */
async function executeToolCallsAndAppendMessages(
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  toolToServer: Map<string, { serverUrl: string; headers?: Record<string, string>; serverName: string }>,
  messages: LlmMessageForApi[]
): Promise<ToolCallResult[]> {
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
  const results: ToolCallResult[] = [];
  /** Повторные одинаковые page_click/page_fill не выполняем дважды — подставляем результат первого. */
  const pageToolResultByKey = new Map<string, string>();
  for (const tc of toolCalls) {
    const argsStr = tc.arguments?.trim() ?? "";
    if (tc.name === "mcp_diagnose") {
      const content = await runMcpDiagnose();
      messages.push({ role: "tool", tool_call_id: tc.id, content });
      results.push({ name: tc.name, args: argsStr, result: content });
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
        const content = "No active tab. Open the page where you want to click, then try again.";
        messages.push({ role: "tool", tool_call_id: tc.id, content });
        results.push({ name: tc.name, serverName: "page", args: argsStr, result: content });
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
      const content = response.ok ? (response.message ?? "Clicked") : (response.error ?? "Failed");
      pageToolResultByKey.set(key, content);
      messages.push({ role: "tool", tool_call_id: tc.id, content });
      results.push({ name: tc.name, serverName: "page", args: argsStr, result: content });
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
        const content = "No active tab. Open the page where you want to fill the field, then try again.";
        messages.push({ role: "tool", tool_call_id: tc.id, content });
        results.push({ name: tc.name, serverName: "page", args: argsStr, result: content });
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
      const content = response.ok ? (response.message ?? "Filled") : (response.error ?? "Failed");
      pageToolResultByKey.set(key, content);
      messages.push({ role: "tool", tool_call_id: tc.id, content });
      results.push({ name: tc.name, serverName: "page", args: argsStr, result: content });
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
        const content = "Missing search query.";
        messages.push({ role: "tool", tool_call_id: tc.id, content });
        results.push({ name: tc.name, serverName: "web", args: argsStr, result: content });
        continue;
      }
      const engineKey = (args.engine ?? "duckduckgo").toLowerCase();
      const buildUrl = WEB_SEARCH_ENGINES[engineKey] ?? WEB_SEARCH_ENGINES.duckduckgo;
      const url = buildUrl(query);
      try {
        await chrome.tabs.create({ url });
        const content = `Opened search in new tab (${engineKey}).`;
        messages.push({ role: "tool", tool_call_id: tc.id, content });
        results.push({ name: tc.name, serverName: "web", args: argsStr, result: content });
      } catch (err) {
        const content = (err instanceof Error ? err.message : String(err)) || "Failed to open tab.";
        messages.push({ role: "tool", tool_call_id: tc.id, content });
        results.push({ name: tc.name, serverName: "web", args: argsStr, result: content });
      }
      continue;
    }
    const binding = toolToServer.get(tc.name);
    if (!binding) {
      const content = `Error: unknown tool "${tc.name}"`;
      messages.push({ role: "tool", tool_call_id: tc.id, content });
      results.push({ name: tc.name, args: argsStr, result: content });
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
    const content = "error" in callResult ? callResult.error : callResult.text;
    messages.push({ role: "tool", tool_call_id: tc.id, content });
    results.push({
      name: tc.name,
      serverName: binding.serverName,
      args: argsStr,
      result: content
    });
  }
  return results;
}

/**
 * Стриминг с MCP: цикл (стрим -> при tool_calls выполняем инструменты -> снова стрим) с передачей чанков в port.
 * Отправляет reasoning_step после каждого раунда с tool_calls, чтобы UI сохранял все размышления и вызовы.
 */
async function runAgentStreamWithMcpTools(
  userMessage: string,
  systemPrompt: string,
  port: chrome.runtime.Port,
  signal?: AbortSignal
): Promise<{ text: string; reasoningSteps: ReasoningStep[] } | { error: string }> {
  const loaded = await getEnabledMcpToolsWithMap();
  if ("error" in loaded) return { error: loaded.error };
  let { tools, toolToServer } = loaded;
  if (tools.length === 0 && loaded.mcpConfigured) {
    tools = [MCP_DIAGNOSE_TOOL];
    toolToServer = new Map();
  }
  const { browserAutomationEnabled } = await new Promise<{ browserAutomationEnabled: boolean }>((r) =>
    chrome.storage.sync.get({ browserAutomationEnabled: false }, r)
  );
  const pageTools: OpenAITool[] = browserAutomationEnabled ? [PAGE_CLICK_TOOL, PAGE_FILL_TOOL] : [];
  const builtins = [...pageTools, WEB_SEARCH_TOOL];
  const openAITools: OpenAITool[] =
    tools.length > 0 ? [...tools, ...builtins] : builtins.length > 0 ? builtins : [];
  if (tools.length === 0) {
    toolToServer = new Map();
  }
  if (openAITools.length === 0) {
    const promptWithStatus = buildSystemPromptWithToolStatus(loaded, systemPrompt);
    const result = await chatWithLLMStream(
      [{ role: "user", content: userMessage }],
      { systemPrompt: promptWithStatus, onChunk: (text) => safePortPost(port, { type: "chunk", text }), signal }
    );
    if ("error" in result) return result;
    const steps: ReasoningStep[] =
      result.thinking != null && result.thinking !== ""
        ? [{ type: "thinking", text: result.thinking }]
        : [];
    return { text: result.text, reasoningSteps: steps };
  }
  const systemPromptWithTools = buildSystemPromptWithToolStatus(loaded, systemPrompt);
  const messages: LlmMessageForApi[] = [{ role: "user", content: userMessage }];
  const reasoningSteps: ReasoningStep[] = [];

  for (let i = 0; i < MAX_AGENT_TOOL_ITERATIONS; i++) {
    const result = await chatWithLLMStreamWithTools(messages, {
      systemPrompt: systemPromptWithTools,
      tools: openAITools,
      onChunk: (text) => safePortPost(port, { type: "chunk", text }),
      signal
    });

    if ("error" in result) return result;
    if (!("tool_calls" in result) || !result.tool_calls || result.tool_calls.length === 0) {
      const xmlCalls =
        browserAutomationEnabled ? parseXmlStyleToolCalls(result.text ?? "") : [];
      if (xmlCalls.length > 0) {
        const roundSteps: ReasoningStep[] = [];
        if (result.thinking != null && result.thinking !== "") {
          reasoningSteps.push({ type: "thinking", text: result.thinking });
          roundSteps.push({ type: "thinking", text: result.thinking });
        }
        const toolResults = await executeToolCallsAndAppendMessages(
          xmlCalls,
          toolToServer,
          messages
        );
        for (const tr of toolResults) {
          const serverName =
            tr.serverName != null && String(tr.serverName).trim() !== ""
              ? String(tr.serverName).trim()
              : "mcp";
          const step: ReasoningStep = {
            type: "tool_call",
            name: tr.name,
            serverName,
            args: tr.args || undefined,
            result: tr.result
          };
          reasoningSteps.push(step);
          roundSteps.push(step);
        }
        safePortPost(port, { type: "reasoning_step", steps: roundSteps });
        const summary = toolResults.map((r) => r.result).join(". ");
        return { text: summary || result.text, reasoningSteps };
      }
      if (result.thinking != null && result.thinking !== "") {
        reasoningSteps.push({ type: "thinking", text: result.thinking });
      }
      return { text: result.text, reasoningSteps };
    }

    const roundSteps: ReasoningStep[] = [];
    if (result.thinking != null && result.thinking !== "") {
      reasoningSteps.push({ type: "thinking", text: result.thinking });
      roundSteps.push({ type: "thinking", text: result.thinking });
    }
    const toolResults = await executeToolCallsAndAppendMessages(result.tool_calls, toolToServer, messages);
    for (const tr of toolResults) {
      const serverName = (tr.serverName != null && String(tr.serverName).trim() !== "")
        ? String(tr.serverName).trim()
        : "mcp";
      const step: ReasoningStep = {
        type: "tool_call",
        name: tr.name,
        serverName,
        args: tr.args || undefined,
        result: tr.result
      };
      reasoningSteps.push(step);
      roundSteps.push(step);
    }
    safePortPost(port, { type: "reasoning_step", steps: roundSteps });
  }

  return { error: "Agent reached max tool iterations without final answer" };
}

/**
 * Run chat with MCP tools (non-stream path, for CHAT_MESSAGE): load enabled tools, loop until text or error.
 */
async function runAgentWithMcpTools(
  userMessage: string,
  systemPrompt: string
): Promise<{ text: string } | { error: string }> {
  const loaded = await getEnabledMcpToolsWithMap();
  if ("error" in loaded) return { error: loaded.error };
  let { tools, toolToServer } = loaded;
  if (tools.length === 0 && loaded.mcpConfigured) {
    tools = [MCP_DIAGNOSE_TOOL];
    toolToServer = new Map();
  }
  const { browserAutomationEnabled } = await new Promise<{ browserAutomationEnabled: boolean }>((r) =>
    chrome.storage.sync.get({ browserAutomationEnabled: false }, r)
  );
  const pageToolsForAgent: OpenAITool[] = browserAutomationEnabled ? [PAGE_CLICK_TOOL, PAGE_FILL_TOOL] : [];
  const builtinsForAgent = [...pageToolsForAgent, WEB_SEARCH_TOOL];
  const openAIToolsForAgent: OpenAITool[] =
    tools.length > 0 ? [...tools, ...builtinsForAgent] : builtinsForAgent.length > 0 ? builtinsForAgent : [];
  if (tools.length === 0) {
    toolToServer = new Map();
  }
  if (openAIToolsForAgent.length === 0) {
    const promptWithStatus = buildSystemPromptWithToolStatus(loaded, systemPrompt);
    const result = await chatWithLLM([{ role: "user", content: userMessage }], {
      systemPrompt: promptWithStatus
    });
    if ("error" in result) return result;
    return { text: result.text };
  }

  const systemPromptWithTools = buildSystemPromptWithToolStatus(loaded, systemPrompt);
  const messages: LlmMessageForApi[] = [{ role: "user", content: userMessage }];

  for (let i = 0; i < MAX_AGENT_TOOL_ITERATIONS; i++) {
    const result = await chatWithLLMOneRound(messages, {
      systemPrompt: systemPromptWithTools,
      tools: openAIToolsForAgent
    });

    if ("error" in result) return result;
    if ("text" in result) {
      const xmlCalls =
        browserAutomationEnabled ? parseXmlStyleToolCalls(result.text) : [];
      if (xmlCalls.length > 0) {
        const toolResults = await executeToolCallsAndAppendMessages(
          xmlCalls,
          toolToServer,
          messages
        );
        const summary = toolResults.map((r) => r.result).join(". ");
        return { text: summary || result.text };
      }
      return { text: result.text };
    }

    const toolCalls = result.tool_calls;
    if (!toolCalls || toolCalls.length === 0) break;
    await executeToolCallsAndAppendMessages(toolCalls, toolToServer, messages);
  }

  return { error: "Agent reached max tool iterations without final answer" };
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

    (async () => {
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

        const mcpLoaded = await getEnabledMcpToolsWithMap();
        const hasMcpTools = !("error" in mcpLoaded) && mcpLoaded.tools.length > 0;
        const systemPrompt = buildSystemPromptWithToolStatus(
          "error" in mcpLoaded ? { tools: [], mcpConfigured: false } : mcpLoaded,
          BASE_CHAT_SYSTEM_PROMPT
        );

        if (hasMcpTools) {
          const result = await runAgentStreamWithMcpTools(
            userMessage,
            systemPrompt,
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
            ...(sourcesForDone ? { sources: sourcesForDone } : {})
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
      }
    })();
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
          const mcpLoaded = await getEnabledMcpToolsWithMap();
          const hasMcpTools = !("error" in mcpLoaded) && mcpLoaded.tools.length > 0;
          const systemPrompt = buildSystemPromptWithToolStatus(
            "error" in mcpLoaded ? { tools: [], mcpConfigured: false } : mcpLoaded,
            BASE_CHAT_SYSTEM_PROMPT
          );

          const result = hasMcpTools
            ? await runAgentWithMcpTools(queryText, BASE_CHAT_SYSTEM_PROMPT)
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
              ...(thinking != null && thinking !== "" ? { thinking } : {})
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
