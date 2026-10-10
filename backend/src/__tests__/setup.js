/**
 * setup.js — Vitest global setup file.
 *
 * Runs before any test file is loaded. Sets NODE_ENV=test so that
 * rate limiters and other environment-aware modules use test-friendly
 * configurations (high limits, no production strictness).
 *
 * This must run BEFORE app.js is imported (which triggers rateLimit.js
 * import) so that the rate limiters read NODE_ENV="test" at load time.
 */

process.env.NODE_ENV = "test";
