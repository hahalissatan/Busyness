/**
 * routes/agent.js — Agent run endpoints.
 *
 * All endpoints require authentication (authenticateToken) and
 * business membership (requireBusinessAccess). The business ID is
 * taken from the URL path parameter, never from the request body.
 *
 * Endpoints:
 *   POST /api/businesses/:businessId/agent/runs         — create + run
 *   GET  /api/businesses/:businessId/agent/runs          — list recent runs
 *   GET  /api/businesses/:businessId/agent/runs/:runId   — get single run + steps
 */

import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { requireBusinessAccess } from "../middleware/businessAuth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { BadRequestError, NotFoundError } from "../utils/errors.js";
import { runCoordinator, listAgentRuns, getAgentRun } from "../services/coordinator.js";

const router = Router({ mergeParams: true });

// All routes in this file require auth + business access
router.use(authenticateToken, requireBusinessAccess);

// --- POST /agent/runs — Create and execute an agent run -----------------

router.post("/runs", asyncHandler(async (req, res) => {
  const { businessId, user } = req;
  const { goal } = req.body || {};

  // Validate goal
  if (!goal || typeof goal !== "string" || goal.trim().length === 0) {
    throw new BadRequestError("Goal is required", { field: "goal" });
  }

  if (goal.trim().length > 1000) {
    throw new BadRequestError("Goal must be 1000 characters or fewer", { field: "goal", max: 1000 });
  }

  // Run the coordinator (real database queries, scoped to businessId)
  const result = await runCoordinator({
    businessId,
    userId: user.userId,
    goal: goal.trim(),
  });

  res.status(200).json(result);
}));

// --- GET /agent/runs — List recent runs ---------------------------------

router.get("/runs", asyncHandler(async (req, res) => {
  const { businessId } = req;

  const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
  const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

  const runs = await listAgentRuns(businessId, { limit, offset });

  res.json({
    data: runs,
    pagination: {
      limit,
      offset,
      total: runs.length,
    },
  });
}));

// --- GET /agent/runs/:runId — Get single run with steps ------------------

router.get("/runs/:runId", asyncHandler(async (req, res) => {
  const { businessId } = req;
  const { runId } = req.params;

  const run = await getAgentRun(businessId, runId);

  if (!run) {
    throw new NotFoundError("Agent run not found");
  }

  res.json({ data: run });
}));

export default router;
