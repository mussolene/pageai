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
  await mkdir(join(outdir, "icons"), { recursive: true });
  await cp(join(root, "manifest.json"), join(outdir, "manifest.json"));
  await cp(join(root, "src", "ui", "panel.html"), join(outdir, "panel.html"));
  await cp(join(root, "src", "ui", "panel.css"), join(outdir, "panel.css"));
  await cp(join(root, "src", "ui", "popup.html"), join(outdir, "popup.html"));
  await cp(join(root, "src", "ui", "popup.css"), join(outdir, "popup.css"));
  await cp(join(root, "src", "ui", "options.html"), join(outdir, "options.html"));
  
  // Copy locale files
  await mkdir(join(outdir, "_locales", "en"), { recursive: true });
  await mkdir(join(outdir, "_locales", "ru"), { recursive: true });
  await cp(join(root, "_locales", "en", "messages.json"), join(outdir, "_locales", "en", "messages.json"));
  await cp(join(root, "_locales", "ru", "messages.json"), join(outdir, "_locales", "ru", "messages.json"));
  
  // Copy icons
  const iconSizes = [16, 32, 48, 128];
  for (const size of iconSizes) {
    const src = join(root, "icons", `icon${size}.png`);
    const dest = join(outdir, "icons", `icon${size}.png`);
    try {
      await cp(src, dest);
    } catch (err) {
      console.warn(`Could not copy icon${size}.png:`, err);
    }
  }
  
  // Copy locale files (for runtime loading if needed)
  await mkdir(join(outdir, "locales"), { recursive: true });
  try {
    await cp(join(root, "src", "i18n", "locales", "en.json"), join(outdir, "locales", "en.json"));
    await cp(join(root, "src", "i18n", "locales", "ru.json"), join(outdir, "locales", "ru.json"));
  } catch (err) {
    console.warn("Could not copy locale files:", err);
  }
}

async function run() {
  await copyStatic();

  await build({
    entryPoints: {
      background: join(__dirname, "..", "src", "background", "index.ts"),
      content: join(__dirname, "..", "src", "content", "index.ts"),
      panel: join(__dirname, "..", "src", "ui", "panel.ts"),
      popup: join(__dirname, "..", "src", "ui", "popup.ts"),
      options: join(__dirname, "..", "src", "ui", "options.ts")
    },
    bundle: true,
    sourcemap: !isProd,
    minify: isProd,
    outdir,
    target: ["chrome120"],
    format: "esm",
    logLevel: "info"
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

