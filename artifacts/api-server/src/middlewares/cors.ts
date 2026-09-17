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
 * - Any mode: a request whose Origin matches this deployment's own origin
 *   is a same-origin call, not a CORS call, and always passes (with no
 *   CORS headers — browsers never read them there). Without this the
 *   single-container production shape above 403'd every mutating call
 *   from its own console: browsers attach Origin to every request whose
 *   method is not GET/HEAD, same-origin included. See isSameOriginRequest.
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
 * The single allow/deny decision for *cross-origin* requests. An absent
 * Origin header is not a CORS request at all (curl, server-to-server,
 * same-origin navigation) and is always allowed through — CORS only governs
 * what browsers send. A present Origin that matches this deployment's own
 * origin is not a policy question either; the middleware settles that with
 * isSameOriginRequest before consulting this.
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

/**
 * The part of an Express request this file reasons about. Kept structural
 * (rather than `Request`) so the same-origin decision is unit-testable
 * without booting a server.
 */
export interface RequestOriginView {
  /** Express's trust-proxy-aware scheme: "http" | "https". */
  protocol: string;
  /** Express's trust-proxy-aware authority, including a non-default port. */
  host: string;
}

/** Normalise an origin the way URL does: lowercase host, drop default ports. */
function normalizeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    // "null" (sandboxed iframe, file://) and anything else unparseable.
    return undefined;
  }
}

/** This deployment's own origin, as a browser served from it would state it. */
export function ownOriginOf(req: RequestOriginView): string | undefined {
  if (!req.host) return undefined;
  return normalizeOrigin(`${req.protocol}://${req.host}`);
}

/**
 * Is this request from the deployment's own origin?
 *
 * `req.protocol` and `req.host` are Express's trust-proxy-aware getters, so
 * the comparison is against the *public* origin: behind the TLS-terminating
 * proxy (TRUST_PROXY=1, the production default) they come from
 * X-Forwarded-Proto / X-Forwarded-Host, and with TRUST_PROXY=false those
 * headers are ignored, so a client cannot forge a same-origin match.
 *
 * Honouring the forwarded headers cannot open a CORS hole either: a browser
 * will not put X-Forwarded-* on a cross-site request without a preflight, and
 * the preflight itself carries no custom headers — it is judged on its Origin
 * alone and denied by the policy. An opaque `Origin: null` is never
 * same-origin.
 */
export function isSameOriginRequest(
  req: RequestOriginView,
  origin: string | undefined,
): boolean {
  if (!origin) return false;
  const requested = normalizeOrigin(origin);
  if (!requested) return false;
  return ownOriginOf(req) === requested;
}

/** Drop-in for the old bare `app.use(cors())`. Reads env at call time. */
export function createCorsMiddleware(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const policy = resolveCorsPolicy(env);
  const corsHandler = cors({
    origin: (origin, callback) => {
      // Unreachable: the middleware only hands cors() requests the policy
      // already allowed. Fail closed anyway if the two ever disagree.
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
    if (isOriginAllowed(policy, origin)) {
      // Cross-origin and explicitly allowed: emit the Access-Control-* headers.
      corsHandler(req, res, next);
      return;
    }
    if (isSameOriginRequest(req, origin)) {
      // The console calling the API it was served from. Not a CORS request,
      // so it needs no headers and gets none — this is what keeps the
      // single-container production deployment working.
      next();
      return;
    }
    res.status(403).json({
      error: `Origin ${origin} is not allowed by this deployment's CORS policy`,
    });
  };
}
