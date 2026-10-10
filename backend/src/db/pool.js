import pg from "pg";

const { Pool } = pg;

/**
 * Shared PostgreSQL connection pool.
 *
 * Configuration is read from environment variables.
 * Either set DATABASE_URL or individual DB_* variables.
 *
 * The pool is lazy: it does not connect on creation.
 * The server can start even if PostgreSQL is not running.
 * Connections are only attempted when a query is executed.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "busyness",
  user: process.env.DB_USER || "busyness",
  password: process.env.DB_PASSWORD || "",
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
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function checkConnection() {
  try {
    await pool.query("SELECT 1");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Close all connections in the pool.
 * Called during graceful shutdown.
 */
export async function closePool() {
  await pool.end();
}
