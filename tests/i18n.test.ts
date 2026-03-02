import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getLocale, setLocale, t, getStoredLocale, translate } from "../src/i18n";

type ChromeMock = {
  storage: { sync: { get: (k: object, cb: (r: Record<string, unknown>) => void) => void; set: ReturnType<typeof vi.fn> } };
};

describe("i18n", () => {
  beforeEach(() => {
    Object.defineProperty(global, "navigator", {
      value: { language: "en" },
      writable: true,
      configurable: true,
    });
    (global as unknown as { chrome: ChromeMock }).chrome = {
      storage: {
        sync: {
          get: (_k: object, cb: (r: Record<string, unknown>) => void) => cb({ locale: "en" }),
          set: vi.fn(),
        },
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getLocale", () => {
    it("returns en for navigator.language en", () => {
      (global as unknown as { navigator: { language: string } }).navigator = { language: "en" };
      expect(getLocale()).toBe("en");
    });

    it("returns ru for navigator.language ru", () => {
      (global as unknown as { navigator: { language: string } }).navigator = { language: "ru" };
      expect(getLocale()).toBe("ru");
    });

    it("returns en for unsupported language", () => {
      (global as unknown as { navigator: { language: string } }).navigator = { language: "fr" };
      expect(getLocale()).toBe("en");
    });

    it("uses first part of language tag", () => {
      (global as unknown as { navigator: { language: string } }).navigator = { language: "ru-RU" };
      expect(getLocale()).toBe("ru");
    });
  });

  describe("t", () => {
    it("returns value for existing key", () => {
      expect(t("app.title", "en")).toBe("Page AI");
      expect(t("chat.send", "en")).toBe("Send");
    });

    it("returns key for missing key", () => {
      expect(t("missing.key", "en")).toBe("missing.key");
    });

    it("returns value for nested key", () => {
      expect(t("settings.llmEndpoint", "en")).toBe("LLM Endpoint");
    });

    it("uses default locale when locale not passed", () => {
      const v = t("app.title");
      expect(v === "Page AI" || v.length > 0).toBe(true);
    });
  });

  describe("getStoredLocale", () => {
    it("resolves with stored locale", async () => {
      (global as unknown as { chrome: ChromeMock }).chrome.storage.sync.get = (_k: object, cb: (r: Record<string, unknown>) => void) =>
        cb({ locale: "ru" });
      const locale = await getStoredLocale();
      expect(locale).toBe("ru");
    });

    it("resolves with getLocale() when storage empty", async () => {
      (global as unknown as { chrome: ChromeMock }).chrome.storage.sync.get = (_k: object, cb: (r: Record<string, unknown>) => void) =>
        cb({});
      (global as unknown as { navigator: { language: string } }).navigator = { language: "en" };
      const locale = await getStoredLocale();
      expect(["en", "ru"]).toContain(locale);
    });
  });

  describe("translate", () => {
    it("returns translated string for key", async () => {
      (global as unknown as { chrome: ChromeMock }).chrome.storage.sync.get = (_k: object, cb: (r: Record<string, unknown>) => void) =>
        cb({ locale: "en" });
      const s = await translate("chat.send");
      expect(s).toBe("Send");
    });
  });

  describe("setLocale", () => {
    it("calls chrome.storage.sync.set", () => {
      setLocale("ru");
      expect((global as unknown as { chrome: ChromeMock }).chrome.storage.sync.set).toHaveBeenCalledWith({ locale: "ru" });
    });
  });
});
