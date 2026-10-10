/**
 * routes/business.js — Business-scoped endpoints.
 *
 * All routes in this router are prefixed with /api/businesses/:businessId
 * and require BOTH:
 *   1. authenticateToken  — verifies the JWT
 *   2. requireBusinessAccess — verifies the user has an active membership
 *
 * This file currently provides one demo endpoint (GET /me) to exercise
 * the auth + business-auth middleware chain. Module-specific routes
 * (Financial Hub, Inventory, etc.) will be added in later phases.
 */

import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { requireBusinessAccess } from "../middleware/businessAuth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router({ mergeParams: true });

// GET /api/businesses/:businessId/me
// Returns the authenticated user's membership info for this business.
router.get(
  "/me",
  authenticateToken,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    res.json({
      businessId: req.businessId,
      user: req.user,
      membership: req.membership,
    });
  })
);

export default router;
