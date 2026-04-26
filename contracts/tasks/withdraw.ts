import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getTokenContract } from "./helpers";

task("withdraw", "Withdraw accumulated ETH (oracle-only)")
  .setAction(async (_taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const token = await getTokenContract(hre);

    const balance = await hre.ethers.provider.getBalance(await token.getAddress());
    console.log(`Contract balance: ${hre.ethers.formatEther(balance)} ETH`);

    if (balance === 0n) {
      console.log("Nothing to withdraw");
      return;
    }

    const tx = await token.withdraw();
    console.log(`   Transaction: ${tx.hash}`);
    await tx.wait();
    console.log(`   Withdrawn ${hre.ethers.formatEther(balance)} ETH`);
  });
