import { defineConfig } from "@wagmi/cli";
import { react } from "@wagmi/cli/plugins";
import { Abi, Address } from "viem";
import { hardhat, sepolia } from "viem/chains";

import TallGrassLocalhost from "../contracts/deployments/localhost/TallGrass.json";
import TallGrassSepolia from "../contracts/deployments/sepolia/TallGrass.json";

export default defineConfig({
  out: "src/generated.ts",
  contracts: [
    {
      abi: TallGrassSepolia.abi as Abi,
      address: {
        [hardhat.id]: TallGrassLocalhost.address as Address,
        [sepolia.id]: TallGrassSepolia.address as Address,
      },
      name: "TallGrass",
    },
  ],
  plugins: [react()],
});
