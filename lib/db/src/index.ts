import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Pool sizing is deployment-specific: a small Coolify container behind a
// managed Postgres wants a modest ceiling, and the local embedded dev
// database (scripts/src/dev-postgres.mjs) serves one connection at a
// time, so it needs DATABASE_POOL_MAX=1.
const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 10);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
