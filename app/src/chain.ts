import { hardhat, sepolia } from "wagmi/chains";
import type { Chain } from "viem";

const CHAIN_NAME = (import.meta.env.VITE_CHAIN ?? "sepolia") as string;

export const APP_CHAIN: Chain =
  CHAIN_NAME === "hardhat" ? hardhat : sepolia;
