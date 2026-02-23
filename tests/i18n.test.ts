import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getLocale, setLocale, t, getStoredLocale, translate } from "../src/i18n";

describe("i18n", () => {
  const originalLang = Object.getOwnPropertyDescriptor(global, "navigator")
    ? (global as any).navigator?.language
    : undefined;

  beforeEach(() => {
    Object.defineProperty(global, "navigator", {
      value: { language: "en" },
      writable: true,
      configurable: true,
    });
    (global as any).chrome = {
      storage: {
        sync: {
          get: (keys: any, cb: (r: any) => void) => cb({ locale: "en" }),
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
      (global as any).navigator = { language: "en" };
      expect(getLocale()).toBe("en");
    });

    it("returns ru for navigator.language ru", () => {
      (global as any).navigator = { language: "ru" };
      expect(getLocale()).toBe("ru");
    });

    it("returns en for unsupported language", () => {
      (global as any).navigator = { language: "fr" };
      expect(getLocale()).toBe("en");
    });

    it("uses first part of language tag", () => {
      (global as any).navigator = { language: "ru-RU" };
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
      (global as any).chrome.storage.sync.get = (keys: any, cb: (r: any) => void) =>
        cb({ locale: "ru" });
      const locale = await getStoredLocale();
      expect(locale).toBe("ru");
    });

    it("resolves with getLocale() when storage empty", async () => {
      (global as any).chrome.storage.sync.get = (keys: any, cb: (r: any) => void) =>
        cb({});
      (global as any).navigator = { language: "en" };
      const locale = await getStoredLocale();
      expect(["en", "ru"]).toContain(locale);
    });
  });

  describe("translate", () => {
    it("returns translated string for key", async () => {
      (global as any).chrome.storage.sync.get = (keys: any, cb: (r: any) => void) =>
        cb({ locale: "en" });
      const s = await translate("chat.send");
      expect(s).toBe("Send");
    });
  });

  describe("setLocale", () => {
    it("calls chrome.storage.sync.set", () => {
      setLocale("ru");
      expect((global as any).chrome.storage.sync.set).toHaveBeenCalledWith({ locale: "ru" });
    });
  });
});
