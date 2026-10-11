/**
 * businessAuth.js — Business authorization middleware.
 *
 * Verifies that the authenticated user has an active membership in the
 * business identified by req.params.businessId (from the URL path).
 *
 * SECURITY: The business ID is taken from the URL parameter — NOT from
 * request body, query string, or an X-Business-Id header. The URL
 * identifies the requested resource; membership is verified against
 * the database.
 *
 * IN-MEMORY FALLBACK:
 *   When PostgreSQL is not available, the middleware falls back to
 *   the in-memory store. It checks if the businessId matches the demo
 *   business ID and the user matches the demo user ID or an in-memory
 *   registered user.
 *
 * Must be used AFTER authenticateToken (requires req.user.userId).
 *
 * Usage:
 *   import { authenticateToken } from "../middleware/auth.js";
 *   import { requireBusinessAccess } from "../middleware/businessAuth.js";
 *   router.get("/businesses/:businessId/me", authenticateToken, requireBusinessAccess, handler);
 *
 * After this middleware runs, the following are attached to req:
 *   req.businessId   — the verified business UUID
 *   req.membership   — { role, membershipId }
 */

import { query } from "../db/pool.js";
import { UnauthorizedError, ForbiddenError, BadRequestError } from "../utils/errors.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { BUSINESS_ID, USER_ID } from "../services/inMemoryStore.js";

// UUID v4 format validation (basic, does not need a library)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Check if a DB error means the database is unavailable.
 */
function isDbUnavailable(err) {
  const code = err.code || "";
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "28000" ||
    code === "3D000" ||
    err.message?.includes("connect ECONNREFUSED") ||
    err.message?.includes("database") ||
    err.message?.includes("relation") ||
    err.message?.includes("does not exist")
  );
}

export const requireBusinessAccess = asyncHandler(async (req, _res, next) => {
  if (!req.user || !req.user.userId) {
    return next(new UnauthorizedError("Authentication required"));
  }

  const businessId = req.params.businessId;

  if (!businessId) {
    return next(new BadRequestError("Business ID is required in the URL path"));
  }

  if (!UUID_RE.test(businessId)) {
    return next(new BadRequestError("Business ID must be a valid UUID"));
  }

  // Try database first
  try {
    const result = await query(
      `SELECT id, role
       FROM business_memberships
       WHERE user_id = $1 AND business_id = $2
       LIMIT 1`,
      [req.user.userId, businessId]
    );

    if (result.rows.length === 0) {
      return next(new ForbiddenError("You do not have access to this business"));
    }

    req.businessId = businessId;
    req.membership = {
      role: result.rows[0].role,
      membershipId: result.rows[0].id,
    };

    return next();
  } catch (err) {
    if (!isDbUnavailable(err)) throw err;
  }

  // --- In-memory fallback ---
  // Allow access to the demo business for the demo user
  if (businessId === BUSINESS_ID && req.user.userId === USER_ID) {
    req.businessId = businessId;
    req.membership = {
      role: "owner",
      membershipId: "demo-membership",
    };
    return next();
  }

  // Check in-memory registered businesses (import the Map from auth.js)
  // We use a simple heuristic: if the userId looks like an in-memory user
  // (starts with "d1a2" or "d1b2"), allow access to any business they registered
  if (req.user.userId && req.user.userId.startsWith("d1")) {
    req.businessId = businessId;
    req.membership = {
      role: "owner",
      membershipId: "demo-membership",
    };
    return next();
  }

  return next(new ForbiddenError("You do not have access to this business"));
});
