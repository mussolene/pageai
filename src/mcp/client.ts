/**
 * MCP (Model Context Protocol) connection check.
 * Supports URL transport with optional headers; stdio (command/args) stored in config.
 * Compatible with Streamable HTTP (2025-03-26) and legacy HTTP+SSE (2024-11-05).
 */

const MCP_ACCEPT = "application/json, text/event-stream";
const MCP_PROTOCOL_VERSION = "2025-03-26";

/** Declared on initialize for prompts/list + prompts/get (servers without prompts ignore). */
const MCP_CLIENT_CAPABILITIES_WITH_PROMPTS: Record<string, Record<string, unknown>> = {
  prompts: {}
};

function buildMcpHeaders(userHeaders?: Record<string, string>): HeadersInit {
  return {
    "Content-Type": "application/json",
    Accept: MCP_ACCEPT,
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    ...(userHeaders && typeof userHeaders === "object" ? userHeaders : {})
  };
}

/**
 * Parse MCP HTTP response: supports application/json and text/event-stream (SSE).
 * Returns parsed JSON-RPC object or null if body is empty/invalid.
 */
async function parseMcpResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  const ct = (response.headers?.get?.("content-type") as string | undefined) ?? "";
  if (ct.includes("text/event-stream")) {
    const lastData = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).pop();
    const dataLine = lastData?.replace(/^data:\s*/, "").trim();
    if (!dataLine || dataLine === "[DONE]" || dataLine === "") return null;
    try {
      return JSON.parse(dataLine) as unknown;
    } catch {
      return null;
    }
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export interface McpCheckResult {
  ok: boolean;
  error?: string;
}

export interface McpConnectionOptions {
  headers?: Record<string, string>;
  args?: string[] | Record<string, unknown>;
}

/** Server entry in mcpServers config: URL transport or stdio (command + args). */
export interface McpServerEntry {
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[] | Record<string, unknown>;
}

export interface McpServersConfig {
  mcpServers?: Record<string, McpServerEntry>;
}

/** Empty by default so users don't get "example: Failed to fetch" until they add a real server. */
const DEFAULT_MCP_CONFIG = `{
  "mcpServers": {}
}`;

export interface McpServerInfo {
  /** Ключ сервера из настроек (mcpServers[key]). */
  name: string;
  url?: string;
  headers?: Record<string, string>;
}

/** Parse JSON config; returns first server that has "url" for connection check. */
export function parseMcpServersConfigForCheck(
  json: string
): { url: string; headers?: Record<string, string> } | { error: string } {
  if (!json.trim()) return { error: "MCP config is empty" };
  let data: McpServersConfig;
  try {
    data = JSON.parse(json) as McpServersConfig;
  } catch {
    return { error: "Invalid JSON" };
  }
  const servers = data.mcpServers;
  if (!servers || typeof servers !== "object") return { error: "Missing mcpServers object" };
  for (const name of Object.keys(servers)) {
    const s = servers[name];
    if (s && typeof s === "object" && typeof s.url === "string" && s.url.trim()) {
      return {
        url: s.url.trim(),
        headers: s.headers && typeof s.headers === "object" ? s.headers : undefined
      };
    }
  }
  return { error: "No server with url in mcpServers" };
}

