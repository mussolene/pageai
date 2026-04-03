import type { Page, SummarizePayload } from "../types/messages";
import { buildSummaryPrompt, buildChatSystemPrompt } from "./prompts";
import { getCachedLlmResponse, setCachedLlmResponse } from "../storage/indexdb";

export interface LlmConfig {
  endpoint: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/** Одна запись конфига LLM в настройках (имя, endpoint, модель и т.д.). API key хранится отдельно в local. */
export interface LlmConfigEntry {
  id: string;
  name: string;
  endpoint: string;
  endpointType: "chat" | "custom";
  model: string;
}

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  systemPrompt?: string;
  /** Отмена стрима (напр. при нажатии Stop в UI). */
  signal?: AbortSignal;
}

/** OpenAI-compatible tool for chat completions (function calling). */
export interface LlmToolDef {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

/** One tool call from the model response. */
export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Message for API: can include assistant tool_calls and tool results. */
export type LlmMessageForApi =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

/** Таймаут по умолчанию для запросов к LLM (чат, саммари). */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** Таймаут для запроса списка моделей. */
const DEFAULT_MODELS_TIMEOUT_MS = 10_000;
/** Таймаут для одного хоста при автоопределении. */
const DETECT_HOST_TIMEOUT_MS = 3_000;

/** Известные хосты для автоопределения (LM Studio, Ollama и т.п. с OpenAI-совместимым /v1/models). */
const KNOWN_LLM_HOSTS = [
  "http://localhost:1234",   // LM Studio
  "http://localhost:11434",   // Ollama
  "http://127.0.0.1:1234",
  "http://127.0.0.1:11434"
];

/** Создаёт AbortSignal с таймаутом и функцию очистки таймера. */
function abortSignalWithTimeout(ms: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cleanup: () => clearTimeout(t) };
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.message?.toLowerCase().includes("abort"));
}

/** True if the endpoint URL is local (localhost / 127.0.0.1 / [::1]). Used to warn when sending data to external servers. */
export function isLocalLlmEndpoint(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    try {
      url = new URL("http://" + trimmed);
    } catch {
      return false;
    }
  }
  const h = url.hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

/** Нормализует URL: для типа "chat" добавляет /v1/chat/completions к базовому адресу. Экспорт для UI проверки связи. */
export function normalizeEndpoint(raw: string, type: "chat" | "custom"): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (type === "custom") return trimmed;
  const base = trimmed.replace(/\/v1\/chat\/completions\/?$/i, "").trim();
  if (!base) return trimmed;
  return base + CHAT_COMPLETIONS_PATH;
}

/** Результат автоопределения хоста и типа API. */
export interface DetectedLlmHost {
  baseUrl: string;
  type: "chat";
  models: string[];
}

/**
 * Пробует известные хосты (LM Studio, Ollama) и возвращает первый, где доступен /v1/models.
 * Тип API всегда "chat" (OpenAI-совместимый).
 */
export async function detectLlmHost(): Promise<DetectedLlmHost | { error: string }> {
  for (const baseUrl of KNOWN_LLM_HOSTS) {
    try {
      const { signal, cleanup } = abortSignalWithTimeout(DETECT_HOST_TIMEOUT_MS);
      const response = await fetch(`${baseUrl}/v1/models`, { signal });
      cleanup();
      if (!response.ok) continue;
      const data = await response.json();
      const models: string[] = (data.data || []).map((m: { id?: string }) => m.id).filter(Boolean);
      return { baseUrl, type: "chat", models };
    } catch {
      continue;
    }
  }
  return {
    error: "No LLM server found. Start LM Studio (port 1234) or Ollama (port 11434)."
  };
}

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 2048;

