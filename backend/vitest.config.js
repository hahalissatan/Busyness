/**
 * vitest.config.js — Vitest configuration for Busyness backend.
 *
 * Uses the Node.js environment (not jsdom) since we're testing
 * backend Express routes with real database integration.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Run test files matching this pattern
    include: ["src/**/*.test.{js,mjs}"],
    // Longer timeout for integration tests that hit the database
    testTimeout: 15000,
    // Setup file: sets NODE_ENV=test before any module imports
    setupFiles: ["./src/__tests__/setup.js"],
    // Don't run tests in parallel across files — we share a database
    // and test data cleanup must be sequential
    fileParallelism: false,
  },
});
