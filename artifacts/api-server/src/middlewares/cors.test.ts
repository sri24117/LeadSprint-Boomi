/**
 * Scoped-CORS tests.
 *
 * The old `app.use(cors())` reflected any Origin, which would let a
 * malicious site drive the operator API from a victim's browser with
 * their session. CORS is a browser-enforced header contract, so these
 * tests assert the actual Access-Control-Allow-Origin response headers
 * through real HTTP, not just the matcher functions.
 *
 * The second half covers the shape that scoping must NOT break: the
 * production single container serves the console and the API from one
 * origin, and browsers attach an Origin header to every request that is
 * not GET/HEAD — same-origin included.
 */

import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  createCorsMiddleware,
  isLoopbackOrigin,
  isOriginAllowed,
  isSameOriginRequest,
  ownOriginOf,
  parseAllowedOrigins,
  resolveCorsPolicy,
} from "./cors";

function appWithCors(
  env: NodeJS.ProcessEnv,
  opts: { trustProxy?: boolean | number | string } = {},
): Express {
  const app = express();
  // Production sets TRUST_PROXY (see app.ts); the default here stays Express's
  // own default of false so the forwarded-header tests mean something.
  if (opts.trustProxy !== undefined) app.set("trust proxy", opts.trustProxy);
  app.use(createCorsMiddleware(env));
  app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
  // A mutating route: same-origin POSTs are the regression this guards.
  app.post("/api/leads", (_req, res) => res.status(201).json({ id: "lead_1" }));
  return app;
}

describe("parseAllowedOrigins", () => {
  it("parses a comma-separated allowlist", () => {
    expect(parseAllowedOrigins("https://console.example.com,http://localhost:5173")).toEqual([
      "https://console.example.com",
      "http://localhost:5173",
    ]);
  });

  it("normalises case and trailing slashes so matching works", () => {
    expect(parseAllowedOrigins("HTTPS://Example.COM:443/")).toEqual(["https://example.com"]);
  });

  it("rejects non-URLs, non-http schemes, and paths loudly", () => {
    expect(() => parseAllowedOrigins("not-a-url")).toThrow(/not a URL/);
    expect(() => parseAllowedOrigins("ftp://example.com")).toThrow(/only http\(s\)/);
    expect(() => parseAllowedOrigins("https://example.com/app")).toThrow(/no path/);
    expect(() => parseAllowedOrigins("https://user@example.com")).toThrow(/no path/);
  });
});

describe("isLoopbackOrigin", () => {
  it("allows http/https loopback hosts on any port", () => {
    expect(isLoopbackOrigin("http://localhost:5173")).toBe(true);
    expect(isLoopbackOrigin("http://127.0.0.1:5000")).toBe(true);
    expect(isLoopbackOrigin("http://[::1]:3000")).toBe(true);
    expect(isLoopbackOrigin("https://localhost/")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isLoopbackOrigin("https://console.example.com")).toBe(false);
    expect(isLoopbackOrigin("http://192.168.1.10:5173")).toBe(false);
    expect(isLoopbackOrigin("http://localhost.evil.com")).toBe(false);
    expect(isLoopbackOrigin("not-a-url")).toBe(false);
  });
});

