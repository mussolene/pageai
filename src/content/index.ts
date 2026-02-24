import { buildPagePayload } from "./page-extractor";

async function indexCurrentPage(): Promise<void> {
  const payload = buildPagePayload();

  const content = payload.contentText?.trim() ?? "";
  if (content.length < 10) return;

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
  if (message.type === "GET_CURRENT_PAGE") {
    try {
      const payload = buildPagePayload();
      const content = payload.contentText?.trim() ?? "";
      // Минимальный контент для анализа (работаем на любых страницах, не только wiki)
      if (content.length < 10) {
        sendResponse({
          ok: false,
          error: "This page has very little text to analyze. Try a page with more content."
        });
        return false;
      }

      // Сохраняем страницу в storage перед отправкой
      chrome.runtime.sendMessage(
        {
          type: "PAGE_INDEX",
          payload
        },
        () => {
          sendResponse({ ok: true, page: payload });
        }
      );
      return true; // Асинхронный ответ
    } catch (error) {
      sendResponse({ ok: false, error: (error as Error).message });
      return false;
    }
  }
  return false;
});
