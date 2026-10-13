/**
 * Baseline response hardening, checked through the real app wiring.
 *
 * No Content-Security-Policy on purpose: the console loads Clerk's hosted
 * scripts and Tailwind's runtime styles, and a policy that has never been
 * exercised against a real Clerk sign-in would lock operators out of
 * production. See docs/coolify-deploy.md ("Security headers").
 */

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function bootApp(env: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return (await import("../app")).default;
}

describe("security headers", () => {
  it("sets baseline hardening headers and hides the framework", async () => {
    const app = await bootApp();
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("never lets a browser cache operator API responses", async () => {
    const app = await bootApp();
    const res = await request(app).get("/api/healthz");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("also covers error responses (auth failures and unknown paths)", async () => {
    const app = await bootApp();
    const res = await request(app).get("/api/no-such-route");
    expect(res.status).toBe(401);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("sends HSTS in production only", async () => {
    const dev = await bootApp({ NODE_ENV: "development" });
    const devRes = await request(dev).get("/api/healthz");
    expect(devRes.headers["strict-transport-security"]).toBeUndefined();

    const prod = await bootApp({ NODE_ENV: "production" });
    const prodRes = await request(prod).get("/api/healthz");
    expect(prodRes.headers["strict-transport-security"]).toBe(
      "max-age=15552000; includeSubDomains",
    );
  });
});
