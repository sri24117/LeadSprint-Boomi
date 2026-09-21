import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PG_PORT = 5439;
const DATA_DIR = path.resolve(__dirname, "../../.devdata/pglite");

console.log("[start-demo] Starting embedded dev-postgres on 127.0.0.1:" + PG_PORT + "...");
fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
const pgliteDb = await PGlite.create({ dataDir: DATA_DIR });
const pgServer = new PGLiteSocketServer({
  db: pgliteDb,
  port: PG_PORT,
  host: "127.0.0.1",
  maxConnections: 20,
});
await pgServer.start();
console.log("[start-demo] dev-postgres ready on port " + PG_PORT);

process.env.PORT = process.env.PORT || "5000";
process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
process.env.DATABASE_POOL_MAX = "10";
process.env.LEADSPRINT_DEMO_AUTH = "true";
process.env.LEADSPRINT_DEMO_SEED = "true";
process.env.LEAD_INTAKE_WEBHOOK_SECRET = process.env.LEAD_INTAKE_WEBHOOK_SECRET || "devsecret";
process.env.CRON_SECRET = process.env.CRON_SECRET || "devcron";
process.env.ENABLE_INTERNAL_WORKER = "true";   // auto-dispatch calls every 30s — no external cron needed
process.env.STATIC_DIR = path.resolve(__dirname, "../../artifacts/leadsprint/dist/public");

console.log("[start-demo] Starting LeadSprint API & Console on http://localhost:" + process.env.PORT);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    try {
      await pgServer.stop();
      await pgliteDb.close();
    } catch {}
    process.exit(0);
  });
}

await import("../../artifacts/api-server/dist/index.mjs");
