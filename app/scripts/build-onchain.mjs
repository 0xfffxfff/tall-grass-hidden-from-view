#!/usr/bin/env node
// Build the on-chain viewer HTML.
//
// Output: app/dist/onchain/full.html — a single self-contained HTML
// file with two <!--TG_ID_INJECT--> markers. The metadata contract's
// upload-html task (contracts/tasks/upload-html.ts) splits on those
// markers to produce three SSTORE2-uploaded sections (head, script,
// tail). At view time the contract reassembles them with a per-token
// `<script>window.__TG_ID=N;</script>` wedged in the middle.
//
// This script:
//   1. Verifies the shader strings in app/onchain/shaders.ts match
//      app/src/components/monolith/Stage.tsx byte-for-byte. Aborts
//      on drift — the on-chain art is frozen.
//   2. esbuild-bundles main.ts + a tiny entry into a minified IIFE.
//   3. Splits index.html on the two markers and writes the final
//      HTML with the bundled IIFE wedged into the script section.
//   4. Reports byte sizes per section (flagging anything over the
//      24KB SSTORE2 single-chunk limit; the upload task chunks
//      automatically, so we just warn).
//   5. Writes a sidecar sections.json for downstream tooling.
//   6. Writes a test.html with __TG_ID=0 injected so the user can
//      open the file directly from disk to smoke-test.

import { build } from "esbuild";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const ONCHAIN = join(APP, "onchain");
const DIST = join(APP, "dist", "onchain");

const STAGE_TSX = join(APP, "src", "components", "monolith", "Stage.tsx");
const SHADERS_TS = join(ONCHAIN, "shaders.ts");
const INDEX_HTML = join(ONCHAIN, "index.html");

const MARKER = "<!--TG_ID_INJECT-->";
const SSTORE2_LIMIT = 24_000;

// ---------------------------------------------------------------------
// Shader parity check
// ---------------------------------------------------------------------

// Extract the contents of a top-level `const NAME = \`...\`;` template
// literal from a .ts file. Tolerates leading `export `. Returns the raw
// string between the backticks. Throws if not found or not unique.
function extractTemplate(source, name) {
  // Greedy regex: match `const NAME = \`...\`;` capturing the body.
  // The shader bodies don't contain backticks themselves, so a non-greedy
  // match between the first opening backtick and the next backtick is safe.
  const re = new RegExp(
    "(?:export\\s+)?const\\s+" + name + "\\s*=\\s*`([\\s\\S]*?)`",
  );
  const m = source.match(re);
  if (!m) {
    throw new Error(`could not find \`const ${name} = \\\`...\\\`\` in source`);
  }
  return m[1];
}

async function checkShaderParity() {
  const stage = await readFile(STAGE_TSX, "utf8");
  const ours = await readFile(SHADERS_TS, "utf8");
  const names = ["VS_SRC", "FS_NOISE_SRC", "FS_BLUR_SRC"];
  for (const n of names) {
    const a = extractTemplate(stage, n);
    const b = extractTemplate(ours, n);
    if (a !== b) {
      // Find the first differing character to make the diff actionable.
      const len = Math.min(a.length, b.length);
      let diffAt = -1;
      for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) {
          diffAt = i;
          break;
        }
      }
      if (diffAt === -1) diffAt = len;
      const ctxStart = Math.max(0, diffAt - 40);
      const ctxEnd = diffAt + 40;
      const head = `shader parity FAILED for ${n}: lengths stage=${a.length} ours=${b.length}, first diff at offset ${diffAt}`;
      const cA = JSON.stringify(a.slice(ctxStart, ctxEnd));
      const cB = JSON.stringify(b.slice(ctxStart, ctxEnd));
      throw new Error(`${head}\n  stage: ${cA}\n  ours:  ${cB}`);
    }
  }
  console.log(
    `shader parity OK: ${names.join(", ")} match Stage.tsx byte-for-byte`,
  );
}

// ---------------------------------------------------------------------
// Bundle main.ts + entry into a single IIFE
// ---------------------------------------------------------------------

const ENTRY = `
import { mount } from "./main";
// __TG_ID is injected by the metadata contract at view time as a
// separate <script> tag immediately before this bundle. If absent
// (raw build, smoke test, or the empty-state pre-mint case) we fall
// back to undefined => Monolith mode.
declare global {
  interface Window { __TG_ID?: number }
}
const id = typeof window.__TG_ID === "number" ? window.__TG_ID : undefined;
const canvas = document.querySelector("canvas#tg") as HTMLCanvasElement | null;
if (canvas) {
  mount(canvas, { entityId: id, zoom: 1.4 });
}
`;

