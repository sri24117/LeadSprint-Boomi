import app from "./app";
import { logger } from "./lib/logger";
import { validateEnv } from "./lib/env";
import { globalScheduler } from "./lib/scheduler";

const validatedEnv = validateEnv();
const port = validatedEnv.PORT;

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  globalScheduler.start();
});

const gracefulShutdown = async (signal: string) => {
  logger.info({ signal }, "Received shutdown signal, stopping server...");
  await globalScheduler.stop();
  server.close(() => {
    logger.info("HTTP server closed cleanly");
    process.exit(0);
  });
};

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
