import { Buffer } from "node:buffer";
import type { Context } from "hono";
import { createClient } from "redis";
import { env } from "../env.ts";
import { setNoStore } from "./cache.ts";

export const TOKEN_STATE_CACHE_SCOPE = "token-state";

type StateCacheOptions = {
  scope?: string;
  ttlMs?: number;
};

type RedisClient = ReturnType<typeof createClient>;

const VERSION_SEED = "1";
const pending = new Map<string, Promise<unknown>>();
let redisPromise: Promise<RedisClient | null> | null = null;

export async function readThroughStateCache<T>(
  c: Context,
  namespace: string,
  build: () => Promise<T>,
  options: StateCacheOptions = {},
): Promise<T> {
  setNoStore(c);

  const redis = await getRedisClient();
  const ttlMs = options.ttlMs ?? env.API_CACHE_TTL_MS;
  if (!redis || ttlMs <= 0) {
    c.header("X-Slonks-Cache", "BYPASS");
    return build();
  }

  const scope = options.scope ?? TOKEN_STATE_CACHE_SCOPE;
  const version = await readCacheVersion(redis, scope);
  const key = cacheKey(scope, version, namespace, c.req.url);
  const activeBuild = pending.get(key) as Promise<T> | undefined;
  if (activeBuild) {
    const value = await activeBuild;
    c.header("X-Slonks-Cache", "HIT");
    c.header("X-Slonks-Cache-Version", version);
    return value;
  }

  const cached = await safeRedis(() => redis.get(key));
  if (cached) {
    c.header("X-Slonks-Cache", "HIT");
    c.header("X-Slonks-Cache-Version", version);
    return decodeCacheValue<T>(cached);
  }

  const buildPromise = build();
  pending.set(key, buildPromise);
  try {
    const value = await buildPromise;
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1_000));
    const payload = encodeCacheValue(value);
    await safeRedis(() => redis.set(key, payload, { EX: ttlSeconds }));
    c.header("X-Slonks-Cache", "MISS");
    c.header("X-Slonks-Cache-Version", version);
    return value;
  } finally {
    pending.delete(key);
  }
}

export async function bumpApiCacheVersion(scope = TOKEN_STATE_CACHE_SCOPE): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;

  await safeRedis(async () => {
    await redis.incr(versionKey(scope));
  });
  for (const key of pending.keys()) {
    if (key.startsWith(`${env.API_CACHE_NAMESPACE}:${scope}:`)) pending.delete(key);
  }
}

export function clearStateCache(): void {
  pending.clear();
}

async function readCacheVersion(redis: RedisClient, scope: string): Promise<string> {
  const key = versionKey(scope);
  const value = await safeRedis(() => redis.get(key));
  if (value) return value;
  await safeRedis(() => redis.set(key, VERSION_SEED));
  return VERSION_SEED;
}

async function getRedisClient(): Promise<RedisClient | null> {
  if (!env.REDIS_URL) return null;
  redisPromise ??= connectRedis();
  const client = await redisPromise;
  if (!client) redisPromise = null;
  return client;
}

async function connectRedis(): Promise<RedisClient | null> {
  try {
    const client = createClient({ url: env.REDIS_URL });
    client.on("error", (err) => {
      console.warn("redis cache error:", err);
    });
    await client.connect();
    return client;
  } catch (err) {
    console.warn("redis cache unavailable:", err);
    return null;
  }
}

function cacheKey(scope: string, version: string, namespace: string, rawUrl: string): string {
  const url = new URL(rawUrl);
  return `${env.API_CACHE_NAMESPACE}:${scope}:${version}:${namespace}:${url.pathname}${url.search}`;
}

function versionKey(scope: string): string {
  return `${env.API_CACHE_NAMESPACE}:${scope}:version`;
}

async function safeRedis<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.warn("redis cache command failed:", err);
    return null;
  }
}

function encodeCacheValue(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Uint8Array) {
      return { __slonksType: "Uint8Array", base64: Buffer.from(item).toString("base64") };
    }
    return item;
  });
}

function decodeCacheValue<T>(payload: string): T {
  return JSON.parse(payload, (_key, item) => {
    if (item && typeof item === "object" && item.__slonksType === "Uint8Array" && typeof item.base64 === "string") {
      return new Uint8Array(Buffer.from(item.base64, "base64"));
    }
    return item;
  }) as T;
}
