#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Delegate to the compiled standalone migration runner
const runnerPath = path.resolve(__dirname, "../artifacts/api-server/dist/migrate.mjs");
const { runMigrations } = await import(runnerPath);

runMigrations()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(`[migrate] Execution failed: ${err.message}`);
    process.exit(1);
  });
