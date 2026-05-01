# Technical Specification Document

<video poster="/exhibit-poster.jpg" autoplay loop muted playsinline preload="metadata">
  <source src="/exhibit-video.mp4" type="video/mp4">
</video>

A digital artwork by 0xfff. Visitors walk through an encrypted landscape on Ethereum: positions are kept hidden by zero-knowledge proofs, and entities they collect are compared by homomorphic encryption. Funded by The Pixel Prize, JUST Open Source Stiftung.

This document specifies the technical architecture and implementation of the work as delivered for the grantee exhibition (May 1-5, 2026, Trust Berlin) and outlines the scope expansion for the grand prize deliverable.

---

## 1. Scope and timeline boundary

Two scopes are kept strictly separate throughout this document:

| Scope | Components |
|-------|------------|
| Grantee exhibition (delivered, May 1-5, 2026) | I — Landscape, II — Entities, III — Monolith as a screen-based study (two displays, fullscreen WebGL visual) |
| Grand prize (proposed, if selected) | Mechanical sculpture (frosted-glass body, moving parts), TEE-hardened oracle, trustless terrain reveals (PIR / FHE lookup) |

Anything labelled GRAND PRIZE SCOPE below is not part of the May 1 delivery. Mechanical motion, hardware-enforced privacy, and oracle-less terrain queries are deferred to the grand prize deliverable.

---

## 2. Blockchain integration

The work uses Ethereum as a substrate for verifiable, hidden state — not as a marketplace. The chain is the only publicly auditable surface where the artwork's integrity can be checked, and it is used only for things that *must* be public to be meaningful: commitments, proof verifications, and ownership.

The blockchain is not a wrapper around an off-chain piece. It is the verification layer for cryptographic claims that participants and the artist make about a hidden world.

### 2.1 What is on-chain

