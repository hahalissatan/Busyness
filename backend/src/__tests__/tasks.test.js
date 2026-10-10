/**
 * tasks.test.js — Integration tests for the Intelligent Task Allocation API.
 *
 * Covers:
 *   1. Team member CRUD (create, list, get, update, skills)
 *   2. Task CRUD (create, list, get, update, status transitions, delete)
 *   3. Assignment management (create, list, change status, delete, conflicts)
 *   4. Concurrent assignment attempts
 *   5. Overview & workload calculations
 *   6. Cross-business denial (403)
 *   7. Auth: no token (401)
 *   8. Invalid inputs and IDs (400)
 *   9. Protected field rejection
 *  10. Regression (health, /me, financials, inventory still work)
 *
 * Tests run against the real Supabase PostgreSQL database.
 * All test data is cleaned up in the afterAll hook (FK-safe order).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import { query, closePool } from "../db/pool.js";

// --- Track test data for cleanup ---
const testUserEmails = [];
const testBusinessIds = [];
const testSkillIds = [];

// Unique suffix to avoid collisions across test runs
const ts = Date.now();

// Shared test state
let token = "";
let businessId = "";
let employeeId = "";
let employeeId2 = "";
let employeeId3 = "";
let skillId = "";
let skillId2 = "";
let taskId = "";
let taskId2 = "";

// Counter for unique task titles
let taskCounter = 0;
function nextTitle() {
  taskCounter++;
  return `Test Task ${ts}-${taskCounter}`;
}

// --- Helper: register a user and return token + businessId ---
async function setupUser() {
  const email = `task-test-${ts}@busyness.test`;
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "SecurePass123!",
    name: "Task Test User",
    business_name: `Task Test Biz ${ts}`,
  });
  testUserEmails.push(email);
  if (res.body.business?.id) testBusinessIds.push(res.body.business.id);
  return { token: res.body.token, businessId: res.body.business.id };
}

// --- Helper: create an employee ---
async function createEmployee(name, opts = {}) {
  const body = { name, role: opts.role || "staff" };
  if (opts.email !== undefined) body.email = opts.email;
  if (opts.phone !== undefined) body.phone = opts.phone;
  if (opts.availability !== undefined) body.availability = opts.availability;
  if (opts.max_workload_hours !== undefined) body.max_workload_hours = opts.max_workload_hours;
  const res = await request(app)
    .post(`/api/businesses/${businessId}/tasks/team-members`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
  return res;
}

// --- Helper: create a task ---
async function createTask(title, opts = {}) {
  const body = { title };
  if (opts.description !== undefined) body.description = opts.description;
  if (opts.priority !== undefined) body.priority = opts.priority;
  if (opts.deadline !== undefined) body.deadline = opts.deadline;
  if (opts.estimated_hours !== undefined) body.estimated_hours = opts.estimated_hours;
  const res = await request(app)
    .post(`/api/businesses/${businessId}/tasks/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
  return res;
}

// --- Helper: assign a task ---
async function assignTask(taskIdVal, employeeIdVal) {
  const res = await request(app)
    .post(`/api/businesses/${businessId}/tasks/tasks/${taskIdVal}/assignments`)
    .set("Authorization", `Bearer ${token}`)
    .send({ employee_id: employeeIdVal });
  return res;
}

/**
 * Clean up all test data. FK-safe order:
 *   task_assignments → tasks → employees (CASCADE handles employee_skills)
 *   → business_memberships → users → businesses
 *   Also clean up test skills (global, not business-scoped).
 * No triggers to disable — tasks, employees, task_assignments are all deletable.
 */
