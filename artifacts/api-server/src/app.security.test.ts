import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import supertest from "supertest";

/**
 * Security integration tests for CORS and rate limiting.
 *
 * Uses a minimal Express app that mirrors the real app's CORS and rate-limit
 * configuration but does NOT import routes, database, or Clerk — so these
 * tests are fully self-contained and fast.
 */

function createTestApp(opts: {
  nodeEnv?: string;
  corsAllowedOrigins?: string;
}) {
  const app = express();
  const isProduction = opts.nodeEnv === "production";
  const configuredOrigins = (opts.corsAllowedOrigins ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const devOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (configuredOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        if (!isProduction && devOriginPattern.test(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("CORS: origin not allowed"), false);
      },
      credentials: true,
    }),
  );

  app.use(express.json());

  // Webhook rate limiter: 5 req/window for fast testing
  const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many webhook requests, please try again later" },
    keyGenerator: () => "test-ip",
  });
  app.use("/api/webhooks", webhookLimiter);

  // Cron rate limiter: 3 req/window for fast testing
  const cronLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 3,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many cron requests, please try again later" },
    keyGenerator: () => "test-ip",
  });
  app.use("/api/cron", cronLimiter);

  // Test endpoints
  app.get("/api/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.post("/api/webhooks/intake", (_req, res) => {
    res.json({ received: true });
  });
  app.post("/api/webhooks/retell", (_req, res) => {
    res.json({ received: true });
  });
  app.post("/api/cron/process-jobs", (_req, res) => {
    res.json({ processed: true });
  });
  app.get("/api/leads", (_req, res) => {
    res.json({ leads: [] });
  });

  // CORS error handler (Express surfaces CORS errors as middleware errors)
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err.message.includes("CORS")) {
        res.status(403).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}

// ============================================================
// CORS Tests
// ============================================================
describe("CORS Policy", () => {
  describe("Production mode", () => {
    const app = createTestApp({
      nodeEnv: "production",
      corsAllowedOrigins: "https://app.leadsprint.io,https://staging.leadsprint.io",
    });

    it("allows configured production origin", async () => {
      const res = await supertest(app)
        .get("/api/healthz")
        .set("Origin", "https://app.leadsprint.io");
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(
        "https://app.leadsprint.io",
      );
    });

    it("allows second configured origin", async () => {
      const res = await supertest(app)
        .get("/api/healthz")
        .set("Origin", "https://staging.leadsprint.io");
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(
        "https://staging.leadsprint.io",
      );
    });

    it("rejects unconfigured origin in production", async () => {
      const res = await supertest(app)
        .get("/api/healthz")
        .set("Origin", "https://evil-site.com");
      expect(res.status).toBe(403);
    });

    it("rejects localhost in production", async () => {
      const res = await supertest(app)
        .get("/api/healthz")
        .set("Origin", "http://localhost:5173");
      expect(res.status).toBe(403);
    });

    it("allows same-origin requests (no Origin header)", async () => {
      const res = await supertest(app).get("/api/healthz");
      expect(res.status).toBe(200);
    });

    it("does not set wildcard * in production", async () => {
      const res = await supertest(app)
        .get("/api/healthz")
        .set("Origin", "https://app.leadsprint.io");
      expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    });

    it("includes credentials support", async () => {
      const res = await supertest(app)
        .get("/api/healthz")
        .set("Origin", "https://app.leadsprint.io");
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });
  });

  describe("Development mode", () => {
    const app = createTestApp({
      nodeEnv: "development",
      corsAllowedOrigins: "",
    });

    it("allows localhost in development", async () => {
      const res = await supertest(app)
        .get("/api/healthz")
        .set("Origin", "http://localhost:5173");
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(
        "http://localhost:5173",
      );
    });

    it("allows 127.0.0.1 in development", async () => {
      const res = await supertest(app)
        .get("/api/healthz")
        .set("Origin", "http://127.0.0.1:3000");
      expect(res.status).toBe(200);
    });

    it("still rejects unknown external origins in development", async () => {
      const res = await supertest(app)
        .get("/api/healthz")
        .set("Origin", "https://random-external.com");
      expect(res.status).toBe(403);
    });
  });
});

// ============================================================
// Rate Limiting Tests
// ============================================================
describe("Rate Limiting", () => {
  describe("Webhook endpoint rate limit", () => {
    it("accepts requests within limit and returns 429 after exceeding", async () => {
      // Fresh app per test to reset rate-limit counters
      const app = createTestApp({ nodeEnv: "development" });
      const agent = supertest(app);

      // First 5 requests should succeed (limit is 5 for test)
      for (let i = 0; i < 5; i++) {
        const res = await agent
          .post("/api/webhooks/intake")
          .send({ test: true });
        expect(res.status).toBe(200);
      }

      // 6th request should be rate-limited
      const blocked = await agent
        .post("/api/webhooks/intake")
        .send({ test: true });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toContain("Too many webhook requests");
    });
  });

  describe("Cron endpoint rate limit", () => {
    it("has its own separate limit and returns 429 after exceeding", async () => {
      const app = createTestApp({ nodeEnv: "development" });
      const agent = supertest(app);

      // First 3 requests should succeed (limit is 3 for test)
      for (let i = 0; i < 3; i++) {
        const res = await agent
          .post("/api/cron/process-jobs")
          .send({ test: true });
        expect(res.status).toBe(200);
      }

      // 4th request should be rate-limited
      const blocked = await agent
        .post("/api/cron/process-jobs")
        .send({ test: true });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toContain("Too many cron requests");
    });
  });

  describe("Normal API endpoints are NOT rate-limited", () => {
    it("healthz is not affected by webhook/cron limiters", async () => {
      const app = createTestApp({ nodeEnv: "development" });
      const agent = supertest(app);

      // Exhaust webhook and cron limits
      for (let i = 0; i < 6; i++) {
        await agent.post("/api/webhooks/intake").send({});
      }
      for (let i = 0; i < 4; i++) {
        await agent.post("/api/cron/process-jobs").send({});
      }

      // Healthz should still respond 200
      const res = await agent.get("/api/healthz");
      expect(res.status).toBe(200);
    });

    it("leads endpoint is not affected by webhook/cron limiters", async () => {
      const app = createTestApp({ nodeEnv: "development" });
      const agent = supertest(app);

      // Exhaust webhook limits
      for (let i = 0; i < 6; i++) {
        await agent.post("/api/webhooks/intake").send({});
      }

      // Dashboard route should still respond 200
      const res = await agent.get("/api/leads");
      expect(res.status).toBe(200);
    });
  });

  describe("Webhook and cron limits are independent", () => {
    it("exhausting webhook limit does not affect cron limit", async () => {
      const app = createTestApp({ nodeEnv: "development" });
      const agent = supertest(app);

      // Exhaust webhook limit (5 requests)
      for (let i = 0; i < 6; i++) {
        await agent.post("/api/webhooks/intake").send({});
      }

      // Cron should still work (different limiter)
      const res = await agent.post("/api/cron/process-jobs").send({});
      expect(res.status).toBe(200);
    });
  });
});
