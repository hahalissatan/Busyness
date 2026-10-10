/**
 * routes/marketing.js — AI Marketing & Pitch Deck API.
 *
 * All routes in this router are prefixed with:
 *   /api/businesses/:businessId/marketing
 *
 * Every route requires BOTH:
 *   1. authenticateToken  — verifies the JWT
 *   2. requireBusinessAccess — verifies business membership
 *
 * Endpoints (26 total):
 *   Marketing Projects (5):
 *     POST   /projects                    — Create a marketing project
 *     GET    /projects                    — List projects (pagination + search + status filter)
 *     GET    /projects/:projectId         — Get project detail (with personas, drafts, pitch decks)
 *     PATCH  /projects/:projectId         — Update project fields
 *     DELETE /projects/:projectId         — Delete a project
 *
 *   Customer Personas (6):
 *     POST   /personas                    — Create a customer persona
 *     POST   /personas/generate           — AI-generate a customer persona (demo fallback)
 *     GET    /personas                    — List personas (pagination + search)
 *     GET    /personas/:personaId         — Get persona detail
 *     PATCH  /personas/:personaId         — Update persona
 *     DELETE /personas/:personaId         — Delete persona
 *
 *   Marketing Drafts (7):
 *     POST   /projects/:projectId/drafts            — Create a draft for a project
 *     POST   /projects/:projectId/drafts/generate   — AI-generate a draft (demo fallback)
 *     GET    /projects/:projectId/drafts            — List drafts for a project
 *     GET    /drafts/:draftId                       — Get one draft
 *     PATCH  /drafts/:draftId                       — Edit draft
 *     POST   /drafts/:draftId/revise                — AI-revise draft content (demo fallback)
 *     DELETE /drafts/:draftId                       — Delete draft
 *
 *   Pitch Decks (7):
 *     POST   /projects/:projectId/pitch-decks            — Create a pitch deck
 *     POST   /projects/:projectId/pitch-decks/generate   — AI-generate a pitch deck (demo fallback)
 *     GET    /projects/:projectId/pitch-decks            — List pitch decks for a project
 *     GET    /pitch-decks/:pitchDeckId                   — Get one pitch deck
 *     PATCH  /pitch-decks/:pitchDeckId                   — Update pitch deck
 *     POST   /pitch-decks/:pitchDeckId/revise            — AI-revise pitch deck (demo fallback)
 *     DELETE /pitch-decks/:pitchDeckId                   — Delete pitch deck
 *
 *   Overview (1):
 *     GET    /overview                     — Marketing summary for the business
 *
 * Schema notes:
 *   - pitch_decks.marketing_project_id is a nullable FK to marketing_projects
 *     (added via migration 008). Project-scoped routes filter by this column.
 *     Existing unlinked pitch decks (marketing_project_id = NULL) are not
 *     returned in project-scoped listings.
 *   - No agent_run_id on marketing tables (agent integration is a future phase).
 */

import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireBusinessAccess } from "../middleware/businessAuth.js";
import {
  BadRequestError,
  NotFoundError,
} from "../utils/errors.js";
import {
  generateMarketingContent,
  generatePersona,
  generatePitchDeck,
  reviseContent,
  getGeneratorInfo,
} from "../services/marketingGen.js";

const router = Router({ mergeParams: true });

// Apply auth + business access to ALL routes in this router
router.use(authenticateToken, requireBusinessAccess);

// ===================================================================
// Helpers (reused patterns from financials.js / inventory.js / tasks.js)
// ===================================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePagination(queryObj) {
  let page = parseInt(queryObj.page, 10);
  let limit = parseInt(queryObj.limit, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (!Number.isInteger(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  return { page, limit, offset: (page - 1) * limit };
}

function requireUUID(value, name) {
  if (!value || !UUID_RE.test(value)) {
    throw new BadRequestError(`${name} must be a valid UUID`);
  }
  return value;
}

function formatZodError(parsed) {
  return {
    errors: parsed.error.issues.map((i) => ({
      field: i.path.join("."),
      message: i.message,
    })),
  };
}

// Status transition maps
const PROJECT_TRANSITIONS = {
  draft: ["active"],
  active: ["completed"],
  completed: [],
};

const DRAFT_TRANSITIONS = {
  draft: ["reviewed"],
  reviewed: ["approved"],
  approved: ["published"],
  published: [],
};

const PITCH_DECK_TRANSITIONS = {
  draft: ["reviewed"],
  reviewed: ["finalized"],
  finalized: [],
};

function validateTransition(current, target, transitionMap, entityName) {
  if (current === target) {
    throw new BadRequestError(`${entityName} is already in '${target}' status`);
  }
  const allowed = transitionMap[current] || [];
  if (!allowed.includes(target)) {
    throw new BadRequestError(
      `Invalid status transition: '${current}' -> '${target}'. ` +
        `Valid transitions from '${current}': ${allowed.length ? allowed.join(", ") : "none (terminal status)"}`
    );
  }
}

// ===================================================================
// Zod Validation Schemas
// ===================================================================

const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(200),
  description: z.string().max(5000).optional().nullable(),
  status: z.enum(["draft", "active", "completed"]).optional().default("draft"),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
});

