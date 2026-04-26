import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { APP_CHAIN } from "./chain";

export const config = createConfig({
  chains: [APP_CHAIN],
  connectors: [injected()],
  transports: {
    [APP_CHAIN.id]: http(import.meta.env.VITE_RPC_URL),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
