import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { logger } from "./lib/logger";

const { Pool } = pg;

export function sanitizeDatabaseUrl(url: string): string {
  return url.replace(/:\/\/[^:]+:([^@]+)@/, "://***:***@");
}

export function resolveMigrationsFolder(customDir?: string): string {
  if (customDir) {
    return path.resolve(customDir);
  }
  if (process.env.MIGRATIONS_DIR) {
    return path.resolve(process.env.MIGRATIONS_DIR);
  }

  // 1. Check relative to process.cwd() (standard in container /repo or root workspace)
  const cwdCandidate = path.resolve(process.cwd(), "lib/db/drizzle");
  if (fs.existsSync(path.join(cwdCandidate, "meta", "_journal.json"))) {
    return cwdCandidate;
  }

  // 2. Check relative to current file location / bundled output
  const thisDir =
    typeof __dirname !== "undefined"
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    path.resolve(thisDir, "../../lib/db/drizzle"),
    path.resolve(thisDir, "../../../lib/db/drizzle"),
    path.resolve(thisDir, "../lib/db/drizzle"),
    path.resolve(thisDir, "lib/db/drizzle"),
  ];

  for (const cand of candidates) {
    if (fs.existsSync(path.join(cand, "meta", "_journal.json"))) {
      return cand;
    }
  }

  return cwdCandidate;
}

export async function runMigrations(options?: {
  connectionString?: string;
  migrationsFolder?: string;
}): Promise<{ success: boolean; migrationsFolder: string }> {
  const connectionString =
    options?.connectionString ?? process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    const msg = "DATABASE_URL is required to run database migrations.";
    logger.error(msg);
    throw new Error(msg);
  }

  const migrationsFolder = resolveMigrationsFolder(options?.migrationsFolder);
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");

  if (!fs.existsSync(journalPath)) {
    const msg = `Migration journal not found at ${journalPath}`;
    logger.error({ migrationsFolder }, msg);
    throw new Error(msg);
  }

  logger.info(
    {
      migrationsFolder,
      target: sanitizeDatabaseUrl(connectionString),
    },
    "Starting database migration runner",
  );

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  try {
    await migrate(db, { migrationsFolder });
    logger.info({ migrationsFolder }, "Database migrations applied successfully");
    return { success: true, migrationsFolder };
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const safeMsg = sanitizeDatabaseUrl(rawMsg);
    logger.error({ err: safeMsg, migrationsFolder }, "Database migration execution failed");
    throw new Error(`Migration failed: ${safeMsg}`);
  } finally {
    await pool.end();
  }
}

// If executed as a CLI script directly
const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  runMigrations()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err: err.message }, "Migration runner exiting with code 1");
      process.exit(1);
    });
}
