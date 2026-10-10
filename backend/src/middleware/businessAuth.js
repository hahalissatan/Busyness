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

// UUID v4 format validation (basic, does not need a library)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requireBusinessAccess = asyncHandler(async (req, _res, next) => {
  // req.user is set by authenticateToken
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

  // Parameterized query — prevents SQL injection
  const result = await query(
    `SELECT id, role
     FROM business_memberships
     WHERE user_id = $1 AND business_id = $2
     LIMIT 1`,
    [req.user.userId, businessId]
  );

  if (result.rows.length === 0) {
    // 403, not 404 — the business may exist, the user just doesn't have access.
    // We don't reveal whether the business exists to avoid information leakage.
    return next(new ForbiddenError("You do not have access to this business"));
  }

  // Attach verified business context to the request
  req.businessId = businessId;
  req.membership = {
    role: result.rows[0].role,
    membershipId: result.rows[0].id,
  };

  next();
});
