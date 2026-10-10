/**
 * auth.test.js — Integration tests for the authentication foundation.
 *
 * Covers:
 *   1. Successful registration (creates business + user + owner membership)
 *   2. Successful login with correct credentials
 *   3. Login failure with incorrect password
 *   4. Invalid token rejection (401)
 *   5. Expired token rejection (401)
 *   6. Missing token rejection (401)
 *   7. Member accessing their authorized business (200)
 *   8. Non-member accessing another business (403)
 *   9. Registration validation (invalid email, short password)
 *  10. Duplicate email registration (409)
 *
 * Tests run against the real Supabase PostgreSQL database.
 * All test data is cleaned up in the afterAll hook.
 */

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { query, closePool } from "../db/pool.js";

// --- Track test data for cleanup ---
const testUserEmails = [];
const testBusinessIds = [];

// Unique suffix to avoid collisions across test runs
const ts = Date.now();

/**
 * Clean up all test users and businesses after all tests complete.
 * Memberships cascade-delete when users or businesses are deleted.
 */
afterAll(async () => {
  for (const email of testUserEmails) {
    try {
      await query("DELETE FROM users WHERE email = $1", [email]);
    } catch {
      // Ignore — user may not have been created
    }
  }
  for (const id of testBusinessIds) {
    try {
      await query("DELETE FROM businesses WHERE id = $1", [id]);
    } catch {
      // Ignore — business may have FK constraints from other test data
    }
  }
  await closePool();
}, 30000);

// --- Helper: register a user and return the response ---

async function registerUser(email, password, name, businessName) {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password,
    name,
    business_name: businessName,
  });
  if (res.body.business?.id) testBusinessIds.push(res.body.business.id);
  if (email) testUserEmails.push(email);
  return res;
}

// ====================================================================
// Registration Tests
// ====================================================================

describe("POST /api/auth/register", () => {
  it("should register a new user, create a business and owner membership", async () => {
    const email = `test-reg-${ts}@busyness.test`;
    const res = await registerUser(
      email,
      "SecurePass123!",
      "Test Register User",
      `Test Business ${ts}`
    );

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("token");
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({
      email: email,
      role: "owner",
    });
    expect(res.body.user.id).toBeTruthy();
    expect(res.body.business).toHaveProperty("id");
    expect(res.body.business.name).toBe(`Test Business ${ts}`);
    expect(res.body.membership.role).toBe("owner");
  });

  it("should reject duplicate email registration with 409", async () => {
    const email = `test-dup-${ts}@busyness.test`;
    // First registration succeeds
    const res1 = await registerUser(email, "SecurePass123!", "User One", "Biz One");
    expect(res1.status).toBe(201);

    // Second registration with same email fails
    const res2 = await request(app).post("/api/auth/register").send({
      email,
      password: "DifferentPass456!",
      name: "User Two",
      business_name: "Biz Two",
    });

    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/already exists/i);
  });

  it("should reject invalid email with 400", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "not-an-email",
      password: "SecurePass123!",
      name: "Test User",
      business_name: "Test Business",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("should reject short password (< 8 chars) with 400", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: `test-short-${ts}@busyness.test`,
      password: "short",
      name: "Test User",
      business_name: "Test Business",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("should not allow role to be set from the request body", async () => {
    const email = `test-role-${ts}@busyness.test`;
    // Attempt to inject a manager role — should be ignored
    const res = await request(app).post("/api/auth/register").send({
      email,
      password: "SecurePass123!",
      name: "Sneaky User",
      business_name: "Sneaky Business",
      role: "manager", // This should be ignored — role is hardcoded to 'owner'
    });

    expect(res.status).toBe(201);
    // Even if role was passed in the body, it must be 'owner'
    expect(res.body.user.role).toBe("owner");
    expect(res.body.membership.role).toBe("owner");
  });
});

// ====================================================================
// Login Tests
// ====================================================================

describe("POST /api/auth/login", () => {
  // Register a user first, then test login
  const email = `test-login-${ts}@busyness.test`;
  const password = "SecurePass123!";

  // Run registration before login tests
  it("should setup: register a test user", async () => {
    const res = await registerUser(email, password, "Login Test User", "Login Test Biz");
    expect(res.status).toBe(201);
  });

  it("should login successfully with correct credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email,
      password,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(email);
  });

  it("should reject login with incorrect password (401)", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email,
      password: "WrongPassword!",
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  it("should reject login with non-existent email (401)", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: `nonexistent-${ts}@busyness.test`,
      password: "SomePassword123!",
    });

    expect(res.status).toBe(401);
    // Same error message as wrong password — prevents user enumeration
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  it("should reject login with missing fields (400)", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: email,
      // Missing password
    });

    expect(res.status).toBe(400);
  });
});

