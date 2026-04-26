// Renders per-entity preview JPGs for the on-chain TallGrassMetadata image
// slot. Three aspects (1:1, 2:3, 9:16) per entity, auto-tuned JPEG quality
// to fit a single SSTORE2 chunk (raw bytes, base64-encoded at view time).
//
// Run against a vite dev server or `vite preview` build serving /full?id=N.
// Defaults to http://localhost:5173. Override with BASE_URL.
//
//   npm run dev               # in another terminal
//   node scripts/render-onchain-previews.mjs
//
// Output: <repo>/previews/onchain/{1x1,2x3,9x16}/{0..31}.jpg
//
// Reproducibility: Date.now() is stubbed to a fixed wall-clock anchor
// (Berlin opening evening) so re-runs produce identical frames. The
// shader still uses performance.now() for delta updates, so we wait a
// fixed warmup period before snapshotting.

import puppeteer from "puppeteer";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREVIEWS_ROOT = resolve(__dirname, "../../previews/onchain");

const BASE_URL = process.env.BASE_URL || "http://localhost:5173";
const ENTITY_COUNT = parseInt(process.env.ENTITY_COUNT || "32", 10);
const TARGET_BYTES = parseInt(process.env.TARGET_BYTES || "23000", 10);
const WARMUP_MS = parseInt(process.env.WARMUP_MS || "2500", 10);
const FROZEN_NOW_MS = parseInt(
  process.env.FROZEN_NOW_MS || String(Date.parse("2025-05-01T19:00:00Z")),
  10,
);

// Per-aspect default zoom. Lower = wider field, slab appears smaller.
// Stage's docs say 1.0 fits desktop landscape, 1.55 fits 9:16 portrait;
// the previews want a bit more breathing room than the live Monolith,
// so we sit a hair below those reference values. Override globally with
// ZOOM=<n>, or skip individual aspects with ZOOM_1X1=, ZOOM_2X3=, etc.
const ZOOM_OVERRIDE = process.env.ZOOM ? parseFloat(process.env.ZOOM) : undefined;
const ASPECTS = [
  { name: "1x1", width: 750, height: 750, zoom: parseFloat(process.env.ZOOM_1X1 ?? "0.9") },
  { name: "2x3", width: 600, height: 900, zoom: parseFloat(process.env.ZOOM_2X3 ?? "1.0") },
  { name: "9x16", width: 540, height: 960, zoom: parseFloat(process.env.ZOOM_9X16 ?? "1.15") },
].map((a) => ({ ...a, zoom: ZOOM_OVERRIDE ?? a.zoom }));

async function encodeJpegUnderTarget(rawPng, target) {
  let lo = 25;
  let hi = 85;
  let best = null;
  while (lo <= hi) {
    const q = Math.floor((lo + hi) / 2);
    const buf = await sharp(rawPng)
      .jpeg({ quality: q, mozjpeg: true, chromaSubsampling: "4:2:0" })
      .toBuffer();
    if (buf.length <= target) {
      best = { buf, quality: q };
      lo = q + 1;
    } else {
      hi = q - 1;
    }
  }
  if (best) return { ...best, oversized: false };
  const fallback = await sharp(rawPng)
    .jpeg({ quality: 25, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .toBuffer();
  return { buf: fallback, quality: 25, oversized: true };
}

async function renderOne(browser, id, aspect) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((nowMs) => {
    Date.now = () => nowMs;
  }, FROZEN_NOW_MS);

  await page.setViewport({
    width: aspect.width,
    height: aspect.height,
    deviceScaleFactor: 1,
  });
  const url = `${BASE_URL}/full?id=${id}&zoom=${aspect.zoom}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("canvas", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, WARMUP_MS));

  // page.screenshot captures the composited frame from the browser, so
  // we don't need preserveDrawingBuffer on the WebGL context (which would
  // require touching Stage.tsx). Black/empty captures here mean either
  // WebGL failed to initialize or the warmup wasn't long enough.
  const pngBuf = await page.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width: aspect.width, height: aspect.height },
    omitBackground: false,
  });
  await page.close();

  // Sanity check: warn if the capture looks all-black (likely WebGL
  // didn't render or is using a software fallback that returned blank).
  const meanLuma = await sharp(pngBuf).resize(8, 8).greyscale().raw().toBuffer()
    .then((b) => b.reduce((s, v) => s + v, 0) / b.length);

  const result = await encodeJpegUnderTarget(pngBuf, TARGET_BYTES);
  return { ...result, sourcePixels: aspect.width * aspect.height, meanLuma };
}

async function main() {
  console.log(
    `Rendering ${ENTITY_COUNT} entities x ${ASPECTS.length} aspects against ${BASE_URL}`,
  );
  console.log(`Target: <=${TARGET_BYTES} bytes per JPEG (single SSTORE2 chunk).`);
  console.log(`Frozen Date.now() = ${new Date(FROZEN_NOW_MS).toISOString()}`);

  // Headless WebGL on macOS: the new headless mode (puppeteer >= 22) ships
  // with SwiftShader so WebGL works without a GPU. If you still see blank
  // captures, run with HEADLESS=false to open a visible window and confirm
  // the page is rendering.
  const headless = process.env.HEADLESS === "false" ? false : true;
  const browser = await puppeteer.launch({
    headless,
    args: [
      "--no-sandbox",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    ],
  });

  const oversized = [];
  for (const aspect of ASPECTS) {
    const dir = resolve(PREVIEWS_ROOT, aspect.name);
    mkdirSync(dir, { recursive: true });
    console.log(`\n[${aspect.name}] ${aspect.width}x${aspect.height} zoom=${aspect.zoom}`);
    for (let id = 0; id < ENTITY_COUNT; id++) {
      const { buf, quality, oversized: tooBig, meanLuma } = await renderOne(
        browser,
        id,
        aspect,
      );
      const outPath = resolve(dir, `${id}.jpg`);
      writeFileSync(outPath, buf);
      const kb = (buf.length / 1024).toFixed(1);
      const flags = [];
      if (tooBig) flags.push("OVER TARGET");
      if (meanLuma < 2) flags.push(`BLANK (luma=${meanLuma.toFixed(1)})`);
      const flagStr = flags.length ? "  " + flags.join(", ") : "";
      console.log(
        `  id=${String(id).padStart(2, " ")}  q=${String(quality).padStart(2, " ")}  ${kb.padStart(5, " ")}KB  luma=${meanLuma.toFixed(0).padStart(3, " ")}${flagStr}`,
      );
      if (tooBig) oversized.push({ aspect: aspect.name, id, bytes: buf.length });
    }
  }

  await browser.close();

  if (oversized.length) {
    console.error(
      `\n${oversized.length} preview(s) exceeded target. Reduce dimensions or raise TARGET_BYTES:`,
    );
    for (const o of oversized) {
      console.error(
        `  ${o.aspect}/${o.id}.jpg: ${(o.bytes / 1024).toFixed(1)}KB`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log("\nAll previews under target.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
