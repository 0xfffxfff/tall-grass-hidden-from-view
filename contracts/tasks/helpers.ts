import { HardhatRuntimeEnvironment } from "hardhat/types";

export async function getTokenContract(hre: HardhatRuntimeEnvironment) {
  const deployment = await hre.deployments.get("TallGrass");
  return hre.ethers.getContractAt("TallGrass", deployment.address);
}

export async function getMetadataContract(hre: HardhatRuntimeEnvironment) {
  const token = await getTokenContract(hre);
  const metadataAddress = await token.metadataContract();
  return hre.ethers.getContractAt("TallGrassMetadata", metadataAddress);
}
