import { describe, it, expect } from "vitest";
import { embedTexts, type EmbeddingProviderConfig } from "../src/search/embedding";

describe("embedding", () => {
  it("returns empty array (placeholder)", async () => {
    const config: EmbeddingProviderConfig = {
      endpoint: "http://localhost:8000/embed",
      model: "test",
    };
    const r = await embedTexts(["hello", "world"], config);
    expect(r).toEqual([]);
  });
});
