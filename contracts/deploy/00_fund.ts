import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, getUnnamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();
  const accounts = await getUnnamedAccounts();

  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log(`Network is ${hre.network.name}, skipping funding step.`);
    return;
  }
  console.log(`Funding deployer account (${deployer}) on network ${hre.network.name} if needed...`);
  if (!accounts.includes(deployer)) {
    console.log(`Deployer address (${deployer}) not found in unlocked accounts.`);

    const balance = await hre.ethers.provider.getBalance(deployer);
    if (balance > (hre.ethers.parseEther("10"))) {
      console.log(`Deployer already has sufficient balance: ${hre.ethers.formatEther(balance)} ETH`);
      return;
    }
    console.log(`Deployer balance is: ${hre.ethers.formatEther(balance)} ETH. Funding account with 10 ETH...`);

    const tx = await (await hre.ethers.provider.getSigner(accounts[0])).sendTransaction({
      to: deployer,
      value: hre.ethers.parseEther("10"),
    });
    console.log(`   Transaction: ${tx.hash}`);
    await tx.wait();
    console.log("   Done");
  }
};

export default func;
func.tags = ["Fund"];
