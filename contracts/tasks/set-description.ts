import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getMetadataContract } from "./helpers";
import path from 'path';
import fs from 'fs';

task("set-description", "Set shared description")
  .addParam("file", "Path to description file")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const metadata = await getMetadataContract(hre);
    const filePath = path.resolve(taskArgs.file);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const description = fs.readFileSync(filePath, 'utf-8').replace(/\n/g, "  \\n");

    console.log(`Setting shared description (${description.length} chars)...`);
    const tx = await metadata.setSharedDescription(description);
    console.log(`   Transaction: ${tx.hash}`);
    await tx.wait();
    console.log(`   Description updated`);
  });

task("set-token-description", "Set description for a specific token")
  .addParam("id", "Token ID")
  .addParam("file", "Path to description file")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const metadata = await getMetadataContract(hre);
    const tokenId = parseInt(taskArgs.id);
    const filePath = path.resolve(taskArgs.file);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const description = fs.readFileSync(filePath, 'utf-8').replace(/\n/g, "  \\n");

    console.log(`Setting description for token ${tokenId} (${description.length} chars)...`);
    const tx = await metadata.setTokenDescription(tokenId, description);
    console.log(`   Transaction: ${tx.hash}`);
    await tx.wait();
    console.log(`   Description set for token ${tokenId}`);
  });
