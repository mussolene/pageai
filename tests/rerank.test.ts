import { describe, it, expect } from "vitest";
import { rerank } from "../src/search/rerank";
import type { SearchResult } from "../src/types/messages";

describe("rerank", () => {
  it("returns the same array (no reordering)", () => {
    const results: SearchResult[] = [
      { page: { id: "1", url: "u1", title: "A", contentText: "x", createdAt: "", updatedAt: "" }, score: 1 },
      { page: { id: "2", url: "u2", title: "B", contentText: "y", createdAt: "", updatedAt: "" }, score: 2 },
    ];
    expect(rerank(results)).toBe(results);
    expect(rerank(results)).toEqual(results);
  });

  it("returns empty array for empty input", () => {
    expect(rerank([])).toEqual([]);
  });
});
