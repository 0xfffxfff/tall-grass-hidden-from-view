import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getMetadataContract } from "./helpers";

task("set-animation-url", "Set animation URL for a token")
  .addParam("id", "Token ID")
  .addParam("url", "Animation URL")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const metadata = await getMetadataContract(hre);
    const tokenId = parseInt(taskArgs.id);

    console.log(`Setting animation URL for token ${tokenId}...`);
    const tx = await metadata.setAnimationUrl(tokenId, taskArgs.url);
    console.log(`   Transaction: ${tx.hash}`);
    await tx.wait();
    console.log(`   Animation URL set`);
  });
