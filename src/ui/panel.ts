import type { ChatMessage, ReasoningStep, SearchResult } from "../types/messages";
import { translate, getStoredLocale } from "../i18n";
import { Storage } from "../storage/indexdb";
import { renderMarkdown } from "./markdown";
import { parseLlmResponse, highlightInlineCitations, createSourceListItems } from "../search/sources";
import { keywordSearch } from "../search/keyword";
import { rerank } from "../search/rerank";
import { getLlmConfigsAndActive, setActiveLlmConfigId } from "../llm/client";
import {
  parseMcpServersList,
  listMcpTools,
  getDefaultMcpServersConfig
} from "../mcp/client";

const chatContainer = document.getElementById("chat-container") as HTMLDivElement;
const messagesContainer = document.getElementById("messages") as HTMLDivElement;
const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement;
const sendButton = document.getElementById("send-button") as HTMLButtonElement;
const tabChat = document.getElementById("tab-chat") as HTMLButtonElement | null;
const tabSearch = document.getElementById("tab-search") as HTMLButtonElement | null;
const tabSettings = document.getElementById("tab-settings") as HTMLButtonElement | null;
const settingsPanel = document.getElementById("settings-panel") as HTMLDivElement | null;
const searchPanel = document.getElementById("search-panel") as HTMLDivElement | null;
const searchPagesInput = document.getElementById("search-pages-input") as HTMLInputElement | null;
const searchPagesBtn = document.getElementById("search-pages-btn") as HTMLButtonElement | null;
const searchStatus = document.getElementById("search-status") as HTMLSpanElement | null;
const searchResults = document.getElementById("search-results") as HTMLUListElement | null;
const summarizeSelectedBtn = document.getElementById("summarize-selected-btn") as HTMLButtonElement | null;

const llmConfigSelect = document.getElementById("llm-config-select") as HTMLSelectElement | null;
const llmConfigOpenOptionsBtn = document.getElementById("llm-config-open-options") as HTMLButtonElement | null;
const browserAutomationCheckbox = document.getElementById("browser-automation-enabled") as HTMLInputElement | null;
const themeToggle = document.querySelector(".theme-toggle") as HTMLDivElement | null;
const themeToggleBtns = (): NodeListOf<HTMLButtonElement> => document.querySelectorAll(".theme-toggle-btn");
const llmStatus = document.getElementById("llm-status") as HTMLSpanElement;
const llmMaxTokensInput = document.getElementById("llm-max-tokens") as HTMLInputElement | null;
const mcpServersConfigInput = document.getElementById("mcp-servers-config") as HTMLTextAreaElement | null;
const mcpServersListEl = document.getElementById("mcp-servers-list") as HTMLDivElement | null;
const mcpStatus = document.getElementById("mcp-status") as HTMLSpanElement | null;
const chatModelSelect = document.getElementById("chat-model-select") as HTMLSelectElement | null;
const clearChatBtn = document.getElementById("clear-chat-btn") as HTMLButtonElement | null;

let chatHistory: ChatMessage[] = [];
const storage = new Storage();

/** Текущие результаты поиска по сохранённым страницам (для выбора и саммари). */
let lastSearchResults: SearchResult[] = [];

/** Индекс сообщения ассистента, которое сейчас стримится; блок «размышления» привязан к нему. */
let streamingAssistantIndex: number | null = null;
/** Элемент, в который дописывается поток размышлений (пока стриминг идёт). */
let streamingThinkingEl: HTMLDivElement | null = null;
/** Элемент ответа после блока размышлений (стриминг). */
let streamingAnswerEl: HTMLDivElement | null = null;
/** Буфер стрима для парсинга think-блока (текущий раунд). */
let streamingBuffer = "";
/** Накопленные шаги рассуждения (размышления + вызовы MCP) за все раунды стрима. */
let streamingReasoningSteps: ReasoningStep[] = [];
/** Порт стрима для остановки по кнопке. */
let streamPort: chrome.runtime.Port | null = null;
/** Флаг отправки, чтобы не дублировать сообщение при двойном клике/Enter. */
let isSending = false;

async function updatePlayStopButton(streaming: boolean): Promise<void> {
  sendButton.classList.toggle("is-streaming", streaming);
  sendButton.textContent = streaming ? "\u25A0" : "\u25B6";
  const title = streaming ? await translate("chat.stop") : await translate("chat.send");
  sendButton.title = title;
  sendButton.setAttribute("aria-label", title);
}

/** Парсит буфер стрима: thinking внутри <think>, answer — после </think> или весь буфер, если тегов нет. */
function parseThinkBuffer(buf: string): { thinking?: string; answer?: string } {
  const thinkOpen = buf.indexOf("<think>");
  const thinkClose = buf.indexOf("</think>");
  if (thinkClose === -1) {
    if (thinkOpen === -1) return { answer: buf };
    return { thinking: buf.slice(thinkOpen + 7) };
  }
  const thinking = thinkOpen === -1 ? "" : buf.slice(thinkOpen + 7, thinkClose);
  const answer = buf.slice(thinkClose + 8);
  return { thinking, answer };
}

