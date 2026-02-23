import { describe, it, expect } from "vitest";
import {
  buildChatSystemPrompt,
  buildSummaryPrompt,
  buildSourceAwarePrompt,
} from "../src/llm/prompts";
import type { ConfluencePage } from "../src/types/messages";

describe("buildChatSystemPrompt", () => {
  it("returns non-empty string with Confluence and sources instructions", () => {
    const s = buildChatSystemPrompt();
    expect(s.length).toBeGreaterThan(0);
    expect(s).toContain("Confluence");
    expect(s).toContain("Источники:");
    expect(s).toContain("---");
  });
});

describe("buildSummaryPrompt", () => {
  it("includes query when provided", () => {
    const pages: ConfluencePage[] = [
      {
        id: "1",
        url: "http://e.com/1",
        title: "Page 1",
        contentText: "Content here",
        createdAt: "",
        updatedAt: "",
      },
    ];
    const s = buildSummaryPrompt(pages, "What is X?");
    expect(s).toContain("What is X?");
    expect(s).toContain("Page 1");
    expect(s).toContain("http://e.com/1");
    expect(s).toContain("Content here");
  });

  it("uses default query when query is undefined", () => {
    const pages: ConfluencePage[] = [
      {
        id: "1",
        url: "u",
        title: "T",
        contentText: "C",
        createdAt: "",
        updatedAt: "",
      },
    ];
    const s = buildSummaryPrompt(pages);
    expect(s).toContain("обзор");
  });

  it("slices page content to 4000 chars", () => {
    const long = "a".repeat(5000);
    const pages: ConfluencePage[] = [
      {
        id: "1",
        url: "u",
        title: "T",
        contentText: long,
        createdAt: "",
        updatedAt: "",
      },
    ];
    const s = buildSummaryPrompt(pages, "q");
    expect(s).toContain("a".repeat(4000));
    expect(s).not.toContain("a".repeat(5000));
  });
});

describe("buildSourceAwarePrompt", () => {
  it("includes user query and optional context", () => {
    const s = buildSourceAwarePrompt("Explain API", "Current page: /docs");
    expect(s).toContain("Explain API");
    expect(s).toContain("Current page: /docs");
    expect(s).toContain("[1]");
    expect(s).toContain("Источники:");
  });

  it("uses default when context is undefined", () => {
    const s = buildSourceAwarePrompt("Query only");
    expect(s).toContain("Query only");
    expect(s).toContain("Нет доступного контекста");
  });
});