const updateProjectStatusSchema = z.object({
  status: z.enum(["draft", "active", "completed"]),
});

const createPersonaSchema = z.object({
  name: z.string().min(1, "Persona name is required").max(200),
  description: z.string().max(5000).optional().nullable(),
  pain_points: z.string().max(5000).optional().nullable(),
  motivations: z.string().max(5000).optional().nullable(),
  target_segment: z.string().max(500).optional().nullable(),
  marketing_project_id: z.string().uuid("Marketing project ID must be a valid UUID").optional().nullable(),
});

const updatePersonaSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  pain_points: z.string().max(5000).optional().nullable(),
  motivations: z.string().max(5000).optional().nullable(),
  target_segment: z.string().max(500).optional().nullable(),
});

const generatePersonaSchema = z.object({
  projectName: z.string().max(200).optional(),
  projectDescription: z.string().max(5000).optional(),
  audienceDescription: z.string().max(1000).optional(),
  marketing_project_id: z.string().uuid().optional().nullable(),
});

const createDraftSchema = z.object({
  draft_type: z.enum(["social_media", "campaign", "content", "email"]),
  title: z.string().min(1, "Draft title is required").max(500),
  content: z.string().min(1, "Draft content is required").max(20000),
  platform: z.string().max(100).optional().nullable(),
  status: z.enum(["draft", "reviewed", "approved", "published"]).optional().default("draft"),
});

const updateDraftSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(20000).optional(),
  platform: z.string().max(100).optional().nullable(),
});

const updateDraftStatusSchema = z.object({
  status: z.enum(["draft", "reviewed", "approved", "published"]),
});

const generateDraftSchema = z.object({
  draft_type: z.enum(["social_media", "campaign", "content", "email"]),
  platform: z.string().max(100).optional(),
  tone: z.string().max(100).optional(),
  audience: z.string().max(500).optional(),
});

const reviseDraftSchema = z.object({
  instructions: z.string().min(1, "Revision instructions are required").max(2000),
});

// Slide schema for pitch deck
const slideSchema = z.object({
  slide_number: z.number().int().positive(),
  heading: z.string().min(1).max(300),
  bullet_points: z.array(z.string()).optional().default([]),
  speaker_notes: z.string().optional().default(""),
});

const createPitchDeckSchema = z.object({
  title: z.string().min(1, "Pitch deck title is required").max(500),
  slides: z.array(slideSchema).min(1, "At least one slide is required"),
  status: z.enum(["draft", "reviewed", "finalized"]).optional().default("draft"),
});

const updatePitchDeckSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  slides: z.array(slideSchema).min(1).optional(),
});

const updatePitchDeckStatusSchema = z.object({
  status: z.enum(["draft", "reviewed", "finalized"]),
});

const generatePitchDeckSchema = z.object({
  businessName: z.string().max(200).optional(),
});

const revisePitchDeckSchema = z.object({
  instructions: z.string().min(1, "Revision instructions are required").max(2000),
});

// ===================================================================
// MARKETING PROJECT ROUTES
// ===================================================================

// --- POST /projects — Create a marketing project --------------------

router.post(
  "/projects",
  asyncHandler(async (req, res) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const { name, description, status } = parsed.data;

    const result = await query(
      `INSERT INTO marketing_projects (business_id, name, description, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, business_id, name, description, status, created_at, updated_at`,
      [businessId, name, description ?? null, status]
    );

    res.status(201).json(result.rows[0]);
  })
);

// --- GET /projects — List projects ----------------------------------

