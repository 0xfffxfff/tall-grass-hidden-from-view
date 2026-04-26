# Tall Grass — root build pipeline
# Usage: make              (full build)
#        make test          (ZK + contract tests)
#        make test-integration  (anvil + deploy + server + full walkthrough)
#        make clean         (remove build artifacts)

NARGO := $(HOME)/.nargo/bin/nargo

# Noir sources (workspace: lib, movement, entity_movement, encounter)
NOIR_SOURCES := $(wildcard circuits/*/src/*.nr) $(wildcard circuits/*/Nargo.toml) circuits/Nargo.toml

# Circuit compilation sentinel
CIRCUIT_SENTINEL := circuits/target/.compiled
CIRCUIT_MOVEMENT := circuits/target/movement.json
CIRCUIT_ENTITY := circuits/target/entity_movement.json
CIRCUIT_ENCOUNTER := circuits/target/encounter.json
CIRCUIT_DECRYPTION := circuits/target/decryption.json

# Generated Solidity files
HONK_BASE_SOL := contracts/src/HonkBase.sol
VERIFIER_SOL := contracts/src/MovementVerifier.sol
ENTITY_VERIFIER_SOL := contracts/src/EntityMovementVerifier.sol
ENCOUNTER_VERIFIER_SOL := contracts/src/EncounterVerifier.sol
DECRYPTION_VERIFIER_SOL := contracts/src/DecryptionVerifier.sol
FIXTURES_SOL := contracts/test/TestFixtures.sol

# Forge build sentinel
FORGE_OUT := contracts/out/TallGrass.sol/TallGrass.json

# ----------------------------------------------------------------------
# Default target
# ----------------------------------------------------------------------

.PHONY: all
all: circuits verifiers fixtures contracts

# ----------------------------------------------------------------------
# Circuits
# ----------------------------------------------------------------------

.PHONY: circuits
circuits: $(CIRCUIT_SENTINEL)

$(CIRCUIT_SENTINEL): $(NOIR_SOURCES)
	@echo "==> Compiling Noir circuits"
	cd circuits && $(NARGO) compile
	@touch $@

$(CIRCUIT_MOVEMENT): $(CIRCUIT_SENTINEL)
$(CIRCUIT_ENTITY): $(CIRCUIT_SENTINEL)
$(CIRCUIT_ENCOUNTER): $(CIRCUIT_SENTINEL)
$(CIRCUIT_DECRYPTION): $(CIRCUIT_SENTINEL)

# ----------------------------------------------------------------------
# Verifiers (Solidity verifier from bb.js)
# ----------------------------------------------------------------------

.PHONY: verifiers
verifiers: $(HONK_BASE_SOL) $(VERIFIER_SOL) $(ENTITY_VERIFIER_SOL) $(ENCOUNTER_VERIFIER_SOL) $(DECRYPTION_VERIFIER_SOL)

$(HONK_BASE_SOL) $(VERIFIER_SOL) $(ENTITY_VERIFIER_SOL) $(ENCOUNTER_VERIFIER_SOL) $(DECRYPTION_VERIFIER_SOL): $(CIRCUIT_MOVEMENT) $(CIRCUIT_ENTITY) $(CIRCUIT_ENCOUNTER) $(CIRCUIT_DECRYPTION) | tests/node_modules
	@echo "==> Generating Solidity verifiers"
	node tests/scripts/generate-verifiers.mjs

# ----------------------------------------------------------------------
# Fixtures (ZK proof test fixtures)
# ----------------------------------------------------------------------

.PHONY: fixtures
fixtures: $(FIXTURES_SOL)

$(FIXTURES_SOL): $(CIRCUIT_MOVEMENT) | tests/node_modules
	@echo "==> Generating test fixtures"
	node tests/scripts/generate-test-fixtures.mjs

# ----------------------------------------------------------------------
# Contracts (forge build)
# ----------------------------------------------------------------------

.PHONY: contracts
contracts: $(FORGE_OUT)

