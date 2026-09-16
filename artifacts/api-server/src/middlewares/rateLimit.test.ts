/**
 * Rate-limiter tests.
 *
 * The webhook, agent and cron surfaces are reachable without an operator
 * session, so each gets a per-IP ceiling. The factories read their
 * ceilings from env so these tests can shrink them to single digits and
 * prove the 429 path without sending hundreds of requests; production
 * defaults are asserted separately so a typo can't silently ship a
 * near-zero (or near-infinite) limit.
 */

import express, { type Express, type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  createAgentLimiter,
  createCronLimiter,
  createWebhookLimiter,
} from "./rateLimit";

function appWithLimiter(limiter: RequestHandler): Express {
  const app = express();
  app.use(limiter);
  app.post("/api/probe", (_req, res) => res.json({ ok: true }));
  return app;
}

async function postProbe(app: Express, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const res = await request(app).post("/api/probe");
    statuses.push(res.status);
  }
  return statuses;
}

describe("rate limiters", () => {
  it("webhook limiter sheds load with a JSON 429 past its ceiling", async () => {
    const app = appWithLimiter(createWebhookLimiter({ RATE_LIMIT_WEBHOOK_MAX: "3" }));
    expect(await postProbe(app, 3)).toEqual([200, 200, 200]);

    const limited = await request(app).post("/api/probe");
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: expect.stringContaining("Too many requests") });
    // Draft-8 RateLimit headers let well-behaved senders back off.
    expect(limited.headers["ratelimit-policy"]).toContain("q=3");
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("agent limiter enforces its own ceiling", async () => {
    const app = appWithLimiter(createAgentLimiter({ RATE_LIMIT_AGENT_MAX: "2" }));
    expect(await postProbe(app, 2)).toEqual([200, 200]);
    expect((await request(app).post("/api/probe")).status).toBe(429);
  });

  it("cron limiter enforces its own ceiling", async () => {
    const app = appWithLimiter(createCronLimiter({ RATE_LIMIT_CRON_MAX: "1" }));
    expect(await postProbe(app, 1)).toEqual([200]);
    expect((await request(app).post("/api/probe")).status).toBe(429);
  });

  it("ships sane production defaults", async () => {
    // Defaults are per 15 minutes; assert the ceiling headers rather than
    // sending hundreds of requests.
    const webhook = await request(appWithLimiter(createWebhookLimiter({}))).post("/api/probe");
    expect(webhook.headers["ratelimit-policy"]).toContain("q=600");
    const agent = await request(appWithLimiter(createAgentLimiter({}))).post("/api/probe");
    expect(agent.headers["ratelimit-policy"]).toContain("q=300");
    const cron = await request(appWithLimiter(createCronLimiter({}))).post("/api/probe");
    expect(cron.headers["ratelimit-policy"]).toContain("q=60");
  });

  it("rejects malformed ceilings loudly instead of running unprotected", () => {
    expect(() => createWebhookLimiter({ RATE_LIMIT_WEBHOOK_MAX: "lots" })).toThrow(
      /RATE_LIMIT_WEBHOOK_MAX/,
    );
    expect(() => createCronLimiter({ RATE_LIMIT_CRON_MAX: "0" })).toThrow(/RATE_LIMIT_CRON_MAX/);
    expect(() => createAgentLimiter({ RATE_LIMIT_WINDOW_MS: "-1" })).toThrow(
      /RATE_LIMIT_WINDOW_MS/,
    );
  });
});
