# Webapp — Requirements & Information Architecture

## Context

The current frontend (`app/src/App.tsx`) is an integration test UI — functional buttons and a log console. It needs to become an exhibition-ready visitor interface for the May 1-5 showcase at Trust (Berlin).

**Visitor interaction model**: Desktop and phone. Most participants interact via desktop browser. On-site visitors scan a QR code and use their phone. Both are equal — responsive, not mobile-first.

**Primary mode**: Auto-walk. Most visitors will surrender agency — deposit ETH, let the oracle walk them. Manual movement is available but secondary.

**Position privacy**: Fully hidden. No coordinates, no grid visualization. Participants navigate a space they cannot see. They learn only terrain type (tall grass / clear) at their current cell and their move count.

**Monolith display**: Separate app, out of scope.

The interface should feel like an instrument panel for navigating something invisible — not a dashboard that explains everything.

---

## Requirements

### R1. Wallet Connection
- Connect via wagmi + viem (handrolled connect UI). Reown (WalletConnect) as backup connector.
- Display truncated address as participant identity
- Handle chain switching (mainnet for exhibition, testnet for dev)
- Must work in both desktop and mobile browser wallets (MetaMask, Rainbow, etc.)

### R2. Registration (Enter)
- One-time action: participant enters the landscape
- Oracle signs initial position commitment (position hidden from participant)
- On-chain tx submitted via wallet
- Post-registration: participant is "in the landscape"
- No spatial feedback — just confirmation that you're in

### R3. Movement (Manual — Secondary)
- Four cardinal directions (N/S/E/W)
- Each move: browser generates ZK proof via Noir WASM (~1s desktop, slower on phone), participant submits tx. Oracle proving available as fallback.
- **No coordinate feedback** — participant does not know where they are
- After each move: terrain type shown (tall grass / clear ground). No map, no coordinates.
- Move counter visible (how many steps taken)
- Disabled while auto-walk is active
- Available as an alternative to auto-walk, not the default

### R4. Auto-Walk (Primary)
- Client-side loop: browser picks directions, generates ZK proofs, submits via relay endpoint
- No server-side logic — the server doesn't know or care that it's automated
- Walk patterns: random, zigzag, spiral, snake (selectable before starting)
- Configurable: stop on encounter (default), gas limit, max steps
- Status: current phase (proving, relaying, confirming), steps taken, deposit remaining
- Encounters accumulate — participant can mint later within grace period (24h)
- **This is the default, encouraged path for exhibition visitors**
- Should feel like letting go, not configuring a bot

### R5. Encounters
- During auto-walk: client checks for encounters after each step, attestations accumulate
- During manual walk: participant can check encounter after each move
- Valid encounter: attestation with deadline, entity ID, trait CID, Merkle proof, oracle signature
- List of pending (active) attestations shown — countdown to expiry
- No position information revealed for encounters

### R6. Minting
- Collect an encountered entity as NFT for mint price (0.2 ETH)
- Requires valid, non-expired attestation
- On-chain: Merkle proof of trait CID, oracle signature verification
- Post-mint: entity is owned, stops autonomous movement, traits become accessible for comparison

### R7. FHE Trait Comparison
- Compare two minted entities on a single trait index (0-6)
- Browser loads TFHE WASM + cloud key (78 MB one-time download)
- Homomorphic GT + EQ computation in browser (~2.5s per trait)
- Oracle decrypts encrypted result: `>`, `<`, or `=`
- Result is relative — actual trait values remain unknowable
- Secondary activity, only relevant after minting 2+ entities
- 78 MB cloud key download + CPU-intensive computation. Negligible on desktop, slower on phone. Not a blocker — comparison is a post-mint activity participants can do on any device.

### R8. Activity / Event Stream
- Real-time feed of on-chain events (Moved, Minted)
- Shared across all participants — sense of others moving in the dark
- Minimal: timestamps + event type + truncated address. No positions.

### R9. Contract / Network Info
- Contract address, network, mint price
- Served from existing `/api/contract` endpoint

---

## Information Architecture

### Single-page, responsive, progressive disclosure

One view. No routing. Sections reveal based on participant state. The page grows as the participant progresses deeper into the piece.

