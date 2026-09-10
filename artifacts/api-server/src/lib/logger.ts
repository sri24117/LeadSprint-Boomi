import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    // Auth & session headers
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    // Webhook signature headers (never log raw signatures)
    "req.headers['x-retell-signature']",
    "req.headers['x-twilio-signature']",
    "req.headers['x-leadsprint-signature']",
    "req.headers['x-cron-secret']",
    // Phone numbers / PII in request body or nested objects
    "req.body.phone",
    "req.body.phoneNumber",
    "req.body.toNumber",
    "req.body.fromNumber",
    "req.body.from_number",
    "req.body.to_number",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
