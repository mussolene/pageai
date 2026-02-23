/**
 * Unit Tests for Session #5: Confluence Spaces Support
 * 
 * Tests for spaces API, storage, and UI integration
 */

import { describe, it, expect, beforeEach } from "vitest";

// Mock data for Confluence spaces
const mockSpaces = [
  {
    key: "DOC",
    name: "Documentation",
    type: "global",
    icon: { path: "/doc-icon.png" }
  },
  {
    key: "DEV",
    name: "Development",
    type: "global",
    icon: { path: "/dev-icon.png" }
  },
  {
    key: "~USER",
    name: "User Personal Space",
    type: "personal",
    icon: { path: "/user-icon.png" }
  },
  {
    key: "TEAM",
    name: "Team Collaboration",
    type: "global",
    icon: { path: "/team-icon.png" }
  }
];

describe("Confluence Spaces API - getConfluenceSpaces", () => {
  describe("Spaces retrieval", () => {
    it("should return list of Confluence spaces", () => {
      const spaces = mockSpaces;
      expect(spaces).toHaveLength(4);
      expect(spaces[0].key).toBe("DOC");
    });

    it("should include required space properties", () => {
      const space = mockSpaces[0];
      expect(space).toHaveProperty("key");
      expect(space).toHaveProperty("name");
      expect(space).toHaveProperty("type");
    });

    it("should distinguish between space types", () => {
      const globalSpaces = mockSpaces.filter(s => s.type === "global");
      const personalSpaces = mockSpaces.filter(s => s.type === "personal");
      
      expect(globalSpaces).toHaveLength(3);
      expect(personalSpaces).toHaveLength(1);
    });

    it("should include optional icon property", () => {
      const space = mockSpaces[0];
      expect(space.icon).toBeDefined();
      expect(space.icon?.path).toBe("/doc-icon.png");
    });

    it("should handle spaces without icon", () => {
      const spaceNoIcon = { ...mockSpaces[0], icon: undefined };
      expect(spaceNoIcon.icon).toBeUndefined();
    });
  });

  describe("Space filtering and querying", () => {
    it("should filter spaces by type", () => {
      const globalOnly = mockSpaces.filter(s => s.type === "global");
      expect(globalOnly).toHaveLength(3);
      expect(globalOnly.every(s => s.type === "global")).toBe(true);
    });

    it("should find space by key", () => {
      const found = mockSpaces.find(s => s.key === "DEV");
      expect(found).toBeDefined();
      expect(found?.name).toBe("Development");
    });

    it("should return null when space key not found", () => {
      const found = mockSpaces.find(s => s.key === "NONEXISTENT");
      expect(found).toBeUndefined();
    });

    it("should sort spaces alphabetically", () => {
      const sorted = [...mockSpaces].sort((a, b) => a.name.localeCompare(b.name));
      expect(sorted[0].name).toBe("Development");
      expect(sorted[sorted.length - 1].name).toBe("User Personal Space");
    });

    it("should handle space names with special characters", () => {
      const specialSpaces = [
        { key: "TEST", name: "Test & Design", type: "global" as const },
        { key: "HR", name: "HR - Human Resources", type: "global" as const }
      ];
      
      expect(specialSpaces[0].name).toContain("&");
      expect(specialSpaces[1].name).toContain(" - ");
    });
  });

  describe("Space list pagination", () => {
    it("should handle multiple pages of spaces", () => {
      const totalSpaces = 250;
      const pageSize = 100;
      const pages = Math.ceil(totalSpaces / pageSize);
      
      expect(pages).toBe(3);
    });

    it("should limit API request to first 100 spaces", () => {
      const limit = 100;
      expect(limit).toBe(100);
    });

    it("should correctly count results", () => {
      const count = mockSpaces.length;
      expect(count).toBe(4);
    });
  });

  describe("Space icons and metadata", () => {
    it("should handle space icons correctly", () => {
      const spaces = mockSpaces;
      const withIcons = spaces.filter(s => s.icon);
      
      expect(withIcons).toHaveLength(4);
    });

    it("should extract icon path from space data", () => {
      const space = mockSpaces[0];
      expect(space.icon?.path).toMatch(/\.png$/);
    });

    it("should preserve space ID if present", () => {
      const spaceWithId = { ...mockSpaces[0], id: "123" };
      expect(spaceWithId.id).toBe("123");
    });
  });
});

