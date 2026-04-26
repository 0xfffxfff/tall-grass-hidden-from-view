import { useAccount } from "wagmi";

function shortAddr(a: string): string {
  return a.slice(0, 5) + "\u2026" + a.slice(-4);
}

interface Props {
  registered: boolean;
  steps: number;
  pendingEncounters: number;
}

export function YouStrip({ registered, steps, pendingEncounters }: Props) {
  const { address } = useAccount();
  if (!address) return null;

  return (
    <p className="you">
      <span className="k">{registered ? "walking as" : "connected as"}</span>
      <span className="v">{shortAddr(address)}</span>
      {registered && (
        <>
          <span className="sep">&middot;</span>
          <span className="k">step</span>
          <span className="v">{steps}</span>
          {pendingEncounters > 0 && (
            <>
              <span className="sep">&middot;</span>
              <span className="k">encounters</span>
              <span className="v">{pendingEncounters} pending</span>
            </>
          )}
        </>
      )}
    </p>
  );
}
