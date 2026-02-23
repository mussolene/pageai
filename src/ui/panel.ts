import type { MessageFromPanel, ChatMessage, ReasoningStep } from "../types/messages";
import { translate, getStoredLocale } from "../i18n";
import { Storage } from "../storage/indexdb";
import { markdownToHtml, renderMarkdown } from "./markdown";
import { parseLlmResponse, highlightInlineCitations, createSourceListItems } from "../search/sources";
import type { Source } from "../search/sources";
import { checkLlmConnection, getLMStudioModelsForEndpoint, normalizeEndpoint } from "../llm/client";
import {
  checkMcpConnection,
  parseMcpServersConfigForCheck,
  parseMcpServersList,
  listMcpTools,
  getDefaultMcpServersConfig
} from "../mcp/client";

const chatContainer = document.getElementById("chat-container") as HTMLDivElement;
const messagesContainer = document.getElementById("messages") as HTMLDivElement;
const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement;
const sendButton = document.getElementById("send-button") as HTMLButtonElement;
const tabChat = document.getElementById("tab-chat") as HTMLButtonElement | null;
const tabSettings = document.getElementById("tab-settings") as HTMLButtonElement | null;
const settingsPanel = document.getElementById("settings-panel") as HTMLDivElement | null;

const llmEndpointTypeSelect = document.getElementById("llm-endpoint-type") as HTMLSelectElement | null;
const llmEndpointInput = document.getElementById("llm-endpoint") as HTMLInputElement;
const llmModelInput = document.getElementById("llm-model") as HTMLInputElement;
const themeSelect = document.getElementById("theme-select") as HTMLSelectElement | null;
const llmApiKeyInput = document.getElementById("llm-api-key") as HTMLInputElement;
const llmSaveButton = document.getElementById("llm-save") as HTMLButtonElement;
const llmStatus = document.getElementById("llm-status") as HTMLSpanElement;
const llmFetchModelsBtn = document.getElementById("llm-fetch-models") as HTMLButtonElement | null;
const llmModelSelect = document.getElementById("llm-model-select") as HTMLSelectElement | null;
const llmMaxTokensInput = document.getElementById("llm-max-tokens") as HTMLInputElement | null;
const mcpServersConfigInput = document.getElementById("mcp-servers-config") as HTMLTextAreaElement | null;
const mcpServersListEl = document.getElementById("mcp-servers-list") as HTMLDivElement | null;
const mcpCheckBtn = document.getElementById("mcp-check") as HTMLButtonElement | null;
const mcpStatus = document.getElementById("mcp-status") as HTMLSpanElement | null;
const chatModelSelect = document.getElementById("chat-model-select") as HTMLSelectElement | null;
const clearChatBtn = document.getElementById("clear-chat-btn") as HTMLButtonElement | null;

let chatHistory: ChatMessage[] = [];
const storage = new Storage();

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

