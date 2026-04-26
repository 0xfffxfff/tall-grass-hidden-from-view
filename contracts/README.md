# contracts/

Solidity contract for Tall Grass (Hidden From View). ERC-721 with ZK proof verification for participant movement and entity position updates, oracle-mediated registration and minting.

## Setup

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, anvil)
- [Node.js](https://nodejs.org/) >= 18 (for verifier/fixture generation)

### Install dependencies

After cloning the repo, initialize git submodules:

```
git submodule update --init --recursive
```

This installs:
- `lib/forge-std` — Foundry test framework
- `lib/openzeppelin-contracts` — ERC-721, ECDSA, MerkleProof

Install JS dependencies (for verifier and fixture generation):

```
cd tests
npm install
```

### Generate Solidity verifiers

Exports verifier contracts from compiled Noir circuits:

```
cd tests
node scripts/generate-verifiers.mjs
```

Writes `contracts/src/MovementVerifier.sol`.

### Build

```
cd contracts
forge build
```

### Test

Unit tests use mock verifiers. E2E tests use real ZK proofs against generated verifiers.

To regenerate E2E test fixtures (real keccak-mode proofs as Solidity constants):

```
cd tests
node scripts/generate-test-fixtures.mjs
```

Run all tests:

```
cd contracts
forge test
```

### Deploy

Copy `.env.example` to `.env`, fill in values, then either:

- `forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast` (one-shot foundry script), or
- `npx hardhat deploy --tags TallGrass --network <network>` (hardhat-deploy, used by the local-test loop below).

## Local end-to-end test

Stand up a fresh deploy on anvil, upload assets, mint the artist proof,
and render the resulting tokenURI to a viewer HTML page.

```
# Terminal 1
anvil                                                # or: npx hardhat node

# Terminal 2
cd contracts
npx hardhat deploy --tags TallGrass --network localhost
npm --prefix ../app run build:onchain                # produces app/dist/onchain/full.html
npx hardhat setup-assets   --network localhost       # uploads HTML + 1x1 previews + ciphertexts
npx hardhat artist-mint    --id 0 --network localhost
npx hardhat view-token     --id 0 --network localhost
open render/entity-0-viewer.html
```

`setup-assets` skips work that's already on chain, so it's safe to re-run.
Useful flags:

- `--from N --to M` — limit the range of entities (default `0..31`)
- `--aspects 1x1,2x3,9x16` — which preview sizes to upload (default `1x1` only)
- `--skip-html` / `--skip-images` / `--skip-ciphertexts` — partial runs

`artist-mint` reads `app/data/merkle.json` for the trait hash + Merkle proof.
Pass `--to <addr>` to mint to someone other than the deployer; pass `--pos`
and `--seed` to set non-zero position/blinding commitments if you intend
to move the entity later.

`view-token` decodes the on-chain `tokenURI`, writes the raw JSON, extracts
the `image` and `animation_url` to disk, and emits a self-contained
`entity-N-viewer.html` page with both panes plus the decoded JSON.

## Structure

```
src/
  TallGrass.sol               Main contract (ERC-721 + all logic)
  interfaces/IVerifier.sol    Verifier interface
  MovementVerifier.sol        Generated from movement circuit
test/
  TallGrass.t.sol             Unit tests (mock verifiers)
  TallGrassE2E.t.sol          E2E tests (real ZK proofs)
  TestFixtures.sol            Generated proof fixtures
script/
  Deploy.s.sol                Deployment script
```