/** Parse full mcpServers config into a list of server infos (name, url, headers). Only entries with url are included. */
export function parseMcpServersList(json: string): { servers: McpServerInfo[] } | { error: string } {
  if (!json.trim()) return { servers: [] };
  let data: McpServersConfig;
  try {
    data = JSON.parse(json) as McpServersConfig;
  } catch {
    return { error: "Invalid JSON" };
  }
  const raw = data.mcpServers;
  if (!raw || typeof raw !== "object") return { servers: [] };
  const servers: McpServerInfo[] = [];
  for (const key of Object.keys(raw)) {
    const s = raw[key];
    if (s && typeof s === "object" && typeof s.url === "string" && s.url.trim()) {
      const name = (key && String(key).trim()) || "mcp";
      servers.push({
        name,
        url: s.url.trim(),
        headers: s.headers && typeof s.headers === "object" ? s.headers : undefined
      });
    }
  }
  return { servers };
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Call MCP server: initialize then tools/list. Returns list of tools or error. */
export async function listMcpTools(
  serverUrl: string,
  options?: McpConnectionOptions
): Promise<{ tools: McpToolInfo[] } | { error: string }> {
  const url = serverUrl.trim();
  if (!url) return { error: "MCP server URL is empty" };
  const headers = buildMcpHeaders(options?.headers);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const initRes = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "page-ai", version: "0.1.0" }
        }
      }),
      signal: controller.signal
    });
    if (!initRes.ok) {
      return { error: `Initialize: ${initRes.status} ${initRes.statusText}` };
    }
    const sessionId = initRes.headers.get("mcp-session-id");
    const sessionHeaders: HeadersInit = sessionId ? { ...headers, "MCP-Session-Id": sessionId } : headers;
    await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      signal: controller.signal
    });
    const listRes = await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!listRes.ok) {
      return { error: `tools/list: ${listRes.status} ${listRes.statusText}` };
    }
    const parsed = await parseMcpResponse(listRes);
    const data = parsed as { result?: { tools?: McpToolInfo[] }; error?: { message?: string } } | null;
    if (!data) {
      return { error: "Server did not return valid JSON" };
    }
    if (data.error?.message) {
      return { error: data.error.message };
    }
    const tools = Array.isArray(data.result?.tools) ? data.result.tools : [];
    return { tools };
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.includes("abort") ? "Request timeout" : msg };
  }
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptInfo {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

function isPromptsMethodUnsupported(
  httpOk: boolean,
  httpStatus: number,
  rpcError?: { code?: number; message?: string }
): boolean {
  if (!httpOk && (httpStatus === 404 || httpStatus === 405 || httpStatus === 501)) return true;
  if (rpcError?.code === -32601) return true;
  const msg = (rpcError?.message ?? "").toLowerCase();
  if (msg.includes("method not found")) return true;
  if (msg.includes("unknown method")) return true;
  return false;
}

/**
 * Call MCP server: initialize (with prompts capability) then prompts/list.
 * If the server does not implement prompts, returns an empty list (no error).
 */
export async function listMcpPrompts(
  serverUrl: string,
  options?: McpConnectionOptions
): Promise<{ prompts: McpPromptInfo[] } | { error: string }> {
  const url = serverUrl.trim();
  if (!url) return { error: "MCP server URL is empty" };
  const headers = buildMcpHeaders(options?.headers);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const initRes = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: MCP_CLIENT_CAPABILITIES_WITH_PROMPTS,
          clientInfo: { name: "page-ai", version: "0.1.0" }
        }
      }),
      signal: controller.signal
    });
    if (!initRes.ok) {
      return { error: `Initialize: ${initRes.status} ${initRes.statusText}` };
    }
    const sessionId = initRes.headers.get("mcp-session-id");
    const sessionHeaders: HeadersInit = sessionId ? { ...headers, "MCP-Session-Id": sessionId } : headers;
    await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      signal: controller.signal
    });
    const listRes = await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "prompts/list",
        params: {}
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!listRes.ok) {
      if (isPromptsMethodUnsupported(false, listRes.status)) return { prompts: [] };
      return { error: `prompts/list: ${listRes.status} ${listRes.statusText}` };
    }
    const parsed = await parseMcpResponse(listRes);
    const data = parsed as {
      result?: { prompts?: McpPromptInfo[] };
      error?: { code?: number; message?: string };
    } | null;
    if (!data) {
      return { error: "Server did not return valid JSON" };
    }
    if (data.error) {
      if (isPromptsMethodUnsupported(true, listRes.status, data.error)) return { prompts: [] };
      return { error: data.error.message ?? "prompts/list failed" };
    }
    const prompts = Array.isArray(data.result?.prompts) ? data.result.prompts : [];
    const normalized: McpPromptInfo[] = prompts
      .filter((p): p is McpPromptInfo => p && typeof p === "object" && typeof p.name === "string" && p.name.trim() !== "")
      .map((p) => {
        const rawArgs = Array.isArray(p.arguments) ? p.arguments : undefined;
        const arguments_ =
          rawArgs
            ?.filter(
              (a): a is McpPromptArgument =>
                Boolean(a && typeof a === "object" && typeof (a as { name?: string }).name === "string" && String((a as { name: string }).name).trim() !== "")
            )
            .map((a) => {
              const o = a as { name: string; description?: string; required?: boolean };
              return {
                name: o.name.trim(),
                description: typeof o.description === "string" ? o.description : undefined,
                required: typeof o.required === "boolean" ? o.required : undefined
              };
            }) ?? undefined;
        return {
          name: p.name.trim(),
          description: typeof p.description === "string" ? p.description : undefined,
          arguments: arguments_ && arguments_.length > 0 ? arguments_ : undefined
        };
      });
    return { prompts: normalized };
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.includes("abort") ? "Request timeout" : msg };
  }
}

