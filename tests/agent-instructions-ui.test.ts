import { describe, it, expect } from "vitest";
import { mergeAgentInstructionsForDisplay, persistUnifiedAgentInstructions } from "../src/chat/agent-instructions-ui";

describe("agent-instructions-ui", () => {
  it("mergeAgentInstructionsForDisplay joins non-empty rules and skills", () => {
    expect(mergeAgentInstructionsForDisplay("a", "b")).toBe("a\n\n---\n\nb");
  });

  it("persistUnifiedAgentInstructions clears legacy skills key", () => {
    expect(persistUnifiedAgentInstructions("only")).toEqual({ agentRules: "only", agentSkills: "" });
  });
});
