import { useEffect, useMemo } from "react";
import { type Address } from "viem";
import {
  useReadTallGrassAllTokenStates,
  useWatchTallGrassMintedEvent,
  useWatchTallGrassTransferEvent,
  useWatchTallGrassEntityMovedEvent,
} from "@/generated";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export interface Token {
  id: number;
  owner: Address | null;
  minted: boolean;
  moveCount: number;
  traitHash: `0x${string}`;
  positionCommitment: `0x${string}`;
  blindingSeedCommitment: `0x${string}`;
}

export interface TokensState {
  tokens: Token[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useTokens(): TokensState {
  const { data, isLoading, error, refetch } = useReadTallGrassAllTokenStates();

  // Re-fetch on any chain event that mutates per-entity state.
  useWatchTallGrassMintedEvent({ onLogs: () => refetch() });
  useWatchTallGrassTransferEvent({ onLogs: () => refetch() });
  useWatchTallGrassEntityMovedEvent({ onLogs: () => refetch() });

  // Vite/HMR can keep stale subscriptions around. The watchers above cover
  // mutation, but mount-time refetch covers the cold-start case where the
  // initial query raced an RPC error and the cached value is empty.
  useEffect(() => {
    if (!data && !isLoading && !error) refetch();
  }, [data, isLoading, error, refetch]);

  const tokens = useMemo<Token[]>(() => {
    if (!data) return [];
    return data.map((s, id) => ({
      id,
      owner: s.owner === ZERO_ADDRESS ? null : (s.owner as Address),
      minted: s.owner !== ZERO_ADDRESS,
      moveCount: Number(s.moveCount),
      traitHash: s.traitHash,
      positionCommitment: s.positionCommitment,
      blindingSeedCommitment: s.blindingSeedCommitment,
    }));
  }, [data]);

  return {
    tokens,
    loading: isLoading,
    error: error as Error | null,
    refetch,
  };
}