router.get(
  "/projects",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const { page, limit, offset } = parsePagination(req.query);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim() : "";

    const conditions = ["mp.business_id = $1"];
    const params = [businessId];
    let paramIdx = 2;

    if (search) {
      conditions.push(`(mp.name ILIKE $${paramIdx} OR mp.description ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (statusFilter && ["draft", "active", "completed"].includes(statusFilter)) {
      conditions.push(`mp.status = $${paramIdx}`);
      params.push(statusFilter);
      paramIdx++;
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM marketing_projects mp WHERE ${whereClause}`,
      params
    );

    params.push(limit);
    const limitParam = paramIdx++;
    params.push(offset);
    const offsetParam = paramIdx;

    const result = await query(
      `SELECT mp.id, mp.business_id, mp.name, mp.description, mp.status,
          mp.created_at, mp.updated_at,
          (SELECT COUNT(*)::int FROM customer_personas cp WHERE cp.marketing_project_id = mp.id) AS persona_count,
          (SELECT COUNT(*)::int FROM marketing_drafts md WHERE md.marketing_project_id = mp.id) AS draft_count,
          (SELECT COUNT(*)::int FROM pitch_decks pd WHERE pd.marketing_project_id = mp.id) AS pitch_deck_count
       FROM marketing_projects mp
       WHERE ${whereClause}
       ORDER BY mp.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      data: result.rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 0 },
    });
  })
);

// --- GET /projects/:projectId — Get project detail ------------------

router.get(
  "/projects/:projectId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const projectId = requireUUID(req.params.projectId, "Project ID");

    const result = await query(
      `SELECT mp.id, mp.business_id, mp.name, mp.description, mp.status,
          mp.created_at, mp.updated_at,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'id', cp.id, 'name', cp.name, 'target_segment', cp.target_segment
            ) ORDER BY cp.created_at DESC)
             FROM customer_personas cp WHERE cp.marketing_project_id = mp.id),
            '[]'::json
          ) AS personas,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'id', md.id, 'title', md.title, 'draft_type', md.draft_type,
              'status', md.status, 'platform', md.platform
            ) ORDER BY md.created_at DESC)
             FROM marketing_drafts md WHERE md.marketing_project_id = mp.id),
            '[]'::json
          ) AS drafts,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'id', pd.id, 'title', pd.title, 'status', pd.status
            ) ORDER BY pd.created_at DESC)
             FROM pitch_decks pd WHERE pd.marketing_project_id = mp.id),
            '[]'::json
          ) AS pitch_decks
       FROM marketing_projects mp
       WHERE mp.id = $1 AND mp.business_id = $2`,
      [projectId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Marketing project not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /projects/:projectId — Update project --------------------

router.patch(
  "/projects/:projectId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const projectId = requireUUID(req.params.projectId, "Project ID");

    // Protected fields — check before Zod strips them
    const protectedFields = ["status", "business_id"];
    for (const field of protectedFields) {
      if (field in req.body) {
        const hint = field === "status"
          ? " Use PATCH /projects/:projectId/status for status changes."
          : "";
        throw new BadRequestError(`${field} cannot be updated via this endpoint.${hint}`);
      }
    }

    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, val] of Object.entries(parsed.data)) {
      if (val === undefined) continue;
      fields.push(`${key} = $${paramIndex}`);
      values.push(val ?? null);
      paramIndex++;
    }

    if (fields.length === 0) {
      throw new BadRequestError("No fields provided to update");
    }

    values.push(projectId);
    const idParam = paramIndex++;
    values.push(businessId);
    const bizParam = paramIndex;

    const result = await query(
      `UPDATE marketing_projects SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${idParam} AND business_id = $${bizParam}
       RETURNING id, business_id, name, description, status, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Marketing project not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /projects/:projectId/status — Update status --------------

router.patch(
  "/projects/:projectId/status",
  asyncHandler(async (req, res) => {
    const parsed = updateProjectStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const projectId = requireUUID(req.params.projectId, "Project ID");
    const newStatus = parsed.data.status;

    const projectResult = await query(
      "SELECT id, status FROM marketing_projects WHERE id = $1 AND business_id = $2",
      [projectId, businessId]
    );

    if (projectResult.rows.length === 0) {
      throw new NotFoundError("Marketing project not found");
    }

    const currentStatus = projectResult.rows[0].status;
    validateTransition(currentStatus, newStatus, PROJECT_TRANSITIONS, "Project");

    const result = await query(
      `UPDATE marketing_projects SET status = $1, updated_at = now()
       WHERE id = $2 AND business_id = $3
       RETURNING id, business_id, name, description, status, created_at, updated_at`,
      [newStatus, projectId, businessId]
    );

    res.json(result.rows[0]);
  })
);

// --- DELETE /projects/:projectId — Delete project -------------------

