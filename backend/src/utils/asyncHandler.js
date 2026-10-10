/**
 * asyncHandler.js — Wraps an async route handler so that rejected promises
 * are forwarded to Express's central error handler via next(err).
 *
 * Without this wrapper, an unhandled promise rejection inside a route handler
 * would silently disappear (Express 4 does not catch async errors automatically).
 *
 * Usage:
 *   router.post("/login", asyncHandler(async (req, res) => {
 *     // async code here — throw or reject freely
 *   }));
 *
 * @param {Function} fn - Async express route handler (req, res, next)
 * @returns {Function} Wrapped handler that catches rejections
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
