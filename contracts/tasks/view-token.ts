import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getTokenContract, getMetadataContract } from "./helpers";
import fs from 'fs';
import path from 'path';

task("view-token", "View token metadata")
  .addParam("id", "Token ID")
  .addOptionalParam("output", "Output directory", "render")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const token = await getTokenContract(hre);
    const tokenId = parseInt(taskArgs.id);

    console.log(`Fetching token #${tokenId}...`);

    const tokenURI = await token.tokenURI(tokenId, { gasLimit: 1_000_000_000 });

    if (!tokenURI.startsWith("data:application/json;base64,")) {
      throw new Error("Invalid tokenURI format");
    }

    const base64Data = tokenURI.replace("data:application/json;base64,", "");
    const metadataJson = Buffer.from(base64Data, "base64").toString("utf-8");
    const metadata = JSON.parse(metadataJson);

    console.log(`\n  Name: ${metadata.name}`);
    console.log(`  Token ID: ${metadata.tokenId}`);
    console.log(`  Description: ${metadata.description || "(empty)"}`);

    if (metadata.attributes && Array.isArray(metadata.attributes)) {
      console.log(`  Attributes:`);
      metadata.attributes.forEach((attr: any) => {
        console.log(`    - ${attr.trait_type || "value"}: ${attr.value}`);
      });
    }

    console.log(`  Animation URL: ${metadata.animation_url || "(empty)"}`);

    const outputDir = path.join(process.cwd(), taskArgs.output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const metadataPath = path.join(outputDir, `entity-${tokenId}-metadata.json`);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`\n  Metadata saved to: ${path.relative(process.cwd(), metadataPath)}`);
  });
