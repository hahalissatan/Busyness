/**
 * routes/tasks.js — Intelligent Task Allocation API.
 *
 * All routes in this router are prefixed with:
 *   /api/businesses/:businessId/tasks
 *
 * Every route requires BOTH:
 *   1. authenticateToken  — verifies the JWT
 *   2. requireBusinessAccess — verifies business membership
 *
 * Endpoints:
 *   Team Members:
 *     POST   /team-members                — Create an employee
 *     GET    /team-members                — List employees (pagination + search + availability filter)
 *     GET    /team-members/:employeeId    — Get employee detail (with skills + workload)
 *     PATCH  /team-members/:employeeId   — Update employee
 *     GET    /team-members/:employeeId/skills  — List employee skills
 *     POST   /team-members/:employeeId/skills  — Add skill to employee
 *     DELETE /team-members/:employeeId/skills/:skillId — Remove skill
 *
 *   Tasks:
 *     POST   /tasks                       — Create a task
 *     GET    /tasks                       — List tasks (pagination + filters)
 *     GET    /tasks/:taskId                — Get task detail (with assignments)
 *     PATCH  /tasks/:taskId                — Update task details
 *     PATCH  /tasks/:taskId/status         — Update task status (validated transitions)
 *     DELETE /tasks/:taskId                — Delete a task (CASCADE to assignments)
 *
 *   Assignments:
 *     POST   /tasks/:taskId/assignments          — Assign task to employee
 *     GET    /tasks/:taskId/assignments          — List assignments for a task
 *     PATCH  /tasks/:taskId/assignments/:assignmentId — Change assignment status
 *     DELETE /tasks/:taskId/assignments/:assignmentId — Remove assignment
 *
 *   Overview:
 *     GET    /overview                     — Business task summary
 *     GET    /team-members/:employeeId/workload — Member workload detail
 */

import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { getTaskOverview as memTaskOverview, getTeamWorkload as memTeamWorkload } from "../services/inMemoryStore.js";
import { withTransaction } from "../utils/transaction.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireBusinessAccess } from "../middleware/businessAuth.js";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../utils/errors.js";

const router = Router({ mergeParams: true });

// Apply auth + business access to ALL routes in this router
router.use(authenticateToken, requireBusinessAccess);

// ===================================================================
// Helpers (reused from financials.js / inventory.js patterns)
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

// Task status transition rules
const VALID_TRANSITIONS = {
  pending: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

// ===================================================================
// Zod Validation Schemas
// ===================================================================

const createEmployeeSchema = z.object({
  name: z.string().min(1, "Employee name is required").max(200),
  email: z.string().email("Invalid email format").max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  role: z.enum(["manager", "staff", "contractor"]),
  availability: z.enum(["available", "busy", "unavailable", "on_leave"]).optional().default("available"),
  max_workload_hours: z.number().int().positive().optional().default(40),
});

const updateEmployeeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email("Invalid email format").max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  role: z.enum(["manager", "staff", "contractor"]).optional(),
  availability: z.enum(["available", "busy", "unavailable", "on_leave"]).optional(),
  max_workload_hours: z.number().int().positive().optional(),
});

const addSkillSchema = z.object({
  skill_id: z.string().uuid("Skill ID must be a valid UUID"),
  proficiency: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional().default("intermediate"),
});

const createTaskSchema = z.object({
  title: z.string().min(1, "Task title is required").max(500),
  description: z.string().max(5000).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional().default("medium"),
  deadline: z.string().datetime().optional().nullable(),
  estimated_hours: z.number().nonnegative().max(9999.9).optional().nullable(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  deadline: z.string().datetime().optional().nullable(),
  estimated_hours: z.number().nonnegative().max(9999.9).optional().nullable(),
  // NOTE: status is NOT here — use PATCH /tasks/:taskId/status instead
  // NOTE: business_id, source, agent_run_id are NOT here — protected fields
});

const updateTaskStatusSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
});

const createAssignmentSchema = z.object({
  employee_id: z.string().uuid("Employee ID must be a valid UUID"),
});

const updateAssignmentSchema = z.object({
  status: z.enum(["active", "completed", "reassigned"]),
});

// ===================================================================
// TEAM MEMBER ROUTES
// ===================================================================

