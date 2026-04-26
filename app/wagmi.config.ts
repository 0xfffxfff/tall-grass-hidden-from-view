import { defineConfig } from "@wagmi/cli";
import { react } from "@wagmi/cli/plugins";
import { Abi, Address } from "viem";
import { hardhat } from "viem/chains";

import TallGrassLocalhost from "../contracts/deployments/localhost/TallGrass.json";

export default defineConfig({
  out: "src/generated.ts",
  contracts: [
    {
      abi: TallGrassLocalhost.abi as Abi,
      address: {
        [hardhat.id]: TallGrassLocalhost.address as Address,
      },
      name: "TallGrass",
    },
  ],
  plugins: [react()],
});