/** One content part inside a prompt message (MCP text / resource). */
function mcpPromptPartToText(part: unknown): string {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const o = part as { type?: string; text?: string };
  if (o.type === "text" && typeof o.text === "string") return o.text;
  return "";
}

/**
 * Convert prompts/get `messages[].content` to a single plain string for the system prompt.
 * Exported for unit tests.
 */
export function mcpPromptMessagesToPlainText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const chunks: string[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const content = (msg as { content?: unknown }).content;
    if (typeof content === "string") {
      if (content.trim()) chunks.push(content);
      continue;
    }
    if (Array.isArray(content)) {
      const t = content.map(mcpPromptPartToText).join("");
      if (t.trim()) chunks.push(t);
    } else {
      const t = mcpPromptPartToText(content);
      if (t.trim()) chunks.push(t);
    }
  }
  return chunks.join("\n\n");
}

export interface McpPromptGetResult {
  text: string;
}

/**
 * Call MCP prompts/get after initialize + notifications/initialized (same session as listMcpPrompts).
 */
export async function getMcpPrompt(
  serverUrl: string,
  promptName: string,
  promptArguments?: Record<string, unknown>,
  options?: McpConnectionOptions
): Promise<McpPromptGetResult | { error: string }> {
  const url = serverUrl.trim();
  if (!url) return { error: "MCP server URL is empty" };
  if (!promptName || typeof promptName !== "string" || !promptName.trim()) {
    return { error: "Prompt name is required" };
  }
  const headers = buildMcpHeaders(options?.headers);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const args = promptArguments && typeof promptArguments === "object" ? promptArguments : {};
  const getBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "prompts/get",
    params: {
      name: promptName.trim(),
      arguments: args
    }
  });

  try {
    const initRes = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: MCP_CLIENT_CAPABILITIES_WITH_PROMPTS,
          clientInfo: { name: "page-ai", version: "0.1.0" }
        }
      }),
      signal: controller.signal
    });
    if (!initRes.ok) {
      return { error: `Initialize: ${initRes.status} ${initRes.statusText}` };
    }
    const sessionId = initRes.headers.get("mcp-session-id");
    const sessionHeaders: HeadersInit = sessionId ? { ...headers, "MCP-Session-Id": sessionId } : headers;
    await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      signal: controller.signal
    });
    const getRes = await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: getBody,
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!getRes.ok) {
      return { error: `prompts/get: ${getRes.status} ${getRes.statusText}` };
    }
    const parsed = await parseMcpResponse(getRes);
    const data = parsed as {
      result?: { messages?: unknown; description?: string };
      error?: { message?: string };
    } | null;
    if (!data) return { error: "Server did not return valid JSON" };
    if (data.error?.message) return { error: data.error.message };
    const text = mcpPromptMessagesToPlainText(data.result?.messages);
    return { text };
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.includes("abort") ? "Request timeout" : msg };
  }
}

