/**
 * health.js — Standalone database connection test.
 *
 * Prints a safe pass/fail status without exposing credentials,
 * connection strings, or host/user details.
 *
 * Usage:  node src/db/health.js      (or  npm run db:health)
 */

import { checkConnection, closePool } from "./pool.js";

async function main() {
  const result = await checkConnection();

  if (result.ok) {
    console.log("[OK]    Database connection successful.");
  } else {
    console.error("[FAIL]  Database connection failed.");
    console.error("        Error code:", result.error);
    console.error("        (No credentials or connection details shown.)");
  }

  await closePool();
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  // Catch-all: only print the error code, never the full message
  console.error("[FAIL]  Unexpected error:", err.code || "UNKNOWN");
  process.exit(1);
});