router.delete(
  "/projects/:projectId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const projectId = requireUUID(req.params.projectId, "Project ID");

    // Check if project has active children (personas/drafts/pitch decks linked)
    const childCheck = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM customer_personas cp WHERE cp.marketing_project_id = $1) AS persona_count,
         (SELECT COUNT(*)::int FROM marketing_drafts md WHERE md.marketing_project_id = $1) AS draft_count,
         (SELECT COUNT(*)::int FROM pitch_decks pd WHERE pd.marketing_project_id = $1) AS pitch_deck_count`,
      [projectId]
    );

    const counts = childCheck.rows[0];
    if (parseInt(counts.persona_count) > 0 || parseInt(counts.draft_count) > 0 || parseInt(counts.pitch_deck_count) > 0) {
      throw new BadRequestError(
        "Cannot delete a project with linked personas, drafts, or pitch decks. " +
          "Remove or reassign them first. " +
          `(Found: ${counts.persona_count} personas, ${counts.draft_count} drafts, ${counts.pitch_deck_count} pitch decks.)`
      );
    }

    const result = await query(
      "DELETE FROM marketing_projects WHERE id = $1 AND business_id = $2 RETURNING id",
      [projectId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Marketing project not found");
    }

    res.status(204).send();
  })
);

// ===================================================================
// CUSTOMER PERSONA ROUTES
// ===================================================================

// --- POST /personas/generate — AI-generate a persona ---------------
// (Defined before /personas/:personaId to avoid route matching issues)

router.post(
  "/personas/generate",
  asyncHandler(async (req, res) => {
    const parsed = generatePersonaSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const { projectName, projectDescription, audienceDescription, marketing_project_id } = parsed.data;

    // If marketing_project_id is provided, verify it belongs to this business
    if (marketing_project_id) {
      const projCheck = await query(
        "SELECT id, name, description FROM marketing_projects WHERE id = $1 AND business_id = $2",
        [marketing_project_id, businessId]
      );
      if (projCheck.rows.length === 0) {
        throw new NotFoundError("Marketing project not found");
      }
      // Use project info for generation context
      const proj = projCheck.rows[0];
      if (!projectName) parsed.data.projectName = proj.name;
      if (!projectDescription) parsed.data.projectDescription = proj.description;
    }

    const generated = generatePersona({
      projectName: parsed.data.projectName,
      projectDescription: parsed.data.projectDescription,
      audienceDescription,
    });

    const result = await query(
      `INSERT INTO customer_personas (business_id, marketing_project_id, name, description, pain_points, motivations, target_segment)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, business_id, marketing_project_id, name, description,
         pain_points, motivations, target_segment, created_at, updated_at`,
      [
        businessId,
        marketing_project_id ?? null,
        generated.name,
        generated.description,
        generated.pain_points,
        generated.motivations,
        generated.target_segment,
      ]
    );

    res.status(201).json({
      ...result.rows[0],
      _generator: getGeneratorInfo(),
    });
  })
);

// --- POST /personas — Create a customer persona --------------------

router.post(
  "/personas",
  asyncHandler(async (req, res) => {
    const parsed = createPersonaSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const { name, description, pain_points, motivations, target_segment, marketing_project_id } = parsed.data;

    // If marketing_project_id is provided, verify it belongs to this business
    if (marketing_project_id) {
      const projCheck = await query(
        "SELECT id FROM marketing_projects WHERE id = $1 AND business_id = $2",
        [marketing_project_id, businessId]
      );
      if (projCheck.rows.length === 0) {
        throw new NotFoundError("Marketing project not found in this business");
      }
    }

    const result = await query(
      `INSERT INTO customer_personas (business_id, marketing_project_id, name, description, pain_points, motivations, target_segment)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, business_id, marketing_project_id, name, description,
         pain_points, motivations, target_segment, created_at, updated_at`,
      [
        businessId,
        marketing_project_id ?? null,
        name,
        description ?? null,
        pain_points ?? null,
        motivations ?? null,
        target_segment ?? null,
      ]
    );

    res.status(201).json(result.rows[0]);
  })
);

// --- GET /personas — List personas ----------------------------------

router.get(
  "/personas",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const { page, limit, offset } = parsePagination(req.query);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

    const conditions = ["cp.business_id = $1"];
    const params = [businessId];
    let paramIdx = 2;

    if (search) {
      conditions.push(`(cp.name ILIKE $${paramIdx} OR cp.target_segment ILIKE $${paramIdx} OR cp.description ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM customer_personas cp WHERE ${whereClause}`,
      params
    );

    params.push(limit);
    const limitParam = paramIdx++;
    params.push(offset);
    const offsetParam = paramIdx;

    const result = await query(
      `SELECT cp.id, cp.business_id, cp.marketing_project_id, cp.name, cp.description,
          cp.pain_points, cp.motivations, cp.target_segment,
          cp.created_at, cp.updated_at,
          mp.name AS project_name
       FROM customer_personas cp
       LEFT JOIN marketing_projects mp ON mp.id = cp.marketing_project_id
       WHERE ${whereClause}
       ORDER BY cp.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      data: result.rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 0 },
    });
  })
);

// --- GET /personas/:personaId — Get persona detail ------------------

