import { z } from "zod";

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    DATABASE_URL: z.string().optional(),
    LEADSPRINT_DEMO_AUTH: z.string().optional(),
    CRON_SECRET: z.string().optional(),
    CLERK_SECRET_KEY: z.string().optional(),
    CLERK_PUBLISHABLE_KEY: z.string().optional(),
    RETELL_API_KEY: z.string().optional(),
    RETELL_AGENT_ID: z.string().optional(),
    RETELL_FROM_NUMBER: z.string().optional(),
    RETELL_FROM_NUMBER_US: z.string().optional(),
    RETELL_FROM_NUMBER_IN: z.string().optional(),
    RETELL_WEBHOOK_SECRET: z.string().optional(),
    CALCOM_API_KEY: z.string().optional(),
    CALCOM_EVENT_TYPE_ID: z.string().optional(),
    CALCOM_API_URL: z.string().optional(),
    CALCOM_WEBHOOK_SECRET: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER_US: z.string().optional(),
    TWILIO_FROM_NUMBER_IN: z.string().optional(),
    TWILIO_WEBHOOK_SECRET: z.string().optional(),
    LEAD_INTAKE_WEBHOOK_SECRET: z.string().optional(),
    CORS_ALLOWED_ORIGINS: z.string().optional(),
    TRUST_PROXY: z.string().optional(),
    LOG_LEVEL: z.string().optional(),
    ENABLE_INTERNAL_WORKER: z.string().optional(),
    INTERNAL_WORKER_INTERVAL_MS: z.coerce.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    const isProduction = data.NODE_ENV === "production";
    const isDemoAuth = data.LEADSPRINT_DEMO_AUTH?.trim().toLowerCase() === "true";

    // 1. In production, DATABASE_URL is mandatory
    if (isProduction && (!data.DATABASE_URL || !data.DATABASE_URL.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required in production",
      });
    }

    // 2. In production, CRON_SECRET is mandatory and must be at least 16 characters
    if (isProduction) {
      if (!data.CRON_SECRET || data.CRON_SECRET.trim().length < 16) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CRON_SECRET"],
          message: "CRON_SECRET is required in production and must be at least 16 characters",
        });
      }
    }

    // 3. In production with demo auth disabled, Clerk secrets are mandatory
    if (isProduction && !isDemoAuth) {
      if (!data.CLERK_SECRET_KEY || !data.CLERK_SECRET_KEY.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CLERK_SECRET_KEY"],
          message: "CLERK_SECRET_KEY is required in production when demo auth is disabled",
        });
      }
    }

    // 4. Retell consistency: if API key or webhook secret is provided, both are required
    const hasRetellKey = Boolean(data.RETELL_API_KEY?.trim());
    const hasRetellSecret = Boolean(data.RETELL_WEBHOOK_SECRET?.trim());
    if (hasRetellKey || hasRetellSecret) {
      if (!hasRetellKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["RETELL_API_KEY"],
          message: "RETELL_API_KEY is required when Retell integration is enabled (RETELL_WEBHOOK_SECRET is present)",
        });
      }
      if (!hasRetellSecret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["RETELL_WEBHOOK_SECRET"],
          message: "RETELL_WEBHOOK_SECRET is required when Retell integration is enabled (RETELL_API_KEY is present)",
        });
      }
    }

    // 5. Cal.com consistency: if any Cal.com key is configured, all required keys must be present
    const hasCalApiKey = Boolean(data.CALCOM_API_KEY?.trim());
    const hasCalSecret = Boolean(data.CALCOM_WEBHOOK_SECRET?.trim());
    const hasCalEventType = Boolean(data.CALCOM_EVENT_TYPE_ID?.trim());
    if (hasCalApiKey || hasCalSecret || hasCalEventType) {
      if (!hasCalApiKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CALCOM_API_KEY"],
          message: "CALCOM_API_KEY is required when Cal.com integration is enabled",
        });
      }
      if (!hasCalSecret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CALCOM_WEBHOOK_SECRET"],
          message: "CALCOM_WEBHOOK_SECRET is required when Cal.com integration is enabled",
        });
      }
      if (!hasCalEventType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CALCOM_EVENT_TYPE_ID"],
          message: "CALCOM_EVENT_TYPE_ID is required when Cal.com integration is enabled",
        });
      }
    }

    // 6. Twilio consistency: if any Twilio credential is provided, all required keys must be present
    const hasTwilioSid = Boolean(data.TWILIO_ACCOUNT_SID?.trim());
    const hasTwilioToken = Boolean(data.TWILIO_AUTH_TOKEN?.trim());
    const hasTwilioSecret = Boolean(data.TWILIO_WEBHOOK_SECRET?.trim());
    if (hasTwilioSid || hasTwilioToken || hasTwilioSecret) {
      if (!hasTwilioSid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TWILIO_ACCOUNT_SID"],
          message: "TWILIO_ACCOUNT_SID is required when Twilio integration is enabled",
        });
      }
      if (!hasTwilioToken) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TWILIO_AUTH_TOKEN"],
          message: "TWILIO_AUTH_TOKEN is required when Twilio integration is enabled",
        });
      }
      if (!hasTwilioSecret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TWILIO_WEBHOOK_SECRET"],
          message: "TWILIO_WEBHOOK_SECRET is required when Twilio integration is enabled",
        });
      }
    }
  });

export type ValidatedEnv = z.infer<typeof envSchema>;

export function validateEnv(rawEnv: Record<string, string | undefined> = process.env): ValidatedEnv {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => ` - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${errorDetails}`);
  }
  return result.data;
}
