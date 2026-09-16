/**
 * Full-app wiring smoke tests.
 *
 * Unit tests import routers in isolation, but production boots app.ts —
 * the trust-proxy setting, the scoped CORS middleware and the rate
 * limiters only meet each other here. After the Days 7–8 lesson (every
 * check green while the console served 401s), this file boots the real
 * app and proves a request can actually get through it. No database is
 * touched: /api/healthz never opens a connection.
 */

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "./app";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function bootAppWithEnv(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return (await import("./app")).default;
}

describe("app wiring", () => {
  it("serves health through the real middleware stack", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("denies non-loopback origins with 403 JSON (scoped CORS is mounted)", async () => {
    const res = await request(app)
      .get("/api/healthz")
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("CORS policy");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("denies even loopback origins in production without an allowlist", async () => {
    const prodApp = await bootAppWithEnv({ NODE_ENV: "production" });
    const res = await request(prodApp)
      .get("/api/healthz")
      .set("Origin", "http://localhost:5173");
    expect(res.status).toBe(403);
  });

  it("keeps API errors JSON: 401 when auth is unconfigured, 404 past it", async () => {
    // Default test env has no CLERK_SECRET_KEY, so the operator-console
    // auth gate answers before the unknown-path handler ever runs.
    const unauth = await request(app).get("/api/no-such-route");
    expect(unauth.status).toBe(401);
    expect(unauth.body.error).toBeDefined();

    // With auth satisfied (local demo shortcut), unknown API paths are a
    // JSON 404 — never Express's default HTML error page.
    const demoApp = await bootAppWithEnv({
      NODE_ENV: "development",
      LEADSPRINT_DEMO_AUTH: "true",
    });
    const missing = await request(demoApp).get("/api/no-such-route");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "Not found" });
  });
});
