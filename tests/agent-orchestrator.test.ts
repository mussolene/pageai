import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_AGENT_TOOL_ITERATIONS,
  orchestrateSyncAgent,
  parseXmlStyleToolCalls,
  resolveToolCallsForRound
} from "../src/agent/orchestrator";
import type { LlmMessageForApi } from "../src/llm/client";
import type { OpenAITool } from "../src/mcp/agent-tools";

describe("parseXmlStyleToolCalls", () => {
  it("parses empty page_read", () => {
    const calls = parseXmlStyleToolCalls("<function=page_read> </function>");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("page_read");
    expect(calls[0]?.arguments).toBe("{}");
  });

  it("parses open_search_tab with parameters", () => {
    const text = `<function=open_search_tab>
<parameter=query>hello</parameter>
</function>`;
    const calls = parseXmlStyleToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("open_search_tab");
    expect(JSON.parse(calls[0]?.arguments ?? "{}")).toEqual({ query: "hello" });
  });

  it("normalizes legacy web_search xml to open_search_tab", () => {
    const text = `<function=web_search>
<parameter=query>legacy</parameter>
</function>`;
    const calls = parseXmlStyleToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("open_search_tab");
    expect(JSON.parse(calls[0]?.arguments ?? "{}")).toEqual({ query: "legacy" });
  });

  it("parses web_research with parameters", () => {
    const text = `<function=web_research>
<parameter=query>rust async</parameter>
<parameter=max_depth>1</parameter>
</function>`;
    const calls = parseXmlStyleToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("web_research");
    expect(JSON.parse(calls[0]?.arguments ?? "{}")).toEqual({ query: "rust async", max_depth: "1" });
  });
});

describe("resolveToolCallsForRound", () => {
  it("prefers API tool_calls over XML in text", () => {
    const api = [{ id: "1", name: "page_read", arguments: "{}" }];
    const r = resolveToolCallsForRound(
      { text: "<function=open_search_tab><parameter=query>x</parameter></function>", tool_calls: api },
      { hasBrowserTools: true }
    );
    expect(r).toEqual(api);
  });

  it("falls back to XML when no API calls", () => {
    const r = resolveToolCallsForRound(
      { text: "<function=page_read></function>", tool_calls: undefined },
      { hasBrowserTools: true }
    );
    expect(r).not.toBeNull();
    expect(r?.[0]?.name).toBe("page_read");
  });

  it("does not use XML when browser tools disabled", () => {
    const r = resolveToolCallsForRound(
      { text: "<function=page_read></function>", tool_calls: undefined },
      { hasBrowserTools: false }
    );
    expect(r).toBeNull();
  });
});

describe("orchestrateSyncAgent", () => {
  it("runs tool round then returns final text", async () => {
    const tools: OpenAITool[] = [
      { type: "function", function: { name: "dummy", description: "x" } }
    ];
    const toolToServer = new Map();
    const executeTools = vi.fn().mockResolvedValue([
      { name: "dummy", args: "{}", result: "ok" }
    ]);
    let round = 0;
    const callLlmOneRound = vi.fn((_messages: LlmMessageForApi[]) => {
      round += 1;
      if (round === 1) {
        return Promise.resolve({
          tool_calls: [{ id: "a", name: "dummy", arguments: "{}" }]
        });
      }
      return Promise.resolve({ text: "Done." });
    });

    const out = await orchestrateSyncAgent(
      "hi",
      { systemPrompt: "sys", tools, toolToServer },
      {
        hasBrowserTools: false,
        callLlmOneRound,
        executeTools
      }
    );

    expect("error" in out).toBe(false);
    if ("text" in out) {
      expect(out.text).toBe("Done.");
      expect(out.metrics.stopReason).toBe("user_answer");
      expect(out.metrics.mainLlmRounds).toBe(2);
      expect(out.metrics.toolExecutionRounds).toBe(1);
    }
    expect(callLlmOneRound).toHaveBeenCalledTimes(2);
    expect(executeTools).toHaveBeenCalledTimes(1);
  });

  it("after main budget uses verdict text or synthesis instead of bare max_iterations error", async () => {
    const tools: OpenAITool[] = [
      { type: "function", function: { name: "dummy", description: "x" } }
    ];
    const executeTools = vi.fn().mockResolvedValue([
      { name: "dummy", args: "{}", result: "ok" }
    ]);
    const callLlmOneRound = vi.fn(
      (_messages: LlmMessageForApi[], opts: { systemPrompt: string; tools: OpenAITool[] }) => {
        if (opts.tools.length === 0) {
          return Promise.resolve({ text: "Synth answer." });
        }
        const i = callLlmOneRound.mock.calls.length;
        if (i <= 2) {
          return Promise.resolve({
            tool_calls: [{ id: "a", name: "dummy", arguments: "{}" }]
          });
        }
        return Promise.resolve({ text: "Verdict answer." });
      }
    );

    const out = await orchestrateSyncAgent(
      "hi",
      { systemPrompt: "sys", tools, toolToServer: new Map() },
      {
        maxIterations: 2,
        hasBrowserTools: false,
        callLlmOneRound,
        executeTools
      }
    );

    expect("text" in out).toBe(true);
    if ("text" in out) expect(out.text).toBe("Verdict answer.");
    expect(callLlmOneRound.mock.calls.length).toBeGreaterThan(2);
  });

  it("prepends plan block to system when subtasks plan returns text", async () => {
    const tools: OpenAITool[] = [
      { type: "function", function: { name: "dummy", description: "x" } }
    ];
    const executeTools = vi.fn().mockResolvedValue([]);
    const runPlanSubtask = vi.fn().mockResolvedValue({ text: "- step one\n- step two" });
    let capturedSystem = "";
    const callLlmOneRound = vi.fn((_messages: LlmMessageForApi[], opts: { systemPrompt: string }) => {
      capturedSystem = opts.systemPrompt;
      return Promise.resolve({ text: "Final." });
    });

    const out = await orchestrateSyncAgent(
      "hi",
      { systemPrompt: "BASE", tools, toolToServer: new Map() },
      {
        hasBrowserTools: false,
        callLlmOneRound,
        executeTools,
        subtasks: {
          enablePlan: true,
          enableVerify: false,
          runPlanSubtask
        }
      }
    );

    expect("text" in out).toBe(true);
    if ("text" in out) expect(out.metrics.subtasks.planExecuted).toBe(true);
    expect(runPlanSubtask).toHaveBeenCalledWith("hi");
    expect(capturedSystem).toContain("[SUB-PLAN");
    expect(capturedSystem).toContain("step one");
  });
});

describe("DEFAULT_MAX_AGENT_TOOL_ITERATIONS", () => {
  it("defaults to 10", () => {
    expect(DEFAULT_MAX_AGENT_TOOL_ITERATIONS).toBe(10);
  });
});
