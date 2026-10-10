/**
 * status.js — Report migration status and list database tables.
 *
 * Shows which migrations have been applied vs. pending,
 * and lists all tables in the public schema.
 *
 * Usage:  node src/db/status.js      (or  npm run db:status)
 */

import { basename } from "path";
import { query, closePool } from "./pool.js";
import {
  getAppliedMigrations,
  getMigrationFiles,
} from "./migrate.js";

/**
 * Print migration status and table list.
 */
async function printStatus() {
  // --- Migration status ---
  const applied = await getAppliedMigrations();
  const allFiles = await getMigrationFiles();

  console.log("=== Migration Status ===\n");

  if (allFiles.length === 0) {
    console.log("  No migration files found in backend/src/db/migrations/");
  } else {
    for (const f of allFiles) {
      const status = applied.has(f) ? "[OK] applied  " : "    pending  ";
      console.log(`  ${status} ${f}`);
    }

    const appliedCount = allFiles.filter((f) => applied.has(f)).length;
    console.log(
      `\nTotal: ${appliedCount} applied, ${
        allFiles.length - appliedCount
      } pending.`
    );
  }

  // --- Table listing ---
  console.log("\n=== Database Tables ===\n");

  const result = await query(`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
     ORDER BY table_name
  `);

  if (result.rows.length === 0) {
    console.log("  No tables found. Run migrations first (npm run db:migrate).");
  } else {
    for (const row of result.rows) {
      console.log(`  - ${row.table_name}`);
    }
    console.log(`\nTotal: ${result.rows.length} table(s).`);
  }
}

// --- CLI entry point (only when run directly, not imported) -----------

const isMainModule =
  process.argv[1] && basename(process.argv[1]) === "status.js";

if (isMainModule) {
  printStatus()
    .catch((err) => {
      // Print only the safe error code, never err.message (may contain host/URL)
      console.error("Status check failed:", err.code || "CONNECTION_ERROR");
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}

export { printStatus };
