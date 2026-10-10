/**
 * AuthContext — auto demo session. No login UI.
 *
 * On first load, if no token exists, we try to log in as the seeded
 * demo user (owner@demo.busyness) which has pre-loaded sample data
 * (customers, products, invoices, tasks, etc.). If that fails (e.g.
 * the database hasn't been seeded), we fall back to registering a
 * fresh demo user with a new empty business.
 *
 * The token + business are stored in localStorage so the session
 * persists across reloads. Users who want to identify themselves can
 * replace the session via `replaceSession(token, user, business)`.
 */

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "../api/client.js";

const Ctx = createContext(null);
const TOKEN_KEY = "busyness_token";
const USER_KEY = "busyness_user";
const BUSINESS_KEY = "busyness_business";

function readStored() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const user = JSON.parse(localStorage.getItem(USER_KEY) || "null");
    const business = JSON.parse(localStorage.getItem(BUSINESS_KEY) || "null");
    return { token, user, business };
  } catch {
    return { token: null, user: null, business: null };
  }
}

function persist(token, user, business) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
  if (business) localStorage.setItem(BUSINESS_KEY, JSON.stringify(business));
  else localStorage.removeItem(BUSINESS_KEY);
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

async function bootstrapDemo() {
  // --- Strategy 1: Log in as the seeded demo user ---
  // The seed data (owner@demo.busyness) comes with a full demo
  // business: products, customers, invoices, tasks, marketing projects.
  // Logging in as this user gives us access to all that data.
  const SEED_EMAIL = "owner@demo.busyness";
  const SEED_PASSWORD = "Demo1234!";

  try {
    const loginRes = await api.post("/api/auth/login", {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    });

    // Login doesn't return business info, so fetch it via /api/auth/me
    api.setToken(loginRes.token);
    const meRes = await api.get("/api/auth/me");

    if (meRes.businesses && meRes.businesses.length > 0) {
      return {
        token: loginRes.token,
        user: loginRes.user,
        business: meRes.businesses[0],
      };
    }
  } catch {
    // Seeded user doesn't exist or password is wrong — fall through to registration
  }

  // --- Strategy 2: Register a fresh demo user (empty business) ---
  const email = `demo-${randomSuffix()}@busyness.app`;
  const password = "Demo1234!";
  const name = "Demo User";
  const businessName = "Demo Workspace";
  try {
    const res = await api.post("/api/auth/register", {
      email,
      password,
      name,
      business_name: businessName,
    });
    return {
      token: res.token,
      user: res.user,
      business: res.business,
    };
  } catch (err) {
    console.warn("Demo bootstrap failed; continuing without session.", err);
    return null;
  }
}

export function AuthProvider({ children }) {
  const [{ token, user, business }, setState] = useState(readStored);
  const [ready, setReady] = useState(false);

  // Auto-bootstrap demo session on first visit
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (token) {
        // Already have a session — keep it
        setReady(true);
        return;
      }
      const session = await bootstrapDemo();
      if (cancelled) return;
      if (session) {
        api.setToken(session.token);
        persist(session.token, session.user, session.business);
        setState(session);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const replaceSession = useCallback((nextToken, nextUser, nextBusiness) => {
    api.setToken(nextToken);
    persist(nextToken, nextUser, nextBusiness);
    setState({ token: nextToken, user: nextUser, business: nextBusiness });
  }, []);

  const clearSession = useCallback(() => {
    api.clearToken();
    persist(null, null, null);
    setState({ token: null, user: null, business: null });
  }, []);

  const value = {
    token,
    user,
    business,
    businesses: business ? [business] : [],
    ready,
    replaceSession,
    clearSession,
    isAuthenticated: !!token,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}