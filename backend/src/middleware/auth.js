/**
 * auth.js — Authentication middleware.
 *
 * Extracts a Bearer token from the Authorization header, verifies its
 * JWT signature and expiry, and attaches the decoded user to req.user.
 *
 * If the token is missing, malformed, expired, or has an invalid signature,
 * the middleware responds with 401 Unauthorized and a safe message.
 *
 * Usage:
 *   import { authenticateToken } from "../middleware/auth.js";
 *   router.get("/protected", authenticateToken, handler);
 *
 * After this middleware runs, req.user will contain:
 *   { userId, email, name }
 */

import { verifyToken } from "../utils/jwt.js";
import { UnauthorizedError } from "../utils/errors.js";

export function authenticateToken(req, _res, next) {
  const authHeader = req.headers["authorization"];
  const headerValue = authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!headerValue) {
    return next(new UnauthorizedError("Missing or invalid Authorization header. Expected: Bearer <token>"));
  }

  try {
    const decoded = verifyToken(headerValue);
    // Attach user info to request for downstream handlers
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      name: decoded.name,
    };
    next();
  } catch (err) {
    // Distinguish expired vs. invalid for client clarity
    if (err.name === "TokenExpiredError") {
      return next(new UnauthorizedError("Token has expired"));
    }
    return next(new UnauthorizedError("Invalid token"));
  }
}
