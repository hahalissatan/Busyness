/**
 * security.js — Helmet configuration for security headers.
 *
 * Helmet sets sensible HTTP security headers by default:
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: SAMEORIGIN
 * - Strict-Transport-Security (HSTS) — enabled when behind HTTPS
 * - X-DNS-Prefetch-Control: off
 * - X-Download-Options: noopen
 * - X-XSS-Protection: 0 (modern browsers handle this via CSP)
 *
 * For a JSON API, we disable Content-Security-Policy and
 * Cross-Origin-Resource-Policy since those are browser-page concerns
 * and can interfere with API consumers.
 *
 * Environment variables: none required.
 */

import helmet from "helmet";

export const helmetMiddleware = helmet({
  // CSP is for browser pages, not a JSON API
  contentSecurityPolicy: false,
  // COOP/COEP are for cross-origin isolation, not needed for API
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  // Keep all other defaults (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
});
