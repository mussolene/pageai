/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import {
  extractLikelyYearsFromQuery,
  extractReadablePage,
  normalizeUrlKey,
  parseDuckDuckGoSerpHtml,
  prioritizeSerpHitsByYearInQuery,
  resolveDuckRedirect,
  runWebResearch
} from "../src/search/web-research";

describe("normalizeUrlKey / resolveDuckRedirect", () => {
  it("normalizes https URL", () => {
    expect(normalizeUrlKey("https://ExAmple.com/foo/?x=1#h")).toBe("https://example.com/foo/?x=1");
  });

  it("returns null for non-http(s)", () => {
    expect(normalizeUrlKey("javascript:alert(1)")).toBe(null);
  });

  it("unwraps DuckDuckGo uddg redirect", () => {
    const u =
      "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwiki.example.org%2Fpage&rut=…";
    expect(resolveDuckRedirect(u)).toBe("https://wiki.example.org/page");
  });
});

describe("extractLikelyYearsFromQuery / prioritizeSerpHitsByYearInQuery", () => {
  it("extracts unique 19xx/20xx years", () => {
    expect(extractLikelyYearsFromQuery("lunar mission 2026 and 1969")).toEqual(["2026", "1969"]);
    expect(extractLikelyYearsFromQuery("no years")).toEqual([]);
  });

  it("ranks SERP hits with matching year higher", () => {
    const hits = [
      { title: "Apollo 13 mission", url: "https://nasa.gov/apollo13" },
      { title: "Artemis update 2026", url: "https://nasa.gov/artemis-2026" }
    ];
    const q = "latest moon flight 2026";
    expect(prioritizeSerpHitsByYearInQuery(hits, q)[0]?.url).toContain("artemis");
  });
});

describe("parseDuckDuckGoSerpHtml", () => {
  it("extracts result__a targets", () => {
    const html = `<!DOCTYPE html><html><body>
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fsite.org%2Fa">Site A</a>
      <a class="result__a" href="https://direct.example/b">Direct B</a>
    </body></html>`;
    const r = parseDuckDuckGoSerpHtml(html);
    expect(r.map((x) => x.url)).toEqual(["https://site.org/a", "https://direct.example/b"]);
    expect(r[0]?.title).toContain("Site A");
  });
});

describe("extractReadablePage", () => {
  it("pulls main text and links", () => {
    const html = `<html><head><title>T</title></head><body>
      <main><p>Hello world content block</p><a href="/next">next page</a></main>
    </body></html>`;
    const p = extractReadablePage(html, "https://origin.test/doc");
    expect(p.title).toBe("T");
    expect(p.text).toContain("Hello world");
    expect(p.links.some((l) => l.href === "https://origin.test/next")).toBe(true);
  });
});

describe("runWebResearch", () => {
  it("chains SERP and pages with mocked fetch", async () => {
    const serp = `<html><body>
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Forigin.test%2Farticle">Art</a>
    </body></html>`;
    const pageA = `<html><head><title>Article</title></head><body><main>
      <p>python asyncio tutorial keywords here for matching</p>
      <a href="https://origin.test/deep">asyncio deep dive</a>
    </main></body></html>`;
    const pageDeep = `<html><head><title>Deep</title></head><body><main>
      <p>asyncio deep dive continuation text</p>
    </main></body></html>`;

    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("duckduckgo.com")) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(serp) } as Response);
      }
      if (url.includes("origin.test/article")) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(pageA) } as Response);
      }
      if (url.includes("origin.test/deep")) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(pageDeep) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") } as Response);
    });

    const out = await runWebResearch("python asyncio tutorial", fetchMock as typeof fetch, {
      maxDepth: 1,
      maxPages: 5,
      serpLimit: 3,
      maxFollowPerPage: 4,
      maxTotalReportChars: 50_000
    });

    expect(out).toContain("UNTRUSTED_TOOL_PAYLOAD_BEGIN");
    expect(out).toContain("Web research");
    expect(out).toContain("Article");
    expect(out).toContain("origin.test/article");
    expect(out).toContain("Cross-link from:");
    expect(out).toContain("Deep");
    expect(fetchMock).toHaveBeenCalled();
  });
});
