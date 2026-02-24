/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  searchConfluencePages,
  getConfluenceSpaces,
  getConfluencePage,
  testConfluenceConnection,
  buildCQL,
  type ConfluenceSpace,
} from "../src/api/confluence";

const mockConfig = {
  confluenceBaseUrl: "https://wiki.example.com",
  confluenceApiToken: "token",
  confluenceUsername: "user@example.com",
};

const mockGetCachedSearchResults = vi.fn().mockResolvedValue(null);
const mockSetCachedSearchResults = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/storage/indexdb", () => ({
  getCachedSearchResults: (...args: unknown[]) => mockGetCachedSearchResults(...args),
  setCachedSearchResults: (...args: unknown[]) => mockSetCachedSearchResults(...args),
}));

describe("Confluence API", () => {
  beforeEach(() => {
    mockGetCachedSearchResults.mockResolvedValue(null);
    mockSetCachedSearchResults.mockResolvedValue(undefined);
    global.fetch = vi.fn();
    (global as any).chrome = {
      storage: {
        sync: {
          get: (keys: any, cb: (r: any) => void) => {
            if (Object.prototype.hasOwnProperty.call(keys, "confluenceBaseUrl")) {
              cb({ confluenceBaseUrl: mockConfig.confluenceBaseUrl });
            } else {
              cb({
                confluenceApiToken: mockConfig.confluenceApiToken,
                confluenceUsername: mockConfig.confluenceUsername,
              });
            }
          },
        },
        local: {
          get: (keys: any, cb: (r: any) => void) => {
            cb({
              confluenceApiToken: mockConfig.confluenceApiToken,
              confluenceUsername: mockConfig.confluenceUsername,
            });
          },
          set: vi.fn(),
        },
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getConfluenceSpaces", () => {
    it("returns spaces from v2 API", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              { id: 1, key: "DOC", name: "Documentation", type: "global" },
              { id: 2, key: "DEV", name: "Development", type: "global" },
            ],
          }),
      });
      const spaces = await getConfluenceSpaces();
      expect(spaces).toHaveLength(2);
      expect(spaces[0].key).toBe("DOC");
      expect(spaces[0].name).toBe("Documentation");
      expect(spaces[1].key).toBe("DEV");
    });

    it("throws when config is missing", async () => {
      (global as any).chrome.storage.sync.get = (_: any, cb: (r: any) => void) =>
        cb({ confluenceBaseUrl: "" });
      await expect(getConfluenceSpaces()).rejects.toThrow("not configured");
    });

    it("falls back to v1 API on 404", async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              results: [{ key: "V1", name: "V1 Space", type: "global" }],
            }),
        });
      const spaces = await getConfluenceSpaces();
      expect(spaces).toHaveLength(1);
      expect(spaces[0].key).toBe("V1");
    });

    it("maps space icon when present", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              { id: 1, key: "DOC", name: "Docs", type: "global", icon: { path: "/icons/doc.svg" } },
            ],
          }),
      });
      const spaces = await getConfluenceSpaces();
      expect(spaces[0].icon).toEqual({ path: "/icons/doc.svg" });
    });
  });

  describe("getConfluencePage", () => {
    it("returns page by id with body.storage", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "456",
            title: "Single Page",
            space: { key: "DOC", name: "Docs" },
            _links: { webui: "/pages/456", base: "https://wiki.example.com" },
            body: { storage: { value: "<p>Page content here</p>" } },
            history: {
              createdDate: "2024-01-01T00:00:00Z",
              lastUpdated: { when: "2024-01-15T12:00:00Z" },
            },
          }),
      });
      const page = await getConfluencePage("456");
      expect(page.id).toBe("456");
      expect(page.title).toBe("Single Page");
      expect(page.spaceKey).toBe("DOC");
      expect(page.contentText).toContain("Page content here");
      expect(page.createdAt).toBe("2024-01-01T00:00:00Z");
      expect(page.updatedAt).toBe("2024-01-15T12:00:00Z");
    });

    it("uses body.view when storage is missing", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "789",
            title: "View Page",
            space: { key: "DEV", name: "Dev" },
            _links: { webui: "/pages/789", base: "https://wiki.example.com" },
            body: { view: { value: "<p>View content</p>" } },
          }),
      });
      const page = await getConfluencePage("789");
      expect(page.contentText).toContain("View content");
    });

    it("throws when config is missing", async () => {
      (global as any).chrome.storage.sync.get = (_: any, cb: (r: any) => void) =>
        cb({ confluenceBaseUrl: "" });
      await expect(getConfluencePage("123")).rejects.toThrow("not configured");
    });

    it("throws when API returns not ok", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });
      await expect(getConfluencePage("123")).rejects.toThrow("403");
    });
  });

  describe("testConfluenceConnection", () => {
    it("returns true when /rest/api/user/current returns ok", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
      const ok = await testConfluenceConnection();
      expect(ok).toBe(true);
    });

    it("returns false when config is missing", async () => {
      (global as any).chrome.storage.sync.get = (_: any, cb: (r: any) => void) =>
        cb({ confluenceBaseUrl: "" });
      const ok = await testConfluenceConnection();
      expect(ok).toBe(false);
    });

    it("returns false when fetch fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network"));
      const ok = await testConfluenceConnection();
      expect(ok).toBe(false);
    });
  });

  describe("searchConfluencePages", () => {
    it("throws when config is missing", async () => {
      (global as any).chrome.storage.sync.get = (_: any, cb: (r: any) => void) =>
        cb({ confluenceBaseUrl: "" });
      await expect(searchConfluencePages("test")).rejects.toThrow("not configured");
    });

    it("returns pages from API when cache is empty", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            _links: { base: "https://wiki.example.com" },
            results: [
              {
                id: "123",
                title: "Getting Started",
                space: { key: "DOC", name: "Docs" },
                _links: { webui: "/pages/123" },
                body: { storage: { value: "<p>Hello world</p>" } },
              },
            ],
          }),
      });
      const pages = await searchConfluencePages("getting started");
      expect(pages).toHaveLength(1);
      expect(pages[0].id).toBe("123");
      expect(pages[0].title).toBe("Getting Started");
      expect(pages[0].contentText).toContain("Hello world");
    });

    it("uses spaceKeys for CQL when provided", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            _links: { base: "https://wiki.example.com" },
            results: [],
          }),
      });
      await searchConfluencePages("q", ["DOC"]);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("cql="),
        expect.any(Object)
      );
    });

    it("returns cached results when cache has entries", async () => {
      mockGetCachedSearchResults.mockResolvedValueOnce([
        {
          id: "cached-1",
          url: "https://wiki.example.com/pages/1",
          title: "Cached Page",
          spaceKey: "DOC",
          contentText: "Cached content",
        },
      ]);
      const pages = await searchConfluencePages("cached query");
      expect(pages).toHaveLength(1);
      expect(pages[0].id).toBe("cached-1");
      expect(pages[0].title).toBe("Cached Page");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("falls back to API when cache retrieval throws", async () => {
      mockGetCachedSearchResults.mockRejectedValueOnce(new Error("IndexedDB error"));
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            _links: { base: "https://wiki.example.com" },
            results: [
              {
                id: "api-1",
                title: "From API",
                space: { key: "DOC", name: "Docs" },
                _links: { webui: "/pages/api-1" },
                body: { storage: { value: "<p>API content</p>" } },
              },
            ],
          }),
      });
      const pages = await searchConfluencePages("query");
      expect(pages).toHaveLength(1);
      expect(pages[0].title).toBe("From API");
      expect(global.fetch).toHaveBeenCalled();
    });

    it("uses multiple spaceKeys in CQL", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ _links: { base: "https://wiki.example.com" }, results: [] }),
      });
      await searchConfluencePages("test", ["DOC", "DEV"]);
      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callUrl).toContain("space");
      expect(callUrl).toMatch(/DOC|DEV/);
    });
  });

  describe("buildCQL", () => {
    it("escapes double-quote in query terms", () => {
      const cql = buildCQL('foo"bar');
      expect(cql).toContain('\\"');
      expect(cql).not.toMatch(/text ~ "foo"bar"/);
    });

    it("escapes backslash in query terms", () => {
      const cql = buildCQL("a\\b");
      expect(cql).toContain("\\\\");
    });

    it("escapes spaceKey with special characters", () => {
      const cql = buildCQL("q", ['SP"ACE']);
      expect(cql).toContain('\\"');
      expect(cql).toMatch(/space = "SP\\"ACE"/);
    });
  });
});