// --- POST /team-members — Create an employee ------------------------

router.post(
  "/team-members",
  asyncHandler(async (req, res) => {
    const parsed = createEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const { name, email, phone, role, availability, max_workload_hours } =
      parsed.data;

    const result = await query(
      `INSERT INTO employees (business_id, name, email, phone, role, availability, max_workload_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, business_id, name, email, phone, role, availability,
         max_workload_hours, created_at, updated_at`,
      [businessId, name, email ?? null, phone ?? null, role, availability, max_workload_hours]
    );

    res.status(201).json(result.rows[0]);
  })
);

// --- GET /team-members — List employees -----------------------------

router.get(
  "/team-members",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const { page, limit, offset } = parsePagination(req.query);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const availFilter = req.query.availability;

    // Build WHERE clauses dynamically
    const conditions = ["e.business_id = $1"];
    const params = [businessId];
    let paramIdx = 2;

    if (search) {
      const pattern = `%${search}%`;
      conditions.push(`(e.name ILIKE $${paramIdx} OR e.email ILIKE $${paramIdx} OR e.phone ILIKE $${paramIdx})`);
      params.push(pattern);
      paramIdx++;
    }

    if (availFilter && ["available", "busy", "unavailable", "on_leave"].includes(availFilter)) {
      conditions.push(`e.availability = $${paramIdx}`);
      params.push(availFilter);
      paramIdx++;
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM employees e WHERE ${whereClause}`,
      params
    );

    params.push(limit);
    const limitParam = paramIdx++;
    params.push(offset);
    const offsetParam = paramIdx;

    const result = await query(
      `SELECT e.id, e.business_id, e.name, e.email, e.phone, e.role,
          e.availability, e.max_workload_hours, e.created_at, e.updated_at,
          (SELECT COUNT(*)::int FROM task_assignments ta
           JOIN tasks t ON t.id = ta.task_id
           WHERE ta.employee_id = e.id AND ta.status = 'active'
             AND t.business_id = e.business_id) AS active_task_count
       FROM employees e
       WHERE ${whereClause}
       ORDER BY e.name ASC
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

// --- GET /team-members/:employeeId — Get employee detail ------------

router.get(
  "/team-members/:employeeId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const employeeId = requireUUID(req.params.employeeId, "Employee ID");

    const result = await query(
      `SELECT e.id, e.business_id, e.name, e.email, e.phone, e.role,
          e.availability, e.max_workload_hours, e.created_at, e.updated_at,
          COALESCE(
            json_agg(json_build_object(
              'skill_id', es.skill_id,
              'skill_name', s.name,
              'proficiency', es.proficiency
            )) FILTER (WHERE es.skill_id IS NOT NULL), '[]'::json
          ) AS skills,
          (SELECT COUNT(*)::int FROM task_assignments ta
           JOIN tasks t ON t.id = ta.task_id
           WHERE ta.employee_id = e.id AND ta.status = 'active'
             AND t.business_id = e.business_id) AS active_task_count
       FROM employees e
       LEFT JOIN employee_skills es ON es.employee_id = e.id
       LEFT JOIN skills s ON s.id = es.skill_id
       WHERE e.id = $1 AND e.business_id = $2
       GROUP BY e.id`,
      [employeeId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Employee not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /team-members/:employeeId — Update employee --------------

router.patch(
  "/team-members/:employeeId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const employeeId = requireUUID(req.params.employeeId, "Employee ID");

    const parsed = updateEmployeeSchema.safeParse(req.body);
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

    values.push(employeeId);
    const idParam = paramIndex++;
    values.push(businessId);
    const bizParam = paramIndex;

    const result = await query(
      `UPDATE employees SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${idParam} AND business_id = $${bizParam}
       RETURNING id, business_id, name, email, phone, role, availability,
          max_workload_hours, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Employee not found");
    }

    res.json(result.rows[0]);
  })
);

// --- GET /team-members/:employeeId/skills — List skills --------------

router.get(
  "/team-members/:employeeId/skills",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const employeeId = requireUUID(req.params.employeeId, "Employee ID");

    // Verify employee exists and belongs to business
    const empCheck = await query(
      "SELECT id FROM employees WHERE id = $1 AND business_id = $2",
      [employeeId, businessId]
    );
    if (empCheck.rows.length === 0) {
      throw new NotFoundError("Employee not found");
    }

    const result = await query(
      `SELECT es.skill_id, s.name AS skill_name, es.proficiency, es.created_at
       FROM employee_skills es
       JOIN skills s ON s.id = es.skill_id
       WHERE es.employee_id = $1
       ORDER BY s.name ASC`,
      [employeeId]
    );

    res.json({ data: result.rows });
  })
);

// --- POST /team-members/:employeeId/skills — Add skill --------------

router.post(
  "/team-members/:employeeId/skills",
  asyncHandler(async (req, res) => {
    const parsed = addSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const employeeId = requireUUID(req.params.employeeId, "Employee ID");
    const { skill_id, proficiency } = parsed.data;

    // Verify employee belongs to this business
    const empCheck = await query(
      "SELECT id FROM employees WHERE id = $1 AND business_id = $2",
      [employeeId, businessId]
    );
    if (empCheck.rows.length === 0) {
      throw new NotFoundError("Employee not found");
    }

    // Verify skill exists
    const skillCheck = await query(
      "SELECT id, name FROM skills WHERE id = $1",
      [skill_id]
    );
    if (skillCheck.rows.length === 0) {
      throw new NotFoundError("Skill not found");
    }

    // Insert (composite PK prevents duplicates)
    const result = await query(
      `INSERT INTO employee_skills (employee_id, skill_id, proficiency)
       VALUES ($1, $2, $3)
       ON CONFLICT (employee_id, skill_id) DO NOTHING
       RETURNING employee_id, skill_id, proficiency, created_at`,
      [employeeId, skill_id, proficiency]
    );

    if (result.rows.length === 0) {
      // Skill already exists for this employee — fetch existing
      const existing = await query(
        "SELECT employee_id, skill_id, proficiency, created_at FROM employee_skills WHERE employee_id = $1 AND skill_id = $2",
        [employeeId, skill_id]
      );
      return res.status(200).json(existing.rows[0]);
    }

    res.status(201).json(result.rows[0]);
  })
);

// --- DELETE /team-members/:employeeId/skills/:skillId — Remove ------

router.delete(
  "/team-members/:employeeId/skills/:skillId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const employeeId = requireUUID(req.params.employeeId, "Employee ID");
    const skillId = requireUUID(req.params.skillId, "Skill ID");

    // Verify employee belongs to this business
    const empCheck = await query(
      "SELECT id FROM employees WHERE id = $1 AND business_id = $2",
      [employeeId, businessId]
    );
    if (empCheck.rows.length === 0) {
      throw new NotFoundError("Employee not found");
    }

    const result = await query(
      "DELETE FROM employee_skills WHERE employee_id = $1 AND skill_id = $2 RETURNING skill_id",
      [employeeId, skillId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Skill assignment not found");
    }

    res.status(204).send();
  })
);

// ===================================================================
// TASK ROUTES
// ===================================================================

// --- POST /tasks — Create a task -----------------------------------

router.post(
  "/tasks",
  asyncHandler(async (req, res) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const { title, description, priority, deadline, estimated_hours } = parsed.data;

    const result = await query(
      `INSERT INTO tasks (business_id, title, description, priority, status,
         deadline, estimated_hours, source)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, 'manual')
       RETURNING id, business_id, title, description, priority, status,
         deadline, estimated_hours, source, agent_run_id, created_at, updated_at`,
      [
        businessId,
        title,
        description ?? null,
        priority,
        deadline ?? null,
        estimated_hours ?? null,
      ]
    );

    res.status(201).json(result.rows[0]);
  })
);

// --- GET /tasks — List tasks with filters --------------------------

router.get(
  "/tasks",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const { page, limit, offset } = parsePagination(req.query);
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const priorityFilter = typeof req.query.priority === "string" ? req.query.priority.trim() : "";
    const assigneeFilter = typeof req.query.assignee === "string" ? req.query.assignee.trim() : "";
    const overdueFilter = req.query.overdue;

    // Build WHERE clauses dynamically
    const conditions = ["t.business_id = $1"];
    const params = [businessId];
    let paramIdx = 2;

    if (statusFilter && ["pending", "in_progress", "completed", "cancelled"].includes(statusFilter)) {
      conditions.push(`t.status = $${paramIdx}`);
      params.push(statusFilter);
      paramIdx++;
    }

    if (priorityFilter && ["low", "medium", "high", "urgent"].includes(priorityFilter)) {
      conditions.push(`t.priority = $${paramIdx}`);
      params.push(priorityFilter);
      paramIdx++;
    }

    if (assigneeFilter && UUID_RE.test(assigneeFilter)) {
      conditions.push(`EXISTS (
        SELECT 1 FROM task_assignments ta2
        WHERE ta2.task_id = t.id AND ta2.employee_id = $${paramIdx}
          AND ta2.status = 'active'
      )`);
      params.push(assigneeFilter);
      paramIdx++;
    }

    if (overdueFilter === "true") {
      conditions.push(`t.deadline IS NOT NULL AND t.deadline < now() AND t.status NOT IN ('completed', 'cancelled')`);
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM tasks t WHERE ${whereClause}`,
      params
    );

    params.push(limit);
    const limitParam = paramIdx++;
    params.push(offset);
    const offsetParam = paramIdx;

    const result = await query(
      `SELECT t.id, t.business_id, t.title, t.description, t.priority, t.status,
          t.deadline, t.estimated_hours, t.source, t.agent_run_id,
          t.created_at, t.updated_at,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'id', ta.id, 'employee_id', ta.employee_id,
              'employee_name', e.name, 'status', ta.status,
              'assigned_at', ta.assigned_at
            ))
             FILTER (WHERE ta.id IS NOT NULL)
             FROM task_assignments ta
             JOIN employees e ON e.id = ta.employee_id
             WHERE ta.task_id = t.id),
            '[]'::json
          ) AS assignments
       FROM tasks t
       WHERE ${whereClause}
       ORDER BY
         CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
              WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
         t.deadline ASC NULLS LAST,
         t.created_at DESC
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

// --- GET /tasks/:taskId — Get task detail --------------------------

router.get(
  "/tasks/:taskId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const taskId = requireUUID(req.params.taskId, "Task ID");

    const result = await query(
      `SELECT t.id, t.business_id, t.title, t.description, t.priority, t.status,
          t.deadline, t.estimated_hours, t.source, t.agent_run_id,
          t.created_at, t.updated_at,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'id', ta.id, 'employee_id', ta.employee_id,
              'employee_name', e.name, 'employee_role', e.role,
              'status', ta.status, 'assigned_at', ta.assigned_at,
              'created_at', ta.created_at
            ) ORDER BY ta.assigned_at DESC)
             FILTER (WHERE ta.id IS NOT NULL)
             FROM task_assignments ta
             JOIN employees e ON e.id = ta.employee_id
             WHERE ta.task_id = t.id),
            '[]'::json
          ) AS assignments
       FROM tasks t
       WHERE t.id = $1 AND t.business_id = $2`,
      [taskId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Task not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /tasks/:taskId — Update task details -------------------

router.patch(
  "/tasks/:taskId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const taskId = requireUUID(req.params.taskId, "Task ID");

    // Check for protected fields BEFORE Zod strips them
    const protectedFields = ["status", "business_id", "source", "agent_run_id"];
    for (const field of protectedFields) {
      if (field in req.body) {
        const hint = field === "status"
          ? " Use PATCH /tasks/:taskId/status for status changes."
          : "";
        throw new BadRequestError(
          `${field} cannot be updated via this endpoint.${hint}`
        );
      }
    }

    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, val] of Object.entries(parsed.data)) {
      if (val === undefined) continue;
      // Reject protected fields
      if (["status", "business_id", "source", "agent_run_id"].includes(key)) {
        throw new BadRequestError(`${key} cannot be updated via this endpoint`);
      }
      fields.push(`${key} = $${paramIndex}`);
      values.push(val ?? null);
      paramIndex++;
    }

    if (fields.length === 0) {
      throw new BadRequestError("No fields provided to update");
    }

    values.push(taskId);
    const idParam = paramIndex++;
    values.push(businessId);
    const bizParam = paramIndex;

    const result = await query(
      `UPDATE tasks SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${idParam} AND business_id = $${bizParam}
       RETURNING id, business_id, title, description, priority, status,
         deadline, estimated_hours, source, agent_run_id, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Task not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /tasks/:taskId/status — Update task status --------------

router.patch(
  "/tasks/:taskId/status",
  asyncHandler(async (req, res) => {
    const parsed = updateTaskStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const taskId = requireUUID(req.params.taskId, "Task ID");
    const newStatus = parsed.data.status;

    // Fetch current task
    const taskResult = await query(
      "SELECT id, status FROM tasks WHERE id = $1 AND business_id = $2",
      [taskId, businessId]
    );

    if (taskResult.rows.length === 0) {
      throw new NotFoundError("Task not found");
    }

    const currentStatus = taskResult.rows[0].status;

    // Validate transition
    if (currentStatus === newStatus) {
      throw new BadRequestError(`Task is already in '${newStatus}' status`);
    }

    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestError(
        `Invalid status transition: '${currentStatus}' → '${newStatus}'. ` +
          `Valid transitions from '${currentStatus}': ${allowed.length ? allowed.join(", ") : "none (terminal status)"}`
      );
    }

    // Update status
    const result = await query(
      `UPDATE tasks SET status = $1, updated_at = now()
       WHERE id = $2 AND business_id = $3
       RETURNING id, business_id, title, description, priority, status,
         deadline, estimated_hours, source, agent_run_id, created_at, updated_at`,
      [newStatus, taskId, businessId]
    );

    res.json(result.rows[0]);
  })
);

// --- DELETE /tasks/:taskId — Delete a task -------------------------

router.delete(
  "/tasks/:taskId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const taskId = requireUUID(req.params.taskId, "Task ID");

    const result = await query(
      "DELETE FROM tasks WHERE id = $1 AND business_id = $2 RETURNING id",
      [taskId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Task not found");
    }

    // CASCADE automatically removes task_assignments
    res.status(204).send();
  })
);