/** Форматирует аргументы вызова: для каждого параметра «Имя:\nЗначение» с новой строки. */
function formatToolCallArgsMultiline(argsJson: string): string {
  if (!argsJson?.trim()) return "";
  try {
    const obj = JSON.parse(argsJson) as Record<string, unknown>;
    return Object.entries(obj)
      .map(([k, v]) => `${k}:\n${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join("\n\n");
  } catch {
    return argsJson;
  }
}

/** Создаёт DOM для одного шага рассуждения (размышление или вызов MCP). */
async function buildReasoningStepElement(step: ReasoningStep): Promise<HTMLElement> {
  const reasoningLabel = await translate("chat.reasoning");
  const toolCallLabel = await translate("chat.toolCall");
  const answerLabel = await translate("chat.answer");
  const wrap = document.createElement("div");
  wrap.className = "reasoning-step-wrap";
  if (step.type === "thinking") {
    const details = document.createElement("details");
    details.className = "thinking-block";
    details.open = false;
    const summary = document.createElement("summary");
    summary.textContent = reasoningLabel;
    const thinkingContent = document.createElement("div");
    thinkingContent.className = "thinking-content";
    thinkingContent.textContent = step.text;
    details.appendChild(summary);
    details.appendChild(thinkingContent);
    wrap.appendChild(details);
  } else {
    const toolBlock = document.createElement("details");
    toolBlock.className = "thinking-block tool-call-block";
    toolBlock.open = false;
    const callTitle =
      step.serverName != null && step.serverName !== ""
        ? `${step.serverName}.${step.name}`
        : step.name;
    const summary = document.createElement("summary");
    summary.textContent = `${toolCallLabel}: ${callTitle}`;
    const inner = document.createElement("div");
    inner.className = "thinking-content";
    const argsStr = formatToolCallArgsMultiline(step.args ?? "");
    if (argsStr) {
      const argsEl = document.createElement("div");
      argsEl.className = "tool-call-args";
      argsEl.textContent = argsStr;
      inner.appendChild(argsEl);
    }
    const resultEl = document.createElement("div");
    resultEl.className = "tool-call-result";
    const resultText = step.result ?? "";
    resultEl.textContent = resultText ? `${answerLabel}:\n${resultText}` : "";
    inner.appendChild(resultEl);
    toolBlock.appendChild(summary);
    toolBlock.appendChild(inner);
    wrap.appendChild(toolBlock);
  }
  return wrap;
}

function addMessageToChat(message: ChatMessage, options?: { skipSave?: boolean }) {
  chatHistory.push(message);
  if (!options?.skipSave) {
    try {
      void storage.saveChatMessage(message).catch((err) => {
        console.warn("Failed to save chat message to storage:", err);
      });
    } catch (err) {
      console.warn("Error saving chat message:", err);
    }
  }
  void renderMessages();
}

async function renderMessages() {
  if (!messagesContainer) return;
  messagesContainer.innerHTML = "";

  if (chatHistory.length === 0) {
    const welcome = document.createElement("div");
    welcome.className = "message assistant";
    const welcomeText = await translate("chat.welcomeCurrentPage");
    welcome.innerHTML = `
      <div class="message-content">
        ${welcomeText}
      </div>
    `;
    messagesContainer.appendChild(welcome);
    return;
  }

  for (let i = 0; i < chatHistory.length; i++) {
    const msg = chatHistory[i];
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${msg.role}`;

    const content = document.createElement("div");
    content.className = "message-content";

    const isStreamingThis = msg.role === "assistant" && i === streamingAssistantIndex;
    const wrap = document.createElement("div");
    wrap.className = "message-wrap";
    const inner = document.createElement("div");
    inner.className = "message-inner";

    if (msg.role === "assistant" && isStreamingThis) {
      for (const step of streamingReasoningSteps) {
        const stepDiv = document.createElement("div");
        stepDiv.className = "message reasoning-step";
        const stepEl = await buildReasoningStepElement(step);
        stepDiv.appendChild(stepEl);
        messagesContainer.appendChild(stepDiv);
      }
      const bubble = document.createElement("div");
      bubble.className = "message-content message-bubble";
      const parsed = parseThinkBuffer(streamingBuffer);
      const hasThinking = (parsed.thinking?.length ?? 0) > 0;
      const hasAnswer = (parsed.answer?.length ?? 0) > 0;
      const reasoningLabel = await translate("chat.reasoning");
      const details = document.createElement("details");
      details.className = "thinking-block thinking-streaming";
      if (!hasThinking) details.classList.add("thinking-block-hidden");
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = reasoningLabel;
      const thinkingContent = document.createElement("div");
      thinkingContent.className = "thinking-content";
      thinkingContent.textContent = parsed.thinking ?? "";
      details.appendChild(summary);
      details.appendChild(thinkingContent);
      bubble.appendChild(details);
      streamingThinkingEl = thinkingContent;
      const answerContent = document.createElement("div");
      answerContent.className = "message-answer";
      if (!hasAnswer) answerContent.classList.add("message-answer-empty");
      if (hasAnswer) answerContent.textContent = parsed.answer ?? "";
      bubble.appendChild(answerContent);
      inner.appendChild(bubble);
      streamingAnswerEl = answerContent;
    } else if (msg.role === "assistant" && (msg.reasoningSteps?.length ?? 0) > 0) {
      const steps = msg.reasoningSteps ?? [];
      for (const step of steps) {
        const stepDiv = document.createElement("div");
        stepDiv.className = "message reasoning-step";
        const stepEl = await buildReasoningStepElement(step);
        stepDiv.appendChild(stepEl);
        messagesContainer.appendChild(stepDiv);
      }
      const bubble = document.createElement("div");
      bubble.className = "message-content message-bubble";
      const contentDiv = document.createElement("div");
      contentDiv.className = "message-answer";
      const parsed = parseLlmResponse(msg.content);
      renderMarkdown(contentDiv, parsed.content);
      bubble.appendChild(contentDiv);
      inner.appendChild(bubble);
      const sourceItems = createSourceListItems(parsed.sources);
      if (sourceItems.length > 0) {
        const sourcesContainer = document.createElement("div");
        sourcesContainer.className = "message-sources-container";
        const sourcesLabel = document.createElement("div");
        sourcesLabel.className = "sources-label";
        sourcesLabel.textContent = await translate("chat.sources");
        const sourcesList = document.createElement("ul");
        sourcesList.className = "sources-list md-list";
        sourceItems.forEach((item) => sourcesList.appendChild(item.element));
        sourcesContainer.appendChild(sourcesLabel);
        sourcesContainer.appendChild(sourcesList);
        inner.appendChild(sourcesContainer);
      }
    } else if (msg.role === "assistant" && msg.thinking != null && msg.thinking !== "") {
      const stepDiv = document.createElement("div");
      stepDiv.className = "message reasoning-step";
      const thinkingStep: ReasoningStep = { type: "thinking", text: msg.thinking };
      const stepEl = await buildReasoningStepElement(thinkingStep);
      stepDiv.appendChild(stepEl);
      messagesContainer.appendChild(stepDiv);
      const bubble = document.createElement("div");
      bubble.className = "message-content message-bubble";
      const contentDiv = document.createElement("div");
      contentDiv.className = "message-answer";
      const parsed = parseLlmResponse(msg.content);
      renderMarkdown(contentDiv, parsed.content);
      bubble.appendChild(contentDiv);
      inner.appendChild(bubble);
      const sourceItems = createSourceListItems(parsed.sources);
      if (sourceItems.length > 0) {
        const sourcesContainer = document.createElement("div");
        sourcesContainer.className = "message-sources-container";
        const sourcesLabel = document.createElement("div");
        sourcesLabel.className = "sources-label";
        sourcesLabel.textContent = await translate("chat.sources");
        const sourcesList = document.createElement("ul");
        sourcesList.className = "sources-list md-list";
        sourceItems.forEach((item) => sourcesList.appendChild(item.element));
        sourcesContainer.appendChild(sourcesLabel);
        sourcesContainer.appendChild(sourcesList);
        inner.appendChild(sourcesContainer);
      }
    } else {
      // Parse sources from assistant responses
      const parsed = msg.role === "assistant" ? parseLlmResponse(msg.content) : null;
      const messageContent = parsed ? parsed.content : msg.content;
      const sources = parsed ? parsed.sources : [];
      if (msg.role === "assistant") {
        const contentWithCitations = highlightInlineCitations(messageContent);
        const mdDiv = document.createElement("div");
        mdDiv.innerHTML = contentWithCitations;
        renderMarkdown(content, messageContent);
      } else {
        renderMarkdown(content, msg.content ?? "");
      }

      inner.appendChild(content);

      if (sources.length > 0) {
        const sourcesContainer = document.createElement("div");
        sourcesContainer.className = "message-sources-container";
        const sourcesLabel = document.createElement("div");
        sourcesLabel.className = "sources-label";
        sourcesLabel.textContent = await translate("chat.sources");
        const sourcesList = document.createElement("ul");
        sourcesList.className = "sources-list md-list";
        const sourceItems = createSourceListItems(sources);
        sourceItems.forEach((item) => sourcesList.appendChild(item.element));
        sourcesContainer.appendChild(sourcesLabel);
        sourcesContainer.appendChild(sourcesList);
        inner.appendChild(sourcesContainer);
      }
    }

    wrap.appendChild(inner);
    messageDiv.appendChild(wrap);
    messagesContainer.appendChild(messageDiv);
  }
  if (streamingAssistantIndex === null) {
    streamingThinkingEl = null;
    streamingAnswerEl = null;
  }

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function handleSendMessage() {
  if (streamPort || isSending) return;
  const text = chatInput.value.trim();
  if (!text) return;
  isSending = true;
  await updatePlayStopButton(true);

  const userMessage: ChatMessage = {
    role: "user",
    content: text,
    timestamp: new Date().toISOString()
  };
  addMessageToChat(userMessage);
  chatInput.value = "";
  streamingBuffer = "";
  streamingReasoningSteps = [];

  const port = chrome.runtime.connect({ name: "pageai-chat-stream" });
  streamPort = port;

  const pingIntervalId = setInterval(() => {
    try {
      port.postMessage({ type: "ping" });
    } catch {
      clearInterval(pingIntervalId);
    }
  }, 15_000);
  const clearPing = () => clearInterval(pingIntervalId);

  port.onMessage.addListener((m: { type: string; text?: string; error?: string; message?: ChatMessage; steps?: ReasoningStep[] }) => {
    if (m.type === "reasoning_step" && Array.isArray(m.steps)) {
      streamingReasoningSteps.push(...m.steps);
      streamingBuffer = "";
      void renderMessages();
      return;
    }
    if (m.type === "chunk" && typeof m.text === "string") {
      streamingBuffer += m.text;
      const parsed = parseThinkBuffer(streamingBuffer);
      const hasThinking = (parsed.thinking?.trim().length ?? 0) > 0;
      const hasAnswer = (parsed.answer?.length ?? 0) > 0;
      if (streamingAssistantIndex === null && (hasThinking || hasAnswer)) {
        const placeholder: ChatMessage = {
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString()
        };
        streamingAssistantIndex = chatHistory.length;
        addMessageToChat(placeholder, { skipSave: true });
      }
      if (streamingThinkingEl) {
        const thinkingText = parsed.thinking ?? "";
        streamingThinkingEl.textContent = thinkingText;
        streamingThinkingEl.scrollTop = streamingThinkingEl.scrollHeight;
        const detailsEl = streamingThinkingEl.closest(".thinking-block");
        if (detailsEl) {
          if (thinkingText.length > 0) detailsEl.classList.remove("thinking-block-hidden");
          else detailsEl.classList.add("thinking-block-hidden");
        }
      }
      if (streamingAnswerEl && parsed.answer != null) {
        if (parsed.answer.length > 0) {
          streamingAnswerEl.classList.remove("message-answer-empty");
          if (streamingAnswerEl.textContent !== parsed.answer) streamingAnswerEl.textContent = parsed.answer;
        }
      }
      if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else if (m.type === "done" && m.message) {
      clearPing();
      if (streamingAssistantIndex !== null) {
        chatHistory[streamingAssistantIndex] = m.message;
      } else {
        addMessageToChat(m.message);
      }
      streamingBuffer = "";
      streamingReasoningSteps = [];
      streamingAssistantIndex = null;
      streamingThinkingEl = null;
      streamingAnswerEl = null;
      streamPort = null;
      isSending = false;
      void updatePlayStopButton(false);
      try {
        void storage.saveChatMessage(m.message).catch(() => {});
      } catch {
        /* ignore */
      }
      void renderMessages();
    } else if (m.type === "error") {
      clearPing();
      const errText = m.error ?? "Unknown error";
      const errMessage: ChatMessage = {
        role: "assistant",
        content: `Error: ${errText}`,
        timestamp: new Date().toISOString()
      };
      if (streamingAssistantIndex !== null) {
        chatHistory[streamingAssistantIndex] = errMessage;
      } else {
        addMessageToChat(errMessage);
      }
      streamingAssistantIndex = null;
      streamingThinkingEl = null;
      streamingAnswerEl = null;
      streamingBuffer = "";
      streamingReasoningSteps = [];
      streamPort = null;
      isSending = false;
      void updatePlayStopButton(false);
      void renderMessages();
    }
  });

  port.onDisconnect.addListener(() => {
    clearPing();
    if (streamingAssistantIndex !== null) {
      chatHistory.splice(streamingAssistantIndex, 1);
      streamingAssistantIndex = null;
      streamingThinkingEl = null;
      streamingAnswerEl = null;
      streamingBuffer = "";
      streamingReasoningSteps = [];
      void renderMessages();
    }
    streamPort = null;
    isSending = false;
    void updatePlayStopButton(false);
  });

  try {
    port.postMessage({
      type: "CHAT_STREAM_REQUEST",
      payload: { text }
    });
  } catch (err) {
    clearPing();
    const errMessage: ChatMessage = {
      role: "assistant",
      content: `Error: ${(err as Error).message}`,
      timestamp: new Date().toISOString()
    };
    if (streamingAssistantIndex !== null) {
      chatHistory[streamingAssistantIndex] = errMessage;
    } else {
      addMessageToChat(errMessage);
    }
    streamingAssistantIndex = null;
    streamingThinkingEl = null;
    streamingAnswerEl = null;
    streamingBuffer = "";
    streamingReasoningSteps = [];
    streamPort = null;
    isSending = false;
    void updatePlayStopButton(false);
    void renderMessages();
  }
}

async function loadLlmConfig() {
  const { configs, activeId, maxTokens } = await getLlmConfigsAndActive();
  refreshConfigSelect(configs, activeId);
  const syncTheme = await new Promise<Record<string, unknown>>((r) =>
    chrome.storage.sync.get({ theme: "system" }, r)
  );
  const theme = ((syncTheme.theme as string) === "dark" || (syncTheme.theme as string) === "light"
    ? syncTheme.theme
    : "system") as "light" | "dark" | "system";
  applyTheme(theme);
  setThemeToggle(theme);
  if (llmMaxTokensInput) llmMaxTokensInput.value = String(maxTokens ?? 2048);
  chrome.storage.sync.get(
    { mcpServersConfig: "", mcpServerUrl: "", mcpHeaders: "", mcpServersEnabled: {} as Record<string, boolean> },
    (items) => {
      if (!mcpServersConfigInput) return;
      let config = items.mcpServersConfig || "";
      if (!config && items.mcpServerUrl) {
        let headers: Record<string, string> | undefined;
        if (items.mcpHeaders) {
          try {
            headers = JSON.parse(items.mcpHeaders as string) as Record<string, string>;
          } catch {
            /* ignore */
          }
        }
        config = JSON.stringify({
          mcpServers: {
            legacy: {
              url: items.mcpServerUrl,
              ...(headers && Object.keys(headers).length > 0 ? { headers } : {})
            }
          }
        }, null, 2);
      }
      mcpServersConfigInput.value = config || getDefaultMcpServersConfig();
      void renderMcpServersList(items.mcpServersEnabled || {}, mcpServersConfigInput.value);
    }
  );
  chrome.storage.sync.get({ browserAutomationEnabled: false }, (items) => {
    if (browserAutomationCheckbox) browserAutomationCheckbox.checked = Boolean(items.browserAutomationEnabled);
  });
}

function refreshConfigSelect(
  configs: { id: string; name: string }[],
  activeId: string | null
) {
  const id = activeId ?? configs[0]?.id ?? "";
  for (const sel of [chatModelSelect, llmConfigSelect]) {
    if (!sel) continue;
    sel.innerHTML = "";
    configs.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    sel.value = id;
  }
}

function applyTheme(theme: "light" | "dark" | "system") {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

function getThemeFromToggle(): "light" | "dark" | "system" {
  const btn = document.querySelector('.theme-toggle-btn[aria-pressed="true"]');
  const v = btn?.getAttribute("data-theme");
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

function setThemeToggle(theme: "light" | "dark" | "system") {
  themeToggleBtns().forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.theme === theme ? "true" : "false");
  });
}

const PERSIST_DEBOUNCE_MS = 400;
let persistTimeoutId: ReturnType<typeof setTimeout> | null = null;

function persistLlmSettings(): void {
  const maxTokensRaw = llmMaxTokensInput?.value.trim();
  const maxTokens = maxTokensRaw ? Math.max(128, Math.min(32768, parseInt(maxTokensRaw, 10) || 2048)) : 2048;
  const toSave: Record<string, unknown> = { llmMaxTokens: maxTokens };
  const theme = getThemeFromToggle();
  if (theme === "light" || theme === "dark" || theme === "system") toSave.theme = theme;
  if (mcpServersConfigInput?.value.trim()) toSave.mcpServersConfig = mcpServersConfigInput.value.trim();
  chrome.storage.sync.set(toSave);
}

function schedulePersist(): void {
  if (persistTimeoutId) clearTimeout(persistTimeoutId);
  persistTimeoutId = setTimeout(() => {
    persistTimeoutId = null;
    persistLlmSettings();
  }, PERSIST_DEBOUNCE_MS);
}

const MCP_ERROR_LOADING = "Error loading";

async function renderMcpServersList(
  enabled: Record<string, boolean>,
  configJson: string
) {
  if (!mcpServersListEl) return;
  mcpServersListEl.innerHTML = "";
  const parsed = parseMcpServersList(configJson);
  if ("error" in parsed || parsed.servers.length === 0) return;

  const toolsLabel = await translate("settings.mcpTools");
  const loadingLabel = await translate("settings.checkingMcp") || "Loading…";
  const noToolsLabel = await translate("settings.mcpNoTools") || "No tools";

  for (const server of parsed.servers) {
    const row = document.createElement("div");
    row.className = "mcp-server-row";
    const leftCol = document.createElement("div");
    leftCol.className = "mcp-server-row-left";
    const nameSpan = document.createElement("span");
    nameSpan.className = "mcp-server-name";
    nameSpan.textContent = server.name;
    leftCol.appendChild(nameSpan);

    const details = document.createElement("details");
    details.className = "mcp-tools-details";
    const summary = document.createElement("summary");
    summary.className = "mcp-tools-summary";
    summary.textContent = toolsLabel;
    details.appendChild(summary);
    const toolsContainer = document.createElement("div");
    toolsContainer.className = "mcp-tools-container";
    details.appendChild(toolsContainer);

    const serverUrl = server.url;
    const serverHeaders = server.headers;
    details.addEventListener("toggle", () => {
      if (!details.open || toolsContainer.children.length > 0 || !serverUrl) return;
      toolsContainer.textContent = loadingLabel;
      listMcpTools(serverUrl, { headers: serverHeaders }).then(async (res) => {
        toolsContainer.innerHTML = "";
        toolsContainer.className = "mcp-tools-container";
        if ("error" in res) {
          toolsContainer.textContent = res.error;
          toolsContainer.classList.add("mcp-tools-error");
          if (mcpStatus) {
            mcpStatus.textContent = MCP_ERROR_LOADING;
            mcpStatus.className = "status error";
          }
          return;
        }
        if (mcpStatus) {
          mcpStatus.textContent = "";
          mcpStatus.className = "status";
        }
        if (res.tools.length === 0) {
          toolsContainer.textContent = noToolsLabel;
          return;
        }
        const ul = document.createElement("ul");
        ul.className = "mcp-tools-list";
        for (const tool of res.tools) {
          const li = document.createElement("li");
          li.className = "mcp-tool-item";
          const nameEl = document.createElement("span");
          nameEl.className = "mcp-tool-name";
          nameEl.textContent = tool.name;
          li.appendChild(nameEl);
          if (tool.description) {
            const desc = document.createElement("span");
            desc.className = "mcp-tool-desc";
            desc.textContent = tool.description;
            li.appendChild(desc);
          }
          if (tool.inputSchema?.properties && typeof tool.inputSchema.properties === "object") {
            const params = Object.keys(tool.inputSchema.properties) as string[];
            if (params.length > 0) {
              const paramsEl = document.createElement("span");
              paramsEl.className = "mcp-tool-params";
              paramsEl.textContent = `(${params.join(", ")})`;
              li.appendChild(paramsEl);
            }
          }
          ul.appendChild(li);
        }
        toolsContainer.appendChild(ul);
      });
    });

    leftCol.appendChild(details);
    row.appendChild(leftCol);
    const switchWrap = document.createElement("label");
    switchWrap.className = "mcp-server-toggle-wrap";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "mcp-server-toggle";
    toggle.checked = enabled[server.name] !== false;
    toggle.setAttribute("aria-label", `Enable ${server.name}`);
    toggle.dataset.serverName = server.name;
    switchWrap.appendChild(toggle);
    row.appendChild(switchWrap);
    mcpServersListEl.appendChild(row);

    toggle.addEventListener("change", () => {
      const next = { ...enabled, [server.name]: toggle.checked };
      chrome.storage.sync.set({ mcpServersEnabled: next });
    });
  }
}

async function updateUI() {
  const locale = await getStoredLocale();
  document.documentElement.lang = locale === "ru" ? "ru" : "en";

  document.title = await translate("app.title");
  const title = document.querySelector(".title");
  const subtitle = document.querySelector(".subtitle");
  if (title) title.textContent = await translate("app.title");
  if (subtitle) subtitle.textContent = await translate("chat.subtitleCurrentPage");
  if (tabChat) tabChat.textContent = await translate("chat.tabChat");
  if (tabSearch) tabSearch.textContent = await translate("search.tabSearch");
  if (tabSettings) tabSettings.textContent = await translate("settings.title");

  if (chatInput) chatInput.placeholder = await translate("chat.placeholderCurrentPage");
  if (sendButton) void updatePlayStopButton(false);
  if (clearChatBtn) {
    clearChatBtn.textContent = await translate("chat.clearChat");
    clearChatBtn.title = await translate("chat.clearChat");
    clearChatBtn.setAttribute("aria-label", await translate("chat.clearChat"));
  }

  const browserAutomationLabel = document.querySelector('#panel-section-browser .settings-row-label');
  if (browserAutomationLabel) browserAutomationLabel.textContent = await translate("settings.browserAutomation");
  const themeBtnLight = document.querySelector('.theme-toggle-btn[data-theme="light"]');
  const themeBtnDark = document.querySelector('.theme-toggle-btn[data-theme="dark"]');
  const themeBtnSystem = document.querySelector('.theme-toggle-btn[data-theme="system"]');
  if (themeBtnLight) {
    themeBtnLight.setAttribute("aria-label", await translate("settings.themeLight"));
    themeBtnLight.setAttribute("title", await translate("settings.themeLight"));
  }
  if (themeBtnDark) {
    themeBtnDark.setAttribute("aria-label", await translate("settings.themeDark"));
    themeBtnDark.setAttribute("title", await translate("settings.themeDark"));
  }
  if (themeBtnSystem) {
    themeBtnSystem.setAttribute("aria-label", await translate("settings.themeSystem"));
    themeBtnSystem.setAttribute("title", await translate("settings.themeSystem"));
  }

  const llmMaxTokensLabelText = document.querySelector('label:has(#llm-max-tokens) .label-text');
  if (llmMaxTokensLabelText) llmMaxTokensLabelText.textContent = await translate("settings.maxTokens");
  if (llmMaxTokensInput) llmMaxTokensInput.placeholder = (await translate("settings.maxTokensPlaceholder")) || "2048";

  const mcpConfigLabel = document.querySelector('#panel-section-mcp .settings-row-label');
  if (mcpConfigLabel) mcpConfigLabel.textContent = await translate("settings.mcpServersConfig");
  if (mcpServersConfigInput) mcpServersConfigInput.placeholder = await translate("settings.mcpServersConfigPlaceholder");
  await renderMessages();
}

function switchSettingsSection(section: string): void {
  document.querySelectorAll("#settings-panel .settings-nav-item").forEach((btn) => {
    const s = (btn as HTMLElement).dataset.section;
    btn.classList.toggle("is-active", s === section);
  });
  document.querySelectorAll("#settings-panel .settings-section").forEach((sec) => {
    const id = sec.id;
    (sec as HTMLElement).classList.toggle("hidden", !id || id !== `panel-section-${section}`);
  });
}

function loadPanelRulesAndSkills(): void {
  chrome.storage.sync.get({ agentRules: "", agentSkills: "" }, (items) => {
    const rulesEl = document.getElementById("panel-agent-rules") as HTMLTextAreaElement | null;
    const skillsEl = document.getElementById("panel-agent-skills") as HTMLTextAreaElement | null;
    if (rulesEl) rulesEl.value = (items.agentRules as string) ?? "";
    if (skillsEl) skillsEl.value = (items.agentSkills as string) ?? "";
  });
}

function switchToTab(tab: "chat" | "search" | "settings") {
  const chatActive = tab === "chat";
  const searchActive = tab === "search";
  const settingsActive = tab === "settings";
  chatContainer?.classList.toggle("hidden", !chatActive);
  searchPanel?.classList.toggle("hidden", !searchActive);
  settingsPanel?.classList.toggle("hidden", !settingsActive);
  tabChat?.classList.toggle("tab-btn-active", chatActive);
  tabChat?.setAttribute("aria-selected", String(chatActive));
  tabSearch?.classList.toggle("tab-btn-active", searchActive);
  tabSearch?.setAttribute("aria-selected", String(searchActive));
  tabSettings?.classList.toggle("tab-btn-active", settingsActive);
  tabSettings?.setAttribute("aria-selected", String(settingsActive));
  if (searchActive) updateSummarizeButtonState();
}

async function runSearch(): Promise<void> {
  if (!searchPagesInput || !searchResults || !searchStatus) return;
  const query = searchPagesInput.value.trim();
  if (!query) {
    searchStatus.textContent = "Enter a search query.";
    searchStatus.className = "status search-status";
    return;
  }
  searchStatus.textContent = "Searching…";
  searchStatus.className = "status info search-status";
  searchResults.innerHTML = "";
  lastSearchResults = [];
  try {
    const pages = await storage.getAllPages();
    if (pages.length === 0) {
      searchStatus.textContent = "No saved pages yet. Visit some pages to index them.";
      searchStatus.className = "status search-status";
      return;
    }
    const results = keywordSearch(query, pages, { limit: 20 });
    lastSearchResults = rerank(results);
    if (lastSearchResults.length === 0) {
      searchStatus.textContent = "No matches.";
      searchStatus.className = "status search-status";
      return;
    }
    searchStatus.textContent = `${lastSearchResults.length} page(s) found.`;
    searchStatus.className = "status success search-status";
    renderSearchResultsList(lastSearchResults);
  } catch (err) {
    searchStatus.textContent = "Search failed: " + (err instanceof Error ? err.message : String(err));
    searchStatus.className = "status error search-status";
  }
  updateSummarizeButtonState();
}

function renderSearchResultsList(results: SearchResult[]): void {
  if (!searchResults) return;
  searchResults.innerHTML = "";
  const snippetLen = 80;
  for (const { page, score } of results) {
    const li = document.createElement("li");
    li.className = "search-result-item";
    const label = document.createElement("label");
    label.className = "search-result-label";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "search-result-cb";
    cb.dataset.pageId = page.id;
    cb.addEventListener("change", () => updateSummarizeButtonState());
    const title = document.createElement("span");
    title.className = "search-result-title";
    title.textContent = page.title || page.url || page.id;
    const link = document.createElement("a");
    link.href = page.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "search-result-link";
    link.textContent = page.url;
    const snippet = document.createElement("p");
    snippet.className = "search-result-snippet";
    const text = page.contentText?.trim() || "";
    snippet.textContent = text.length > snippetLen ? text.slice(0, snippetLen) + "…" : text;
    label.appendChild(cb);
    label.appendChild(title);
    li.appendChild(label);
    li.appendChild(link);
    li.appendChild(snippet);
    searchResults.appendChild(li);
  }
}

function getSelectedPageIds(): string[] {
  if (!searchResults) return [];
  const checkboxes = searchResults.querySelectorAll<HTMLInputElement>(".search-result-cb:checked");
  return Array.from(checkboxes).map((cb) => cb.dataset.pageId ?? "").filter(Boolean);
}

function updateSummarizeButtonState(): void {
  if (summarizeSelectedBtn) {
    const ids = getSelectedPageIds();
    summarizeSelectedBtn.disabled = ids.length === 0;
  }
}

async function summarizeSelected(): Promise<void> {
  const ids = getSelectedPageIds();
  if (ids.length === 0 || !summarizeSelectedBtn || !searchStatus) return;
  summarizeSelectedBtn.disabled = true;
  searchStatus.textContent = "Summarizing…";
  searchStatus.className = "status info search-status";
  try {
    const response = await new Promise<{ ok?: boolean; summary?: { text?: string; error?: string }; error?: string }>((resolve) => {
      chrome.runtime.sendMessage(
        { type: "SUMMARIZE", payload: { pageIds: ids } },
        (r: unknown) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message ?? "Unknown error" });
            return;
          }
          resolve((r as { ok?: boolean; summary?: { text?: string; error?: string }; error?: string }) ?? {});
        }
      );
    });
    const errMsg = response.error ?? (response.summary && "error" in response.summary ? response.summary.error : undefined);
    if (errMsg) {
      searchStatus.textContent = errMsg;
      searchStatus.className = "status error search-status";
      return;
    }
    const text = response.summary?.text ?? "";
    const sources = lastSearchResults
      .filter((r) => ids.includes(r.page.id))
      .map((r) => ({ title: r.page.title || r.page.url, url: r.page.url }));
    const msg: ChatMessage = {
      role: "assistant",
      content: text,
      timestamp: new Date().toISOString(),
      sources
    };
    chatHistory.push(msg);
    await storage.saveChatMessage(msg);
    await renderMessages();
    searchStatus.textContent = "Summary added to chat.";
    searchStatus.className = "status success search-status";
    switchToTab("chat");
  } catch (err) {
    searchStatus.textContent = "Failed: " + (err instanceof Error ? err.message : String(err));
    searchStatus.className = "status error search-status";
  } finally {
    updateSummarizeButtonState();
  }
}

