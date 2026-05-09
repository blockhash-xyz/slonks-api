import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  API_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(10 * 60_000),
  API_CACHE_NAMESPACE: z.string().default("slonks-api"),
  API_CACHE_REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(500),
  API_CACHE_REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(500),
  ALCHEMY_API_KEY: z.string().optional(),
  RPC_URL: z.string().url().optional(),
  OPENSEA_API_KEY: z.string().optional(),
  OPENSEA_SLUG: z.string().default("slonks"),
  SLOP_REMOTE_PROVER_URL: z.string().url().optional(),
  SLOP_REMOTE_PROVER_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  SLOP_REMOTE_PROVER_BUSY_RETRIES: z.coerce.number().int().nonnegative().default(12),
  SLOP_REMOTE_PROVER_BUSY_RETRY_MS: z.coerce.number().int().positive().default(750),
  SLOP_PROVER_AUTH_TOKEN: z.string().optional(),
  SLOP_PROVER_ENABLED: z
    .preprocess((value) => {
      if (typeof value !== "string") return value;
      return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
    }, z.boolean())
    .default(true),
  SLOP_PROVER_WORK_DIR: z.string().default("/tmp/slonks-prover/slop_model_proof"),
  SLOP_PROVER_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(10 * 60_000),
  SLOP_PROVER_MAX_CACHE_ENTRIES: z.coerce.number().int().positive().default(50),
  SLOP_PROVER_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  SLOP_PROOF_WORKER_ENABLED: z
    .preprocess((value) => {
      if (typeof value !== "string") return value;
      return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
    }, z.boolean())
    .default(false),
  SLOP_PROOF_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  SLOP_PROOF_JOB_POLL_MS: z.coerce.number().int().positive().default(1_000),
  SLOP_PROOF_JOB_STALE_MS: z.coerce.number().int().positive().default(10 * 60_000),
  SLOP_PROOF_JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  SLOP_PROOF_PENDING_RETRY_MS: z.coerce.number().int().positive().default(3_000),
  NARGO_BIN: z.string().optional(),
  BB_BIN: z.string().optional(),
  START_BLOCK: z.coerce.bigint().optional(),
  LOG_RANGE: z.coerce.bigint().default(2_000n),
  SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(12_000),
  PORT: z.coerce.number().int().positive().default(8080),
  CORS_ORIGINS: z.string().default(""),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

export function rpcUrl(): string {
  if (env.ALCHEMY_API_KEY) return `https://eth-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
  if (env.RPC_URL) return env.RPC_URL;
  return "https://eth.llamarpc.com";
}

export function databaseUrl(): string {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return env.DATABASE_URL;
}
