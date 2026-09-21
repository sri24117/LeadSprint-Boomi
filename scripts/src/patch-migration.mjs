import fs from "node:fs";
import path from "node:path";

const migrationFile = path.resolve(import.meta.dirname, "../../lib/db/drizzle/0000_nifty_vivisector.sql");
let sql = fs.readFileSync(migrationFile, "utf8");

sql = sql.replaceAll('CREATE TABLE "', 'CREATE TABLE IF NOT EXISTS "');
sql = sql.replaceAll('CREATE UNIQUE INDEX "', 'CREATE UNIQUE INDEX IF NOT EXISTS "');
sql = sql.replaceAll('CREATE INDEX "', 'CREATE INDEX IF NOT EXISTS "');

// Safely wrap each ALTER TABLE ADD CONSTRAINT in a DO block
sql = sql.replace(/ALTER TABLE ([^;]+ADD CONSTRAINT [^;]+);/g, (match, p1) => {
  return `DO $$ BEGIN\n  ALTER TABLE ${p1};\nEXCEPTION\n  WHEN duplicate_object THEN null;\nEND $$;`;
});

fs.writeFileSync(migrationFile, sql, "utf8");
console.log("Migration patched successfully!");
