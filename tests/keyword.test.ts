import { describe, it, expect } from "vitest";
import { keywordSearch } from "../src/search/keyword";
import type { ConfluencePage } from "../src/types/messages";

const page = (id: string, title: string, content: string): ConfluencePage => ({
  id,
  url: `https://example.com/${id}`,
  title,
  contentText: content,
  spaceKey: "DOC",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("keywordSearch", () => {
  it("returns empty when no query tokens", () => {
    const pages = [page("1", "Doc", "content")];
    expect(keywordSearch("", pages)).toEqual([]);
    expect(keywordSearch("   ", pages)).toEqual([]);
  });

  it("returns matches sorted by score descending", () => {
    const pages = [
      page("1", "Getting Started", "Learn the basics"),
      page("2", "API Reference", "REST API and endpoints"),
      page("3", "Getting Started Advanced", "Getting started with advanced topics"),
    ];
    const results = keywordSearch("Getting Started", pages);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
    expect(results.map((r) => r.page.title)).toContain("Getting Started");
  });

  it("filters out zero-score pages", () => {
    const pages = [
      page("1", "Unrelated", "Other content"),
      page("2", "API Doc", "API documentation"),
    ];
    const results = keywordSearch("API", pages);
    expect(results).toHaveLength(1);
    expect(results[0].page.title).toBe("API Doc");
  });

  it("respects limit option", () => {
    const pages = [
      page("1", "API Guide", "API"),
      page("2", "API Reference", "API"),
      page("3", "API Tips", "API"),
    ];
    const results = keywordSearch("API", pages, { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("tokenizes and matches case-insensitively", () => {
    const pages = [page("1", "CONFLUENCE Guide", "confluence basics")];
    const results = keywordSearch("Confluence", pages);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0);
  });
});
