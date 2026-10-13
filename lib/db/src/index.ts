import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
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
//
// A connect timeout is always set: without one, a database host that
// silently drops packets leaves boot hanging forever — no error, no log
// line, just a container that never becomes healthy.
function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolvePoolSettings(env: NodeJS.ProcessEnv = process.env): {
  max: number;
  connectionTimeoutMillis: number;
} {
  return {
    max: positiveInteger(env.DATABASE_POOL_MAX, 10),
    connectionTimeoutMillis: positiveInteger(env.DATABASE_CONNECT_TIMEOUT_MS, 10_000),
  };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...resolvePoolSettings(),
});
export const db = drizzle(pool, { schema });

function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 8; depth += 1) {
    const { message, code, cause } = current as {
      message?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    if (typeof message === "string") parts.push(message);
    if (typeof code === "string") parts.push(code);
    current = cause;
  }
  return parts.join("\n");
}

/**
 * Turns a database connection failure into the one thing an operator should
 * change. Boot refuses to start on any of these (deliberately), and the
 * platform log otherwise shows only the raw driver error.
 *
 * Returns null when the error is not one we recognise. Never includes the
 * connection string, so it is safe to log.
 */
export function describeDbConnectionError(error: unknown): string | null {
  const text = errorChainText(error);

  if (
    /unable to verify the first certificate|self[- ]signed certificate|unable to get local issuer certificate|certificate (?:has expired|is not yet valid)|hostname\/IP does not match|SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(
      text,
    )
  ) {
    return (
      "The database's TLS certificate could not be verified. If Postgres is on your own " +
      "private network (for example a Coolify database) and uses a self-signed certificate, end " +
      "DATABASE_URL with ?uselibpqcompat=true&sslmode=require — that encrypts the connection " +
      "without verifying the server's identity. For a database across the public internet, " +
      "verify its CA instead (sslmode=verify-full with sslrootcert)."
    );
  }
  if (/password authentication failed|role ".*" does not exist|no pg_hba\.conf entry/i.test(text)) {
    return (
      "Postgres rejected the credentials in DATABASE_URL. Check the user and password " +
      "(URL-encode special characters, e.g. @ as %40). A Coolify Postgres applies its user and " +
      "password only when its data volume is first created, so changing them in the Coolify UI " +
      "later does not change the existing database — use the credentials it actually has."
    );
  }
  if (/does not support SSL/i.test(text)) {
    return (
      "The database server does not support SSL. Remove sslmode from DATABASE_URL, or use " +
      "sslmode=disable (private networks only)."
    );
  }
  if (/database ".*" does not exist/i.test(text)) {
    return (
      "The database name in DATABASE_URL (the last path segment) does not exist on that " +
      "server. Check the database name."
    );
  }
  if (/connection timeout|ETIMEDOUT|timeout expired/i.test(text)) {
    return (
      "The database did not answer in time (DATABASE_CONNECT_TIMEOUT_MS, default 10000). " +
      "Check that the host and port in DATABASE_URL are reachable from this container — on " +
      "Coolify, the same Docker network as the database."
    );
  }
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EHOSTUNREACH|getaddrinfo/i.test(text)) {
    return (
      "Could not reach the database host/port in DATABASE_URL. On Coolify use the database's " +
      "internal service name (not localhost) and confirm the port and that the database is running " +
      "on the same network."
    );
  }
  return null;
}

function migrationsFolderPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const possiblePaths = [
    path.resolve(process.cwd(), "lib/db/drizzle"),
    path.resolve(currentDir, "../../../lib/db/drizzle"),
    path.resolve(currentDir, "../../lib/db/drizzle"),
    path.resolve(currentDir, "../drizzle"),
  ];
  for (const candidate of possiblePaths) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Drizzle migrations folder not found. Checked: ${possiblePaths.join(", ")}`);
}

/**
 * Postgres "this object already exists" codes. Seeing one of these while a
 * migration is being *replayed from the top* is the signature of a database
 * that was provisioned without this migrator (see runMigrations).
 */
const ALREADY_EXISTS_CODES = new Set([
  "42P07", // duplicate_table
  "42P06", // duplicate_schema
  "42710", // duplicate_object (indexes, constraints)
  "42701", // duplicate_column
]);

export function isAlreadyProvisionedError(error: unknown): boolean {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  return codes.some((code) => ALREADY_EXISTS_CODES.has(code));
}

type AnyHandle = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

/** The tables every migration in the folder expects to exist. */
export function expectedTableNames(migrationsFolder: string): string[] {
  const names = new Set<string>();
  for (const migration of readMigrationFiles({ migrationsFolder })) {
    for (const statement of migration.sql) {
      const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z_][\w.]*)"?/gi;
      for (const match of statement.matchAll(pattern)) {
        const name = match[1];
        if (name) names.add(name.replace(/^public\./, "").replace(/"/g, ""));
      }
    }
  }
  return [...names];
}

async function tableExists(handle: AnyHandle, table: string): Promise<boolean> {
  const result = await handle.execute(
    sql`select to_regclass(${`public.${table}`}) is not null as present`,
  );
  return Boolean(rowsOf(result)[0]?.["present"]);
}

async function migrationJournalIsEmpty(handle: AnyHandle): Promise<boolean> {
  const result = await handle.execute(
    sql`select count(*)::int as count from information_schema.tables
        where table_schema = 'drizzle' and table_name = '__drizzle_migrations'`,
  );
  if (Number(rowsOf(result)[0]?.["count"] ?? 0) === 0) return true;
  const rows = await handle.execute(
    sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
  );
  return Number(rowsOf(rows)[0]?.["count"] ?? 0) === 0;
}

/**
 * Records the existing migrations as already applied, using Drizzle's own
 * `readMigrationFiles` so the hashes and timestamps match what its migrator
 * writes and expects.
 *
 * Only ever called once the caller has proved the schema is fully present
 * and the journal is empty — i.e. this database matches the migrations
 * exactly but has no history of them. Idempotent: re-running inserts
 * nothing.
 */
export async function baselineExistingSchema(
  handle: AnyHandle,
  migrationsFolder: string,
): Promise<number> {
  const migrations = readMigrationFiles({ migrationsFolder });
  await handle.execute(sql`create schema if not exists drizzle`);
  await handle.execute(sql`create table if not exists drizzle.__drizzle_migrations (
    id serial primary key,
    hash text not null,
    created_at bigint
  )`);
  const existing = await handle.execute(
    sql`select created_at from drizzle.__drizzle_migrations`,
  );
  const applied = new Set(
    rowsOf(existing).map((row) => String(row["created_at"])),
  );
  let inserted = 0;
  for (const migration of migrations) {
    if (applied.has(String(migration.folderMillis))) continue;
    await handle.execute(
      sql`insert into drizzle.__drizzle_migrations ("hash", "created_at")
          values (${migration.hash}, ${migration.folderMillis})`,
    );
    inserted += 1;
  }
  return inserted;
}

/**
 * Applies the migrations in `lib/db/drizzle` — the app owns its schema.
 *
 * A database that already has the schema but no migration history (created
 * by `drizzle-kit push`, or restored from a dump) needs adopting rather than
 * replaying: every statement in migration 0000 would fail with "already
 * exists" and, because the migrator runs in a single transaction, *every
 * future migration would be blocked forever* on that database. So when a
 * replay fails on an already-exists error — and only then, and only after
 * proving that every table the migrations expect is present while the
 * journal is empty — the existing migrations are recorded as applied and
 * the migrator is retried, which then applies only genuinely new work.
 *
 * Anything else still throws, and the caller (artifacts/api-server) refuses
 * to serve on it: a database whose schema cannot be verified must not take
 * live calls.
 */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = migrationsFolderPath();
  try {
    await migrate(db, { migrationsFolder });
    return;
  } catch (error) {
    if (!isAlreadyProvisionedError(error)) throw error;

    const expected = expectedTableNames(migrationsFolder);
    const missing: string[] = [];
    for (const table of expected) {
      if (!(await tableExists(db as unknown as AnyHandle, table))) missing.push(table);
    }
    const adoptable = missing.length === 0 && (await migrationJournalIsEmpty(db as unknown as AnyHandle));
    if (!adoptable) {
      // Not the fingerprint of an out-of-band-provisioned database: the
      // schema is partial or history already exists. Never guess here.
      throw error;
    }

    const recorded = await baselineExistingSchema(
      db as unknown as AnyHandle,
      migrationsFolder,
    );
    console.warn(
      `[db] This database already had the schema but no migration history ` +
        `(provisioned outside the migrator, e.g. \`drizzle-kit push\`). ` +
        `Recorded ${recorded} existing migration(s) as applied so future ` +
        `migrations can run. From now on use \`pnpm --filter @workspace/db run migrate\`.`,
    );
    await migrate(db, { migrationsFolder });
  }
}

export * from "./schema";
