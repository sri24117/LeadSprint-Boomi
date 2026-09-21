import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { WorkspaceScopeError } from "./routes/leadsprint";
import { logger } from "./lib/logger";
import { createCorsMiddleware } from "./middlewares/cors";
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
// Scoped CORS (middlewares/cors.ts): exact-allowlist when CORS_ORIGINS is
// set, loopback-only in non-production, no CORS headers at all in
// production. The old bare cors() reflected any origin.
app.use(createCorsMiddleware());
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
    if (res.headersSent) return;
    // A request that reached a handler with no resolved workspace is an
    // auth problem, not a server fault — and it must never be answered
    // with another tenant's (or the demo workspace's) data. See
    // WorkspaceScopeError in routes/leadsprint.ts.
    if (err instanceof WorkspaceScopeError) {
      req.log?.warn({ err: err.message }, "Request had no workspace scope");
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log?.error({ err }, "Unhandled API error");
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
    res.sendFile("index.html", { root: resolvedStaticDir });
  });
}

export default app;
