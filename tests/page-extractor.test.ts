import { describe, it, expect } from "vitest";
import { extractPageId } from "../src/content/page-extractor";

describe("extractPageId", () => {
  it("returns origin + pathname for full URL", () => {
    expect(extractPageId("https://example.com/wiki/spaces/DOC/pages/123")).toBe(
      "https://example.com/wiki/spaces/DOC/pages/123"
    );
  });

  it("strips hash", () => {
    expect(extractPageId("https://example.com/page#section")).toBe(
      "https://example.com/page"
    );
  });

  it("strips query params", () => {
    expect(extractPageId("https://example.com/page?foo=1&bar=2")).toBe(
      "https://example.com/page"
    );
  });

  it("strips both query and hash", () => {
    expect(extractPageId("https://example.com/page?q=1#anchor")).toBe(
      "https://example.com/page"
    );
  });

  it("returns url as-is on parse error", () => {
    expect(extractPageId("not-a-url")).toBe("not-a-url");
  });
});
