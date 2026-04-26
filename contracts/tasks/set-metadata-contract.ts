import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getTokenContract } from "./helpers";

task("set-metadata-contract", "Set or update the metadata contract")
  .addParam("address", "Address of the new metadata contract")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const token = await getTokenContract(hre);

    if (!hre.ethers.isAddress(taskArgs.address)) {
      throw new Error(`Invalid address: ${taskArgs.address}`);
    }

    const current = await token.metadataContract();
    console.log(`Current metadata contract: ${current}`);
    console.log(`Setting to ${taskArgs.address}...`);

    const tx = await token.setMetadataContract(taskArgs.address);
    console.log(`   Transaction: ${tx.hash}`);
    await tx.wait();
    console.log(`   Metadata contract updated`);
  });