async function clearChat(): Promise<void> {
  if (streamPort) {
    streamPort.disconnect();
    streamPort = null;
  }
  streamingAssistantIndex = null;
  streamingThinkingEl = null;
  streamingAnswerEl = null;
  streamingBuffer = "";
  streamingReasoningSteps = [];
  isSending = false;
  await storage.clearChatHistory();
  chatHistory = [];
  void updatePlayStopButton(false);
  void renderMessages();
}

function wireEvents() {
  tabChat?.addEventListener("click", () => switchToTab("chat"));
  tabSearch?.addEventListener("click", () => switchToTab("search"));
  tabSettings?.addEventListener("click", () => switchToTab("settings"));
  clearChatBtn?.addEventListener("click", () => void clearChat());
  searchPagesBtn?.addEventListener("click", () => void runSearch());
  searchPagesInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void runSearch();
  });
  summarizeSelectedBtn?.addEventListener("click", () => void summarizeSelected());
  sendButton.addEventListener("click", () => {
    if (streamPort) {
      try {
        streamPort.postMessage({ type: "STOP_STREAM" });
      } catch {
        /* port may already be disconnected */
      }
      streamPort.disconnect();
      streamPort = null;
      if (streamingAssistantIndex !== null) {
        chatHistory.splice(streamingAssistantIndex, 1);
      }
      streamingAssistantIndex = null;
      streamingThinkingEl = null;
      streamingAnswerEl = null;
      streamingBuffer = "";
      streamingReasoningSteps = [];
      isSending = false;
      void updatePlayStopButton(false);
      void renderMessages();
    } else {
      void handleSendMessage();
    }
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  });

  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
  });

  document.querySelectorAll("#settings-panel .settings-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = (btn as HTMLElement).dataset.section;
      if (section) switchSettingsSection(section);
    });
  });

  const panelRulesEl = document.getElementById("panel-agent-rules") as HTMLTextAreaElement | null;
  const panelSkillsEl = document.getElementById("panel-agent-skills") as HTMLTextAreaElement | null;
  const panelRulesStatus = document.getElementById("panel-rules-status") as HTMLSpanElement | null;
  const panelSkillsStatus = document.getElementById("panel-skills-status") as HTMLSpanElement | null;
  function showPanelRulesSaved(): void {
    if (panelRulesStatus) {
      panelRulesStatus.textContent = "Saved";
      panelRulesStatus.className = "status success";
      setTimeout(() => { panelRulesStatus!.textContent = ""; panelRulesStatus!.className = "status"; }, 2000);
    }
  }
  function showPanelSkillsSaved(): void {
    if (panelSkillsStatus) {
      panelSkillsStatus.textContent = "Saved";
      panelSkillsStatus.className = "status success";
      setTimeout(() => { panelSkillsStatus!.textContent = ""; panelSkillsStatus!.className = "status"; }, 2000);
    }
  }
  panelRulesEl?.addEventListener("input", () => {
    chrome.storage.sync.set({ agentRules: panelRulesEl?.value ?? "" });
    showPanelRulesSaved();
  });
  panelRulesEl?.addEventListener("blur", () => {
    chrome.storage.sync.set({ agentRules: panelRulesEl?.value ?? "" });
    showPanelRulesSaved();
  });
  panelSkillsEl?.addEventListener("input", () => {
    chrome.storage.sync.set({ agentSkills: panelSkillsEl?.value ?? "" });
    showPanelSkillsSaved();
  });
  panelSkillsEl?.addEventListener("blur", () => {
    chrome.storage.sync.set({ agentSkills: panelSkillsEl?.value ?? "" });
    showPanelSkillsSaved();
  });

  browserAutomationCheckbox?.addEventListener("change", () => {
    chrome.storage.sync.set({ browserAutomationEnabled: browserAutomationCheckbox.checked });
  });
  llmMaxTokensInput?.addEventListener("input", schedulePersist);
  mcpServersConfigInput?.addEventListener("input", schedulePersist);
  themeToggle?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".theme-toggle-btn");
    if (!btn || !(btn instanceof HTMLButtonElement)) return;
    const v = btn.dataset.theme as "light" | "dark" | "system";
    if (v !== "light" && v !== "dark" && v !== "system") return;
    applyTheme(v);
    setThemeToggle(v);
    chrome.storage.sync.set({ theme: v });
  });
  mcpServersConfigInput?.addEventListener("input", () => {
    chrome.storage.sync.get({ mcpServersEnabled: {} as Record<string, boolean> }, (items) => {
      void renderMcpServersList(items.mcpServersEnabled || {}, mcpServersConfigInput?.value ?? "");
    });
  });

  chatModelSelect?.addEventListener("change", () => {
    setActiveLlmConfigId(chatModelSelect?.value ?? null);
  });
  llmConfigSelect?.addEventListener("change", () => {
    setActiveLlmConfigId(llmConfigSelect?.value ?? null);
    if (chatModelSelect && llmConfigSelect) chatModelSelect.value = llmConfigSelect.value;
  });
  llmConfigOpenOptionsBtn?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });
}

async function loadChatHistory(): Promise<void> {
  try {
    chatHistory = await storage.getChatHistory();
  } catch (error) {
    console.error("Failed to load chat history:", error);
    chatHistory = [];
  }
}

wireEvents();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && (changes.llmConfigs || changes.activeLlmConfigId)) {
    void getLlmConfigsAndActive().then(({ configs, activeId }) => refreshConfigSelect(configs, activeId));
  }
});
void (async () => {
  await loadChatHistory();
  await updateUI();
})();
void loadLlmConfig();
loadPanelRulesAndSkills();
