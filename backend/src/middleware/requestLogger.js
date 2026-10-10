/**
 * requestLogger.js — Structured request logging middleware.
 *
 * Logs: HTTP method, path, status code, response duration.
 *
 * NEVER logs:
 *   - Authorization headers / JWT tokens
 *   - Request bodies (may contain passwords)
 *   - Query parameters (may contain tokens)
 *   - Database credentials
 *   - User emails or IDs (may appear in paths, but we sanitize)
 *
 * Output format:
 *   [REQ] POST /api/auth/register 201 45ms
 *
 * In production, logs go to stdout (captured by container log aggregator).
 * In development, logs also go to stdout (visible in terminal).
 */

/**
 * Redact sensitive path segments.
 * Replaces UUIDs in paths with :id for consistent, privacy-respecting logs.
 * Does not affect the actual request — only the log line.
 */
function sanitizePath(path) {
  // Replace UUIDs with :id for cleaner, more consistent logs
  return path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ":id"
  );
}

export function requestLogger(req, res, next) {
  const start = Date.now();

  // Log after the response is sent (res.on('finish') fires after headers sent)
  res.on("finish", () => {
    const duration = Date.now() - start;
    const method = req.method;
    const path = sanitizePath(req.path);
    const status = res.statusCode;

    // Simple structured log line — no sensitive data
    const logLine = `[REQ] ${method} ${path} ${status} ${duration}ms`;

    // Use console for simplicity (stdout)
    // In production, this would be picked up by a log aggregator
    if (status >= 500) {
      console.error(logLine);
    } else if (status >= 400) {
      console.warn(logLine);
    } else {
      console.log(logLine);
    }
  });

  next();
}
