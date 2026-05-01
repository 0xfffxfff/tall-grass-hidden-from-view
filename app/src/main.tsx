import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "./wagmi";
import { App } from "./App";
import { FullPage } from "./FullPage";
import { Report, reportSlugFromPath } from "./Report";
import "./styles/globals.css";

const queryClient = new QueryClient();
const path = window.location.pathname;
const isFull = path === "/full";
const reportSlug = reportSlugFromPath(path);

// /full?id=N drops the Monolith into single-entity locked mode. N must
// be an integer in [0, 31] (the entity pool size). Anything else is
// silently ignored — falls back to the full Monolith view.
function readLockedEntityId(): number | undefined {
  if (!isFull) return undefined;
  const idParam = new URLSearchParams(window.location.search).get("id");
  if (idParam === null) return undefined;
  const parsed = Number.parseInt(idParam, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 31) return undefined;
  return parsed;
}
// /full?zoom=X overrides the default world-space zoom (1.4). Useful for
// preview rendering where a wider field flatters the per-entity slab.
// Clamped to a sane range.
function readZoomOverride(): number | undefined {
  if (!isFull) return undefined;
  const z = new URLSearchParams(window.location.search).get("zoom");
  if (z === null) return undefined;
  const parsed = Number.parseFloat(z);
  if (!Number.isFinite(parsed) || parsed < 0.3 || parsed > 3.0) return undefined;
  return parsed;
}
// /full?mirror=1 flips the canvas horizontally for the second of two
// back-to-back gallery screens. Combine with offsetX/offsetY (CSS px) to
// shift the camera so the two screens cover different regions of the world.
function readMirror(): boolean {
  if (!isFull) return false;
  return new URLSearchParams(window.location.search).get("mirror") === "1";
}
function readOffset(key: "offsetX" | "offsetY"): number {
  if (!isFull) return 0;
  const v = new URLSearchParams(window.location.search).get(key);
  if (v === null) return 0;
  const parsed = Number.parseFloat(v);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}
// /full?reactive=1 enables the chain reactivity overlay (default off so
// the kiosk remains aesthetically identical to the pre-reactive build).
// /full?reactive=1&verbose=1 also logs synthetic-loop slot transitions
// and every reactive event.
function readFlag(key: string): boolean {
  if (!isFull) return false;
  return new URLSearchParams(window.location.search).get(key) === "1";
}
const lockedEntityId = readLockedEntityId();
const zoomOverride = readZoomOverride();
const mirror = readMirror();
const offsetX = readOffset("offsetX");
const offsetY = readOffset("offsetY");
const reactive = readFlag("reactive");
const verbose = readFlag("verbose");

function Root() {
  if (isFull)
    return (
      <FullPage
        entityId={lockedEntityId}
        zoom={zoomOverride}
        mirror={mirror}
        offsetX={offsetX}
        offsetY={offsetY}
        reactive={reactive}
        verbose={verbose}
      />
    );
  if (reportSlug) return <Report slug={reportSlug} />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <Root />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
);
