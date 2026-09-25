/**
 * LeadSprint one-command demo.
 *
 * Boots the entire product locally with zero cloud dependencies and no
 * real phone calls:
 *
 *   1. Embedded PostgreSQL (PGlite behind a real TCP wire socket)
 *   2. Schema migrations
 *   3. Provider stubs standing in for Retell + Cal.com
 *   4. Production builds of the API server and operator console
 *   5. The API serving the console, seeded with the demo workspace,
 *      demo auth on, live calling routed to the stubs
 *
 *   pnpm demo            # boot (reuses the existing demo database)
 *   pnpm demo --reset    # boot with a fresh database
 *
 * Ports: DEMO_PORT (5000), DEV_PG_PORT (5433), STUB_PORT (5510).
 * Ctrl+C stops everything.
 *
 * This is the sales-demo boot path: it is deterministic, free, and never
 * dials a real phone. For a live provider call, see
 * docs/leadsprint-provider-setup.md and docs/sales-demo.md.
 */

import { spawn, execFile } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const DEMO_PORT = Number(process.env.DEMO_PORT ?? 5000);
const PG_PORT = Number(process.env.DEV_PG_PORT ?? 5433);
const STUB_PORT = Number(process.env.STUB_PORT ?? 5510);
const DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
const PG_DATA_DIR = path.join(REPO_ROOT, ".devdata", "pglite");
const STATIC_DIR = path.join(REPO_ROOT, "artifacts", "leadsprint", "dist", "public");
const RESET = process.argv.includes("--reset");

const children = [];
let shuttingDown = false;

function log(step, message) {
  console.log(`\x1b[36m[demo]\x1b[0m ${step.padEnd(8)} ${message}`);
}

function fail(message) {
  console.error(`\x1b[31m[demo] failed:\x1b[0m ${message}`);
  shutdown(1);
}

function track(name, child) {
  children.push({ name, child });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    fail(`${name} exited unexpectedly (code=${code} signal=${signal}). Stopping the demo.`);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("stop", "shutting down (Ctrl+C) …");
  for (const { child } of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already dead */
    }
  }
  setTimeout(() => {
    for (const { child } of children) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }
    process.exit(code);
  }, 1500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/** Wait until a TCP port on 127.0.0.1 accepts connections. */
async function waitForPort(port, what, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const open = await new Promise((resolve) => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (open) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`${what} did not start listening on 127.0.0.1:${port} within ${timeoutMs / 1000}s`);
}

/** Wait until an HTTP endpoint answers 2xx/3xx. */
async function waitForHttp(url, what, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        res.body?.cancel();
        return;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  fail(`${what} did not answer ${url} within ${timeoutMs / 1000}s`);
}

