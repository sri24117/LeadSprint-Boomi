import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import express from "express";
import supertest from "supertest";
import { sendValidatedResponse } from "./leadsprint";
import healthRouter from "./health";
import {
  resolveMigrationsFolder,
  sanitizeDatabaseUrl,
  runMigrations,
} from "../migrate";
import { logger } from "../lib/logger";

describe("Milestone 5: Response DTO Resiliency & Migration Runner", () => {
  describe("sendValidatedResponse helper", () => {
    let warnSpy: any;

    beforeEach(() => {
      warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    });

    const TestSchema = z.object({
      id: z.string(),
      status: z.enum(["active", "pending"]),
    });

    it("TEST 1: Valid response DTO returns validated data with 200 without warning", () => {
      const sent: { status?: number; data?: any } = {};
      const mockRes: any = {
        status(code: number) {
          sent.status = code;
          return this;
        },
        json(payload: any) {
          sent.data = payload;
          return this;
        },
        req: { method: "GET", originalUrl: "/api/test" },
      };

      sendValidatedResponse(mockRes, TestSchema, { id: "123", status: "active" });

      expect(sent.status).toBe(200);
      expect(sent.data).toEqual({ id: "123", status: "active" });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("TEST 2: Response with schema drift (extra fields or enum changes) does not crash and serves payload with warning", () => {
      // Schema with strict() to reject unknown fields
      const StrictSchema = z
        .object({
          id: z.string(),
          status: z.enum(["active", "pending"]),
        })
        .strict();

      const sent: { status?: number; data?: any } = {};
      const mockRes: any = {
        status(code: number) {
          sent.status = code;
          return this;
        },
        json(payload: any) {
          sent.data = payload;
          return this;
        },
        req: { method: "GET", originalUrl: "/api/test-drift" },
      };

      const driftedData = {
        id: "123",
        status: "active",
        unexpected_new_db_field: "some_value",
      };

      // Does not throw
      expect(() => {
        sendValidatedResponse(mockRes, StrictSchema, driftedData, 200);
      }).not.toThrow();

      // Returns the response with HTTP 200 rather than crashing with HTTP 500
      expect(sent.status).toBe(200);
      expect(sent.data).toEqual(driftedData);

      // Logs structured warning
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [logArg, logMsg] = warnSpy.mock.calls[0];
      expect(logMsg).toContain("Response DTO validation mismatch");
      expect(logArg.context).toBe("GET /api/test-drift");
      expect(logArg.issues.length).toBeGreaterThan(0);
    });

    it("TEST 3: Invalid response shape preserves designated HTTP status code without crashing", () => {
      const sent: { status?: number; data?: any } = {};
      const mockRes: any = {
        status(code: number) {
          sent.status = code;
          return this;
        },
        json(payload: any) {
          sent.data = payload;
          return this;
        },
        req: { method: "POST", originalUrl: "/api/calls/start" },
      };

      const invalidData = { id: 9999, status: "unknown_enum" };

      expect(() => {
        sendValidatedResponse(mockRes, TestSchema, invalidData, 409);
      }).not.toThrow();

      // Preserves 409 status code
      expect(sent.status).toBe(409);
      expect(sent.data).toEqual(invalidData);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("TEST 4: Sensitive data, tokens, and PII are NOT logged in validation warnings", () => {
      const SensitiveSchema = z
        .object({
          id: z.string(),
          status: z.string(),
        })
        .strict();

      const mockRes: any = {
        status() {
          return this;
        },
        json() {
          return this;
        },
        req: { method: "GET", originalUrl: "/api/sensitive" },
      };

      const payloadWithSensitiveData = {
        id: "id_1",
        status: "ok",
        authorization: "Bearer secret_token_12345",
        apiKey: "retell_api_key_secret",
        phone: "+15551234567",
      };

      sendValidatedResponse(mockRes, SensitiveSchema, payloadWithSensitiveData);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [logArg] = warnSpy.mock.calls[0];
      const logString = JSON.stringify(logArg);

      // Warning issues contain path and message, but NOT raw values or secrets
      expect(logString).not.toContain("secret_token_12345");
      expect(logString).not.toContain("retell_api_key_secret");
      expect(logString).not.toContain("+15551234567");
    });
  });

  describe("Health route integration with sendValidatedResponse", () => {
    it("GET /healthz returns 200 with status ok via sendValidatedResponse", async () => {
      const app = express();
      app.use(healthRouter);

      const res = await supertest(app).get("/healthz");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  describe("Production migration runner", () => {
    it("resolveMigrationsFolder locates existing versioned migration folder with meta/_journal.json", () => {
      const resolved = resolveMigrationsFolder();
      expect(resolved).toBeTruthy();
      expect(resolved).toContain("lib");
      expect(resolved).toContain("drizzle");
    });

    it("sanitizeDatabaseUrl redacts password in credentials", () => {
      const raw = "postgres://leadsprint_user:super_secret_pw@db.production.net:5432/leadsprint_prod";
      const sanitized = sanitizeDatabaseUrl(raw);

      expect(sanitized).not.toContain("super_secret_pw");
      expect(sanitized).toBe("postgres://***:***@db.production.net:5432/leadsprint_prod");
    });

    it("runMigrations throws cleanly when DATABASE_URL is missing", async () => {
      await expect(
        runMigrations({ connectionString: "" }),
      ).rejects.toThrow("DATABASE_URL is required to run database migrations.");
    });
  });
});
