import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getTokenContract } from "./helpers";

task("transfer-ownership", "Transfer ownership")
  .addParam("newOwner", "The new owner address")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const token = await getTokenContract(hre);

    if (!hre.ethers.isAddress(taskArgs.newOwner)) {
      throw new Error(`Invalid address: ${taskArgs.newOwner}`);
    }

    const currentOwner = await token.owner();
    console.log(`Current owner: ${currentOwner}`);

    if (currentOwner.toLowerCase() === taskArgs.newOwner.toLowerCase()) {
      console.log("Already owned by target address");
      return;
    }

    const tx = await token.transferOwnership(taskArgs.newOwner);
    console.log(`   Transaction: ${tx.hash}`);
    await tx.wait();
    console.log(`   Ownership transferred to: ${taskArgs.newOwner}`);
  });
