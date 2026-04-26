import { createConfig, fallback, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { hardhat } from "wagmi/chains";
import { APP_CHAIN } from "./chain";

const SEPOLIA_PUBLIC_RPCS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://1rpc.io/sepolia",
  "https://sepolia.gateway.tenderly.co",
];

const paidRpc = import.meta.env.VITE_RPC_URL as string | undefined;

const transport =
  APP_CHAIN.id === hardhat.id
    ? http(paidRpc ?? "http://127.0.0.1:8545")
    : fallback([
        ...SEPOLIA_PUBLIC_RPCS.map((url) => http(url)),
        ...(paidRpc ? [http(paidRpc)] : []),
      ]);

export const config = createConfig({
  chains: [APP_CHAIN],
  connectors: [injected()],
  transports: {
    [APP_CHAIN.id]: transport,
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
