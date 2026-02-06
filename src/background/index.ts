import { MessageFromContent, MessageFromPanel, SearchResult } from "../types/messages";
import { Storage } from "../storage/indexdb";
import { keywordSearch } from "../search/keyword";
import { summarizePages } from "../llm/client";

const storage = new Storage();

chrome.runtime.onMessage.addListener((message: MessageFromContent | MessageFromPanel, _sender, sendResponse) => {
  (async () => {
    if (message.type === "PAGE_INDEX") {
      await storage.savePage(message.payload);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "SEARCH_QUERY") {
      const pages = await storage.getAllPages();
      const results: SearchResult[] = keywordSearch(message.payload.query, pages, {
        limit: 10
      });
      sendResponse({ ok: true, results });
      return;
    }

    if (message.type === "SUMMARIZE") {
      const pages = await storage.getPagesByIds(message.payload.pageIds);
      const summary = await summarizePages(pages, message.payload);
      sendResponse({ ok: true, summary });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  // Indicate that we'll respond asynchronously.
  return true;
});

