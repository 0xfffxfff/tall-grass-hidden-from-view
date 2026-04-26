# SPEC.md — Tall Grass (Hidden From View)

Technical and artistic specification for a programmable cryptography art piece by 0xfff, funded by The Pixel Prize (JUST Open Source Stiftung).

---

## 1. Overview

*Tall Grass (Hidden From View)* is a three-component artwork operating at the intersection of zero-knowledge proofs, homomorphic encryption, and contemporary art. Participants navigate a hidden landscape, encounter shrouded entities, and collect opaque NFTs whose traits can only be compared — never revealed.

The piece consists of:

1. **I — Landscape (Contract)** — A hidden grid with rectangular tall grass patches, committed on-chain. Participants move through it with private positions, proving movement validity via ZK proofs generated in their browser. A lightweight oracle mediates terrain discovery and entity encounters.
2. **II — Entities (NFTs)** — Scarce, collectible entities with FHE-encrypted traits. Encountered on tall grass cells during movement. Minted as ERC-721 tokens. Before minting, entities move autonomously; after minting, owners control their movement. Traits are permanently opaque — only pairwise homomorphic comparison is possible.
3. **III — Monolith (Sculpture)** — A double-sided screen sculpture (screen + frosted diffusion layer + metal grate + metal frame) displaying a generative visualization driven by on-chain state. The monolith's hardware also serves as the oracle, making the sculpture the physical container of the landscape's secret.

**Chain:** Ethereum Mainnet.
**License:** GPL-3.0.

---

## 2. System Architecture

### 2.1 Trust Model

The system splits trust between two domains:

- **Trustless (on-chain, client-side ZK):** Participant movement validity, position commitments, proof verification, encounter verification, minting, token ownership.
- **Trusted oracle (the monolith):** Terrain reveals, encounter proof generation, density hints (optional). The oracle holds the landscape seed and computes entity positions deterministically from the seed and entity index. Encounter detection is ZK-proved: the oracle generates a proof that a participant's position matches an entity derived from the seed, and the contract verifies this proof on-chain at mint time. The oracle is designed as a sealed, automated process. The artist does not inspect participant positions.

This reflects a deliberate artistic and technical stance: *"current cryptographic tools don't yet enable fully autonomous hidden programs"* (from the proposal). The oracle is the minimum trust required to keep the landscape hidden.

**Stretch goal — TEE (Trusted Execution Environment):** Running the oracle inside a hardware enclave (Intel SGX, AWS Nitro, or similar) would upgrade the trust model from "artist chooses not to look" to "artist cannot look." The FHE secret key, participant positions, and entity state would all be hardware-protected — the artist cannot extract them even with physical access to the machine. Remote attestation proves the enclave runs the correct, unmodified oracle code. Not feasible for the May exhibition timeline but a strong candidate for the grand prize version (June 2026).

**Stretch goal — Trustless terrain reveals:** Private Information Retrieval or FHE-based lookup, eliminating the oracle's knowledge of participant positions without TEE hardware.

### 2.2 High-Level Participant Flow

```
1. Participant connects wallet (wagmi + viem) on web dashboard
2. Participant queries oracle for starting position + walkSecret, computes commitment, calls register()
3. Participant chooses a direction (N/S/E/W)
4. Browser generates ZK proof of valid movement
5. Participant submits proof directly via move(), or sends it to oracle via POST /api/relay
   for gas-free submission (oracle pays gas, reimburses from participant's deposit)
6. Contract verifies proof, updates position commitment, increments global move counter
7. If relay: oracle returns txHash. Client checks encounters separately after tx confirmation.
   If manual: browser queries POST /api/encounter after on-chain confirmation.
8. If encounter with unminted entity on tall grass: oracle generates ZK encounter proof
   (proves co-location using the landscape seed). Participant sees its encrypted form.
   They can compare it against any minted entity via FHE (§4.5). First mint is always blind
   (no minted entities exist to compare against).
9. If encounter with minted entity on tall grass: participant sees its encrypted form,
   can compare traits, learns who owns it. Cannot collect it.
10. Participant decides to mint (pays mint fee) or passes. No time window — the encounter
    proof is valid as long as the participant hasn't moved (proof references current position
    commitment). If the participant moves before minting, the proof becomes invalid.
11. If minting: encounter proof + payment submitted to contract → proof verified on-chain
    → ERC-721 minted
```

**Note on entity positions:** Entity positions are static — computed deterministically from the seed and entity index at deployment time. Entities do not move. The oracle computes entity positions directly from the seed.

### 2.3 Cryptographic Primitives

| Primitive | Purpose | Implementation |
|-----------|---------|---------------|
| ZK Proofs (participant movement) | Prove valid 1-step movement without revealing position | Noir circuits, browser WASM proving |
| Merkle Tree (terrain) | Commit to hidden terrain, enable cell-by-cell reveals | Poseidon hash, on-chain root |
| FHE (traits) | Encrypt entity traits, enable homomorphic comparison | TFHE C library v1.1 (Apache 2.0) compiled to WASM via emscripten |
| ZK Proofs (decryption verification) | Prove FHE comparison results were decrypted correctly under a committed key | Noir circuit, oracle-side proving, browser WASM verification |
| Position commitments | Hide participant positions on-chain | Poseidon hash of (x, y, salt) |

**Note on FHE library:** The original TFHE C library v1.1 (Apache 2.0, patent-free) is used instead of Zama's TFHE-rs, compiled to WASM via emscripten 5.0.0 using the Nayuki portable FFT (pure C, no x86 dependencies). This resolves the Zama patent concern documented in `context/research/zama-patents.md`. Security parameter: lambda=80 (acceptable for art context). WASM binary: ~198 KB. Cloud key: ~78 MB.

---

## 3. I — Landscape

### 3.1 Terrain

