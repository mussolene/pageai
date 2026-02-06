#!/usr/bin/env node

import { build } from "esbuild";
import { mkdir, cp } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isProd = process.argv.includes("--prod");
const outdir = join(__dirname, "..", "dist");

async function copyStatic() {
  const root = join(__dirname, "..");
  await mkdir(outdir, { recursive: true });
  await cp(join(root, "manifest.json"), join(outdir, "manifest.json"));
  await cp(join(root, "src", "ui", "panel.html"), join(outdir, "panel.html"));
  await cp(join(root, "src", "ui", "panel.css"), join(outdir, "panel.css"));
  await cp(join(root, "src", "ui", "options.html"), join(outdir, "options.html"));
}

async function run() {
  await copyStatic();

  await build({
    entryPoints: {
      background: join(__dirname, "..", "src", "background", "index.ts"),
      content: join(__dirname, "..", "src", "content", "confluence.ts"),
      panel: join(__dirname, "..", "src", "ui", "panel.ts"),
      options: join(__dirname, "..", "src", "ui", "options.ts")
    },
    bundle: true,
    sourcemap: !isProd,
    minify: isProd,
    outdir,
    target: ["chrome120"],
    format: "esm",
    logLevel: "info",
    watch: isProd
      ? false
      : {
          onRebuild(error) {
            if (error) {
              console.error("Rebuild failed:", error);
            } else {
              console.log("Rebuild succeeded");
            }
          }
        }
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