// ===================================================================
// ASSIGNMENT ROUTES
// ===================================================================

// --- POST /tasks/:taskId/assignments — Assign task ----------------

router.post(
  "/tasks/:taskId/assignments",
  asyncHandler(async (req, res) => {
    const parsed = createAssignmentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const taskId = requireUUID(req.params.taskId, "Task ID");
    const employeeId = parsed.data.employee_id;

    if (!UUID_RE.test(employeeId)) {
      throw new BadRequestError("Employee ID must be a valid UUID");
    }

    // Transactional: verify task + employee belong to same business,
    // check for existing active assignment, insert new one
    const result = await withTransaction(async (client) => {
      // 1. Lock the task row and verify it belongs to the business
      const taskResult = await client.query(
        `SELECT id, status FROM tasks
         WHERE id = $1 AND business_id = $2
         FOR UPDATE`,
        [taskId, businessId]
      );

      if (taskResult.rows.length === 0) {
        throw new NotFoundError("Task not found");
      }

      const taskStatus = taskResult.rows[0].status;
      if (taskStatus === "completed" || taskStatus === "cancelled") {
        throw new BadRequestError(
          `Cannot assign a task with status '${taskStatus}'`
        );
      }

      // 2. Verify employee belongs to the same business
      const empResult = await client.query(
        `SELECT id, name, availability FROM employees
         WHERE id = $1 AND business_id = $2
         FOR UPDATE`,
        [employeeId, businessId]
      );

      if (empResult.rows.length === 0) {
        throw new NotFoundError("Employee not found or does not belong to this business");
      }

      // 3. Check for existing active assignment (partial unique index)
      const existingResult = await client.query(
        `SELECT id FROM task_assignments
         WHERE task_id = $1 AND employee_id = $2 AND status = 'active'`,
        [taskId, employeeId]
      );

      if (existingResult.rows.length > 0) {
        throw new ConflictError(
          "This employee already has an active assignment for this task"
        );
      }

      // 4. Insert the new assignment
      const insertResult = await client.query(
        `INSERT INTO task_assignments (task_id, employee_id, status)
         VALUES ($1, $2, 'active')
         RETURNING id, task_id, employee_id, status, assigned_at, created_at`,
        [taskId, employeeId]
      );

      return insertResult.rows[0];
    });

    res.status(201).json(result);
  })
);

