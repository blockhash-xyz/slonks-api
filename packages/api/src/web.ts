import { buildApp } from "./api/server.ts";
import { env } from "./env.ts";

const app = buildApp();

Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

console.log(`slonks-api web listening on :${env.PORT}`);
