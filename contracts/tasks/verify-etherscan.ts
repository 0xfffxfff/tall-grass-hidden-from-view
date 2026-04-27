import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { AbiCoder } from "ethers";
import path from "path";
import fs from "fs";

// Etherscan v2 unified endpoint. Single API key works across all chains;
// chainid is passed as a query param. v1 (api-<chain>.etherscan.io/api)
// is deprecated — hardhat-etherscan still uses v1 and is on its way out.
const V2_URL = "https://api.etherscan.io/v2/api";

// SPDX licenseType IDs from https://etherscan.io/contract-license-types.
const LICENSE_GPL3 = 5;
const LICENSE_APACHE2 = 12;

// chainId -> Etherscan host. Add more as we deploy to other chains.
const ETHERSCAN_HOST: Record<number, string> = {
  1: "etherscan.io",
  11155111: "sepolia.etherscan.io",
};

// Per-contract license. Aztec verifiers and Honk libraries are Apache-2.0;
// our own contracts are GPL-3.0.
const LICENSE_BY_CONTRACT: Record<string, number> = {
  TallGrass: LICENSE_GPL3,
  TallGrassMetadata: LICENSE_GPL3,
  MovementVerifier: LICENSE_APACHE2,
  EntityMovementVerifier: LICENSE_APACHE2,
  EncounterVerifier: LICENSE_APACHE2,
  RelationsLib: LICENSE_APACHE2,
  TranscriptLib: LICENSE_APACHE2,
  CommitmentSchemeLib: LICENSE_APACHE2,
};

interface DeploymentArtifact {
  address: string;
  abi: Array<{ type: string; inputs?: Array<{ type: string }> }>;
  args: unknown[];
  solcInputHash: string;
  metadata: string;
  libraries?: Record<string, string>;
}

interface SolcInput {
  language: string;
  sources: Record<string, unknown>;
  settings: {
    optimizer?: { enabled: boolean; runs: number };
    libraries?: Record<string, Record<string, string>>;
    [k: string]: unknown;
  };
}

interface CompilerMetadata {
  compiler: { version: string };
  settings: { compilationTarget: Record<string, string> };
}

function loadDeployment(hre: HardhatRuntimeEnvironment, name: string): DeploymentArtifact {
  const file = path.join(hre.config.paths.deployments, hre.network.name, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Deployment not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as DeploymentArtifact;
}

function loadSolcInput(hre: HardhatRuntimeEnvironment, hash: string): SolcInput {
  const file = path.join(hre.config.paths.deployments, hre.network.name, "solcInputs", `${hash}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`solcInput not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as SolcInput;
}

function listDeployments(hre: HardhatRuntimeEnvironment): string[] {
  const dir = path.join(hre.config.paths.deployments, hre.network.name);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("."))
    .map((f) => f.replace(/\.json$/, ""));
}

function encodeConstructorArgs(deployment: DeploymentArtifact): string {
  if (deployment.args.length === 0) return "";
  const ctor = deployment.abi.find((x) => x.type === "constructor");
  if (!ctor || !ctor.inputs) {
    throw new Error("Constructor not found in ABI but args are non-empty");
  }
  const types = ctor.inputs.map((i) => i.type);
  const encoded = AbiCoder.defaultAbiCoder().encode(types, deployment.args);
  return encoded.startsWith("0x") ? encoded.slice(2) : encoded;
}

function buildSourceCode(deployment: DeploymentArtifact, baseInput: SolcInput): string {
  // Deep-clone so we don't mutate the cached file.
  const input: SolcInput = JSON.parse(JSON.stringify(baseInput));
  // Inject library addresses into settings.libraries keyed by source path.
  // hardhat-deploy stores them flat as { LibName: address }; the deployment's
  // metadata tells us which source file declares each lib. We just look up
  // each library name across all sources and put it under the source that
  // defines it. For HonkBase libs, that's "src/HonkBase.sol" for all three.
  if (deployment.libraries && Object.keys(deployment.libraries).length > 0) {
    const libsBySource: Record<string, Record<string, string>> = {};
    // Find the source path for each library name by scanning the input sources.
    // Library declarations look like "library Name {" in the source content.
    for (const [libName, libAddr] of Object.entries(deployment.libraries)) {
      let foundSource: string | null = null;
      for (const [sourcePath, sourceObj] of Object.entries(input.sources)) {
        const content = (sourceObj as { content?: string }).content ?? "";
        if (new RegExp(`\\blibrary\\s+${libName}\\b`).test(content)) {
          foundSource = sourcePath;
          break;
        }
      }
      if (!foundSource) {
        throw new Error(`Could not locate source defining library ${libName}`);
      }
      if (!libsBySource[foundSource]) libsBySource[foundSource] = {};
      libsBySource[foundSource][libName] = libAddr;
    }
    input.settings.libraries = libsBySource;
  }
  return JSON.stringify(input);
}

function getCompilationTarget(deployment: DeploymentArtifact): { path: string; name: string } {
  const md = JSON.parse(deployment.metadata) as CompilerMetadata;
  const [sourcePath, contractName] = Object.entries(md.settings.compilationTarget)[0];
  return { path: sourcePath, name: contractName };
}

function getCompilerVersion(deployment: DeploymentArtifact): string {
  const md = JSON.parse(deployment.metadata) as CompilerMetadata;
  return md.compiler.version.startsWith("v") ? md.compiler.version : `v${md.compiler.version}`;
}

async function postForm(url: string, params: Record<string, string>): Promise<{ status: string; message: string; result: string }> {
  const body = new URLSearchParams(params);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return (await res.json()) as { status: string; message: string; result: string };
}

async function getJson(url: string): Promise<{ status: string; message: string; result: string }> {
  const res = await fetch(url);
  return (await res.json()) as { status: string; message: string; result: string };
}

async function pollStatus(apiKey: string, chainId: number, guid: string): Promise<string> {
  const url = `${V2_URL}?chainid=${chainId}&module=contract&action=checkverifystatus&guid=${guid}&apikey=${apiKey}`;
  const maxAttempts = 24;
  const intervalMs = 5_000;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await getJson(url);
    const result = res.result || "";
    // Etherscan returns status="1" with result="Pass - Verified", or
    // status="0" with result="Pending in queue" / "Fail - Unable to verify".
    if (result.startsWith("Pass") || result.includes("Already Verified")) return result;
    if (result.startsWith("Fail")) return result;
    process.stdout.write(".");
  }
  return "Timed out polling for verification status";
}

