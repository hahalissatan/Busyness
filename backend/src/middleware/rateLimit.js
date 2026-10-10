/**
 * rateLimit.js — Configurable rate limiting for API endpoints.
 *
 * Two limiters:
 *   1. generalRateLimit — applies to ALL routes
 *   2. authRateLimit — applies specifically to /api/auth/* endpoints
 *      (stricter, prevents brute-force on login/register)
 *
 * Both are configurable via environment variables.
 * The in-memory store is per-process — for multi-server deployments,
 * use a Redis-backed store (see "Remaining limitations" in docs).
 *
 * Environment variables:
 *   RATE_LIMIT_WINDOW_MS      — general window in ms (default: 900000 = 15 min)
 *   RATE_LIMIT_MAX            — general max requests per window (default: 100)
 *   RATE_LIMIT_AUTH_WINDOW_MS — auth window in ms (default: 900000 = 15 min)
 *   RATE_LIMIT_AUTH_MAX       — auth max requests per window (default: 10)
 *
 * In test mode (NODE_ENV=test), limits are set very high to avoid
 * interfering with the test suite.
 */

import rateLimit from "express-rate-limit";

const isTest = process.env.NODE_ENV === "test";

// --- General rate limiter ---
const generalWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10);
const generalMax = isTest
  ? 10000
  : parseInt(process.env.RATE_LIMIT_MAX || "100", 10);

export const generalRateLimit = rateLimit({
  windowMs: generalWindowMs,
  max: generalMax,
  standardHeaders: true, // Use RFC draft standard (RateLimit-* headers)
  legacyHeaders: false, // Disable X-RateLimit-* headers
  message: {
    error: "Too many requests, please try again later.",
  },
  // Skip health checks from rate limiting — they're cheap and critical
  skip: (req) => req.path.startsWith("/api/health"),
});

// --- Auth rate limiter (stricter) ---
const authWindowMs = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || "900000", 10);
const authMax = isTest
  ? 10000
  : parseInt(process.env.RATE_LIMIT_AUTH_MAX || "10", 10);

export const authRateLimit = rateLimit({
  windowMs: authWindowMs,
  max: authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many authentication attempts. Please try again later.",
  },
  // Only applies to auth endpoints (applied at route level, not globally)
});
