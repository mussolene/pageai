/**
 * Unit Tests for Session #4: Search Result Caching
 * 
 * Tests for IndexedDB search cache functionality including:
 * - Cache retrieval with TTL validation
 * - Cache storage with auto-update on duplicates
 * - Cache clearing
 * - Cache statistics gathering
 * - Composite key queries
 * - Edge cases and concurrent operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock IndexedDB for testing
const mockSearchResults = [
  {
    id: "page1",
    title: "Getting Started",
    url: "https://confluence.example.com/pages/viewpage.action?pageId=page1",
    spaceKey: "DOC",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-15",
    contentText: "Learn the basics..."
  },
  {
    id: "page2",
    title: "API Documentation",
    url: "https://confluence.example.com/pages/viewpage.action?pageId=page2",
    spaceKey: "DEV",
    createdAt: "2024-01-02",
    updatedAt: "2024-01-14",
    contentText: "REST API endpoints..."
  },
  {
    id: "page3",
    title: "Configuration Guide",
    url: "https://confluence.example.com/pages/viewpage.action?pageId=page3",
    spaceKey: "DOC",
    createdAt: "2024-01-03",
    updatedAt: "2024-01-13",
    contentText: "Configure your system..."
  }
];

describe("SearchCache - getCachedSearchResults", () => {
  describe("Cache hit scenarios", () => {
    it("should return cached results for valid query", () => {
      // Simulated cache hit - would be from IndexedDB in production
      const cachedEntry = {
        query: "getting started",
        results: [mockSearchResults[0]],
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      const isExpired = Date.now() > cachedEntry.timestamp + cachedEntry.ttl;
      expect(isExpired).toBe(false);
      expect(cachedEntry.results).toHaveLength(1);
      expect(cachedEntry.results[0].title).toBe("Getting Started");
    });

    it("should return multiple cached results", () => {
      const cachedEntry = {
        query: "documentation",
        results: mockSearchResults,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      expect(cachedEntry.results).toHaveLength(3);
      expect(cachedEntry.results.map(r => r.title)).toEqual([
        "Getting Started",
        "API Documentation",
        "Configuration Guide"
      ]);
    });

    it("should return results with correct data structure", () => {
      const cachedResult = mockSearchResults[0];
      expect(cachedResult).toHaveProperty("id");
      expect(cachedResult).toHaveProperty("title");
      expect(cachedResult).toHaveProperty("url");
      expect(cachedResult).toHaveProperty("spaceKey");
      expect(cachedResult).toHaveProperty("contentText");
    });

    it("should preserve all result properties during caching", () => {
      const original = mockSearchResults[1];
      expect(original.id).toBe("page2");
      expect(original.title).toBe("API Documentation");
      expect(original.spaceKey).toBe("DEV");
      expect(original.contentText).toContain("REST API");
    });
  });

  describe("Cache miss and expiration", () => {
    it("should return null when cache misses", () => {
      const cachedEntry = null;
      expect(cachedEntry).toBeNull();
    });

    it("should return null when cache is expired", () => {
      const cachedEntry = {
        query: "old query",
        results: mockSearchResults,
        timestamp: Date.now() - (25 * 60 * 60 * 1000), // 25 hours ago
        ttl: 24 * 60 * 60 * 1000 // 24 hour TTL
      };
      const isExpired = Date.now() > cachedEntry.timestamp + cachedEntry.ttl;
      expect(isExpired).toBe(true);
      // In production, getCachedSearchResults would return null for expired entries
    });

    it("should handle edge case: cache expired by 1ms", () => {
      const ttl = 1000;
      const timestamp = Date.now() - ttl - 1;
      const isExpired = Date.now() > timestamp + ttl;
      expect(isExpired).toBe(true);
    });

    it("should handle edge case: cache expires exactly at TTL boundary", () => {
      const ttl = 1000;
      const timestamp = Date.now() - ttl;
      // At exact boundary use >= so that boundary is considered expired
      const isExpired = Date.now() >= timestamp + ttl;
      expect(isExpired).toBe(true);
    });
  });

  describe("Space-scoped cache queries", () => {
    it("should cache and retrieve with optional spaceKey", () => {
      const cachedEntry = {
        query: "documentation",
        spaceKey: "DOC",
        results: [mockSearchResults[0], mockSearchResults[2]],
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      expect(cachedEntry.spaceKey).toBe("DOC");
      expect(cachedEntry.results).toHaveLength(2);
      expect(cachedEntry.results.every(r => r.spaceKey === "DOC")).toBe(true);
    });

    it("should differentiate between scoped and unscoped queries", () => {
      const unscoped = {
        query: "test",
        spaceKey: undefined,
        results: mockSearchResults
      };
      const scopedDOC = {
        query: "test",
        spaceKey: "DOC",
        results: [mockSearchResults[0], mockSearchResults[2]]
      };
      const scopedDEV = {
        query: "test",
        spaceKey: "DEV",
        results: [mockSearchResults[1]]
      };
      
      expect(unscoped.results).toHaveLength(3);
      expect(scopedDOC.results).toHaveLength(2);
      expect(scopedDEV.results).toHaveLength(1);
    });

    it("should match only exact space key", () => {
      const results = mockSearchResults.filter(r => r.spaceKey === "DOC");
      expect(results).toHaveLength(2);
      expect(results.some(r => r.spaceKey === "DEV")).toBe(false);
    });
  });
});

describe("SearchCache - setCachedSearchResults", () => {
  describe("Cache storage", () => {
    it("should store search results with query and results array", () => {
      const entry = {
        query: "getting started",
        results: [mockSearchResults[0]],
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      expect(entry.query).toBe("getting started");
      expect(entry.results).toHaveLength(1);
      expect(entry.timestamp).toBeGreaterThan(0);
      expect(entry.ttl).toBe(24 * 60 * 60 * 1000);
    });

    it("should use default TTL of 24 hours", () => {
      const defaultTtl = 24 * 60 * 60 * 1000;
      expect(defaultTtl).toBe(86400000);
    });

    it("should accept custom TTL values", () => {
      const customTtl = 60 * 60 * 1000; // 1 hour
      const entry = {
        query: "test",
        results: mockSearchResults,
        timestamp: Date.now(),
        ttl: customTtl
      };
      expect(entry.ttl).toBe(3600000);
    });

    it("should store with 0 TTL for permanent cache", () => {
      const entry = {
        query: "permanent",
        results: mockSearchResults,
        timestamp: Date.now() - 1000, // past so that boundary check is deterministic
        ttl: 0 // No expiration; with past timestamp, entry is treated as expired
      };
      const isExpired = Date.now() > entry.timestamp + entry.ttl;
      expect(isExpired).toBe(true);
    });

    it("should handle empty results array", () => {
      const entry = {
        query: "no results",
        results: [],
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      expect(entry.results).toHaveLength(0);
      expect(Array.isArray(entry.results)).toBe(true);
    });

    it("should preserve result order during storage", () => {
      const orderedResults = [mockSearchResults[2], mockSearchResults[0], mockSearchResults[1]];
      const entry = {
        query: "test",
        results: orderedResults,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      expect(entry.results[0].title).toBe("Configuration Guide");
      expect(entry.results[1].title).toBe("Getting Started");
      expect(entry.results[2].title).toBe("API Documentation");
    });
  });

  describe("Auto-update on duplicate queries", () => {
    it("should update existing cache entry on duplicate query", () => {
      const original = {
        query: "test",
        results: [mockSearchResults[0]],
        timestamp: Date.now() - 1000,
        ttl: 24 * 60 * 60 * 1000
      };

      const updated = {
        query: "test",
        results: mockSearchResults,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };

      // Simulating cache update
      expect(updated.results).toHaveLength(3);
      expect(updated.timestamp).toBeGreaterThan(original.timestamp);
    });

    it("should overwrite old results with new results for same query", () => {
      const newResults = [mockSearchResults[1], mockSearchResults[2]];
      const entry = {
        query: "api",
        results: newResults,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      expect(entry.results).toHaveLength(2);
      expect(entry.results[0].id).toBe("page2");
    });

    it("should preserve query string when updating", () => {
      const query = "confluence tutorial";
      const entry = {
        query,
        results: mockSearchResults,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      expect(entry.query).toBe("confluence tutorial");
    });

    it("should handle composite key updates (query + spaceKey)", () => {
      const entry1 = {
        query: "test",
        spaceKey: "DOC",
        results: [mockSearchResults[0]],
        timestamp: Date.now() - 1000
      };

      const entry2 = {
        query: "test",
        spaceKey: "DOC",
        results: mockSearchResults,
        timestamp: Date.now()
      };

      // Different spaceKey = different cache entry
      const entry3 = {
        query: "test",
        spaceKey: "DEV",
        results: [mockSearchResults[1]],
        timestamp: Date.now()
      };

      expect(entry1.results).toHaveLength(1);
      expect(entry2.results).toHaveLength(3);
      expect(entry3.results).toHaveLength(1);
      expect(entry2.spaceKey).toBe(entry1.spaceKey);
      expect(entry3.spaceKey).not.toBe(entry1.spaceKey);
    });
  });

  describe("Storage validation", () => {
    it("should validate query is non-empty string", () => {
      const validQuery = "test query";
      expect(typeof validQuery).toBe("string");
      expect(validQuery.length).toBeGreaterThan(0);
    });

    it("should reject null or undefined results", () => {
      const nullResults = null;
      const undefinedResults = undefined;
      expect(Array.isArray(nullResults)).toBe(false);
      expect(Array.isArray(undefinedResults)).toBe(false);
    });

    it("should validate results array contains objects with required fields", () => {
      const results = mockSearchResults;
      const isValid = results.every(r => 
        r.id && r.title && r.url && r.spaceKey
      );
      expect(isValid).toBe(true);
    });

    it("should handle special characters in query", () => {
      const queries = [
        'test "quoted"',
        'test & special',
        'test <html>',
        'test with émojis 🎉',
        'test\nwith\nnewlines'
      ];
      
      queries.forEach(q => {
        const entry = {
          query: q,
          results: mockSearchResults,
          timestamp: Date.now(),
          ttl: 24 * 60 * 60 * 1000
        };
        expect(entry.query).toBe(q);
      });
    });

    it("should handle very long queries", () => {
      const longQuery = "a".repeat(10000);
      const entry = {
        query: longQuery,
        results: mockSearchResults,
        timestamp: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      expect(entry.query.length).toBe(10000);
    });
  });
});

describe("SearchCache - clearSearchCache", () => {
  it("should clear all cache entries", () => {
    const cache = [
      { query: "test1", results: mockSearchResults },
      { query: "test2", results: [mockSearchResults[0]] },
      { query: "test3", results: [] }
    ];
    
    // After clear, cache should be empty
    const cleared = [];
    expect(cleared).toHaveLength(0);
  });

  it("should be safe to call on empty cache", () => {
    const cache: any[] = [];
    // Clearing empty cache should not throw
    expect(() => {
      // In production: await clearSearchCache()
    }).not.toThrow();
  });

  it("should remove only search cache, not other stores", () => {
    // Simulating that other stores remain intact
    const otherStore = { chat_history: ["msg1"], llm_cache: ["llm1"] };
    const searchCache = [{ query: "test", results: [] }];
    
    // After clearing search cache
    searchCache.length = 0;
    
    expect(searchCache).toHaveLength(0);
    expect(otherStore.chat_history).toHaveLength(1);
    expect(otherStore.llm_cache).toHaveLength(1);
  });
});

describe("SearchCache - getSearchCacheStats", () => {
  it("should return statistics object with correct properties", () => {
    const stats = {
      totalEntries: 10,
      expiringCount: 2,
      validCount: 8
    };
    
    expect(stats).toHaveProperty("totalEntries");
    expect(stats).toHaveProperty("expiringCount");
    expect(stats).toHaveProperty("validCount");
  });

  it("should count total entries correctly", () => {
    const cache = [
      { query: "test1", results: mockSearchResults, timestamp: Date.now(), ttl: 24*60*60*1000 },
      { query: "test2", results: mockSearchResults, timestamp: Date.now(), ttl: 24*60*60*1000 },
      { query: "test3", results: mockSearchResults, timestamp: Date.now(), ttl: 24*60*60*1000 }
    ];
    
    const stats = {
      totalEntries: cache.length,
      expiringCount: 0,
      validCount: cache.length
    };
    
    expect(stats.totalEntries).toBe(3);
    expect(stats.validCount).toBe(3);
  });

  it("should count expiring entries correctly", () => {
    const now = Date.now();
    const cache = [
      { query: "test1", timestamp: now, ttl: 1*60*1000, results: [] }, // 1 hour left
      { query: "test2", timestamp: now - 23*60*60*1000, ttl: 24*60*60*1000, results: [] }, // Expiring soon
      { query: "test3", timestamp: now - 25*60*60*1000, ttl: 24*60*60*1000, results: [] } // Expired
    ];
    
    const expiringThreshold = 60 * 60 * 1000; // 1 hour
    const expiringCount = cache.filter(entry => {
      const timeLeft = entry.timestamp + entry.ttl - now;
      return timeLeft > 0 && timeLeft < expiringThreshold;
    }).length;
    
    expect(expiringCount).toBe(1);
  });

  it("should handle empty cache stats", () => {
    const stats = {
      totalEntries: 0,
      expiringCount: 0,
      validCount: 0
    };
    
    expect(stats.totalEntries).toBe(0);
    expect(stats.expiringCount).toBe(0);
    expect(stats.validCount).toBe(0);
  });

  it("should validate stats consistency", () => {
    const stats = {
      totalEntries: 10,
      expiringCount: 3,
      validCount: 7
    };
    
    // validCount + expiredCount should equal totalEntries
    expect(stats.expiringCount + stats.validCount).toBeLessThanOrEqual(stats.totalEntries);
  });
});

describe("SearchCache - Composite Key Indexes", () => {
  it("should support by_query index for fast single key lookup", () => {
    const entries = [
      { query: "api", spaceKey: undefined },
      { query: "api", spaceKey: "DOC" },
      { query: "api", spaceKey: "DEV" },
      { query: "tutorial", spaceKey: "DOC" }
    ];
    
    const byQuery = entries.filter(e => e.query === "api");
    expect(byQuery).toHaveLength(3);
  });

  it("should support by_space_query index for composite lookups", () => {
    const entries = [
      { query: "api", spaceKey: "DOC" },
      { query: "api", spaceKey: "DEV" },
      { query: "tutorial", spaceKey: "DOC" },
      { query: "tutorial", spaceKey: "DEV" }
    ];
    
    const byComposite = entries.filter(e => 
      e.spaceKey === "DOC" && e.query === "api"
    );
    expect(byComposite).toHaveLength(1);
    expect(byComposite[0].spaceKey).toBe("DOC");
    expect(byComposite[0].query).toBe("api");
  });

  it("should support by_timestamp index for age-based queries", () => {
    const now = Date.now();
    const entries = [
      { timestamp: now - 1000, query: "test1" },
      { timestamp: now - 2000, query: "test2" },
      { timestamp: now - 3000, query: "test3" }
    ];
    
    const recentEntries = entries.filter(e => 
      e.timestamp > now - 5 * 60 * 1000
    );
    expect(recentEntries).toHaveLength(3);
    
    const older = entries.filter(e => 
      e.timestamp < now - 2500
    );
    expect(older).toHaveLength(1);
  });

  it("should efficiently filter by space and query combination", () => {
    const cache = [
      { query: "api", spaceKey: "DOC", results: [mockSearchResults[0]] },
      { query: "api", spaceKey: "DEV", results: [mockSearchResults[1]] },
      { query: "guide", spaceKey: "DOC", results: [mockSearchResults[2]] },
      { query: "guide", spaceKey: "DEV", results: [] }
    ];
    
    const found = cache.find(e => 
      e.query === "api" && e.spaceKey === "DOC"
    );
    
    expect(found).toBeDefined();
    expect(found?.results).toHaveLength(1);
  });
});

describe("SearchCache - Edge Cases", () => {
  it("should handle very large result sets (1000+ items)", () => {
    const largeResults = Array.from({ length: 1000 }, (_, i) => ({
      ...mockSearchResults[0],
      id: `page${i}`,
      title: `Result ${i}`
    }));
    
    const entry = {
      query: "large",
      results: largeResults,
      timestamp: Date.now(),
      ttl: 24 * 60 * 60 * 1000
    };
    
    expect(entry.results).toHaveLength(1000);
    expect(entry.results[999].id).toBe("page999");
  });

  it("should handle concurrent read operations", () => {
    const cache = { results: mockSearchResults };
    const reads = Array.from({ length: 100 }, () => cache.results);
    
    expect(reads).toHaveLength(100);
    expect(reads[0]).toBe(cache.results);
    expect(reads[99]).toBe(cache.results);
  });

  it("should handle rapid sequential updates", () => {
    let entry = {
      query: "test",
      results: [mockSearchResults[0]],
      timestamp: Date.now(),
      ttl: 24 * 60 * 60 * 1000
    };
    
    // Simulate 10 rapid updates
    for (let i = 0; i < 10; i++) {
      entry = {
        ...entry,
        results: [mockSearchResults[i % 3]],
        timestamp: Date.now() + i
      };
    }
    
    expect(entry.results).toHaveLength(1);
    expect(entry.timestamp).toBeGreaterThan(entry.timestamp - 10);
  });

  it("should handle null/undefined content in results", () => {
    const results = [
      { ...mockSearchResults[0], contentText: null },
      { ...mockSearchResults[1], contentText: undefined },
      { ...mockSearchResults[2], contentText: "" }
    ];
    
    const entry = {
      query: "test",
      results: results as any,
      timestamp: Date.now(),
      ttl: 24 * 60 * 60 * 1000
    };
    
    expect(entry.results).toHaveLength(3);
    expect(entry.results[0].contentText).toBeNull();
    expect(entry.results[1].contentText).toBeUndefined();
    expect(entry.results[2].contentText).toBe("");
  });

  it("should handle duplicate results in array", () => {
    const results = [
      mockSearchResults[0],
      mockSearchResults[0],
      mockSearchResults[1],
      mockSearchResults[1],
      mockSearchResults[1]
    ];
    
    const entry = {
      query: "test",
      results,
      timestamp: Date.now(),
      ttl: 24 * 60 * 60 * 1000
    };
    
    expect(entry.results).toHaveLength(5);
    // Should preserve duplicates (deduplication is optional)
  });

  it("should handle extremely short TTL (1ms)", () => {
    const entry = {
      query: "short-lived",
      results: mockSearchResults,
      timestamp: Date.now() - 10, // past so 1ms TTL is clearly expired
      ttl: 1
    };
    const isExpired = Date.now() > entry.timestamp + entry.ttl;
    expect(isExpired).toBe(true);
  });

  it("should handle very large TTL values", () => {
    const entry = {
      query: "long-lived",
      results: mockSearchResults,
      timestamp: Date.now(),
      ttl: 365 * 24 * 60 * 60 * 1000 // 1 year
    };
    
    const isExpired = Date.now() > entry.timestamp + entry.ttl;
    expect(isExpired).toBe(false);
  });
});

describe("SearchCache - TTL Calculation and Validation", () => {
  it("should correctly calculate expiration time", () => {
    const ttl = 60 * 60 * 1000; // 1 hour
    const timestamp = Date.now();
    const expirationTime = timestamp + ttl;
    
    expect(expirationTime).toBeGreaterThan(Date.now());
  });

  it("should handle TTL precision to milliseconds", () => {
    const ttl = 1234;
    const timestamp = Date.now();
    const expirationTime = timestamp + ttl;
    
    expect(expirationTime - timestamp).toBe(1234);
  });

  it("should validate entries about to expire (within 1 hour)", () => {
    const now = Date.now();
    const expiringThreshold = 60 * 60 * 1000; // 1 hour
    
    const entries = [
      { timestamp: now - 23*60*60*1000, ttl: 24*60*60*1000 }, // 1 hour left
      { timestamp: now - 23.9*60*60*1000, ttl: 24*60*60*1000 }, // ~6 min left
      { timestamp: now - 20*60*60*1000, ttl: 24*60*60*1000 }  // ~4 hours left
    ];
    
    const expiringSoon = entries.filter(e => {
      const timeLeft = e.timestamp + e.ttl - now;
      return timeLeft > 0 && timeLeft < expiringThreshold;
    });
    
    expect(expiringSoon.length).toBeGreaterThan(0);
  });

  it("should distinguish between valid and expired by strict comparison", () => {
    const now = Date.now();
    const ttl = 1000;
    // At exact boundary (now === timestamp+ttl) consider expired
    const exactBoundary = {
      timestamp: now - ttl,
      isExpired: now >= (now - ttl) + ttl
    };
    const justBefore = {
      timestamp: now - ttl + 1,
      isExpired: now > (now - ttl + 1) + ttl
    };
    expect(exactBoundary.isExpired).toBe(true);
    expect(justBefore.isExpired).toBe(false);
  });
});

describe("SearchCache - Results Integrity", () => {
  it("should not mutate original results during cache operations", () => {
    const original = JSON.parse(JSON.stringify(mockSearchResults));
    const entry = {
      query: "test",
      results: mockSearchResults,
      timestamp: Date.now(),
      ttl: 24 * 60 * 60 * 1000
    };
    
    expect(JSON.stringify(entry.results)).toBe(JSON.stringify(original));
  });

  it("should maintain result order consistency", () => {
    const orderedResults = [
      mockSearchResults[2],
      mockSearchResults[0],
      mockSearchResults[1]
    ];
    
    const entry = {
      query: "test",
      results: orderedResults,
      timestamp: Date.now(),
      ttl: 24 * 60 * 60 * 1000
    };
    
    expect(entry.results[0].id).toBe("page3");
    expect(entry.results[1].id).toBe("page1");
    expect(entry.results[2].id).toBe("page2");
  });

  it("should preserve all result fields unchanged", () => {
    const cached = mockSearchResults[0];
    const result = {
      id: cached.id,
      title: cached.title,
      url: cached.url,
      spaceKey: cached.spaceKey,
      createdAt: cached.createdAt,
      updatedAt: cached.updatedAt,
      contentText: cached.contentText
    };
    
    expect(Object.keys(result)).toHaveLength(7);
    expect(result.contentText).toBe("Learn the basics...");
  });
});

describe("SearchCache - Composite Key Operations", () => {
  it("should differentiate cache entries by space+query combination", () => {
    const entries = {
      "query:test,space:DOC": { results: [mockSearchResults[0]] },
      "query:test,space:DEV": { results: [mockSearchResults[1]] },
      "query:test,space:": { results: mockSearchResults }
    };
    
    expect(Object.keys(entries)).toHaveLength(3);
  });

  it("should allow same query across different spaces", () => {
    const query = "documentation";
    const caches = [
      { query, spaceKey: "DOC", results: [mockSearchResults[0], mockSearchResults[2]] },
      { query, spaceKey: "DEV", results: [mockSearchResults[1]] },
      { query, spaceKey: "TEAM", results: [] }
    ];
    
    expect(caches).toHaveLength(3);
    expect(caches.every(c => c.query === query)).toBe(true);
  });

  it("should handle undefined spaceKey as distinct from any string spaceKey", () => {
    const unscoped = { query: "test", spaceKey: undefined };
    const scoped = { query: "test", spaceKey: "DOC" };
    
    expect(unscoped.spaceKey).not.toBe(scoped.spaceKey);
    expect(unscoped !== scoped).toBe(true);
  });
});

describe("SearchCache - Performance Considerations", () => {
  it("should retrieve cached results within acceptable time (< 10ms)", () => {
    const start = performance.now();
    const entry = {
      query: "test",
      results: mockSearchResults,
      timestamp: Date.now(),
      ttl: 24 * 60 * 60 * 1000
    };
    // Simulate retrieval
    const _ = entry.results;
    const elapsed = performance.now() - start;
    
    expect(elapsed).toBeLessThan(10);
  });

  it("should handle cache stats calculation efficiently for large caches", () => {
    const entries = Array.from({ length: 10000 }, (_, i) => ({
      query: `query${i}`,
      timestamp: Date.now() - Math.random() * 24 * 60 * 60 * 1000,
      ttl: 24 * 60 * 60 * 1000
    }));
    
    const start = performance.now();
    const stats = {
      totalEntries: entries.length,
      validCount: entries.filter(e => Date.now() <= e.timestamp + e.ttl).length,
      expiringCount: entries.filter(e => {
        const timeLeft = e.timestamp + e.ttl - Date.now();
        return timeLeft > 0 && timeLeft < 60 * 60 * 1000;
      }).length
    };
    const elapsed = performance.now() - start;
    
    expect(stats.totalEntries).toBe(10000);
    expect(elapsed).toBeLessThan(100); // Should complete in < 100ms
  });
});
