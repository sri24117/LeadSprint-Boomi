import { describe, it, expect } from "vitest";
import { validateEnv } from "./env";

/**
 * Environment validation test suite.
 *
 * These tests verify that the Zod-based environment schema correctly enforces
 * production requirements while remaining permissive enough for local/demo
 * development.
 *
 * IMPORTANT: No real secrets are used. All values are synthetic test fixtures.
 */

/** Minimal valid local dev environment */
function devEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "development",
    PORT: "5000",
    ...overrides,
  };
}

/** Minimal valid production environment */
function prodEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    PORT: "5000",
    DATABASE_URL: "postgresql://user:pass@host:5432/db",
    CRON_SECRET: "a-very-secure-secret-1234",
    CLERK_SECRET_KEY: "sk_test_xxxxxxxxxxxx",
    ...overrides,
  };
}

describe("Environment Validation", () => {
  // ---- Production: DATABASE_URL ----
  describe("DATABASE_URL", () => {
    it("fails in production when DATABASE_URL is missing", () => {
      const env = prodEnv({ DATABASE_URL: undefined });
      expect(() => validateEnv(env)).toThrow("DATABASE_URL");
    });

    it("fails in production when DATABASE_URL is empty", () => {
      const env = prodEnv({ DATABASE_URL: "  " });
      expect(() => validateEnv(env)).toThrow("DATABASE_URL");
    });
  });

  // ---- Production: CRON_SECRET ----
  describe("CRON_SECRET", () => {
    it("fails in production when CRON_SECRET is missing", () => {
      const env = prodEnv({ CRON_SECRET: undefined });
      expect(() => validateEnv(env)).toThrow("CRON_SECRET");
    });

    it("fails in production when CRON_SECRET is too short", () => {
      const env = prodEnv({ CRON_SECRET: "short" });
      expect(() => validateEnv(env)).toThrow("CRON_SECRET");
    });

    it("passes in production with 16+ character CRON_SECRET", () => {
      const env = prodEnv({ CRON_SECRET: "exactly16charss!" });
      expect(() => validateEnv(env)).not.toThrow();
    });
  });

  // ---- Production: CLERK_SECRET_KEY ----
  describe("CLERK_SECRET_KEY (production, demo auth disabled)", () => {
    it("fails when demo auth is disabled and CLERK_SECRET_KEY is missing", () => {
      const env = prodEnv({ CLERK_SECRET_KEY: undefined });
      expect(() => validateEnv(env)).toThrow("CLERK_SECRET_KEY");
    });

    it("passes when demo auth is enabled in production (Clerk not required)", () => {
      const env = prodEnv({
        LEADSPRINT_DEMO_AUTH: "true",
        CLERK_SECRET_KEY: undefined,
      });
      expect(() => validateEnv(env)).not.toThrow();
    });
  });

  // ---- Provider: Retell consistency ----
  describe("Retell provider consistency", () => {
    it("fails when RETELL_API_KEY is set but RETELL_WEBHOOK_SECRET is missing", () => {
      const env = devEnv({ RETELL_API_KEY: "key_retell_test" });
      expect(() => validateEnv(env)).toThrow("RETELL_WEBHOOK_SECRET");
    });

    it("fails when RETELL_WEBHOOK_SECRET is set but RETELL_API_KEY is missing", () => {
      const env = devEnv({ RETELL_WEBHOOK_SECRET: "whsec_retell_test" });
      expect(() => validateEnv(env)).toThrow("RETELL_API_KEY");
    });

    it("passes when both Retell credentials are provided", () => {
      const env = devEnv({
        RETELL_API_KEY: "key_retell_test",
        RETELL_WEBHOOK_SECRET: "whsec_retell_test",
      });
      expect(() => validateEnv(env)).not.toThrow();
    });
  });

  // ---- Provider: Cal.com consistency ----
  describe("Cal.com provider consistency", () => {
    it("fails when CALCOM_API_KEY is set but CALCOM_WEBHOOK_SECRET is missing", () => {
      const env = devEnv({
        CALCOM_API_KEY: "cal_test_key",
        CALCOM_EVENT_TYPE_ID: "42",
      });
      expect(() => validateEnv(env)).toThrow("CALCOM_WEBHOOK_SECRET");
    });

    it("fails when CALCOM_API_KEY is set but CALCOM_EVENT_TYPE_ID is missing", () => {
      const env = devEnv({
        CALCOM_API_KEY: "cal_test_key",
        CALCOM_WEBHOOK_SECRET: "whsec_calcom_test",
      });
      expect(() => validateEnv(env)).toThrow("CALCOM_EVENT_TYPE_ID");
    });

    it("passes when all Cal.com credentials are provided", () => {
      const env = devEnv({
        CALCOM_API_KEY: "cal_test_key",
        CALCOM_EVENT_TYPE_ID: "42",
        CALCOM_WEBHOOK_SECRET: "whsec_calcom_test",
      });
      expect(() => validateEnv(env)).not.toThrow();
    });
  });

  // ---- Provider: Twilio consistency ----
  describe("Twilio provider consistency", () => {
    it("fails when TWILIO_ACCOUNT_SID is set but TWILIO_AUTH_TOKEN is missing", () => {
      const env = devEnv({
        TWILIO_ACCOUNT_SID: "AC_test_sid",
        TWILIO_WEBHOOK_SECRET: "whsec_twilio_test",
      });
      expect(() => validateEnv(env)).toThrow("TWILIO_AUTH_TOKEN");
    });

    it("passes when all Twilio credentials are provided", () => {
      const env = devEnv({
        TWILIO_ACCOUNT_SID: "AC_test_sid",
        TWILIO_AUTH_TOKEN: "auth_token_test",
        TWILIO_WEBHOOK_SECRET: "whsec_twilio_test",
      });
      expect(() => validateEnv(env)).not.toThrow();
    });
  });

  // ---- Local/demo mode without provider credentials ----
  describe("Local/demo mode permissiveness", () => {
    it("passes in development with no provider credentials at all", () => {
      const env = devEnv();
      expect(() => validateEnv(env)).not.toThrow();
    });

    it("passes in development with demo auth enabled and no credentials", () => {
      const env = devEnv({ LEADSPRINT_DEMO_AUTH: "true" });
      expect(() => validateEnv(env)).not.toThrow();
    });
  });

  // ---- Valid production environment ----
  describe("Valid production environment", () => {
    it("succeeds with all required production credentials", () => {
      const env = prodEnv({
        RETELL_API_KEY: "key_retell_test",
        RETELL_WEBHOOK_SECRET: "whsec_retell_test",
        CALCOM_API_KEY: "cal_test_key",
        CALCOM_EVENT_TYPE_ID: "42",
        CALCOM_WEBHOOK_SECRET: "whsec_calcom_test",
      });
      const result = validateEnv(env);
      expect(result.NODE_ENV).toBe("production");
      expect(result.PORT).toBe(5000);
    });

    it("succeeds in production without optional provider integrations", () => {
      const env = prodEnv();
      const result = validateEnv(env);
      expect(result.NODE_ENV).toBe("production");
    });
  });

  // ---- Security: error messages must not leak secrets ----
  describe("Error message safety", () => {
    it("does not leak secret values in error messages", () => {
      const secretValue = "super-secret-database-url-do-not-leak";
      const env = prodEnv({
        DATABASE_URL: secretValue,
        CRON_SECRET: "short", // will fail
      });
      try {
        validateEnv(env);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        const message = (err as Error).message;
        expect(message).not.toContain(secretValue);
        expect(message).not.toContain("sk_test_");
        // Should contain the field name, not the value
        expect(message).toContain("CRON_SECRET");
      }
    });
  });
});
