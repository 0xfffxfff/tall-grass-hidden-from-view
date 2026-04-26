import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getMetadataContract } from "./helpers";
import path from 'path';
import fs from 'fs';

const CHUNK_SIZE = 24_000; // ~24KB per SSTORE2 write

task("upload-ciphertext", "Upload entity ciphertext via SSTORE2 chunks")
  .addParam("id", "Entity ID")
  .addParam("file", "Path to ciphertext binary file")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const metadata = await getMetadataContract(hre);
    const entityId = parseInt(taskArgs.id);
    const filePath = path.resolve(taskArgs.file);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const data = fs.readFileSync(filePath);
    const chunks: Buffer[] = [];
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      chunks.push(data.subarray(i, i + CHUNK_SIZE));
    }

    console.log(`Uploading ciphertext for entity ${entityId} (${(data.length / 1024).toFixed(1)}KB, ${chunks.length} chunk(s))...`);

    for (let i = 0; i < chunks.length; i++) {
      const tx = await metadata.setCiphertextPart(entityId, chunks[i], i);
      console.log(`   Chunk ${i}/${chunks.length - 1} - Transaction: ${tx.hash}`);
      await tx.wait();
    }

    const hash = await metadata.ciphertextHash(entityId);
    console.log(`   Ciphertext uploaded. Hash: ${hash}`);
  });
