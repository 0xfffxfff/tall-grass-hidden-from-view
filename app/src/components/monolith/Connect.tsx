import { useEffect, useRef, useState } from "react";
import { useConnect } from "wagmi";

export function Connect() {
  const { connect, connectors, isPending, variables } = useConnect();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  const visible = connectors.filter((c) => c.type !== "mock");
  const pendingUid =
    variables?.connector && "uid" in variables.connector
      ? variables.connector.uid
      : null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (visible.length === 0) {
    return (
      <span className="aff" aria-disabled="true">
        no wallet detected
      </span>
    );
  }

  if (visible.length === 1) {
    const c = visible[0];
    const pending = isPending && pendingUid === c.uid;
    const label = c.name.toLowerCase() === "injected"
      ? "connect wallet"
      : `connect ${c.name.toLowerCase()}`;
    return (
      <button
        className="aff live"
        disabled={isPending}
        onClick={() => connect({ connector: c })}
      >
        {pending ? "connecting\u2026" : label}
      </button>
    );
  }

  return (
    <span ref={wrapRef} className="connect-wrap">
      <button
        className={"aff live" + (open ? " open" : "")}
        disabled={isPending}
        onClick={() => setOpen((v) => !v)}
      >
        {isPending ? "connecting\u2026" : "connect wallet"}
      </button>
      {open && (
        <div className="wallet-picker" role="menu">
          {visible.map((c) => {
            const pending = isPending && pendingUid === c.uid;
            return (
              <button
                key={c.uid}
                className="aff live"
                disabled={isPending}
                onClick={() => {
                  connect({ connector: c });
                  setOpen(false);
                }}
              >
                {pending ? `${c.name.toLowerCase()}\u2026` : c.name.toLowerCase()}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
