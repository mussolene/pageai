import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkMcpConnection,
  parseMcpServersConfigForCheck,
  parseMcpServersList,
  listMcpTools,
  callMcpTool,
  getDefaultMcpServersConfig,
} from "../src/mcp/client";

describe("checkMcpConnection", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns error for empty URL", async () => {
    const r = await checkMcpConnection("");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("empty");
  });

  it("returns error for whitespace-only URL", async () => {
    const r = await checkMcpConnection("   ");
    expect(r.ok).toBe(false);
  });

  it("returns error for invalid URL", async () => {
    const r = await checkMcpConnection("not-a-url");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Invalid");
  });

  it("returns error for non-http(s) URL", async () => {
    const r = await checkMcpConnection("file:///tmp/mcp");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("http");
  });

  it("returns ok for 200 + valid JSON", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('{"jsonrpc":"2.0","id":1,"result":{}}'),
    });
    const r = await checkMcpConnection("http://localhost:8007/mcp");
    expect(r.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8007/mcp",
      expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" } })
    );
  });

  it("returns error when server returns non-ok status", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    const r = await checkMcpConnection("https://example.com/mcp");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("404");
  });

  it("returns error when response is not valid JSON", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("not json"),
    });
    const r = await checkMcpConnection("http://localhost:8007/mcp");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("valid JSON");
  });

  it("returns connection timeout on abort", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("abort"));
    const r = await checkMcpConnection("http://localhost:8007/mcp");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("timeout");
  });

  it("returns error message on other fetch error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));
    const r = await checkMcpConnection("http://localhost:8007/mcp");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Network error");
  });

  it("trims URL before use", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("{}"),
    });
    await checkMcpConnection("  http://localhost:8007/mcp  ");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8007/mcp",
      expect.any(Object)
    );
  });

  it("sends custom headers when options.headers provided", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("{}"),
    });
    await checkMcpConnection("http://localhost:8007/mcp", {
      headers: { Authorization: "Bearer token", "X-Custom": "value" },
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8007/mcp",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer token",
          "X-Custom": "value",
        }),
      })
    );
  });
});

describe("parseMcpServersConfigForCheck", () => {
  it("returns error for empty string", () => {
    const r = parseMcpServersConfigForCheck("");
    expect("error" in r && r.error).toContain("empty");
  });

  it("returns error for invalid JSON", () => {
    const r = parseMcpServersConfigForCheck("not json");
    expect("error" in r && r.error).toContain("Invalid");
  });

  it("returns error when mcpServers missing", () => {
    const r = parseMcpServersConfigForCheck("{}");
    expect("error" in r && r.error).toContain("mcpServers");
  });

  it("returns error when no server has url", () => {
    const r = parseMcpServersConfigForCheck(
      '{"mcpServers":{"a":{"command":"python -m mcp"}}}'
    );
    expect("error" in r && r.error).toContain("No server with url");
  });

  it("returns first server url and headers", () => {
    const r = parseMcpServersConfigForCheck(
      '{"mcpServers":{"s1":{"url":"http://localhost:8000/mcp","headers":{"Auth":"Bearer x"}}}}'
    );
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.url).toBe("http://localhost:8000/mcp");
      expect(r.headers).toEqual({ Auth: "Bearer x" });
    }
  });

  it("returns url without headers when headers missing", () => {
    const r = parseMcpServersConfigForCheck(
      '{"mcpServers":{"s1":{"url":"http://localhost:8007/mcp"}}}'
    );
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.url).toBe("http://localhost:8007/mcp");
      expect(r.headers).toBeUndefined();
    }
  });
});

describe("getDefaultMcpServersConfig", () => {
  it("returns valid JSON with mcpServers", () => {
    const json = getDefaultMcpServersConfig();
    const parsed = JSON.parse(json);
    expect(parsed.mcpServers).toBeDefined();
    expect(typeof parsed.mcpServers).toBe("object");
  });
});