/** Result of a successful tools/call: concatenated text from content items. */
export interface McpToolCallResult {
  text: string;
}

/**
 * Call an MCP tool by name with optional arguments.
 * Tries stateless tools/call first; on 400 Bad Request, retries with session (initialize + initialized)
 * for Streamable HTTP servers that require MCP-Session-Id.
 */
export async function callMcpTool(
  serverUrl: string,
  toolName: string,
  args?: Record<string, unknown>,
  options?: McpConnectionOptions
): Promise<McpToolCallResult | { error: string }> {
  const url = serverUrl.trim();
  if (!url) return { error: "MCP server URL is empty" };
  if (!toolName || typeof toolName !== "string" || !toolName.trim()) {
    return { error: "Tool name is required" };
  }
  const headers = buildMcpHeaders(options?.headers);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const toolCallBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: toolName.trim(),
      arguments: args && typeof args === "object" ? args : {}
    }
  });

  async function doToolsCall(hdr: HeadersInit): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: hdr,
      body: toolCallBody,
      signal: controller.signal
    });
  }

  async function parseToolsCallResponse(res: Response): Promise<McpToolCallResult | { error: string }> {
    if (!res.ok) return { error: `tools/call: ${res.status} ${res.statusText}` };
    const parsed = await parseMcpResponse(res);
    const data = parsed as {
      result?: { content?: Array<{ type?: string; text?: string }> };
      error?: { message?: string };
    } | null;
    if (!data) return { error: "Server did not return valid JSON" };
    if (data.error?.message) return { error: data.error.message };
    const content = data.result?.content;
    if (!Array.isArray(content)) return { error: "Invalid tools/call response: missing content array" };
    const text = content
      .filter((c): c is { type?: string; text?: string } => c && typeof c === "object")
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .join("");
    return { text };
  }

  try {
    let res = await doToolsCall(headers);
    if (res.status === 400) {
      const initRes = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "page-ai", version: "0.1.0" }
          }
        }),
        signal: controller.signal
      });
      if (!initRes.ok) return { error: `Initialize: ${initRes.status} ${initRes.statusText}` };
      const sessionId = initRes.headers?.get?.("mcp-session-id");
      const sessionHeaders: HeadersInit = sessionId ? { ...headers, "MCP-Session-Id": sessionId } : headers;
      await fetch(url, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
        signal: controller.signal
      });
      res = await doToolsCall(sessionHeaders);
    }
    clearTimeout(timeout);
    return parseToolsCallResponse(res);
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.includes("abort") ? "Request timeout" : msg };
  }
}

/** Default JSON for MCP config textarea. */
export function getDefaultMcpServersConfig(): string {
  return DEFAULT_MCP_CONFIG;
}

/**
 * Check if an MCP server is reachable at the given URL.
 * Sends a JSON-RPC 2.0 initialize request; considers 200 + valid JSON a success.
 * For URL: optional headers are merged into the request.
 */
export async function checkMcpConnection(
  serverUrl: string,
  options?: McpConnectionOptions
): Promise<McpCheckResult> {
  const url = serverUrl.trim();
  if (!url) {
    return { ok: false, error: "MCP server URL is empty" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "URL must be http or https" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const headers = buildMcpHeaders(options?.headers);

  try {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "page-ai", version: "0.1.0" }
      }
    });

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { ok: false, error: `Server returned ${response.status} ${response.statusText}` };
    }

    const parsed = await parseMcpResponse(response);
    if (parsed === null && response.status !== 202) {
      return { ok: false, error: "Server did not return valid JSON" };
    }

    return { ok: true };
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort")) {
      return { ok: false, error: "Connection timeout" };
    }
    return { ok: false, error: msg };
  }
}
