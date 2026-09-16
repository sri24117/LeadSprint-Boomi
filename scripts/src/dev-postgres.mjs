/**
 * Local development PostgreSQL, no Docker required.
 *
 * Runs an embedded PGlite instance behind a real TCP wire-protocol socket,
 * so the app connects with an ordinary DATABASE_URL and exercises the same
 * pg driver, SQL and constraints it uses in production. Data is persisted
 * under .devdata/ so a restart keeps the workspace you configured.
 *
 *   node scripts/src/dev-postgres.mjs
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres
 *
 * This is a developer convenience only — production uses a real
 * PostgreSQL server (see the Coolify deploy notes).
 */

import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = Number(process.env.DEV_PG_PORT ?? 5433);
const DATA_DIR =
  process.env.DEV_PG_DATA ?? path.resolve(import.meta.dirname, "../../.devdata/pglite");

fs.mkdirSync(path.dirname(path.resolve(DATA_DIR)), { recursive: true });
const db = await PGlite.create({ dataDir: DATA_DIR });
const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
await server.start();

console.log(`[dev-postgres] listening on 127.0.0.1:${PORT} (data: ${DATA_DIR})`);
console.log(
  `[dev-postgres] DATABASE_URL=postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`,
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  });
}
