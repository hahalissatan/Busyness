/**
 * jwt.js — JWT signing and verification utilities.
 *
 * Secrets are read from environment variables ONLY.
 * If JWT_SECRET is missing or too short (< 32 chars), the server refuses
 * to sign/verify tokens and returns a safe error rather than operating
 * with an insecure configuration.
 *
 * Required env vars:
 *   JWT_SECRET     — signing secret (min 32 characters)
 *   JWT_EXPIRES_IN — token lifetime, e.g. "7d", "1h" (default: "7d")
 */

import jwt from "jsonwebtoken";

/**
 * Validate that JWT_SECRET is present and sufficiently strong.
 * Throws an Error if configuration is missing or insecure.
 */
function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set. Configure it in backend/.env");
  }
  if (secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be at least 32 characters. Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }
  return secret;
}

/**
 * Get token expiry from env (with sensible default).
 */
function getExpiry() {
  return process.env.JWT_EXPIRES_IN || "7d";
}

/**
 * Sign a JWT access token.
 *
 * @param {object} payload - Claims to embed (e.g. { userId, email, name })
 * @returns {string} Signed JWT string
 * @throws if JWT_SECRET is missing or too short
 */
export function signToken(payload) {
  const secret = requireJwtSecret();
  return jwt.sign(payload, secret, {
    expiresIn: getExpiry(),
  });
}

/**
 * Verify a JWT access token.
 *
 * @param {string} token - JWT string from Authorization header
 * @returns {object} Decoded payload
 * @throws {jwt.JsonWebTokenError|jwt.TokenExpiredError} if invalid or expired
 * @throws if JWT_SECRET is missing or too short
 */
export function verifyToken(token) {
  const secret = requireJwtSecret();
  return jwt.verify(token, secret);
}
