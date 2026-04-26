# Tall Grass (Hidden From View)

A digital art piece by 0xfff. Programmable cryptography as artistic medium —
zero-knowledge proofs and homomorphic encryption used as art supplies, not
financial instruments.

Three movements:

- **I — Landscape (Contract).** An encrypted, unknowable landscape on Ethereum.
  Participants move through it; each move is a ZK proof; only commitments touch
  the chain.
- **II — Entities (NFTs).** Encounters with shrouded entities. Traits are
  FHE-encrypted and compared homomorphically — the chain publishes only the
  direction of the result.
- **III — Monolith (Sculpture).** Screen-based study for the May 2026
  exhibition; mechanical sculpture in its full form.

Read the work: [`report/digital-exhibit.md`](report/digital-exhibit.md) ·
[`report/tech-spec.md`](report/tech-spec.md).

Funded by The Pixel Prize / JUST Open Source Stiftung. Released under GPL-3.0;
`fhe-wasm/` is Apache-2.0 (TFHE port).

## Layout

- `app/` — web interface
- `circuits/` — Noir ZK circuits (movement, encounter, decryption)
- `contracts/` — Solidity, Foundry + Hardhat
- `fhe-wasm/` — TFHE C compiled to WebAssembly + comparison pipeline
- `report/` — submission documents
- `tests/` — integration tests