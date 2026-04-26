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
const lockedEntityId = readLockedEntityId();

function Root() {
  if (isFull) return <FullPage entityId={lockedEntityId} />;
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