// --- GET /tasks/:taskId/assignments — List assignments -------------

router.get(
  "/tasks/:taskId/assignments",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const taskId = requireUUID(req.params.taskId, "Task ID");

    // Verify task belongs to business
    const taskCheck = await query(
      "SELECT id, title FROM tasks WHERE id = $1 AND business_id = $2",
      [taskId, businessId]
    );
    if (taskCheck.rows.length === 0) {
      throw new NotFoundError("Task not found");
    }

    const result = await query(
      `SELECT ta.id, ta.task_id, ta.employee_id, ta.status, ta.assigned_at,
          ta.created_at, e.name AS employee_name, e.role AS employee_role,
          e.availability AS employee_availability
       FROM task_assignments ta
       JOIN employees e ON e.id = ta.employee_id
       WHERE ta.task_id = $1
       ORDER BY ta.assigned_at DESC`,
      [taskId]
    );

    res.json({ data: result.rows });
  })
);

// --- PATCH /tasks/:taskId/assignments/:assignmentId — Change status

router.patch(
  "/tasks/:taskId/assignments/:assignmentId",
  asyncHandler(async (req, res) => {
    const parsed = updateAssignmentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const taskId = requireUUID(req.params.taskId, "Task ID");
    const assignmentId = requireUUID(req.params.assignmentId, "Assignment ID");
    const newStatus = parsed.data.status;

    // Transactional: verify ownership, update assignment
    const result = await withTransaction(async (client) => {
      // 1. Verify task belongs to business and lock it
      const taskResult = await client.query(
        `SELECT id FROM tasks WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [taskId, businessId]
      );
      if (taskResult.rows.length === 0) {
        throw new NotFoundError("Task not found");
      }

      // 2. Fetch and lock the assignment
      const assignmentResult = await client.query(
        `SELECT id, task_id, employee_id, status FROM task_assignments
         WHERE id = $1 AND task_id = $2 FOR UPDATE`,
        [assignmentId, taskId]
      );
      if (assignmentResult.rows.length === 0) {
        throw new NotFoundError("Assignment not found");
      }

      const currentStatus = assignmentResult.rows[0].status;

      // 3. Validate transition
      if (currentStatus === newStatus) {
        throw new BadRequestError(`Assignment is already '${newStatus}'`);
      }

      // Only active → completed or active → reassigned is allowed
      if (currentStatus !== "active") {
        throw new BadRequestError(
          `Cannot change assignment status from '${currentStatus}' to '${newStatus}'. ` +
            `Only 'active' assignments can be updated.`
        );
      }

      if (!["completed", "reassigned"].includes(newStatus)) {
        throw new BadRequestError(
          `Invalid target status: '${newStatus}'. Valid values: 'completed', 'reassigned'`
        );
      }

      // 4. Update the assignment
      const updateResult = await client.query(
        `UPDATE task_assignments SET status = $1
         WHERE id = $2 AND task_id = $3
         RETURNING id, task_id, employee_id, status, assigned_at, created_at`,
        [newStatus, assignmentId, taskId]
      );

      return updateResult.rows[0];
    });

    res.json(result);
  })
);

// --- DELETE /tasks/:taskId/assignments/:assignmentId — Remove -----

router.delete(
  "/tasks/:taskId/assignments/:assignmentId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const taskId = requireUUID(req.params.taskId, "Task ID");
    const assignmentId = requireUUID(req.params.assignmentId, "Assignment ID");

    // Verify task belongs to business
    const taskCheck = await query(
      "SELECT id FROM tasks WHERE id = $1 AND business_id = $2",
      [taskId, businessId]
    );
    if (taskCheck.rows.length === 0) {
      throw new NotFoundError("Task not found");
    }

    const result = await query(
      "DELETE FROM task_assignments WHERE id = $1 AND task_id = $2 RETURNING id",
      [assignmentId, taskId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Assignment not found");
    }

    res.status(204).send();
  })
);

// ===================================================================
// OVERVIEW ROUTES
// ===================================================================

// --- GET /overview — Business task summary -------------------------

router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;

    try {
      const summary = await query(
        `SELECT
           COUNT(*)::int AS total_tasks,
           COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_tasks,
           COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_tasks,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_tasks,
           COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_tasks,
           COUNT(*) FILTER (WHERE priority = 'low')::int AS low_priority,
           COUNT(*) FILTER (WHERE priority = 'medium')::int AS medium_priority,
           COUNT(*) FILTER (WHERE priority = 'high')::int AS high_priority,
           COUNT(*) FILTER (WHERE priority = 'urgent')::int AS urgent_priority,
           COUNT(*) FILTER (WHERE deadline IS NOT NULL AND deadline < now()
             AND status NOT IN ('completed', 'cancelled'))::int AS overdue_tasks,
           (SELECT COUNT(*)::int FROM task_assignments ta
            JOIN tasks t ON t.id = ta.task_id
            WHERE t.business_id = $1 AND ta.status = 'active')::int AS total_active_assignments
         FROM tasks
         WHERE business_id = $1`,
        [businessId]
      );

      res.json(summary.rows[0]);
    } catch {
      // DB unavailable — fall back to in-memory data
      const mem = memTaskOverview();
      const team = memTeamWorkload();
      res.json({
        total_tasks: mem.total_tasks,
        pending_tasks: mem.pending,
        in_progress_tasks: mem.in_progress,
        completed_tasks: mem.completed,
        cancelled_tasks: 0,
        low_priority: 0,
        medium_priority: mem.total_tasks - mem.completed,
        high_priority: mem.overdue,
        urgent_priority: mem.overdue,
        overdue_tasks: mem.overdue,
        total_active_assignments: team.team.reduce((s, m) => s + m.active, 0),
      });
    }
  })
);

// --- GET /team-members/:employeeId/workload — Member workload ------

router.get(
  "/team-members/:employeeId/workload",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const employeeId = requireUUID(req.params.employeeId, "Employee ID");

    // Verify employee belongs to business
    const empCheck = await query(
      "SELECT id, name, max_workload_hours, availability FROM employees WHERE id = $1 AND business_id = $2",
      [employeeId, businessId]
    );
    if (empCheck.rows.length === 0) {
      throw new NotFoundError("Employee not found");
    }

    const emp = empCheck.rows[0];

    const workload = await query(
      `SELECT
         COUNT(ta.id) FILTER (WHERE ta.status = 'active')::int AS active_assignments,
         COUNT(ta.id) FILTER (WHERE ta.status = 'completed')::int AS completed_assignments,
         COUNT(ta.id) FILTER (WHERE ta.status = 'reassigned')::int AS reassigned_assignments,
         COALESCE(SUM(t.estimated_hours) FILTER (WHERE ta.status = 'active'), 0)::numeric(5,1) AS allocated_hours,
         COUNT(t.id) FILTER (WHERE ta.status = 'active' AND t.status = 'pending')::int AS pending_tasks,
         COUNT(t.id) FILTER (WHERE ta.status = 'active' AND t.status = 'in_progress')::int AS in_progress_tasks,
         COUNT(t.id) FILTER (WHERE ta.status = 'active' AND t.status = 'completed')::int AS completed_tasks,
         COUNT(t.id) FILTER (WHERE ta.status = 'active' AND t.deadline IS NOT NULL
           AND t.deadline < now() AND t.status NOT IN ('completed', 'cancelled'))::int AS overdue_assigned_tasks
       FROM task_assignments ta
       LEFT JOIN tasks t ON t.id = ta.task_id
       WHERE ta.employee_id = $1`,
      [employeeId]
    );

    const wl = workload.rows[0];
    const maxHours = parseInt(emp.max_workload_hours, 10);
    const allocatedHours = parseFloat(wl.allocated_hours);
    const utilization = maxHours > 0
      ? Math.round((allocatedHours / maxHours) * 100)
      : 0;

    res.json({
      employee_id: employeeId,
      employee_name: emp.name,
      availability: emp.availability,
      max_workload_hours: maxHours,
      allocated_hours: parseFloat(wl.allocated_hours),
      utilization_percent: utilization,
      active_assignments: parseInt(wl.active_assignments),
      completed_assignments: parseInt(wl.completed_assignments),
      reassigned_assignments: parseInt(wl.reassigned_assignments),
      task_breakdown: {
        pending: parseInt(wl.pending_tasks),
        in_progress: parseInt(wl.in_progress_tasks),
        completed: parseInt(wl.completed_tasks),
      },
      overdue_assigned_tasks: parseInt(wl.overdue_assigned_tasks),
    });
  })
);

export default router;
