import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getMetadataContract } from "./helpers";
import path from 'path';
import fs from 'fs';

const CHUNK_SIZE = 24_000; // ~24KB per SSTORE2 write

task("set-image", "Set collection image via SSTORE2 chunks")
  .addParam("file", "Path to image file")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const metadata = await getMetadataContract(hre);
    const imagePath = path.resolve(taskArgs.file);

    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image not found: ${imagePath}`);
    }

    const ext = path.extname(imagePath).slice(1);
    const mimeType = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : `image/${ext}`;
    const data = fs.readFileSync(imagePath);
    const base64 = data.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const chunks: string[] = [];
    for (let i = 0; i < dataUrl.length; i += CHUNK_SIZE) {
      chunks.push(dataUrl.slice(i, i + CHUNK_SIZE));
    }

    console.log(`Setting collection image (${(dataUrl.length / 1024).toFixed(1)}KB, ${chunks.length} chunk(s))...`);

    for (let i = 0; i < chunks.length; i++) {
      const tx = await metadata.setCollectionImagePart(chunks[i], i);
      console.log(`   Chunk ${i}/${chunks.length - 1} - Transaction: ${tx.hash}`);
      await tx.wait();
    }
    console.log(`   Collection image set`);
  });
