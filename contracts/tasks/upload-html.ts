import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getMetadataContract } from "./helpers";
import path from "path";
import fs from "fs";
import { keccak256, toUtf8Bytes } from "ethers";

const CHUNK_SIZE = 24_000;

// The build pipeline emits full.html with this exact marker where the
// per-token id-injection script will be wedged in by the contract:
//   ...head...{ID_MARKER}...script...tail...
// Splitting on the marker gives us head/script/tail to upload separately.
const ID_MARKER = "<!--TG_ID_INJECT-->";

function splitSections(html: string): { head: string; script: string; tail: string } {
  const firstIdx = html.indexOf(ID_MARKER);
  if (firstIdx === -1) {
    throw new Error(
      `ID marker ${ID_MARKER} not found in HTML. The build pipeline must emit it where the per-token <script>window.__TG_ID=N;</script> should be injected.`,
    );
  }
  // Allow either one marker (head ends here, script begins immediately) or
  // two markers (head|script|tail). Prefer the two-marker form so the
  // script section can be re-uploaded independently of the closing tail.
  const secondIdx = html.indexOf(ID_MARKER, firstIdx + ID_MARKER.length);
  if (secondIdx === -1) {
    return { head: html.slice(0, firstIdx), script: html.slice(firstIdx + ID_MARKER.length), tail: "" };
  }
  return {
    head: html.slice(0, firstIdx),
    script: html.slice(firstIdx + ID_MARKER.length, secondIdx),
    tail: html.slice(secondIdx + ID_MARKER.length),
  };
}

function chunkBuffer(buf: Buffer): Buffer[] {
  const chunks: Buffer[] = [];
  for (let i = 0; i < buf.length; i += CHUNK_SIZE) {
    chunks.push(buf.subarray(i, i + CHUNK_SIZE));
  }
  return chunks;
}

async function uploadSection(
  label: string,
  data: string,
  setter: (chunk: Buffer, idx: number) => Promise<any>,
  currentCount: number,
) {
  if (data.length === 0) {
    console.log(`[${label}] empty, skipping`);
    return;
  }
  const buf = Buffer.from(data, "utf8");
  const localHash = keccak256(toUtf8Bytes(data)).slice(0, 12);
  const chunks = chunkBuffer(buf);
  console.log(
    `[${label}] ${buf.length}B in ${chunks.length} chunk(s) (hash ${localHash}); current onchain parts: ${currentCount}`,
  );
  for (let i = 0; i < chunks.length; i++) {
    const tx = await setter(chunks[i], i);
    await tx.wait();
    console.log(`   chunk ${i}/${chunks.length - 1} (${chunks[i].length}B) - ${tx.hash}`);
  }
}

task("upload-html", "Upload the inlined viewer HTML (head/script/tail) to TallGrassMetadata")
  .addParam("file", "Path to the built full.html (with TG_ID_INJECT markers)")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const metadata = await getMetadataContract(hre);
    const filePath = path.resolve(taskArgs.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const html = fs.readFileSync(filePath, "utf8");
    const { head, script, tail } = splitSections(html);

    console.log(`Source: ${filePath} (${(html.length / 1024).toFixed(1)}KB total)`);
    console.log(`  head: ${head.length}B`);
    console.log(`  script: ${script.length}B`);
    console.log(`  tail: ${tail.length}B`);

    const [headCount, scriptCount, tailCount] = await Promise.all([
      metadata.htmlHeadPartsCount(),
      metadata.htmlScriptPartsCount(),
      metadata.htmlTailPartsCount(),
    ]);

    await uploadSection(
      "head",
      head,
      (chunk, idx) => metadata.setHtmlHeadPart(chunk, idx),
      Number(headCount),
    );
    await uploadSection(
      "script",
      script,
      (chunk, idx) => metadata.setHtmlScriptPart(chunk, idx),
      Number(scriptCount),
    );
    await uploadSection(
      "tail",
      tail,
      (chunk, idx) => metadata.setHtmlTailPart(chunk, idx),
      Number(tailCount),
    );

    console.log("\nDone.");
  });
