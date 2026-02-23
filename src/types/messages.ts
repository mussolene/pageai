export interface ConfluencePage {
  id: string;
  url: string;
  title: string;
  spaceKey?: string;
  createdAt: string;
  updatedAt: string;
  contentText: string;
}

export interface PageIndexPayload extends ConfluencePage {}

export interface SearchQueryPayload {
  query: string;
  spaceKey?: string;
}

export interface SummarizePayload {
  pageIds: string[];
  query?: string;
}

export type MessageFromContent =
  | {
      type: "PAGE_INDEX";
      payload: PageIndexPayload;
    }
  | {
      type: "GET_CURRENT_PAGE";
    };

export type MessageFromPanel =
  | {
      type: "SEARCH_QUERY";
      payload: SearchQueryPayload;
    }
  | {
      type: "SUMMARIZE";
      payload: SummarizePayload;
    }
  | {
      type: "CHAT_MESSAGE_CURRENT_PAGE";
      payload: { text: string; spaceKey?: string };
    };

export interface SearchResult {
  page: ConfluencePage;
  score: number;
}

/** Один шаг рассуждения: размышление модели или вызов инструмента (MCP). */
export type ReasoningStep =
  | { type: "thinking"; text: string }
  | { type: "tool_call"; name: string; args?: string; result?: string };

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  /** Размышления модели (один блок think) — для обратной совместимости */
  thinking?: string;
  /** Цепочка шагов рассуждения: размышления и вызовы инструментов (сохраняются все раунды) */
  reasoningSteps?: ReasoningStep[];
  sources?: Array<{ title: string; url: string }>;
}

