import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db as defaultDb } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";
import { providerReadiness } from "../lib/providers";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type ReadinessDb = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

let readinessDb: ReadinessDb = defaultDb;

/** Test seam: swap the database /readyz pings. */
export function __setHealthDb(next: ReadinessDb): void {
  readinessDb = next;
}

export function __resetHealthDb(): void {
  readinessDb = defaultDb;
}

const READYZ_DB_TIMEOUT_MS_DEFAULT = 3000;

function readyzDbTimeoutMs(): number {
  const parsed = Number(process.env["READYZ_DB_TIMEOUT_MS"]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : READYZ_DB_TIMEOUT_MS_DEFAULT;
}

/** True when the database answers a trivial query before the timeout. */
async function databaseAnswers(): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      readinessDb.execute(sql`select 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("database check timed out")), readyzDbTimeoutMs());
      }),
    ]);
    return true;
  } catch (err) {
    // Logged for the operator; never echoed to the (unauthenticated) caller.
    logger.warn({ err }, "readyz: database check failed");
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Liveness: touches nothing, so a database outage never makes the platform
// restart a process that is otherwise healthy.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Readiness: also reports whether the database is answering, so an uptime
// monitor sees a database outage instead of a 200.
router.get("/readyz", async (_req, res) => {
  const market = _req.get("x-leadsprint-market") === "IN" ? "IN" : "US";
  const providers = providerReadiness(market);
  const demoAuth =
    process.env["LEADSPRINT_DEMO_AUTH"]?.trim().toLowerCase() === "true" &&
    process.env["NODE_ENV"] !== "production";
  const databaseOk = await databaseAnswers();
  res.status(databaseOk ? 200 : 503).json({
    status: databaseOk ? "ok" : "degraded",
    database: databaseOk ? "ok" : "unreachable",
    mode: Object.values(providers).every(Boolean) ? "live" : "demo",
    market,
    providers,
    auth: demoAuth
      ? "demo"
      : process.env["CLERK_SECRET_KEY"]?.trim()
        ? "clerk"
        : "unconfigured",
  });
});

export default router;
