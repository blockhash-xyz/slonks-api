import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { corsOrigins } from "../env.ts";
import { conditionalEtag, responseCache, setNoStore } from "./cache.ts";
import { health } from "./routes/health.ts";
import { collection } from "./routes/collection.ts";
import { tokens } from "./routes/tokens.ts";
import { owners } from "./routes/owners.ts";
import { activity } from "./routes/activity.ts";
import { mergePreview } from "./routes/mergePreview.ts";
import { mergePreviews } from "./routes/mergePreviews.ts";
import { listings } from "./routes/listings.ts";
import { holders } from "./routes/holders.ts";
import { voidProof } from "./routes/voidProof.ts";
import { png } from "./routes/png.ts";

export function buildApp() {
  const app = new Hono();
  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: corsOrigins.length === 0 ? "*" : corsOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );
  app.use("*", responseCache());
  app.use("*", conditionalEtag());

  app.route("/health", health);
  app.route("/collection", collection);
  app.route("/tokens", tokens);
  app.route("/owners", owners);
  app.route("/activity", activity);
  app.route("/merge-preview", mergePreview);
  app.route("/merge-previews", mergePreviews);
  app.route("/listings", listings);
  app.route("/holders", holders);
  app.route("/void-proof", voidProof);
  app.route("/proofs/void", voidProof);
  app.route("/png", png);

  app.notFound((c) => {
    setNoStore(c);
    return c.json({ error: "not found" }, 404);
  });
  app.onError((err, c) => {
    console.error("api error:", err);
    setNoStore(c);
    return c.json({ error: err.message ?? "internal error" }, 500);
  });
  return app;
}
