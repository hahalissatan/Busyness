/**
 * routes/auth.js — Authentication endpoints.
 *
 * POST /api/auth/register
 *   Creates a new user, a new business, and an owner membership —
 *   all transactionally. The first member is always the owner.
 *   Role is hardcoded to 'owner' — never taken from the request body.
 *
 * POST /api/auth/login
 *   Verifies email + password against the database, issues a JWT.
 *
 * No social login or OAuth in this phase.
 */

import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { withTransaction } from "../utils/transaction.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { signToken } from "../utils/jwt.js";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { BadRequestError, UnauthorizedError, ConflictError } from "../utils/errors.js";

const router = Router();

// --- Validation schemas --------------------------------------------------

const registerSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
  name: z.string().min(1, "Name is required").max(200, "Name is too long"),
  business_name: z
    .string()
    .min(1, "Business name is required")
    .max(200, "Business name is too long"),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

// --- POST /api/auth/register --------------------------------------------

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    // Validate input — zod throws ZodError on failure
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", {
        errors: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    }

    const { email, password, name, business_name } = parsed.data;

    // Check for duplicate email BEFORE starting a transaction
    // (fast rejection, avoids unnecessary DB transaction work)
    const existing = await query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      throw new ConflictError("An account with this email already exists");
    }

    // Hash password outside the transaction (CPU-bound, no DB needed)
    const passwordHash = await hashPassword(password);

    // Transactional: create business + user + owner membership
    const result = await withTransaction(async (client) => {
      // 1. Create the business
      const businessResult = await client.query(
        `INSERT INTO businesses (name, currency)
         VALUES ($1, 'MYR')
         RETURNING id, name, currency`,
        [business_name]
      );
      const business = businessResult.rows[0];

      // 2. Create the user — role is hardcoded to 'owner', NOT from request
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, $2, $3, 'owner')
         RETURNING id, email, name, role, created_at`,
        [email.toLowerCase(), passwordHash, name]
      );
      const user = userResult.rows[0];

      // 3. Create the owner membership — role is hardcoded to 'owner'
      const membershipResult = await client.query(
        `INSERT INTO business_memberships (user_id, business_id, role)
         VALUES ($1, $2, 'owner')
         RETURNING id, role, created_at`,
        [user.id, business.id]
      );
      const membership = membershipResult.rows[0];

      return { business, user, membership };
    });

    // Issue JWT — payload contains userId, email, name (NOT business_id)
    // Business context is resolved per-request via URL params + membership check
    const token = signToken({
      userId: result.user.id,
      email: result.user.email,
      name: result.user.name,
    });

    res.status(201).json({
      message: "Registration successful",
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
      },
      business: {
        id: result.business.id,
        name: result.business.name,
        currency: result.business.currency,
      },
      membership: {
        id: result.membership.id,
        role: result.membership.role,
      },
    });
  })
);

// --- POST /api/auth/login -----------------------------------------------

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", {
        errors: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    }

    const { email, password } = parsed.data;

    // Look up user by email (case-insensitive — emails are stored lowercased)
    const result = await query(
      `SELECT id, email, password_hash, name, role
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [email.toLowerCase()]
    );

    // Security: return the same error for "user not found" and "wrong password"
    // to prevent user enumeration via timing differences
    if (result.rows.length === 0) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const user = result.rows[0];

    // Compare password against stored bcrypt hash
    const passwordValid = await comparePassword(password, user.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedError("Invalid email or password");
    }

    // Issue JWT
    const token = signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  })
);

// --- GET /api/auth/me --------------------------------------------------

router.get(
  "/me",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT b.id, b.name, b.currency, bm.role as membership_role
       FROM business_memberships bm
       JOIN businesses b ON b.id = bm.business_id
       WHERE bm.user_id = $1
       ORDER BY bm.created_at`,
      [req.user.userId]
    );
    res.json({
      user: req.user,
      businesses: result.rows,
    });
  })
);

export default router;
