import { useCallback, useEffect, useRef, useState } from "react";
import { fheWorker, setLogHandler } from "@/fheWorkerClient";
import { workBus } from "@/lib/workBus";

export type FheStatus =
  | "idle"
  | "loading-wasm"
  | "awaiting-consent"
  | "loading-key"
  | "ready"
  | "error";

interface UseFheResult {
  status: FheStatus;
  message: string;
  awaitingConsent: boolean;
  ensureReady: () => Promise<void>;
  grantConsent: () => void;
  cancelConsent: () => void;
  compare: (a: number, b: number, trait: number) => Promise<{ gtHex: string; eqHex: string }>;
}

let bootstrapPromise: Promise<void> | null = null;

// The cloud key is ~78 MB, big enough that we never want to fetch it
// without explicit user intent — metered connections, slow links, and
// limited storage on every device class are reasons to confirm. Consent
// is persisted across sessions per origin so the prompt only ever
// appears once per browser.
const CONSENT_KEY = "tg-fhe-consent-v1";

function hasPriorConsent(): boolean {
  try { return localStorage.getItem(CONSENT_KEY) === "1"; } catch { return false; }
}

function persistConsent(): void {
  try { localStorage.setItem(CONSENT_KEY, "1"); } catch {}
}

export function useFhe(): UseFheResult {
  const [status, setStatus] = useState<FheStatus>("idle");
  const [message, setMessage] = useState("");
  const [awaitingConsent, setAwaitingConsent] = useState(false);
  const consentResolverRef = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setLogHandler((m) => {
      setMessage(m);
      // Surface fine-grained worker progress (e.g. ciphertext fetch) on the
      // public strip while bootstrap is in flight.
      if (bootstrapPromise) workBus.update("fhe-bootstrap", m);
    });
  }, []);

  const grantConsent = useCallback(() => {
    persistConsent();
    consentResolverRef.current?.(true);
    consentResolverRef.current = null;
    setAwaitingConsent(false);
  }, []);

  const cancelConsent = useCallback(() => {
    consentResolverRef.current?.(false);
    consentResolverRef.current = null;
    setAwaitingConsent(false);
  }, []);

  const ensureReady = useCallback(async () => {
    if (bootstrapPromise) {
      await bootstrapPromise;
      setStatus("ready");
      return;
    }
    bootstrapPromise = (async () => {
      workBus.start({
        id: "fhe-bootstrap",
        scope: "public",
        label: "loading FHE runtime",
      });
      setStatus("loading-wasm");
      setMessage("loading wasm");
      await fheWorker.init();

      if (!hasPriorConsent()) {
        setStatus("awaiting-consent");
        setMessage("");
        // Pause the strip while the consent UI is what the user reads —
        // we don't want a duplicate "downloading…" message racing it.
        workBus.update("fhe-bootstrap", "waiting for confirmation");
        setAwaitingConsent(true);
        const ok = await new Promise<boolean>((resolve) => {
          consentResolverRef.current = resolve;
        });
        if (!ok) throw new Error("Cloud key download declined");
      }

      workBus.update("fhe-bootstrap", "downloading cloud key (~78 MB)");
      setStatus("loading-key");
      setMessage("loading cloud key (~78 MB)");
      await fheWorker.loadCloudKey();
      setStatus("ready");
      setMessage("");
      workBus.end("fhe-bootstrap");
    })().catch((e) => {
      bootstrapPromise = null;
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "FHE init failed");
      workBus.end("fhe-bootstrap");
      throw e;
    });
    await bootstrapPromise;
  }, []);

  const compare = useCallback(
    async (a: number, b: number, trait: number) => {
      await ensureReady();
      const id = `fhe-compare-${a}-${b}-${trait}`;
      workBus.start({
        id,
        scope: "public",
        label: `homomorphic compare #${pad2(a)} \u00B7 #${pad2(b)} \u00B7 trait ${trait}`,
      });
      try {
        return await fheWorker.compare(a, b, trait);
      } finally {
        workBus.end(id);
      }
    },
    [ensureReady],
  );

  return { status, message, awaitingConsent, ensureReady, grantConsent, cancelConsent, compare };
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}
