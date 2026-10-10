/**
 * seed.js — Insert demo / seed data.
 *
 * Runs seed.sql against the connected database.
 * Safe to re-run after `db:reset` (which drops everything first).
 *
 * Usage:  node src/db/seed.js      (or  npm run db:seed)
 */

import { readFile } from "fs/promises";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { query, closePool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, "seed.sql");

/**
 * Execute the seed.sql file against the database.
 * @returns {Promise<void>}
 */
async function runSeed() {
  const sql = await readFile(SEED_PATH, "utf-8");

  console.log("Running seed data ...");
  await query(sql);
  console.log("[OK] Seed data inserted successfully.");
}

// --- CLI entry point (only when run directly, not imported) -----------

const isMainModule =
  process.argv[1] && basename(process.argv[1]) === "seed.js";

if (isMainModule) {
  runSeed()
    .then(() => {
      console.log("\nSeed complete.");
    })
    .catch((err) => {
      // Print only the safe error code, never err.message (may contain host/URL)
      console.error("\nSeed failed:", err.code || "CONNECTION_ERROR");
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}

export { runSeed };
