import type { OpenAITool } from "../mcp/agent-tools";

export interface BrowserToolsConfig {
  browserAutomationEnabled: boolean;
}

/**
 * OpenAI-compatible tool definitions for interacting with the current page.
 * These act as an internal MCP-like provider named "pageai-browser".
 */
export function getBrowserTools(config: BrowserToolsConfig): OpenAITool[] {
  if (!config.browserAutomationEnabled) return [];

  const tools: OpenAITool[] = [];

  tools.push({
    type: "function",
    function: {
      name: "page_read",
      description:
        "Read the current page: extract main text content and metadata. Call when user asks \"what is on this page\", \"summarize this\", or needs context from the open tab.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            description:
              "Optional: how much detail to return. 'summary' for short summary, 'full' for full text chunk. Defaults to 'summary'.",
          },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "page_click",
      description:
        "User wants to activate something on the page: click, press, open, submit. Use for buttons, links, tabs, any clickable. Pass visible text or selector.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Visible text/label of element (e.g. 'Submit', 'Войти'). Prefer this when possible.",
          },
          selector: {
            type: "string",
            description: "CSS selector if text is ambiguous or not available.",
          },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "page_fill",
      description:
        "User wants to put text into a field: type, write, fill, insert, paste. Use for search, comment, form inputs, any input/textarea. Infer field from context (search, comment, query, etc.).",
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            description:
              "How to find field: placeholder/label/name (e.g. search, comment, query, поиск, запрос). Prefer this when possible.",
          },
          selector: {
            type: "string",
            description: "CSS selector if needed when label/placeholder is not enough.",
          },
          value: {
            type: "string",
            description: "Text to put in the field.",
          },
        },
        required: ["value"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "page_navigate",
      description:
        "Navigate the current tab to a different URL. Use when the user explicitly asks to open a specific link or URL.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Absolute URL to open in the current tab.",
          },
        },
        required: ["url"],
      },
    },
  });

  return tools;
}

