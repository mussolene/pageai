import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chatWithLLMOneRound, type LlmMessageForApi, type LlmToolDef } from "../src/llm/client";

describe("chatWithLLMOneRound", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    (global as any).chrome = {
      storage: {
        sync: {
          get: (defaults: any, cb: (v: any) => void) =>
            cb({
              llmEndpoint: "http://localhost:1234/v1/chat/completions",
              llmModel: "test-model",
              llmTemperature: 0.7,
              llmMaxTokens: 2048
            })
        },
        local: {
          get: (defaults: any, cb: (v: any) => void) => cb({ llmApiKey: "" }),
          set: vi.fn()
        }
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns text when response has content", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { role: "assistant", content: "Hello!" } }]
        })
    });
    const result = await chatWithLLMOneRound([{ role: "user", content: "Hi" }]);
    expect("error" in result).toBe(false);
    expect("text" in result).toBe(true);
    if ("text" in result) expect(result.text).toBe("Hello!");
  });

  it("returns error when LLM not configured", async () => {
    (global as any).chrome.storage.sync.get = (_: any, cb: (v: any) => void) =>
      cb({ llmEndpoint: "", llmModel: "" });
    const result = await chatWithLLMOneRound([{ role: "user", content: "Hi" }]);
    expect("error" in result).toBe(true);
  });

  it("returns error when fetch fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Server Error")
    });
    const result = await chatWithLLMOneRound([{ role: "user", content: "Hi" }]);
    expect("error" in result).toBe(true);
  });

  it("sends tools in body when provided", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { role: "assistant", content: "Done" } }]
        })
    });
    const tools: LlmToolDef[] = [
      {
        type: "function",
        function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } }
      }
    ];
    await chatWithLLMOneRound([{ role: "user", content: "Weather?" }], { tools });
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe("auto");
  });

  it("returns tool_calls when response has tool_calls", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "get_weather", arguments: '{"location":"Moscow"}' }
                  }
                ]
              }
            }
          ]
        })
    });
    const tools: LlmToolDef[] = [
      { type: "function", function: { name: "get_weather", description: "Weather" } }
    ];
    const result = await chatWithLLMOneRound([{ role: "user", content: "Weather in Moscow?" }], {
      tools
    });
    expect("tool_calls" in result).toBe(true);
    if ("tool_calls" in result) {
      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls[0].id).toBe("call_1");
      expect(result.tool_calls[0].name).toBe("get_weather");
      expect(result.tool_calls[0].arguments).toBe('{"location":"Moscow"}');
    }
  });

  it("accepts messages with assistant tool_calls and tool results", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { role: "assistant", content: "Temperature is 20°C." } }]
        })
    });
    const messages: LlmMessageForApi[] = [
      { role: "user", content: "Weather?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "get_weather", arguments: "{}" } }
        ]
      },
      { role: "tool", tool_call_id: "c1", content: "20°C" }
    ];
    const result = await chatWithLLMOneRound(messages);
    if ("text" in result) expect(result.text).toBe("Temperature is 20°C.");
  });
});
