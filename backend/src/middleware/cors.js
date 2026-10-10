/**
 * cors.js — CORS configuration with environment-based allowlist.
 *
 * SECURITY: Origins are read from the CORS_ORIGIN env var (comma-separated).
 * In production, ONLY the listed origins are allowed.
 * In development, localhost origins are auto-allowed in addition to CORS_ORIGIN.
 *
 * We do NOT use `origin: '*'` because even though we use Authorization
 * headers (not cookies), restricting origins is defense-in-depth.
 *
 * Environment variables:
 *   CORS_ORIGIN — comma-separated list of allowed origins
 *                  e.g. "http://localhost:5173,https://bizpilot.ai"
 *                  If unset in development, all localhost origins are allowed.
 *                  If unset in production, CORS is disabled (no Access-Control-Allow-Origin).
 */

import cors from "cors";

// Origins that are auto-allowed in development mode
const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:8080",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:8080",
];

/**
 * Parse the CORS_ORIGIN env var into an array of origins.
 * @returns {string[]}
 */
function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) return [];
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Build the list of allowed origins based on environment.
 */
function getAllowedOrigins() {
  const origins = parseCorsOrigins();
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    return [...new Set([...origins, ...DEV_ORIGINS])];
  }
  return origins;
}

/**
 * CORS origin validator: returns true if the origin is in the allowlist.
 * If no allowlist is configured in production, all cross-origin requests
 * are denied (no Access-Control-Allow-Origin header is set).
 */
function originValidator(origin, callback) {
  const allowed = getAllowedOrigins();

  // Allow same-origin requests (no Origin header = same-origin or non-browser)
  if (!origin) return callback(null, true);

  if (allowed.includes(origin)) {
    return callback(null, true);
  }

  // Origin not in allowlist
  return callback(null, false);
}

export const corsMiddleware = cors({
  origin: originValidator,
  // We use Authorization headers, not cookies — but set to false explicitly
  // so the browser does not send credentials and we stay strict.
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  // Never expose sensitive headers
  exposedHeaders: ["X-RateLimit-Remaining", "RateLimit-Remaining"],
  maxAge: 600, // preflight cache: 10 minutes
  // Reject un-allowed origins with a CORS error (not a 200 with no headers)
  // This makes misconfigured origins obvious in the browser console
  optionsSuccessStatus: 204,
});

/**
 * Get the list of allowed origins (for debugging/logging).
 * @returns {string[]}
 */
export function listAllowedOrigins() {
  return getAllowedOrigins();
}
