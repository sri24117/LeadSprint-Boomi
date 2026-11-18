import express, { type Request, type Response } from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";

// Inspect the real router's Clerk configuration, not Clerk's crypto internals.
vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
  clerkMiddleware: (options: (req: Request) => { publishableKey?: string }) =>
    (req: Request, res: Response) => res.json(options(req)),
}));

import router from "./index";
afterEach(() => vi.unstubAllEnvs());

it.each(["pk_live_configured_instance", "pk_test_configured_instance"])(
  "pins %s to the configured instance regardless of proxy hostname",
  async (key) => {
    vi.stubEnv("LEADSPRINT_DEMO_AUTH", "false");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_placeholder");
    vi.stubEnv("CLERK_PUBLISHABLE_KEY", `  ${key}  `);
    const app = express().use("/api", router);
    for (const host of ["console.example.com", "preview.e2b.app", "untrusted.invalid"]) {
      const res = await request(app).get("/api/auth/me")
        .set("Host", host).set("X-Forwarded-Host", "other.invalid");
      expect(res.status).toBe(200);
      expect(res.body.publishableKey).toBe(key);
    }
  },
);
