import { describe, expect, it } from "vitest";
import {
  appendReplyLanguageToSystemPrompt,
  buildReplyLanguageEnforcementBlock,
  detectReplyLanguageFromUserText,
  findLastUserPlainText
} from "../src/llm/reply-language";

describe("findLastUserPlainText", () => {
  it("returns the last user message", () => {
    expect(
      findLastUserPlainText([
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "second" }
      ])
    ).toBe("second");
  });

  it("skips empty user messages", () => {
    expect(
      findLastUserPlainText([
        { role: "user", content: "   " },
        { role: "user", content: "keep" }
      ])
    ).toBe("keep");
  });
});

describe("detectReplyLanguageFromUserText", () => {
  it("detects Cyrillic as Russian", () => {
    expect(detectReplyLanguageFromUserText("Привет, как дела?", "en")).toBe("ru");
  });

  it("detects Ukrainian letters", () => {
    expect(detectReplyLanguageFromUserText("Привіт, як справи?", "en")).toBe("uk");
  });

  it("detects Latin English-style text as English even if UI is Russian", () => {
    expect(detectReplyLanguageFromUserText("What is the API error?", "ru")).toBe("en");
  });

  it("uses UI locale for ambiguous Latin", () => {
    expect(detectReplyLanguageFromUserText("x", "ru")).toBe("ru");
    expect(detectReplyLanguageFromUserText("x", "en")).toBe("en");
  });

  it("detects CJK scripts", () => {
    expect(detectReplyLanguageFromUserText("月球任务进展", "en")).toBe("zh");
    expect(detectReplyLanguageFromUserText("月へ行く", "en")).toBe("ja");
    expect(detectReplyLanguageFromUserText("달 탐사", "en")).toBe("ko");
  });
});

describe("appendReplyLanguageToSystemPrompt", () => {
  it("appends Russian enforcement for Cyrillic input", () => {
    const out = appendReplyLanguageToSystemPrompt("BASE", "Тест", "en");
    expect(out.startsWith("BASE")).toBe(true);
    expect(out).toContain("[REPLY_LANGUAGE");
    expect(out).toContain("Russian");
    expect(out).toContain("русск");
  });

  it("uses UI locale when user text missing", () => {
    const ru = appendReplyLanguageToSystemPrompt("BASE", null, "ru");
    expect(ru).toContain("Russian");
    const en = appendReplyLanguageToSystemPrompt("BASE", null, "en");
    expect(en).toContain("English");
  });
});

describe("buildReplyLanguageEnforcementBlock", () => {
  it("covers all codes", () => {
    for (const code of ["en", "ru", "uk", "zh", "ja", "ko"] as const) {
      expect(buildReplyLanguageEnforcementBlock(code).length).toBeGreaterThan(20);
    }
  });
});
