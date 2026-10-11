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
 * GET /api/auth/me
 *   Returns the authenticated user's businesses.
 *
 * IN-MEMORY FALLBACK:
 *   When PostgreSQL is not available, these endpoints fall back to
 *   an in-memory user store so the app works without a database.
 *   A demo account is pre-seeded: demo@busyness.app / Demo1234!
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
import { BUSINESS_ID, USER_ID } from "../services/inMemoryStore.js";

const router = Router();

// --- In-memory user store (fallback when PostgreSQL is unavailable) -------

const inMemoryUsers = new Map();

// Pre-seed a demo user (password will be hashed lazily on first login attempt)
let demoPasswordHash = null;
async function getDemoPasswordHash() {
  if (!demoPasswordHash) {
    demoPasswordHash = await hashPassword("Demo1234!");
  }
  return demoPasswordHash;
}

// Track which business IDs map to in-memory users
const inMemoryBusinesses = new Map();

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
    const emailLower = email.toLowerCase();

    // Try database first
    try {
      const existing = await query(
        "SELECT id FROM users WHERE email = $1",
        [emailLower]
      );
      if (existing.rows.length > 0) {
        throw new ConflictError("An account with this email already exists");
      }

      const passwordHash = await hashPassword(password);

      const result = await withTransaction(async (client) => {
        const businessResult = await client.query(
          `INSERT INTO businesses (name, currency)
           VALUES ($1, 'MYR')
           RETURNING id, name, currency`,
          [business_name]
        );
        const business = businessResult.rows[0];

        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, 'owner')
           RETURNING id, email, name, role, created_at`,
          [emailLower, passwordHash, name]
        );
        const user = userResult.rows[0];

        const membershipResult = await client.query(
          `INSERT INTO business_memberships (user_id, business_id, role)
           VALUES ($1, $2, 'owner')
           RETURNING id, role, created_at`,
          [user.id, business.id]
        );
        const membership = membershipResult.rows[0];

        return { business, user, membership };
      });

      const token = signToken({
        userId: result.user.id,
        email: result.user.email,
        name: result.user.name,
      });

      return res.status(201).json({
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
    } catch (err) {
      // If it's a conflict error, re-throw
      if (err instanceof ConflictError) throw err;
      // If DB is unavailable, fall back to in-memory
      if (!isDbUnavailable(err)) throw err;
    }

    // --- In-memory fallback ---
    if (inMemoryUsers.has(emailLower)) {
      throw new ConflictError("An account with this email already exists");
    }

    const passwordHash = await hashPassword(password);
    const newUserId = `d1a2${Date.now().toString(16).slice(-4)}-0000-4000-8000-${Date.now().toString(16).slice(-12).padStart(12, "0")}`;
    const newBusinessId = `d1b2${Date.now().toString(16).slice(-4)}-0000-4000-8000-${(Date.now() + 1).toString(16).slice(-12).padStart(12, "0")}`;

    const userRecord = {
      id: newUserId,
      email: emailLower,
      password_hash: passwordHash,
      name,
      role: "owner",
    };
    inMemoryUsers.set(emailLower, userRecord);
    inMemoryBusinesses.set(newUserId, {
      id: newBusinessId,
      name: business_name,
      currency: "MYR",
      role: "owner",
    });

    const token = signToken({
      userId: newUserId,
      email: emailLower,
      name,
    });

    res.status(201).json({
      message: "Registration successful (demo mode — no database connected)",
      token,
      user: {
        id: newUserId,
        email: emailLower,
        name,
        role: "owner",
      },
      business: {
        id: newBusinessId,
        name: business_name,
        currency: "MYR",
      },
      membership: {
        id: "demo-membership",
        role: "owner",
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
    const emailLower = email.toLowerCase();

    // Try database first
    try {
      const result = await query(
        `SELECT id, email, password_hash, name, role
         FROM users
         WHERE email = $1
         LIMIT 1`,
        [emailLower]
      );

      if (result.rows.length === 0) {
        throw new UnauthorizedError("Invalid email or password");
      }

      const user = result.rows[0];
      const passwordValid = await comparePassword(password, user.password_hash);
      if (!passwordValid) {
        throw new UnauthorizedError("Invalid email or password");
      }

      const token = signToken({
        userId: user.id,
        email: user.email,
        name: user.name,
      });

      return res.json({
        message: "Login successful",
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      if (!isDbUnavailable(err)) throw err;
    }

    // --- In-memory fallback ---

    // Check for demo account (matches frontend AuthContext bootstrap)
    if (emailLower === "owner@demo.busyness") {
      const demoHash = await getDemoPasswordHash();
      const passwordValid = await comparePassword(password, demoHash);
      if (!passwordValid) {
        throw new UnauthorizedError("Invalid email or password");
      }

      const token = signToken({
        userId: USER_ID,
        email: "owner@demo.busyness",
        name: "Demo Owner",
      });

      return res.json({
        message: "Login successful (demo mode — no database connected)",
        token,
        user: {
          id: USER_ID,
          email: "owner@demo.busyness",
          name: "Demo Owner",
          role: "owner",
        },
      });
    }

    // Check in-memory registered users
    const memUser = inMemoryUsers.get(emailLower);
    if (memUser) {
      const passwordValid = await comparePassword(password, memUser.password_hash);
      if (!passwordValid) {
        throw new UnauthorizedError("Invalid email or password");
      }

      const token = signToken({
        userId: memUser.id,
        email: memUser.email,
        name: memUser.name,
      });

      return res.json({
        message: "Login successful (demo mode)",
        token,
        user: {
          id: memUser.id,
          email: memUser.email,
          name: memUser.name,
          role: memUser.role,
        },
      });
    }

    throw new UnauthorizedError("Invalid email or password");
  })
);

// --- GET /api/auth/me --------------------------------------------------

router.get(
  "/me",
  authenticateToken,
  asyncHandler(async (req, res) => {
    // Try database first
    try {
      const result = await query(
        `SELECT b.id, b.name, b.currency, bm.role as membership_role
         FROM business_memberships bm
         JOIN businesses b ON b.id = bm.business_id
         WHERE bm.user_id = $1
         ORDER BY bm.created_at`,
        [req.user.userId]
      );
      return res.json({
        user: req.user,
        businesses: result.rows,
      });
    } catch (err) {
      if (!isDbUnavailable(err)) throw err;
    }

    // --- In-memory fallback ---
    const businesses = [];

    // If it's the demo user, return the demo business
    if (req.user.userId === USER_ID) {
      businesses.push({
        id: BUSINESS_ID,
        name: "Busyness Demo Co.",
        currency: "MYR",
        membership_role: "owner",
      });
    }

    // Check for in-memory registered businesses
    if (inMemoryBusinesses.has(req.user.userId)) {
      businesses.push(inMemoryBusinesses.get(req.user.userId));
    }

    res.json({
      user: req.user,
      businesses,
    });
  })
);

export default router;
