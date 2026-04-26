const BASE = "";

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

// --- Types ---

export interface RegisterResult {
  commitment: string;
  signature: string;
  x: number;
  y: number;
  walkSecret: string;
  apiToken: string;
}

export interface RelayResult {
  txHash: string;
}

export interface EncounterData {
  entityId: number;
  encounterProof: string;
  entityTraitHash: string;
  traitMerkleProof: string[];
  initialPositionCommitment: string;
  blindingSeedCommitment: string;
}

export interface EncounterResult {
  valid: boolean;
  encounters?: EncounterData[];
  participantPos?: { x: number; y: number };
}

export interface CompareResult {
  result: ">" | "<" | "=";
}

export interface RevealRecord {
  a: number;
  b: number;
  trait: number;
  op: ">" | "<" | "=";
  revealedAt: number;
  revealer: string;
}

export interface RevealsResult {
  entityCount: number;
  traitCount: number;
  now: number;
  reveals: RevealRecord[];
}

export interface StateResult {
  registered: boolean;
  x: number | null;
  y: number | null;
  moveCount: number;
  participantMoveCount: number;
  walkSecret?: string;
  apiToken?: string;
  entityPositions?: { x: number; y: number }[];
}

export interface ContractInfo {
  address: string;
  abi: unknown[];
}

// --- API calls ---

export const api = {
  register: (address: string) =>
    post<RegisterResult>("/api/register", { address }),

  relay: (address: string, proof: string, newCommitment: string) =>
    post<RelayResult>("/api/relay", { address, proof, newCommitment }),

  encounter: (address: string, token: string) =>
    post<EncounterResult>("/api/encounter", { address, token }),

  compare: (
    gt: string,
    eq: string,
    extras?: { entityA?: number; entityB?: number; traitIndex?: number; revealer?: string },
  ) =>
    post<CompareResult>("/api/compare", { gt, eq, ...(extras ?? {}) }),

  state: (address: string) =>
    get<StateResult>(`/api/state?address=${address}`),

  contract: () =>
    get<ContractInfo>("/api/contract"),

  reveals: (since = 0) =>
    get<RevealsResult>(`/api/reveals?since=${since}`),
};