function pnpm(args, extraEnv = {}) {
  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return new Promise((resolve, reject) => {
    execFile(pnpmCmd, args, { cwd: REPO_ROOT, env: { ...process.env, ...extraEnv }, shell: process.platform === "win32" }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${pnpmBin(args)}: ${stderr || error.message}`));
      else resolve(stdout);
    });
  });
}

function pnpmBin(args) {
  return `pnpm ${args.join(" ")}`;
}

async function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function main() {
  for (const [name, port] of [["demo app", DEMO_PORT], ["dev postgres", PG_PORT], ["provider stubs", STUB_PORT]]) {
    if (await portInUse(port)) {
      fail(`port ${port} is already in use (${name}). Stop it, or override with DEMO_PORT / DEV_PG_PORT / STUB_PORT.`);
    }
  }

  if (!fs.existsSync(path.join(REPO_ROOT, "node_modules"))) {
    log("install", "node_modules missing — running pnpm install (first run can take a few minutes) …");
    await pnpm(["install"]);
    log("install", "done");
  }

  if (RESET) {
    fs.rmSync(PG_DATA_DIR, { recursive: true, force: true });
    log("reset", "removed .devdata/pglite — starting with a fresh demo database");
  } else {
    log("db", `reusing demo database at .devdata/pglite (pnpm demo --reset for a fresh one)`);
  }

  log("postgres", `starting embedded PostgreSQL on 127.0.0.1:${PG_PORT} …`);
  track("dev-postgres", spawn(process.execPath, [path.join(REPO_ROOT, "scripts/src/dev-postgres.mjs")], {
    env: { ...process.env, DEV_PG_PORT: String(PG_PORT), DEV_PG_DATA: PG_DATA_DIR },
    stdio: ["ignore", "inherit", "inherit"],
  }));
  await waitForPort(PG_PORT, "embedded PostgreSQL");
  log("postgres", "ready");

  // Migrations, not `drizzle-kit push`. Push bypasses Drizzle's journal,
  // so the API's own boot migrator would see a migration-naive database,
  // replay 0000, fail, and — before this fix — swallow the error. Any
  // migration added later would then never reach this database.
  log("schema", "applying migrations (drizzle-kit migrate) …");
  await pnpm(["--filter", "@workspace/db", "run", "migrate"], { DATABASE_URL });
  log("schema", "applied");

  log("stubs", `starting Retell/Cal.com provider stubs on 127.0.0.1:${STUB_PORT} …`);
  track("provider-stub", spawn(process.execPath, [path.join(REPO_ROOT, "scripts/src/provider-stub.mjs")], {
    env: { ...process.env, STUB_PORT: String(STUB_PORT) },
    stdio: ["ignore", "inherit", "inherit"],
  }));
  await waitForPort(STUB_PORT, "provider stubs");
  log("stubs", "ready (nothing dials a real phone)");

  log("build", "building operator console (Vite) …");
  await pnpm(["--filter", "@workspace/leadsprint", "run", "build"]);
  log("build", "building API server (esbuild) …");
  await pnpm(["--filter", "@workspace/api-server", "run", "build"]);
  log("build", "done");

  const apiEnv = {
    ...process.env,
    PORT: String(DEMO_PORT),
    // Demo auth is refused when NODE_ENV=production — this is a local demo.
    NODE_ENV: "development",
    DATABASE_URL,
    // The embedded dev database serves one connection at a time.
    DATABASE_POOL_MAX: "1",
    // Seeded demo workspace + unauthenticated console. Local use only.
    LEADSPRINT_DEMO_AUTH: "true",
    LEADSPRINT_DEMO_SEED: "true",
    LEAD_INTAKE_WEBHOOK_SECRET: "devsecret",
    CRON_SECRET: "devcron",
    // Live calling and booking routed to the stubs, never the real APIs.
    RETELL_API_URL: `http://127.0.0.1:${STUB_PORT}/retell`,
    RETELL_API_KEY: "stub_key",
    RETELL_AGENT_ID: "agent_stub",
    RETELL_FROM_NUMBER_US: "+12125550100",
    RETELL_WEBHOOK_SECRET: "retellsecret",
    CALCOM_API_URL: `http://127.0.0.1:${STUB_PORT}/cal`,
    CALCOM_API_KEY: "cal_stub",
    CALCOM_EVENT_TYPE_ID: "99",
    STATIC_DIR,
  };
  delete apiEnv.VITE_CLERK_PUBLISHABLE_KEY;

  log("api", `starting LeadSprint (API + console) on 127.0.0.1:${DEMO_PORT} …`);
  track("api-server", spawn(process.execPath, ["--enable-source-maps", path.join(REPO_ROOT, "artifacts/api-server/dist/index.mjs")], {
    cwd: REPO_ROOT,
    env: apiEnv,
    stdio: ["ignore", "inherit", "inherit"],
  }));
  await waitForHttp(`http://127.0.0.1:${DEMO_PORT}/api/healthz`, "LeadSprint");

  console.log("");
  console.log("\x1b[32m\x1b[1mLeadSprint demo is up.\x1b[0m");
  console.log("");
  console.log(`  Console:   http://127.0.0.1:${DEMO_PORT}/`);
  console.log(`  Health:    http://127.0.0.1:${DEMO_PORT}/api/healthz`);
  console.log(`  Readiness: http://127.0.0.1:${DEMO_PORT}/api/readyz   (auth=demo, retell+calcom=stubs)`);
  console.log("");
  console.log("  Demo walkthrough: docs/sales-demo.md");
  console.log("  Stop everything: Ctrl+C");
  console.log("");
}

main().catch((error) => fail(error?.stack ?? String(error)));

// Keep the process alive after the API is up; it exits only via shutdown().
setTimeout(() => {}, 1 << 30);