router.get(
  "/personas/:personaId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const personaId = requireUUID(req.params.personaId, "Persona ID");

    const result = await query(
      `SELECT cp.id, cp.business_id, cp.marketing_project_id, cp.name, cp.description,
          cp.pain_points, cp.motivations, cp.target_segment,
          cp.created_at, cp.updated_at,
          mp.name AS project_name
       FROM customer_personas cp
       LEFT JOIN marketing_projects mp ON mp.id = cp.marketing_project_id
       WHERE cp.id = $1 AND cp.business_id = $2`,
      [personaId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Customer persona not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /personas/:personaId — Update persona -------------------

router.patch(
  "/personas/:personaId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const personaId = requireUUID(req.params.personaId, "Persona ID");

    // Protected fields
    const protectedFields = ["business_id", "marketing_project_id"];
    for (const field of protectedFields) {
      if (field in req.body) {
        throw new BadRequestError(
          `${field} cannot be updated via this endpoint.`
        );
      }
    }

    const parsed = updatePersonaSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, val] of Object.entries(parsed.data)) {
      if (val === undefined) continue;
      fields.push(`${key} = $${paramIndex}`);
      values.push(val ?? null);
      paramIndex++;
    }

    if (fields.length === 0) {
      throw new BadRequestError("No fields provided to update");
    }

    values.push(personaId);
    const idParam = paramIndex++;
    values.push(businessId);
    const bizParam = paramIndex;

    const result = await query(
      `UPDATE customer_personas SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${idParam} AND business_id = $${bizParam}
       RETURNING id, business_id, marketing_project_id, name, description,
         pain_points, motivations, target_segment, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Customer persona not found");
    }

    res.json(result.rows[0]);
  })
);

// --- DELETE /personas/:personaId — Delete persona ------------------

router.delete(
  "/personas/:personaId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const personaId = requireUUID(req.params.personaId, "Persona ID");

    const result = await query(
      "DELETE FROM customer_personas WHERE id = $1 AND business_id = $2 RETURNING id",
      [personaId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Customer persona not found");
    }

    res.status(204).send();
  })
);

// ===================================================================
// MARKETING DRAFT ROUTES (project-scoped + standalone)
// ===================================================================

// --- POST /projects/:projectId/drafts/generate — AI-generate draft --
// (Defined before GET /projects/:projectId/drafts to avoid conflicts)

router.post(
  "/projects/:projectId/drafts/generate",
  asyncHandler(async (req, res) => {
    const parsed = generateDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const projectId = requireUUID(req.params.projectId, "Project ID");

    // Verify project exists and belongs to business
    const projResult = await query(
      "SELECT id, name, description FROM marketing_projects WHERE id = $1 AND business_id = $2",
      [projectId, businessId]
    );
    if (projResult.rows.length === 0) {
      throw new NotFoundError("Marketing project not found");
    }

    const project = projResult.rows[0];
    const { draft_type, platform, tone, audience } = parsed.data;

    const generated = generateMarketingContent({
      projectName: project.name,
      projectDescription: project.description,
      draftType: draft_type,
      platform,
      tone,
      audience,
    });

    const result = await query(
      `INSERT INTO marketing_drafts (business_id, marketing_project_id, draft_type, title, content, platform, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft')
       RETURNING id, business_id, marketing_project_id, draft_type, title,
         content, platform, status, created_at, updated_at`,
      [
        businessId,
        projectId,
        generated.draft_type,
        generated.title,
        generated.content,
        generated.platform,
      ]
    );

    res.status(201).json({
      ...result.rows[0],
      _generator: getGeneratorInfo(),
    });
  })
);

// --- POST /projects/:projectId/drafts — Create a draft --------------

router.post(
  "/projects/:projectId/drafts",
  asyncHandler(async (req, res) => {
    const parsed = createDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const projectId = requireUUID(req.params.projectId, "Project ID");

    // Verify project exists and belongs to business
    const projCheck = await query(
      "SELECT id FROM marketing_projects WHERE id = $1 AND business_id = $2",
      [projectId, businessId]
    );
    if (projCheck.rows.length === 0) {
      throw new NotFoundError("Marketing project not found");
    }

    const { draft_type, title, content, platform, status } = parsed.data;

    const result = await query(
      `INSERT INTO marketing_drafts (business_id, marketing_project_id, draft_type, title, content, platform, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, business_id, marketing_project_id, draft_type, title,
         content, platform, status, created_at, updated_at`,
      [
        businessId,
        projectId,
        draft_type,
        title,
        content,
        platform ?? null,
        status,
      ]
    );

    res.status(201).json(result.rows[0]);
  })
);

// --- GET /projects/:projectId/drafts — List drafts for a project ----

router.get(
  "/projects/:projectId/drafts",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const projectId = requireUUID(req.params.projectId, "Project ID");
    const { page, limit, offset } = parsePagination(req.query);
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim() : "";

    // Verify project exists and belongs to business
    const projCheck = await query(
      "SELECT id FROM marketing_projects WHERE id = $1 AND business_id = $2",
      [projectId, businessId]
    );
    if (projCheck.rows.length === 0) {
      throw new NotFoundError("Marketing project not found");
    }

    const conditions = ["md.business_id = $1", "md.marketing_project_id = $2"];
    const params = [businessId, projectId];
    let paramIdx = 3;

    if (statusFilter && ["draft", "reviewed", "approved", "published"].includes(statusFilter)) {
      conditions.push(`md.status = $${paramIdx}`);
      params.push(statusFilter);
      paramIdx++;
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM marketing_drafts md WHERE ${whereClause}`,
      params
    );

    params.push(limit);
    const limitParam = paramIdx++;
    params.push(offset);
    const offsetParam = paramIdx;

    const result = await query(
      `SELECT md.id, md.business_id, md.marketing_project_id, md.draft_type,
          md.title, md.content, md.platform, md.status,
          md.created_at, md.updated_at
       FROM marketing_drafts md
       WHERE ${whereClause}
       ORDER BY md.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      data: result.rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 0 },
    });
  })
);

// --- GET /drafts/:draftId — Get one draft ---------------------------

router.get(
  "/drafts/:draftId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const draftId = requireUUID(req.params.draftId, "Draft ID");

    const result = await query(
      `SELECT md.id, md.business_id, md.marketing_project_id, md.draft_type,
          md.title, md.content, md.platform, md.status,
          md.created_at, md.updated_at,
          mp.name AS project_name
       FROM marketing_drafts md
       LEFT JOIN marketing_projects mp ON mp.id = md.marketing_project_id
       WHERE md.id = $1 AND md.business_id = $2`,
      [draftId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Marketing draft not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /drafts/:draftId — Edit draft ---------------------------

router.patch(
  "/drafts/:draftId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const draftId = requireUUID(req.params.draftId, "Draft ID");

    // Protected fields
    const protectedFields = ["status", "business_id", "marketing_project_id", "draft_type"];
    for (const field of protectedFields) {
      if (field in req.body) {
        const hint = field === "status"
          ? " Use PATCH /drafts/:draftId/status for status changes."
          : "";
        throw new BadRequestError(`${field} cannot be updated via this endpoint.${hint}`);
      }
    }

    const parsed = updateDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, val] of Object.entries(parsed.data)) {
      if (val === undefined) continue;
      fields.push(`${key} = $${paramIndex}`);
      values.push(val ?? null);
      paramIndex++;
    }

    if (fields.length === 0) {
      throw new BadRequestError("No fields provided to update");
    }

    values.push(draftId);
    const idParam = paramIndex++;
    values.push(businessId);
    const bizParam = paramIndex;

    const result = await query(
      `UPDATE marketing_drafts SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${idParam} AND business_id = $${bizParam}
       RETURNING id, business_id, marketing_project_id, draft_type, title,
         content, platform, status, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Marketing draft not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /drafts/:draftId/status — Update draft status -----------

router.patch(
  "/drafts/:draftId/status",
  asyncHandler(async (req, res) => {
    const parsed = updateDraftStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const draftId = requireUUID(req.params.draftId, "Draft ID");
    const newStatus = parsed.data.status;

    const draftResult = await query(
      "SELECT id, status FROM marketing_drafts WHERE id = $1 AND business_id = $2",
      [draftId, businessId]
    );

    if (draftResult.rows.length === 0) {
      throw new NotFoundError("Marketing draft not found");
    }

    const currentStatus = draftResult.rows[0].status;
    validateTransition(currentStatus, newStatus, DRAFT_TRANSITIONS, "Draft");

    const result = await query(
      `UPDATE marketing_drafts SET status = $1, updated_at = now()
       WHERE id = $2 AND business_id = $3
       RETURNING id, business_id, marketing_project_id, draft_type, title,
         content, platform, status, created_at, updated_at`,
      [newStatus, draftId, businessId]
    );

    res.json(result.rows[0]);
  })
);

// --- POST /drafts/:draftId/revise — AI-revise draft ----------------

router.post(
  "/drafts/:draftId/revise",
  asyncHandler(async (req, res) => {
    const parsed = reviseDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const draftId = requireUUID(req.params.draftId, "Draft ID");
    const { instructions } = parsed.data;

    // Fetch the draft
    const draftResult = await query(
      "SELECT id, content FROM marketing_drafts WHERE id = $1 AND business_id = $2",
      [draftId, businessId]
    );

    if (draftResult.rows.length === 0) {
      throw new NotFoundError("Marketing draft not found");
    }

    const draft = draftResult.rows[0];

    // Revise content using the generation service
    const revised = reviseContent({
      existingContent: draft.content,
      instructions,
      contentType: "draft",
    });

    // Update the draft with revised content
    const result = await query(
      `UPDATE marketing_drafts SET content = $1, updated_at = now()
       WHERE id = $2 AND business_id = $3
       RETURNING id, business_id, marketing_project_id, draft_type, title,
         content, platform, status, created_at, updated_at`,
      [revised.content, draftId, businessId]
    );

    res.json({
      ...result.rows[0],
      _generator: getGeneratorInfo(),
    });
  })
);

// --- DELETE /drafts/:draftId — Delete draft ------------------------

router.delete(
  "/drafts/:draftId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const draftId = requireUUID(req.params.draftId, "Draft ID");

    const result = await query(
      "DELETE FROM marketing_drafts WHERE id = $1 AND business_id = $2 RETURNING id",
      [draftId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Marketing draft not found");
    }

    res.status(204).send();
  })
);

// ===================================================================
// PITCH DECK ROUTES (project-scoped creation + standalone management)
// pitch_decks.marketing_project_id is a nullable FK to marketing_projects
// (added via migration 008). Project-scoped routes filter by this column.
// ===================================================================

// --- POST /projects/:projectId/pitch-decks/generate — AI-generate --

router.post(
  "/projects/:projectId/pitch-decks/generate",
  asyncHandler(async (req, res) => {
    const parsed = generatePitchDeckSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const projectId = requireUUID(req.params.projectId, "Project ID");

    // Verify project exists and belongs to business
    const projResult = await query(
      "SELECT id, name, description FROM marketing_projects WHERE id = $1 AND business_id = $2",
      [projectId, businessId]
    );
    if (projResult.rows.length === 0) {
      throw new NotFoundError("Marketing project not found");
    }

    const project = projResult.rows[0];

    const generated = generatePitchDeck({
      projectName: project.name,
      projectDescription: project.description,
      businessName: parsed.data.businessName,
    });

    const result = await query(
      `INSERT INTO pitch_decks (business_id, marketing_project_id, title, slides, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING id, business_id, marketing_project_id, title, slides, status, created_at, updated_at`,
      [businessId, projectId, generated.title, JSON.stringify(generated.slides)]
    );

    res.status(201).json({
      ...result.rows[0],
      _generator: getGeneratorInfo(),
    });
  })
);

// --- POST /projects/:projectId/pitch-decks — Create pitch deck ------

router.post(
  "/projects/:projectId/pitch-decks",
  asyncHandler(async (req, res) => {
    const parsed = createPitchDeckSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const projectId = requireUUID(req.params.projectId, "Project ID");

    // Verify project exists and belongs to business
    const projCheck = await query(
      "SELECT id FROM marketing_projects WHERE id = $1 AND business_id = $2",
      [projectId, businessId]
    );
    if (projCheck.rows.length === 0) {
      throw new NotFoundError("Marketing project not found");
    }

    const { title, slides, status } = parsed.data;

    const result = await query(
      `INSERT INTO pitch_decks (business_id, marketing_project_id, title, slides, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, business_id, marketing_project_id, title, slides, status, created_at, updated_at`,
      [businessId, projectId, title, JSON.stringify(slides), status]
    );

    res.status(201).json(result.rows[0]);
  })
);

// --- GET /projects/:projectId/pitch-decks — List pitch decks -------
// Filters by marketing_project_id (only this project's decks).

router.get(
  "/projects/:projectId/pitch-decks",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const projectId = requireUUID(req.params.projectId, "Project ID");
    const { page, limit, offset } = parsePagination(req.query);

    // Verify project exists and belongs to business
    const projCheck = await query(
      "SELECT id FROM marketing_projects WHERE id = $1 AND business_id = $2",
      [projectId, businessId]
    );
    if (projCheck.rows.length === 0) {
      throw new NotFoundError("Marketing project not found");
    }

    // List pitch decks linked to this project only
    const countResult = await query(
      "SELECT COUNT(*)::int AS total FROM pitch_decks WHERE business_id = $1 AND marketing_project_id = $2",
      [businessId, projectId]
    );

    const result = await query(
      `SELECT pd.id, pd.business_id, pd.marketing_project_id, pd.title, pd.slides, pd.status,
          pd.created_at, pd.updated_at
       FROM pitch_decks pd
       WHERE pd.business_id = $1 AND pd.marketing_project_id = $2
       ORDER BY pd.created_at DESC
       LIMIT $3 OFFSET $4`,
      [businessId, projectId, limit, offset]
    );

    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      data: result.rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 0 },
    });
  })
);

