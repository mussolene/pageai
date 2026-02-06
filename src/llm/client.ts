import type { ConfluencePage, SummarizePayload } from "../types/messages";
import { buildSummaryPrompt } from "./prompts";

export interface LlmConfig {
  endpoint: string;
  apiKey?: string;
  model: string;
}

// BYOM: конфиг читаем из chrome.storage.sync, чтобы пользователь мог указать локальный OpenAI-совместимый endpoint.
async function getLlmConfig(): Promise<LlmConfig | null> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        llmEndpoint: "http://localhost:11434/v1/chat/completions",
        llmModel: "llama3.1",
        llmApiKey: ""
      },
      (items) => {
        if (!items.llmEndpoint || !items.llmModel) {
          resolve(null);
          return;
        }

        resolve({
          endpoint: items.llmEndpoint,
          model: items.llmModel,
          apiKey: items.llmApiKey || undefined
        });
      }
    );
  });
}

export async function summarizePages(
  pages: ConfluencePage[],
  payload: SummarizePayload
): Promise<{ text: string } | { error: string }> {
  const config = await getLlmConfig();
  if (!config) {
    return { error: "LLM endpoint is not configured" };
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
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1
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

