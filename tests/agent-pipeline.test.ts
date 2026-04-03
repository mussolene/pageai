import { describe, expect, it } from "vitest";
import { createInitialMetrics, parseVerifySubtaskJson } from "../src/agent/pipeline";

describe("parseVerifySubtaskJson", () => {
  it("parses plain JSON", () => {
    const p = parseVerifySubtaskJson(
      '{"sufficient":true,"reason":"ok","suggest_next":"none"}'
    );
    expect(p).toEqual({ sufficient: true, reason: "ok", suggestNext: "none" });
  });

  it("extracts JSON from surrounding text", () => {
    const p = parseVerifySubtaskJson(
      'Here: {"sufficient":false,"reason":"missing","suggest_next":"more_tools"} done'
    );
    expect(p).toEqual({
      sufficient: false,
      reason: "missing",
      suggestNext: "more_tools"
    });
  });

  it("normalizes unknown suggest_next to none", () => {
    const p = parseVerifySubtaskJson(
      '{"sufficient":true,"reason":"x","suggest_next":"invalid"}'
    );
    expect(p?.suggestNext).toBe("none");
  });

  it("returns null on garbage", () => {
    expect(parseVerifySubtaskJson("not json")).toBeNull();
  });
});

describe("createInitialMetrics", () => {
  it("starts in_progress", () => {
    const m = createInitialMetrics();
    expect(m.stopReason).toBe("in_progress");
    expect(m.subtasks.planExecuted).toBe(false);
    expect(m.subtasks.verifyRuns).toBe(0);
  });
});
