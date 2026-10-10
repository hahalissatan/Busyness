/**
 * app.js — Express application factory.
 *
 * Creates and configures the Express app with all middleware:
 *   1. Helmet (security headers)
 *   2. CORS (environment-based origin allowlist)
 *   3. Request logger (method, path, status, duration — no sensitive data)
 *   4. General rate limiter
 *   5. Body parser (express.json)
 *   6. Routes (health, auth, business-scoped)
 *   7. 404 handler
 *   8. Centralized error handler (no SQL errors/stack traces in production)
 *
 * This file does NOT start the server — that's done by index.js.
 * Separating app creation from server startup allows tests to import
 * the app directly (via supertest) without binding to a port.
 */

import express from "express";
import { helmetMiddleware } from "./middleware/security.js";
import { corsMiddleware } from "./middleware/cors.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { generalRateLimit, authRateLimit } from "./middleware/rateLimit.js";
import authRoutes from "./routes/auth.js";
import businessRoutes from "./routes/business.js";
import financialsRoutes from "./routes/financials.js";
import inventoryRoutes from "./routes/inventory.js";

export function createApp() {
  const app = express();

  // Trust the first proxy hop (for correct req.ip behind load balancers)
  app.set("trust proxy", 1);

  // --- Security middleware (order matters) ---

  // 1. Helmet — security headers (first, before anything else)
  app.use(helmetMiddleware);

  // 2. CORS — environment-based origin allowlist
  app.use(corsMiddleware);

  // 3. Request logger — logs method, path, status, duration
  //    Never logs headers, body, or query params
  app.use(requestLogger);

  // 4. General rate limiter — applies to all routes (health checks skipped)
  app.use(generalRateLimit);

  // 5. Body parser — JSON only
  app.use(express.json());

  // --- Health checks (unchanged from original) ---

  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      service: "Busyness API",
    });
  });

  app.get("/api/health/db", async (req, res) => {
    const { checkConnection } = await import("./db/pool.js");
    const result = await checkConnection();
    if (result.ok) {
      res.json({ status: "ok", database: "connected" });
    } else {
      res.status(503).json({
        status: "error",
        database: "unreachable",
        code: result.error,
      });
    }
  });

  // --- Auth routes (public, with stricter rate limiting) ---
  // POST /api/auth/register
  // POST /api/auth/login
  app.use("/api/auth", authRateLimit, authRoutes);

  // --- Business-scoped routes (auth + business membership required) ---
  // GET /api/businesses/:businessId/me
  app.use("/api/businesses/:businessId", businessRoutes);

  // --- Financial Hub routes (auth + business membership required) ---
  // The financials router applies authenticateToken + requireBusinessAccess
  // at the router level, so every endpoint is automatically protected.
  // Endpoints:
  //   /customers, /invoices, /invoices/:id/payments
  app.use("/api/businesses/:businessId/financials", financialsRoutes);

  // --- Inventory routes (auth + business membership required) ---
  // The inventory router applies authenticateToken + requireBusinessAccess
  // at the router level, so every endpoint is automatically protected.
  // Endpoints:
  //   /products, /suppliers, /stock-movements, /overview, /low-stock
  app.use("/api/businesses/:businessId/inventory", inventoryRoutes);

  // --- 404 handler ---
  app.use((req, res) => {
    res.status(404).json({
      error: "Not Found",
      path: req.path,
      method: req.method,
    });
  });

  // --- Central error handler ---
  // Handles HttpError subclasses, body-parser errors, PostgreSQL errors,
  // and unknown errors. Never exposes SQL errors or stack traces in production.
  app.use((err, req, res, _next) => {
    const isProduction = process.env.NODE_ENV === "production";

    // 1. HttpError subclasses — safe application errors with known status
    if (err.status && err.status >= 400 && err.status < 600) {
      const body = { error: err.message || "Error" };
      if (err.details) body.details = err.details;
      return res.status(err.status).json(body);
    }

    // 2. Body-parser errors (malformed JSON, payload too large)
    // Express sets err.type for these and err.status = 400
    if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
      return res.status(400).json({
        error: "Invalid request body",
        message: isProduction ? undefined : err.message,
      });
    }

    // 3. PostgreSQL errors — never expose SQL details to the client
    // pg error codes: 5-character strings like "23505" (unique violation),
    // "42P01" (undefined table), "23503" (foreign key violation), etc.
    if (err.code && typeof err.code === "string" && err.code.length === 5) {
      // Log the full error internally for debugging
      console.error("[DB ERROR]", {
        code: err.code,
        constraint: err.constraint,
        table: err.table,
        message: err.message,
        stack: isProduction ? undefined : err.stack,
      });

      // Map common constraint violations to safe messages
      if (err.code === "23505") {
        // Unique violation
        return res.status(409).json({
          error: "A record with this value already exists",
        });
      }
      if (err.code === "23503") {
        // Foreign key violation
        return res.status(400).json({
          error: "Referenced record does not exist",
        });
      }
      if (err.code === "23514") {
        // Check constraint violation
        return res.status(400).json({
          error: "Value does not satisfy the required constraints",
        });
      }

      // Other database errors — generic message
      return res.status(500).json({
        error: "Database error",
        message: isProduction ? undefined : err.message,
      });
    }

    // 4. Unknown / programmer errors — log full details internally
    console.error("[ERROR]", {
      name: err.name,
      message: err.message,
      stack: isProduction ? undefined : err.stack,
    });

    // Return generic 500 — never expose stack traces or internal details
    res.status(500).json({
      error: "Internal Server Error",
      message: isProduction ? undefined : err.message,
    });
  });

  return app;
}

// Default export: a ready-to-use app instance
const app = createApp();
export default app;
