/**
 * migrate.js — Custom SQL-file migration runner.
 *
 * Reads .sql files from ./migrations/ in alphabetical order,
 * tracks applied migrations in a `schema_migrations` table,
 * and runs each pending migration inside a transaction.
 *
 * Usage:  node src/db/migrate.js      (or  npm run db:migrate)
 *
 * Design:
 *   - Idempotent: skips already-applied migrations.
 *   - Transactional: each migration is BEGIN … COMMIT (all-or-nothing).
 *   - On failure: ROLLBACK, print safe error code, exit non-zero.
 *   - No external framework — ~80 lines of code.
 */

import { readdir, readFile } from "fs/promises";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { pool, query, closePool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

/**
 * Ensure the schema_migrations tracking table exists.
 * Idempotent — safe to call on every run.
 */
async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Get the set of already-applied migration filenames.
 * @returns {Promise<Set<string>>}
 */
async function getAppliedMigrations() {
  const result = await query(
    "SELECT filename FROM schema_migrations ORDER BY filename"
  );
  return new Set(result.rows.map((r) => r.filename));
}

/**
 * List all .sql files in the migrations directory, sorted by name.
 * @returns {Promise<string[]>}
 */
async function getMigrationFiles() {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith(".sql")).sort();
}

/**
 * Run all pending migrations in order.
 * Each migration is wrapped in a transaction (all-or-nothing).
 *
 * @returns {Promise<{ appliedCount: number, pending: string[] }>}
 */
async function runMigrations() {
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const allFiles = await getMigrationFiles();
  const pending = allFiles.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log("No pending migrations. Database is up to date.");
    return { appliedCount: 0, pending: [] };
  }

  console.log(`Found ${pending.length} pending migration(s):`);
  for (const f of pending) {
    console.log(`  - ${f}`);
  }

  for (const filename of pending) {
    const filepath = join(MIGRATIONS_DIR, filename);
    const sql = await readFile(filepath, "utf-8");

    console.log(`\nApplying: ${filename} ...`);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename]
      );
      await client.query("COMMIT");
      console.log(`  [OK] Applied: ${filename}`);
    } catch (err) {
      await client.query("ROLLBACK");
      // Print only the safe error code, never the full message
      console.error(`  [FAIL] ${filename}`);
      console.error(`  Error code: ${err.code || "UNKNOWN"}`);
      throw new Error(`Migration failed: ${filename} (${err.code || "UNKNOWN"})`);
    } finally {
      client.release();
    }
  }

  console.log(`\n${pending.length} migration(s) applied successfully.`);
  return { appliedCount: pending.length, pending };
}

// --- CLI entry point (only when run directly, not imported) -----------

const isMainModule =
  process.argv[1] && basename(process.argv[1]) === "migrate.js";

if (isMainModule) {
  runMigrations()
    .then(({ appliedCount }) => {
      console.log(`\nMigration complete. ${appliedCount} migration(s) applied.`);
    })
    .catch((err) => {
      // Print only the safe error code, never err.message (may contain host/URL)
      console.error("\nMigration failed:", err.code || "CONNECTION_ERROR");
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}

export { runMigrations, ensureMigrationsTable, getAppliedMigrations, getMigrationFiles };
