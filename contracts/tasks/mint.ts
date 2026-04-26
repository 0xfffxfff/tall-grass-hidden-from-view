import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getTokenContract } from "./helpers";
import path from "path";
import fs from "fs";

const ZERO32 = "0x" + "00".repeat(32);

interface MerkleEntry {
  id: number;
  ciphertextHash: string;
  proof: string[];
}
interface MerkleTree {
  root: string;
  entities: MerkleEntry[];
}

function loadMerkle(file: string): MerkleTree {
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Merkle tree not found at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

task("artist-mint", "Owner-only mint of an entity (artist proof)")
  .addParam("id", "Entity ID to mint", undefined, types.int)
  .addOptionalParam("to", "Recipient address (default: deployer)")
  .addOptionalParam(
    "merkle",
    "Path to merkle.json with traitHash + proof per entity",
    "../app/data/merkle.json",
  )
  .addOptionalParam(
    "pos",
    "initialPositionCommitment (bytes32, default 0x00…)",
    ZERO32,
  )
  .addOptionalParam(
    "seed",
    "blindingSeedCommitment (bytes32, default 0x00…)",
    ZERO32,
  )
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const id = Number(taskArgs.id);
    const merkle = loadMerkle(taskArgs.merkle);
    const entry = merkle.entities.find((e) => e.id === id);
    if (!entry) {
      throw new Error(`No entry for id ${id} in ${taskArgs.merkle}`);
    }

    const [signer] = await hre.ethers.getSigners();
    const to = taskArgs.to || signer.address;

    const token = await getTokenContract(hre);
    console.log(
      `Artist-minting #${id} -> ${to}\n  traitHash: ${entry.ciphertextHash}\n  proof:     ${entry.proof.length} sibling(s)`,
    );

    const tx = await token.artistMint(
      id,
      to,
      entry.ciphertextHash,
      taskArgs.pos,
      taskArgs.seed,
      entry.proof,
    );
    console.log(`  tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  mined in block ${receipt?.blockNumber}`);

    const owner = await token.ownerOf(id);
    console.log(`  ownerOf(${id}) = ${owner}`);
  });