// ====================================================================
// Token Authentication Tests
// ====================================================================

describe("Token authentication", () => {
  const email = `test-token-${ts}@busyness.test`;
  const password = "SecurePass123!";
  let validToken = "";
  let businessId = "";

  it("should setup: register and get a valid token", async () => {
    const res = await registerUser(email, password, "Token Test User", "Token Test Biz");
    expect(res.status).toBe(201);
    validToken = res.body.token;
    businessId = res.body.business.id;
  });

  it("should accept a valid token on a protected route (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/me`)
      .set("Authorization", `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.membership.role).toBe("owner");
    expect(res.body.businessId).toBe(businessId);
  });

  it("should reject a request with no Authorization header (401)", async () => {
    const res = await request(app).get(`/api/businesses/${businessId}/me`);

    expect(res.status).toBe(401);
  });

  it("should reject an invalid token (401)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/me`)
      .set("Authorization", "Bearer invalid.token.here");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid token/i);
  });

  it("should reject a malformed Authorization header (401)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/me`)
      .set("Authorization", "NotBearer abc123");

    expect(res.status).toBe(401);
  });

  it("should reject an expired token (401)", async () => {
    // Sign a token with 1ms expiry, wait for it to expire
    const expiredToken = jwt.sign(
      { userId: "00000000-0000-0000-0000-000000000000", email, name: "Expired" },
      process.env.JWT_SECRET,
      { expiresIn: "1ms" }
    );
    // Small delay to ensure the token has expired
    await new Promise((resolve) => setTimeout(resolve, 50));

    const res = await request(app)
      .get(`/api/businesses/${businessId}/me`)
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });
});

// ====================================================================
// Business Authorization Tests
// ====================================================================

describe("Business authorization", () => {
  // Two users, each with their own business
  const emailA = `test-auth-a-${ts}@busyness.test`;
  const emailB = `test-auth-b-${ts}@busyness.test`;
  const password = "SecurePass123!";

  let tokenA = "";
  let tokenB = "";
  let businessIdA = "";
  let businessIdB = "";

  it("should setup: register user A and user B with separate businesses", async () => {
    const resA = await registerUser(emailA, password, "User A", "Business A");
    expect(resA.status).toBe(201);
    tokenA = resA.body.token;
    businessIdA = resA.body.business.id;

    const resB = await registerUser(emailB, password, "User B", "Business B");
    expect(resB.status).toBe(201);
    tokenB = resB.body.token;
    businessIdB = resB.body.business.id;
  });

  it("should allow member A to access their own business (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessIdA}/me`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(emailA);
    expect(res.body.membership.role).toBe("owner");
    expect(res.body.businessId).toBe(businessIdA);
  });

  it("should deny user B access to business A (403)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessIdA}/me`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/do not have access/i);
  });

  it("should allow user B to access their own business B (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessIdB}/me`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(emailB);
  });

  it("should reject a non-UUID business ID (400)", async () => {
    const res = await request(app)
      .get(`/api/businesses/not-a-uuid/me`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid UUID/i);
  });
});

// ====================================================================
// Health Check Regression Tests
// ====================================================================

describe("Existing health routes (regression)", () => {
  it("GET /api/health should still return 200", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("Busyness API");
  });

  it("GET /api/health/db should still return 200", async () => {
    const res = await request(app).get("/api/health/db");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.database).toBe("connected");
  });
});
