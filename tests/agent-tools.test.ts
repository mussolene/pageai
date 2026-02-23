import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getEnabledMcpToolsWithMap } from "../src/mcp/agent-tools";
import * as mcpClient from "../src/mcp/client";

vi.mock("../src/mcp/client", () => ({
  parseMcpServersList: vi.fn(),
  listMcpTools: vi.fn()
}));

describe("getEnabledMcpToolsWithMap", () => {
  beforeEach(() => {
    vi.mocked(mcpClient.parseMcpServersList).mockReturnValue({ servers: [] });
    vi.mocked(mcpClient.listMcpTools).mockResolvedValue({ tools: [] });
    (global as any).chrome = {
      storage: {
        sync: {
          get: (keys: any, cb: (r: any) => void) => {
            cb({
              mcpServersConfig: "{}",
              mcpServersEnabled: {}
            });
          }
        }
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty tools when no config", async () => {
    const result = await getEnabledMcpToolsWithMap();
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.tools).toHaveLength(0);
      expect(result.toolToServer.size).toBe(0);
    }
  });

  it("returns empty tools when all servers explicitly disabled", async () => {
    vi.mocked(mcpClient.parseMcpServersList).mockReturnValue({
      servers: [
        { name: "s1", url: "http://localhost:8007/mcp" },
        { name: "s2", url: "http://localhost:8008/mcp" }
      ]
    });
    (global as any).chrome.storage.sync.get = (_: any, cb: (r: any) => void) =>
      cb({
        mcpServersConfig: '{"mcpServers":{"s1":{"url":"http://localhost:8007/mcp"},"s2":{"url":"http://localhost:8008/mcp"}}}',
        mcpServersEnabled: { s1: false, s2: false }
      });
    const result = await getEnabledMcpToolsWithMap();
    if (!("error" in result)) {
      expect(result.tools).toHaveLength(0);
      expect(mcpClient.listMcpTools).not.toHaveBeenCalled();
    }
  });

  it("loads tools when mcpServersEnabled is empty (default: servers from config are enabled)", async () => {
    vi.mocked(mcpClient.parseMcpServersList).mockReturnValue({
      servers: [{ name: "example", url: "http://localhost:8007/mcp" }]
    });
    vi.mocked(mcpClient.listMcpTools).mockResolvedValue({
      tools: [{ name: "send_notification", description: "Send a notification", inputSchema: {} }]
    });
    (global as any).chrome.storage.sync.get = (_: any, cb: (r: any) => void) =>
      cb({
        mcpServersConfig: '{"mcpServers":{"example":{"url":"http://localhost:8007/mcp"}}}',
        mcpServersEnabled: {}
      });
    const result = await getEnabledMcpToolsWithMap();
    if (!("error" in result)) {
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].function.name).toBe("send_notification");
    }
    expect(mcpClient.listMcpTools).toHaveBeenCalled();
  });

  it("loads tools from enabled server and builds map", async () => {
    vi.mocked(mcpClient.parseMcpServersList).mockReturnValue({
      servers: [{ name: "example", url: "http://localhost:8007/mcp", headers: undefined }]
    });
    vi.mocked(mcpClient.listMcpTools).mockResolvedValue({
      tools: [
        { name: "get_weather", description: "Get weather", inputSchema: { type: "object" } },
        { name: "search", description: "Search" }
      ]
    });
    (global as any).chrome.storage.sync.get = (_: any, cb: (r: any) => void) =>
      cb({
        mcpServersConfig: '{"mcpServers":{"example":{"url":"http://localhost:8007/mcp"}}}',
        mcpServersEnabled: { example: true }
      });

    const result = await getEnabledMcpToolsWithMap();
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.tools).toHaveLength(2);
      expect(result.mcpConfigured).toBe(true);
      expect(result.tools[0].type).toBe("function");
      expect(result.tools[0].function.name).toBe("get_weather");
      expect(result.toolToServer.get("get_weather")).toEqual({
        serverUrl: "http://localhost:8007/mcp",
        headers: undefined
      });
      expect(result.toolToServer.get("search")).toBeDefined();
    }
    expect(mcpClient.listMcpTools).toHaveBeenCalledWith(
      "http://localhost:8007/mcp",
      expect.any(Object)
    );
  });

  it("skips server when listMcpTools returns error", async () => {
    vi.mocked(mcpClient.parseMcpServersList).mockReturnValue({
      servers: [
        { name: "bad", url: "http://localhost:8007/mcp" },
        { name: "good", url: "http://localhost:8008/mcp" }
      ]
    });
    vi.mocked(mcpClient.listMcpTools)
      .mockResolvedValueOnce({ error: "Connection failed" })
      .mockResolvedValueOnce({ tools: [{ name: "tool_a", description: "A" }] });
    (global as any).chrome.storage.sync.get = (_: any, cb: (r: any) => void) =>
      cb({
        mcpServersConfig: '{"mcpServers":{"bad":{"url":"http://localhost:8007/mcp"},"good":{"url":"http://localhost:8008/mcp"}}}',
        mcpServersEnabled: { bad: true, good: true }
      });

    const result = await getEnabledMcpToolsWithMap();
    if (!("error" in result)) {
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].function.name).toBe("tool_a");
    }
  });

  it("skips server when listMcpTools throws", async () => {
    vi.mocked(mcpClient.parseMcpServersList).mockReturnValue({
      servers: [
        { name: "bad", url: "http://localhost:8007/mcp" },
        { name: "good", url: "http://localhost:8008/mcp" }
      ]
    });
    vi.mocked(mcpClient.listMcpTools)
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ tools: [{ name: "tool_a", description: "A" }] });
    (global as any).chrome.storage.sync.get = (_: any, cb: (r: any) => void) =>
      cb({
        mcpServersConfig: '{"mcpServers":{"bad":{"url":"http://localhost:8007/mcp"},"good":{"url":"http://localhost:8008/mcp"}}}',
        mcpServersEnabled: { bad: true, good: true }
      });

    const result = await getEnabledMcpToolsWithMap();
    if (!("error" in result)) {
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].function.name).toBe("tool_a");
    }
  });
});
