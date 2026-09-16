import { defineConfig } from "vitest/config";

// Deliberately standalone: the app's vite.config.ts requires PORT/BASE_PATH
// and Replit-specific plugins at load time, none of which are relevant to
// the pure unit tests here (CSV parsing). Vitest picks this file over
// vite.config.ts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
