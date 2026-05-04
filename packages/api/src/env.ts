import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  ALCHEMY_API_KEY: z.string().optional(),
  RPC_URL: z.string().url().optional(),
  OPENSEA_API_KEY: z.string().optional(),
  OPENSEA_SLUG: z.string().default("slonks"),
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
