import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

const queryClient = postgres(env.DATABASE_URL, {
  max: env.NODE_ENV === "production" ? 10 : 4,
  prepare: false,
});

export const db = drizzle(queryClient, { schema });
export type Db = typeof db;

export async function close() {
  await queryClient.end({ timeout: 5 });
}
