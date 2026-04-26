import {
  useAccount,
  useChainId,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { hardhat } from "wagmi/chains";
import { Connect } from "./Connect";

function shortAddr(a: string): string {
  return a.slice(0, 5) + "\u2026" + a.slice(-4);
}

export function TitleBar() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const wrongChain = isConnected && chainId !== hardhat.id;

  if (!isConnected) {
    return (
      <p className="titlebar">
        <Connect />
      </p>
    );
  }

  if (wrongChain) {
    return (
      <p className="titlebar">
        wrong network
        <span className="sep">&middot;</span>
        <button
          className="aff live"
          onClick={() => switchChain({ chainId: hardhat.id })}
        >
          switch to localhost
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
      connected as <span className="addr">{address && shortAddr(address)}</span>
      <span className="sep">&middot;</span>
      <button className="aff live" onClick={() => disconnect()}>
        disconnect
      </button>
    </p>
  );
}
