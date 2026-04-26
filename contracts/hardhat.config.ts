import 'dotenv/config'
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-foundry";
import "@nomicfoundation/hardhat-ledger";
import "hardhat-contract-sizer";
import "hardhat-deploy";
import { task } from "hardhat/config";
import "./tasks";

// Prevent naked `npx hardhat deploy` — require --tags
task("deploy").setAction(async (args, _hre, runSuper) => {
  if (!args.tags || args.tags === "") {
    throw new Error("Specify --tags (e.g. --tags TallGrass)");
  }
  return runSuper(args);
});

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "cancun",
    }
  },
  contractSizer: {
    runOnCompile: process.env.REPORT_SIZE === "true",
  },
  namedAccounts: {
    deployer: {
      default: 0,
    }
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  networks: {
    hardhat: {},
    localhost: {},
    sepolia: {
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
      url: process.env.RPC_URL || "",
    },
    mainnet: {
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
      url: process.env.RPC_URL || "",
      chainId: 1,
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      mainnet: process.env.ETHERSCAN_API_KEY || "",
    }
  },
};

export default config;