describe("resolveCorsPolicy", () => {
  it("resolves allowlist / production-none / dev-loopback modes", () => {
    expect(resolveCorsPolicy({ CORS_ORIGINS: "https://a.example" }).mode).toBe("allowlist");
    expect(resolveCorsPolicy({ NODE_ENV: "production" }).mode).toBe("none");
    expect(resolveCorsPolicy({ NODE_ENV: "development" }).mode).toBe("loopback");
  });

  it("fails loudly on a malformed allowlist", () => {
    expect(() => resolveCorsPolicy({ CORS_ORIGINS: "https://ok.example,::bad::" })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it("always allows requests without an Origin header", () => {
    const none = resolveCorsPolicy({ NODE_ENV: "production" });
    expect(isOriginAllowed(none, undefined)).toBe(true);
    expect(isOriginAllowed(none, "https://console.example.com")).toBe(false);
  });
});

describe("createCorsMiddleware", () => {
  it("denies every origin with 403 JSON in production without an allowlist", async () => {
    const res = await request(appWithCors({ NODE_ENV: "production" }))
      .get("/api/healthz")
      .set("Origin", "https://console.example.com");
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("CORS policy");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows only loopback origins in non-production without an allowlist", async () => {
    const dev = appWithCors({ NODE_ENV: "development" });
    const allowed = await request(dev).get("/api/healthz").set("Origin", "http://localhost:5173");
    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

    const denied = await request(dev).get("/api/healthz").set("Origin", "https://evil.example");
    expect(denied.status).toBe(403);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("honours an exact allowlist and rejects near-misses", async () => {
    const app = appWithCors({
      NODE_ENV: "production",
      CORS_ORIGINS: "https://console.example.com",
    });
    const allowed = await request(app)
      .get("/api/healthz")
      .set("Origin", "https://console.example.com");
    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://console.example.com");

    // Subdomain / scheme / port near-misses must not match.
    for (const origin of [
      "https://console.example.com.evil.com",
      "http://console.example.com",
      "https://console.example.com:8443",
    ]) {
      const denied = await request(app).get("/api/healthz").set("Origin", origin);
      expect(denied.status).toBe(403);
      expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("lets requests without an Origin header through (not CORS requests)", async () => {
    const res = await request(appWithCors({ NODE_ENV: "production" })).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("answers preflights for allowed origins", async () => {
    const res = await request(appWithCors({ NODE_ENV: "development" }))
      .options("/api/healthz")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "GET");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});

describe("same-origin requests (the single-container production shape)", () => {
  // app.ts serves the console's static build from the same process and port as
  // the API (STATIC_DIR). A browser attaches Origin to every request whose
  // method is not GET/HEAD — same-origin included — so "deny every origin in
  // production" also denied the console's own POSTs. These tests pin that.
  it("lets a same-origin POST through in production with no allowlist", async () => {
    const app = appWithCors({ NODE_ENV: "production" }, { trustProxy: 1 });
    const res = await request(app)
      .post("/api/leads")
      .set("Host", "console.example.com")
      .set("X-Forwarded-Proto", "https")
      .set("Origin", "https://console.example.com");
    expect(res.status).toBe(201);
    // A same-origin call needs no CORS headers, and production must emit none.
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("matches a non-default port when the app is reached directly over http", async () => {
    // `pnpm start` with STATIC_DIR set: SPA and API on http://localhost:5000.
    const res = await request(appWithCors({ NODE_ENV: "production" }))
      .post("/api/leads")
      .set("Host", "localhost:5000")
      .set("Origin", "http://localhost:5000");
    expect(res.status).toBe(201);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reads the public origin from X-Forwarded-Host when a proxy is trusted", async () => {
    // Some proxies rewrite Host to the internal service name; the forwarded
    // host is then the only thing that matches what the browser sent.
    const app = appWithCors({ NODE_ENV: "production" }, { trustProxy: 1 });
    const res = await request(app)
      .post("/api/leads")
      .set("Host", "api-server:5000")
      .set("X-Forwarded-Host", "console.example.com")
      .set("X-Forwarded-Proto", "https")
      .set("Origin", "https://console.example.com");
    expect(res.status).toBe(201);
  });

  it("still denies a cross-origin POST in production", async () => {
    const app = appWithCors({ NODE_ENV: "production" }, { trustProxy: 1 });
    const res = await request(app)
      .post("/api/leads")
      .set("Host", "console.example.com")
      .set("X-Forwarded-Proto", "https")
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("CORS policy");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("ignores forged forwarded headers when no proxy is trusted", async () => {
    // TRUST_PROXY=false: X-Forwarded-* must not be able to manufacture a
    // same-origin match for an attacker's origin.
    const res = await request(appWithCors({ NODE_ENV: "production" }))
      .post("/api/leads")
      .set("Origin", "https://evil.example")
      .set("X-Forwarded-Host", "evil.example")
      .set("X-Forwarded-Proto", "https");
    expect(res.status).toBe(403);
  });

  it("denies an opaque Origin: null", async () => {
    const app = appWithCors({ NODE_ENV: "production" }, { trustProxy: 1 });
    const res = await request(app)
      .post("/api/leads")
      .set("Host", "console.example.com")
      .set("X-Forwarded-Proto", "https")
      .set("Origin", "null");
    expect(res.status).toBe(403);
  });

  it("passes same-origin even when the allowlist names a different origin", async () => {
    // The allowlist governs cross-origin callers; the deployment's own console
    // is not a cross-origin caller and must never be locked out by it.
    const app = appWithCors(
      { NODE_ENV: "production", CORS_ORIGINS: "https://split-console.example" },
      { trustProxy: 1 },
    );
    const res = await request(app)
      .post("/api/leads")
      .set("Host", "api.example.com")
      .set("X-Forwarded-Proto", "https")
      .set("Origin", "https://api.example.com");
    expect(res.status).toBe(201);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("leaves the allowlist path untouched: allowed cross-origin still gets headers", async () => {
    const app = appWithCors({
      NODE_ENV: "production",
      CORS_ORIGINS: "https://split-console.example",
    });
    const res = await request(app)
      .post("/api/leads")
      .set("Origin", "https://split-console.example");
    expect(res.status).toBe(201);
    expect(res.headers["access-control-allow-origin"]).toBe("https://split-console.example");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});

describe("isSameOriginRequest / ownOriginOf", () => {
  const prod = { protocol: "https", host: "console.example.com" };

  it("derives the deployment's own origin, normalising case and default ports", () => {
    expect(ownOriginOf(prod)).toBe("https://console.example.com");
    expect(ownOriginOf({ protocol: "https", host: "Console.Example.COM:443" })).toBe(
      "https://console.example.com",
    );
    expect(ownOriginOf({ protocol: "http", host: "localhost:5000" })).toBe(
      "http://localhost:5000",
    );
    expect(ownOriginOf({ protocol: "http", host: "[::1]:5000" })).toBe("http://[::1]:5000");
    expect(ownOriginOf({ protocol: "http", host: "" })).toBeUndefined();
  });

  it("is true only for an exact origin match", () => {
    expect(isSameOriginRequest(prod, "https://console.example.com")).toBe(true);
    expect(isSameOriginRequest(prod, "http://console.example.com")).toBe(false);
    expect(isSameOriginRequest(prod, "https://console.example.com:8443")).toBe(false);
    expect(isSameOriginRequest(prod, "https://evil.console.example.com")).toBe(false);
    expect(isSameOriginRequest(prod, "https://console.example.com.evil.com")).toBe(false);
  });

  it("fails closed on absent, opaque, or unparseable Origins", () => {
    expect(isSameOriginRequest(prod, undefined)).toBe(false);
    expect(isSameOriginRequest(prod, "")).toBe(false);
    expect(isSameOriginRequest(prod, "null")).toBe(false);
    expect(isSameOriginRequest(prod, "not-a-url")).toBe(false);
    expect(isSameOriginRequest({ protocol: "https", host: "" }, "https://console.example.com")).toBe(
      false,
    );
  });
});
