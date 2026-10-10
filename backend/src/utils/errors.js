/**
 * errors.js — Custom error classes for structured API error responses.
 *
 * All application errors extend HttpError, which carries an HTTP status code
 * and a safe (non-leaking) message suitable for returning to the client.
 *
 * The central error handler in app.js checks for `instanceof HttpError`
 * and uses its status/message directly. Other errors default to 500.
 */

export class HttpError extends Error {
  /**
   * @param {number} status - HTTP status code
   * @param {string} message - Safe message for the client
   * @param {object} [details] - Optional extra fields (e.g. validation errors)
   */
  constructor(status, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    if (details) this.details = details;
  }
}

/** 400 Bad Request — validation failure, malformed input */
export class BadRequestError extends HttpError {
  constructor(message = "Bad Request", details) {
    super(400, message, details);
    this.name = "BadRequestError";
  }
}

/** 401 Unauthorized — missing or invalid credentials/token */
export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

/** 403 Forbidden — authenticated but not allowed (e.g. wrong business) */
export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(403, message);
    this.name = "ForbiddenError";
  }
}

/** 404 Not Found — resource does not exist */
export class NotFoundError extends HttpError {
  constructor(message = "Not Found") {
    super(404, message);
    this.name = "NotFoundError";
  }
}

/** 409 Conflict — duplicate email, duplicate idempotency key, etc. */
export class ConflictError extends HttpError {
  constructor(message = "Conflict") {
    super(409, message);
    this.name = "ConflictError";
  }
}
