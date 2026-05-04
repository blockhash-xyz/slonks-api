import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "packages/api/src/db/schema.ts",
  out: "packages/api/src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/slonks",
  },
  strict: true,
  verbose: true,
});
