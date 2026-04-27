import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getMetadataContract } from "./helpers";
import path from "path";
import fs from "fs";

// One-shot orchestrator for a freshly deployed TallGrass + TallGrassMetadata.
// Runs the upload-html / upload-entity-images / upload-ciphertext tasks in
// sequence, skipping anything already on chain so it's safe to re-run.
//
// Typical usage against a local node:
//   Terminal 1: npx hardhat node
//   Terminal 2: cd contracts
//               npm --prefix ../app run build:onchain
//               npx hardhat deploy --tags TallGrass --network localhost
//               npx hardhat setup-assets --network localhost
//               npx hardhat artist-mint --id 0 --network localhost
//               npx hardhat view-token --id 0 --network localhost

const DEFAULT_HTML = "../app/dist/onchain/full.html";
const DEFAULT_PREVIEWS = "../previews/onchain/1x1";
const DEFAULT_DATA = "../app/data";

task("setup-assets", "Upload HTML viewer + per-entity previews + ciphertexts to TallGrassMetadata")
  .addOptionalParam("html", "Path to built full.html", DEFAULT_HTML)
  .addOptionalParam("previews", "Directory containing {id}.jpg files", DEFAULT_PREVIEWS)
  .addOptionalParam("data", "App data dir with entities/<id>.bin and manifest.json", DEFAULT_DATA)
  .addOptionalParam("from", "First entity id (inclusive)", 0, types.int)
  .addOptionalParam("to", "Last entity id (inclusive)", 31, types.int)
  .addFlag("skipHtml", "Skip the HTML viewer upload")
  .addFlag("skipImages", "Skip the per-entity image uploads")
  .addFlag("skipCiphertexts", "Skip the per-entity ciphertext uploads")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const metadata = await getMetadataContract(hre);
    const fromId = Number(taskArgs.from);
    const toId = Number(taskArgs.to);

    if (!taskArgs.skipHtml) {
      const htmlPath = path.resolve(taskArgs.html);
      if (!fs.existsSync(htmlPath)) {
        console.warn(
          `\n[html] ${htmlPath} not found — run \`npm --prefix ../app run build:onchain\` first, or pass --skip-html`,
        );
      } else {
        const [headCount, scriptCount, tailCount] = await Promise.all([
          metadata.htmlHeadPartsCount(),
          metadata.htmlScriptPartsCount(),
          metadata.htmlTailPartsCount(),
        ]);
        if (Number(headCount) > 0 && Number(scriptCount) > 0) {
          console.log(
            `\n[html] already on chain (head=${headCount}, script=${scriptCount}, tail=${tailCount}) — skipping`,
          );
        } else {
          console.log(`\n[html] uploading ${htmlPath}`);
          await hre.run("upload-html", { file: htmlPath });
        }
      }
    }

    if (!taskArgs.skipImages) {
      const previewsRoot = path.resolve(taskArgs.previews);
      if (!fs.existsSync(previewsRoot)) {
        console.warn(`\n[images] ${previewsRoot} not found — skipping`);
      } else {
        console.log(`\n[images] uploading ids ${fromId}..${toId} from ${previewsRoot}`);
        for (let id = fromId; id <= toId; id++) {
          const filePath = path.join(previewsRoot, `${id}.jpg`);
          if (!fs.existsSync(filePath)) {
            console.warn(`   skip ${id}: ${filePath} not found`);
            continue;
          }
          const partsCount = await metadata.entityImagePartsCount(id);
          if (Number(partsCount) > 0) {
            console.log(`   skip ${id}: already on chain (${partsCount} chunk(s))`);
            continue;
          }
          await hre.run("upload-entity-image", { id: String(id), file: filePath });
        }
      }
    }

    if (!taskArgs.skipCiphertexts) {
      const dataDir = path.resolve(taskArgs.data);
      const entitiesDir = path.join(dataDir, "entities");
      if (!fs.existsSync(entitiesDir)) {
        console.warn(`\n[ciphertexts] ${entitiesDir} not found — skipping`);
      } else {
        console.log(`\n[ciphertexts] uploading ids ${fromId}..${toId} from ${entitiesDir}`);
        for (let id = fromId; id <= toId; id++) {
          const filePath = path.join(entitiesDir, `${id}.bin`);
          if (!fs.existsSync(filePath)) {
            console.warn(`   skip ${id}: ${filePath} not found`);
            continue;
          }
          const onChainHash = await metadata.ciphertextHash(id);
          if (onChainHash !== "0x" + "00".repeat(32)) {
            console.log(`   skip ${id}: already on chain (hash ${String(onChainHash).slice(0, 12)}...)`);
            continue;
          }
          await hre.run("upload-ciphertext", { id: String(id), file: filePath });
        }
      }
    }

    console.log("\nDone. Next:");
    console.log("  npx hardhat artist-mint --id 0 --network <network>");
    console.log("  npx hardhat view-token  --id 0 --network <network>");
  });
