import { z } from "zod";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DEBUG: z
    .string()
    .default("0")
    .transform((v) => v === "1"),
  DATA_DIR: z.string().default(join(__dirname, "data")),
  ORACLE_PRIVATE_KEY: z
    .string()
    .default(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    ),
  RPC_URL: z.string().default("http://127.0.0.1:8545"),
  GRID_WIDTH: z.coerce.number().int().positive().default(32),
  GRID_HEIGHT: z.coerce.number().int().positive().default(32),
  ENTITY_COUNT: z.coerce.number().int().positive().default(32),
});

const env = envSchema.parse(process.env);

export const config = {
  PORT: env.PORT,
  DEBUG: env.DEBUG,
  DATA_DIR: resolve(env.DATA_DIR),
  ORACLE_PRIVATE_KEY: env.ORACLE_PRIVATE_KEY,
  RPC_URL: env.RPC_URL,
  GRID_WIDTH: env.GRID_WIDTH,
  GRID_HEIGHT: env.GRID_HEIGHT,
  ENTITY_COUNT: env.ENTITY_COUNT,

  // Derived paths
  FHE_DIST: resolve(join(__dirname, "..", "fhe-wasm", "dist")),
  ENCOUNTER_CIRCUIT_PATH: resolve(
    join(__dirname, "..", "circuits", "target", "encounter.json"),
  ),
  DECRYPTION_CIRCUIT_PATH: resolve(
    join(__dirname, "..", "circuits", "target", "decryption.json"),
  ),
  COMPARISON_PROOFS_DIR: resolve(join(env.DATA_DIR, "comparison-proofs")),
  DEPLOYMENT_DIR: resolve(
    join(__dirname, "..", "contracts", "deployments", "localhost"),
  ),
  CIRCUITS_TARGET_DIR: resolve(
    join(__dirname, "..", "circuits", "target"),
  ),
  DIST_DIR: join(__dirname, "dist"),
} as const;
