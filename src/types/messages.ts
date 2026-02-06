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
}

export interface SummarizePayload {
  pageIds: string[];
  query?: string;
}

export type MessageFromContent =
  | {
      type: "PAGE_INDEX";
      payload: PageIndexPayload;
    };

export type MessageFromPanel =
  | {
      type: "SEARCH_QUERY";
      payload: SearchQueryPayload;
    }
  | {
      type: "SUMMARIZE";
      payload: SummarizePayload;
    };

export interface SearchResult {
  page: ConfluencePage;
  score: number;
}

