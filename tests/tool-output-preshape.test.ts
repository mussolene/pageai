import { describe, expect, it } from "vitest";
import {
  grepRelevantExcerpt,
  lastUserContentFromApiMessages,
  preshapeToolOutputForContext,
  tokenizeQueryHints
} from "../src/agent/tool-output-preshape";
import type { LlmMessageForApi } from "../src/llm/client";

describe("tokenizeQueryHints", () => {
  it("drops short tokens and stop words", () => {
    expect(tokenizeQueryHints("What is the Kubernetes pod status?", 10)).toContain("kubernetes");
    expect(tokenizeQueryHints("What is the Kubernetes pod status?", 10)).toContain("pod");
    expect(tokenizeQueryHints("What is the Kubernetes pod status?", 10)).toContain("status");
  });

  it("strips urls before tokenizing", () => {
    const h = tokenizeQueryHints("See https://example.com/path and the deployment rollout");
    expect(h.some((x) => x.includes("http"))).toBe(false);
    expect(h).toContain("deployment");
    expect(h).toContain("rollout");
  });
});

describe("lastUserContentFromApiMessages", () => {
  it("returns last user string walking from end", () => {
    const messages: LlmMessageForApi[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second ask" }
    ];
    expect(lastUserContentFromApiMessages(messages)).toBe("second ask");
  });

  it("skips trailing assistant to find user", () => {
    const messages: LlmMessageForApi[] = [
      { role: "user", content: "goal" },
      { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "x", arguments: "{}" } }] }
    ];
    expect(lastUserContentFromApiMessages(messages)).toBe("goal");
  });
});

describe("grepRelevantExcerpt", () => {
  it("returns null when no hint matches", () => {
    const text = "alpha\nbeta\n";
    expect(grepRelevantExcerpt(text, ["zzz"], 500, 1)).toBe(null);
  });

  it("merges adjacent line ranges with context", () => {
    const text = ["a0", "a1", "hit1", "a2", "mid", "b0", "hit2", "b1"].join("\n");
    const out = grepRelevantExcerpt(text, ["hit1", "hit2"], 2000, 1);
    expect(out).not.toBe(null);
    expect(out!).toContain("hit1");
    expect(out!).toContain("hit2");
  });
});

describe("preshapeToolOutputForContext", () => {
  it("returns excerpt when hints match and output is large", () => {
    const filler = Array.from({ length: 200 }, (_, i) => `row ${i} padding`).join("\n");
    const raw = `${filler}\nuniqueTokenForTest xyz\n${filler}`;
    const out = preshapeToolOutputForContext(raw, {
      enabled: true,
      minChars: 1000,
      maxOutChars: 8000,
      contextLines: 1,
      userGoal: "Find uniqueTokenForTest details"
    });
    expect(out.length).toBeLessThan(raw.length);
    expect(out).toContain("uniqueTokenForTest");
    expect(out).toContain("Relevant lines");
  });

  it("returns normalized body when disabled", () => {
    const raw = "a  \n\n\n\nb";
    const out = preshapeToolOutputForContext(raw, {
      enabled: false,
      minChars: 1,
      maxOutChars: 100,
      contextLines: 1,
      userGoal: "whatever"
    });
    expect(out).toContain("a");
    expect(out).toContain("b");
  });
});
