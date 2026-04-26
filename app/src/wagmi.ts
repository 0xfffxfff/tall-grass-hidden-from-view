import { createConfig, http } from "wagmi";
import { hardhat } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [hardhat],
  connectors: [injected()],
  transports: {
    [hardhat.id]: http("http://localhost:8545"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