/** Возвращает список конфигов и активный id для UI (options, panel, popup). */
export async function getLlmConfigsAndActive(): Promise<{
  configs: LlmConfigEntry[];
  activeId: string | null;
  temperature: number;
  maxTokens: number;
}> {
  const sync = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.sync.get(
      {
        llmConfigs: [] as LlmConfigEntry[],
        activeLlmConfigId: null as string | null,
        llmTemperature: DEFAULT_TEMPERATURE,
        llmMaxTokens: DEFAULT_MAX_TOKENS,
        llmEndpoint: "",
        llmEndpointType: "chat" as "chat" | "custom",
        llmModel: ""
      },
      resolve
    );
  });

  let configs = (sync.llmConfigs as LlmConfigEntry[]) ?? [];
  let activeId = sync.activeLlmConfigId as string | null;

  // Миграция: один конфиг из старых полей
  if (configs.length === 0 && sync.llmEndpoint && sync.llmModel) {
    const raw = String(sync.llmEndpoint).trim();
    const type = sync.llmEndpointType === "custom" ? "custom" : "chat";
    const model = String(sync.llmModel).trim();
    if (raw && model) {
      const id = "default-" + Date.now();
      const entry: LlmConfigEntry = {
        id,
        name: "Default",
        endpoint: raw,
        endpointType: type as "chat" | "custom",
        model
      };
      configs = [entry];
      activeId = id;
      const local = await new Promise<Record<string, unknown>>((r) =>
        chrome.storage.local.get({ llmApiKey: "", llmApiKeys: {} as Record<string, string> }, r)
      );
      const apiKey = (local.llmApiKey as string) || "";
      const apiKeys = (local.llmApiKeys as Record<string, string>) ?? {};
      apiKeys[id] = apiKey;
      await Promise.all([
        new Promise<void>((r) => chrome.storage.sync.set({ llmConfigs: configs, activeLlmConfigId: activeId }, r)),
        new Promise<void>((r) => chrome.storage.local.set({ llmApiKeys: apiKeys }, r))
      ]);
    }
  }

  const temperature = (sync.llmTemperature as number) ?? DEFAULT_TEMPERATURE;
  const maxTokens = (sync.llmMaxTokens as number) ?? DEFAULT_MAX_TOKENS;
  return { configs, activeId, temperature, maxTokens };
}

/** Установить активный конфиг для чата (по id). */
export function setActiveLlmConfigId(id: string | null): void {
  chrome.storage.sync.set({ activeLlmConfigId: id });
}

// BYOM: конфиг из llmConfigs + activeLlmConfigId (sync) и llmApiKeys (local)
async function getLlmConfig(): Promise<LlmConfig | null> {
  const { configs, activeId, temperature, maxTokens } = await getLlmConfigsAndActive();
  const id = activeId ?? configs[0]?.id;
  if (!id || configs.length === 0) return null;

  const entry = configs.find((c) => c.id === id);
  if (!entry) return null;

  const endpoint = normalizeEndpoint(entry.endpoint.trim(), entry.endpointType);
  if (!endpoint) return null;

  const local = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get({ llmApiKeys: {} as Record<string, string> }, resolve);
  });
  const apiKeys = (local.llmApiKeys as Record<string, string>) ?? {};
  const apiKey = apiKeys[entry.id];
  return {
    endpoint,
    model: entry.model,
    apiKey: apiKey && String(apiKey).trim() ? String(apiKey).trim() : undefined,
    temperature,
    maxTokens
  };
}

// Проверить доступность LM Studio (по сохранённому конфигу)
export async function checkLmStudioHealth(): Promise<{ available: boolean; error?: string }> {
  const config = await getLlmConfig();
  if (!config) return { available: false, error: "LM Studio endpoint is not configured" };
  return checkLlmConnection(config.endpoint, config.model);
}

