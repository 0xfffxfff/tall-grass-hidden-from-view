import { readFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend } from "@aztec/bb.js";
import type { CompiledCircuit } from "@noir-lang/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const circuitCache = new Map<string, CompiledCircuit>();

async function loadCircuit(
  name: string = "movement",
): Promise<CompiledCircuit> {
  if (!circuitCache.has(name)) {
    const path = resolve(__dirname, `../../circuits/target/${name}.json`);
    const raw = await readFile(path, "utf-8");
    circuitCache.set(name, JSON.parse(raw) as CompiledCircuit);
  }
  return circuitCache.get(name)!;
}

export async function createNoir(name: string = "movement"): Promise<Noir> {
  const circuit = await loadCircuit(name);
  return new Noir(circuit);
}

export async function createBackend(
  name: string = "movement",
): Promise<UltraHonkBackend> {
  const circuit = await loadCircuit(name);
  return new UltraHonkBackend(circuit.bytecode);
}
