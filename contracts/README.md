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

Copy `.env.example` to `.env`, fill in values, then:

```
cd contracts
source .env
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
```

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
