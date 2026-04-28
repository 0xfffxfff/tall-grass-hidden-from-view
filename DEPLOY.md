# Deploy

End-to-end procedure to ship a Tall Grass deployment from a fresh seed.

Targets Sepolia. Mainnet is the same procedure with `--network mainnet`,
but defer until tested under real conditions.

## 1. Prerequisites

- `secrets/env.sh` exists and exports `TRAIT_MODULI=...` (gitignored).
- `contracts/.env` is filled in (see §4).
- The deployer wallet has gas. For Sepolia:
  ```
  cast balance 0xfFF2E6B9A95e7BfF4a247D799106F0E4a3b7FEed --rpc-url $RPC_URL
  ```
- Native `keygen` binary built (see `fhe-wasm/README.md`).
- All node deps installed (`npm install` in `app/` and `contracts/`).

## 2. Generate the FHE batch

Pick a fresh 32-byte seed. Anything random — `openssl rand -hex 16` will do.

```
source secrets/env.sh
fhe-wasm/build-native/keygen batch <seed_hex> 32 7 app/data
```

Produces `app/data/{secret.key, cloud.key, entities/0..31.bin, manifest.json}`.

Build the trait Merkle tree:

```
cd fhe-wasm && npx tsx src/merkle.ts ../app/data && cd ..
```

Produces `app/data/merkle.json`. Verify root:

```
cat app/data/merkle.json | python3 -c "import json,sys;print(json.load(sys.stdin)['root'])"
```

**Never commit `app/data/`. Never share `secret.key`. Never publish
`manifest.json` (contains plaintext traits + landscape seed).**

## 3. Compute the four commitments

```
source secrets/env.sh
node tests/scripts/compute-seed-commitment.mjs            # SEED_COMMITMENT
node tests/scripts/compute-decryption-key-commitment.mjs  # DECRYPTION_KEY_COMMITMENT
node tests/scripts/compute-trait-moduli-commitment.mjs    # TRAIT_MODULI_COMMITMENT
```

Each prints one bytes32 hex value. The merkle root from §2 is the
fourth (`ENTITY_TRAIT_MERKLE_ROOT`).

## 4. Configure `contracts/.env`

```
RPC_URL=<sepolia rpc endpoint>
DEPLOYER_KEY=<deployer private key>
ORACLE_ADDRESS=<oracle wallet address>
ETHERSCAN_API_KEY=<v2 api key, single key works for all chains>

SEED_COMMITMENT=0x...
ENTITY_TRAIT_MERKLE_ROOT=0x...
DECRYPTION_KEY_COMMITMENT=0x...
TRAIT_MODULI_COMMITMENT=0x...

GRID_WIDTH=32
GRID_HEIGHT=32
TOTAL_SUPPLY=32
MINT_PRICE=200000000000000000   # 0.2 ETH in wei
```

The constructor takes 12 args; the four commitments above are the only
deploy-time secrets that change between runs.

## 5. Deploy contracts

```
cd contracts
npx hardhat deploy --tags TallGrass --network sepolia
```

Writes `contracts/deployments/sepolia/{TallGrass,TallGrassMetadata}.json`
with the new addresses, ABIs, and constructor args. Honk verifier
contracts and libraries are reused from prior deploys when possible.

## 6. Verify on Etherscan

```
npx hardhat verify-etherscan --network sepolia
```

Sweeps all 8 deployments (3 Honk libs, 3 verifiers, TallGrass,
TallGrassMetadata). Idempotent — already-verified contracts are skipped.
Prints the Etherscan URL for each.

## 7. Upload assets

Build the on-chain HTML viewer first:

```
cd ..
npm --prefix app run build:onchain
```

Produces `app/dist/onchain/full.html` (the single self-contained viewer
that the metadata contract chunks into SSTORE2 sections).

Then run the orchestrator:

```
cd contracts
npx hardhat setup-assets --network sepolia
```

Uploads HTML (3 sections, ~5–10 chunks), 32 entity preview images
(~1 chunk each), and 32 entity ciphertexts (~5 chunks each at 24KB per
chunk). Roughly 200 transactions total. Idempotent — re-run if the
network stalls; anything already on chain is skipped.

Optional: set the collection image (entity 0 preview reused as the
collection card):

```
npx hardhat set-image --file ../previews/onchain/1x1/0.jpg --network sepolia
```

## 8. Build & deploy the SPA

```
cd ../app
npm run build
```

Runs `wagmi generate` (regenerates `app/src/generated.ts` from the
fresh deployment JSONs, so the SPA picks up the new contract address
and ABI automatically), then `vite build`, then prerenders the report
pages.

Deploy `app/dist/` to Netlify with whatever flow you use
(`netlify deploy --prod --dir=dist` from the CLI, or push-to-deploy if
configured).

## 9. Smoke tests

Confirm the data allowlist (proxied through Netlify to the oracle backend):

```
# 200 expected:
curl -I https://tallgrass.0xfff.love/data/cloud.key
curl -I https://tallgrass.0xfff.love/data/tfhe.wasm
curl -I https://tallgrass.0xfff.love/data/entities/0.bin

# 404 expected:
curl -I https://tallgrass.0xfff.love/data/secret.key
curl -I https://tallgrass.0xfff.love/data/manifest.json
curl -I https://tallgrass.0xfff.love/data/merkle.json
```

Confirm the SPA bundle has the new contract address and not the old one:

```
JS=$(curl -s https://tallgrass.0xfff.love/ | grep -oE 'assets/[^"]+\.js' | head -1)
curl -s "https://tallgrass.0xfff.love/$JS" | grep -o "<NEW_ADDR>" | head -1   # expect address
curl -s "https://tallgrass.0xfff.love/$JS" | grep -c "<OLD_ADDR>"             # expect 0
```

Then in a browser: connect a wallet (account ≥ 1 — see gotchas below),
register, walk a few cells, autowalk, trigger an encounter and mint,
compare two minted entities.

## Gotchas

- **Account-0 oracle collision.** If the oracle's default `ORACLE_PRIVATE_KEY`
  is anvil/hardhat account 0, do not use account 0 in your browser
  wallet — the nonces will collide and txs will get stuck. Use
  account 1+ or set `ORACLE_PRIVATE_KEY` to a different key explicitly.
- **`TRAIT_MODULI` is required.** The keygen binary, the FHE traits
  test, and `compute-trait-moduli-commitment.mjs` all read `TRAIT_MODULI`
  from env. Always `source secrets/env.sh` before running them.
- **Don't commit `traits.csv`** if you generate it for inspection.
  Plaintext traits — delete after use. Don't add it to `.gitignore`
  either (gitignoring announces existence); just delete.
- **Allowlist serves entity ciphertexts on purpose.** `/data/entities/*.bin`
  returning 200 is correct — those are FHE ciphertexts, public by
  design (the whole point of FHE is that the encrypted data is public,
  only `secret.key` is private).
- **Netlify proxies `/data/*` and `/api/*`** to `hiddenfromview.0xfff.love`.
  The Netlify host serves only the static SPA; the oracle and the
  data allowlist live on the backend. See `app/public/_redirects`.
- **Old contracts orphan, they don't migrate.** The contract is
  immutable — every redeploy creates a new address and the old
  metadata, mints, and history stay frozen at the old address. Account
  for this in the artist statement and in any external links.
- **Sepolia faucet for visitors.** Anyone walking the landscape needs
  Sepolia ETH for gas. https://sepoliafaucet.com is the standard;
  the deposit-and-relay flow lets the oracle pay gas if visitors
  prefer not to deal with a faucet.