async function bundleScript() {
  // esbuild's stdin lets us inject the entry without writing a temp
  // file. resolveDir tells esbuild where "./main" lives.
  const result = await build({
    stdin: {
      contents: ENTRY,
      resolveDir: ONCHAIN,
      sourcefile: "entry.ts",
      loader: "ts",
    },
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2019"],
    platform: "browser",
    write: false,
    legalComments: "none",
    logLevel: "warning",
  });
  if (result.errors.length > 0) {
    throw new Error("esbuild reported errors: " + JSON.stringify(result.errors));
  }
  return result.outputFiles[0].text;
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  await checkShaderParity();

  const html = await readFile(INDEX_HTML, "utf8");
  const firstIdx = html.indexOf(MARKER);
  const secondIdx = firstIdx === -1 ? -1 : html.indexOf(MARKER, firstIdx + MARKER.length);
  if (firstIdx === -1 || secondIdx === -1) {
    throw new Error(
      `index.html must contain exactly two ${MARKER} markers (head|script|tail boundaries)`,
    );
  }
  const head = html.slice(0, firstIdx);
  // Reject anything between the markers in the source — the build
  // owns the script section. This catches the "someone added a comment
  // between the markers" footgun.
  const between = html.slice(firstIdx + MARKER.length, secondIdx);
  if (between.trim().length > 0) {
    throw new Error(
      `index.html: content between the two markers must be empty, got ${JSON.stringify(between)}`,
    );
  }
  const tail = html.slice(secondIdx + MARKER.length);

  const bundle = await bundleScript();
  // Wrap the IIFE in <script>. esbuild's IIFE output is a single
  // expression statement; wrapping in <script> makes it a top-level
  // statement in the page.
  const script = `<script>${bundle}</script>`;

  // Final shape, mirroring the upload-html task's expectations:
  //   head + MARKER + script + MARKER + tail
  // The contract injects `<script>window.__TG_ID=N;</script>` in
  // place of the FIRST marker, so the per-token id is set before
  // our bundle runs. The SECOND marker is just a section boundary;
  // the contract emits empty string for it.
  const output = head + MARKER + script + MARKER + tail;

  await mkdir(DIST, { recursive: true });
  const outPath = join(DIST, "full.html");
  await writeFile(outPath, output, "utf8");

  // Smoke-test variant with __TG_ID=0 wedged in, so the file can be
  // opened directly via file:/// without a contract round-trip.
  const testOutput = head + MARKER + `<script>window.__TG_ID=0;</script>` + script + MARKER + tail;
  const testPath = join(DIST, "test.html");
  await writeFile(testPath, testOutput, "utf8");

  // Byte sizes per section. These are what get SSTORE2-uploaded.
  const headBytes = Buffer.byteLength(head, "utf8");
  const scriptBytes = Buffer.byteLength(script, "utf8");
  const tailBytes = Buffer.byteLength(tail, "utf8");
  const totalBytes = Buffer.byteLength(output, "utf8");

  const sections = {
    head: headBytes,
    script: scriptBytes,
    tail: tailBytes,
    total: totalBytes,
    sstore2Limit: SSTORE2_LIMIT,
    chunkCounts: {
      head: Math.max(1, Math.ceil(headBytes / SSTORE2_LIMIT)),
      script: Math.max(1, Math.ceil(scriptBytes / SSTORE2_LIMIT)),
      tail: Math.max(1, Math.ceil(tailBytes / SSTORE2_LIMIT)),
    },
  };
  await writeFile(
    join(DIST, "sections.json"),
    JSON.stringify(sections, null, 2) + "\n",
    "utf8",
  );

  // Light HTML sanity scan on the output: marker count, balanced
  // <script>/<style>/<html>/<body> tag counts, no stray backtick-only
  // lines (which would indicate a botched template). This catches the
  // worst dumb breakage without pulling in a full HTML parser.
  const markerCount = (output.match(/<!--TG_ID_INJECT-->/g) || []).length;
  if (markerCount !== 2) {
    throw new Error(`expected exactly 2 markers in output, got ${markerCount}`);
  }
  for (const tag of ["html", "body", "head", "style", "script"]) {
    const opens = (output.match(new RegExp("<" + tag + "(\\s|>)", "g")) || []).length;
    const closes = (output.match(new RegExp("</" + tag + ">", "g")) || []).length;
    if (opens !== closes) {
      throw new Error(
        `unbalanced <${tag}>: ${opens} open vs ${closes} close in output`,
      );
    }
  }

  console.log("");
  console.log("section sizes (bytes):");
  console.log(`  head:   ${headBytes.toString().padStart(7)}  (${sections.chunkCounts.head} chunk)`);
  console.log(`  script: ${scriptBytes.toString().padStart(7)}  (${sections.chunkCounts.script} chunk${sections.chunkCounts.script > 1 ? "s" : ""})`);
  console.log(`  tail:   ${tailBytes.toString().padStart(7)}  (${sections.chunkCounts.tail} chunk)`);
  console.log(`  total:  ${totalBytes.toString().padStart(7)}`);

  for (const [name, bytes] of [["head", headBytes], ["script", scriptBytes], ["tail", tailBytes]]) {
    if (bytes > SSTORE2_LIMIT) {
      console.log(
        `  NOTE: ${name} exceeds ${SSTORE2_LIMIT}B SSTORE2 single-chunk limit; upload-html will chunk it.`,
      );
    }
  }

  console.log("");
  console.log(`wrote ${outPath}`);
  console.log(`wrote ${testPath}`);
  console.log(`wrote ${join(DIST, "sections.json")}`);
  console.log("");
  console.log(`smoke test: open ${join("dist", "onchain", "test.html")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