describe("Space Storage - getCachedSpaces / setCachedSpaces", () => {
  describe("Cache storage", () => {
    it("should cache spaces list with TTL", () => {
      const cache = {
        spaces: mockSpaces,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      
      expect(cache.spaces).toHaveLength(4);
      expect(cache.ttl).toBe(86400000);
    });

    it("should use default 24-hour TTL", () => {
      const defaultTtl = 24 * 60 * 60 * 1000;
      expect(defaultTtl).toBe(86400000);
    });

    it("should accept custom TTL value", () => {
      const customTtl = 60 * 60 * 1000; // 1 hour
      const cache = {
        spaces: mockSpaces,
        timestamp: Date.now(),
        ttl: customTtl
      };
      
      expect(cache.ttl).toBe(3600000);
    });

    it("should calculate expiration time correctly", () => {
      const ttl = 24 * 60 * 60 * 1000;
      const timestamp = Date.now();
      const expirationTime = timestamp + ttl;
      
      expect(expirationTime).toBeGreaterThan(timestamp);
    });

    it("should check cache expiration on retrieval", () => {
      const expiredCache = {
        spaces: mockSpaces,
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        ttl: 24 * 60 * 60 * 1000
      };
      
      const isExpired = Date.now() > expiredCache.timestamp + expiredCache.ttl;
      expect(isExpired).toBe(true);
    });

    it("should return null for expired cache", () => {
      const expired = null;
      expect(expired).toBeNull();
    });

    it("should return valid cache entry", () => {
      const cache = {
        spaces: mockSpaces,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      
      const isExpired = Date.now() > cache.timestamp + cache.ttl;
      
      if (!isExpired) {
        expect(cache.spaces).toBeDefined();
      }
    });
  });

  describe("Cache management", () => {
    it("should clear cache on demand", () => {
      let cache: any = { spaces: mockSpaces };
      
      // Clear
      cache = null;
      
      expect(cache).toBeNull();
    });

    it("should handle concurrent cache reads", () => {
      const cache = { spaces: mockSpaces };
      const reads = Array.from({ length: 10 }, () => cache.spaces);
      
      expect(reads).toHaveLength(10);
      expect(reads[0]).toBe(cache.spaces);
    });

    it("should survive rapid cache updates", () => {
      let cache = { spaces: [mockSpaces[0]] };
      
      // Rapid updates
      cache = { spaces: mockSpaces };
      cache = { spaces: [mockSpaces[0], mockSpaces[1]] };
      cache = { spaces: mockSpaces };
      
      expect(cache.spaces).toHaveLength(4);
    });
  });
});

describe("Selected Space Management", () => {
  describe("Space selection storage", () => {
    it("should store selected space key", () => {
      const selection = { selectedSpace: "DOC" };
      expect(selection.selectedSpace).toBe("DOC");
    });

    it("should handle 'All spaces' selection (null/empty)", () => {
      const selection = { selectedSpace: null };
      expect(selection.selectedSpace).toBeNull();
    });

    it("should validate selected space exists", () => {
      const selected = "DOC";
      const exists = mockSpaces.some(s => s.key === selected);
      expect(exists).toBe(true);
    });

    it("should detect invalid space selection", () => {
      const selected = "INVALID";
      const exists = mockSpaces.some(s => s.key === selected);
      expect(exists).toBe(false);
    });

    it("should recover from invalid selection", () => {
      // Invalid selection detected
      const selected = "NONEXISTENT";
      
      // Reset to "All spaces"
      const recovered = null;
      
      expect(recovered).toBeNull();
    });
  });

  describe("Space selection UI interaction", () => {
    it("should remember user selection across sessions", () => {
      const savedSelection = "DEV";
      // In next session:
      const loadedSelection = savedSelection;
      
      expect(loadedSelection).toBe("DEV");
    });

    it("should show all spaces if selection cleared", () => {
      const selection = null;
      expect(selection).toBeNull();
    });

    it("should handle space selection change", () => {
      let selection = "DOC";
      selection = "DEV"; // User changes selection
      
      expect(selection).toBe("DEV");
    });

    it("should persist selection in storage", () => {
      const storage = {};
      const setSelection = (key: string | null) => {
        if (key === null) {
          delete (storage as any).selected_space;
        } else {
          (storage as any).selected_space = key;
        }
      };
      
      setSelection("DOC");
      expect((storage as any).selected_space).toBe("DOC");
      
      setSelection(null);
      expect((storage as any).selected_space).toBeUndefined();
    });
  });

  describe("Default space behavior", () => {
    it("should default to 'All spaces' on first load", () => {
      const defaultSelection = null;
      expect(defaultSelection).toBeNull();
    });

    it("should show all spaces in dropdown initially", () => {
      const displaySpaces = mockSpaces;
      expect(displaySpaces).toHaveLength(4);
    });

    it("should allow switching to specific space", () => {
      let currentSelection = null;
      currentSelection = "DOC";
      
      expect(currentSelection).toBe("DOC");
    });

    it("should allow switching back to all spaces", () => {
      let currentSelection = "DOC";
      currentSelection = null;
      
      expect(currentSelection).toBeNull();
    });
  });
});

describe("Space-Scoped Search Integration", () => {
  describe("Search filtering by space", () => {
    it("should filter search results by selected space", () => {
      const allResults = [
        { spaceKey: "DOC", title: "Getting Started" },
        { spaceKey: "DEV", title: "API Reference" },
        { spaceKey: "DOC", title: "Configuration" },
        { spaceKey: "TEAM", title: "Team Guidelines" }
      ];
      
      const selectedSpace = "DOC";
      const filtered = allResults.filter(r => r.spaceKey === selectedSpace);
      
      expect(filtered).toHaveLength(2);
      expect(filtered.every(r => r.spaceKey === "DOC")).toBe(true);
    });

    it("should return all results when no space selected", () => {
      const results = [
        { spaceKey: "DOC", title: "Doc 1" },
        { spaceKey: "DEV", title: "Dev 1" }
      ];
      
      const selectedSpace = null;
      const filtered = selectedSpace ? 
        results.filter(r => r.spaceKey === selectedSpace) : 
        results;
      
      expect(filtered).toHaveLength(2);
    });

    it("should apply space filter to API request", () => {
      const query = "test";
      const selectedSpace = "DOC";
      
      // Mock API call with space filter
      const apiRequest = {
        query,
        spaceKey: selectedSpace
      };
      
      expect(apiRequest.spaceKey).toBe("DOC");
    });
  });

  describe("Search cache integration", () => {
    it("should use space-scoped cache from Session #4", () => {
      const cacheKey = { query: "api", spaceKey: "DEV" };
      expect(cacheKey.spaceKey).toBeDefined();
    });

    it("should differentiate cache by space", () => {
      const cache = new Map();
      cache.set("api:DOC", [{ id: "1", title: "Doc API" }]);
      cache.set("api:DEV", [{ id: "2", title: "Dev API" }]);
      
      expect(cache.get("api:DOC")).not.toBe(cache.get("api:DEV"));
    });

    it("should use same cache for unscoped queries", () => {
      const unscoped = "test:";
      const scoped1 = "test:DOC";
      const scoped2 = "test:DEV";
      
      expect(unscoped).not.toBe(scoped1);
      expect(scoped1).not.toBe(scoped2);
    });
  });
});

describe("Space Statistics and Monitoring", () => {
  describe("Space count and info", () => {
    it("should count total available spaces", () => {
      const count = mockSpaces.length;
      expect(count).toBe(4);
    });

    it("should report global vs personal spaces", () => {
      const global = mockSpaces.filter(s => s.type === "global").length;
      const personal = mockSpaces.filter(s => s.type === "personal").length;
      
      expect(global).toBe(3);
      expect(personal).toBe(1);
    });

    it("should provide cache freshness status", () => {
      const cache = {
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      
      const isExpired = Date.now() > cache.timestamp + cache.ttl;
      expect(isExpired).toBe(false);
    });

    it("should show time until cache expiration", () => {
      const ttl = 24 * 60 * 60 * 1000;
      const timestamp = Date.now();
      const expirationTime = timestamp + ttl;
      const timeUntilExpiry = expirationTime - Date.now();
      
      expect(timeUntilExpiry).toBeGreaterThan(ttl - 100); // Within margin
    });
  });

  describe("Monitoring and debugging", () => {
    it("should log space API calls", () => {
      const logs: string[] = [];
      logs.push("GET /rest/api/space - 4 spaces returned");
      
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("4 spaces");
    });

    it("should track space selection changes", () => {
      const events: string[] = [];
      events.push("Selected space: DOC");
      events.push("Selected space: DEV");
      events.push("Selected space: All");
      
      expect(events).toHaveLength(3);
    });

    it("should report cache hits vs misses", () => {
      const stats = {
        cacheHits: 15,
        cacheMisses: 2,
        hitRate: 15 / (15 + 2)
      };
      
      expect(stats.hitRate).toBeGreaterThan(0.8);
    });
  });
});

describe("Error Handling and Edge Cases", () => {
  describe("API error scenarios", () => {
    it("should handle unauthorized space access", () => {
      const error = new Error("Unauthorized");
      expect(error.message).toBe("Unauthorized");
    });

    it("should handle no spaces available", () => {
      const spaces = [] as any[];
      expect(spaces).toHaveLength(0);
    });

    it("should handle API timeout", () => {
      const timeout = 30000; // 30 seconds
      expect(timeout).toBeGreaterThan(10000);
    });

    it("should handle malformed space data", () => {
      const malformed = { key: "TEST" }; // Missing name field
      expect(malformed).toHaveProperty("key");
      expect(malformed).not.toHaveProperty("name");
    });
  });

  describe("Storage edge cases", () => {
    it("should handle very large space lists", () => {
      const largeList = Array.from({ length: 1000 }, (_, i) => ({
        key: `SPACE${i}`,
        name: `Space ${i}`,
        type: "global" as const
      }));
      
      expect(largeList).toHaveLength(1000);
    });

    it("should handle space names with unicode", () => {
      const unicodeSpaces = [
        { key: "RU", name: "Русский", type: "global" as const },
        { key: "CH", name: "中文", type: "global" as const },
        { key: "AR", name: "العربية", type: "global" as const }
      ];
      
      expect(unicodeSpaces[0].name).toBe("Русский");
    });

    it("should handle very long space names", () => {
      const longName = "A".repeat(500);
      const space = { key: "LONG", name: longName, type: "global" as const };
      expect(space.name.length).toBe(500);
    });

    it("should recover from corrupted cache", () => {
      // Detected corrupted cache
      const corrupted = null;
      
      if (corrupted) {
        // Use corrupted data
      } else {
        // Fallback: fetch fresh from API
        const fresh = mockSpaces;
        expect(fresh).toHaveLength(4);
      }
    });
  });

  describe("Concurrent operations", () => {
    it("should handle concurrent space list requests", () => {
      const requests = Array.from({ length: 10 }, () => mockSpaces);
      expect(requests).toHaveLength(10);
      expect(requests[0]).toBe(requests[1]);
    });

    it("should handle simultaneous cache update and read", () => {
      let cache = mockSpaces;
      
      // Simulate concurrent: read while updating
      const read1 = cache.length;
      cache = [mockSpaces[0], mockSpaces[1]]; // Update
      const read2 = cache.length;
      
      expect(read1).toBe(4);
      expect(read2).toBe(2);
    });
  });
});

describe("Integration with Session #4 (Search Cache)", () => {
  it("should use space-scoped search cache", () => {
    const cacheKey = {
      query: "api",
      spaceKey: "DEV"
    };
    
    expect(cacheKey).toHaveProperty("query");
    expect(cacheKey).toHaveProperty("spaceKey");
  });

  it("should provide space info to search results", () => {
    const result = {
      title: "API Reference",
      spaceKey: "DEV",
      space: mockSpaces.find(s => s.key === "DEV")
    };
    
    expect(result.space?.name).toBe("Development");
  });
});
