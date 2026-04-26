import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getTokenContract } from "./helpers";

const ROLES: Record<string, number> = {
  EDITOR: 1,
};

task("grant-role", "Grant a role to an address")
  .addParam("role", "Role name (EDITOR)")
  .addParam("address", "Address to grant the role to")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const token = await getTokenContract(hre);
    const roleBit = ROLES[taskArgs.role.toUpperCase()];
    if (!roleBit) {
      throw new Error(`Unknown role: ${taskArgs.role}. Valid: ${Object.keys(ROLES).join(", ")}`);
    }

    console.log(`Granting ${taskArgs.role} to ${taskArgs.address}...`);
    const tx = await token.grantRoles(taskArgs.address, roleBit);
    console.log(`   Transaction: ${tx.hash}`);
    await tx.wait();
    console.log(`   Role granted`);
  });

task("revoke-role", "Revoke a role from an address")
  .addParam("role", "Role name (EDITOR)")
  .addParam("address", "Address to revoke the role from")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const token = await getTokenContract(hre);
    const roleBit = ROLES[taskArgs.role.toUpperCase()];
    if (!roleBit) {
      throw new Error(`Unknown role: ${taskArgs.role}. Valid: ${Object.keys(ROLES).join(", ")}`);
    }

    console.log(`Revoking ${taskArgs.role} from ${taskArgs.address}...`);
    const tx = await token.revokeRoles(taskArgs.address, roleBit);
    console.log(`   Transaction: ${tx.hash}`);
    await tx.wait();
    console.log(`   Role revoked`);
  });
