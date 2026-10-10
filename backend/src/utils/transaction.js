/**
 * transaction.js — Transaction helper for multi-step database operations.
 *
 * Checks out a single client from the pool, runs BEGIN, executes the
 * callback, and commits on success or rolls back on error.
 *
 * Usage:
 *   const result = await withTransaction(async (client) => {
 *     const a = await client.query("INSERT ...", [...]);
 *     const b = await client.query("INSERT ...", [...]);
 *     return { a: a.rows[0], b: b.rows[0] };
 *   });
 *
 * @param {(client: import("pg").PoolClient) => Promise<any>} fn
 * @returns {Promise<any>} Whatever fn returns on success
 * @throws whatever fn throws (after rollback)
 */

import { pool } from "../db/pool.js";

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
