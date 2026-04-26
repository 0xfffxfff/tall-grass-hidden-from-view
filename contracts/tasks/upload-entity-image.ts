import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getMetadataContract } from "./helpers";
import path from "path";
import fs from "fs";

// Solady SSTORE2 max payload is MAX_CONTRACT_SIZE - 1 = 24575 bytes.
// Leave a little headroom for gas/calldata variance.
const CHUNK_SIZE = 24_000;

const ASPECTS = {
  "1x1": 0,
  "2x3": 1,
  "9x16": 2,
} as const;

type AspectName = keyof typeof ASPECTS;

async function uploadOne(
  metadata: any,
  entityId: number,
  aspectName: AspectName,
  filePath: string,
) {
  const data = fs.readFileSync(filePath);
  if (data.length > CHUNK_SIZE) {
    console.warn(
      `   ${aspectName}/${entityId}: ${data.length} bytes exceeds single-chunk target (${CHUNK_SIZE}); will write ${Math.ceil(data.length / CHUNK_SIZE)} chunks`,
    );
  }
  const chunks: Buffer[] = [];
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    chunks.push(data.subarray(i, i + CHUNK_SIZE));
  }

  const aspectCode = ASPECTS[aspectName];
  for (let i = 0; i < chunks.length; i++) {
    const tx = await metadata.setEntityImagePart(entityId, aspectCode, chunks[i], i);
    await tx.wait();
    console.log(
      `   ${aspectName}/${entityId} chunk ${i}/${chunks.length - 1} (${chunks[i].length}B) - ${tx.hash}`,
    );
  }
}

task("upload-entity-image", "Upload one entity preview JPG (single aspect)")
  .addParam("id", "Entity ID")
  .addParam("aspect", "Aspect: 1x1, 2x3, or 9x16")
  .addParam("file", "Path to JPG file")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const metadata = await getMetadataContract(hre);
    const aspectName = taskArgs.aspect as AspectName;
    if (!(aspectName in ASPECTS)) {
      throw new Error(`Unknown aspect: ${aspectName} (expected 1x1, 2x3, or 9x16)`);
    }
    const filePath = path.resolve(taskArgs.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const entityId = parseInt(taskArgs.id);
    console.log(`Uploading entity ${entityId} ${aspectName} from ${filePath}...`);
    await uploadOne(metadata, entityId, aspectName, filePath);
  });

task("upload-entity-images", "Bulk-upload all entity previews from a directory tree")
  .addParam("dir", "Root dir containing {1x1,2x3,9x16}/{id}.jpg")
  .addOptionalParam("from", "First entity id (inclusive)", 0, types.int)
  .addOptionalParam("to", "Last entity id (inclusive)", 31, types.int)
  .addOptionalParam(
    "aspects",
    "Comma-separated aspect names (default: all three)",
    "1x1,2x3,9x16",
  )
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const metadata = await getMetadataContract(hre);
    const root = path.resolve(taskArgs.dir);
    const aspects = String(taskArgs.aspects).split(",").map((s) => s.trim()) as AspectName[];
    for (const a of aspects) {
      if (!(a in ASPECTS)) throw new Error(`Unknown aspect: ${a}`);
    }
    const fromId = Number(taskArgs.from);
    const toId = Number(taskArgs.to);

    console.log(
      `Bulk-uploading ids ${fromId}..${toId} for aspects [${aspects.join(", ")}] from ${root}`,
    );

    for (const aspect of aspects) {
      console.log(`\n[${aspect}]`);
      for (let id = fromId; id <= toId; id++) {
        const filePath = path.resolve(root, aspect, `${id}.jpg`);
        if (!fs.existsSync(filePath)) {
          console.warn(`   skip ${aspect}/${id}: file not found`);
          continue;
        }
        await uploadOne(metadata, id, aspect, filePath);
      }
    }
    console.log("\nDone.");
  });
