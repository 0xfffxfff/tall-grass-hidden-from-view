#!/usr/bin/env node
// Wallet activity report. Reads chain events for TallGrass and prints
// a per-wallet table: registration block, move count, mints, deposit
// balance net of withdrawals. Plus a small global summary.
//
// Usage (from app/):
//   NETWORK=sepolia RPC_URL=https://... node scripts/stats.mjs
//   NETWORK=localhost node scripts/stats.mjs
//
// No oracle required; this is a read-only chain query.

import { JsonRpcProvider, Contract, formatEther } from "ethers";
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NETWORK = process.env.NETWORK || "localhost";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const DEPLOYMENT = resolve(
  join(__dirname, "..", "..", "contracts", "deployments", NETWORK, "TallGrass.json"),
);

const deployment = JSON.parse(readFileSync(DEPLOYMENT, "utf-8"));
const provider = new JsonRpcProvider(RPC_URL);
const contract = new Contract(deployment.address, deployment.abi, provider);

const fromBlock = deployment.receipt?.blockNumber ?? 0;
const head = await provider.getBlockNumber();

console.log(`network:        ${NETWORK}`);
console.log(`contract:       ${deployment.address}`);
console.log(`scanning:       block ${fromBlock} -> ${head} (${head - fromBlock} blocks)`);
console.log("");

// CHUNK=0 (default) issues one unbounded query per filter — works on any
// paid Alchemy/Infura tier and matches what the oracle does at startup.
// If the RPC rejects with a "Free tier" range limit, set CHUNK to the
// allowed window (Alchemy free returns 10) and the script will paginate
// + retry on 429s. Slow on big histories, but it works.
const CHUNK = Number(process.env.CHUNK || 0);
async function withRetry(fn, attempts = 8) {
  let delay = 600;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = String(e?.error?.message || e?.message || "");
      const transient = msg.includes("429") || msg.includes("rate") || msg.includes("compute units");
      if (i === attempts - 1 || !transient) throw e;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }
}
async function rangeQuery(filter) {
  if (CHUNK === 0) return withRetry(() => contract.queryFilter(filter, fromBlock, head));
  const out = [];
  for (let from = fromBlock; from <= head; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, head);
    out.push(...(await withRetry(() => contract.queryFilter(filter, from, to))));
  }
  return out;
}
const registered = await rangeQuery(contract.filters.Registered());
const moved = await rangeQuery(contract.filters.Moved());
const minted = await rangeQuery(contract.filters.Minted());
const deposited = await rangeQuery(contract.filters.Deposited());
const withdrawn = await rangeQuery(contract.filters.DepositWithdrawn());

const wallets = new Map();
function get(addr) {
  const k = addr.toLowerCase();
  let w = wallets.get(k);
  if (!w) {
    w = {
      address: addr,
      registeredAt: null,
      moves: 0,
      lastMoveBlock: 0,
      mints: [],
      depositedWei: 0n,
      withdrawnWei: 0n,
    };
    wallets.set(k, w);
  }
  return w;
}

for (const e of registered) {
  const w = get(e.args.participant);
  w.registeredAt = e.blockNumber;
}
for (const e of moved) {
  const w = get(e.args.participant);
  w.moves++;
  w.lastMoveBlock = Math.max(w.lastMoveBlock, e.blockNumber);
}
for (const e of minted) {
  const w = get(e.args.participant);
  w.mints.push(Number(e.args.entityId));
}
for (const e of deposited) {
  const w = get(e.args.participant);
  w.depositedWei += e.args.amount;
}
for (const e of withdrawn) {
  const w = get(e.args.participant);
  w.withdrawnWei += e.args.amount;
}

const rows = [...wallets.values()].sort(
  (a, b) => (b.lastMoveBlock || b.registeredAt || 0) - (a.lastMoveBlock || a.registeredAt || 0),
);

const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad("wallet", 12),
  pad("registered@", 13),
  pad("moves", 7),
  pad("lastMove@", 13),
  pad("mints", 7),
  pad("balance(eth)", 14),
);
console.log("-".repeat(72));
for (const w of rows) {
  const balance = w.depositedWei - w.withdrawnWei;
  console.log(
    pad(w.address.slice(0, 10) + "..", 12),
    pad(w.registeredAt ?? "-", 13),
    pad(w.moves, 7),
    pad(w.lastMoveBlock || "-", 13),
    pad(w.mints.length || "-", 7),
    pad(formatEther(balance), 14),
  );
}

console.log("");
console.log(`participants:   ${wallets.size}`);
console.log(`total moves:    ${moved.length}`);
console.log(`total mints:    ${minted.length}`);
console.log(`net deposits:   ${formatEther(rows.reduce((a, w) => a + w.depositedWei - w.withdrawnWei, 0n))} eth`);
