import { Router, type IRouter } from "express";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import healthRouter from "./health";
import leadsprintRouter from "./leadsprint";
import webhooksRouter from "./webhooks";
import cronRouter from "./cron";
import { requireAuth } from "../middlewares/auth";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";

const router: IRouter = Router();

// Public / non-operator-session routes first: health checks, provider
// webhooks (authenticated by their own HMAC/Clerk-independent signatures),
// and scheduler cron endpoints (authenticated by CRON_SECRET). None of
// these should ever depend on Clerk being configured.
router.use(healthRouter);
router.use(webhooksRouter);
router.use(cronRouter);

// Everything below this line is the authenticated operator console API.
router.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);
router.use(requireAuth);
router.use(leadsprintRouter);

export default router;
