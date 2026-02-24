import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkLmStudioHealth,
  getLMStudioModels,
  chatWithLLM,
  chatWithLLMStream,
  summarizePages,
  type LlmChatMessage,
  type LlmChatOptions
} from "../src/llm/client";
import mockLLMResponses from "../tests/mocks/llm-responses.json";

const mockGetCachedLlmResponse = vi.fn().mockResolvedValue(null);
const mockSetCachedLlmResponse = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/storage/indexdb", () => ({
  getCachedLlmResponse: (q: string) => mockGetCachedLlmResponse(q),
  setCachedLlmResponse: (...args: unknown[]) => mockSetCachedLlmResponse(...args),
}));

describe("LLM Client - Session #1 Integration with LM Studio", () => {
  // Mock fetch для тестирования без реального LM Studio
  beforeEach(() => {
    mockGetCachedLlmResponse.mockResolvedValue(null);
    mockSetCachedLlmResponse.mockResolvedValue(undefined);
    global.fetch = vi.fn();
    (global as any).chrome = {
      storage: {
        sync: {
          get: (defaults: any, callback: Function) => {
            callback({
              llmEndpoint: "http://localhost:1234/v1/chat/completions",
              llmModel: "qwen/qwen3-4b-2507",
              llmTemperature: 0.7,
              llmMaxTokens: 512
            });
          },
          set: vi.fn()
        },
        local: {
          get: (defaults: any, callback: Function) => {
            callback({ llmApiKey: "" });
          },
          set: vi.fn()
        }
      }
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("checkLmStudioHealth", () => {
    it("should return available:true when LM Studio is running", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "qwen/qwen3-4b-2507" }] })
      });

      const result = await checkLmStudioHealth();
      expect(result.available).toBe(true);
    });

    it("should return available:false when LM Studio is not available", async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error("Connection refused"));

      const result = await checkLmStudioHealth();
      expect(result.available).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle 404 response gracefully", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      const result = await checkLmStudioHealth();
      expect(result.available).toBe(false);
    });
  });

  describe("getLMStudioModels", () => {
    it("should return list of available models", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: "qwen/qwen3-4b-2507" },
            { id: "qwen/qwen3-7b" }
          ]
        })
      });

      const result = await getLMStudioModels();
      expect(result).toHaveProperty("models");
      if ("models" in result) {
        expect(result.models).toContain("qwen/qwen3-4b-2507");
      }
    });

    it("should handle no models gracefully", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] })
      });

      const result = await getLMStudioModels();
      expect(result).toHaveProperty("models");
      if ("models" in result) {
        expect(result.models).toHaveLength(0);
      }
    });
  });

  describe("chatWithLLM", () => {
    it("should send chat message and receive response", async () => {
      const mockResponse = mockLLMResponses.responses[0].response;

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: mockResponse
              }
            }
          ]
        })
      });

      const messages: LlmChatMessage[] = [
        { role: "user", content: "What is Confluence?" }
      ];

      const result = await chatWithLLM(messages);
      expect(result).toHaveProperty("text");
      expect("text" in result).toBe(true);
    });

    it("should use provided temperature and maxTokens", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: "assistant", content: "Test" } }]
        })
      });

      const messages: LlmChatMessage[] = [
        { role: "user", content: "Test" }
      ];

      const options: LlmChatOptions = {
        temperature: 0.5,
        maxTokens: 256
      };

      await chatWithLLM(messages, options);

      const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callBody.temperature).toBe(0.5);
      expect(callBody.max_tokens).toBe(256);
    });

    it("should handle system prompt in options", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: "assistant", content: "Test" } }]
        })
      });

      const messages: LlmChatMessage[] = [
        { role: "user", content: "Test" }
      ];

      const customSystemPrompt = "Custom system prompt";

      await chatWithLLM(messages, { systemPrompt: customSystemPrompt });

      const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(callBody.messages[0].content).toBe(customSystemPrompt);
    });

    it("should handle LLM error gracefully", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error"
      });

      const messages: LlmChatMessage[] = [
        { role: "user", content: "Test" }
      ];

      const result = await chatWithLLM(messages);
      expect(result).toHaveProperty("error");
      expect("error" in result).toBe(true);
    });

    it("should handle network timeout gracefully", async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error("Timeout"));

      const messages: LlmChatMessage[] = [
        { role: "user", content: "Test" }
      ];

      const result = await chatWithLLM(messages);
      expect(result).toHaveProperty("error");
    });

    it("should return cached response when cache has entry", async () => {
      mockGetCachedLlmResponse.mockResolvedValueOnce("Cached answer");
      const messages: LlmChatMessage[] = [{ role: "user", content: "Same question" }];
      const result = await chatWithLLM(messages);
      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("cached", true);
      if ("text" in result) expect(result.text).toBe("Cached answer");
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("chatWithLLMStream", () => {
    it("should return error when config is missing", async () => {
      (global as any).chrome.storage.sync.get = (_: any, cb: (v: any) => void) =>
        cb({ llmEndpoint: "", llmModel: "" });
      const result = await chatWithLLMStream(
        [{ role: "user", content: "Hi" }],
        { onChunk: () => {} }
      );
      expect(result).toHaveProperty("error");
    });

    it("should stream chunks and return full text", async () => {
      const chunks = ["Hello", " ", "world"];
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n') })
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":" "}}]}\n') })
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"world"}}]}\n') })
              .mockResolvedValueOnce({ done: true, value: undefined }),
          }),
        },
      });
      const onChunk = vi.fn();
      const result = await chatWithLLMStream(
        [{ role: "user", content: "Hi" }],
        { onChunk }
      );
      expect(result).toHaveProperty("text");
      if ("text" in result) expect(result.text).toBe("Hello world");
      expect(onChunk).toHaveBeenCalledTimes(3);
    });
  });

  describe("summarizePages", () => {
    it("should summarize pages with query", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Summary of pages"
              }
            }
          ]
        })
      });

      const pages = [
        {
          id: "page1",
          title: "Test Page",
          contentText: "Test content",
          url: "http://example.com/page1"
        }
      ];

      const result = await summarizePages(pages, {
        query: "What is this about?"
      });

      expect(result).toHaveProperty("text");
    });

    it("should handle empty pages gracefully", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: "No pages provided"
              }
            }
          ]
        })
      });

      const result = await summarizePages([], { pageIds: [], query: "" });
      expect(result).toHaveProperty("text");
    });
  });

  describe("LLM Configuration", () => {
    it("should use default config when not configured", async () => {
      const result = await checkLmStudioHealth();
      // Should have attempted connection even without explicit config
      expect(global.fetch).toHaveBeenCalled();
    });

    it("should support custom endpoint configuration", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "custom-model" }] })
      });

      const result = await getLMStudioModels();
      expect(global.fetch).toHaveBeenCalled();
    });
  });
});
