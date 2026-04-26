import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getTokenContract } from "./helpers";

task("check-owner", "Check current owner and oracle")
  .setAction(async (_taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const token = await getTokenContract(hre);
    const deployment = await hre.deployments.get("TallGrass");
    const owner = await token.owner();
    const oracle = await token.oracle();
    const metadataAddr = await token.metadataContract();

    console.log(`TallGrass (${deployment.address})`);
    console.log(`  Owner: ${owner}`);
    console.log(`  Oracle: ${oracle}`);
    console.log(`  Metadata: ${metadataAddr}`);
  });
