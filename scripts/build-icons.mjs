#!/usr/bin/env node
/**
 * Генерирует PNG иконки из icons/icon.svg для размеров 16, 32, 48, 128.
 * Требуется для manifest: иконка должна хорошо смотреться на светлой и тёмной теме (Chrome best practices).
 */
import sharp from "sharp";
import { mkdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const iconsDir = join(root, "icons");
const svgPath = join(iconsDir, "icon.svg");
const sizes = [16, 32, 48, 128];

async function main() {
  const svg = await readFile(svgPath);
  await mkdir(iconsDir, { recursive: true });

  for (const size of sizes) {
    const out = join(iconsDir, `icon${size}.png`);
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(out);
    console.log(`icons/icon${size}.png`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
