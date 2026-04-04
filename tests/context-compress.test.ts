import { afterEach, describe, expect, it, vi } from "vitest";
import { truncateMiddle, createToolContentFinalizer } from "../src/agent/context-compress";
import { mergeOrchestratorSettings } from "../src/agent/orchestrator-settings";
import * as llmClient from "../src/llm/client";

describe("truncateMiddle", () => {
  it("returns short string unchanged", () => {
    expect(truncateMiddle("hi", 100)).toBe("hi");
  });

  it("keeps start and end for long string", () => {
    const s = "a".repeat(200);
    const out = truncateMiddle(s, 80);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.startsWith("aaa")).toBe(true);
    expect(out.includes("truncated")).toBe(true);
    expect(out.endsWith("aaa")).toBe(true);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createToolContentFinalizer", () => {
  it("passes through when compress disabled", async () => {
    const fin = createToolContentFinalizer(
      mergeOrchestratorSettings({ orchestratorCompressEnabled: false })
    );
    const raw = "x".repeat(50_000);
    expect(await fin("mcp_tool", raw)).toBe(raw);
  });

  it("truncates only in truncate mode when over min", async () => {
    const fin = createToolContentFinalizer(
      mergeOrchestratorSettings({
        orchestratorCompressEnabled: true,
        orchestratorCompressMinChars: 1500,
        orchestratorCompressMaxInputChars: 50000,
        orchestratorCompressTargetChars: 500,
        orchestratorCompressMode: "truncate"
      })
    );
    const raw = "b".repeat(2000);
    const out = await fin("t", raw);
    expect(out.length).toBeLessThan(raw.length);
    expect(out).toContain("Truncated tool output");
  });

  it("calls LLM in llm mode when over min", async () => {
    vi.spyOn(llmClient, "chatWithLLMSubtask").mockResolvedValue({ text: "short summary" });
    const fin = createToolContentFinalizer(
      mergeOrchestratorSettings({
        orchestratorCompressEnabled: true,
        orchestratorCompressMinChars: 1500,
        orchestratorCompressMaxInputChars: 10000,
        orchestratorCompressTargetChars: 800,
        orchestratorCompressMode: "llm"
      })
    );
    const raw = "c".repeat(2000);
    const out = await fin("big_tool", raw);
    expect(out).toContain("Compressed tool output");
    expect(out).toContain("short summary");
  });
});
