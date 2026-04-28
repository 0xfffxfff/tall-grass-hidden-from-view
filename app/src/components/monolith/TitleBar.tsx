import {
  useAccount,
  useChainId,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { APP_CHAIN } from "@/chain";
import { Connect } from "./Connect";

function shortAddr(a: string): string {
  return a.slice(0, 5) + "\u2026" + a.slice(-4);
}

export function TitleBar() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const wrongChain = isConnected && chainId !== APP_CHAIN.id;

  if (!isConnected) {
    return (
      <p className="titlebar">
        <Connect />
      </p>
    );
  }

  if (wrongChain) {
    return (
      <p className="titlebar titlebar-warn">
        <span className="warn-mark">!</span>
        wrong network
        <span className="sep">&middot;</span>
        <button
          className="aff live"
          onClick={() => switchChain({ chainId: APP_CHAIN.id })}
        >
          switch to {APP_CHAIN.name.toLowerCase()}
        </button>
        <span className="sep">&middot;</span>
        <button className="aff live" onClick={() => disconnect()}>
          disconnect
        </button>
      </p>
    );
  }

  return (
    <p className="titlebar">
      <span className="addr">{address && shortAddr(address)}</span>
      <span className="sep">&middot;</span>
      <button className="aff live" onClick={() => disconnect()}>
        disconnect
      </button>
    </p>
  );
}
