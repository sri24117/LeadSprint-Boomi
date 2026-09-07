import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

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
app.use(cors());
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