1. **Commitment to a hidden landscape.** A Poseidon hash of the landscape seed ([`seedCommitment`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/TallGrass.sol#L63)) is fixed at deployment. The landscape is a deterministic function of the seed, computed inside every movement and encounter proof: the Noir circuits take the seed as a private witness and `seedCommitment` as a public input, re-derive the terrain, and refuse to verify any move that the derived terrain would forbid. Because the seed is committed and the derivation lives in immutable verifier bytecode, the artist cannot retroactively edit the map without invalidating every prior proof.

2. **ZK-verified participant movement.** Every move is a Noir-generated zero-knowledge proof, generated in the participant's browser, verified on-chain by a Solidity verifier (Honk verifier emitted by `bb`). The proof attests:
   - the prior on-chain [`positionCommitment`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/TallGrass.sol#L87) opens to some `(x, y, salt)`,
   - the new commitment opens to `(x', y', salt')`,
   - `(x', y')` is exactly one cardinal step from `(x, y)` with toroidal wrapping on the public [`gridWidth`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/TallGrass.sol#L66)/[`gridHeight`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/TallGrass.sol#L67),
   - direction is private (4-direction movement leaks 2 bits of information per move; keeping it private prevents reconstructing relative trajectories on small grids).
   
   The contract never sees positions. It only sees that the transition between two opaque commitments is valid.

3. **Position commitments via Poseidon.** Per-participant `Poseidon(x, y, salt)` commitments live on-chain as 32-byte hashes. Salts are derived deterministically from a per-participant `walkSecret` and a per-move counter, which keeps the commitment indistinguishable across moves while remaining recoverable by the participant.

4. **FHE-encrypted entity traits with merkle commitments.** Entity ciphertexts (TFHE, ~110 KB per entity for 7 traits) are committed on-chain at deployment as an [`entityTraitMerkleRoot`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/TallGrass.sol#L64) with leaves ordered by entity index. Pre-mint, ciphertexts are served from the project's oracle backend for encounter and comparison flows; the contract verifies a Merkle proof of the served ciphertext's hash against the on-chain root inside the `mint` transaction. On mint, the relevant ciphertext is also written to the token's metadata contract via chunked `SSTORE2` so the encrypted traits live permanently on-chain alongside the NFT. The traits themselves are *permanently encrypted* — no decryption flow exists. Only homomorphic comparison is possible.

5. **On-chain encounter verification.** Minting requires a Noir proof (the [`encounter`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/tree/main/circuits/encounter) circuit) that the participant's current `positionCommitment` co-locates with an entity position derived from the committed seed. Public inputs include `seedCommitment`, `entityId`, `positionCommitments[msg.sender]`, `gridWidth`, `gridHeight`, the entity's `initialPositionCommitment`, and [`blindingSeedCommitment`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/TallGrass.sol#L94). The contract verifies the proof, the Merkle inclusion of the trait hash, and the mint payment in a single atomic transaction. Encounters cannot be faked: a participant has to actually be at the entity's cell to mint.

6. **ZK proofs of correct FHE decryption.** When the oracle decrypts the boolean output of a homomorphic comparison, it emits a Noir proof attesting that the decryption was performed under the secret key whose Poseidon commitment ([`decryptionKeyCommitment`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/TallGrass.sol#L72)) was fixed at deployment. The browser verifies this proof locally against the on-chain commitment. The oracle's honesty is enforced per comparison.

7. **Owner-controlled entity movement after mint.** Entities that have been minted move under their owner's control via a separate [Noir circuit](https://github.com/0xfffxfff/tall-grass-hidden-from-view/tree/main/circuits/entity_movement). Direction commitments are blinded with a per-entity `blinding_seed = Poseidon(seed, entityId)`; only the owner and the oracle can decode them. The contract emits [`EntityMoved(entityId, directionCommitment, moveCounter)`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/TallGrass.sol#L37) events that drive the monolith's visual without leaking owner intent.

The contract is not upgradeable — there is no proxy and no admin path that can replace circuit verifiers, the seed commitment, the entity trait root, the decryption-key commitment, the trait moduli commitment, the grid dimensions, or the total supply. Three owner-only mutators exist: [`setMintPrice`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/TallGrass.sol#L215) (retained so a long-running deployment can absorb ETH/EUR drift), [`setMetadataContract`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/TallGrass.sol#L209) (a separate address that can be swapped to fix display issues or evolve the rendering surface), and [`sEP`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/TallGrass.sol#L220) (assigns a per-entity program address before that entity is minted; locked once minted). None of these can alter the cryptographic substrate: the on-chain `entityTraitMerkleRoot` binds each entity to its specific ciphertext hash at deployment, so a replaced metadata contract cannot change what an entity's encrypted traits are — only how they are presented.

### 2.2 Why this is not "basic NFT functionality"

The token (ERC-721, solady implementation) is incidental — the load-bearing integration is the verifier set:

- A [movement verifier contract](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/MovementVerifier.sol) for participant moves.
- A [movement verifier for entity moves](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/EntityMovementVerifier.sol) (post-mint, blinded direction).
- An [encounter verifier](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/EncounterVerifier.sol) that proves seed-derived co-location.
- A Poseidon commitment over the FHE secret key, paired with a [decryption-correctness verifier](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/contracts/src/DecryptionVerifier.sol) consumed client-side.

These verifiers turn the chain into a sealed witness for cryptographic facts about a world that is not on the chain.

### 2.3 Artistic relevance of the chain

The chain is not chosen for permanence per se — it is chosen because it is the only context in which an autonomous, public program can hold *commitments to hidden state* and still be auditable. The cryptographic guarantee — that the artist cannot alter the terrain after deployment, cannot fake encounters, cannot manipulate the entity set — is what allows the work to assert privacy as a generative material rather than a defensive posture. Without on-chain commitments, "the landscape is hidden" would be an unverifiable claim. With them, it is a fact.

### 2.4 Positioning relative to verifiable computation

Most production zero-knowledge cryptography today is deployed for verifiable computation — rollup state transitions, sequencer validity proofs, off-chain compute attestations — where the privacy-preserving aspect is largely incidental. *Tall Grass* uses ZK for the witness-hiding property: the chain learns only that valid moves occurred; positions, directions, and the landscape itself remain hidden.

---

## 3. Open source

### 3.1 Repository

- Source: <https://github.com/0xfffxfff/tall-grass-hidden-from-view>
- License: GPL-3.0 (whole-stack)

The full stack is open source under GPL-3.0:

- Noir circuits ([`circuits/`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/tree/main/circuits)) — movement, entity movement, encounter, decryption verification.
- Solidity contracts ([`contracts/`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/tree/main/contracts)) — Foundry + Hardhat dual setup. Includes generated Honk verifier contracts.
- TFHE C library v1.1 (Apache 2.0) compiled to WASM via emscripten ([`fhe-wasm/`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/tree/main/fhe-wasm)). Vendored upstream and built from source.
- Frontend and oracle ([`app/`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/tree/main/app)) — wagmi + viem + React 19 + Vite for the browser; [`app/server.ts`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/app/server.ts) is the production oracle (Hono HTTP server on Node.js).
- Integration tests ([`tests/`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/tree/main/tests)) — Noir prover/verifier exercised end-to-end against a local node.

### 3.2 Reproducibility

The repository ships with a top-level [`Makefile`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/blob/main/Makefile) that builds Noir circuits, generates Solidity verifier contracts, builds Foundry contracts, builds the FHE WASM module from vendored TFHE C source, runs the Noir proof tests, and exercises the full participant flow in an integration test (anvil + deploy + server + walkthrough).

Anyone with `nargo` (1.0.0-beta.18), `forge`, `node`, `pnpm`, and `emscripten` (5.0.0) installed can reproduce every artifact from a clean checkout.

### 3.3 Standalone open-source contributions

The work produced two technical artefacts that are useful outside *Tall Grass*. Both ship as part of the repository under the licenses noted in § 3.1.

**A patent-free, browser-runnable TFHE comparison stack** ([`fhe-wasm/`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/tree/main/fhe-wasm)). The dominant open-source FHE library, Zama's TFHE-rs, ships under BSD 3-Clause Clear — a license with an explicit patent carve-out: "no express or implied licenses to any party's patent rights are granted by this license." Zama holds patents over several core TFHE optimizations, including programmable bootstrapping, and the line between permitted experimentation and prohibited commercial use is unclear for an artwork that charges a mint fee. *Tall Grass* therefore vendors and builds the **original TFHE C library v1.1 (Apache 2.0, patent-free; Chillotti et al., the academic implementation that predates Zama's patents)** to WebAssembly via emscripten 5.0.0, replacing the x86-specific FFTW3 with the pure-C Nayuki portable FFT. The result is a 198 KB WASM binary that performs 8-bit homomorphic comparisons (GT, EQ) entirely in the browser, with cross-environment verification (native keygen → WASM compare → native decrypt). Alternatives evaluated and rejected: OpenFHE (BSD-2-Clause, no patent carve-out, but the WASM port omits the TFHE/CGGI scheme and is Node-only); Order-Revealing Encryption (leaks full ordering passively, eliminates the "computational weight" of comparison that is part of the work); ZK-only comparison via the existing oracle (no FHE infrastructure, but adds no capability the oracle does not already have).

**Verifiable FHE comparison via ZK proof of correct decryption** ([`circuits/decryption/`](https://github.com/0xfffxfff/tall-grass-hidden-from-view/tree/main/circuits/decryption)). A homomorphic comparison result returned by an oracle is normally trusted. *Tall Grass* turns each result into a verifiable claim: when the oracle decrypts the boolean ciphertext, it produces a Noir zero-knowledge proof attesting that the decryption was performed under the secret key whose Poseidon commitment was fixed on-chain at deployment. The browser verifies the proof locally against the on-chain commitment. The trust model shifts from "the oracle is honest" to "the oracle is provably honest, per comparison." The construction is reusable wherever FHE is used to make claims about hidden data that need to be auditable.

---

## 4. Stack and dependencies

### 4.1 Cryptography

| Component | Tool | Version | Notes |
|-----------|------|---------|-------|
| ZK circuits (DSL) | Noir / Nargo | 1.0.0-beta.18 | Movement, entity movement, encounter, FHE-decryption circuits |
| ZK proving / verification | `bb.js` UltraHonk | matched to Nargo release | Browser proving via `noir_js` |
| Hashing in-circuit | Poseidon (BN254) | from `noir_stdlib` | `poseidon::poseidon::bn254::hash_*` |
| FHE | TFHE C library | v1.1, Apache 2.0 | Original TFHE C, *not* TFHE-rs (avoids the Zama patent concern; see § 3.3). Compiled to WASM via emscripten 5.0.0 with the Nayuki portable FFT (no x86 dependencies). Lambda=80 security parameter. |

Benchmarks (M1 Max):

- Movement proof: ~1.1 s prove, ~0.2 s verify.
- Entity movement proof: ~28.8 s prove, ~8.0 s verify.
- 8-bit FHE GT comparison (24 boolean gates): ~1.6 s in WASM.
- 8-bit FHE EQ comparison (15 boolean gates): ~1.0 s in WASM.

### 4.2 Smart contracts

| Component | Tool | Version |
|-----------|------|---------|
| Build system | Foundry (`forge`) | latest stable |
| Auxiliary build / scripts | Hardhat | latest stable |
| Token standard | solady ERC-721 + OwnableRoles | latest |
| Verifier contracts | Generated by `bb` from compiled Noir circuits | matched to circuit toolchain |

### 4.3 Server / oracle

| Component | Tool | Notes |
|-----------|------|-------|
| HTTP server | Hono on Node.js | TLS in production, JSON API |
| Config | zod-validated env | Hardened against misconfiguration |
| Chain monitoring | viem WebSocket subscriptions | Live `Moved`, `Minted`, `EntityMoved` events |
| FHE decryption | TFHE C native library (linked into Node addon) | Native keygen + native decrypt; cross-verified with WASM compare path |
| Auth on encounter / state endpoints | EIP-191 wallet signatures + nonces | Replay-resistant |

### 4.4 Frontend

| Component | Tool | Notes |
|-----------|------|-------|
| UI | React 19 + Vite | TypeScript strict |
| Wallet | wagmi + viem | Injected connectors (MetaMask, Rabby, etc.) |
| ZK proving (browser) | `noir_js` + `bb.js` UltraHonk | Movement proofs run client-side in WASM |
| FHE comparison (browser) | TFHE C → WASM (emscripten 5.0.0) | 198 KB binary, 384 MB initial WASM memory, ~78 MB cloud key |
| Live chain feed | wagmi (chain event subscriptions) | Drives multi-device state without polling |

### 4.5 Networks

| Network | Purpose |
|---------|---------|
| Sepolia | Testnet deployment for jury and pre-exhibition QA |
| Ethereum Mainnet | Production deployment (immutable contract; not upgradeable) |

### 4.6 Hardware (May 1 exhibition)

- Two Samsung DM55E 55" professional displays (1080p, 450 cd/m², 24/7 rated), mounted back-to-back. Pre-install testing was performed at home on a Samsung Frame 55"; install photographs from the Berlin gallery accompany this submission.
- Mac Mini (M-series) hosts the oracle, the chain monitor, and the WebGL fullscreen visual renderer; HDMI to both displays.
- For the May 1 build, the Monolith is realised as a screen-based study: bare displays running the fullscreen visual, no physical frosted layer, metal grate, or moving parts. The frosted-glass aesthetic and the kinematic vocabulary of the proposed sculpture are produced by the renderer itself.
- **GRAND PRIZE SCOPE**: frosted-glass body with mechanical parts behind the haze.

### 4.7 Trust model and stretch goals

- **Proving runs in the participant's browser, with no prover service in the loop.** Production zero-knowledge systems increasingly rely on centralized GPU prover farms — proving-as-a-service infrastructure that can refuse, delay, or filter specific users, and that becomes the de facto trust root for systems claiming trustlessness. *Tall Grass* generates every participant move proof client-side in WASM (`bb.js` UltraHonk).
- Today: oracle is a sealed, automated process running on the monolith. The artist holds the FHE secret key but the per-comparison ZK decryption proof keeps decryption honest. The artist does not inspect participant positions; this is enforced procedurally, not yet cryptographically.
- **GRAND PRIZE SCOPE**: TEE oracle (Intel SGX / AWS Nitro) — upgrade from "artist chooses not to look" to "artist cannot look", with remote attestation against a published image.
- **GRAND PRIZE SCOPE**: trustless terrain reveals via Private Information Retrieval or FHE-based lookup, eliminating the oracle's knowledge of participant positions without TEE hardware.

---

## 5. Budget allocation record

The EUR 6,000 micro-grant from the Pixel Prize was allocated as follows:

| Category | Amount (EUR) | Notes |
|----------|--------------:|-------|
| R&D / open-source engineering | ≈ 3,100 | Bulk: porting the TFHE C library to WebAssembly under Apache 2.0 — a patent-free, verifiable FHE comparison stack now released as public infrastructure (`fhe-wasm/`). Also funded: Noir movement and decryption circuits, Solidity contracts and verifier, oracle server, frontend. All released under GPL-3.0. |
| Exhibition installation and attendance (Berlin) | ≈ 1,200 | Travel and accommodation for the grantee exhibition at Trust Berlin, Apr 28 – May 5. |
| Tax withheld at source | ≈ 600 | ~10% withheld on foreign foundation income. |
| Hardware — Mac mini | ≈ 575 | Hosts the oracle (FHE keygen, ZK encounter proving) and drives the monolith's display in the gallery. |
| Sculpture materials — Monolith prototyping | ≈ 500 | Polycarbonate plates and supplies for early prototyping toward the proposed frosted-glass body (grand-prize scope). Not part of the May 1 install. |
| Infrastructure | 25 | Domain and RPC. No paid SaaS or commercial tooling. |
| **Total** | **6,000** | Reconciled. |

The grant's largest share funded open-source engineering — most prominently the port of the TFHE C library to WebAssembly under Apache 2.0, which removes a long-standing patent obstacle in the verifiable FHE space and is now usable by anyone. Hardware (a Mac mini that runs both the oracle and the monolith display) and sculpture materials cover the physical work. Travel covers the May 1-5 grantee exhibition in Berlin. Approximately 10% was withheld as tax. No commercial tools were used; the entire stack is open source under GPL-3.0.

---

*Updated: May 1, 2026, 14:43 CEST.*
