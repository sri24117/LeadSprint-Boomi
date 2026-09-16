import cors from "cors";
import type { RequestHandler } from "express";

/**
 * Scoped CORS for the API server.
 *
 * The production shape is a single container serving the SPA and the API
 * from one origin (see STATIC_DIR in app.ts), so cross-origin access is
 * not needed there at all. The old `app.use(cors())` reflected ANY origin,
 * which would let a malicious site make an operator's browser call the
 * API with their session.
 *
 * Behaviour:
 * - CORS_ORIGINS set: allow exactly those origins (comma-separated,
 *   exact `scheme://host[:port]` match, no wildcards, no path). Malformed
 *   entries fail the boot loudly rather than silently narrowing access.
 * - CORS_ORIGINS unset + production: no CORS headers are emitted at all.
 *   Same-origin deployment is the only supported shape there.
 * - CORS_ORIGINS unset + non-production: loopback origins only
 *   (http/https on localhost, 127.0.0.1 or [::1], any port), so the local
 *   Vite dev server keeps working without opening anything to the LAN.
 *
 * A denied origin gets an immediate 403 JSON answer — a policy denial,
 * not a server fault, and deliberately not routed any further. (Letting
 * cors() itself deny would surface as a 500 through the error handler
 * and log every denied browser as an unhandled error.)
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      let url: URL;
      try {
        url = new URL(entry);
      } catch {
        throw new Error(
          `Invalid CORS_ORIGINS entry ${JSON.stringify(entry)}: not a URL. ` +
            `Expected comma-separated origins like "https://console.example.com,http://localhost:5173".`,
        );
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(
          `Invalid CORS_ORIGINS entry ${JSON.stringify(entry)}: only http(s) origins are allowed.`,
        );
      }
      if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
        throw new Error(
          `Invalid CORS_ORIGINS entry ${JSON.stringify(entry)}: origins must be scheme://host[:port] with no path, query, or credentials.`,
        );
      }
      // Normalise so "HTTPS://Example.COM:443/" and
      // "https://example.com" compare equal to the Origin header.
      return url.origin;
    });
}

export function isLoopbackOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

export type CorsPolicy =
  | { mode: "allowlist"; allowed: ReadonlySet<string> }
  | { mode: "loopback" }
  | { mode: "none" };

/** Resolve the effective policy for the given environment. Throws on a malformed allowlist. */
export function resolveCorsPolicy(env: NodeJS.ProcessEnv = process.env): CorsPolicy {
  const raw = env["CORS_ORIGINS"]?.trim();
  if (raw) {
    return { mode: "allowlist", allowed: new Set(parseAllowedOrigins(raw)) };
  }
  if (env["NODE_ENV"] === "production") {
    return { mode: "none" };
  }
  return { mode: "loopback" };
}

/**
 * The single allow/deny decision. An absent Origin header is not a CORS
 * request at all (curl, server-to-server, same-origin navigation) and is
 * always allowed through — CORS only governs what browsers send.
 */
export function isOriginAllowed(policy: CorsPolicy, origin: string | undefined): boolean {
  if (!origin) return true;
  switch (policy.mode) {
    case "allowlist":
      return policy.allowed.has(origin);
    case "loopback":
      return isLoopbackOrigin(origin);
    case "none":
      return false;
  }
}

/** Drop-in for the old bare `app.use(cors())`. Reads env at call time. */
export function createCorsMiddleware(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const policy = resolveCorsPolicy(env);
  const corsHandler = cors({
    origin: (origin, callback) => {
      // Unreachable for denied origins (the pre-check below answers 403
      // first), but fail closed anyway if the two ever disagree.
      if (!isOriginAllowed(policy, origin)) {
        callback(new Error(`Origin ${origin} is not allowed by this deployment's CORS policy`));
        return;
      }
      callback(null, true);
    },
    credentials: true,
  });
  return (req, res, next) => {
    const origin = req.get("Origin");
    if (!isOriginAllowed(policy, origin)) {
      res.status(403).json({
        error: `Origin ${origin} is not allowed by this deployment's CORS policy`,
      });
      return;
    }
    corsHandler(req, res, next);
  };
}
