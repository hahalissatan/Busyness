/**
 * reset.js — Drop everything, re-run all migrations, then seed.
 *
 * DEVELOPMENT ONLY. Refuses to run when NODE_ENV=production.
 *
 * Safeguards:
 *   1. Checks NODE_ENV — exits immediately if "production".
 *   2. Drops the entire public schema (CASCADE) — this is destructive.
 *   3. Re-creates the schema and re-runs all migrations.
 *   4. Re-inserts seed data.
 *
 * Usage:  node src/db/reset.js      (or  npm run db:reset)
 */

import { basename } from "path";
import { query, closePool } from "./pool.js";
import { runMigrations } from "./migrate.js";
import { runSeed } from "./seed.js";

/**
 * Drop the entire public schema and recreate it.
 * This removes all tables, functions, triggers, and data.
 */
async function dropAll() {
  console.log("Dropping all tables and schema objects ...");
  await query("DROP SCHEMA IF EXISTS public CASCADE");
  await query("CREATE SCHEMA public");
  await query("GRANT ALL ON SCHEMA public TO public");
  await query("GRANT ALL ON SCHEMA public TO postgres");
  console.log("[OK] All schema objects dropped.");
}

/**
 * Full database reset: drop -> migrate -> seed.
 * Refuses to run in production.
 */
async function resetDatabase() {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[REFUSED] db:reset is not allowed when NODE_ENV=production."
    );
    console.error(
      "  This command destroys all data. It is for development only."
    );
    process.exit(1);
  }

  console.warn(
    "WARNING: This will DROP ALL TABLES and DATA in the database."
  );
  console.log(
    `Environment: ${process.env.NODE_ENV || "development"}\n`
  );

  await dropAll();

  console.log("\n--- Running migrations ---");
  await runMigrations();

  console.log("\n--- Running seed ---");
  await runSeed();

  console.log("\n[OK] Database reset complete.");
}

// --- CLI entry point (only when run directly, not imported) -----------

const isMainModule =
  process.argv[1] && basename(process.argv[1]) === "reset.js";

if (isMainModule) {
  resetDatabase()
    .catch((err) => {
      // Print only the safe error code, never err.message (may contain host/URL)
      console.error("\nReset failed:", err.code || "CONNECTION_ERROR");
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}

export { resetDatabase };
