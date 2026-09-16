import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";

/**
 * Rate limiting for the unauthenticated-by-session surfaces: provider
 * webhooks, Retell agent tool endpoints, and scheduler cron endpoints.
 * All three are reachable without an operator session (they use their own
 * HMAC/shared-secret auth), so without a limiter a misconfigured sender —
 * or a deliberate flood — burns database and provider budget at full
 * speed before any signature check can say no.
 *
 * Limits are per client IP per window. Counts live in process memory,
 * which is correct for the single-container pilot deployment; a
 * multi-instance deployment must swap in a shared store (the Redis
 * RateLimitStore from `rate-limit-redis`) or each instance enforces its
 * own budget. The window and each ceiling are env-overridable so load
 * tests and the test suite can shrink them without touching code.
 *
 * Defaults (per IP, per 15 minutes):
 * - webhooks: 600 — generous on purpose. Providers retry in bursts and a
 *   bulk lead push is legitimate traffic; this caps floods, not usage.
 * - agent: 300 — mid-call tool use is a handful of requests per call.
 * - cron: 60 — the scheduler calls each endpoint a few times an hour.
 */

const WINDOW_MS_DEFAULT = 15 * 60 * 1000;
const WEBHOOK_MAX_DEFAULT = 600;
const AGENT_MAX_DEFAULT = 300;
const CRON_MAX_DEFAULT = 60;

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${name}=${JSON.stringify(raw)}: expected a positive integer.`,
    );
  }
  return parsed;
}

function windowMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env["RATE_LIMIT_WINDOW_MS"], WINDOW_MS_DEFAULT, "RATE_LIMIT_WINDOW_MS");
}

function limiter(max: number, window: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs: window,
    limit: max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // The API speaks JSON everywhere (see app.ts's error handler); a
    // plain-text 429 would break the console's fetch client contract.
    message: { error: "Too many requests — backing off and retrying is safe; all of these endpoints are idempotent or read-only." },
  });
}

/** POST /api/webhooks/* — provider callbacks and lead intake. */
export function createWebhookLimiter(env: NodeJS.ProcessEnv = process.env): RateLimitRequestHandler {
  return limiter(
    positiveInt(env["RATE_LIMIT_WEBHOOK_MAX"], WEBHOOK_MAX_DEFAULT, "RATE_LIMIT_WEBHOOK_MAX"),
    windowMs(env),
  );
}

/** POST /api/agent/* — Retell mid-call tool endpoints. */
export function createAgentLimiter(env: NodeJS.ProcessEnv = process.env): RateLimitRequestHandler {
  return limiter(
    positiveInt(env["RATE_LIMIT_AGENT_MAX"], AGENT_MAX_DEFAULT, "RATE_LIMIT_AGENT_MAX"),
    windowMs(env),
  );
}

/** POST /api/cron/* — scheduler endpoints (x-cron-secret authed). */
export function createCronLimiter(env: NodeJS.ProcessEnv = process.env): RateLimitRequestHandler {
  return limiter(
    positiveInt(env["RATE_LIMIT_CRON_MAX"], CRON_MAX_DEFAULT, "RATE_LIMIT_CRON_MAX"),
    windowMs(env),
  );
}
