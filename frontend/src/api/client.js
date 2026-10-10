/**
 * api/client.js — Centralized API client for Busyness.
 *
 * - Uses Vite proxy (/api → http://localhost:3001/api in dev)
 * - Attaches Bearer token from localStorage
 * - Parses pagination from list responses
 * - Handles 401 by clearing session and redirecting to /login
 * - Returns { data, pagination } or throws { message, details }
 */

const TOKEN_KEY = "busyness_token";
const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function buildHeaders(extra = {}) {
  const headers = { "Content-Type": "application/json", ...extra };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function buildUrl(path, params = {}) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  const url = API_BASE_URL
    ? new URL(normalizedPath, `${API_BASE_URL}/`)
    : new URL(normalizedPath, window.location.origin);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  return API_BASE_URL ? url.toString() : url.pathname + url.search;
}

async function request(method, path, { body, params } = {}) {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    method,
    headers: buildHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    // 401 → session expired or invalid token
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      // Login was removed — redirect to landing page so the auto-demo-session
      // in AuthContext can bootstrap a fresh session.
      if (window.location.pathname !== "/") {
        window.location.href = "/";
      }
    }

    const message =
      data?.error ||
      data?.message ||
      `Request failed (${res.status})`;
    const details = data?.details;
    const error = new Error(message);
    error.status = res.status;
    error.details = details;
    throw error;
  }

  return data;
}

export const api = {
  get: (path, params) => request("GET", path, { params }),
  post: (path, body) => request("POST", path, { body }),
  patch: (path, body) => request("PATCH", path, { body }),
  put: (path, body) => request("PUT", path, { body }),
  delete: (path) => request("DELETE", path),

  /**
   * GET list with pagination support.
   * Handles both { data, pagination } and { data, count } response shapes.
   */
  async list(path, params = {}) {
    const data = await request("GET", path, { params });
    return {
      data: data.data || [],
      pagination: data.pagination || (data.count !== undefined
        ? { total: data.count, page: 1, limit: 999, total_pages: 1 }
        : { total: (data.data || []).length, page: 1, limit: 999, total_pages: 1 }),
    };
  },

  getToken,
  setToken: (token) => localStorage.setItem(TOKEN_KEY, token),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),
};