/** Проверка связи по указанному URL и опционально проверка модели в списке. */
export async function checkLlmConnection(
  endpoint: string,
  model?: string
): Promise<{ available: boolean; error?: string }> {
  try {
    const baseUrl = endpoint.trim().replace(/\/v1\/chat\/completions\/?$/, "");
    if (!baseUrl) return { available: false, error: "Invalid endpoint URL" };

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${baseUrl}/v1/models`, { method: "GET", signal: controller.signal });
    clearTimeout(t);

    if (!response.ok) return { available: false, error: `Connection failed: ${response.status}` };

    const data = await response.json();
    const models: string[] = (data.data || []).map((m: { id?: string }) => m.id).filter(Boolean);
    if (models.length === 0) return { available: false, error: "No models available" };

    if (model && model.trim()) {
      const hasModel = models.some((m) => m === model.trim() || m.endsWith("/" + model.trim()));
      if (!hasModel) return { available: false, error: `Model "${model}" not found. Available: ${models.slice(0, 5).join(", ")}${models.length > 5 ? "…" : ""}` };
    }
    return { available: true };
  } catch (error) {
    const msg = (error as Error).message;
    return { available: false, error: msg.includes("abort") ? "Connection timeout" : `Connection error: ${msg}` };
  }
}

export async function summarizePages(
  pages: Page[],
  payload: SummarizePayload
): Promise<{ text: string } | { error: string }> {
  const config = await getLlmConfig();
  if (!config) {
    return { error: "LLM endpoint is not configured. Configure LM Studio at localhost:1234" };
  }

  const prompt = buildSummaryPrompt(pages, payload.query);
  const { signal, cleanup } = abortSignalWithTimeout(DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: buildChatSystemPrompt()
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 2048
      })
    });
    cleanup();

    if (!response.ok) {
      return { error: `LLM request failed: ${response.status} ${response.statusText}` };
    }

    const data = await response.json();
    const text =
      data.choices?.[0]?.message?.content ??
      (typeof data === "string" ? data : JSON.stringify(data, null, 2));

    return { text };
  } catch (error) {
    cleanup();
    return {
      error: isAbortError(error)
        ? "LLM request timed out. Try again or increase timeout."
        : `LLM request error: ${(error as Error).message}`
    };
  }
}

// Chat функция для интерактивного общения с историей
export async function chatWithLLM(
  messages: LlmChatMessage[],
  options: LlmChatOptions = {}
): Promise<{ text: string; cached?: boolean } | { error: string }> {
  const config = await getLlmConfig();
  if (!config) {
    return { error: "LLM endpoint is not configured. Configure LM Studio at localhost:1234" };
  }

  // Проверить кеш для последнего пользовательского сообщения
  if (messages.length > 0) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
      const cached = await getCachedLlmResponse(lastUserMsg.content);
      if (cached) {
        return { text: cached, cached: true };
      }
    }
  }

  const timeout = options.signal
    ? { signal: options.signal, cleanup: () => {} }
    : abortSignalWithTimeout(DEFAULT_REQUEST_TIMEOUT_MS);
  const { signal, cleanup } = timeout;

  try {
    const systemPrompt = options.systemPrompt || buildChatSystemPrompt();
    const messagesWithSystem = [
      { role: "system" as const, content: systemPrompt },
      ...messages
    ];

    const response = await fetch(config.endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: config.model,
        messages: messagesWithSystem,
        temperature: options.temperature ?? config.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? config.maxTokens ?? 2048,
        stream: options.stream ?? false
      })
    });
    cleanup();

    if (!response.ok) {
      const errorText = await response.text();
      return { 
        error: `LLM request failed: ${response.status} ${response.statusText}. ${errorText}` 
      };
    }

    const data = await response.json();
    const text =
      data.choices?.[0]?.message?.content ??
      (typeof data === "string" ? data : JSON.stringify(data, null, 2));

    // Кешировать ответ если был пользовательский запрос
    if (messages.length > 0) {
      const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
      if (lastUserMsg) {
        await setCachedLlmResponse(lastUserMsg.content, text);
      }
    }

    return { text };
  } catch (error) {
    cleanup();
    return {
      error: isAbortError(error)
        ? "LLM request timed out. Try again."
        : `LLM request error: ${(error as Error).message}`
    };
  }
}

/**
 * One round of chat with optional tools. Does not use cache.
 * Returns either final text, or tool_calls to execute, or error.
 * Used by the agent loop when MCP tools are enabled.
 */
export async function chatWithLLMOneRound(
  messages: LlmMessageForApi[],
  options: { systemPrompt?: string; temperature?: number; maxTokens?: number; tools?: LlmToolDef[] } = {}
): Promise<{ text: string } | { tool_calls: LlmToolCall[] } | { error: string }> {
  const config = await getLlmConfig();
  if (!config) {
    return { error: "LLM endpoint is not configured. Configure LM Studio at localhost:1234" };
  }

  const systemPrompt = options.systemPrompt ?? buildChatSystemPrompt();
  const messagesWithSystem: LlmMessageForApi[] = [
    { role: "system", content: systemPrompt },
    ...messages
  ];

  const body: Record<string, unknown> = {
    model: config.model,
    messages: messagesWithSystem,
    temperature: options.temperature ?? config.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? config.maxTokens ?? 2048,
    stream: false
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  const { signal, cleanup } = abortSignalWithTimeout(DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify(body)
    });
    cleanup();

    if (!response.ok) {
      const errorText = await response.text();
      return {
        error: `LLM request failed: ${response.status} ${response.statusText}. ${errorText}`
      };
    }

    const data = await response.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) {
      return { error: "Invalid LLM response: no message" };
    }

    const toolCalls = msg.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const parsed: LlmToolCall[] = toolCalls
        .filter((tc: unknown) => tc && typeof tc === "object" && typeof (tc as { id?: string }).id === "string")
        .map((tc: { id: string; function?: { name?: string; arguments?: string } }) => ({
          id: tc.id,
          name: typeof tc.function?.name === "string" ? tc.function.name : "",
          arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : "{}"
        }))
        .filter((tc) => tc.name !== "");
      if (parsed.length > 0) return { tool_calls: parsed };
    }

    const text =
      typeof msg.content === "string"
        ? msg.content
        : msg.content != null
          ? String(msg.content)
          : "";
    return { text };
  } catch (error) {
    cleanup();
    return {
      error: isAbortError(error)
        ? "LLM request timed out. Try again."
        : `LLM request error: ${(error as Error).message}`
    };
  }
}

/**
 * Короткая подзадача без истории чата и без кеша (план / проверка оркестратора).
 * Не передаёт tools — только system + один user.
 */
export async function chatWithLLMSubtask(
  userContent: string,
  options: {
    systemPrompt: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }
): Promise<{ text: string } | { error: string }> {
  const r = await chatWithLLMOneRound([{ role: "user", content: userContent }], {
    systemPrompt: options.systemPrompt,
    maxTokens: options.maxTokens ?? 512,
    temperature: options.temperature ?? 0.3
  });
  if ("error" in r) return r;
  if ("tool_calls" in r && r.tool_calls.length > 0) {
    return { error: "Subtask model returned tool calls instead of text" };
  }
  return { text: "text" in r ? r.text : "" };
}

/** Стриминг ответа чата: SSE, вызов onChunk на каждый delta content. Для UI «размышлений». */
export async function chatWithLLMStream(
  messages: LlmChatMessage[],
  options: LlmChatOptions & { onChunk: (text: string) => void }
): Promise<{ text: string; thinking?: string } | { error: string }> {
  const config = await getLlmConfig();
  if (!config) {
    return { error: "LLM endpoint is not configured. Configure LM Studio at localhost:1234" };
  }

  const { onChunk, signal, ...rest } = options;
  const systemPrompt = rest.systemPrompt || buildChatSystemPrompt();
  const messagesWithSystem = [
    { role: "system" as const, content: systemPrompt },
    ...messages
  ];

  try {
    const response = await fetch(config.endpoint, {
      signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: config.model,
        messages: messagesWithSystem,
        temperature: rest.temperature ?? config.temperature ?? 0.7,
        max_tokens: 32768,
        stream: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        error: `LLM request failed: ${response.status} ${response.statusText}. ${errorText}`
      };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { error: "Streaming not supported by response" };
    }
    if (signal?.aborted) {
      reader.cancel();
      throw new DOMException("Aborted", "AbortError");
    }
    const onAbort = () => reader.cancel();
    signal?.addEventListener("abort", onAbort);

    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;
        try {
          const data = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
          const content = data.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content) {
            fullContent += content;
            onChunk(content);
          }
        } catch {
          // ignore malformed chunk
        }
      }
    }

    const thinkMatch = fullContent.match(/<think>([\s\S]*?)<\/think>([\s\S]*)/);
    const finalText = thinkMatch ? thinkMatch[2].trim() : fullContent;
    const thinkingText = thinkMatch ? thinkMatch[1].trim() : undefined;

    if (messages.length > 0) {
      const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
      if (lastUserMsg) {
        await setCachedLlmResponse(lastUserMsg.content, fullContent);
      }
    }
      return { text: finalText, thinking: thinkingText };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  } catch (error) {
    return { error: `LLM request error: ${(error as Error).message}` };
  }
}

/** Накопленные tool_calls из стрима (по index). */
interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface StreamDelta {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

/**
 * Стриминг с опциональными инструментами: onChunk вызывается на каждый delta content,
 * в конце возвращаются text, thinking и при наличии — tool_calls для агент-цикла.
 */
export async function chatWithLLMStreamWithTools(
  messages: LlmMessageForApi[],
  options: {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: LlmToolDef[];
    onChunk: (text: string) => void;
    signal?: AbortSignal;
  }
): Promise<
  | { text: string; thinking?: string }
  | { text: string; thinking?: string; tool_calls: LlmToolCall[] }
  | { error: string }
> {
  const config = await getLlmConfig();
  if (!config) {
    return { error: "LLM endpoint is not configured. Configure LM Studio at localhost:1234" };
  }

  const systemPrompt = options.systemPrompt ?? buildChatSystemPrompt();
  const messagesWithSystem: LlmMessageForApi[] = [
    { role: "system", content: systemPrompt },
    ...messages
  ];

  const body: Record<string, unknown> = {
    model: config.model,
    messages: messagesWithSystem,
    temperature: options.temperature ?? config.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 32768,
    stream: true
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  const signal = options.signal;
  try {
    const response = await fetch(config.endpoint, {
      signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        error: `LLM request failed: ${response.status} ${response.statusText}. ${errorText}`
      };
    }

    const reader = response.body?.getReader();
    if (!reader) return { error: "Streaming not supported by response" };
    if (signal?.aborted) {
      reader.cancel();
      throw new DOMException("Aborted", "AbortError");
    }
    const onAbort = () => reader.cancel();
    signal?.addEventListener("abort", onAbort);

    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    const toolCallsByIndex = new Map<number, AccumulatedToolCall>();

    try {
      while (true) {
        const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;
        try {
          const data = JSON.parse(payload) as StreamDelta;
          const delta = data.choices?.[0]?.delta;
          if (!delta) continue;

          if (typeof delta.content === "string" && delta.content) {
            fullContent += delta.content;
            options.onChunk(delta.content);
          }

          const tcs = delta.tool_calls;
          if (Array.isArray(tcs)) {
            for (const tc of tcs) {
              const idx = tc.index ?? 0;
              const cur = toolCallsByIndex.get(idx) ?? {
                id: tc.id ?? "",
                name: "",
                arguments: ""
              };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.name += tc.function.name;
              if (tc.function?.arguments) cur.arguments += tc.function.arguments;
              toolCallsByIndex.set(idx, cur);
            }
          }
        } catch {
          // ignore malformed chunk
        }
      }
    }

      const thinkMatch = fullContent.match(/<think>([\s\S]*?)<\/think>([\s\S]*)/);
      const finalText = thinkMatch ? thinkMatch[2].trim() : fullContent;
      const thinkingText = thinkMatch ? thinkMatch[1].trim() : undefined;

      const sortedCalls: LlmToolCall[] = Array.from(toolCallsByIndex.entries())
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1])
        .filter((tc): tc is LlmToolCall => !!(tc.id && tc.name));
      if (sortedCalls.length > 0) {
        return { text: finalText, thinking: thinkingText, tool_calls: sortedCalls };
      }
      return { text: finalText, thinking: thinkingText };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  } catch (error) {
    return { error: `LLM request error: ${(error as Error).message}` };
  }
}

// Проверить доступность LM Studio и загруженные модели
export async function getLMStudioModels(): Promise<{ models: string[] } | { error: string }> {
  const config = await getLlmConfig();
  if (!config) return { error: "LLM endpoint is not configured" };
  return getLMStudioModelsForEndpoint(config.endpoint);
}

/** Получить список моделей по URL endpoint (без сохранения в storage). Для проверки связи и выбора модели. */
export async function getLMStudioModelsForEndpoint(
  endpoint: string
): Promise<{ models: string[] } | { error: string }> {
  try {
    const baseUrl = endpoint.trim().replace(/\/v1\/chat\/completions\/?$/, "");
    if (!baseUrl) return { error: "Invalid endpoint URL" };

    const { signal, cleanup } = abortSignalWithTimeout(DEFAULT_MODELS_TIMEOUT_MS);
    const response = await fetch(`${baseUrl}/v1/models`, { signal });
    cleanup();

    if (!response.ok) return { error: `Failed to fetch models: ${response.status}` };

    const data = await response.json();
    const models = (data.data || []).map((m: { id?: string }) => m.id).filter(Boolean);
    return { models };
  } catch (error) {
    return {
      error: isAbortError(error)
        ? "Request timed out. Check that the LLM server is running."
        : `Failed to get models: ${(error as Error).message}`
    };
  }
}

