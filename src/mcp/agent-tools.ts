/**
 * Load enabled MCP tools from extension storage and build OpenAI-format tools
 * plus a map from tool name to server (url, headers) for execution.
 */

import { parseMcpServersList, listMcpTools, type McpToolInfo } from "./client";

/** OpenAI-compatible tool definition for chat completions. */
export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ToolServerBinding {
  serverUrl: string;
  headers?: Record<string, string>;
}

export interface McpToolsLoadResult {
  tools: OpenAITool[];
  toolToServer: Map<string, ToolServerBinding>;
  /** true, если в настройках есть хотя бы один MCP-сервер (инструменты могут быть не загружены из-за ошибки). */
  mcpConfigured: boolean;
}

/**
 * Load MCP config and enabled flags from chrome.storage.sync,
 * fetch tool list for each enabled server, return tools in OpenAI format
 * and a map from tool name to server (url + headers).
 * mcpConfigured: true когда в конфиге есть серверы — чтобы любой ИИ знал, что инструменты настроены.
 */
export async function getEnabledMcpToolsWithMap(): Promise<McpToolsLoadResult | { error: string }> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { mcpServersConfig: "", mcpServersEnabled: {} as Record<string, boolean> },
      async (items) => {
        const configJson = (items.mcpServersConfig as string) || "";
        const enabled = (items.mcpServersEnabled as Record<string, boolean>) || {};
        const parsed = parseMcpServersList(configJson);
        if ("error" in parsed) {
          resolve({ tools: [], toolToServer: new Map(), mcpConfigured: false });
          return;
        }
        // Сервер включён, если не выключен явно (по умолчанию считаем включённым при наличии в конфиге)
        const servers = parsed.servers.filter((s) => s.url && enabled[s.name] !== false);
        const mcpConfigured = servers.length > 0;
        if (servers.length === 0) {
          resolve({ tools: [], toolToServer: new Map(), mcpConfigured: false });
          return;
        }

        const tools: OpenAITool[] = [];
        const toolToServer = new Map<string, ToolServerBinding>();

        for (const server of servers) {
          const serverUrl = server.url!;
          const headers = server.headers;
          let res: Awaited<ReturnType<typeof listMcpTools>>;
          try {
            res = await listMcpTools(serverUrl, { headers });
          } catch {
            continue;
          }
          if ("error" in res) continue;
          for (const t of res.tools) {
            if (!t.name?.trim()) continue;
            const name = t.name.trim();
            if (toolToServer.has(name)) continue;
            toolToServer.set(name, { serverUrl, headers });
            tools.push({
              type: "function",
              function: {
                name,
                description: t.description ?? undefined,
                parameters: t.inputSchema ?? undefined
              }
            });
          }
        }

        resolve({ tools, toolToServer, mcpConfigured });
      }
    );
  });
}
