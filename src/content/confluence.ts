import type { PageIndexPayload } from "../types/messages";

function extractSpaceKeyFromUrl(url: string): string | undefined {
  const match = url.match(/\/spaces\/([^/]+)/);
  if (match) return match[1];
  const spaceMeta = document.querySelector('meta[name="ajs-space-key"]') as HTMLMetaElement | null;
  return spaceMeta?.content || undefined;
}

function extractPageId(url: string): string {
  const idMeta = document.querySelector('meta[name="ajs-page-id"]') as HTMLMetaElement | null;
  if (idMeta?.content) return idMeta.content;

  const match = url.match(/pageId=(\d+)/);
  if (match) return match[1];

  return url;
}

function extractTextFromConfluence(): string {
  const selectors = [
    '[id="main-content"]',
    '.ak-renderer-document',
    '.wiki-content',
    '#content'
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      return el.textContent?.trim() ?? "";
    }
  }

  return document.body.textContent?.trim() ?? "";
}

function buildPagePayload(): PageIndexPayload {
  const url = window.location.href;
  const title = document.title || "Untitled Confluence page";
  const now = new Date().toISOString();

  return {
    id: extractPageId(url),
    url,
    title,
    spaceKey: extractSpaceKeyFromUrl(url),
    createdAt: now,
    updatedAt: now,
    contentText: extractTextFromConfluence()
  };
}

async function indexCurrentPage(): Promise<void> {
  const payload = buildPagePayload();

  await new Promise<void>((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "PAGE_INDEX",
        payload
      },
      () => resolve()
    );
  });
}

// Simple heuristic: index page when script runs, and on visibility change.
void indexCurrentPage();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void indexCurrentPage();
  }
});

