/**
 * marketing.test.js — Integration tests for the AI Marketing & Pitch Deck API.
 *
 * Tests cover:
 *   - Marketing project CRUD, validation, status transitions, deletion safety
 *   - Customer persona CRUD, validation, cross-business isolation
 *   - Marketing draft CRUD, project relationships, status transitions
 *   - Pitch deck CRUD, structured slide content, status transitions
 *   - AI generation endpoints (demo fallback) for drafts, personas, pitch decks
 *   - AI revision endpoints for drafts and pitch decks
 *   - Marketing overview summary
 *   - Authentication and missing-token rejection
 *   - Cross-business isolation for every resource type
 *   - Invalid UUIDs and nonexistent resources
 *   - Pagination, search, filtering, and empty results
 *   - Invalid status transitions
 *   - Regression tests for existing auth, financial, inventory, task endpoints
 *
 * Uses real Supabase database — all test records are cleaned up afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import { query } from "../db/pool.js";

// --- Test state -----------------------------------------------------------

let token;
let businessId;
let otherToken;
let otherBusinessId;
let testProjectIds = [];
let testPersonaIds = [];
let testDraftIds = [];
let testPitchDeckIds = [];

// Unique email to avoid conflicts with other test runs
const stamp = Date.now();
const testEmail = `mkt-test-${stamp}@busyness.test`;
const otherEmail = `mkt-other-${stamp}@busyness.test`;

// --- Setup: Register a user + business -----------------------------------

beforeAll(async () => {
  // Register primary test business
  const regRes = await request(app)
    .post("/api/auth/register")
    .send({
      email: testEmail,
      password: "TestPass123!",
      name: "Marketing Test User",
      business_name: "Marketing Test Business",
    });
  token = regRes.body.token;
  businessId = regRes.body.business.id;

  // Register second business for cross-business isolation tests
  const otherReg = await request(app)
    .post("/api/auth/register")
    .send({
      email: otherEmail,
      password: "TestPass123!",
      name: "Other Test User",
      business_name: "Other Test Business",
    });
  otherToken = otherReg.body.token;
  otherBusinessId = otherReg.body.business.id;
});

// --- Cleanup: Delete all test records ------------------------------------

afterAll(async () => {
  // FK-safe cleanup order
  for (const id of testPitchDeckIds) {
    await query("DELETE FROM pitch_decks WHERE id = $1", [id]).catch(() => {});
  }
  for (const id of testDraftIds) {
    await query("DELETE FROM marketing_drafts WHERE id = $1", [id]).catch(() => {});
  }
  for (const id of testPersonaIds) {
    await query("DELETE FROM customer_personas WHERE id = $1", [id]).catch(() => {});
  }
  for (const id of testProjectIds) {
    await query("DELETE FROM marketing_projects WHERE id = $1", [id]).catch(() => {});
  }

  // Delete test businesses and users
  await query("DELETE FROM business_memberships WHERE business_id IN ($1, $2)", [businessId, otherBusinessId]).catch(() => {});
  await query("DELETE FROM businesses WHERE id IN ($1, $2)", [businessId, otherBusinessId]).catch(() => {});
  await query("DELETE FROM users WHERE email IN ($1, $2)", [testEmail, otherEmail]).catch(() => {});
});

// Helper: create a marketing project and track its ID
async function createProject(app, token, businessId, overrides = {}) {
  const res = await request(app)
    .post(`/api/businesses/${businessId}/marketing/projects`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: `Test Project ${Date.now()}`,
      description: "Test description",
      ...overrides,
    });
  if (res.status === 201) testProjectIds.push(res.body.id);
  return res;
}

// Helper: create a persona and track its ID
async function createPersona(app, token, businessId, overrides = {}) {
  const res = await request(app)
    .post(`/api/businesses/${businessId}/marketing/personas`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: `Test Persona ${Date.now()}`,
      description: "Test persona description",
      ...overrides,
    });
  if (res.status === 201) testPersonaIds.push(res.body.id);
  return res;
}

// Helper: create a draft for a project and track its ID
async function createDraft(app, token, businessId, projectId, overrides = {}) {
  const res = await request(app)
    .post(`/api/businesses/${businessId}/marketing/projects/${projectId}/drafts`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      draft_type: "social_media",
      title: `Test Draft ${Date.now()}`,
      content: "Test content for marketing draft",
      platform: "instagram",
      ...overrides,
    });
  if (res.status === 201) testDraftIds.push(res.body.id);
  return res;
}

// Helper: create a pitch deck and track its ID
async function createPitchDeck(app, token, businessId, projectId, overrides = {}) {
  const slides = [
    { slide_number: 1, heading: "Title", bullet_points: ["Business Name"], speaker_notes: "Welcome" },
    { slide_number: 2, heading: "Problem", bullet_points: ["Problem 1"], speaker_notes: "Problem intro" },
  ];
  const res = await request(app)
    .post(`/api/businesses/${businessId}/marketing/projects/${projectId}/pitch-decks`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: `Test Pitch Deck ${Date.now()}`,
      slides,
      ...overrides,
    });
  if (res.status === 201) testPitchDeckIds.push(res.body.id);
  return res;
}

const BASE = (bid) => `/api/businesses/${bid}/marketing`;

// ===================================================================
// MARKETING PROJECT CRUD
// ===================================================================

describe("Marketing project CRUD", () => {
  it("should create a marketing project (201)", async () => {
    const res = await createProject(app, token, businessId, {
      name: "Q1 Campaign",
      description: "First quarter marketing campaign",
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe("Q1 Campaign");
    expect(res.body.status).toBe("draft");
    expect(res.body.business_id).toBe(businessId);
  });

  it("should create a project with minimal fields (201)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Minimal Project" });
    if (res.status === 201) testProjectIds.push(res.body.id);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Minimal Project");
    expect(res.body.description).toBeNull();
    expect(res.body.status).toBe("draft");
  });

  it("should reject project with missing name (400)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects`)
      .set("Authorization", `Bearer ${token}`)
      .send({ description: "No name" });
    expect(res.status).toBe(400);
  });

  it("should reject project with invalid status (400)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bad Status", status: "archived" });
    expect(res.status).toBe(400);
  });

  it("should list projects with pagination (200)", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/projects?page=1&limit=5`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(5);
  });

  it("should search projects by name (200)", async () => {
    // First create a project with a unique name
    const createRes = await createProject(app, token, businessId, {
      name: `Searchable Project ${stamp}`,
    });

    const res = await request(app)
      .get(`${BASE(businessId)}/projects?search=${encodeURIComponent(`Searchable Project ${stamp}`)}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].name).toContain("Searchable Project");
  });

  it("should filter projects by status (200)", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/projects?status=draft`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((p) => p.status === "draft")).toBe(true);
  });

  it("should get a single project with personas and drafts (200)", async () => {
    const createRes = await createProject(app, token, businessId, {
      name: "Detail Project",
    });
    const projectId = createRes.body.id;

    const res = await request(app)
      .get(`${BASE(businessId)}/projects/${projectId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(projectId);
    expect(res.body.personas).toBeInstanceOf(Array);
    expect(res.body.drafts).toBeInstanceOf(Array);
    expect(res.body.pitch_decks).toBeInstanceOf(Array);
  });

  it("should return 404 for non-existent project", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/projects/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("should return 400 for non-UUID project ID", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/projects/not-a-uuid`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("should update a project (200)", async () => {
    const createRes = await createProject(app, token, businessId, {
      name: "Update Me",
    });
    const projectId = createRes.body.id;

    const res = await request(app)
      .patch(`${BASE(businessId)}/projects/${projectId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Name", description: "Updated description" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Name");
    expect(res.body.description).toBe("Updated description");
  });

  it("should reject status update via PATCH (400)", async () => {
    const createRes = await createProject(app, token, businessId, {
      name: "Status Patch Test",
    });

    const res = await request(app)
      .patch(`${BASE(businessId)}/projects/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "active" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status cannot be updated/i);
  });

  it("should update project status via status endpoint (200)", async () => {
    const createRes = await createProject(app, token, businessId, {
      name: "Status Transition Test",
    });

    const res = await request(app)
      .patch(`${BASE(businessId)}/projects/${createRes.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "active" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });

  it("should reject invalid status transition (400)", async () => {
    const createRes = await createProject(app, token, businessId, {
      name: "Bad Transition",
    });
    // draft -> completed is not valid (must go draft -> active -> completed)
    const res = await request(app)
      .patch(`${BASE(businessId)}/projects/${createRes.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid status transition/i);
  });

  it("should reject same status transition (400)", async () => {
    const createRes = await createProject(app, token, businessId, {
      name: "Same Status",
    });

    const res = await request(app)
      .patch(`${BASE(businessId)}/projects/${createRes.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "draft" });
    expect(res.status).toBe(400);
  });

  it("should return 404 when updating non-existent project", async () => {
    const res = await request(app)
      .patch(`${BASE(businessId)}/projects/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "New Name" });
    expect(res.status).toBe(404);
  });

  it("should return 400 for no fields to update", async () => {
    const createRes = await createProject(app, token, businessId, {
      name: "No Update",
    });

    const res = await request(app)
      .patch(`${BASE(businessId)}/projects/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("should delete a project with no children (204)", async () => {
    const createRes = await createProject(app, token, businessId, {
      name: "Delete Me",
    });
    const projectId = createRes.body.id;

    const res = await request(app)
      .delete(`${BASE(businessId)}/projects/${projectId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    // Remove from cleanup list since it's already deleted
    testProjectIds = testProjectIds.filter((id) => id !== projectId);
  });

  it("should reject deleting a project with linked personas (400)", async () => {
    const createRes = await createProject(app, token, businessId, {
      name: "Project With Persona",
    });
    const projectId = createRes.body.id;

    await createPersona(app, token, businessId, {
      name: "Linked Persona",
      marketing_project_id: projectId,
    });

    const res = await request(app)
      .delete(`${BASE(businessId)}/projects/${projectId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot delete/i);
  });

  it("should reject deleting a project with linked pitch decks (400)", async () => {
    const createRes = await createProject(app, token, businessId, {
      name: "Project With Pitch Deck",
    });
    const projectId = createRes.body.id;

    await createPitchDeck(app, token, businessId, projectId);

    const res = await request(app)
      .delete(`${BASE(businessId)}/projects/${projectId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot delete/i);
  });

  it("should return 404 when deleting non-existent project", async () => {
    const res = await request(app)
      .delete(`${BASE(businessId)}/projects/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ===================================================================
// CUSTOMER PERSONA CRUD
// ===================================================================

describe("Customer persona CRUD", () => {
  it("should create a persona with all fields (201)", async () => {
    const res = await createPersona(app, token, businessId, {
      name: "Budget Owner",
      description: "Small business owner looking for savings",
      pain_points: "High costs, unreliable suppliers",
      motivations: "Save money, grow business",
      target_segment: "SMB retail owners",
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Budget Owner");
    expect(res.body.pain_points).toBe("High costs, unreliable suppliers");
    expect(res.body.target_segment).toBe("SMB retail owners");
  });

  it("should create a persona with minimal fields (201)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/personas`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Minimal Persona" });
    if (res.status === 201) testPersonaIds.push(res.body.id);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Minimal Persona");
    expect(res.body.description).toBeNull();
  });

  it("should reject persona with missing name (400)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/personas`)
      .set("Authorization", `Bearer ${token}`)
      .send({ description: "No name" });
    expect(res.status).toBe(400);
  });

  it("should list personas with pagination (200)", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/personas?page=1&limit=10`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.pagination).toBeDefined();
  });

  it("should search personas by name (200)", async () => {
    await createPersona(app, token, businessId, {
      name: `Searchable Persona ${stamp}`,
    });

    const res = await request(app)
      .get(`${BASE(businessId)}/personas?search=${encodeURIComponent(`Searchable Persona ${stamp}`)}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("should get a single persona (200)", async () => {
    const createRes = await createPersona(app, token, businessId, {
      name: "Get Me Persona",
    });

    const res = await request(app)
      .get(`${BASE(businessId)}/personas/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createRes.body.id);
  });

  it("should return 404 for non-existent persona", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/personas/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("should return 400 for non-UUID persona ID", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/personas/invalid`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("should update a persona (200)", async () => {
    const createRes = await createPersona(app, token, businessId, {
      name: "Update Persona",
    });

    const res = await request(app)
      .patch(`${BASE(businessId)}/personas/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Persona", pain_points: "New pain points" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Persona");
    expect(res.body.pain_points).toBe("New pain points");
  });

  it("should reject updating marketing_project_id via PATCH (400)", async () => {
    const createRes = await createPersona(app, token, businessId, {
      name: "Protected Persona",
    });

    const res = await request(app)
      .patch(`${BASE(businessId)}/personas/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ marketing_project_id: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/marketing_project_id cannot be updated/i);
  });

  it("should delete a persona (204)", async () => {
    const createRes = await createPersona(app, token, businessId, {
      name: "Delete Persona",
    });
    const id = createRes.body.id;

    const res = await request(app)
      .delete(`${BASE(businessId)}/personas/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
    testPersonaIds = testPersonaIds.filter((x) => x !== id);
  });

  it("should return 404 when deleting non-existent persona", async () => {
    const res = await request(app)
      .delete(`${BASE(businessId)}/personas/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ===================================================================
// MARKETING DRAFT CRUD
// ===================================================================

describe("Marketing draft CRUD", () => {
  let projectId;

  beforeAll(async () => {
    const res = await createProject(app, token, businessId, {
      name: "Draft Test Project",
    });
    projectId = res.body.id;
  });

  it("should create a draft for a project (201)", async () => {
    const res = await createDraft(app, token, businessId, projectId, {
      draft_type: "social_media",
      title: "Instagram Post",
      content: "Check out our new products!",
      platform: "instagram",
    });
    expect(res.status).toBe(201);
    expect(res.body.draft_type).toBe("social_media");
    expect(res.body.marketing_project_id).toBe(projectId);
    expect(res.body.status).toBe("draft");
  });

  it("should create a draft with minimal fields (201)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/${projectId}/drafts`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        draft_type: "email",
        title: "Email Campaign",
        content: "Dear customer, ...",
      });
    if (res.status === 201) testDraftIds.push(res.body.id);
    expect(res.status).toBe(201);
    expect(res.body.platform).toBeNull();
    expect(res.body.status).toBe("draft");
  });

  it("should reject draft with invalid type (400)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/${projectId}/drafts`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        draft_type: "blog",
        title: "Bad Type",
        content: "Content",
      });
    expect(res.status).toBe(400);
  });

  it("should reject draft with missing title (400)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/${projectId}/drafts`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        draft_type: "social_media",
        content: "No title",
      });
    expect(res.status).toBe(400);
  });

  it("should reject draft with missing content (400)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/${projectId}/drafts`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        draft_type: "social_media",
        title: "No content",
      });
    expect(res.status).toBe(400);
  });

  it("should reject draft for non-existent project (404)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/00000000-0000-0000-0000-000000000000/drafts`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        draft_type: "social_media",
        title: "Orphan Draft",
        content: "Content",
      });
    expect(res.status).toBe(404);
  });

  it("should list drafts for a project (200)", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/projects/${projectId}/drafts`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("should filter drafts by status (200)", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/projects/${projectId}/drafts?status=draft`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((d) => d.status === "draft")).toBe(true);
  });

  it("should get a single draft (200)", async () => {
    const createRes = await createDraft(app, token, businessId, projectId);

    const res = await request(app)
      .get(`${BASE(businessId)}/drafts/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createRes.body.id);
    expect(res.body.project_name).toBeDefined();
  });

  it("should return 404 for non-existent draft", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/drafts/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("should update a draft (200)", async () => {
    const createRes = await createDraft(app, token, businessId, projectId);

    const res = await request(app)
      .patch(`${BASE(businessId)}/drafts/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Updated Title", content: "Updated content" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Updated Title");
  });

  it("should reject status update via PATCH (400)", async () => {
    const createRes = await createDraft(app, token, businessId, projectId);

    const res = await request(app)
      .patch(`${BASE(businessId)}/drafts/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "approved" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status cannot be updated/i);
  });

  it("should update draft status via status endpoint (200)", async () => {
    const createRes = await createDraft(app, token, businessId, projectId);

    const res = await request(app)
      .patch(`${BASE(businessId)}/drafts/${createRes.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "reviewed" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("reviewed");
  });

  it("should reject invalid draft status transition (400)", async () => {
    const createRes = await createDraft(app, token, businessId, projectId);
    // draft -> published is invalid (must go draft -> reviewed -> approved -> published)
    const res = await request(app)
      .patch(`${BASE(businessId)}/drafts/${createRes.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "published" });
    expect(res.status).toBe(400);
  });

  it("should delete a draft (204)", async () => {
    const createRes = await createDraft(app, token, businessId, projectId);
    const id = createRes.body.id;

    const res = await request(app)
      .delete(`${BASE(businessId)}/drafts/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
    testDraftIds = testDraftIds.filter((x) => x !== id);
  });
});

// ===================================================================
// PITCH DECK CRUD
// ===================================================================

describe("Pitch deck CRUD", () => {
  let projectId;

  beforeAll(async () => {
    const res = await createProject(app, token, businessId, {
      name: "Pitch Deck Test Project",
    });
    projectId = res.body.id;
  });

  it("should create a pitch deck (201)", async () => {
    const res = await createPitchDeck(app, token, businessId, projectId, {
      title: "Investor Pitch",
      slides: [
        { slide_number: 1, heading: "Title", bullet_points: ["My Business"], speaker_notes: "Intro" },
        { slide_number: 2, heading: "Problem", bullet_points: ["Problem A"], speaker_notes: "Problem" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Investor Pitch");
    expect(res.body.slides).toBeInstanceOf(Array);
    expect(res.body.slides.length).toBe(2);
    expect(res.body.status).toBe("draft");
  });

  it("should reject pitch deck with missing title (400)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/${projectId}/pitch-decks`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        slides: [{ slide_number: 1, heading: "Test", bullet_points: [] }],
      });
    expect(res.status).toBe(400);
  });

  it("should reject pitch deck with empty slides (400)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/${projectId}/pitch-decks`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Empty Slides",
        slides: [],
      });
    expect(res.status).toBe(400);
  });

  it("should reject pitch deck for non-existent project (404)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/00000000-0000-0000-0000-000000000000/pitch-decks`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Orphan Deck",
        slides: [{ slide_number: 1, heading: "Test", bullet_points: [] }],
      });
    expect(res.status).toBe(404);
  });

  it("should create a pitch deck with marketing_project_id (201)", async () => {
    const res = await createPitchDeck(app, token, businessId, projectId, {
      title: "Linked Deck",
      slides: [
        { slide_number: 1, heading: "Title", bullet_points: ["My Business"], speaker_notes: "Intro" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.marketing_project_id).toBe(projectId);
  });

  it("should list pitch decks for a project (200)", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/projects/${projectId}/pitch-decks`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });

  it("should list only project-specific pitch decks (isolation)", async () => {
    // Create a second project
    const proj2Res = await createProject(app, token, businessId, {
      name: "Second Project for Isolation",
    });
    const project2Id = proj2Res.body.id;

    // Create a deck under project 1
    const deck1Res = await createPitchDeck(app, token, businessId, projectId, {
      title: "Deck for Project 1",
    });
    // Create a deck under project 2
    const deck2Res = await createPitchDeck(app, token, businessId, project2Id, {
      title: "Deck for Project 2",
    });

    // List decks for project 1 — should only see project 1's decks
    const listRes = await request(app)
      .get(`${BASE(businessId)}/projects/${projectId}/pitch-decks`)
      .set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThan(0);
    const deckIds = listRes.body.data.map((d) => d.id);
    expect(deckIds).toContain(deck1Res.body.id);
    expect(deckIds).not.toContain(deck2Res.body.id);
  });

  it("should get a single pitch deck with marketing_project_id (200)", async () => {
    const createRes = await createPitchDeck(app, token, businessId, projectId);

    const res = await request(app)
      .get(`${BASE(businessId)}/pitch-decks/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createRes.body.id);
    expect(res.body.slides).toBeInstanceOf(Array);
    expect(res.body.marketing_project_id).toBe(projectId);
  });

  it("should return 404 for non-existent pitch deck", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/pitch-decks/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("should return 400 for non-UUID pitch deck ID", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/pitch-decks/not-a-uuid`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("should update a pitch deck (200)", async () => {
    const createRes = await createPitchDeck(app, token, businessId, projectId);

    const res = await request(app)
      .patch(`${BASE(businessId)}/pitch-decks/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Updated Deck Title",
        slides: [
          { slide_number: 1, heading: "Updated Slide", bullet_points: ["New point"], speaker_notes: "Updated notes" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Updated Deck Title");
    expect(res.body.slides[0].heading).toBe("Updated Slide");
  });

  it("should reject status update via PATCH (400)", async () => {
    const createRes = await createPitchDeck(app, token, businessId, projectId);

    const res = await request(app)
      .patch(`${BASE(businessId)}/pitch-decks/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "finalized" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status cannot be updated/i);
  });

  it("should reject marketing_project_id update via PATCH (400)", async () => {
    const createRes = await createPitchDeck(app, token, businessId, projectId);

    const res = await request(app)
      .patch(`${BASE(businessId)}/pitch-decks/${createRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ marketing_project_id: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/marketing_project_id cannot be updated/i);
  });

  it("should update pitch deck status (200)", async () => {
    const createRes = await createPitchDeck(app, token, businessId, projectId);

    const res = await request(app)
      .patch(`${BASE(businessId)}/pitch-decks/${createRes.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "reviewed" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("reviewed");
  });

  it("should reject invalid pitch deck status transition (400)", async () => {
    const createRes = await createPitchDeck(app, token, businessId, projectId);
    // draft -> finalized is invalid
    const res = await request(app)
      .patch(`${BASE(businessId)}/pitch-decks/${createRes.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "finalized" });
    expect(res.status).toBe(400);
  });

  it("should delete a pitch deck (204)", async () => {
    const createRes = await createPitchDeck(app, token, businessId, projectId);
    const id = createRes.body.id;

    const res = await request(app)
      .delete(`${BASE(businessId)}/pitch-decks/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
    testPitchDeckIds = testPitchDeckIds.filter((x) => x !== id);
  });

  it("should return 404 when deleting non-existent pitch deck", async () => {
    const res = await request(app)
      .delete(`${BASE(businessId)}/pitch-decks/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ===================================================================
// AI GENERATION (demo fallback)
// ===================================================================

describe("AI generation (demo fallback)", () => {
  let projectId;

  beforeAll(async () => {
    const res = await createProject(app, token, businessId, {
      name: "AI Gen Project",
      description: "Project for AI generation tests",
    });
    projectId = res.body.id;
  });

  it("should generate a marketing draft (201)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/${projectId}/drafts/generate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        draft_type: "social_media",
        platform: "instagram",
        tone: "energetic",
        audience: "young professionals",
      });
    expect(res.status).toBe(201);
    expect(res.body.title).toBeDefined();
    expect(res.body.content).toBeDefined();
    expect(res.body.draft_type).toBe("social_media");
    expect(res.body._generator).toBeDefined();
    expect(res.body._generator.provider).toBe("demo");
    if (res.body.id) testDraftIds.push(res.body.id);
  });

  it("should generate a marketing draft with minimal input (201)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/${projectId}/drafts/generate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        draft_type: "email",
      });
    expect(res.status).toBe(201);
    expect(res.body.content).toBeDefined();
    expect(res.body.draft_type).toBe("email");
    if (res.body.id) testDraftIds.push(res.body.id);
  });

  it("should reject generation with invalid draft type (400)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/${projectId}/drafts/generate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        draft_type: "blog",
      });
    expect(res.status).toBe(400);
  });

  it("should reject generation for non-existent project (404)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/00000000-0000-0000-0000-000000000000/drafts/generate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        draft_type: "social_media",
      });
    expect(res.status).toBe(404);
  });

  it("should generate a customer persona (201)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/personas/generate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        audienceDescription: "SMB restaurant owners aged 30-50",
        marketing_project_id: projectId,
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBeDefined();
    expect(res.body.pain_points).toBeDefined();
    expect(res.body.motivations).toBeDefined();
    expect(res.body.target_segment).toBeDefined();
    expect(res.body._generator).toBeDefined();
    expect(res.body._generator.provider).toBe("demo");
    if (res.body.id) testPersonaIds.push(res.body.id);
  });

  it("should generate a customer persona with no project link (201)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/personas/generate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        audienceDescription: "Retail store managers",
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBeDefined();
    if (res.body.id) testPersonaIds.push(res.body.id);
  });

  it("should reject persona generation with invalid project ID (400)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/personas/generate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        marketing_project_id: "not-a-uuid",
      });
    expect(res.status).toBe(400);
  });

  it("should generate a pitch deck (201)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/${projectId}/pitch-decks/generate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        businessName: "Test Company Sdn Bhd",
      });
    expect(res.status).toBe(201);
    expect(res.body.title).toBeDefined();
    expect(res.body.slides).toBeInstanceOf(Array);
    expect(res.body.slides.length).toBe(10); // Should have 10 slides
    expect(res.body.marketing_project_id).toBe(projectId);
    expect(res.body._generator).toBeDefined();
    expect(res.body._generator.provider).toBe("demo");
    if (res.body.id) testPitchDeckIds.push(res.body.id);
  });

  it("should generate a pitch deck with no business name (201)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/projects/${projectId}/pitch-decks/generate`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.slides.length).toBe(10);
    if (res.body.id) testPitchDeckIds.push(res.body.id);
  });
});

// ===================================================================
// AI REVISION (demo fallback)
// ===================================================================

describe("AI revision (demo fallback)", () => {
  let projectId;
  let draftId;
  let pitchDeckId;

  beforeAll(async () => {
    const projRes = await createProject(app, token, businessId, {
      name: "Revision Test Project",
    });
    projectId = projRes.body.id;

    const draftRes = await createDraft(app, token, businessId, projectId, {
      draft_type: "content",
      title: "Revise Me",
      content: "Original content here.",
    });
    draftId = draftRes.body.id;

    const deckRes = await createPitchDeck(app, token, businessId, projectId, {
      title: "Revise Me Deck",
    });
    pitchDeckId = deckRes.body.id;
  });

  it("should revise a draft (200)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/drafts/${draftId}/revise`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        instructions: "Make it more engaging and add a call to action",
      });
    expect(res.status).toBe(200);
    expect(res.body.content).toContain("Revision applied");
    expect(res.body._generator).toBeDefined();
    expect(res.body._generator.provider).toBe("demo");
  });

  it("should reject revision with missing instructions (400)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/drafts/${draftId}/revise`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("should reject revision for non-existent draft (404)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/drafts/00000000-0000-0000-0000-000000000000/revise`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        instructions: "Update this",
      });
    expect(res.status).toBe(404);
  });

  it("should revise a pitch deck (200)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/pitch-decks/${pitchDeckId}/revise`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        instructions: "Add more emphasis on financial projections",
      });
    expect(res.status).toBe(200);
    expect(res.body.slides).toBeInstanceOf(Array);
    expect(res.body._generator).toBeDefined();
    expect(res.body._generator.provider).toBe("demo");
  });

  it("should reject pitch deck revision with missing instructions (400)", async () => {
    const res = await request(app)
      .post(`${BASE(businessId)}/pitch-decks/${pitchDeckId}/revise`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ===================================================================
// MARKETING OVERVIEW
// ===================================================================

describe("Marketing overview", () => {
  it("should return overview summary (200)", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/overview`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total_projects).toBeDefined();
    expect(res.body.total_personas).toBeDefined();
    expect(res.body.total_drafts).toBeDefined();
    expect(res.body.total_pitch_decks).toBeDefined();
    expect(res.body.draft_projects).toBeDefined();
    expect(res.body.active_projects).toBeDefined();
    expect(res.body.completed_projects).toBeDefined();
  });
});

// ===================================================================
// AUTH & SECURITY
// ===================================================================

describe("Marketing auth & security", () => {
  it("should reject access without token (401)", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/projects`);
    expect(res.status).toBe(401);
  });

  it("should reject access to another business's marketing (403)", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/projects`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it("should reject non-UUID business ID (400)", async () => {
    const res = await request(app)
      .get(`/api/businesses/not-a-uuid/marketing/projects`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("should reject non-UUID project ID in path (400)", async () => {
    const res = await request(app)
      .get(`${BASE(businessId)}/projects/not-a-uuid`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("should reject cross-business project access (404)", async () => {
    // Create a project in business A
    const createRes = await createProject(app, token, businessId, {
      name: "Cross-Business Test",
    });

    // Try to access from business B
    const res = await request(app)
      .get(`${BASE(otherBusinessId)}/projects/${createRes.body.id}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });

  it("should reject cross-business persona access (404)", async () => {
    const createRes = await createPersona(app, token, businessId, {
      name: "Cross-Business Persona",
    });

    const res = await request(app)
      .get(`${BASE(otherBusinessId)}/personas/${createRes.body.id}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });

  it("should reject cross-business draft access (404)", async () => {
    const projRes = await createProject(app, token, businessId, {
      name: "Cross-Business Draft Project",
    });
    const draftRes = await createDraft(app, token, businessId, projRes.body.id);

    const res = await request(app)
      .get(`${BASE(otherBusinessId)}/drafts/${draftRes.body.id}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });

  it("should reject cross-business pitch deck access (404)", async () => {
    const projRes = await createProject(app, token, businessId, {
      name: "Cross-Business Deck Project",
    });
    const deckRes = await createPitchDeck(app, token, businessId, projRes.body.id);

    const res = await request(app)
      .get(`${BASE(otherBusinessId)}/pitch-decks/${deckRes.body.id}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });
});

// ===================================================================
// REGRESSION: Existing routes still work
// ===================================================================

describe("Regression: existing routes still work", () => {
  it("GET /api/health should return 200", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /api/health/db should return 200", async () => {
    const res = await request(app).get("/api/health/db");
    expect(res.status).toBe(200);
    expect(res.body.database).toBe("connected");
  });

  it("GET /api/businesses/:businessId/me should work (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/me`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("Financial Hub customers endpoint should work (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/customers`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("Inventory products endpoint should work (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/inventory/products`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("Task allocation team-members endpoint should work (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/tasks/team-members`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
