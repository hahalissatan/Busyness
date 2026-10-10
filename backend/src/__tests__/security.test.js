/**
 * security.test.js — Integration tests for shared security infrastructure.
 *
 * Covers:
 *   1. Security headers (Helmet): X-Content-Type-Options, X-Frame-Options,
 *      X-Powered-By removal
 *   2. CORS behavior: allowed origin, disallowed origin, no-origin, preflight
 *   3. Rate limiting: 429 after exceeding limit, rate limit headers present
 *   4. Error responses: malformed JSON (400), 404 format, 401 format,
 *      no stack traces leaked
 *   5. Request logger: logs format without sensitive data
 *
 * Tests that don't require the database are designed to work even if
 * the pool was closed by a prior test file.
 */

import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import rateLimit from "express-rate-limit";
import app from "../app.js";
import { closePool } from "../db/pool.js";

afterAll(async () => {
  try {
    await closePool();
  } catch {
    // Pool may already be closed by auth.test.js — that's fine
  }
}, 10000);

// ====================================================================
// Security Headers (Helmet)
// ====================================================================

describe("Security headers (Helmet)", () => {
  it("should set X-Content-Type-Options to nosniff", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("should set X-Frame-Options to SAMEORIGIN", async () => {
    const res = await request(app).get("/api/health");

    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("should remove the X-Powered-By header", async () => {
    const res = await request(app).get("/api/health");

    // Helmet removes the X-Powered-By header that Express sets by default
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

// ====================================================================
// CORS
// ====================================================================

describe("CORS behavior", () => {
  it("should allow a localhost origin in development", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Origin", "http://localhost:5173");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("should deny a disallowed origin (no Access-Control-Allow-Origin header)", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Origin", "http://evil.example.com");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("should not set CORS headers when no Origin header is present (same-origin)", async () => {
    const res = await request(app).get("/api/health");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("should handle preflight OPTIONS request from allowed origin", async () => {
    const res = await request(app)
      .options("/api/health")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("should reject preflight from a disallowed origin", async () => {
    const res = await request(app)
      .options("/api/health")
      .set("Origin", "http://evil.example.com")
      .set("Access-Control-Request-Method", "GET");

    // CORS middleware passes through to the 404 handler (no CORS headers set)
    // because the origin is not allowed
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

// ====================================================================
// Rate Limiting
// ====================================================================

describe("Rate limiting", () => {
  // Uses a separate test app with a very low limit to avoid interfering
  // with the main app's rate limiter state.
  function createTestRateLimitApp(max) {
    const testApp = express();
    testApp.use(
      rateLimit({
        windowMs: 60000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many requests, please try again later." },
      })
    );
    testApp.get("/test", (req, res) => res.json({ ok: true }));
    return testApp;
  }

  it("should return 429 after exceeding the rate limit", async () => {
    const testApp = createTestRateLimitApp(3);

    // First 3 requests should succeed
    for (let i = 0; i < 3; i++) {
      const res = await request(testApp).get("/test");
      expect(res.status).toBe(200);
    }

    // 4th request should be rate-limited
    const res = await request(testApp).get("/test");
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many requests/i);
  });

  it("should include RateLimit-* standard headers in responses", async () => {
    const testApp = createTestRateLimitApp(5);

    const res = await request(testApp).get("/test");

    expect(res.status).toBe(200);
    // Standard headers (RFC 9111 draft)
    expect(res.headers["ratelimit-limit"]).toBeDefined();
    expect(res.headers["ratelimit-remaining"]).toBeDefined();
  });

  it("should not include legacy X-RateLimit-* headers", async () => {
    const testApp = createTestRateLimitApp(5);

    const res = await request(testApp).get("/test");

    // Legacy headers should be absent (legacyHeaders: false)
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeUndefined();
  });
});

// ====================================================================
// Error Responses
// ====================================================================

describe("Error response format", () => {
  it("should return 400 for malformed JSON body", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .type("json")
      .send("{ invalid json }");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");
  });

  it("should return 404 with JSON error for non-existent routes", async () => {
    const res = await request(app).get("/api/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Not Found");
    expect(res.body).toHaveProperty("path");
    expect(res.body).toHaveProperty("method");
  });

  it("should return 401 with JSON error for missing auth token", async () => {
    const res = await request(app).get(
      "/api/businesses/00000000-0000-0000-0000-000000000000/me"
    );

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");
  });

  it("should not expose stack traces in error responses", async () => {
    const res = await request(app).get("/api/does-not-exist");

    expect(res.body).not.toHaveProperty("stack");
    expect(res.body).not.toHaveProperty("trace");
    // The error field should be a human-readable string, not a stack
    expect(typeof res.body.error).toBe("string");
  });

  it("should return consistent JSON error for all error types", async () => {
    // 404
    const res404 = await request(app).get("/api/nope");
    expect(res404.body).toHaveProperty("error");

    // 401
    const res401 = await request(app).get(
      "/api/businesses/00000000-0000-0000-0000-000000000000/me"
    );
    expect(res401.body).toHaveProperty("error");

    // 400 (malformed JSON)
    const res400 = await request(app)
      .post("/api/auth/login")
      .type("json")
      .send("{ broken");
    expect(res400.body).toHaveProperty("error");
  });
});

// ====================================================================
// Request Logger
// ====================================================================

describe("Request logger", () => {
  it("should log method, path, and status without sensitive data", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await request(app).get("/api/health");

    expect(logSpy).toHaveBeenCalled();

    // Find the request log line (format: [REQ] GET /api/health 200 Xms)
    const logCalls = logSpy.mock.calls.map((args) => args.join(" "));
    const reqLog = logCalls.find((line) => line.includes("[REQ]"));

    expect(reqLog).toBeDefined();
    expect(reqLog).toContain("GET");
    expect(reqLog).toContain("/api/health");
    expect(reqLog).toContain("200");

    // The log line should NOT contain any sensitive data
    expect(reqLog).not.toMatch(/password/i);
    expect(reqLog).not.toMatch(/authorization/i);
    expect(reqLog).not.toMatch(/bearer/i);
    expect(reqLog).not.toMatch(/token/i);
    expect(reqLog).not.toMatch(/secret/i);

    logSpy.mockRestore();
  });

  it("should not log request body or headers", async () => {
    // Spy on all console methods since the logger uses log/warn/error
    // depending on the response status code
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await request(app)
      .post("/api/auth/login")
      .send({ email: "test@example.com", password: "SuperSecret123!" });

    // Gather all console calls across log/warn/error
    const allCalls = [
      ...logSpy.mock.calls.map((args) => args.join(" ")),
      ...warnSpy.mock.calls.map((args) => args.join(" ")),
      ...errSpy.mock.calls.map((args) => args.join(" ")),
    ];
    const reqLog = allCalls.find((line) => line.includes("[REQ]"));

    expect(reqLog).toBeDefined();
    // Must not contain the password or email from the request body
    expect(reqLog).not.toContain("SuperSecret123!");
    expect(reqLog).not.toContain("test@example.com");

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});
