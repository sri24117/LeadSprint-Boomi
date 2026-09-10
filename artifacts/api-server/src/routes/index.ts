import { Router, type IRouter } from "express";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import healthRouter from "./health";
import leadsprintRouter, {
  DEMO_BUSINESS_ID,
  DEMO_USER_ID,
  ensureSeedData,
} from "./leadsprint";
import webhooksRouter from "./webhooks";
import cronRouter from "./cron";
import { requireAuth } from "../middlewares/auth";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Public / non-operator-session routes first: health checks, provider
// webhooks (authenticated by their own HMAC/Clerk-independent signatures),
// and scheduler cron endpoints (authenticated by CRON_SECRET). None of
// these should ever depend on Clerk being configured.
router.use(healthRouter);
router.use(webhooksRouter);
router.use(cronRouter);

// Everything below this line is the authenticated operator console API.

/**
 * Local-only escape hatch: run the operator console against the seeded demo
 * workspace without a Clerk instance. Deliberately impossible to switch on
 * in a production deployment — it requires BOTH LEADSPRINT_DEMO_AUTH=true
 * and NODE_ENV !== "production", is evaluated once at boot, and logs loudly.
 * Never enable it on an internet-facing deployment: it hands every caller
 * the demo business's data with no authentication at all.
 */
function demoAuthRequested(): boolean {
  return process.env["LEADSPRINT_DEMO_AUTH"]?.trim().toLowerCase() === "true";
}

const demoAuthEnabled =
  demoAuthRequested() && process.env["NODE_ENV"] !== "production";

if (demoAuthRequested() && !demoAuthEnabled) {
  logger.error(
    "LEADSPRINT_DEMO_AUTH=true was ignored because NODE_ENV=production. " +
      "Demo auth is a local development shortcut only.",
  );
}

if (demoAuthEnabled) {
  logger.warn(
    "LEADSPRINT_DEMO_AUTH is enabled: the operator console API is UNAUTHENTICATED " +
      "and every request is treated as the seeded demo operator. Local use only.",
  );
  void ensureSeedData().catch((err) => {
    logger.error({ err }, "Demo seed data could not be created");
  });
  router.use((req, _res, next) => {
    req.leadSprintUserId = DEMO_USER_ID;
    req.leadSprintBusinessId = DEMO_BUSINESS_ID;
    next();
  });
} else {
  // Clerk's middleware throws ("Missing Clerk Secret Key") on every request
  // when CLERK_SECRET_KEY isn't set, which surfaced as an HTML 500 on every
  // operator-console route in an otherwise healthy demo-mode deployment.
  // Auth simply being unconfigured is a 401, not a server fault — fail closed
  // with a JSON body the frontend can read.
  router.use((_req, res, next) => {
    if (!process.env.CLERK_SECRET_KEY?.trim()) {
      res.status(401).json({
        error: "Authentication required",
        detail:
          "Clerk is not configured on this deployment (CLERK_SECRET_KEY is unset), so the operator console API is unavailable. Health, webhook, and cron endpoints still work.",
      });
      return;
    }
    next();
  });

  router.use(
    clerkMiddleware((req) => {
      // publishableKeyFromHost() throws on an empty host, so a request
      // without a Host header (HTTP/1.0 clients, some probes) must not
      // reach it.
      const host = getClerkProxyHost(req);
      return {
        publishableKey: host
          ? publishableKeyFromHost(host, process.env.CLERK_PUBLISHABLE_KEY)
          : process.env.CLERK_PUBLISHABLE_KEY,
      };
    }),
  );
  router.use(requireAuth);
}

router.use(leadsprintRouter);

// Unknown /api/* paths are an API error, not an SPA route: answer with JSON
// instead of falling through to Express's default HTML error page.
router.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default router;
