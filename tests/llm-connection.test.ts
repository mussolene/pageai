import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkLlmConnection,
  getLMStudioModelsForEndpoint,
  checkLmStudioHealth,
  normalizeEndpoint,
} from "../src/llm/client";

describe("checkLlmConnection", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns available: true when models list is returned and no model check", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: "model-1" }] }),
    });
    const r = await checkLlmConnection("http://localhost:1234/v1/chat/completions");
    expect(r.available).toBe(true);
  });

  it("returns available: false for invalid endpoint URL", async () => {
    const r = await checkLlmConnection("");
    expect(r.available).toBe(false);
    expect(r.error).toContain("Invalid");
  });

  it("strips /v1/chat/completions from endpoint", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: "m" }] }),
    });
    await checkLlmConnection("http://host/v1/chat/completions");
    expect(global.fetch).toHaveBeenCalledWith("http://host/v1/models", expect.any(Object));
  });

  it("returns available: false when response not ok", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });
    const r = await checkLlmConnection("http://localhost:1234/v1/chat/completions");
    expect(r.available).toBe(false);
    expect(r.error).toContain("500");
  });

  it("returns available: false when no models in response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });
    const r = await checkLlmConnection("http://localhost:1234/v1/chat/completions");
    expect(r.available).toBe(false);
    expect(r.error).toContain("No models");
  });

  it("returns available: true when requested model is in list", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "qwen/qwen3-4b-2507" }, { id: "other" }],
        }),
    });
    const r = await checkLlmConnection(
      "http://localhost:1234/v1/chat/completions",
      "qwen/qwen3-4b-2507"
    );
    expect(r.available).toBe(true);
  });

  it("returns available: true when model matches by suffix (e.g. short name)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "qwen/qwen3-4b-2507" }],
        }),
    });
    const r = await checkLlmConnection(
      "http://localhost:1234/v1/chat/completions",
      "qwen3-4b-2507"
    );
    expect(r.available).toBe(true);
  });

  it("returns available: false when requested model not in list", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "model-a" }, { id: "model-b" }],
        }),
    });
    const r = await checkLlmConnection(
      "http://localhost:1234/v1/chat/completions",
      "missing-model"
    );
    expect(r.available).toBe(false);
    expect(r.error).toContain("not found");
  });

  it("returns Connection timeout on abort", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("abort"));
    const r = await checkLlmConnection("http://localhost:1234/v1/chat/completions");
    expect(r.available).toBe(false);
    expect(r.error).toContain("timeout");
  });
});

describe("getLMStudioModelsForEndpoint", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns models array from /v1/models", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { id: "qwen/qwen3-4b" },
            { id: "llama3.1" },
          ],
        }),
    });
    const r = await getLMStudioModelsForEndpoint("http://localhost:1234/v1/chat/completions");
    expect("models" in r && r.models).toEqual(["qwen/qwen3-4b", "llama3.1"]);
  });

  it("returns error for empty endpoint", async () => {
    const r = await getLMStudioModelsForEndpoint("");
    expect("error" in r).toBe(true);
    expect(r.error).toContain("Invalid");
  });

  it("returns error when fetch fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 403 });
    const r = await getLMStudioModelsForEndpoint("http://localhost:1234/v1/chat/completions");
    expect("error" in r).toBe(true);
    expect(r.error).toContain("403");
  });

  it("filters out models without id", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "a" }, {}, { id: "c" }],
        }),
    });
    const r = await getLMStudioModelsForEndpoint("http://localhost:1234/v1/chat/completions");
    expect("models" in r && r.models).toEqual(["a", "c"]);
  });
});

describe("checkLmStudioHealth", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    (global as any).chrome = {
      storage: {
        sync: {
          get: (defaults: any, cb: (v: any) => void) =>
            cb({
              llmEndpoint: "http://localhost:1234/v1/chat/completions",
              llmModel: "qwen/qwen3-4b-2507",
              llmApiKey: "",
              llmTemperature: 0.7,
              llmMaxTokens: 512,
            }),
        },
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns available when config and models exist", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: "qwen/qwen3-4b-2507" }] }),
    });
    const r = await checkLmStudioHealth();
    expect(r.available).toBe(true);
  });

  it("returns available: false when config is null", async () => {
    (global as any).chrome.storage.sync.get = (_: any, cb: (v: any) => void) =>
      cb({ llmEndpoint: "", llmModel: "" });
    const r = await checkLmStudioHealth();
    expect(r.available).toBe(false);
    expect(r.error).toContain("not configured");
  });
});

describe("normalizeEndpoint", () => {
  it("appends /v1/chat/completions to base URL", () => {
    expect(normalizeEndpoint("http://localhost:1234", "chat")).toBe(
      "http://localhost:1234/v1/chat/completions"
    );
  });

  it("does not duplicate path when already present", () => {
    expect(normalizeEndpoint("http://localhost:1234/v1/chat/completions", "chat")).toBe(
      "http://localhost:1234/v1/chat/completions"
    );
  });

  it("returns custom URL unchanged for type custom", () => {
    expect(normalizeEndpoint("http://custom/api/chat", "custom")).toBe("http://custom/api/chat");
  });

  it("returns empty string when input is only whitespace (trimmed)", () => {
    expect(normalizeEndpoint("  ", "chat")).toBe("");
  });

  it("appends path to base with trailing slash (no double-slash fix)", () => {
    // Implementation concatenates base + path; base may keep trailing slash
    expect(normalizeEndpoint("http://host/", "chat")).toBe("http://host//v1/chat/completions");
  });
});