async function verifyOne(
  hre: HardhatRuntimeEnvironment,
  apiKey: string,
  chainId: number,
  name: string,
): Promise<void> {
  const deployment = loadDeployment(hre, name);
  const solcInput = loadSolcInput(hre, deployment.solcInputHash);
  const target = getCompilationTarget(deployment);
  const compilerversion = getCompilerVersion(deployment);
  const constructorArguments = encodeConstructorArgs(deployment);
  const sourceCode = buildSourceCode(deployment, solcInput);
  const licenseType = LICENSE_BY_CONTRACT[name];
  if (!licenseType) {
    throw new Error(`No license mapping for ${name} — add it to LICENSE_BY_CONTRACT`);
  }

  console.log(`\n${name} @ ${deployment.address}`);
  console.log(`  source:   ${target.path}:${target.name}`);
  console.log(`  compiler: ${compilerversion}`);
  console.log(`  license:  ${licenseType === LICENSE_GPL3 ? "GPL-3.0" : "Apache-2.0"}`);
  if (deployment.libraries && Object.keys(deployment.libraries).length > 0) {
    console.log(`  libs:     ${Object.keys(deployment.libraries).join(", ")}`);
  }
  if (constructorArguments) {
    console.log(`  ctorArgs: ${constructorArguments.length / 2} bytes`);
  }

  const submitUrl = `${V2_URL}?chainid=${chainId}`;
  const submission = await postForm(submitUrl, {
    apikey: apiKey,
    module: "contract",
    action: "verifysourcecode",
    chainid: String(chainId),
    contractaddress: deployment.address,
    sourceCode,
    codeformat: "solidity-standard-json-input",
    contractname: `${target.path}:${target.name}`,
    compilerversion,
    constructorArguements: constructorArguments,
    licenseType: String(licenseType),
  });

  if (submission.status !== "1") {
    if (submission.result && submission.result.includes("already verified")) {
      console.log(`  already verified, skipping`);
      return;
    }
    throw new Error(`Submission failed: ${submission.message} — ${submission.result}`);
  }

  const guid = submission.result;
  console.log(`  guid: ${guid}`);
  process.stdout.write(`  polling`);
  const final = await pollStatus(apiKey, chainId, guid);
  console.log(` ${final}`);
  const host = ETHERSCAN_HOST[chainId];
  if (host && (final.startsWith("Pass") || final.includes("Already"))) {
    console.log(`  https://${host}/address/${deployment.address}#code`);
  }
}

task("verify-etherscan", "Verify deployed contracts on Etherscan v2 using deployment artifacts")
  .addOptionalParam("name", "Single contract name to verify (default: all deployments)")
  .setAction(async (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
    const apiKey = process.env.ETHERSCAN_API_KEY;
    if (!apiKey) throw new Error("ETHERSCAN_API_KEY not set in env");
    const chainId = hre.network.config.chainId;
    if (!chainId) throw new Error(`chainId not configured for network ${hre.network.name}`);

    const names = taskArgs.name ? [String(taskArgs.name)] : listDeployments(hre);
    if (names.length === 0) {
      console.log(`No deployments found for network ${hre.network.name}`);
      return;
    }

    console.log(`Verifying ${names.length} contract(s) on chainId=${chainId}`);
    for (const name of names) {
      try {
        await verifyOne(hre, apiKey, chainId, name);
      } catch (e) {
        console.error(`  ERROR: ${(e as Error).message}`);
      }
    }
  });
