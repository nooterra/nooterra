import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Fork pool was crashing under tinypool; force single-threaded workers for stability.
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/services/**/*.ts"],
    },
    // Mock database connections for unit tests
    setupFiles: ["./src/tests/setup.ts"],
  },
});
