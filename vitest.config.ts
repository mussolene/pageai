import { defineConfig } from "vitest/config";

const withCoverage = process.argv.includes("--coverage");

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    exclude: [
      "node_modules",
      "dist",
      "tests/llm-cache.test.ts", // IndexedDB-dependent; run in browser or with full IDB mock
      ...(withCoverage
        ? [
            "tests/session-*.test.ts",
            "tests/search-cache.test.ts",
            "tests/markdown.test.ts",
          ]
        : []),
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/types/**",
        "src/ui/panel.ts",
        "src/ui/popup.ts",
        "src/ui/options.ts",
        "src/ui/markdown.ts",
        "src/content/index.ts",
        "src/content/page-extractor.ts",
        "src/background/index.ts",
        "src/storage/indexdb.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 79,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
