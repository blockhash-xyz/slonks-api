import { buildApp } from "./api/server.ts";
import { env } from "./env.ts";

const app = buildApp();

console.log(`slonks-api web listening on :${env.PORT}`);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
