import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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

export async function runMigrations(): Promise<void> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const possiblePaths = [
    path.resolve(process.cwd(), "lib/db/drizzle"),
    path.resolve(currentDir, "../../../lib/db/drizzle"),
    path.resolve(currentDir, "../../lib/db/drizzle"),
    path.resolve(currentDir, "../drizzle"),
  ];
  let migrationsFolder: string | undefined;
  for (const candidate of possiblePaths) {
    if (fs.existsSync(candidate)) {
      migrationsFolder = candidate;
      break;
    }
  }
  if (!migrationsFolder) {
    throw new Error(`Drizzle migrations folder not found. Checked: ${possiblePaths.join(", ")}`);
  }
  await migrate(db, { migrationsFolder });
}

export * from "./schema";
