import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // @workspace/db constructs a pg Pool at import time and refuses to
      // load without this. No connection is ever opened: the acceptance
      // tests run against an embedded PGlite database injected through
      // __setCallQueueDb.
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgres://unused:unused@127.0.0.1:1/unused",
    },
    // PGlite starts a WASM Postgres per suite; give it room on cold CI.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
