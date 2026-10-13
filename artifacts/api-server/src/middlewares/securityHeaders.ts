import type { NextFunction, Request, Response } from "express";

/**
 * Baseline response hardening for the API and the static console.
 *
 * Deliberately no Content-Security-Policy: the console loads Clerk's hosted
 * scripts and Tailwind's runtime styles, and an unproven policy would lock
 * operators out of production. Add one only after exercising a real Clerk
 * sign-in against it (see docs/coolify-deploy.md).
 */
export function securityHeaders(env: NodeJS.ProcessEnv = process.env) {
  const isProduction = env["NODE_ENV"] === "production";

  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    // Browsers ignore HSTS over plain HTTP, so sending it unconditionally in
    // production is safe behind the TLS-terminating proxy.
    if (isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    // Operator data must not sit in a browser or shared cache. Static assets
    // keep their normal caching, so this is scoped to the API.
    if (req.path === "/api" || req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  };
}
