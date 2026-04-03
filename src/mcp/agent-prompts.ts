/**
 * Load MCP prompts from enabled URL servers and format a block for the agent system prompt.
 */

import { parseMcpServersList, listMcpPrompts, getMcpPrompt, type McpServerInfo, type McpPromptInfo } from "./client";

export interface McpAgentPromptsLimits {
  maxPromptsPerServer: number;
  maxCharsPerServer: number;
  maxCharsGlobal: number;
}

export const DEFAULT_MCP_AGENT_PROMPTS_LIMITS: McpAgentPromptsLimits = {
  maxPromptsPerServer: 5,
  maxCharsPerServer: 4000,
  maxCharsGlobal: 16000
};

const TRUNCATED_MARKER = "\n[truncated]";

/** Exported for unit tests. */
export function truncateWithTruncatedMarker(text: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (text.length <= maxLen) return text;
  const take = Math.max(0, maxLen - TRUNCATED_MARKER.length);
  return text.slice(0, take) + TRUNCATED_MARKER;
}

function defaultArgumentsForPrompt(prompt: McpPromptInfo): Record<string, string> {
  const out: Record<string, string> = {};
  if (!prompt.arguments?.length) return out;
  for (const a of prompt.arguments) {
    out[a.name] = "";
  }
  return out;
}

export interface McpAgentPromptsLoadResult {
  /** Full block to append after [RULES]/[SKILLS], before tool status. Empty if disabled or nothing loaded. */
  block: string;
  /** Errors keyed by server name or `server/promptName`. */
  loadErrors?: Record<string, string>;
}

/**
 * Fetch and format MCP prompt bodies for the given servers (already filtered by enabled flags).
 */
export async function aggregateMcpPromptsForServers(
  servers: McpServerInfo[],
  limits: McpAgentPromptsLimits
): Promise<McpAgentPromptsLoadResult> {
  const loadErrors: Record<string, string> = {};
  let globalRemaining = limits.maxCharsGlobal;
  const outerParts: string[] = [];

  for (const server of servers) {
    if (!server.url || globalRemaining <= 0) continue;

    let listed: Awaited<ReturnType<typeof listMcpPrompts>>;
    try {
      listed = await listMcpPrompts(server.url, { headers: server.headers });
    } catch (e) {
      loadErrors[server.name] = e instanceof Error ? e.message : String(e);
      continue;
    }
    if ("error" in listed) {
      loadErrors[server.name] = listed.error;
      continue;
    }
    if (listed.prompts.length === 0) continue;

    const toFetch = listed.prompts.slice(0, limits.maxPromptsPerServer);
    let serverUsed = 0;
    const innerParts: string[] = [];

    for (const prompt of toFetch) {
      if (globalRemaining <= 0 || serverUsed >= limits.maxCharsPerServer) break;

      const argObj = defaultArgumentsForPrompt(prompt);
      let got: Awaited<ReturnType<typeof getMcpPrompt>>;
      try {
        got = await getMcpPrompt(server.url, prompt.name, argObj, { headers: server.headers });
      } catch (e) {
        loadErrors[`${server.name}/${prompt.name}`] = e instanceof Error ? e.message : String(e);
        continue;
      }
      if ("error" in got) {
        loadErrors[`${server.name}/${prompt.name}`] = got.error;
        continue;
      }

      const room = Math.min(globalRemaining, limits.maxCharsPerServer - serverUsed);
      const body = truncateWithTruncatedMarker(got.text.trim(), room);
      if (!body) continue;

      const header = `### ${prompt.name}${prompt.description ? `\n_${prompt.description}_` : ""}`;
      const section = `${header}\n${body}`;
      innerParts.push(section);
      serverUsed += section.length + 2;
      globalRemaining -= section.length + 2;
    }

    if (innerParts.length === 0) continue;

    const blockBody = innerParts.join("\n\n");
    outerParts.push(`[MCP_PROMPTS — ${server.name}]\n${blockBody}\n[/MCP_PROMPTS]`);
  }

  const block = outerParts.length > 0 ? outerParts.join("\n\n") : "";
  return {
    block,
    loadErrors: Object.keys(loadErrors).length > 0 ? loadErrors : undefined
  };
}

/**
 * Read sync storage; if `mcpAgentPromptsEnabled`, load prompts from the same enabled servers as MCP tools.
 */
export async function getMcpAgentPromptsForAgent(): Promise<McpAgentPromptsLoadResult> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        mcpServersConfig: "",
        mcpServersEnabled: {} as Record<string, boolean>,
        mcpAgentPromptsEnabled: false,
        mcpAgentPromptsMaxPerServer: DEFAULT_MCP_AGENT_PROMPTS_LIMITS.maxPromptsPerServer,
        mcpAgentPromptsMaxChars: DEFAULT_MCP_AGENT_PROMPTS_LIMITS.maxCharsGlobal,
        mcpAgentPromptsMaxCharsPerServer: DEFAULT_MCP_AGENT_PROMPTS_LIMITS.maxCharsPerServer
      },
      async (items) => {
        if (!items.mcpAgentPromptsEnabled) {
          resolve({ block: "" });
          return;
        }
        const configJson = (items.mcpServersConfig as string) || "";
        const enabled = (items.mcpServersEnabled as Record<string, boolean>) || {};
        const parsed = parseMcpServersList(configJson);
        if ("error" in parsed) {
          resolve({ block: "", loadErrors: { config: parsed.error } });
          return;
        }
        const servers = parsed.servers.filter((s) => s.url && enabled[s.name] !== false);
        if (servers.length === 0) {
          resolve({ block: "" });
          return;
        }

        const maxPer = Number(items.mcpAgentPromptsMaxPerServer);
        const maxGlobal = Number(items.mcpAgentPromptsMaxChars);
        const maxPerSrv = Number(items.mcpAgentPromptsMaxCharsPerServer);
        const limits: McpAgentPromptsLimits = {
          maxPromptsPerServer:
            Number.isFinite(maxPer) && maxPer > 0 ? Math.min(maxPer, 50) : DEFAULT_MCP_AGENT_PROMPTS_LIMITS.maxPromptsPerServer,
          maxCharsGlobal:
            Number.isFinite(maxGlobal) && maxGlobal > 0
              ? Math.min(maxGlobal, 200_000)
              : DEFAULT_MCP_AGENT_PROMPTS_LIMITS.maxCharsGlobal,
          maxCharsPerServer:
            Number.isFinite(maxPerSrv) && maxPerSrv > 0
              ? Math.min(maxPerSrv, 100_000)
              : DEFAULT_MCP_AGENT_PROMPTS_LIMITS.maxCharsPerServer
        };

        const result = await aggregateMcpPromptsForServers(servers, limits);
        resolve(result);
      }
    );
  });
}
