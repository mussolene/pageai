import { buildPagePayload } from "./page-extractor";

/** True if extension was reloaded and this content script instance is orphaned. */
function isContextInvalidated(err: unknown): boolean {
  return err instanceof Error && err.message === "Extension context invalidated";
}

async function indexCurrentPage(): Promise<void> {
  const payload = buildPagePayload();

  const content = payload.contentText?.trim() ?? "";
  if (content.length < 10) return;

  await new Promise<void>((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "PAGE_INDEX", payload },
        () => resolve()
      );
    } catch (err) {
      if (isContextInvalidated(err)) {
        /* Extension reloaded; do nothing. */
      }
      resolve();
    }
  });
}

// Индексируем страницу при загрузке
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      void indexCurrentPage();
    }, 500);
  });
} else {
  setTimeout(() => {
    void indexCurrentPage();
  }, 500);
}

// Обновляем индекс при изменении видимости
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    setTimeout(() => {
      void indexCurrentPage();
    }, 500);
  }
});

// Обработка запроса текущей страницы от background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GET_CURRENT_PAGE") return false;
  try {
    const payload = buildPagePayload();
    const content = payload.contentText?.trim() ?? "";
    if (content.length < 10) {
      try {
        sendResponse({ ok: false, error: "This page has very little text to analyze. Try a page with more content." });
      } catch {
        /* Extension context invalidated */
      }
      return false;
    }
    try {
      chrome.runtime.sendMessage({ type: "PAGE_INDEX", payload }, () => {
        try {
          sendResponse({ ok: true, page: payload });
        } catch {
          /* Extension context invalidated */
        }
      });
    } catch (err) {
      if (!isContextInvalidated(err)) {
        try {
          sendResponse({ ok: false, error: (err as Error).message });
        } catch {
          /* Extension context invalidated */
        }
      }
      return false;
    }
    return true;
  } catch (error) {
    try {
      sendResponse({ ok: false, error: (error as Error).message });
    } catch {
      /* Extension context invalidated */
    }
    return false;
  }
});
