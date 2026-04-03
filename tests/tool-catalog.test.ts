import { describe, expect, it } from "vitest";
import {
  buildEnrichedToolCatalogMarkdown,
  buildToolCatalogMarkdown,
  narrowToolsByRelevancePlan,
  parseToolRelevancePlan
} from "../src/agent/tool-catalog";
import type { OpenAITool, ToolServerBinding } from "../src/mcp/agent-tools";

describe("buildToolCatalogMarkdown", () => {
  it("returns placeholder for empty tools", () => {
    expect(buildToolCatalogMarkdown([])).toBe("(no tools registered)");
  });

  it("lists name and description", () => {
    const tools: OpenAITool[] = [
      { type: "function", function: { name: "alpha", description: "Does A" } },
      { type: "function", function: { name: "beta" } }
    ];
    const md = buildToolCatalogMarkdown(tools);
    expect(md).toContain("alpha");
    expect(md).toContain("Does A");
    expect(md).toContain("beta");
  });
});

describe("buildEnrichedToolCatalogMarkdown", () => {
  it("marks MCP server name", () => {
    const tools: OpenAITool[] = [
      { type: "function", function: { name: "alpha", description: "A" } }
    ];
    const map = new Map<string, ToolServerBinding>([
      ["alpha", { serverUrl: "http://x", serverName: "srv1" }]
    ]);
    const md = buildEnrichedToolCatalogMarkdown(tools, map);
    expect(md).toContain("srv1");
    expect(md).toContain("alpha");
  });
});

describe("parseToolRelevancePlan / narrowToolsByRelevancePlan", () => {
  it("parses TOOL_PLAN_JSON line", () => {
    const text = "bullets\nTOOL_PLAN_JSON:{\"allow\":[\"t1\",\"t2\"]}";
    expect(parseToolRelevancePlan(text)).toEqual({ mode: "narrow", allow: ["t1", "t2"] });
  });

  it("narrows MCP tools and keeps builtins", () => {
    const tools: OpenAITool[] = [
      { type: "function", function: { name: "page_read", description: "p" } },
      { type: "function", function: { name: "mcp_a", description: "a" } },
      { type: "function", function: { name: "mcp_b", description: "b" } }
    ];
    const map = new Map<string, ToolServerBinding>([
      ["mcp_a", { serverUrl: "http://a", serverName: "s" }],
      ["mcp_b", { serverUrl: "http://b", serverName: "s" }]
    ]);
    const n = narrowToolsByRelevancePlan(tools, map, { mode: "narrow", allow: ["mcp_b"] });
    expect(n.tools.map((t) => t.function.name)).toEqual(["page_read", "mcp_b"]);
    expect(n.toolToServer.has("mcp_b")).toBe(true);
    expect(n.toolToServer.has("mcp_a")).toBe(false);
  });
});
