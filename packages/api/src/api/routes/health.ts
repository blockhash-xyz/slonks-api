import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../../db/client.ts";

export const health = new Hono();

health.get("/", async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.json({ status: "ok" });
  } catch (err) {
    return c.json({ status: "degraded", error: String(err) }, 500);
  }
});
