import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getTokenContract } from "./helpers";
import fs from "fs";
import path from "path";

interface Attribute {
  trait_type?: string;
  value?: unknown;
}
interface DecodedMetadata {
  tokenId: number;
  name: string;
  description?: string;
  image?: string;
  animation_url?: string;
  attributes?: Attribute[];
  [key: string]: unknown;
}

function parseDataUri(dataUri: string): { mime: string; ext: string; bytes: Buffer } | null {
  const m = dataUri.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  const mime = m[1];
  const ext =
    mime === "image/svg+xml" ? "svg"
    : mime === "image/jpeg" ? "jpg"
    : mime === "image/png" ? "png"
    : mime === "text/html" ? "html"
    : (mime.split("/")[1] || "bin");
  return { mime, ext, bytes: Buffer.from(m[2], "base64") };
}

function buildViewerHtml(metadata: DecodedMetadata): string {
  const attrs = Array.isArray(metadata.attributes) ? metadata.attributes : [];
  const rawJson = JSON.stringify(metadata, null, 2);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Entity #${metadata.tokenId}</title>
<style>
  :root { color-scheme: dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Mono", ui-monospace, monospace;
    margin: 0; padding: 24px;
    background: #0a0a0a; color: #e8e8e8;
  }
  .container { max-width: 1280px; margin: 0 auto; }
  h1 { font-weight: 400; font-size: 18px; margin: 0 0 24px; letter-spacing: 0.04em; }
  .grid {
    display: grid; gap: 24px;
    grid-template-columns: 1fr 1fr;
    margin-bottom: 24px;
  }
  .pane {
    background: #111; border: 1px solid #2a2a2a; padding: 16px;
  }
  .pane h2 {
    margin: 0 0 12px; font-size: 11px; color: #9a9a9a;
    text-transform: uppercase; letter-spacing: 0.08em; font-weight: 400;
  }
  .frame {
    width: 100%; aspect-ratio: 1; background: #000;
    display: grid; place-items: center; overflow: hidden;
  }
  .frame img, .frame iframe { width: 100%; height: 100%; object-fit: contain; border: 0; }
  .meta { background: #111; border: 1px solid #2a2a2a; padding: 16px; }
  .meta h2 {
    margin: 0 0 12px; font-size: 11px; color: #9a9a9a;
    text-transform: uppercase; letter-spacing: 0.08em; font-weight: 400;
  }
  .row { display: grid; grid-template-columns: 12em 1fr; gap: 12px; padding: 4px 0; font-size: 13px; }
  .row .k { color: #6a6a6a; }
  .row .v { color: #e8e8e8; word-break: break-word; }
  .attrs { margin-top: 16px; }
  .attr {
    display: grid; grid-template-columns: 12em 1fr; gap: 12px;
    padding: 4px 0; font-size: 13px;
  }
  pre {
    background: #000; border: 1px solid #2a2a2a;
    padding: 16px; font-size: 11px; line-height: 1.5;
    overflow-x: auto; color: #9a9a9a;
  }
  .missing { color: #6a6a6a; font-style: italic; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
  <div class="container">
    <h1>${metadata.name || `Entity #${metadata.tokenId}`}</h1>

    <div class="grid">
      <div class="pane">
        <h2>image (1x1 preview)</h2>
        <div class="frame">
          ${metadata.image ? `<img src="${metadata.image}" alt="entity #${metadata.tokenId}">` : '<span class="missing">no image</span>'}
        </div>
      </div>
      <div class="pane">
        <h2>animation_url (interactive viewer)</h2>
        <div class="frame">
          ${metadata.animation_url ? `<iframe src="${metadata.animation_url}" sandbox="allow-scripts allow-same-origin"></iframe>` : '<span class="missing">no animation</span>'}
        </div>
      </div>
    </div>

    <div class="meta">
      <h2>metadata</h2>
      <div class="row"><span class="k">tokenId</span><span class="v">${metadata.tokenId}</span></div>
      <div class="row"><span class="k">name</span><span class="v">${metadata.name ?? ""}</span></div>
      <div class="row"><span class="k">description</span><span class="v">${metadata.description || '<span class="missing">(empty)</span>'}</span></div>
      ${
        attrs.length === 0
          ? '<div class="row"><span class="k">attributes</span><span class="v missing">(none)</span></div>'
          : `<div class="attrs"><div class="row"><span class="k">attributes</span><span class="v">${attrs.length}</span></div>${attrs
              .map(
                (a) =>
                  `<div class="attr"><span class="k">${a.trait_type ?? "(no trait_type)"}</span><span class="v">${String(a.value ?? "")}</span></div>`,
              )
              .join("")}</div>`
      }
    </div>

    <div class="meta" style="margin-top: 24px;">
      <h2>raw json</h2>
      <pre>${rawJson.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</pre>
    </div>
  </div>
</body>
</html>`;
}

task("view-token", "Fetch tokenURI, decode it, extract image + HTML, write a viewer page")
  .addParam("id", "Token ID")
  .addOptionalParam("output", "Output directory", "render")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const token = await getTokenContract(hre);
    const tokenId = parseInt(taskArgs.id);

    console.log(`Fetching token #${tokenId}...`);
    const tokenURI = await token.tokenURI(tokenId, { gasLimit: 1_000_000_000 });

    if (!tokenURI.startsWith("data:application/json;base64,")) {
      throw new Error(`Invalid tokenURI format: ${tokenURI.slice(0, 60)}...`);
    }

    const base64Data = tokenURI.replace("data:application/json;base64,", "");
    const metadataJson = Buffer.from(base64Data, "base64").toString("utf-8");
    const metadata: DecodedMetadata = JSON.parse(metadataJson);

    console.log(`\n  Name:        ${metadata.name}`);
    console.log(`  Token ID:    ${metadata.tokenId}`);
    console.log(`  Description: ${metadata.description || "(empty)"}`);
    if (Array.isArray(metadata.attributes)) {
      console.log(`  Attributes:`);
      for (const attr of metadata.attributes) {
        console.log(`    - ${attr.trait_type ?? "value"}: ${attr.value}`);
      }
    }

    const outputDir = path.join(process.cwd(), taskArgs.output);
    fs.mkdirSync(outputDir, { recursive: true });

    // Always write the raw JSON
    const metadataPath = path.join(outputDir, `entity-${tokenId}-metadata.json`);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`\n  metadata.json -> ${path.relative(process.cwd(), metadataPath)}`);

    // Extract image
    if (metadata.image) {
      const decoded = parseDataUri(metadata.image);
      if (!decoded) {
        console.log(`  image -> not a base64 data URI: ${metadata.image.slice(0, 60)}...`);
      } else {
        const imagePath = path.join(outputDir, `entity-${tokenId}.${decoded.ext}`);
        fs.writeFileSync(imagePath, decoded.bytes);
        console.log(`  image    -> ${path.relative(process.cwd(), imagePath)} (${(decoded.bytes.length / 1024).toFixed(1)}KB ${decoded.mime})`);
      }
    }

    // Extract animation
    if (metadata.animation_url) {
      const decoded = parseDataUri(metadata.animation_url);
      if (!decoded) {
        console.log(`  animation -> external URL: ${metadata.animation_url}`);
      } else {
        const animPath = path.join(outputDir, `entity-${tokenId}-animation.${decoded.ext}`);
        fs.writeFileSync(animPath, decoded.bytes);
        console.log(`  animation -> ${path.relative(process.cwd(), animPath)} (${(decoded.bytes.length / 1024).toFixed(1)}KB ${decoded.mime})`);
      }
    }

    // Write the viewer HTML page
    const viewerPath = path.join(outputDir, `entity-${tokenId}-viewer.html`);
    fs.writeFileSync(viewerPath, buildViewerHtml(metadata));
    console.log(`  viewer    -> ${path.relative(process.cwd(), viewerPath)}`);

    console.log(`\nopen the viewer:`);
    console.log(`  open ${path.relative(process.cwd(), viewerPath)}`);
  });
