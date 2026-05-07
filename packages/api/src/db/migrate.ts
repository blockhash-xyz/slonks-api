import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { databaseUrl } from "../env.ts";

const sql = postgres(databaseUrl(), { max: 1 });
const db = drizzle(sql);

const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));
await migrate(db, { migrationsFolder });
await sql.end();

console.log("migrations applied");
