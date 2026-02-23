import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getCachedSpaces,
  setCachedSpaces,
  getSelectedSpace,
  setSelectedSpace,
  getSpaceStats,
  clearSpacesCache,
  validateSpaceSelection,
  getSpaceByKey,
  getGlobalSpaces,
  getSpacesByType,
  SPACES_CACHE_TTL,
} from "../src/storage/spaces";
import type { ConfluenceSpace } from "../src/api/confluence";

const mockSpaces: ConfluenceSpace[] = [
  { key: "DOC", name: "Documentation", type: "global" },
  { key: "DEV", name: "Development", type: "global" },
  { key: "~user", name: "My Space", type: "personal" },
];

const localStore: Record<string, unknown> = {};

describe("storage/spaces", () => {
  beforeEach(() => {
    Object.keys(localStore).forEach((k) => delete localStore[k]);
    (global as any).chrome = {
      storage: {
        local: {
          get: (keys: string[], cb: (r: Record<string, unknown>) => void) => {
            const r: Record<string, unknown> = {};
            keys.forEach((k) => {
              if (k in localStore) r[k] = localStore[k];
            });
            cb(r);
          },
          set: (obj: Record<string, unknown>, cb?: () => void) => {
            Object.assign(localStore, obj);
            cb?.();
          },
          remove: (keys: string[], cb?: () => void) => {
            keys.forEach((k) => delete localStore[k]);
            cb?.();
          },
        },
      },
      runtime: { lastError: null },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getCachedSpaces", () => {
    it("returns null when cache empty", async () => {
      const r = await getCachedSpaces();
      expect(r).toBeNull();
    });

    it("returns null when cache expired", async () => {
      (global as any).chrome.storage.local.get = (
        keys: string[],
        cb: (r: Record<string, unknown>) => void
      ) => {
        cb({
          confluence_spaces_cache: mockSpaces,
          confluence_spaces_cache_ttl: Date.now() - 1,
        });
      };
      const r = await getCachedSpaces();
      expect(r).toBeNull();
    });

    it("returns spaces when cache valid", async () => {
      (global as any).chrome.storage.local.get = (
        keys: string[],
        cb: (r: Record<string, unknown>) => void
      ) => {
        cb({
          confluence_spaces_cache: mockSpaces,
          confluence_spaces_cache_ttl: Date.now() + 3600000,
        });
      };
      const r = await getCachedSpaces();
      expect(r).toHaveLength(3);
      expect(r![0].key).toBe("DOC");
    });
  });

  describe("setCachedSpaces", () => {
    it("stores spaces and TTL", async () => {
      await setCachedSpaces(mockSpaces);
      expect(localStore.confluence_spaces_cache).toEqual(mockSpaces);
      expect(typeof localStore.confluence_spaces_cache_ttl).toBe("number");
    });
  });

  describe("getSelectedSpace / setSelectedSpace", () => {
    it("returns null when none selected", async () => {
      const r = await getSelectedSpace();
      expect(r).toBeNull();
    });

    it("stores and retrieves selected space key", async () => {
      await setSelectedSpace("DOC");
      const key = await getSelectedSpace();
      expect(key).toBe("DOC");
    });

    it("clears selection when set to null", async () => {
      await setSelectedSpace("DOC");
      await setSelectedSpace(null);
      const key = await getSelectedSpace();
      expect(key).toBeNull();
    });
  });

  describe("getSpaceStats", () => {
    it("returns totalSpaces 0 and cacheExpired true when empty", async () => {
      const stats = await getSpaceStats();
      expect(stats.totalSpaces).toBe(0);
      expect(stats.cacheExpired).toBe(true);
    });
  });

  describe("validateSpaceSelection", () => {
    it("returns true for null (All spaces)", async () => {
      expect(await validateSpaceSelection(null)).toBe(true);
    });

    it("returns false when cache empty", async () => {
      expect(await validateSpaceSelection("DOC")).toBe(false);
    });

    it("returns true when space key in cache", async () => {
      (global as any).chrome.storage.local.get = (
        keys: string[],
        cb: (r: Record<string, unknown>) => void
      ) => {
        cb({
          confluence_spaces_cache: mockSpaces,
          confluence_spaces_cache_ttl: Date.now() + 3600000,
        });
      };
      expect(await validateSpaceSelection("DOC")).toBe(true);
    });
  });

  describe("getSpaceByKey", () => {
    it("returns null when cache empty", async () => {
      expect(await getSpaceByKey("DOC")).toBeNull();
    });

    it("returns space when key exists", async () => {
      (global as any).chrome.storage.local.get = (
        keys: string[],
        cb: (r: Record<string, unknown>) => void
      ) => {
        cb({
          confluence_spaces_cache: mockSpaces,
          confluence_spaces_cache_ttl: Date.now() + 3600000,
        });
      };
      const s = await getSpaceByKey("DEV");
      expect(s).not.toBeNull();
      expect(s!.key).toBe("DEV");
    });
  });

  describe("getGlobalSpaces", () => {
    it("returns only global type", async () => {
      (global as any).chrome.storage.local.get = (
        keys: string[],
        cb: (r: Record<string, unknown>) => void
      ) => {
        cb({
          confluence_spaces_cache: mockSpaces,
          confluence_spaces_cache_ttl: Date.now() + 3600000,
        });
      };
      const list = await getGlobalSpaces();
      expect(list).toHaveLength(2);
      expect(list.every((s) => s.type === "global")).toBe(true);
    });
  });

  describe("getSpacesByType", () => {
    it("returns personal spaces", async () => {
      (global as any).chrome.storage.local.get = (
        keys: string[],
        cb: (r: Record<string, unknown>) => void
      ) => {
        cb({
          confluence_spaces_cache: mockSpaces,
          confluence_spaces_cache_ttl: Date.now() + 3600000,
        });
      };
      const list = await getSpacesByType("personal");
      expect(list).toHaveLength(1);
      expect(list[0].key).toBe("~user");
    });
  });

  describe("clearSpacesCache", () => {
    it("removes cache keys", async () => {
      const removeSpy = vi.fn((keys: string[], cb?: () => void) => cb?.());
      (global as any).chrome.storage.local.remove = removeSpy;
      await clearSpacesCache();
      expect(removeSpy).toHaveBeenCalledWith(
        expect.arrayContaining(["confluence_spaces_cache", "confluence_spaces_cache_ttl"]),
        expect.any(Function)
      );
    });
  });
});
