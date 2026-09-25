import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "@workspace/db";
import { globalScheduler } from "./lib/scheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  try {
    logger.info("Verifying database schema and running migrations...");
    await runMigrations();
    logger.info("Database schema up to date");
  } catch (err) {
    // Boot used to log this and carry on listening, which meant a bad
    // DATABASE_URL produced a container that reported healthy (GET
    // /healthz touches nothing) while every real request failed — and a
    // schema that could not be created stayed invisible until a customer
    // hit a missing table. A process that cannot reach its schema is not
    // ready to serve webhooks that place phone calls: refuse to start, and
    // let the platform restart or roll back.
    logger.error(
      { err },
      "Database schema could not be verified — refusing to start the API. " +
        "The app owns its schema via the Drizzle migrations in lib/db/drizzle; " +
        "check DATABASE_URL and that migrations can be applied.",
    );
    process.exit(1);
  }

  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    // Start the internal call-dispatch scheduler after the server is ready.
    // Activate with ENABLE_INTERNAL_WORKER=true — replaces external cron for
    // single-container deployments (demo, Coolify pilot). For multi-instance
    // production, keep this disabled and use an external scheduler instead.
    globalScheduler.start();
  });

  // Graceful shutdown — wait for any in-flight scheduler tick to finish
  // before the process exits. This prevents a call dispatch from being
  // interrupted mid-way (Retell accepted but DB not yet updated).
  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received; stopping server...");
    await globalScheduler.stop();
    server.close(() => {
      logger.info("HTTP server closed; process exiting cleanly");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
}

void start();
