/**
 * Connection-time database behaviour that decides whether a deploy comes up.
 *
 * Each hint below is a real failure from a Coolify deploy of this app: the
 * boot refuses to start (by design) and the platform only shows the raw
 * driver error, so the log has to say what to change.
 */

import { describe, expect, it } from "vitest";
import { describeDbConnectionError, resolvePoolSettings } from "@workspace/db";

describe("describeDbConnectionError", () => {
  it("explains an untrusted TLS certificate and names the working URL parameters", () => {
    const hint = describeDbConnectionError(
      new Error("unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca"),
    );
    expect(hint).toContain("uselibpqcompat=true&sslmode=require");
  });

  it("finds the cause when the driver error is wrapped (drizzle wraps pg errors)", () => {
    const wrapped = new Error("Failed query: CREATE SCHEMA IF NOT EXISTS \"drizzle\"", {
      cause: new Error("self-signed certificate in certificate chain"),
    });
    expect(describeDbConnectionError(wrapped)).toContain("uselibpqcompat=true&sslmode=require");
  });

  it("explains rejected credentials, including the Coolify first-boot-only password behaviour", () => {
    const hint = describeDbConnectionError(new Error('password authentication failed for user "leadsprint"'));
    expect(hint).toMatch(/credentials/i);
    expect(hint).toMatch(/first created|first boot|data volume/i);
    expect(hint).toMatch(/URL-encode|percent-encode/i);
  });

  it("explains an unreachable host", () => {
    for (const message of ["getaddrinfo ENOTFOUND db.internal", "connect ECONNREFUSED 127.0.0.1:5432"]) {
      expect(describeDbConnectionError(new Error(message))).toMatch(/host|port|network/i);
    }
  });

  it("explains a connection timeout", () => {
    const hint = describeDbConnectionError(new Error("Connection terminated due to connection timeout"));
    expect(hint).toContain("DATABASE_CONNECT_TIMEOUT_MS");
  });

  it("explains a server that does not speak SSL", () => {
    const hint = describeDbConnectionError(new Error("The server does not support SSL connections"));
    expect(hint).toMatch(/sslmode/);
  });

  it("explains a missing database", () => {
    expect(describeDbConnectionError(new Error('database "leadsprint" does not exist'))).toMatch(/database name/i);
  });

  it("returns null for errors it cannot help with", () => {
    expect(describeDbConnectionError(new Error("something else entirely"))).toBeNull();
    expect(describeDbConnectionError("not even an error")).toBeNull();
    expect(describeDbConnectionError(undefined)).toBeNull();
  });
});

describe("resolvePoolSettings", () => {
  it("defaults to 10 connections and a 10 second connect timeout", () => {
    expect(resolvePoolSettings({})).toEqual({ max: 10, connectionTimeoutMillis: 10_000 });
  });

  it("honours DATABASE_POOL_MAX and DATABASE_CONNECT_TIMEOUT_MS", () => {
    expect(
      resolvePoolSettings({ DATABASE_POOL_MAX: "1", DATABASE_CONNECT_TIMEOUT_MS: "2500" }),
    ).toEqual({ max: 1, connectionTimeoutMillis: 2500 });
  });

  it("falls back to the defaults on junk instead of crashing or disabling the timeout", () => {
    for (const bad of ["abc", "0", "-3", "", "1.5", "Infinity"]) {
      expect(
        resolvePoolSettings({ DATABASE_POOL_MAX: bad, DATABASE_CONNECT_TIMEOUT_MS: bad }),
      ).toEqual({ max: 10, connectionTimeoutMillis: 10_000 });
    }
  });
});