afterAll(async () => {
  for (const bid of testBusinessIds) {
    // task_assignments are cascaded when tasks are deleted, but delete explicitly first
    try {
      await query(
        `DELETE FROM task_assignments WHERE task_id IN (SELECT id FROM tasks WHERE business_id = $1)`,
        [bid]
      );
    } catch {}
    try { await query("DELETE FROM tasks WHERE business_id = $1", [bid]); } catch {}
    try { await query("DELETE FROM employees WHERE business_id = $1", [bid]); } catch {}
    try { await query("DELETE FROM payments WHERE business_id = $1", [bid]); } catch {}
    try { await query("DELETE FROM invoices WHERE business_id = $1", [bid]); } catch {}
    try { await query("DELETE FROM customers WHERE business_id = $1", [bid]); } catch {}
    try {
      await query("ALTER TABLE stock_movements DISABLE TRIGGER no_delete_stock_movements");
      await query("DELETE FROM stock_movements WHERE business_id = $1", [bid]);
      await query("ALTER TABLE stock_movements ENABLE TRIGGER no_delete_stock_movements");
    } catch {
      try { await query("ALTER TABLE stock_movements ENABLE TRIGGER no_delete_stock_movements"); } catch {}
    }
    try { await query("DELETE FROM products WHERE business_id = $1", [bid]); } catch {}
    try { await query("DELETE FROM suppliers WHERE business_id = $1", [bid]); } catch {}
    try { await query("DELETE FROM business_memberships WHERE business_id = $1", [bid]); } catch {}
    try { await query("DELETE FROM businesses WHERE id = $1", [bid]); } catch {}
  }
  // Clean up test skills (global table, not business-scoped)
  for (const sid of testSkillIds) {
    try { await query("DELETE FROM employee_skills WHERE skill_id = $1", [sid]); } catch {}
    try { await query("DELETE FROM skills WHERE id = $1", [sid]); } catch {}
  }
  for (const email of testUserEmails) {
    try { await query("DELETE FROM users WHERE email = $1", [email]); } catch {}
  }
  await closePool();
}, 30000);

// ===================================================================
// Setup
// ===================================================================

beforeAll(async () => {
  const setup = await setupUser();
  token = setup.token;
  businessId = setup.businessId;

  // Create test skills (global, not business-scoped)
  const skill1 = await query(
    "INSERT INTO skills (name) VALUES ($1) RETURNING id, name",
    [`Test Skill Operations ${ts}`]
  );
  skillId = skill1.rows[0].id;
  testSkillIds.push(skillId);

  const skill2 = await query(
    "INSERT INTO skills (name) VALUES ($1) RETURNING id, name",
    [`Test Skill Marketing ${ts}`]
  );
  skillId2 = skill2.rows[0].id;
  testSkillIds.push(skillId2);
});

// ===================================================================
// Team Member CRUD Tests
// ===================================================================