describe("parseMcpServersList", () => {
  it("returns empty servers for empty string", () => {
    const r = parseMcpServersList("");
    expect("servers" in r && r.servers).toEqual([]);
  });

  it("returns empty servers for invalid JSON", () => {
    const r = parseMcpServersList("not json");
    expect("error" in r).toBe(true);
  });

  it("returns empty list when mcpServers is missing", () => {
    const r = parseMcpServersList("{}");
    expect("servers" in r && r.servers).toEqual([]);
  });

  it("returns list of servers with url", () => {
    const r = parseMcpServersList(
      '{"mcpServers":{"a":{"url":"http://localhost:8000"},"b":{"url":"http://localhost:8001","headers":{"X-Token":"y"}}}}'
    );
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.servers).toHaveLength(2);
      expect(r.servers[0].name).toBe("a");
      expect(r.servers[0].url).toBe("http://localhost:8000");
      expect(r.servers[1].headers).toEqual({ "X-Token": "y" });
    }
  });

  it("skips entries without url", () => {
    const r = parseMcpServersList(
      '{"mcpServers":{"withUrl":{"url":"http://x"},"noUrl":{"command":"python"}}}'
    );
    if (!("error" in r)) expect(r.servers).toHaveLength(1);
  });
});

describe("listMcpTools", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns error for empty URL", async () => {
    const r = await listMcpTools("");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("empty");
  });

  it("returns tools when initialize and tools/list succeed", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: {
              tools: [
                { name: "tool_a", description: "Does A" },
                { name: "tool_b", inputSchema: {} },
              ],
            },
          }),
      });
    const r = await listMcpTools("http://localhost:8007/mcp");
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.tools).toHaveLength(2);
      expect(r.tools[0].name).toBe("tool_a");
    }
  });

  it("returns error when initialize fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
    });
    const r = await listMcpTools("http://localhost:8007/mcp");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("Initialize");
  });

  it("returns error when tools/list returns JSON-RPC error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ error: { message: "Not authorized" } }),
      });
    const r = await listMcpTools("http://localhost:8007/mcp");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("Not authorized");
  });

  it("returns empty tools when result.tools is missing", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: {} }),
      });
    const r = await listMcpTools("http://localhost:8007/mcp");
    if (!("error" in r)) expect(r.tools).toEqual([]);
  });
});

describe("callMcpTool", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns error for empty URL", async () => {
    const r = await callMcpTool("", "get_weather");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("empty");
  });

  it("returns error for empty tool name", async () => {
    const r = await callMcpTool("http://localhost:8007/mcp", "");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("name");
  });

  it("returns error for whitespace-only tool name", async () => {
    const r = await callMcpTool("http://localhost:8007/mcp", "   ");
    expect("error" in r).toBe(true);
  });

  it("returns text from result.content on success", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          result: {
            content: [{ type: "text", text: "Temperature: 72°F" }],
          },
        }),
    });
    const r = await callMcpTool("http://localhost:8007/mcp", "get_weather");
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.text).toBe("Temperature: 72°F");
  });

  it("concatenates multiple content items", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          result: {
            content: [
              { type: "text", text: "Part one. " },
              { type: "text", text: "Part two." },
            ],
          },
        }),
    });
    const r = await callMcpTool("http://localhost:8007/mcp", "multi");
    if (!("error" in r)) expect(r.text).toBe("Part one. Part two.");
  });

  it("sends tool name and arguments in request body", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: { content: [{ type: "text", text: "ok" }] } }),
    });
    await callMcpTool("http://localhost:8007/mcp", "get_weather", { location: "Moscow" });
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("get_weather");
    expect(body.params.arguments).toEqual({ location: "Moscow" });
  });

  it("sends empty object when args omitted", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: { content: [] } }),
    });
    await callMcpTool("http://localhost:8007/mcp", "no_args");
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.params.arguments).toEqual({});
  });

  it("returns error when response has error.message", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ error: { message: "Tool not found" } }),
    });
    const r = await callMcpTool("http://localhost:8007/mcp", "unknown_tool");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("Tool not found");
  });

  it("returns error when content is not array", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: { content: "not-array" } }),
    });
    const r = await callMcpTool("http://localhost:8007/mcp", "bad");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("content");
  });

  it("returns error when HTTP not ok", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
    });
    const r = await callMcpTool("http://localhost:8007/mcp", "get_weather");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("500");
  });

  it("uses custom headers when options provided", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: { content: [] } }),
    });
    await callMcpTool("http://localhost:8007/mcp", "tool", undefined, {
      headers: { Authorization: "Bearer x" },
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8007/mcp",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer x" }),
      })
    );
  });

  it("returns Request timeout on abort", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("abort"));
    const r = await callMcpTool("http://localhost:8007/mcp", "slow");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("timeout");
  });
});
