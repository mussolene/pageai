import { describe, expect, it } from "vitest";
import { mergeOrchestratorSettings, ORCHESTRATOR_SYNC_STORAGE_DEFAULTS } from "../src/agent/orchestrator-settings";

describe("mergeOrchestratorSettings", () => {
  it("uses defaults for empty storage", () => {
    const s = mergeOrchestratorSettings({});
    expect(s.orchestratorPlanEnabled).toBe(true);
    expect(s.orchestratorVerifyEnabled).toBe(true);
    expect(s.orchestratorCompressEnabled).toBe(false);
    expect(s.orchestratorToolRelevanceEnabled).toBe(true);
    expect(s.orchestratorNarrowToolsToRelevance).toBe(true);
    expect(s.orchestratorMaxToolIterations).toBe(10);
    expect(s.orchestratorCompressMinChars).toBe(ORCHESTRATOR_SYNC_STORAGE_DEFAULTS.orchestratorCompressMinChars);
  });

  it("clamps max tool iterations", () => {
    expect(mergeOrchestratorSettings({ orchestratorMaxToolIterations: 1 }).orchestratorMaxToolIterations).toBe(3);
    expect(mergeOrchestratorSettings({ orchestratorMaxToolIterations: 99 }).orchestratorMaxToolIterations).toBe(40);
  });

  it("enables compress only when explicitly true", () => {
    expect(mergeOrchestratorSettings({ orchestratorCompressEnabled: true }).orchestratorCompressEnabled).toBe(true);
    expect(mergeOrchestratorSettings({ orchestratorCompressEnabled: false }).orchestratorCompressEnabled).toBe(false);
  });

  it("clamps numeric fields", () => {
    const s = mergeOrchestratorSettings({
      orchestratorCompressMinChars: 50,
      orchestratorCompressMaxInputChars: 999999999,
      orchestratorCompressTargetChars: 10
    });
    expect(s.orchestratorCompressMinChars).toBeGreaterThanOrEqual(1000);
    expect(s.orchestratorCompressMaxInputChars).toBeLessThanOrEqual(500_000);
    expect(s.orchestratorCompressTargetChars).toBe(400);
  });

  it("accepts truncate mode", () => {
    expect(mergeOrchestratorSettings({ orchestratorCompressMode: "truncate" }).orchestratorCompressMode).toBe(
      "truncate"
    );
  });
});