describe("Team member CRUD", () => {
  it("should create an employee with all fields (201)", async () => {
    const res = await createEmployee("Test Employee Alpha", {
      email: "alpha@test.busyness",
      phone: "012-345-6789",
      role: "manager",
      availability: "available",
      max_workload_hours: 35,
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe("Test Employee Alpha");
    expect(res.body.role).toBe("manager");
    expect(res.body.business_id).toBe(businessId);
    expect(res.body.availability).toBe("available");
    expect(parseInt(res.body.max_workload_hours)).toBe(35);

    employeeId = res.body.id;
  });

  it("should create an employee with only name and role (201)", async () => {
    const res = await createEmployee("Test Employee Beta", { role: "staff" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Test Employee Beta");
    expect(res.body.email).toBeNull();
    expect(res.body.role).toBe("staff");
    expect(res.body.availability).toBe("available");
    expect(parseInt(res.body.max_workload_hours)).toBe(40);

    employeeId2 = res.body.id;
  });

  it("should reject employee with missing name (400)", async () => {
    const res = await createEmployee(null, { role: "staff" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("should reject employee with invalid role (400)", async () => {
    const res = await createEmployee("Bad Role Employee", { role: "superadmin" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("should list employees with pagination (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/team-members?page=1&limit=10`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it("should search employees by name (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/team-members?search=Alpha`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].name).toContain("Alpha");
  });

  it("should filter employees by availability (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/team-members?availability=available`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((e) => e.availability === "available")).toBe(true);
  });

  it("should include active_task_count in list (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/team-members`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toHaveProperty("active_task_count");
  });

  it("should get a single employee with skills (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/team-members/${employeeId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(employeeId);
    expect(res.body.name).toBe("Test Employee Alpha");
    expect(res.body).toHaveProperty("skills");
    expect(Array.isArray(res.body.skills)).toBe(true);
    expect(res.body).toHaveProperty("active_task_count");
  });

  it("should return 404 for non-existent employee", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/team-members/${fakeId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("should return 400 for non-UUID employee ID", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/team-members/not-a-uuid`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it("should update an employee (200)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/team-members/${employeeId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Employee Alpha", availability: "busy", max_workload_hours: 25 });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Employee Alpha");
    expect(res.body.availability).toBe("busy");
    expect(parseInt(res.body.max_workload_hours)).toBe(25);
  });

  it("should return 404 when updating non-existent employee", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/team-members/${fakeId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Ghost" });

    expect(res.status).toBe(404);
  });

  it("should return 400 when updating with no fields", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/team-members/${employeeId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ===================================================================
// Employee Skills Tests
// ===================================================================

describe("Employee skills", () => {
  it("should add a skill to an employee (201)", async () => {
    const res = await request(app)
      .post(`/api/businesses/${businessId}/tasks/team-members/${employeeId}/skills`)
      .set("Authorization", `Bearer ${token}`)
      .send({ skill_id: skillId, proficiency: "expert" });

    expect(res.status).toBe(201);
    expect(res.body.skill_id).toBe(skillId);
    expect(res.body.proficiency).toBe("expert");
  });

  it("should return 200 when adding a duplicate skill (idempotent)", async () => {
    const res = await request(app)
      .post(`/api/businesses/${businessId}/tasks/team-members/${employeeId}/skills`)
      .set("Authorization", `Bearer ${token}`)
      .send({ skill_id: skillId, proficiency: "beginner" });

    expect(res.status).toBe(200);
    expect(res.body.skill_id).toBe(skillId);
  });

  it("should list employee skills (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/team-members/${employeeId}/skills`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toHaveProperty("skill_name");
  });

  it("should reject adding skill to non-existent employee (404)", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .post(`/api/businesses/${businessId}/tasks/team-members/${fakeId}/skills`)
      .set("Authorization", `Bearer ${token}`)
      .send({ skill_id: skillId });

    expect(res.status).toBe(404);
  });

  it("should reject adding non-existent skill (404)", async () => {
    const fakeSkill = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .post(`/api/businesses/${businessId}/tasks/team-members/${employeeId}/skills`)
      .set("Authorization", `Bearer ${token}`)
      .send({ skill_id: fakeSkill });

    expect(res.status).toBe(404);
  });

  it("should remove a skill from an employee (204)", async () => {
    // First add a second skill
    await request(app)
      .post(`/api/businesses/${businessId}/tasks/team-members/${employeeId}/skills`)
      .set("Authorization", `Bearer ${token}`)
      .send({ skill_id: skillId2 });

    const res = await request(app)
      .delete(`/api/businesses/${businessId}/tasks/team-members/${employeeId}/skills/${skillId2}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);
  });

  it("should return 404 when removing non-existent skill assignment", async () => {
    const fakeSkill = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .delete(`/api/businesses/${businessId}/tasks/team-members/${employeeId}/skills/${fakeSkill}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// ===================================================================
// Task CRUD Tests
// ===================================================================

describe("Task CRUD", () => {
  it("should create a task with all fields (201)", async () => {
    const res = await createTask(nextTitle(), {
      description: "A comprehensive test task",
      priority: "high",
      deadline: "2026-12-31T23:59:59Z",
      estimated_hours: 4.5,
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.title).toContain("Test Task");
    expect(res.body.priority).toBe("high");
    expect(res.body.status).toBe("pending");
    expect(parseFloat(res.body.estimated_hours)).toBe(4.5);
    expect(res.body.source).toBe("manual");

    taskId = res.body.id;
  });

  it("should create a task with only title (201)", async () => {
    const res = await createTask(nextTitle());

    expect(res.status).toBe(201);
    expect(res.body.title).toContain("Test Task");
    expect(res.body.priority).toBe("medium");
    expect(res.body.status).toBe("pending");
    expect(res.body.description).toBeNull();
    expect(res.body.estimated_hours).toBeNull();

    taskId2 = res.body.id;
  });

  it("should reject task with missing title (400)", async () => {
    const res = await request(app)
      .post(`/api/businesses/${businessId}/tasks/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ description: "No title" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("should reject task with invalid priority (400)", async () => {
    const res = await request(app)
      .post(`/api/businesses/${businessId}/tasks/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: nextTitle(), priority: "critical" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("should list tasks with pagination (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks?page=1&limit=10`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
    // Each task should have assignments array
    expect(res.body.data[0]).toHaveProperty("assignments");
  });

  it("should filter tasks by status (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks?status=pending`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((t) => t.status === "pending")).toBe(true);
  });

  it("should filter tasks by priority (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks?priority=high`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((t) => t.priority === "high")).toBe(true);
  });

  it("should get a single task with assignments (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks/${taskId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(taskId);
    expect(res.body).toHaveProperty("assignments");
    expect(Array.isArray(res.body.assignments)).toBe(true);
  });

  it("should return 404 for non-existent task", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks/${fakeId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("should return 400 for non-UUID task ID", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks/not-a-uuid`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it("should update a task (200)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${taskId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Updated Task Title",
        description: "Updated description",
        priority: "urgent",
        estimated_hours: 8.0,
      });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Updated Task Title");
    expect(res.body.priority).toBe("urgent");
    expect(parseFloat(res.body.estimated_hours)).toBe(8.0);
  });

  it("should reject updating status via PATCH /tasks/:id (400)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${taskId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "in_progress" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status cannot be updated/i);
  });

  it("should reject updating business_id (400)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${taskId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ business_id: "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(400);
  });

  it("should return 404 when updating non-existent task", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${fakeId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Ghost" });

    expect(res.status).toBe(404);
  });
});

// ===================================================================
// Task Status Transition Tests
// ===================================================================

describe("Task status transitions", () => {
  it("should transition pending → in_progress (200)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${taskId2}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "in_progress" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("in_progress");
  });

  it("should transition in_progress → completed (200)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${taskId2}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "completed" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
  });

  it("should reject transition from completed (400)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${taskId2}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "in_progress" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid status transition/i);
  });

  it("should reject same status (400)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${taskId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "pending" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already/i);
  });

  it("should transition pending → cancelled (200)", async () => {
    // Create a fresh task for this test
    const createRes = await createTask(nextTitle());
    expect(createRes.status).toBe(201);

    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${createRes.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
  });

  it("should return 404 for status update on non-existent task", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${fakeId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "in_progress" });

    expect(res.status).toBe(404);
  });

  it("should reject invalid status value (400)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${taskId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "archived" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });
});

// ===================================================================
// Assignment Management Tests
// ===================================================================

describe("Assignment management", () => {
  // Create a fresh task and employee for assignment tests
  let assignTaskId = "";
  let assignEmpId = "";

  it("should create a task and employee for assignment tests (setup)", async () => {
    const taskRes = await createTask(nextTitle(), { priority: "high", estimated_hours: 3.0 });
    expect(taskRes.status).toBe(201);
    assignTaskId = taskRes.body.id;

    const empRes = await createEmployee("Assignment Test Employee", {
      role: "staff",
      max_workload_hours: 20,
    });
    expect(empRes.status).toBe(201);
    assignEmpId = empRes.body.id;

    employeeId3 = assignEmpId;
  });

  it("should assign a task to an employee (201)", async () => {
    const res = await assignTask(assignTaskId, assignEmpId);

    expect(res.status).toBe(201);
    expect(res.body.task_id).toBe(assignTaskId);
    expect(res.body.employee_id).toBe(assignEmpId);
    expect(res.body.status).toBe("active");
  });

  it("should reject duplicate active assignment (409)", async () => {
    const res = await assignTask(assignTaskId, assignEmpId);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already.*active/i);
  });

  it("should list assignments for a task (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks/${assignTaskId}/assignments`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toHaveProperty("employee_name");
    expect(res.body.data[0]).toHaveProperty("employee_role");
  });

  it("should change assignment status to completed (200)", async () => {
    // First get the assignment ID
    const listRes = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks/${assignTaskId}/assignments`)
      .set("Authorization", `Bearer ${token}`);

    const assignmentId = listRes.body.data[0].id;

    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${assignTaskId}/assignments/${assignmentId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "completed" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
  });

  it("should reject changing completed assignment (400)", async () => {
    const listRes = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks/${assignTaskId}/assignments`)
      .set("Authorization", `Bearer ${token}`);

    const assignmentId = listRes.body.data[0].id;

    const res = await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${assignTaskId}/assignments/${assignmentId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "reassigned" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only.*active/i);
  });

  it("should allow reassigning to a different employee after completing (201)", async () => {
    // Create another employee
    const emp2Res = await createEmployee("Second Assignment Employee", { role: "contractor" });
    expect(emp2Res.status).toBe(201);

    // Since the first assignment is 'completed', a new active assignment is allowed
    const res = await assignTask(assignTaskId, emp2Res.body.id);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("active");
    expect(res.body.employee_id).toBe(emp2Res.body.id);
  });

  it("should reject assigning to a non-existent employee (404)", async () => {
    const fakeEmp = "00000000-0000-0000-0000-000000000000";
    const res = await assignTask(assignTaskId, fakeEmp);

    expect(res.status).toBe(404);
  });

  it("should reject assigning a non-existent task (404)", async () => {
    const fakeTask = "00000000-0000-0000-0000-000000000000";
    const res = await assignTask(fakeTask, assignEmpId);

    expect(res.status).toBe(404);
  });

  it("should reject assigning a completed task (400)", async () => {
    // Create and complete a task
    const createRes = await createTask(nextTitle());
    await request(app)
      .patch(`/api/businesses/${businessId}/tasks/tasks/${createRes.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "completed" });

    const res = await assignTask(createRes.body.id, assignEmpId);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/completed/i);
  });

  it("should remove an assignment (204)", async () => {
    // Create a new task + assignment
    const taskRes = await createTask(nextTitle());
    await assignTask(taskRes.body.id, assignEmpId);

    // Get the assignment
    const listRes = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks/${taskRes.body.id}/assignments`)
      .set("Authorization", `Bearer ${token}`);

    const assignmentId = listRes.body.data[0].id;

    const res = await request(app)
      .delete(`/api/businesses/${businessId}/tasks/tasks/${taskRes.body.id}/assignments/${assignmentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);
  });

  it("should return 404 when removing non-existent assignment", async () => {
    const fakeAssign = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .delete(`/api/businesses/${businessId}/tasks/tasks/${assignTaskId}/assignments/${fakeAssign}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// ===================================================================
// Concurrent Assignment Tests
// ===================================================================

describe("Concurrent assignments", () => {
  it("should prevent concurrent duplicate active assignments", async () => {
    // Create a task and employee
    const taskRes = await createTask(nextTitle(), { priority: "urgent" });
    expect(taskRes.status).toBe(201);
    const concTaskId = taskRes.body.id;

    const empRes = await createEmployee("Concurrent Assignment Employee", { role: "staff" });
    expect(empRes.status).toBe(201);
    const concEmpId = empRes.body.id;

    // Fire 3 concurrent assignment requests for the same task+employee
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(assignTask(concTaskId, concEmpId));
    }
    const results = await Promise.all(promises);

    // Exactly 1 should succeed (201), the others should get 409
    const successes = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(2);
  });
});

// ===================================================================
// Overview & Workload Tests
// ===================================================================

describe("Overview & workload", () => {
  it("should return overview summary (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/overview`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("total_tasks");
    expect(res.body).toHaveProperty("pending_tasks");
    expect(res.body).toHaveProperty("in_progress_tasks");
    expect(res.body).toHaveProperty("completed_tasks");
    expect(res.body).toHaveProperty("cancelled_tasks");
    expect(res.body).toHaveProperty("overdue_tasks");
    expect(res.body).toHaveProperty("total_active_assignments");
    expect(parseInt(res.body.total_tasks)).toBeGreaterThanOrEqual(2);
    expect(parseInt(res.body.completed_tasks)).toBeGreaterThanOrEqual(1);
  });

  it("should return employee workload (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/team-members/${employeeId3}/workload`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("max_workload_hours");
    expect(res.body).toHaveProperty("allocated_hours");
    expect(res.body).toHaveProperty("utilization_percent");
    expect(res.body).toHaveProperty("active_assignments");
    expect(res.body).toHaveProperty("task_breakdown");
    expect(res.body.task_breakdown).toHaveProperty("pending");
    expect(res.body.task_breakdown).toHaveProperty("in_progress");
    expect(res.body.task_breakdown).toHaveProperty("completed");
    expect(parseInt(res.body.active_assignments)).toBeGreaterThanOrEqual(0);
  });

  it("should return 404 for workload of non-existent employee", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/team-members/${fakeId}/workload`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// ===================================================================
// Task Deletion Tests
// ===================================================================

describe("Task deletion", () => {
  it("should delete a task and cascade assignments (204)", async () => {
    // Create a task with an assignment
    const taskRes = await createTask(nextTitle());
    expect(taskRes.status).toBe(201);
    const delTaskId = taskRes.body.id;

    await assignTask(delTaskId, employeeId);

    // Delete the task
    const res = await request(app)
      .delete(`/api/businesses/${businessId}/tasks/tasks/${delTaskId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);

    // Verify task is gone
    const getRes = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks/${delTaskId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(404);
  });

  it("should return 404 when deleting non-existent task", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .delete(`/api/businesses/${businessId}/tasks/tasks/${fakeId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// ===================================================================
// Auth & Security Tests
// ===================================================================

describe("Tasks auth & security", () => {
  it("should reject all task routes without a token (401)", async () => {
    const endpoints = [
      { method: "get", path: `/api/businesses/${businessId}/tasks/team-members` },
      { method: "get", path: `/api/businesses/${businessId}/tasks/tasks` },
      { method: "get", path: `/api/businesses/${businessId}/tasks/overview` },
    ];

    for (const ep of endpoints) {
      const res = await request(app)[ep.method](ep.path);
      expect(res.status).toBe(401);
    }
  });

  it("should reject access to another business's tasks (403)", async () => {
    // Register a second user with a different business
    const email2 = `task-test2-${ts}@busyness.test`;
    const regRes = await request(app).post("/api/auth/register").send({
      email: email2,
      password: "SecurePass123!",
      name: "User Two",
      business_name: "Task Business Two",
    });
    testUserEmails.push(email2);
    if (regRes.body.business?.id) testBusinessIds.push(regRes.body.business.id);

    const token2 = regRes.body.token;

    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks`)
      .set("Authorization", `Bearer ${token2}`);

    expect(res.status).toBe(403);
  });

  it("should reject non-UUID business ID (400)", async () => {
    const res = await request(app)
      .get(`/api/businesses/not-a-uuid/tasks/tasks`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it("should reject non-UUID task ID (400)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/tasks/not-a-uuid`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it("should reject non-UUID employee ID (400)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/team-members/not-a-uuid`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

// ===================================================================
// Regression Tests
// ===================================================================

describe("Regression: existing routes still work", () => {
  it("GET /api/health should still return 200", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /api/health/db should still return 200", async () => {
    const res = await request(app).get("/api/health/db");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /api/businesses/:businessId/me should still work (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/me`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.membership.role).toBe("owner");
  });

  it("Financial Hub customers endpoint should still work (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/customers`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });

  it("Inventory products endpoint should still work (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/inventory/products`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });
});
