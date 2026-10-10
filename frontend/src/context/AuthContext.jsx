/**
 * AuthContext — auto demo session. No login UI.
 *
 * On first load, if no token exists, we register a hidden demo user
 * against the backend and store the resulting token + business in
 * localStorage. This keeps all API contracts intact (the backend still
 * requires a JWT) while removing the login barrier for the user.
 *
 * Users who want to identify themselves can replace the demo session
 * by calling `replaceSession(token, user, business)` — left here for
 * future use (e.g. team collaboration features).
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