- **Topology:** 2D grid, toroidal (wraps on both axes). Walking off the right edge places you on the left; walking off the top places you on the bottom.
- **Dimensions:** To be determined during implementation based on encounter density tuning. Non-square grids are possible (e.g., 32×64). Stored as two contract parameters (`gridWidth`, `gridHeight`). Both are public — they are public inputs to the ZK circuits and readable on-chain. All grid-dependent code (circuits, oracle, terrain Merkle tree indexing) must use separate width/height, not a single size. Terrain Merkle tree leaf index: `y * gridWidth + x`.
- **Terrain types:** Binary — **tall grass** and **clear ground**.
- **Generation:** Rectangular tall grass patches, procedurally generated from a private seed. The landscape is composed of a parameterized number of axis-aligned rectangles, each defined by `(x_min, y_min, x_max, y_max)`. Cells within any rectangle are tall grass; all others are clear ground. Target density: ~50% tall grass. The seed is committed on-chain as `hash(seed)`.
- **Commitment:** The full terrain is committed as a per-cell Merkle tree. Leaves are ordered by cell index (`y * gridWidth + x`). Each leaf is `Poseidon(x, y, terrain_type)` where `terrain_type` is 0 (clear) or 1 (tall grass). Including coordinates in the leaf hash binds the terrain value to a specific cell — the Merkle proof path (leaf index) implicitly encodes the cell, and the leaf hash confirms it. The Merkle root is stored on-chain at deployment.
- **Progressive reveal:** Terrain is hidden at deployment. When a participant visits a cell, the oracle reveals its terrain type along with a Merkle proof (verifiable against the on-chain root). The oracle tracks the set of all revealed cells and feeds this to the monolith's visual system. Terrain is NOT revealed on-chain (avoids leaking participant positions). Over time, collective exploration maps out the landscape. **No terrain map is shown on the web dashboard** — the progressive reveal is expressed solely through the monolith (see §5.2).

### 3.2 Movement

- **Directions:** 4-directional — North, South, East, West.
- **Step size:** Exactly 1 cell per move. Wraps toroidally.
- **Constraints:** No obstacles. All cells are passable (both tall grass and clear ground). Movement validity means: the new position is exactly 1 cell away in a cardinal direction from the previous position, with toroidal wrapping.
- **Cost:** Gas for proof verification (~200-400k gas per move on mainnet). At current gas prices (~0.1 gwei, ~$2,000 ETH): approximately **$0.04-0.08 per move**. No additional movement fee.

### 3.3 Position Commitment Scheme

Each participant's position is stored on-chain as a commitment (hash), not in plaintext.

```
commitment = Poseidon(x, y, salt)
```

- `(x, y)` is the grid coordinate.
- `salt` is derived deterministically from a `walkSecret` provided by the oracle (prevents brute-force position recovery on small grids).
- The salt is refreshed with each move.

**Salt derivation:** Salts are derived deterministically from a `walkSecret` provided by the oracle at registration:

```
walkSecret = Poseidon(masterSecret, address)   // oracle computes at registration
salt = Poseidon(walkSecret, moveIndex)          // deterministic per move
```

The `masterSecret` is derived from the oracle's private key. The participant stores `walkSecret` locally (browser storage). The personal move count (how many times *this participant* has moved) is stored on-chain per participant, distinct from the global `moveCounter`.

