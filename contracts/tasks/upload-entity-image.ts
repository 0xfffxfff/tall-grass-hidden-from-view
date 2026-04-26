import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getMetadataContract } from "./helpers";
import path from "path";
import fs from "fs";

// Solady SSTORE2 max payload is MAX_CONTRACT_SIZE - 1 = 24575 bytes.
// Leave a little headroom for gas/calldata variance.
const CHUNK_SIZE = 24_000;

async function uploadOne(metadata: any, entityId: number, filePath: string) {
  const data = fs.readFileSync(filePath);
  if (data.length > CHUNK_SIZE) {
    console.warn(
      `   ${entityId}: ${data.length} bytes exceeds single-chunk target (${CHUNK_SIZE}); will write ${Math.ceil(data.length / CHUNK_SIZE)} chunks`,
    );
  }
  const chunks: Buffer[] = [];
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    chunks.push(data.subarray(i, i + CHUNK_SIZE));
  }

  for (let i = 0; i < chunks.length; i++) {
    const tx = await metadata.setEntityImagePart(entityId, chunks[i], i);
    await tx.wait();
    console.log(
      `   ${entityId} chunk ${i}/${chunks.length - 1} (${chunks[i].length}B) - ${tx.hash}`,
    );
  }
}

task("upload-entity-image", "Upload one entity preview JPG (1:1)")
  .addParam("id", "Entity ID")
  .addParam("file", "Path to JPG file")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const metadata = await getMetadataContract(hre);
    const filePath = path.resolve(taskArgs.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const entityId = parseInt(taskArgs.id);
    console.log(`Uploading entity ${entityId} from ${filePath}...`);
    await uploadOne(metadata, entityId, filePath);
  });

task("upload-entity-images", "Bulk-upload all entity previews from a directory of {id}.jpg")
  .addParam("dir", "Directory containing {id}.jpg files")
  .addOptionalParam("from", "First entity id (inclusive)", 0, types.int)
  .addOptionalParam("to", "Last entity id (inclusive)", 31, types.int)
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const metadata = await getMetadataContract(hre);
    const root = path.resolve(taskArgs.dir);
    const fromId = Number(taskArgs.from);
    const toId = Number(taskArgs.to);

    console.log(`Bulk-uploading ids ${fromId}..${toId} from ${root}`);
    for (let id = fromId; id <= toId; id++) {
      const filePath = path.resolve(root, `${id}.jpg`);
      if (!fs.existsSync(filePath)) {
        console.warn(`   skip ${id}: file not found`);
        continue;
      }
      await uploadOne(metadata, id, filePath);
    }
    console.log("\nDone.");
  });
