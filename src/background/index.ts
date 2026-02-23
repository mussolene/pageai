import { MessageFromContent, MessageFromPanel, ChatMessage, ConfluencePage, type ReasoningStep } from "../types/messages";
import { Storage } from "../storage/indexdb";
import { summarizePages, chatWithLLM, chatWithLLMStream, chatWithLLMStreamWithTools, chatWithLLMOneRound, type LlmMessageForApi } from "../llm/client";
import { getEnabledMcpToolsWithMap, type OpenAITool } from "../mcp/agent-tools";
import { callMcpTool } from "../mcp/client";

const storage = new Storage();

const PAGE_LOAD_ERROR = "Please wait for the page to load completely, then try again.";

/** Проверяет, спрашивает ли пользователь явно про текущую страницу. Только в этом случае парсим вкладку. */
function isQuestionAboutCurrentPage(text: string): boolean {
  const t = text.trim().toLowerCase();
  const phrases = [
    "этой страниц",
    "текущей страниц",
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
  page?: ConfluencePage;
  error?: string;
}

async function getCurrentPageWithRetry(tabId: number, maxAttempts = 3): Promise<GetCurrentPageResponse> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return (await chrome.tabs.sendMessage(tabId, { type: "GET_CURRENT_PAGE" })) as GetCurrentPageResponse;
    } catch {
      if (attempt === maxAttempts) throw new Error(PAGE_LOAD_ERROR);
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
  loaded: { tools: OpenAITool[]; mcpConfigured: boolean },
  basePrompt: string
): string {
  if (loaded.tools.length > 0) {
    const toolList = loaded.tools
      .map((t) => `${t.function.name}${t.function.description ? ": " + t.function.description : ""}`)
      .join("; ");
    return `${basePrompt}

[TOOLS CONNECTED] MCP tools are connected to this chat. You MUST use them when the user asks to send a notification, message, or to perform an action that a tool provides. Call tools via the tool_calls response format (OpenAI function calling). Do NOT say that tools are not connected — they are. Available tools: ${toolList}.`;
  }
  if (loaded.mcpConfigured) {
    return `${basePrompt}

[MCP CONFIGURED] The user has MCP tools configured in settings, but they could not be loaded (server may be unreachable). Do not say "tools are not connected to the chat" — they are configured; suggest checking that the MCP server is running and the URL is correct.`;
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
  for (const tc of toolCalls) {
    const binding = toolToServer.get(tc.name);
    const argsStr = tc.arguments?.trim() ?? "";
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
  port: chrome.runtime.Port
): Promise<{ text: string; reasoningSteps: ReasoningStep[] } | { error: string }> {
  const loaded = await getEnabledMcpToolsWithMap();
  if ("error" in loaded) return { error: loaded.error };
  const { tools, toolToServer } = loaded;
  if (tools.length === 0) {
    const promptWithStatus = buildSystemPromptWithToolStatus(loaded, systemPrompt);
    const result = await chatWithLLMStream(
      [{ role: "user", content: userMessage }],
      { systemPrompt: promptWithStatus, onChunk: (text) => safePortPost(port, { type: "chunk", text }) }
    );
    if ("error" in result) return result;
    const steps: ReasoningStep[] =
      result.thinking != null && result.thinking !== ""
        ? [{ type: "thinking", text: result.thinking }]
        : [];
    return { text: result.text, reasoningSteps: steps };
  }

  const openAITools: OpenAITool[] = tools;
  const systemPromptWithTools = buildSystemPromptWithToolStatus(loaded, systemPrompt);
  let messages: LlmMessageForApi[] = [{ role: "user", content: userMessage }];
  const reasoningSteps: ReasoningStep[] = [];

  for (let i = 0; i < MAX_AGENT_TOOL_ITERATIONS; i++) {
    const result = await chatWithLLMStreamWithTools(messages, {
      systemPrompt: systemPromptWithTools,
      tools: openAITools,
      onChunk: (text) => safePortPost(port, { type: "chunk", text })
    });

    if ("error" in result) return result;
    if (!("tool_calls" in result) || !result.tool_calls || result.tool_calls.length === 0) {
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
  const { tools, toolToServer } = loaded;
  if (tools.length === 0) {
    const promptWithStatus = buildSystemPromptWithToolStatus(loaded, systemPrompt);
    const result = await chatWithLLM([{ role: "user", content: userMessage }], {
      systemPrompt: promptWithStatus
    });
    if ("error" in result) return { error: result.error };
    return { text: result.text };
  }

  const openAITools: OpenAITool[] = tools;
  const systemPromptWithTools = buildSystemPromptWithToolStatus(loaded, systemPrompt);
  let messages: LlmMessageForApi[] = [{ role: "user", content: userMessage }];

  for (let i = 0; i < MAX_AGENT_TOOL_ITERATIONS; i++) {
    const result = await chatWithLLMOneRound(messages, {
      systemPrompt: systemPromptWithTools,
      tools: openAITools
    });

    if ("error" in result) return result;
    if ("text" in result) return { text: result.text };

    const toolCalls = result.tool_calls;
    if (!toolCalls || toolCalls.length === 0) break;
    await executeToolCallsAndAppendMessages(toolCalls, toolToServer, messages);
  }

  return { error: "Agent reached max tool iterations without final answer" };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "pageai-chat-stream") return;
  port.onMessage.addListener((msg: { type: string; payload?: { text: string } }) => {
    if (msg.type !== "CHAT_STREAM_REQUEST" || !msg.payload?.text?.trim()) {
      safePortPost(port, { type: "error", error: "Invalid request" });
      return;
    }
    const queryText = msg.payload.text.trim();

    (async () => {
      try {
        if (!isQuestionAboutCurrentPage(queryText)) {
          const mcpLoaded = await getEnabledMcpToolsWithMap();
          const hasMcpTools = !("error" in mcpLoaded) && mcpLoaded.tools.length > 0;
          const systemPrompt = buildSystemPromptWithToolStatus(
            "error" in mcpLoaded ? { tools: [], mcpConfigured: false } : mcpLoaded,
            BASE_CHAT_SYSTEM_PROMPT
          );

          if (hasMcpTools) {
            const result = await runAgentStreamWithMcpTools(
              queryText,
              BASE_CHAT_SYSTEM_PROMPT,
              port
            );
            if ("error" in result) {
              safePortPost(port, { type: "error", error: result.error });
              return;
            }
            const doneMessage: ChatMessage = {
              role: "assistant",
              content: result.text,
              timestamp: new Date().toISOString()
            };
            if (result.reasoningSteps.length > 0) {
              doneMessage.reasoningSteps = result.reasoningSteps;
            }
            safePortPost(port, { type: "done", message: doneMessage });
            return;
          }

          const result = await chatWithLLMStream(
            [{ role: "user", content: queryText }],
            {
              systemPrompt,
              onChunk: (text: string) => safePortPost(port, { type: "chunk", text })
            }
          );
          if ("error" in result) {
            safePortPost(port, { type: "error", error: result.error });
            return;
          }
          safePortPost(port, {
            type: "done",
            message: {
              role: "assistant",
              content: result.text,
              timestamp: new Date().toISOString(),
              ...(result.thinking != null && result.thinking !== "" ? { thinking: result.thinking } : {})
            }
          });
          return;
        }

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0] || !tabs[0].id) {
          safePortPost(port, { ok: false, error: "No active tab found" });
          return;
        }
        const tabId = tabs[0].id;
        let currentPageResponse: GetCurrentPageResponse;
        try {
          currentPageResponse = await getCurrentPageWithRetry(tabId);
        } catch (err) {
          safePortPost(port, { type: "error", error: (err as Error).message || PAGE_LOAD_ERROR });
          return;
        }
        if (!currentPageResponse.ok || !currentPageResponse.page) {
          const errorMsg = currentPageResponse.error || "Could not get current page.";
          safePortPost(port, { type: "error", error: errorMsg });
          return;
        }
        const currentPage = currentPageResponse.page;
        const summary = await summarizePages([currentPage], {
          pageIds: [currentPage.id],
          query: queryText
        });
        if ("error" in summary) {
          safePortPost(port, { type: "error", error: summary.error });
          return;
        }
        const chatResponse: ChatMessage = {
          role: "assistant",
          content: summary.text,
          timestamp: new Date().toISOString(),
          sources: [{ title: currentPage.title, url: currentPage.url }]
        };
        safePortPost(port, { type: "chunk", text: summary.text });
        safePortPost(port, { type: "done", message: chatResponse });
      } catch (error) {
        safePortPost(port, { type: "error", error: (error as Error).message });
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
          } catch (err) {
            sendResponse({ ok: false, error: "Side panel disabled, fallback to popup" });
          }
        } else {
          sendResponse({ ok: false, error: "Side panel not supported" });
        }
      } catch (err) {
        sendResponse({ ok: false, error: "Side panel not available" });
      }
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  return true;
});
