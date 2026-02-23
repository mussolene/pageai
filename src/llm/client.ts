import type { ConfluencePage, SummarizePayload } from "../types/messages";
import { buildSummaryPrompt, buildChatSystemPrompt } from "./prompts";
import { getCachedLlmResponse, setCachedLlmResponse } from "../storage/indexdb";

export interface LlmConfig {
  endpoint: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
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

/** Нормализует URL: для типа "chat" добавляет /v1/chat/completions к базовому адресу. Экспорт для UI проверки связи. */
export function normalizeEndpoint(raw: string, type: "chat" | "custom"): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (type === "custom") return trimmed;
  const base = trimmed.replace(/\/v1\/chat\/completions\/?$/i, "").trim();
  if (!base) return trimmed;
  return base + CHAT_COMPLETIONS_PATH;
}

// BYOM: конфиг читаем из chrome.storage.sync для локального OpenAI-совместимого endpoint (LM Studio на localhost:1234)
async function getLlmConfig(): Promise<LlmConfig | null> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        llmEndpoint: "http://localhost:1234",
        llmEndpointType: "chat" as "chat" | "custom",
        llmModel: "qwen/qwen3-4b-2507",
        llmApiKey: "",
        llmTemperature: 0.7,
        llmMaxTokens: 2048
      },
      (items) => {
        const raw = items.llmEndpoint;
        const type = items.llmEndpointType === "custom" ? "custom" : "chat";
        if (!raw || !items.llmModel) {
          resolve(null);
          return;
        }

        const endpoint = normalizeEndpoint(raw, type);
        if (!endpoint) {
          resolve(null);
          return;
        }

        resolve({
          endpoint,
          model: items.llmModel,
          apiKey: items.llmApiKey || undefined,
          temperature: items.llmTemperature || 0.7,
          maxTokens: items.llmMaxTokens || 2048
        });
      }
    );
  });
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
  pages: ConfluencePage[],
  payload: SummarizePayload
): Promise<{ text: string } | { error: string }> {
  const config = await getLlmConfig();
  if (!config) {
    return { error: "LLM endpoint is not configured. Configure LM Studio at localhost:1234" };
  }

  const prompt = buildSummaryPrompt(pages, payload.query);

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
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

    if (!response.ok) {
      return { error: `LLM request failed: ${response.status} ${response.statusText}` };
    }

    const data = await response.json();
    const text =
      data.choices?.[0]?.message?.content ??
      (typeof data === "string" ? data : JSON.stringify(data, null, 2));

    return { text };
  } catch (error) {
    return { error: `LLM request error: ${(error as Error).message}` };
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

  try {
    const systemPrompt = options.systemPrompt || buildChatSystemPrompt();
    const messagesWithSystem = [
      { role: "system" as const, content: systemPrompt },
      ...messages
    ];

    const response = await fetch(config.endpoint, {
      method: "POST",
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
    return { error: `LLM request error: ${(error as Error).message}` };
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

  try {
    const response = await fetch(config.endpoint, {
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
    return { error: `LLM request error: ${(error as Error).message}` };
  }
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

  const { onChunk, ...rest } = options;
  const systemPrompt = rest.systemPrompt || buildChatSystemPrompt();
  const messagesWithSystem = [
    { role: "system" as const, content: systemPrompt },
    ...messages
  ];

  try {
    const response = await fetch(config.endpoint, {
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

    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";

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

  try {
    const response = await fetch(config.endpoint, {
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

    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    const toolCallsByIndex = new Map<number, AccumulatedToolCall>();

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

    const response = await fetch(`${baseUrl}/v1/models`);
    if (!response.ok) return { error: `Failed to fetch models: ${response.status}` };

    const data = await response.json();
    const models = (data.data || []).map((m: { id?: string }) => m.id).filter(Boolean);
    return { models };
  } catch (error) {
    return { error: `Failed to get models: ${(error as Error).message}` };
  }
}

