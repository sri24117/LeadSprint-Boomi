import app from "./app";
import { logger } from "./lib/logger";
import { validateEnv } from "./lib/env";

const validatedEnv = validateEnv();
const port = validatedEnv.PORT;

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
