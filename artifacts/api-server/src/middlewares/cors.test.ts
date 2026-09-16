/**
 * Scoped-CORS tests.
 *
 * The old `app.use(cors())` reflected any Origin, which would let a
 * malicious site drive the operator API from a victim's browser with
 * their session. CORS is a browser-enforced header contract, so these
 * tests assert the actual Access-Control-Allow-Origin response headers
 * through real HTTP, not just the matcher functions.
 */

import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  createCorsMiddleware,
  isLoopbackOrigin,
  isOriginAllowed,
  parseAllowedOrigins,
  resolveCorsPolicy,
} from "./cors";

function appWithCors(env: NodeJS.ProcessEnv): Express {
  const app = express();
  app.use(createCorsMiddleware(env));
  app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
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
