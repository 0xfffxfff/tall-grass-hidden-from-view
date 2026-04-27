import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getTokenContract } from "./helpers";

task("transfer", "Transfer an entity to another address (ERC-721 safeTransferFrom)")
  .addParam("id", "Entity ID to transfer", undefined, types.int)
  .addParam("to", "Recipient address")
  .addOptionalParam("from", "Sender address (default: signer)")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const id = Number(taskArgs.id);
    const [signer] = await hre.ethers.getSigners();
    const from = taskArgs.from || signer.address;
    const to = taskArgs.to;

    const token = await getTokenContract(hre);
    const owner = await token.ownerOf(id);
    if (owner.toLowerCase() !== from.toLowerCase()) {
      throw new Error(
        `Token #${id} is owned by ${owner}, not ${from}. Pass --from <owner> or run as the owner key.`,
      );
    }

    console.log(`Transferring #${id}\n  from: ${from}\n  to:   ${to}`);
    const tx = await token["safeTransferFrom(address,address,uint256)"](from, to, id);
    console.log(`  tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  mined in block ${receipt?.blockNumber}`);

    const newOwner = await token.ownerOf(id);
    console.log(`  ownerOf(${id}) = ${newOwner}`);
  });