```
┌───────────────────────────────────────┐
│                                       │
│  TALL GRASS (HIDDEN FROM VIEW)        │
│  0xfff                                │
│                                       │
├───────────────────────────────────────┤
│                                       │
│  [CONNECT WALLET]                     │  <── always visible
│                                       │
├───────────────────────────────────────┤
│                                       │
│  [ENTER THE LANDSCAPE]                │  <── after connect
│                                       │
├───────────────────────────────────────┤
│                                       │
│  WALKING                              │  <── after register
│                                       │
│  ┌─ Auto-walk (default) ───────────┐  │
│  │  [Surrender]                    │  │
│  │  deposit: 0.01 ETH             │  │
│  │                                 │  │
│  │  status: walking...             │  │
│  │  steps: 47                      │  │
│  │  deposit remaining: 0.006 ETH   │  │
│  │  [Top Up]                       │  │
│  └─────────────────────────────────┘  │
│                                       │
│  ┌─ Manual (alternative) ──────────┐  │
│  │  [N] [S] [E] [W]               │  │
│  │  steps: 12                      │  │
│  └─────────────────────────────────┘  │
│                                       │
├───────────────────────────────────────┤
│                                       │
│  ENCOUNTERS                           │  <── after first encounter
│                                       │
│  Entity #7 — expires in 23:41:02      │
│  [Mint — 0.2 ETH]                     │
│                                       │
│  Entity #22 — expires in 22:15:33     │
│  [Mint — 0.2 ETH]                     │
│                                       │
├───────────────────────────────────────┤
│                                       │
│  COLLECTION                           │  <── after first mint
│                                       │
│  Entity #7 (owned)                      │
│  Entity #14 (owned)                     │
│                                       │
│  Compare: #7 vs #14, trait 3          │
│  Result: >                            │
│                                       │
├───────────────────────────────────────┤
│                                       │
│  ─── ACTIVITY ───                     │  <── always visible
│  14:03:22  someone moved              │
│  14:03:18  entity #4 minted          │
│  14:02:55  someone entered            │
│  ...                                  │
│                                       │
└───────────────────────────────────────┘
```

### State Machine (what's visible when)

```
DISCONNECTED:
  - Title, Connect button, Activity stream

CONNECTED (not registered):
  + Enter button

REGISTERED (idle):
  + Walking section (auto-walk default, manual alternative)

WALKING (auto-walk active):
  + Auto-walk status, top-up
  - Manual movement disabled

WALKING (manual):
  + Directional controls
  + Encounter check (implicit or explicit)

HAS_ENCOUNTERS:
  + Encounters section with mint buttons

HAS_COLLECTION:
  + Collection section with comparison UI
```

### Key Design Principles

1. **Responsive**: Works equally on desktop and phone. Single column, adequate touch targets, no hover-dependent interactions.
2. **Progressive disclosure**: Don't overwhelm. Reveal complexity as the participant earns it.
3. **Minimal spatial feedback**: The participant is nearly blind. They learn terrain type at their cell (tall grass / clear) and move count. No coordinates, no map, no grid. This is the point.
4. **Auto-walk as surrender**: The primary action is *giving up control*. The button should feel like a deliberate act of letting go, not "start bot."
5. **Minimal text**: Labels and states, not paragraphs. The piece should be felt, not explained.
6. **Monospace / utilitarian aesthetic**: Consistent with the integration test DNA. Not slick — functional, honest, slightly cold.

---

## File Structure

```
app/src/
├── main.tsx                 # entry point (no router needed)
├── App.tsx                  # rewrite: visitor interface
├── api.ts                   # API client (exists, extend)
├── contract.ts              # chain interaction (exists, extend)
├── fhe.ts                   # FHE operations (exists, keep as-is)
├── components/
│   ├── Connect.tsx          # wallet connection
│   ├── Enter.tsx            # registration
│   ├── Walk.tsx             # auto-walk + manual movement
│   ├── Encounters.tsx       # pending attestations + mint buttons
│   ├── Collection.tsx       # owned entities + comparison
│   └── Activity.tsx         # live event feed
└── hooks/
    ├── useParticipant.ts    # participant state (registered, position hidden, move count)
    ├── useAutoWalk.ts       # client-side auto-walk loop (pattern selection, ZK proving, relay)
    ├── useEncounters.ts     # attestation polling + expiry countdown
    └── useEvents.ts         # on-chain event subscription
```

No new dependencies needed beyond what exists (React 19, ethers 6, vite). No router library — single page with conditional rendering.

---

## API Surface (existing, no changes needed)

All endpoints in `server.ts` already support this IA:
- `POST /api/register` — Enter
- `POST /api/relay` — Relay a ZK-proven move (used by both manual relay and auto-walk)
- `POST /api/encounter` — Check encounter after move
- `POST /api/compare` — FHE decrypt
- `GET /api/state` — Participant state
- `GET /api/attestations/:address` — Pending encounters
- `GET /api/contract` — Contract info

Auto-walk is entirely client-side — no dedicated server endpoints needed. The client generates proofs and submits via the existing relay endpoint.

Server-side change needed: strip `x`, `y` from API responses in production mode (currently leaked for dev convenience). Add an env var or build flag.

---

## Notes

- **78 MB cloud key**: FHE comparison requires a large one-time download. On desktop this is negligible; on phone it may be slow. Comparison is mostly a post-encounter activity anyway — visitors who mint multiple entities can compare at their leisure, on whichever device they prefer.
- **Gas on mobile**: Visitors need ETH for registration, movement txs, minting, and auto-walk deposit. Exhibition setup likely needs a faucet or pre-funded wallets. Out of scope for this document but worth noting.
- **Encounter detection during auto-walk**: The oracle already handles this. The webapp just needs to poll `/api/attestations/:address` and surface results.
