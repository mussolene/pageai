import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  truncateWithTruncatedMarker,
  aggregateMcpPromptsForServers,
  DEFAULT_MCP_AGENT_PROMPTS_LIMITS,
} from "../src/mcp/agent-prompts";
import { listMcpPrompts, getMcpPrompt } from "../src/mcp/client";

vi.mock("../src/mcp/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/mcp/client")>();
  return {
    ...actual,
    listMcpPrompts: vi.fn(),
    getMcpPrompt: vi.fn(),
  };
});

describe("truncateWithTruncatedMarker", () => {
  it("returns unchanged when under limit", () => {
    expect(truncateWithTruncatedMarker("abc", 10)).toBe("abc");
  });

  it("truncates and appends marker", () => {
    const long = "a".repeat(100);
    const out = truncateWithTruncatedMarker(long, 20);
    expect(out.endsWith("\n[truncated]")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20);
  });
});

describe("aggregateMcpPromptsForServers", () => {
  beforeEach(() => {
    vi.mocked(listMcpPrompts).mockResolvedValue({
      prompts: [{ name: "doc", description: "D" }],
    });
    vi.mocked(getMcpPrompt).mockResolvedValue({ text: "body text" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("builds MCP_PROMPTS block per server", async () => {
    const r = await aggregateMcpPromptsForServers(
      [{ name: "srv", url: "http://localhost:9/mcp" }],
      DEFAULT_MCP_AGENT_PROMPTS_LIMITS
    );
    expect(r.block).toContain("[MCP_PROMPTS — srv]");
    expect(r.block).toContain("### doc");
    expect(r.block).toContain("body text");
    expect(r.block).toContain("[/MCP_PROMPTS]");
  });

  it("respects maxPromptsPerServer", async () => {
    vi.mocked(listMcpPrompts).mockResolvedValue({
      prompts: [{ name: "a" }, { name: "b" }, { name: "c" }],
    });
    await aggregateMcpPromptsForServers([{ name: "s", url: "http://x/mcp" }], {
      ...DEFAULT_MCP_AGENT_PROMPTS_LIMITS,
      maxPromptsPerServer: 2,
    });
    expect(getMcpPrompt).toHaveBeenCalledTimes(2);
  });

  it("records loadErrors when getMcpPrompt fails", async () => {
    vi.mocked(getMcpPrompt).mockResolvedValue({ error: "nope" });
    const r = await aggregateMcpPromptsForServers(
      [{ name: "srv", url: "http://localhost:9/mcp" }],
      DEFAULT_MCP_AGENT_PROMPTS_LIMITS
    );
    expect(r.block).toBe("");
    expect(r.loadErrors?.["srv/doc"]).toBe("nope");
  });
});
