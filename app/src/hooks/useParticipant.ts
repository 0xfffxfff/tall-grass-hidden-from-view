import { useCallback, useEffect, useState } from "react";
import { api, type StateResult } from "@/api";

interface ParticipantState {
  registered: boolean;
  x: number | null;
  y: number | null;
  moveCount: number;
  participantMoveCount: number;
  walkSecret: string | null;
  apiToken: string | null;
  isLoading: boolean;
}

const INITIAL: ParticipantState = {
  registered: false,
  x: null,
  y: null,
  moveCount: 0,
  participantMoveCount: 0,
  walkSecret: null,
  apiToken: null,
  isLoading: false,
};

function fromResult(result: StateResult): ParticipantState {
  return {
    registered: result.registered,
    x: result.x,
    y: result.y,
    moveCount: result.moveCount,
    participantMoveCount: result.participantMoveCount,
    walkSecret: result.walkSecret ?? null,
    apiToken: result.apiToken ?? null,
    isLoading: false,
  };
}

export function useParticipant(address: string | undefined) {
  const [state, setState] = useState<ParticipantState>(INITIAL);

  // Fetch once on mount / address change
  useEffect(() => {
    if (!address) {
      setState(INITIAL);
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true }));

    api.state(address).then((result) => {
      if (!cancelled) setState(fromResult(result));
    }).catch(() => {
      if (!cancelled) setState((s) => ({ ...s, isLoading: false }));
    });

    return () => { cancelled = true; };
  }, [address]);

  const refresh = useCallback(() => {
    if (address) {
      api.state(address).then((result) => setState(fromResult(result)));
    }
  }, [address]);

  return { ...state, refresh };
}
