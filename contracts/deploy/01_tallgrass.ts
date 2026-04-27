import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, execute, read } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log(`Deploying TallGrass suite with deployer: ${deployer}`);

  // Deploy shared Honk verification libraries (from HonkBase.sol).
  // These are linked via DELEGATECALL to keep verifier contracts under 24KB.
  const relationsLib = await deploy("RelationsLib", {
    contract: "src/HonkBase.sol:RelationsLib",
    from: deployer,
    log: true,
  });

  const transcriptLib = await deploy("TranscriptLib", {
    contract: "src/HonkBase.sol:TranscriptLib",
    from: deployer,
    log: true,
  });

  const commitmentSchemeLib = await deploy("CommitmentSchemeLib", {
    contract: "src/HonkBase.sol:CommitmentSchemeLib",
    from: deployer,
    log: true,
  });

  const honkLibs = {
    RelationsLib: relationsLib.address,
    TranscriptLib: transcriptLib.address,
    CommitmentSchemeLib: commitmentSchemeLib.address,
  };

  // Deploy verifiers linked to the shared libraries
  const movementVerifier = await deploy("MovementVerifier", {
    from: deployer,
    libraries: honkLibs,
    log: true,
  });

  const entityMovementVerifier = await deploy("EntityMovementVerifier", {
    from: deployer,
    libraries: honkLibs,
    log: true,
  });

  const encounterVerifier = await deploy("EncounterVerifier", {
    from: deployer,
    libraries: honkLibs,
    log: true,
  });

  // Deploy TallGrass token
  const tallGrass = await deploy("TallGrass", {
    from: deployer,
    args: [
      process.env.SEED_COMMITMENT || "0x0000000000000000000000000000000000000000000000000000000000000000",
      process.env.TERRAIN_MERKLE_ROOT || "0x0000000000000000000000000000000000000000000000000000000000000000",
      process.env.ENTITY_TRAIT_MERKLE_ROOT || "0x0000000000000000000000000000000000000000000000000000000000000000",
      process.env.ENTITY_MERKLE_ROOT || "0x0000000000000000000000000000000000000000000000000000000000000000",
      process.env.GRID_WIDTH || "32",
      process.env.GRID_HEIGHT || "32",
      process.env.TOTAL_SUPPLY || "32",
      process.env.MINT_PRICE || "200000000000000000",
      movementVerifier.address,
      entityMovementVerifier.address,
      encounterVerifier.address,
      process.env.DECRYPTION_KEY_COMMITMENT || "0x0000000000000000000000000000000000000000000000000000000000000000",
      process.env.TRAIT_MODULI_COMMITMENT || "0x0000000000000000000000000000000000000000000000000000000000000000",
      deployer,
    ],
    log: true,
  });

  // Grant ORACLE role to deployer (or specified address)
  const oracleAddress = process.env.ORACLE_ADDRESS || deployer;
  const ORACLE_ROLE = 2; // 1 << 1
  console.log(`Granting ORACLE role to ${oracleAddress}...`);
  await execute("TallGrass", { from: deployer, log: true }, "grantRoles", oracleAddress, ORACLE_ROLE);

  // Deploy TallGrassMetadata
  const metadata = await deploy("TallGrassMetadata", {
    from: deployer,
    args: [tallGrass.address],
    log: true,
  });

  // Link metadata contract if not already set
  const currentMetadata = await read("TallGrass", "metadataContract");
  if (currentMetadata !== metadata.address) {
    console.log(`Setting metadata contract to ${metadata.address}...`);
    await execute("TallGrass", { from: deployer, log: true }, "setMetadataContract", metadata.address);
  } else {
    console.log(`Metadata contract already set to ${metadata.address}`);
  }
};

export default func;
func.tags = ["TallGrass"];
func.dependencies = ["Fund"];