$(FORGE_OUT): $(HONK_BASE_SOL) $(VERIFIER_SOL) $(ENTITY_VERIFIER_SOL) $(ENCOUNTER_VERIFIER_SOL) $(DECRYPTION_VERIFIER_SOL) $(FIXTURES_SOL) $(wildcard contracts/src/*.sol) $(wildcard contracts/test/*.sol)
	@echo "==> Building contracts (forge)"
	cd contracts && forge build

# ----------------------------------------------------------------------
# Tests
# ----------------------------------------------------------------------

.PHONY: test test-zk test-contracts test-fhe

test: test-zk test-contracts

test-zk: $(CIRCUIT_SENTINEL) | tests/node_modules
	@echo "==> Running ZK tests (vitest)"
	cd tests && npm test

test-contracts: $(FORGE_OUT)
	@echo "==> Running contract tests (forge)"
	cd contracts && forge test

test-fhe:
	@echo "==> Running FHE tests"
	cd fhe-wasm && node test/test.mjs

# ----------------------------------------------------------------------
# Integration test (functional walkthrough on local anvil)
# ----------------------------------------------------------------------

# Merkle root from FHE batch data (for contract deployment)
MERKLE_JSON := app/data/merkle.json
TRAIT_MERKLE_ROOT = $(shell [ -f $(MERKLE_JSON) ] && python3 -c "import json; print(json.load(open('$(MERKLE_JSON)'))['root'])" 2>/dev/null || echo "0x0000000000000000000000000000000000000000000000000000000000000000")
SEED_COMMITMENT = $(shell node tests/scripts/compute-seed-commitment.mjs 2>/dev/null || echo "0x0000000000000000000000000000000000000000000000000000000000000000")
DECRYPTION_KEY_COMMITMENT = $(shell node tests/scripts/compute-decryption-key-commitment.mjs 2>/dev/null || echo "0x0000000000000000000000000000000000000000000000000000000000000000")

.PHONY: deploy-local start-server test-integration stop-local

deploy-local: $(FORGE_OUT) stop-local
	@echo "==> Starting anvil (background)"
	@anvil > /dev/null 2>&1 & echo $$! > .anvil.pid
	@sleep 1
	@rm -rf contracts/deployments/localhost
	@echo "==> Deploying contracts to localhost"
	cd contracts && SEED_COMMITMENT=$(SEED_COMMITMENT) ENTITY_TRAIT_MERKLE_ROOT=$(TRAIT_MERKLE_ROOT) DECRYPTION_KEY_COMMITMENT=$(DECRYPTION_KEY_COMMITMENT) npx hardhat deploy --tags TallGrass --network localhost

start-server:
	@echo "==> Starting app server (background)"
	@DEBUG=1 npx tsx app/server.ts > .server.log 2>&1 & echo $$! > .server.pid
	@echo "    Waiting for server to initialize..."
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
		curl -s http://localhost:3000/api/contract > /dev/null 2>&1 && break; \
		sleep 1; \
	done
	@echo "    Server PID: $$(cat .server.pid)"

test-integration: deploy-local start-server
	@echo "==> Running integration test"
	@node tests/scripts/integration-test.mjs; rc=$$?; \
		$(MAKE) --no-print-directory stop-local; \
		exit $$rc

stop-local:
	@if [ -f .server.pid ]; then kill $$(cat .server.pid) 2>/dev/null; rm -f .server.pid; echo "    Stopped server"; fi
	@if [ -f .anvil.pid ]; then kill $$(cat .anvil.pid) 2>/dev/null; rm -f .anvil.pid; echo "    Stopped anvil"; fi

# ----------------------------------------------------------------------
# Node modules
# ----------------------------------------------------------------------

tests/node_modules:
	@echo "==> Installing test dependencies"
	cd tests && npm install

# ----------------------------------------------------------------------
# Clean
# ----------------------------------------------------------------------

.PHONY: clean
clean:
	@echo "==> Cleaning build artifacts"
	rm -rf circuits/target
	rm -rf contracts/out contracts/cache
	rm -rf contracts/deployments/localhost
	rm -f .anvil.pid .server.pid
