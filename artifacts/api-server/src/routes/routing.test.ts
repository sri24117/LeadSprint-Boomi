/**
 * Router mounting regression tests.
 *
 * These exist because of a real outage-class bug: the Retell agent
 * router's signature middleware was mounted bare (`router.use(fn)`)
 * instead of scoped to `/agent`, so it ran for every request that reached
 * it — and since it is mounted before the operator-console router, EVERY
 * console endpoint answered `401 {"error":"Invalid Retell signature"}`.
 * Typechecking and unit tests all passed; only actually calling the API
 * caught it.
 */

import express from "express";
import { describe, expect, it } from "vitest";
import agentRouter from "./agent";

function appWithAgentRouterInFront() {
  const app = express();
  app.use(express.json());
  // Same order as routes/index.ts: agent router first, console routes
  // after it.
  app.use("/api", agentRouter);
  app.use("/api", (_req, res) => {
    res.json({ reached: "console" });
  });
  return app;
}

async function call(app: express.Express, path: string) {
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

describe("agent router mounting", () => {
  it("does not intercept operator console routes", async () => {
    const result = await call(appWithAgentRouterInFront(), "/api/leads");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ reached: "console" });
  });

  it("does not intercept health or webhook style routes", async () => {
    const result = await call(appWithAgentRouterInFront(), "/api/today");
    expect(result.body).toEqual({ reached: "console" });
  });

  it("still rejects unsigned requests to its own endpoints", async () => {
    const result = await call(appWithAgentRouterInFront(), "/api/agent/availability");

    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: expect.stringContaining("signature") });
  });

  it("rejects unsigned requests to every agent tool endpoint", async () => {
    for (const path of ["/api/agent/book", "/api/agent/transfer", "/api/agent/message", "/api/agent/qualify"]) {
      const result = await call(appWithAgentRouterInFront(), path);
      expect(result.status, path).toBe(401);
    }
  });
});