// --- GET /pitch-decks/:pitchDeckId — Get one pitch deck ------------

router.get(
  "/pitch-decks/:pitchDeckId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const pitchDeckId = requireUUID(req.params.pitchDeckId, "Pitch deck ID");

    const result = await query(
      `SELECT pd.id, pd.business_id, pd.marketing_project_id, pd.title, pd.slides, pd.status,
          pd.created_at, pd.updated_at
       FROM pitch_decks pd
       WHERE pd.id = $1 AND pd.business_id = $2`,
      [pitchDeckId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Pitch deck not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /pitch-decks/:pitchDeckId — Update pitch deck -----------

router.patch(
  "/pitch-decks/:pitchDeckId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const pitchDeckId = requireUUID(req.params.pitchDeckId, "Pitch deck ID");

    // Protected fields
    const protectedFields = ["status", "business_id", "marketing_project_id"];
    for (const field of protectedFields) {
      if (field in req.body) {
        const hint = field === "status"
          ? " Use PATCH /pitch-decks/:pitchDeckId/status for status changes."
          : "";
        throw new BadRequestError(`${field} cannot be updated via this endpoint.${hint}`);
      }
    }

    const parsed = updatePitchDeckSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, val] of Object.entries(parsed.data)) {
      if (val === undefined) continue;
      if (key === "slides") {
        fields.push(`slides = $${paramIndex}::jsonb`);
        values.push(JSON.stringify(val));
      } else {
        fields.push(`${key} = $${paramIndex}`);
        values.push(val ?? null);
      }
      paramIndex++;
    }

    if (fields.length === 0) {
      throw new BadRequestError("No fields provided to update");
    }

    values.push(pitchDeckId);
    const idParam = paramIndex++;
    values.push(businessId);
    const bizParam = paramIndex;

    const result = await query(
      `UPDATE pitch_decks SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${idParam} AND business_id = $${bizParam}
       RETURNING id, business_id, marketing_project_id, title, slides, status, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Pitch deck not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /pitch-decks/:pitchDeckId/status — Update status --------

router.patch(
  "/pitch-decks/:pitchDeckId/status",
  asyncHandler(async (req, res) => {
    const parsed = updatePitchDeckStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const pitchDeckId = requireUUID(req.params.pitchDeckId, "Pitch deck ID");
    const newStatus = parsed.data.status;

    const deckResult = await query(
      "SELECT id, status FROM pitch_decks WHERE id = $1 AND business_id = $2",
      [pitchDeckId, businessId]
    );

    if (deckResult.rows.length === 0) {
      throw new NotFoundError("Pitch deck not found");
    }

    const currentStatus = deckResult.rows[0].status;
    validateTransition(currentStatus, newStatus, PITCH_DECK_TRANSITIONS, "Pitch deck");

    const result = await query(
      `UPDATE pitch_decks SET status = $1, updated_at = now()
       WHERE id = $2 AND business_id = $3
       RETURNING id, business_id, marketing_project_id, title, slides, status, created_at, updated_at`,
      [newStatus, pitchDeckId, businessId]
    );

    res.json(result.rows[0]);
  })
);

// --- POST /pitch-decks/:pitchDeckId/revise — AI-revise pitch deck --

router.post(
  "/pitch-decks/:pitchDeckId/revise",
  asyncHandler(async (req, res) => {
    const parsed = revisePitchDeckSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const pitchDeckId = requireUUID(req.params.pitchDeckId, "Pitch deck ID");
    const { instructions } = parsed.data;

    // Fetch the pitch deck
    const deckResult = await query(
      "SELECT id, slides FROM pitch_decks WHERE id = $1 AND business_id = $2",
      [pitchDeckId, businessId]
    );

    if (deckResult.rows.length === 0) {
      throw new NotFoundError("Pitch deck not found");
    }

    const deck = deckResult.rows[0];

    // Revise slides using the generation service
    const revised = reviseContent({
      existingContent: deck.slides,
      instructions,
      contentType: "pitch_deck",
    });

    // Update the pitch deck with revised slides
    const result = await query(
      `UPDATE pitch_decks SET slides = $1, updated_at = now()
       WHERE id = $2 AND business_id = $3
       RETURNING id, business_id, marketing_project_id, title, slides, status, created_at, updated_at`,
      [JSON.stringify(revised.slides), pitchDeckId, businessId]
    );

    res.json({
      ...result.rows[0],
      _generator: getGeneratorInfo(),
    });
  })
);

// --- DELETE /pitch-decks/:pitchDeckId — Delete pitch deck ----------

router.delete(
  "/pitch-decks/:pitchDeckId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const pitchDeckId = requireUUID(req.params.pitchDeckId, "Pitch deck ID");

    const result = await query(
      "DELETE FROM pitch_decks WHERE id = $1 AND business_id = $2 RETURNING id",
      [pitchDeckId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Pitch deck not found");
    }

    res.status(204).send();
  })
);

// ===================================================================
// OVERVIEW ROUTE
// ===================================================================

// --- GET /overview — Marketing summary for business ----------------

router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;

    const summary = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM marketing_projects WHERE business_id = $1) AS total_projects,
         (SELECT COUNT(*)::int FROM marketing_projects WHERE business_id = $1 AND status = 'draft') AS draft_projects,
         (SELECT COUNT(*)::int FROM marketing_projects WHERE business_id = $1 AND status = 'active') AS active_projects,
         (SELECT COUNT(*)::int FROM marketing_projects WHERE business_id = $1 AND status = 'completed') AS completed_projects,
         (SELECT COUNT(*)::int FROM customer_personas WHERE business_id = $1) AS total_personas,
         (SELECT COUNT(*)::int FROM marketing_drafts WHERE business_id = $1) AS total_drafts,
         (SELECT COUNT(*)::int FROM marketing_drafts WHERE business_id = $1 AND status = 'draft') AS draft_drafts,
         (SELECT COUNT(*)::int FROM marketing_drafts WHERE business_id = $1 AND status = 'reviewed') AS reviewed_drafts,
         (SELECT COUNT(*)::int FROM marketing_drafts WHERE business_id = $1 AND status = 'approved') AS approved_drafts,
         (SELECT COUNT(*)::int FROM marketing_drafts WHERE business_id = $1 AND status = 'published') AS published_drafts,
         (SELECT COUNT(*)::int FROM pitch_decks WHERE business_id = $1) AS total_pitch_decks,
         (SELECT COUNT(*)::int FROM pitch_decks WHERE business_id = $1 AND status = 'draft') AS draft_pitch_decks,
         (SELECT COUNT(*)::int FROM pitch_decks WHERE business_id = $1 AND status = 'reviewed') AS reviewed_pitch_decks,
         (SELECT COUNT(*)::int FROM pitch_decks WHERE business_id = $1 AND status = 'finalized') AS finalized_pitch_decks`,
      [businessId]
    );

    res.json(summary.rows[0]);
  })
);

export default router;
