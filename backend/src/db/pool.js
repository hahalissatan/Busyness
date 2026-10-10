/**
 * pool.js — Shared PostgreSQL connection pool.
 *
 * Loads backend/.env via dotenv BEFORE the pool is created,
 * so DATABASE_URL and DB_* variables are always available.
 * Requires SSL for hosted (non-local) databases.
 *
 * The pool is lazy: it does not connect on creation.
 * The server can start even if PostgreSQL is not running.
 * Connections are only attempted when a query is executed.
 */

// --- Load .env BEFORE anything else reads process.env ------------------
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// pool.js is at backend/src/db/pool.js → .env is at backend/.env
loadEnv({ path: join(__dirname, "../../.env") });

// --- PostgreSQL pool --------------------------------------------------
import pg from "pg";

const { Pool } = pg;

/**
 * Determine whether SSL should be used for the database connection.
 *
 * Resolution order:
 *   1. DB_SSL env var: "true" forces SSL, "false" disables it.
 *   2. Auto-detect: SSL is enabled for any host that is not localhost.
 *
 * Hosted providers (Supabase, Neon, Render, Railway, etc.) require SSL.
 *
 * @returns {object | undefined} pg SSL config object, or undefined.
 */
function getSslConfig() {
  // Explicit override
  if (process.env.DB_SSL === "false") return undefined;
  if (process.env.DB_SSL === "true") return { rejectUnauthorized: true };

  // Auto-detect: parse host from DATABASE_URL or DB_HOST
  let host = process.env.DB_HOST || "localhost";
  if (process.env.DATABASE_URL) {
    try {
      host = new URL(process.env.DATABASE_URL).hostname;
    } catch {
      // If DATABASE_URL is not a valid URL, fall back to DB_HOST
    }
  }
  const localHosts = ["localhost", "127.0.0.1", "::1"];
  const isLocal = localHosts.includes(host);
  return isLocal ? undefined : { rejectUnauthorized: true };
}

/**
 * Shared connection pool.
 *
 * Configuration is read from environment variables (loaded from .env).
 * Either set DATABASE_URL or individual DB_* variables.
 * If DATABASE_URL is set, it takes precedence.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "busyness",
  user: process.env.DB_USER || "busyness",
  password: process.env.DB_PASSWORD || "",
  ssl: getSslConfig(),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

/**
 * Execute a parameterized query against the pool.
 *
 * @param {string} text - SQL query with $1, $2, ... placeholders
 * @param {Array} params - Parameter values
 * @returns {Promise<import("pg").QueryResult>}
 */
export async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Check database connectivity by running SELECT 1.
 *
 * Returns only a safe error code — never the full message,
 * which could contain connection strings or credentials.
 *
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function checkConnection() {
  try {
    await pool.query("SELECT 1 AS ok");
    return { ok: true };
  } catch (err) {
    // Return only the PostgreSQL/node error code (e.g. ECONNREFUSED, 28P01)
    // Never expose err.message which may contain host/user details
    return { ok: false, error: err.code || "CONNECTION_ERROR" };
  }
}

/**
 * Close all connections in the pool.
 * Called during graceful shutdown.
 */
export async function closePool() {
  await pool.end();
}
