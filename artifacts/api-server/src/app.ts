import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

// Production runs behind a TLS-terminating reverse proxy (Coolify/Traefik),
// so req.protocol / req.ip must come from the X-Forwarded-* headers —
// otherwise the Twilio webhook signature (which is computed over the public
// https:// URL) can never validate. Configurable because "how many proxy
// hops to trust" is deployment-specific; set TRUST_PROXY=false when the app
// is exposed directly.
const trustProxy = process.env["TRUST_PROXY"] ?? "1";
app.set(
  "trust proxy",
  trustProxy === "false"
    ? false
    : trustProxy === "true"
      ? true
      : Number.isNaN(Number(trustProxy))
        ? trustProxy
        : Number(trustProxy),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// --- CORS configuration ---
// In production: allow only explicitly configured origins (comma-separated).
// In development: allow localhost / 127.0.0.1 dev servers.
// Same-origin requests (no Origin header) are always allowed.
const isProduction = process.env["NODE_ENV"] === "production";
const configuredOrigins = (process.env["CORS_ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const devOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  cors({
    origin(origin, callback) {
      // Server-to-server / same-origin requests have no Origin header — allow.
      if (!origin) {
        callback(null, true);
        return;
      }
      // Explicitly configured origins always pass.
      if (configuredOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // In development, allow localhost / 127.0.0.1 on any port.
      if (!isProduction && devOriginPattern.test(origin)) {
        callback(null, true);
        return;
      }
      // Reject unconfigured origins.
      callback(new Error("CORS: origin not allowed"), false);
    },
    credentials: true,
  }),
);

app.use(express.json({
  verify: (req, _res, buffer) => {
    (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
}));
app.use(
  express.urlencoded({
    extended: true,
    verify: (req, _res, buffer) => {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }),
);

// --- Rate limiting: webhooks (120 req/min/IP) ---
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many webhook requests, please try again later" },
  keyGenerator: (req) => req.ip ?? "unknown",
});
app.use("/api/webhooks", webhookLimiter);

// --- Rate limiting: cron (20 req/min/IP) ---
const cronLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many cron requests, please try again later" },
  keyGenerator: (req) => req.ip ?? "unknown",
});
app.use("/api/cron", cronLimiter);

// NOTE: Clerk's auth middleware is intentionally NOT mounted globally here.
// It throws synchronously on every request when CLERK_SECRET_KEY isn't
// set, which previously took down /api/healthz, the provider webhooks,
// and the /api/cron/* endpoints too — none of which need (or should
// depend on) Clerk being configured. It's applied instead in
// routes/index.ts, scoped to only the operator-console routes that
// actually require a session. See requireAuth in middlewares/auth.ts.

app.use("/api", router);

// API errors must stay JSON. Express's default handler renders an HTML error
// page (including the stack trace outside production), which is both a leak
// and unparseable for the operator console's fetch client.
app.use(
  "/api",
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    req.log?.error({ err }, "Unhandled API error");
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  },
);

// Single-container deployment (e.g. Coolify): the frontend's static build
// is copied to STATIC_DIR (see the production Dockerfile) and served from
// the same process/port as the API. This is skipped entirely if STATIC_DIR
// isn't set, so local `pnpm dev` (frontend on Vite's own dev server) and
// any split frontend/backend deployment are unaffected.
const staticDir = process.env["STATIC_DIR"];
if (staticDir) {
  const resolvedStaticDir = path.isAbsolute(staticDir)
    ? staticDir
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), staticDir);
  app.use(express.static(resolvedStaticDir, { index: false }));
  // SPA fallback — any non-API, non-file GET request resolves to index.html
  // so client-side routing (operator console deep links) works on refresh.
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(resolvedStaticDir, "index.html"));
  });
}

export default app;
