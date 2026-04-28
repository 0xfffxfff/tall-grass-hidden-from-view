import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { APP_CHAIN } from "@/chain";
import { useParticipant } from "@/hooks/useParticipant";
import { useReveals } from "@/hooks/useReveals";
import { useEncounteredEntities } from "@/hooks/useEncounteredEntities";
import { projectReveals } from "@/components/monolith/monolithLib";
import {
  useWatchTallGrassMovedEvent,
  useWatchTallGrassRegisteredEvent,
} from "@/generated";
import type { EncounterData } from "@/api";

import { WallText } from "@/components/monolith/WallText";
import { Stage } from "@/components/monolith/Stage";
import { YouStrip } from "@/components/monolith/YouStrip";
import { WalkInline } from "@/components/monolith/WalkInline";
import { PublicGrid } from "@/components/monolith/PublicGrid";
import { EntityRegistry } from "@/components/monolith/EntityRegistry";
import { EncountersInline } from "@/components/monolith/EncountersInline";
import { Exhibition } from "@/components/monolith/Exhibition";
import { Identity } from "@/components/monolith/Identity";
import { EntityModal } from "@/components/monolith/EntityModal";

type AppState = "disconnected" | "wrong-chain" | "unregistered" | "registered";

export function App() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const participant = useParticipant(address);
  const reveals = useReveals();
  const [pendingEncounters, setPendingEncounters] = useState<EncounterData[]>(
    [],
  );
  const [drillId, setDrillId] = useState<number | null>(null);
  const [modalEntityId, setModalEntityId] = useState<number | null>(null);
  const encountered = useEncounteredEntities(address);

  const state: AppState = !isConnected
    ? "disconnected"
    : chainId !== APP_CHAIN.id
      ? "wrong-chain"
      : participant.registered
        ? "registered"
        : "unregistered";

  // Drive page-level state via a body attribute so CSS can show/hide blocks.
  useEffect(() => {
    document.body.setAttribute("data-state", state);
    return () => {
      document.body.removeAttribute("data-state");
    };
  }, [state]);

  const projection = useMemo(
    () => projectReveals(reveals.reveals, reveals.traitCount),
    [reveals.reveals, reveals.traitCount],
  );

  // Pick a default drilldown entity once we have data
  useEffect(() => {
    if (drillId !== null) return;
    if (reveals.reveals.length > 0) {
      setDrillId(reveals.reveals[0].a);
    } else if (reveals.entityCount > 0) {
      setDrillId(0);
    }
  }, [drillId, reveals.reveals, reveals.entityCount]);

  // When the chain confirms a move or a registration for the connected
  // wallet, refresh the participant snapshot — this replaces the explicit
  // refresh() calls scattered through the auto-walk loop and lets multi-
  // device sessions stay in lockstep.
  const myAddrLower = address?.toLowerCase();
  const participantRefresh = participant.refresh;
  const refreshOnMyAddress = useCallback(
    (logs: { args: { participant?: string } }[]) => {
      if (!myAddrLower) return;
      for (const log of logs) {
        if (log.args.participant?.toLowerCase() === myAddrLower) {
          participantRefresh();
          break;
        }
      }
    },
    [myAddrLower, participantRefresh],
  );
  useWatchTallGrassMovedEvent({ onLogs: refreshOnMyAddress });
  useWatchTallGrassRegisteredEvent({ onLogs: refreshOnMyAddress });

  return (
    <>
      <div>
        <WallText />

        <Stage />

        <YouStrip
          registered={participant.registered}
          steps={participant.participantMoveCount}
          pendingEncounters={pendingEncounters.length}
        />

        <WalkInline
          ready={state}
          x={participant.x}
          y={participant.y}
          walkSecret={participant.walkSecret}
          apiToken={participant.apiToken}
          participantMoveCount={participant.participantMoveCount}
          onEncounters={(es) => {
            setPendingEncounters((prev) => [...prev, ...es]);
            for (const e of es) encountered.mark(e.entityId);
          }}
          onMoved={participant.refresh}
          onRegistered={participant.refresh}
        />

        <EncountersInline
          apiToken={participant.apiToken}
          pendingEncounters={pendingEncounters}
          onMinted={() => {
            participant.refresh();
          }}
        />

        <EntityRegistry
          entityCount={reveals.entityCount}
          personallyVisible={encountered.ids}
          onSelectEntity={setModalEntityId}
        />

        <PublicGrid
          entityCount={reveals.entityCount}
          traitCount={reveals.traitCount}
          revealsByPair={projection.revealsByPair}
          litByTrait={projection.litByTrait}
          flatReveals={reveals.reveals}
          loading={reveals.loading}
          prepend={reveals.prepend}
          drillId={drillId}
          onDrillIdChange={setDrillId}
          onEntitySelect={setModalEntityId}
        />

        <Exhibition />

        <Identity />
      </div>

      <EntityModal
        entityId={modalEntityId}
        entityCount={reveals.entityCount}
        traitCount={reveals.traitCount}
        reveals={projection.revealsByPair}
        flatReveals={reveals.reveals}
        prepend={reveals.prepend}
        personallyVisible={encountered.ids}
        onClose={() => setModalEntityId(null)}
      />
    </>
  );
}