**Recovery after browser state loss:** If a participant loses their `walkSecret` or position `(x, y)` (e.g., tab closed, device switch), they can request their state from the oracle via `GET /api/state?address=` (authenticated by the oracle's knowledge of participant state). The oracle returns the participant's current position, move count, and `walkSecret`. Alternatively, if only the position is lost but `walkSecret` is retained, the participant can: (1) read `participantMoveCount` from the contract, (2) re-derive the current salt from `walkSecret`, (3) brute-force `(x, y)` by trying all grid cells against their on-chain `positionCommitment` — on a 32×32 grid this is 1,024 Poseidon hashes, effectively instant. The salt prevents outsiders from performing this brute-force (they can't derive the salt without `walkSecret`). Note that `walkSecret` cannot be self-recovered from the wallet alone — the oracle is required.

**Registration flow:**
1. The participant's browser sends `POST /api/register` with their address.
2. The oracle computes the starting position, derives `walkSecret = Poseidon(masterSecret, address)`, computes the initial salt `Poseidon(walkSecret, 0)`, and constructs the initial position commitment.
3. The oracle signs the commitment: `sign(keccak256(participant_address, initialPositionCommitment))`.
4. The oracle returns `{ x, y, walkSecret, commitment, signature }` to the browser.
5. The participant calls `register(initialPositionCommitment, oracleSignature)` on the contract, which verifies the oracle signature, stores the commitment, and marks the address as a participant.

**Why the oracle must sign the initial commitment:** Without this, a participant could register with a commitment to an arbitrary position, then report that position to the oracle in subsequent terrain queries. The ZK proof chain ensures each move is consistent with the previous commitment, but if the initial commitment is unconstrained, the entire chain is anchored to a position the participant chose — not one the oracle assigned. The oracle cannot detect this because it cannot open position commitments (it doesn't know the salt after registration).

**Starting position collisions:** The function `g(seed, address)` maps addresses to grid cells. On a 32×32 grid, collisions are possible — two participants may receive the same starting position. This is acceptable: positions are hidden (participants don't know others' positions), and entities move on every global move, so starting cell overlap has no lasting strategic impact. The oracle does not adjust for collisions.

The participant learns their coordinates and grid dimensions (both necessary to generate proofs, and both on-chain). What they don't know is what those coordinates *mean* — the terrain map is hidden, so knowing you're at (23, 47) on a 32×32 grid tells you nothing about where you are relative to entities, tall grass, or other participants. The coordinates are meaningless without context.

### 3.4 Movement Proof (ZK Circuit)

The participant's browser generates a ZK proof attesting:

**Private inputs:** `old_x, old_y, old_salt, new_x, new_y, new_salt, direction`
**Public inputs:** `old_commitment, new_commitment, grid_width, grid_height`

Direction is private — if public, observers could reconstruct relative trajectories and narrow down positions on a small grid. The contract only needs to verify that the two commitments are consistent with a valid 1-step move, not which direction was taken.

**Constraints:**
1. `old_commitment == Poseidon(old_x, old_y, old_salt)`
2. `new_commitment == Poseidon(new_x, new_y, new_salt)`
3. `(new_x, new_y) == (old_x + dx, old_y + dy)` with `x` wrapping modulo `grid_width` and `y` wrapping modulo `grid_height`, where `(dx, dy)` is the direction offset for one of N/S/E/W
4. `direction` is a valid direction (0-3)

**Proving time (benchmarked, M1 Max, noir_js + bb.js UltraHonk):** ~1.1 seconds. The movement circuit is ~1K constraints — lightweight enough for browser WASM proving on any modern device. The oracle can also generate proofs as a fallback (same circuit, same timing) for cases where browser proving is impractical.

The proving wait is accepted as part of the experience — a ritual of computation.

### 3.5 Terrain Oracle

The oracle is a service running on the monolith's hardware (Mac Mini M-series). It holds the landscape seed and tracks all entity positions.

**Query flow:**
1. After a participant's movement proof is verified on-chain, their browser sends a private request to the oracle over HTTPS.
2. The request contains the participant's actual position `(x, y)`, a wallet signature, and a nonce (the participant's current on-chain move count) to prevent replay attacks.
3. The oracle verifies the signature, checks the nonce against on-chain state, computes `terrain(x, y)`, constructs the Merkle inclusion proof, and checks for entity encounters.
4. The oracle responds with:
   - Terrain type (tall grass / clear)
   - Merkle proof (verifiable against the on-chain root)
   - Encounter data (if an entity is at this position AND the cell is tall grass)
   - Density hint (optional, deferred — see §11): a qualitative signal about nearby entity presence

**Encounter check:** The oracle computes entity positions from the seed and entity index. An encounter only triggers if the cell is tall grass.

**Important:** The oracle learns participant positions. This is an accepted limitation. The oracle is designed as a sealed, automated process — no logging of positions, no inspection by the artist. The privacy guarantee is from other participants and the public, not from the oracle.

### 3.6 Entity Positions and Movement

Entity positions are computed deterministically from the landscape seed and entity index at deployment time.

- **Entity position function:** `entity_pos(i) = f(seed, i)` — a deterministic function of the seed and entity index.
- **Position privacy:** Entity positions are hidden from participants and the public. Only the oracle (which holds the seed) can compute them. Participants discover entities through movement and encounters.
- **Pre-mint:** Entities are static at their seed-derived positions. They do not move.
- **Post-mint (owner-controlled, ZK-proved):** After minting, the entity owner moves the entity using ZK proofs — the same architecture as participant movement but with blinded direction commitments for oracle recovery.

**Blinding seed scheme:**
- `blinding_seed = Poseidon(seed, entityId)` — derived by the oracle from the landscape seed. The owner receives it at mint time (included in the attestation response). The oracle can rederive it for any entity.
- `blinding_seed_commitment = Poseidon(blinding_seed)` — stored on-chain at mint time. Verified by the ZK circuit.
- Position salts are deterministic: `salt = Poseidon(blinding_seed, move_count, 0)`. Domain separation via 3-arity Poseidon.
- Direction commitments are blinded: `blinding = Poseidon(blinding_seed, move_count)`, `direction_commitment = Poseidon(direction, blinding)`. Domain separation via 2-arity Poseidon.

**Oracle recovery:** The oracle can statelessly recover any minted entity's current position from chain data. It rederives `blinding_seed` from the landscape seed, then brute-forces 4 directions per `EntityMoved` event to decode the movement history. No persistent state needed.

**Security:** Moving an entity requires both NFT ownership (`msg.sender == ownerOf(entityId)`) AND knowledge of `blinding_seed` (for the ZK proof). If the NFT is transferred, the new owner requests the `blinding_seed` from the oracle (which verifies ownership). The old owner cannot move the entity (ownership check fails). If `blinding_seed` leaks without NFT transfer, the attacker cannot move the entity (ownership check fails).

### 3.7 Deposit & Relay (Surrendered Gas)

Participants can deposit ETH to let the oracle submit movement transactions on their behalf. The participant still chooses direction and generates the ZK proof in their browser — the oracle just pays for the trip.

**Motivation:** The conceptual parallel to surrendered agency is surrendered gas. The participant generates the proof (retains epistemic agency — they choose where to go) but surrenders the economic cost of submission. The oracle mediates between participant intent and on-chain execution.

**Mechanism:**
1. Participant calls `deposit()` with ETH for gas reimbursement. Deposits are additive.
2. Participant's browser generates a ZK movement proof locally (same circuit as manual moves).
3. Browser sends the proof to the oracle via `POST /api/relay`.
4. Oracle submits `relayMove(participant, proof, newCommitment)` on-chain, verifying the proof and updating the position commitment.
5. Gas costs (actual gas used + 50K overhead) are deducted from the participant's deposit and reimbursed to the oracle.
6. When the deposit hits zero during a relay, the contract emits `DepositDepleted`. Further relays revert until the participant tops up.
7. Participants can withdraw unspent deposits via `withdrawDeposit(amount)`.

**Constraints:**
- Manual `move()` and relay are not mutually exclusive — a participant can use both independently. There is no mutex or mode flag.
- The oracle does not decide direction. It receives a browser-generated proof and submits it. The proof is the same circuit used for manual movement.
- Relay returns only the txHash. The client calls POST /api/encounter separately after tx confirmation to check for entity encounters.

**On-chain state:**
```
mapping(address => uint256) public depositBalance;  // per-participant gas deposit
uint256 public totalDeposits;                       // reserved from withdrawable balance
```

**Events:**
```
event Deposited(address indexed participant, uint256 amount, uint256 totalBalance);
event DepositWithdrawn(address indexed participant, uint256 amount);
event DepositDepleted(address indexed participant);
```

---

## 4. II — Entities

### 4.1 Supply and Distribution

- **Total supply:** Fixed at deployment. Recommended range: 16-32 entities.
  - 16 entities: higher individual value, mint price ~0.5 ETH
  - 32 entities: broader participation, mint price ~0.2 ETH
- **Initial placement:** Distributed across the grid, determined by the seed. No terrain constraint on initial placement — entities can start on any cell.
- **Unminted behavior:** Entities are static at their seed-derived positions. They do not move.
- **Post-mint behavior:** The owner controls entity movement via ZK proofs (see §3.6). Each move is proved with the entity movement circuit, using the blinding seed received at mint time. Direction commitments are blinded on-chain — only the oracle or the owner can decode them.
- **Encountering minted entities:** When a participant lands on a minted entity's cell AND the cell is tall grass, they encounter it. They see its encrypted form, can compare its traits via FHE, and learn who owns it. They cannot collect it. This creates a social layer — encounters with other collectors' entities.
- **Exhaustion:** When all entities have been minted, the landscape persists. Movement continues indefinitely.

### 4.2 Encounter Mechanics

An encounter occurs when a participant's position matches an entity's position AND the cell is **tall grass**.

**Flow:**
1. Participant moves to position `(x, y)` (via `move()` or relay).
2. Oracle detects co-location: participant position == entity position AND the cell is tall grass.
3. Oracle generates a ZK encounter proof. The proof attests that the participant's committed position matches an entity position derived from the landscape seed.
   - **Private inputs:** `seed`, `participant_x`, `participant_y`, `participant_salt`
   - **Public inputs:** `seedCommitment`, `entityId`, `positionCommitment` (participant's current on-chain commitment), `gridWidth`, `gridHeight`, `initialPositionCommitment` (entity's starting position commitment for mint), `blindingSeedCommitment` (entity's blinding seed commitment for mint)
4. Oracle returns the encounter proof along with: entity index, entity ciphertext + Merkle proof against `entityTraitMerkleRoot` (see §4.4), `initialPositionCommitment`, `blindingSeedCommitment`, `entityTraitCID`, and `traitMerkleProof`.
5. Participant sees the entity's encrypted form (visual generated from ciphertext). The Merkle proof lets the participant verify the ciphertext is genuine.
6. If the participant owns other entities, they can compare the encountered entity against their own via FHE (§4.5). Their first mint is always blind.
7. Participant decides to mint (for unminted entities) or simply observes (for minted entities).

**No time window:** The encounter proof references the participant's current `positionCommitments[msg.sender]` as a public input. The proof remains valid as long as the participant stays at the encounter position. If the participant moves before minting, the position commitment changes and the proof becomes invalid. There is no timestamp-based deadline or grace period.

**Concurrent encounters:** Multiple participants can be at the same entity's position simultaneously. Each receives their own encounter proof (referencing their own position commitment). First to successfully mint wins. Other participants' proofs remain technically valid but the `mint()` call reverts because the entity is already minted.

**If the participant passes:** The entity remains in the landscape. Other participants can encounter it at its position.

**Encounter broadcasting:** Encounters are broadcast via the oracle's API as a social signal (e.g., "Someone encountered an entity"). This is not on-chain — it is oracle-sourced information for the activity feed.

### 4.3 Trait System

Each entity has a set of encrypted traits. Traits are a mix of categorical and numeric values.

- **Trait count:** 3-7 per entity. Exact count to be determined.
- **Trait types:**
  - **Numeric:** Integer values within a range (e.g., 0-255). Support greater-than / less-than / equality comparisons.
  - **Categorical:** Discrete types (e.g., one of N categories). Support equality comparison only.
- **Trait naming:** Deferred artistic decision. The names should activate notions of visible/invisible, tangible/intangible, known/unknowable — the conceptual territory of the piece.

### 4.4 FHE Encryption

All entity traits are pre-encrypted before deployment using TFHE.

**Key setup:**
- The artist generates an FHE key tuple: `(secret_key, cloud_key)` using the TFHE C library's gate bootstrapping parameters at lambda=80.
- The `secret_key` is retained by the oracle (the monolith). It is required to decrypt comparison results (see §4.5). The oracle never uses it to reveal raw trait values — only to decrypt the boolean output of homomorphic comparisons. The key may be escrowed for eventual verifiability: revealed after all entities are minted, allowing retroactive verification of every comparison the oracle ever attested to.
- The `cloud_key` (evaluation key, ~78 MB) is published on IPFS (referenced by content hash on-chain or in the web client). It enables anyone to compute on ciphertexts without decrypting. The browser must download the cloud key before performing comparisons; this download time (~78 MB) should be accounted for in the UX.

**Pre-encryption:**
- Before deployment, the artist generates trait values for all N entities (deterministic from seed + entity index).
- Each trait value is encrypted individually using TFHE: `encrypted_trait = TFHE.encrypt(trait_value, public_key)`.
- Each entity's encrypted trait set is stored on IPFS. The content hash (CID) per entity becomes a leaf in the `entityTraitMerkleRoot` (leaves ordered by entity index).

**Ciphertext lifecycle:**
- **At deployment:** `entityTraitMerkleRoot` is stored on-chain. Ciphertexts are held by the oracle. No entity visuals are publicly derivable.
- **At encounter:** The oracle serves the entity's ciphertext + Merkle proof against `entityTraitMerkleRoot`. The participant verifies the proof, confirming the ciphertext is genuine for that entity index. The visual is generated client-side from the ciphertext.
- **At mint:** The `entityTraitCID` is stored on-chain (verified against `entityTraitMerkleRoot` via Merkle proof in the `mint()` function). The ciphertext becomes permanently, publicly retrievable. The entity's visual is now derivable by anyone.
- **Post-mint encounters:** When someone encounters a minted entity, the ciphertext is already public on the token — no oracle needed to serve it.

**Ciphertext size:** Each 8-bit TFHE ciphertext is 8 LweSamples at 2,016 bytes each = ~15.8 KB per trait. For 7 traits per entity: ~110 KB per entity. For 32 entities: ~3.5 MB total. Stored on IPFS with on-chain content hashes (Merkle root). On-chain storage of the full ciphertexts is infeasible — IPFS is the only practical option.

### 4.5 Comparison System

Anyone can compare any two minted entities on any trait. There is no ownership gate — comparison is open. The computational weight of FHE is the friction: each comparison requires real cryptographic work in the browser. The official site provides the tool but does not aggregate results into rankings or tables. Knowledge accumulates locally, gradually, through computation.

**How it works:**
1. User selects two minted entities and a trait on the web dashboard.
2. The browser downloads the encrypted trait ciphertexts (from IPFS, cached) and the cloud key (one-time download, ~78 MB, cached).
3. The browser computes two homomorphic operations using the TFHE WASM module: `enc_gt = compareGreaterThan(entity_a.trait_k, entity_b.trait_k)` and `enc_eq = compareEqual(entity_a.trait_k, entity_b.trait_k)`. Each result is an **encrypted boolean** — not plaintext. The TFHE gate bootstrapping scheme does not provide a single three-valued comparison; two operations are needed (GT: 24 boolean gates, EQ: 15 boolean gates).
4. The browser sends `enc_gt`, `enc_eq`, plus `entityA`, `entityB`, and `traitIndex` to the oracle. No authentication required.
5. The oracle decrypts both results using the secret key, derives the comparison outcome (if `enc_gt` decrypts to true → `>`, if `enc_eq` decrypts to true → `=`, otherwise → `<`), generates a ZK decryption proof (Noir circuit proving correct TFHE boolean decryption under a Poseidon-committed secret key), and returns `{ result, proof, claimedGt, claimedEq }`. Proofs are cached to disk per comparison triple `(entityA, entityB, traitIndex)`.
6. The browser verifies the decryption proof locally using bb.js UltraHonk verification against the on-chain `decryptionKeyCommitment`. Verified results are marked in localStorage.

**Progressive reveal:**
The dashboard provides a "reveal all" mode that systematically runs through all pairwise comparisons. The browser grinds through FHE operations one by one, and each result fills in a cell in a comparison matrix. The ordering emerges slowly — visible as it materializes, cell by cell. This is the intended experience: watching encrypted knowledge become legible through computation. FHE parameters should be tuned so each comparison takes noticeable time (target: several seconds per comparison on a fast device). With 32 entities and 7 traits, the full matrix is 3,472 comparisons — hours of continuous computation.

**Local persistence:**
Comparison results are stored in browser `localStorage`. Results accumulate across sessions — returning to the site picks up where you left off. Each result includes a `verified` flag indicating whether the decryption proof was successfully verified. The data is exportable (JSON). Savvy users can share their accumulated comparison maps. There is no on-chain comparison table — the knowledge lives in browsers, not on the blockchain.

**Encounter preview:** During an active encounter with an unminted entity, the participant can compare it against any minted entity (the oracle serves the unminted entity's ciphertext during the encounter — see §4.2). A participant's first mint is always blind (no minted entities exist to compare against yet). Subsequent encounters benefit from accumulated comparison knowledge.

**Oracle honesty guarantees:**
- **ZK-verified decryption:** Each comparison result includes a ZK proof that the oracle correctly decrypted the TFHE ciphertext under a key committed on-chain (`decryptionKeyCommitment`). The browser verifies this proof locally — no trust in the oracle's decryption is required.
- **Consistency:** FHE comparison is deterministic. Same input ciphertexts → same encrypted result → must produce the same plaintext. If the oracle returns contradictory results for the same encrypted output, it is provably dishonest.
- **Transitivity:** If a user accumulates enough comparisons to find A > B, B > C, but C > A, the oracle is provably lying.
- **Eventual verifiability:** If the secret key is revealed after exhaustion (see §4.4), every comparison can be recomputed and verified by anyone.

**Properties:**
- **Open:** No ownership or authentication required. Anyone can compare any two minted entities.
- **Verifiable:** Each result includes a ZK proof of correct decryption, verified locally in the browser.
- **Computationally weighted:** Each comparison takes real time (FHE in browser). The full ordering is extractable but expensive.
- **Locally accumulated:** Results live in the browser, not on-chain. The official site does not aggregate or rank.
- **Comparisons require the oracle to be online** (for decryption and proof generation).

**Performance (benchmarked, M1 Max, WASM):**
- Cloud key download: one-time, ~78 MB. Cached aggressively by the browser. Load time: ~272ms once cached.
- Client-side GT comparison (24 boolean gates): ~1.6s (~68ms/gate).
- Client-side EQ comparison (15 boolean gates): ~1.0s (~68ms/gate).
- Total per-trait comparison (GT + EQ): ~2.7s.
- Oracle decryption + proof generation: ~1-2s per comparison (cached after first generation per comparison triple).
- Oracle decryption round-trip (network): <1s (network latency dominant).
- Full matrix (32 entities × 7 traits): ~3,472 comparisons, ~2.6 hours of continuous compute.

### 4.6 Entity Visual Representation

Each entity has a visual identity derived from its encrypted ciphertext data.

- **Aesthetic:** Abstract, shrouded. Black and white with possible color tinge. The visual should feel opaque, like looking at something through frosted glass.
- **Generation:** The ciphertext bytes of the entity's encrypted traits are used as input to a deterministic visual generation function. Different ciphertexts produce different visuals. The visual IS the encrypted data, rendered as form.
- **Properties:** Each entity looks distinct (different ciphertexts → different visuals). The visual does not reveal trait values — it is a faithful rendering of the encryption, not the plaintext.

### 4.7 Token Standard

- **Standard:** ERC-721 (solady implementation).
- **On-chain data:** Token ID, owner, minting move counter, encrypted trait CID (content hash pointing to ciphertext on IPFS).
- **Metadata:** Delegated to a separate `TallGrassMetadata` contract (address stored as `metadataContract`, set by owner). The metadata contract:
  - Stores entity ciphertexts on-chain via SSTORE2 (chunked for large data). The `ciphertextHash` is exposed for verification.
  - Provides per-token and shared descriptions (SSTORE2-backed).
  - Supports animation URLs per token (for entity visuals).
  - Generates `tokenURI()` with JSON metadata including the ciphertext hash as an attribute.
  - Generates `contractURI()` per ERC-7572 (collection-level metadata with name, symbol, description, image, external link).
  - The collection image is stored on-chain via chunked SSTORE2.
  - An `EDITOR` role (via solady `OwnableRoles`) allows authorized addresses to update metadata without being the owner.
- **Standards supported:**
  - ERC-4906: metadata update events (`MetadataUpdate`, `BatchMetadataUpdate`). Emitted when ciphertexts, descriptions, or animation URLs change.
  - ERC-7572: contract-level metadata URI (`ContractURIUpdated`).

**Stretch goal:** Privacy pool for anonymous transfers (Tornado Cash-inspired). Allows owners to deposit entities into a pool and withdraw with different credentials, breaking the ownership link. Not in scope for the April prototype.

---

## 5. III — Monolith

### 5.1 Physical Form

The monolith is a double-sided sculptural object:

- **Structure:** Two 55" Samsung Frame screens mounted back-to-back on a central mount, with side paneling to create a monolithic form.
- **Layers (per side):** Screen → frosted diffusion layer → metal grate (~2-3 cm square grid, like European balcony/stair grating) → metal frame.
- **Effect:** Content is visible through the grate and frosted layer, but illegible. The physical materials perform the concept — hidden from view through physical obstruction. The grate's grid echoes the landscape grid.
- **Editions:** 1 + 1 AP (one for exhibition/sale, one for artist's studio).

### 5.2 Visual System

The monolith displays a generative visualization driven by on-chain state and oracle data.

- **Technology:** WebGL / Three.js / GLSL shaders, running in a browser on the internal Mac Mini.
- **Input data:** On-chain events (moves, mints, entity direction changes, move counter) and oracle-sourced data (entity positions, revealed terrain cells, encounter events).
- **Visual language:** The monolith renders a pixel-grid representation of the landscape with two layered systems:
  1. **Progressive terrain reveal:** As participants discover cells, the terrain map gradually emerges on the monolith. Tall grass patches become visible over time. The piece begins as a dark/uniform field and the landscape structure slowly materializes through collective exploration.
  2. **Kinetic event layer:** Encounters, comparisons, and moves are rendered as drifting axis-aligned forms — encounter slabs derived from per-entity TFHE bytes, comparison pairs from pair commitments, and a move sweep. Each form has a bell-curve lifecycle (fade in, peak, fade out). The field is steady churn, not accumulation: density stays roughly constant and is modulated by recent activity.
- **Temporal model:** Slow, deliberate animation. Visual state changes are smoothed over long timescales (~15 minutes per move transition). A move doesn't cause an instant visual jump — it produces a gradual drift. This prevents observers from correlating real-time on-chain events to specific visual changes, making it impossible to deduce who is where. The monolith shows the cumulative shape of participation, not its real-time detail.
- **Update model:** Autonomous with chain influence. The visual runs continuously on its own generative logic. On-chain events perturb or redirect the visual evolution. Activity modulates the system; silence lets it drift. The monolith never goes fully dark or static.
- **Aesthetic:** Monochromatic or near-monochromatic, organic, moving. Through the frosted layer and metal grate, the terrain map and traces become an abstract field of light — recognizable as structured but impossible to decode at the cell level.

### 5.3 Oracle Integration

The Mac Mini running the monolith's visuals also runs the oracle service. The monolith is simultaneously:

1. A sculpture (visual output through grate + frosted glass)
2. An oracle (terrain reveals, encounter detection)
3. A chain monitor (reads on-chain events to drive visuals)

This makes the physical artwork the functional heart of the system — the container of the secret, the mediator of interaction, and the visual expression of the hidden state.

### 5.4 Hardware

- **Computer:** Mac Mini with M-series chip (M2 or M4).
- **Connectivity:** Ethernet (preferred) or WiFi. Needs stable internet for Ethereum RPC and oracle API.
- **Display output:** HDMI to one screen, Thunderbolt/DisplayPort (via adapter) to the second screen.
- **Software:** Browser (fullscreen) for WebGL visuals + background oracle/prover service.
- **Power:** Standard AC. UPS recommended for exhibition reliability.

---

## 6. Web Interface

### 6.1 Participant Dashboard

The dashboard is the participant's primary interaction surface. It includes:

- **Movement controls:** Four directional buttons (N/S/E/W). Adequate touch targets for both desktop and mobile.
- **Proof status:** Visual indicator while the ZK proof is being generated. The wait (5-120s depending on device) is presented as part of the experience, not hidden.
- **Terrain feedback:** After each move, the participant sees the terrain type at their new position (tall grass / clear ground). Density hints are optional (see §11).
- **Encounter interface:** When an encounter occurs, the entity's encrypted visual form is displayed. Comparison against any minted entity is available inline (first mint is always blind — no minted entities exist yet). Mint button with price (for unminted entities). Owner info (for minted entities).
- **Collection:** The participant's owned entities, displayed as their ciphertext-derived visuals.
- **FHE comparison tool:** Select any two minted entities and a trait. The browser computes the homomorphic comparison (FHE in WASM), sends encrypted result to oracle for decryption, displays the outcome. No ownership required. Includes a "reveal all" mode that systematically runs through all pairwise comparisons — the browser grinds through FHE operations and a comparison matrix fills in cell by cell as results arrive. Results are stored in `localStorage` and persist across sessions. Exportable as JSON.
- **Global view:** Publicly available information about the piece:
  - Total moves made (global move counter)
  - Entities minted / total supply
  - Activity feed: anonymized event stream ("Someone moved." "An entity was collected." "Someone encountered an entity."). Events sourced from on-chain data and oracle API. No details about who or where.
  - **No terrain map.** The collective exploration is expressed only through the monolith (see §5.2).

### 6.2 Wallet Integration

- **Library:** wagmi + viem (handrolled connect UI). Reown (WalletConnect) as backup connector.
- **Required for:** Movement (gas), minting (gas + mint fee), entity ownership.
- **Onboarding:** Standard wallet connect flow. The piece targets participants who already have wallets and ETH. For gallery visitors without wallets, the artist provides white-glove assistance with prepared wallets.

### 6.3 Proof Generation

- **Runtime:** Noir WASM compiled circuit (noir_js + bb.js, UltraHonk), running in the participant's browser by default. Oracle-side proving available as fallback.
- **Circuit:** Movement validity proof (see §3.4). ~1K constraints, ~146 KB compiled artifact.
- **Performance:** ~1.1 seconds (benchmarked, M1 Max). The movement circuit is lightweight — browser proving is fast on modern devices.
- **UX during proving:** A visual/animated state that frames the wait as computation — not a loading spinner, but a representation of the proof being generated. The cryptographic work is made visible.

### 6.4 Oracle Communication

- **Protocol:** HTTPS REST API.
- **Endpoint:** Served by the monolith's Mac Mini.
- **Privacy:** Communication is encrypted in transit (TLS). The oracle processes queries and does not persist participant positions.

**API endpoints:**

| Endpoint | Description |
|----------|-------------|
| `POST /api/register` | Register participant — oracle returns starting position + signs commitment + walkSecret |
| `POST /api/relay` | Relay browser-generated movement proof — oracle submits tx, returns txHash |
| `POST /api/encounter` | Check encounter at current position after manual move |
| `POST /api/compare` | FHE comparison — oracle decrypts encrypted GT/EQ results and returns ZK decryption proof |
| `GET /api/state?address=` | Participant state (position, moveCount, walkSecret) |
| `GET /api/contract` | Contract address + ABI + decryptionKeyCommitment |
| `POST /api/entity/:id/recover` | Recover entity position and blinding seed (owner-signed) |

---

## 7. Smart Contract

### 7.1 State

```solidity
// Core state (immutables, set at deployment)
bytes32 public seedCommitment;           // hash(seed) — committed at deployment
bytes32 public terrainMerkleRoot;        // Merkle root of terrain grid — set at deployment
bytes32 public entityTraitMerkleRoot;    // Merkle root of all entity ciphertexts — set at deployment
uint256 public gridWidth;                // Grid width — public input to ZK verifiers
uint256 public gridHeight;               // Grid height — public input to ZK verifiers (may differ from width)
uint256 public totalSupply;              // Total entity supply (fixed)
uint256 public mintPrice;                // ETH required to mint an entity
IVerifier public movementVerifier;       // ZK verifier contract reference (participant movement)
IVerifier public entityMovementVerifier; // ZK verifier contract reference (entity movement)
IVerifier public encounterVerifier;      // ZK verifier contract reference (encounter co-location)
bytes32 public immutable decryptionKeyCommitment;  // Poseidon(packed_lwe_key) — committed at deployment

// Core state (mutable)
bytes32 public entityMerkleRoot;         // Merkle root of static entity positions — set at deployment
uint256 public moveCounter;              // Global move counter (incremented by participant moves)
uint256 public totalMinted;              // Entities minted so far

// Participant state
mapping(address => bytes32) public positionCommitments;  // Current position commitment per participant
mapping(address => uint256) public participantMoveCount; // Personal move count (for salt derivation)
mapping(address => bool) public isParticipant;           // Has this address entered the landscape

// Deposit state (gas relay — see §3.7)
mapping(address => uint256) public depositBalance;       // Per-participant gas deposit
uint256 public totalDeposits;                            // Sum of all deposits, reserved from withdrawable balance

// Entity state
mapping(uint256 => bool) public entityMinted;            // Whether entity has been minted
mapping(uint256 => bytes32) public entityTraitCID;       // IPFS CID of encrypted traits — set at mint time (empty before mint)
mapping(uint256 => bytes32) public entityPositionCommitments;   // Current position commitment per entity
mapping(uint256 => bytes32) public entityBlindingSeedCommitments; // hash_1(blinding_seed) — set at mint
mapping(uint256 => uint256) public entityMoveCount;      // Per-entity move counter (for salt/blinding derivation)

// Access control: solady OwnableRoles with EDITOR (1 << 0) and ORACLE (1 << 1) roles
// EDITOR: metadata editing privileges
// ORACLE: proof relay, encounter detection, withdrawal

// Metadata delegation
address public metadataContract;                          // TallGrassMetadata contract (ERC-4906, ERC-7572)

// NFT (ERC-721)
// Standard ERC-721 state for minted entities (solady ERC721 + OwnableRoles)
```

### 7.2 Key Functions

```
constructor(seedCommitment, terrainMerkleRoot, entityTraitMerkleRoot, entityMerkleRoot, gridWidth, gridHeight, totalSupply, mintPrice, movementVerifier, entityMovementVerifier, encounterVerifier, decryptionKeyCommitment, owner)
  → Deploy with initial state. 13 parameters. Immutable contract — this is the constructor, not a proxy initializer.
  → Uses solady OwnableRoles for ownership + role-based access control (EDITOR, ORACLE roles).

register(initialPositionCommitment, oracleSignature)
  → Register as a participant. The oracle computes the starting position, derives the commitment,
    and signs keccak256(msg.sender, initialPositionCommitment). Contract verifies the oracle
    signature (recovered signer must have ORACLE role), stores the commitment, and marks the
    address as a participant. Reverts if already registered.

move(proof, newPositionCommitment)
  → Verify ZK movement proof against public inputs (positionCommitments[msg.sender], newPositionCommitment, gridWidth, gridHeight).
  → Direction is private (not passed to the contract — see §3.4). The contract reads old_commitment, gridWidth, gridHeight from storage.
  → Update participant's position commitment. Increment moveCounter and participantMoveCount[msg.sender].

deposit()
  → Payable. Adds msg.value to depositBalance[msg.sender] and totalDeposits.
  → Requires: registered participant.
  → Emits Deposited.

withdrawDeposit(amount)
  → Withdraws specified amount from depositBalance[msg.sender].
  → Reverts if insufficient balance.
  → Emits DepositWithdrawn.

relayMove(participant, proof, newPositionCommitment)
  → onlyRoles(ORACLE). Relays a browser-generated movement proof on behalf of a participant.
  → Verifies ZK movement proof (same circuit as manual move).
  → Updates position commitment, increments moveCounter and participantMoveCount.
  → Reimburses oracle from participant's deposit (gas used + GAS_OVERHEAD of 50K).
  → If deposit exhausted after reimbursement: emits DepositDepleted.

mint(entityId, encounterProof, entityTraitCID, initialPositionCommitment, blindingSeedCommitment, traitMerkleProof)
  → Payable. Participant mints an encountered entity. 6 parameters. Requires:
    - ZK encounter proof verifies against 7 public inputs:
      [seedCommitment, entityId, positionCommitments[msg.sender], gridWidth, gridHeight,
       initialPositionCommitment, blindingSeedCommitment]
    - Entity is not already minted
    - traitMerkleProof verifies entityTraitCID against entityTraitMerkleRoot for this entityId
    - msg.value >= mintPrice
  → Stores entityTraitCID, entityPositionCommitments[entityId] = initialPositionCommitment,
    entityBlindingSeedCommitments[entityId] = blindingSeedCommitment.
  → Sets entityMoveCount[entityId] = 0. Marks entity as minted. Transfers ERC-721 to participant.

moveEntity(entityId, proof, newPositionCommitment, directionCommitment)
  → Owner moves a minted entity with a ZK proof. Requires:
    - Entity is minted
    - msg.sender == ownerOf(entityId)
    - ZK proof verifies against 7 public inputs: old_commitment, new_commitment, grid_width, grid_height, direction_commitment, blinding_seed_commitment, entity_move_count
  → Updates entityPositionCommitments[entityId], increments entityMoveCount[entityId] and global moveCounter.
  → Emits EntityMoved(entityId, directionCommitment, moveCounter).

setMetadataContract(address)
  → Owner-only. Sets the TallGrassMetadata contract address.
  → Emits BatchMetadataUpdate and ContractURIUpdated.

withdraw()
  → onlyRoles(ORACLE). Withdraws accumulated ETH (mint fees), respecting totalDeposits reservation.
  → Withdrawable amount: address(this).balance - totalDeposits.

```

### 7.3 Events

```
event Registered(address indexed participant, bytes32 positionCommitment);
event Moved(address indexed participant, bytes32 newCommitment, uint256 moveCounter);
event EntityMoved(uint256 indexed entityId, bytes32 directionCommitment, uint256 moveCounter);
event Minted(address indexed participant, uint256 indexed entityId, uint256 moveCounter, bytes32 entityTraitCID);
event Deposited(address indexed participant, uint256 amount, uint256 totalBalance);
event DepositWithdrawn(address indexed participant, uint256 amount);
event DepositDepleted(address indexed participant);

// ERC-4906
event MetadataUpdate(uint256 _tokenId);
event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

// ERC-7572
event ContractURIUpdated();
```

Terrain reveals happen off-chain via the oracle. No on-chain terrain function — this avoids leaking participant positions through plaintext `(x, y)` coordinates. The oracle tracks revealed cells internally and serves the collective reveal state to the monolith's visual system.

Encounter events are broadcast via the oracle's API, not on-chain. Only minting appears on-chain.

### 7.4 Deployment

- Deploy to Ethereum Mainnet for production.
- Deploy to Sepolia testnet for the April 20 prototype.
- Contract is not upgradeable — deployed as immutable. The piece is a permanent, autonomous program. If bugs are found pre-launch, redeploy.

---

## 8. Infrastructure

### 8.1 Oracle / Monolith Server

The Mac Mini inside the monolith runs:

1. **Oracle API** — HTTPS server for terrain queries, encounter detection, FHE comparison decryption, and entity position recovery.
2. **Chain monitor** — Watches for on-chain events (moves, mints, entity direction changes) via Ethereum RPC.
3. **Entity recovery service** — Statelessly recovers any minted entity's current position from chain data by rederiving `blinding_seed = Poseidon(seed, entityId)` and brute-forcing 4 directions per `EntityMoved` event. No persistent entity state needed.
4. **Visual renderer** — WebGL/shader monolith display in a fullscreen browser.

**Deployment:**
- During exhibition (May 1-5): runs inside the monolith at the gallery.
- Post-exhibition: the AP monolith runs at the artist's studio indefinitely, serving the oracle function.

**Reliability:** If the oracle goes offline:
- Existing participants can still submit movement proofs (client-side proving is independent). Positions update on-chain, but participants receive no terrain feedback or encounter results until the oracle returns.
- Owners can still move their minted entities (ZK proofs are client-side, no oracle needed for proving). However, new owners cannot obtain their `blinding_seed` without the oracle.
- New participants cannot register (starting positions require the oracle).
- The monolith visual freezes or enters a dormant state.
The oracle is a hard dependency for the full experience. This is accepted — the monolith IS the piece's infrastructure.

### 8.2 RPC / Chain Connectivity

- **Provider:** Alchemy, Infura, or self-hosted node.
- **Requirements:** Reliable WebSocket connection for event monitoring. Standard JSON-RPC for transaction submission.
- **Fallback:** Multiple RPC providers configured for redundancy.

---

## 9. Timeline

### Phase 1: Foundation (Feb 12 – Mar 9) — 4 weeks
- Noir circuit: participant movement proof (browser WASM)
- Noir circuit: unminted entity movement proof (server-side)
- Solidity contract: core state, movement verification, entity management, minting
- FHE: trait generation and encryption pipeline
- Oracle: basic API for terrain queries and encounter detection

### Phase 2: Integration (Mar 10 – Mar 30) — 3 weeks
- Web dashboard: movement interface, wallet integration, proof generation
- Oracle: encounter detection, encounter proof generation, minted entity tracking
- FHE: browser-based comparison (TFHE C WASM via emscripten)
- Monolith: initial shader/visual system with chain data input
- Contract: testnet deployment, end-to-end flow testing

### Phase 3: Polish & Documentation (Mar 31 – Apr 20) — 3 weeks
- Full system on Sepolia testnet
- Entity visual generation from ciphertexts
- Dashboard: collection view, entity movement controls, comparison tool, global activity feed
- Monolith visual refinement
- Documentation for jury submission
- Performance optimization (mobile proving, gas optimization)

### Phase 4: Production (Apr 21 – Apr 30)
- Mainnet contract deployment
- Physical monolith fabrication (metal frame, grate, frosted layer)
- Hardware assembly and testing
- Berlin setup (Apr 28-30)

### Phase 5: Exhibition (May 1 – May 5)
- Opening May 1
- Live monitoring and support
- Teardown May 5-6

### Post-Exhibition
- AP monolith operates at artist's studio
- Piece runs until all entities are minted
- Post-exhaustion: owners continue moving entities, oracle proving stops, monolith persists

---

## 10. Parameters (Configurable)

These values are to be finalized during implementation:

| Parameter | Range | Notes |
|-----------|-------|-------|
| Grid dimensions | width × height, arbitrary | Non-square grids allowed. Affects encounter density, terrain Merkle tree size (width × height leaves) |
| Entity count | 16-32 | Affects scarcity, pricing, proof complexity |
| Mint price | 0.2-0.5 ETH | Inversely correlated with entity count |
| Traits per entity | 3-7 | Affects FHE ciphertext size, comparison richness |
| Tall grass patch count | TBD | Number of rectangular patches, targeting ~50% coverage |
| Density hint radius | TBD | Radius for "nearby entity" hint (if included) |

---

## 11. Open Questions

### Artistic
- **Trait naming and theming.** The trait names should activate notions of visible/invisible, tangible/intangible, known/unknowable. This is a core artistic decision to be made during development.
- **Entity visual generation algorithm.** The approach (ciphertext → visual) is decided; the specific mapping function needs design.
- **Monolith shader design.** The heatmap/trace visual language with progressive terrain reveal needs iteration. The temporal smoothing (~15 min transitions), trace decay curves, and the interplay between terrain structure and movement heat all need development.
- **Density hints.** Optional. The specific language and feel ("the grass rustles" vs. numeric signal) is undecided. May be cut if it doesn't serve the experience. To be evaluated during development.

### Technical
- **FHE library — RESOLVED.** Using the original TFHE C library v1.1 (Apache 2.0), compiled to WASM via emscripten. Patent-free. See `context/research/zama-patents.md` for the analysis that motivated this choice. Lambda=80 security parameter (acceptable for art context). Performance benchmarked and acceptable (~2.7s per trait comparison in WASM).
- **FHE secret key escrow.** The secret key is retained by the oracle for comparison decryption. ZK decryption proofs now provide real-time verifiability — each comparison is cryptographically proven correct as it happens, so the oracle's honesty is enforced per comparison without waiting. Open question: should the key still be revealed after exhaustion (all entities minted) for retroactive verification by third parties? This would let anyone independently recompute every comparison without relying on the ZK proofs. Conceptually powerful (the hidden becomes knowable at the end) but irreversible.
- **Mobile proving performance — LIKELY RESOLVED.** Movement circuit is ~1K constraints, benchmarked at ~1.1s on M1 Max via noir_js. Likely fast on mobile too given the small circuit size. Needs confirmation on actual phone hardware. Oracle relay available as fallback.
- **Oracle endpoint after exhibition.** The AP monolith runs at the studio. Needs a stable public IP or domain, and a plan for uptime (dynamic DNS, monitoring, auto-restart).
- **Entity movement proof batching limits.** How many steps can be batched in a single proof before proving time becomes unacceptable? Needs benchmarking.

### Stretch Goals
- **Trustless terrain oracle** via PIR or FHE-based lookup.
- **Privacy pool** for anonymous entity transfers.
- **TEE oracle** for hardware-enforced privacy (see §2.1).

---

## 12. Artistic Intent

The piece explores privacy as a generative material, not a defensive posture. Participants navigate in darkness — their positions, the terrain, the entities, all hidden from view. What they can do: move, encounter, collect, compare. What they cannot do: see, know, map, predict.

The zero-knowledge proofs ensure that the system is verifiable but opaque. The FHE encryption ensures that entity traits are permanently unknowable — only relative comparison is possible, never absolute knowledge. The monolith renders the hidden state as physical form — visible but illegible, present but unreadable.

The act of minting transforms an entity: from hidden and autonomous (drifting through the landscape, position known only to the oracle) to revealed in movement and owner-controlled (direction visible, absolute position still hidden). Collection doesn't fully expose — it shifts the boundary of what is known.

The intended experience oscillates between contemplative drift (moving through hidden space, discovering terrain cell by cell) and collective ritual (every move shifts the landscape for everyone, the monolith responds to collective activity, the activity feed pulses with anonymous movement).

The piece runs until exhausted — and then keeps running. There is no timer, no deadline. When all entities are collected, autonomous movement stops but the landscape persists. Owners still walk their entities through the space. The monolith still glows with accumulated traces. It becomes a space where everything has been claimed but nothing has stopped.
