/**
 * setup.js — Vitest global setup file.
 *
 * Runs before any test file is loaded. Sets NODE_ENV=test so that
 * rate limiters and other environment-aware modules use test-friendly
 * configurations (high limits, no production strictness).
 *
 * This must run BEFORE app.js is imported (which triggers rateLimit.js
 * import) so that the rate limiters read NODE_ENV="test" at load time.
 *
 * DATABASE SAFETY GUARD:
 *   Loads .env early so we can inspect the database configuration before
 *   any test runs. If the database name does NOT contain "test", logs a
 *   warning. Tests that mock the persistence layer (nlRegression.test.js)
 *   are fully isolated. Tests that use the real database (invoiceAgent.test.js)
 *   may write real records — consider a dedicated test database for those.
 */

process.env.NODE_ENV = "test";

// --- Load .env early to inspect DB config -------------------------------
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// setup.js is at backend/src/__tests__/setup.js → .env is at backend/.env
loadEnv({ path: join(__dirname, "../../.env") });

// --- Database safety guard ---------------------------------------------
(function checkTestDatabase() {
  const dbUrl = process.env.DATABASE_URL || "";
  const dbName = process.env.DB_NAME || "";
  let name = dbName;
  if (dbUrl) {
    try {
      name = new URL(dbUrl).pathname.replace(/^\//, "");
    } catch {
      // fall back to DB_NAME
    }
  }
  if (name && !name.toLowerCase().includes("test")) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n⚠️  [TEST SAFETY] Database "${name}" does not contain "test" in its name.\n` +
      `   Tests that mock the persistence layer (nlRegression.test.js) are safe — no DB writes.\n` +
      `   Tests that use the real database (invoiceAgent.test.js) may write real records.\n` +
      `   Consider setting DATABASE_URL to a test database for full isolation.\n`
    );
  }
})();