function sendMessage<TResponse>(message: MessageFromPanel | { type: string }): Promise<TResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: TResponse) => {
      resolve(response);
    });
  });
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
      for (const step of msg.reasoningSteps) {
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
      let messageContent = msg.content;
      let sources: Source[] = [];

      if (msg.role === "assistant") {
        const parsed = parseLlmResponse(msg.content);
        messageContent = parsed.content;
        sources = parsed.sources;
        const contentWithCitations = highlightInlineCitations(messageContent);
        const mdDiv = document.createElement("div");
        mdDiv.innerHTML = contentWithCitations;
        renderMarkdown(content, messageContent);
      } else {
        content.textContent = msg.content;
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

function loadLlmConfig() {
  chrome.storage.sync.get(
    {
      llmEndpoint: "http://localhost:1234",
      llmEndpointType: "chat" as "chat" | "custom",
      llmModel: "qwen/qwen3-4b-2507",
      llmApiKey: "",
      llmTemperature: 0.7,
      llmMaxTokens: 2048,
      theme: "system" as "light" | "dark" | "system",
      mcpServersConfig: "",
      lastFetchedModels: [] as string[],
      mcpServersEnabled: {} as Record<string, boolean>
    },
    (items) => {
      const endpointType = items.llmEndpointType === "custom" ? "custom" : "chat";
      if (llmEndpointTypeSelect) llmEndpointTypeSelect.value = endpointType;
      let endpointDisplay = items.llmEndpoint ?? "";
      if (endpointType === "chat" && endpointDisplay.endsWith("/v1/chat/completions")) {
        endpointDisplay = endpointDisplay.replace(/\/v1\/chat\/completions\/?$/i, "");
      }
      llmEndpointInput.value = endpointDisplay;
      llmModelInput.value = items.llmModel;
      applyTheme(items.theme === "dark" ? "dark" : items.theme === "light" ? "light" : "system");
      if (themeSelect) themeSelect.value = items.theme ?? "system";
      llmApiKeyInput.value = items.llmApiKey;
      if (llmMaxTokensInput) llmMaxTokensInput.value = String(items.llmMaxTokens ?? 2048);
      if (mcpServersConfigInput) {
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
      refreshChatModelSelect(items.lastFetchedModels || [], items.llmModel || "");
    }
  );
}

const AUTO_MODEL_LABEL = "Auto";

function refreshChatModelSelect(modelIds: string[], currentModel: string) {
  if (!chatModelSelect) return;
  chatModelSelect.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = AUTO_MODEL_LABEL;
  chatModelSelect.appendChild(auto);
  const list = modelIds.length > 0 ? modelIds : (currentModel ? [currentModel] : []);
  list.forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    chatModelSelect.appendChild(opt);
  });
  if (currentModel && list.includes(currentModel)) {
    chatModelSelect.value = currentModel;
  } else {
    chatModelSelect.value = "";
  }
}

function getEndpointType(): "chat" | "custom" {
  return (llmEndpointTypeSelect?.value === "custom" ? "custom" : "chat") as "chat" | "custom";
}

function applyTheme(theme: "light" | "dark" | "system") {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

async function saveLlmConfig() {
  const temperature = 0.7;
  const maxTokensRaw = llmMaxTokensInput?.value.trim();
  const maxTokens = maxTokensRaw ? Math.max(128, Math.min(32768, parseInt(maxTokensRaw, 10) || 2048)) : 2048;
  const endpointRaw = llmEndpointInput.value.trim();
  const model = llmModelInput.value.trim();
  const endpointType = getEndpointType();
  if (!endpointRaw || !model) {
    llmStatus.textContent = await translate("errors.llmNotConfigured");
    llmStatus.className = "status error";
    return;
  }

  const endpoint = normalizeEndpoint(endpointRaw, endpointType);
  if (!endpoint) {
    llmStatus.textContent = await translate("settings.enterLlmEndpoint");
    llmStatus.className = "status error";
    return;
  }

  llmStatus.textContent = (await translate("settings.checking")) || "Checking connection…";
  llmStatus.className = "status info";

  const check = await checkLlmConnection(endpoint, model);
  if (!check.available) {
    llmStatus.textContent = `\u2716 ${check.error}`;
    llmStatus.className = "status error";
    return;
  }

  const toSave: Record<string, unknown> = {
    llmEndpoint: endpointRaw,
    llmEndpointType: endpointType,
    llmModel: model,
    llmApiKey: llmApiKeyInput.value,
    llmTemperature: temperature,
    llmMaxTokens: maxTokens
  };
  const theme = themeSelect?.value;
  if (theme === "light" || theme === "dark" || theme === "system") toSave.theme = theme;
  if (mcpServersConfigInput?.value.trim()) toSave.mcpServersConfig = mcpServersConfigInput.value.trim();

  const savedText = await translate("settings.saved");
  chrome.storage.sync.set(toSave, () => {
    llmStatus.textContent = savedText || "Saved";
    llmStatus.className = "status success";
    setTimeout(() => { llmStatus.textContent = ""; llmStatus.className = "status"; }, 2000);
  });
}

async function fetchModels() {
  if (!llmFetchModelsBtn || !llmModelSelect || !llmEndpointInput) return;
  const endpointRaw = llmEndpointInput.value.trim();
  if (!endpointRaw) {
    llmStatus.textContent = await translate("settings.enterLlmEndpoint");
    llmStatus.className = "status error";
    return;
  }
  const endpoint = normalizeEndpoint(endpointRaw, getEndpointType());
  if (!endpoint) {
    llmStatus.textContent = await translate("settings.enterLlmEndpoint");
    llmStatus.className = "status error";
    return;
  }
  llmFetchModelsBtn.disabled = true;
  llmModelSelect.innerHTML = "";
  llmStatus.textContent = await translate("settings.checking");
  llmStatus.className = "status info";
  try {
    const result = await getLMStudioModelsForEndpoint(endpoint);
    if ("error" in result) {
      llmStatus.textContent = result.error;
      llmStatus.className = "status error";
      return;
    }
    llmStatus.textContent = "";
    result.models.forEach((id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      llmModelSelect.appendChild(opt);
    });
    if (result.models.length > 0) {
      llmModelSelect.style.display = "inline-block";
      if (!llmModelInput.value && result.models[0]) llmModelInput.value = result.models[0];
      chrome.storage.sync.set({ lastFetchedModels: result.models }, () => {
        refreshChatModelSelect(result.models, llmModelInput?.value || result.models[0]);
      });
    }
  } catch (err) {
    llmStatus.textContent = (err as Error).message || "Failed to fetch models";
    llmStatus.className = "status error";
  } finally {
    llmFetchModelsBtn.disabled = false;
  }
}

async function checkMcp() {
  if (!mcpCheckBtn || !mcpStatus || !mcpServersConfigInput) return;
  const json = mcpServersConfigInput.value.trim();
  const parsed = parseMcpServersConfigForCheck(json);
  if ("error" in parsed) {
    mcpStatus.textContent = `\u2716 ${parsed.error}`;
    mcpStatus.className = "status error";
    setTimeout(() => { mcpStatus.textContent = ""; mcpStatus.className = "status"; }, 3000);
    return;
  }
  mcpCheckBtn.disabled = true;
  mcpStatus.textContent = await translate("settings.checkingMcp");
  mcpStatus.className = "status info";
  const result = await checkMcpConnection(parsed.url, { headers: parsed.headers });
  mcpCheckBtn.disabled = false;
  if (result.ok) {
    mcpStatus.textContent = await translate("settings.mcpConnected");
    mcpStatus.className = "status success";
  } else {
    mcpStatus.textContent = `\u2716 ${result.error}`;
    mcpStatus.className = "status error";
  }
  setTimeout(() => { mcpStatus.textContent = ""; mcpStatus.className = "status"; }, 3000);
}

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
          return;
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
  if (tabSettings) tabSettings.textContent = await translate("settings.title");

  if (chatInput) chatInput.placeholder = await translate("chat.placeholderCurrentPage");
  if (sendButton) void updatePlayStopButton(false);
  if (clearChatBtn) {
    clearChatBtn.textContent = await translate("chat.clearChat");
    clearChatBtn.title = await translate("chat.clearChat");
    clearChatBtn.setAttribute("aria-label", await translate("chat.clearChat"));
  }

  const llmEndpointTypeLabel = document.querySelector('label:has(#llm-endpoint-type) .label-text');
  const llmEndpointLabelText = document.querySelector('label:has(#llm-endpoint) .label-text');
  const llmModelLabelText = document.querySelector('label:has(#llm-model) .label-text');
  const llmApiKeyLabelText = document.querySelector('label:has(#llm-api-key) .label-text');
  const themeLabel = document.querySelector('label:has(#theme-select) .label-text');

  if (llmEndpointTypeLabel) llmEndpointTypeLabel.textContent = await translate("settings.endpointType");
  if (llmEndpointTypeSelect) {
    const typeOpts = llmEndpointTypeSelect.querySelectorAll("option");
    if (typeOpts[0]) typeOpts[0].textContent = await translate("settings.endpointTypeChat");
    if (typeOpts[1]) typeOpts[1].textContent = await translate("settings.endpointTypeCustom");
  }
  if (llmEndpointLabelText) llmEndpointLabelText.textContent = await translate("settings.llmEndpoint");
  if (llmEndpointInput) llmEndpointInput.placeholder = getEndpointType() === "custom" ? (await translate("settings.llmEndpointPlaceholderCustom")) : (await translate("settings.llmEndpointPlaceholder"));
  if (themeLabel) themeLabel.textContent = await translate("settings.theme");
  if (themeSelect) {
    const opts = themeSelect.querySelectorAll("option");
    opts[0]?.setAttribute("value", "system"); if (opts[0]) opts[0].textContent = await translate("settings.themeSystem");
    opts[1]?.setAttribute("value", "light"); if (opts[1]) opts[1].textContent = await translate("settings.themeLight");
    opts[2]?.setAttribute("value", "dark"); if (opts[2]) opts[2].textContent = await translate("settings.themeDark");
  }

  if (llmModelLabelText) llmModelLabelText.textContent = await translate("settings.model");
  if (llmModelInput) llmModelInput.placeholder = await translate("settings.modelPlaceholder");

  if (llmApiKeyLabelText) llmApiKeyLabelText.textContent = await translate("settings.apiKey");
  const llmMaxTokensLabelText = document.querySelector('label:has(#llm-max-tokens) .label-text');
  if (llmMaxTokensLabelText) llmMaxTokensLabelText.textContent = await translate("settings.maxTokens");
  if (llmMaxTokensInput) llmMaxTokensInput.placeholder = (await translate("settings.maxTokensPlaceholder")) || "2048";

  if (llmSaveButton) llmSaveButton.textContent = await translate("settings.save");
  if (llmFetchModelsBtn) llmFetchModelsBtn.textContent = await translate("settings.fetchModels");

  const mcpConfigLabel = document.querySelector('label:has(#mcp-servers-config) .label-text');
  if (mcpConfigLabel) mcpConfigLabel.textContent = await translate("settings.mcpServersConfig");
  if (mcpServersConfigInput) mcpServersConfigInput.placeholder = await translate("settings.mcpServersConfigPlaceholder");
  if (mcpCheckBtn) mcpCheckBtn.textContent = await translate("settings.checkMcp");

  await renderMessages();
}

function switchToTab(tab: "chat" | "settings") {
  const chatActive = tab === "chat";
  chatContainer?.classList.toggle("hidden", !chatActive);
  settingsPanel?.classList.toggle("hidden", chatActive);
  tabChat?.classList.toggle("tab-btn-active", chatActive);
  tabChat?.setAttribute("aria-selected", String(chatActive));
  tabSettings?.classList.toggle("tab-btn-active", !chatActive);
  tabSettings?.setAttribute("aria-selected", String(!chatActive));
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
  tabSettings?.addEventListener("click", () => switchToTab("settings"));
  clearChatBtn?.addEventListener("click", () => void clearChat());
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

  llmSaveButton.addEventListener("click", () => void saveLlmConfig());
  llmFetchModelsBtn?.addEventListener("click", () => void fetchModels());
  llmEndpointTypeSelect?.addEventListener("change", async () => {
    if (llmEndpointInput) llmEndpointInput.placeholder = getEndpointType() === "custom" ? (await translate("settings.llmEndpointPlaceholderCustom")) : (await translate("settings.llmEndpointPlaceholder"));
  });
  themeSelect?.addEventListener("change", () => {
    const v = themeSelect.value as "light" | "dark" | "system";
    applyTheme(v);
    chrome.storage.sync.set({ theme: v });
  });
  llmModelSelect?.addEventListener("change", () => {
    if (llmModelInput && llmModelSelect?.value) llmModelInput.value = llmModelSelect.value;
  });
  mcpCheckBtn?.addEventListener("click", () => void checkMcp());
  mcpServersConfigInput?.addEventListener("input", () => {
    chrome.storage.sync.get({ mcpServersEnabled: {} as Record<string, boolean> }, (items) => {
      void renderMcpServersList(items.mcpServersEnabled || {}, mcpServersConfigInput?.value ?? "");
    });
  });

  chatModelSelect?.addEventListener("change", () => {
    const v = chatModelSelect.value;
    if (llmModelInput) llmModelInput.value = v || llmModelInput.placeholder;
    if (v) chrome.storage.sync.set({ llmModel: v });
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
void (async () => {
  await loadChatHistory();
  await updateUI();
})();
void loadLlmConfig();
