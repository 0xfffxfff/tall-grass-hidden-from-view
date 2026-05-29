// Render a full address as a short label that links to the chain's block
// explorer, with the full value in the native tooltip so it stays
// copy-pastable. Falls back to plain text on chains without an explorer.

import { APP_CHAIN } from "@/chain";
import { shortAddr } from "./monolithLib";

interface Props {
  address: string;
  className?: string;
}

export function AddrLink({ address, className }: Props) {
  const explorer = APP_CHAIN.blockExplorers?.default.url;
  const label = shortAddr(address);
  if (!explorer || !address || !address.startsWith("0x")) {
    return <span className={className} title={address}>{label}</span>;
  }
  return (
    <a
      className={className}
      href={`${explorer}/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
    >
      {label}
    </a>
  );
}
