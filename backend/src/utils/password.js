/**
 * password.js — Password hashing and verification using bcryptjs.
 *
 * Uses 12 rounds of bcrypt (a good balance of security and speed).
 * Never store plaintext passwords.
 *
 * bcryptjs is a pure-JavaScript implementation — no native compilation needed.
 */

import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/**
 * Hash a plaintext password using bcrypt.
 *
 * @param {string} password - Plaintext password
 * @returns {Promise<string>} Bcrypt hash string (includes salt)
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a plaintext password against a stored bcrypt hash.
 * Uses constant-time comparison internally (bcrypt built-in).
 *
 * @param {string} password - Plaintext password to check
 * @param {string} hash - Stored bcrypt hash
 * @returns {Promise<boolean>} true if match, false otherwise
 */
export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}
