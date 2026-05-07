import { Hono } from "hono";
import { logger } from "hono/logger";
import { env } from "./env.ts";
import { setNoStore } from "./api/cache.ts";
import { voidProof } from "./api/routes/voidProof.ts";

const app = new Hono();

app.use("*", logger());
app.use("*", async (c, next) => {
  setNoStore(c);
  if (c.req.path === "/health") return next();

  const expected = env.SLOP_PROVER_AUTH_TOKEN;
  if (expected && c.req.header("Authorization") !== `Bearer ${expected}`) {
    return c.json({ error: "unauthorized" }, 401);
  }

  return next();
});

app.get("/health", (c) => c.json({ status: "ok", process: "prover" }));
app.route("/void-proof", voidProof);
app.route("/proofs/void", voidProof);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error("prover error:", err);
  return c.json({ error: err.message ?? "internal error" }, 500);
});

Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

console.log(`slonks-api prover listening on :${env.PORT}`);
