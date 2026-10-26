/**
 * Schema for the vertical profile feature (spec §5.2), checked two ways:
 *
 *  1. the REAL migration files, applied to a fresh database, produce the new
 *     columns with the right nullability and defaults;
 *  2. the hand-written test DDL in testDb.ts produces the same columns, so the
 *     rest of the suite is exercising the production schema and not a lookalike.
 *
 * (2) is a drift guard: testDb.ts is written by hand, and a column added to the
 * schema and the migration but forgotten there would make tests pass against a
 * database production does not have.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createTestDb } from "./testDb";

const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../lib/db/drizzle",
);

type Column = { column_name: string; data_type: string; is_nullable: string; column_default: string | null };

async function migratedDatabase() {
  const client = new PGlite();
  for (const file of fs.readdirSync(MIGRATIONS_FOLDER).filter((name) => name.endsWith(".sql")).sort()) {
    await client.exec(
      fs.readFileSync(path.join(MIGRATIONS_FOLDER, file), "utf8").split("--> statement-breakpoint").join("\n"),
    );
  }
  return drizzle(client);
}

async function columnsOf(db: ReturnType<typeof drizzle>, table: string): Promise<Column[]> {
  const result = await db.execute(
    sql`select column_name, data_type, is_nullable, column_default
        from information_schema.columns
        where table_schema = 'public' and table_name = ${table}
        order by column_name`,
  );
  return (result as unknown as { rows: Column[] }).rows;
}

const NEW_COLUMNS: Array<{ table: string; name: string; type: string; nullable: boolean; defaultContains?: string }> = [
  { table: "businesses", name: "vertical", type: "text", nullable: false, defaultContains: "real_estate" },
  { table: "businesses", name: "notify_email", type: "text", nullable: true },
  { table: "businesses", name: "service_area_zips", type: "jsonb", nullable: false, defaultContains: "[]" },
  { table: "businesses", name: "pricing_policy", type: "text", nullable: true },
  { table: "leads", name: "details", type: "jsonb", nullable: false, defaultContains: "{}" },
  { table: "leads", name: "urgency", type: "text", nullable: true },
  { table: "contacts", name: "consent_evidence", type: "text", nullable: true },
];

describe("vertical profile columns", () => {
  it("are created by the real migrations with the specified types, nullability and defaults", async () => {
    const db = await migratedDatabase();
    for (const expected of NEW_COLUMNS) {
      const column = (await columnsOf(db, expected.table)).find((c) => c.column_name === expected.name);
      const label = `${expected.table}.${expected.name}`;
      expect(column, `${label} exists in the migrations`).toBeDefined();
      expect(column?.data_type, `${label} type`).toBe(expected.type);
      expect(column?.is_nullable === "YES", `${label} nullable`).toBe(expected.nullable);
      if (expected.defaultContains) {
        expect(column?.column_default ?? "", `${label} default`).toContain(expected.defaultContains);
      }
    }
  });

  it("exist in the test database too, so the suite runs against the production shape", async () => {
    const db = await createTestDb();
    for (const expected of NEW_COLUMNS) {
      const column = (await columnsOf(db as never, expected.table)).find((c) => c.column_name === expected.name);
      expect(column, `${expected.table}.${expected.name} exists in testDb DDL`).toBeDefined();
    }
  });

  it("leave existing rows valid: a business and lead written without them get the defaults", async () => {
    const db = await migratedDatabase();
    await db.execute(sql`insert into businesses (id, name, phone_number, transfer_number, project_name)
                         values ('b1', 'Old Realty', '+12125550100', '+12125550101', 'Spring')`);
    await db.execute(sql`insert into contacts (id, business_id, name, phone) values ('c1', 'b1', 'Dana', '+12125550111')`);
    await db.execute(sql`insert into leads (id, business_id, contact_id, project, property_type, budget_label, location, timeline)
                         values ('l1', 'b1', 'c1', 'p', 'Condo', 'n/a', 'n/a', 'n/a')`);
    const business = ((await db.execute(sql`select vertical, notify_email, service_area_zips, pricing_policy from businesses`)) as unknown as { rows: Array<Record<string, unknown>> }).rows[0];
    expect(business).toEqual({ vertical: "real_estate", notify_email: null, service_area_zips: [], pricing_policy: null });
    const lead = ((await db.execute(sql`select details, urgency from leads`)) as unknown as { rows: Array<Record<string, unknown>> }).rows[0];
    expect(lead).toEqual({ details: {}, urgency: null });
  });

  it("keep the test DDL and the migrations in agreement on every column of the touched tables", async () => {
    const migrated = await migratedDatabase();
    const test = await createTestDb();
    for (const table of ["businesses", "contacts", "leads"]) {
      const shape = (columns: Column[]) => columns.map((c) => `${c.column_name}:${c.data_type}:${c.is_nullable}`);
      expect(shape(await columnsOf(test as never, table)), `${table} columns match`).toEqual(
        shape(await columnsOf(migrated, table)),
      );
    }
  });
});
