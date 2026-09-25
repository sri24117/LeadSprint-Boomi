/**
 * Migration adoption.
 *
 * The hazard this locks down (P2-7 in
 * docs/market-readiness-review-2026-09-25.md): a database provisioned with
 * `drizzle-kit push` — which the old README told operators to run before
 * the first deploy — has the full schema but an empty Drizzle journal.
 * Replaying migration 0000 against it fails on the first `CREATE TABLE`,
 * and because the migrator runs in one transaction, *every future
 * migration is silently blocked on that database forever*.
 *
 * The first half of the test reproduces exactly that, against Drizzle's own
 * PGlite migrator. The second half proves adoption: once the existing
 * migrations are recorded as applied, the migrator runs clean and applies
 * only genuinely new work. The live wiring (a push-created server database
 * booting instead of refusing to start, and a *partial* schema still
 * refusing) is verified against the real embedded PostgreSQL — see the
 * review document §6.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import {
  baselineExistingSchema,
  expectedTableNames,
  isAlreadyProvisionedError,
} from "@workspace/db";

const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../lib/db/drizzle",
);

/** A database built from the migration SQL alone, with no journal — i.e. `push`. */
async function pushedDatabase() {
  const client = new PGlite();
  for (const file of fs.readdirSync(MIGRATIONS_FOLDER).filter((name) => name.endsWith(".sql")).sort()) {
    await client.exec(
      fs
        .readFileSync(path.join(MIGRATIONS_FOLDER, file), "utf8")
        .split("--> statement-breakpoint")
        .join("\n"),
    );
  }
  return { client, db: drizzle(client) };
}

async function journalRows(db: ReturnType<typeof drizzle>) {
  const result = await db.execute(
    sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`,
  );
  return (result as unknown as { rows: Array<{ hash: string; created_at: string }> }).rows;
}

describe("isAlreadyProvisionedError", () => {
  it("recognises postgres duplicate-object codes, including through a wrapper", () => {
    expect(isAlreadyProvisionedError({ code: "42P07" })).toBe(true);
    expect(isAlreadyProvisionedError({ code: "42710" })).toBe(true);
    expect(
      isAlreadyProvisionedError({ message: "wrap", cause: { cause: { code: "42P07" } } }),
    ).toBe(true);
  });

  it("ignores unrelated failures, so a real problem is never mistaken for adoption", () => {
    expect(isAlreadyProvisionedError({ code: "28P01" })).toBe(false); // bad password
    expect(isAlreadyProvisionedError({ code: "ECONNREFUSED" })).toBe(false);
    expect(isAlreadyProvisionedError(new Error("no code"))).toBe(false);
    expect(isAlreadyProvisionedError(undefined)).toBe(false);
  });
});

describe("expectedTableNames", () => {
  it("lists every table the migration folder creates", () => {
    const tables = expectedTableNames(MIGRATIONS_FOLDER);
    // A partial schema could never be adopted: these all have to be present.
    for (const table of [
      "businesses",
      "users",
      "contacts",
      "leads",
      "calls",
      "appointments",
      "activities",
      "provider_events",
      "suppressions",
      "usage",
      "workflow_jobs",
    ]) {
      expect(tables).toContain(table);
    }
    expect(tables.length).toBeGreaterThanOrEqual(11);
  });
});

describe("adopting a database that was provisioned without the migrator", () => {
  it("cannot be migrated before adoption, and migrates cleanly after", async () => {
    const { client, db } = await pushedDatabase();

    // Before: replaying the migrations is impossible — the schema is there,
    // the history is not. This is the production hazard.
    await expect(migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })).rejects.toThrow();

    const recorded = await baselineExistingSchema(db, MIGRATIONS_FOLDER);
    expect(recorded).toBeGreaterThanOrEqual(1);

    // After: the migrator sees the recorded history and has nothing new to
    // do — which is what unblocks every future migration.
    await expect(
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    ).resolves.toBeUndefined();

    const rows = await journalRows(db);
    expect(rows).toHaveLength(recorded);
    await client.close();
  });

  it("is idempotent — adopting twice does not duplicate history", async () => {
    const { client, db } = await pushedDatabase();
    const first = await baselineExistingSchema(db, MIGRATIONS_FOLDER);
    const second = await baselineExistingSchema(db, MIGRATIONS_FOLDER);
    expect(second).toBe(0);
    const rows = await journalRows(db);
    expect(rows).toHaveLength(first);
    await client.close();
  });
});
