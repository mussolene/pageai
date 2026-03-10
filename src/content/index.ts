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

/** Найти кликабельный элемент по видимому тексту (кнопки, ссылки, инпуты). */
function findClickableByText(text: string): Element | null {
  const want = text.trim().toLowerCase();
  if (!want) return null;
  const candidates = Array.from(
    document.querySelectorAll(
      "a, button, input[type='submit'], input[type='button'], [role='button'], [onclick]"
    )
  );
  for (const el of candidates) {
    const label =
      (el as HTMLButtonElement).value ||
      el.textContent?.trim() ||
      (el as HTMLElement).getAttribute("aria-label") ||
      "";
    if (label.toLowerCase().includes(want) || want.includes(label.toLowerCase())) return el;
  }
  return null;
}

/** Ключевые слова для поля поиска (синонимы «поиск»/«запрос»). */
const SEARCH_FIELD_KEYWORDS = [
  "search", "поиск", "запрос", "query", "q", "find", "искать", "s",
  "recherche", "suche", "buscar", "cerca"
];

function isSearchFieldLabel(field: string): boolean {
  const w = field.trim().toLowerCase();
  return SEARCH_FIELD_KEYWORDS.some((k) => w === k || w.includes(k) || k.includes(w));
}

function elementMatchesSearchInput(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  const placeholder = (el.getAttribute("placeholder") ?? "").toLowerCase();
  const ariaLabel = (el.getAttribute("aria-label") ?? "").toLowerCase();
  const name = (el.getAttribute("name") ?? "").toLowerCase();
  const id = (el.getAttribute("id") ?? "").toLowerCase();
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (type === "search" || role === "searchbox") return true;
  return SEARCH_FIELD_KEYWORDS.some(
    (k) =>
      placeholder.includes(k) ||
      ariaLabel.includes(k) ||
      name === k ||
      name.includes(k) ||
      id === k ||
      id.includes(k)
  );
}

/** Найти поле ввода (input/textarea) по подсказке, метке, name или id. */
function findInputByLabel(field: string): HTMLInputElement | HTMLTextAreaElement | null {
  const want = field.trim().toLowerCase();
  if (!want) return null;
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input:not([type='hidden']):not([type='submit']):not([type='button']), textarea"
    )
  );
  for (const el of candidates) {
    const placeholder = (el.getAttribute("placeholder") ?? "").toLowerCase();
    const ariaLabel = (el.getAttribute("aria-label") ?? "").toLowerCase();
    const name = (el.getAttribute("name") ?? "").toLowerCase();
    const id = (el.getAttribute("id") ?? "").toLowerCase();
    const labelFor = document.querySelector(`label[for="${el.id}"]`);
    const labelText = (labelFor?.textContent?.trim() ?? "").toLowerCase();
    if (
      (placeholder && (placeholder.includes(want) || want.includes(placeholder))) ||
      (ariaLabel && (ariaLabel.includes(want) || want.includes(ariaLabel))) ||
      (name && (name.includes(want) || want.includes(name))) ||
      (id && (id.includes(want) || want.includes(id))) ||
      (labelText && (labelText.includes(want) || want.includes(labelText)))
    ) {
      return el;
    }
  }
  // Если пользователь просит «поле поиска»/«поле запроса» — ищем по типу search, role=searchbox или по ключевым словам
  if (isSearchFieldLabel(field)) {
    const searchMatches = candidates.filter((el) => elementMatchesSearchInput(el));
    const visible = searchMatches.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (visible) return visible;
    if (searchMatches[0]) return searchMatches[0];
  }
  return null;
}

/** Установить значение в поле и вызвать input/change для React и др. */
function setInputValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// Обработка запроса текущей страницы и клика по элементу от background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PAGE_CLICK") {
    const payload = message.payload as { text?: string; selector?: string } | undefined;
    if (!payload || (!payload.text && !payload.selector)) {
      try {
        sendResponse({ ok: false, error: "Need 'text' or 'selector'" });
      } catch {
        /* ignore */
      }
      return true;
    }
    try {
      let el: Element | null = null;
      if (payload.selector) {
        el = document.querySelector(payload.selector);
      }
      if (!el && payload.text) {
        el = findClickableByText(payload.text);
      }
      if (!el) {
        sendResponse({
          ok: false,
          error: payload.selector
            ? `Element not found: ${payload.selector}`
            : `No button/link found with text "${payload.text}"`
        });
        return true;
      }
      (el as HTMLElement).click();
      sendResponse({ ok: true, message: "Clicked" });
    } catch (err) {
      try {
        sendResponse({ ok: false, error: (err as Error).message });
      } catch {
        /* ignore */
      }
    }
    return true;
  }

  if (message.type === "PAGE_FILL") {
    const payload = message.payload as { field?: string; selector?: string; value?: string } | undefined;
    if (!payload || payload.value === undefined) {
      try {
        sendResponse({ ok: false, error: "Need 'value' and ('field' or 'selector')" });
      } catch {
        /* ignore */
      }
      return true;
    }
    if (!payload.field && !payload.selector) {
      try {
        sendResponse({ ok: false, error: "Need 'field' (placeholder/label/name) or 'selector'" });
      } catch {
        /* ignore */
      }
      return true;
    }
    try {
      let el: HTMLInputElement | HTMLTextAreaElement | null = null;
      if (payload.selector) {
        const found = document.querySelector(payload.selector);
        if (found && (found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement)) {
          el = found;
        }
      }
      if (!el && payload.field) {
        el = findInputByLabel(payload.field);
      }
      if (!el) {
        sendResponse({
          ok: false,
          error: payload.selector
            ? `Element not found: ${payload.selector}`
            : `No input/textarea found for "${payload.field}"`
        });
        return true;
      }
      setInputValue(el, String(payload.value ?? ""));
      sendResponse({ ok: true, message: "Filled" });
    } catch (err) {
      try {
        sendResponse({ ok: false, error: (err as Error).message });
      } catch {
        /* ignore */
      }
    }
    return true;
  }

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
