/**
 * AuthContext — manages JWT token, user info, and business context.
 *
 * Token is stored in localStorage (busyness_token).
 * On mount, if a token exists, GET /api/auth/me verifies it and loads businesses.
 *
 * Security trade-off: localStorage is accessible to XSS. This is the standard
 * SPA approach for JWT. HttpOnly cookies would require a backend change.
 * The backend enforces all authorization — the frontend token is only for
 * transport, not trust.
 */

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "../api/client.js";

const AuthContext = createContext(null);
const TOKEN_KEY = "busyness_token";
const USER_KEY = "busyness_user";
const BUSINESS_KEY = "busyness_business";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem(USER_KEY);
    return stored ? JSON.parse(stored) : null;
  });
  const [business, setBusiness] = useState(() => {
    const stored = localStorage.getItem(BUSINESS_KEY);
    return stored ? JSON.parse(stored) : null;
  });
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);

  // On mount: if token exists, verify and load businesses
  useEffect(() => {
    const init = async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const res = await api.get("/api/auth/me");
        setBusinesses(res.businesses || []);
        // Auto-select first business if none selected
        if (!business && res.businesses?.length > 0) {
          setBusiness(res.businesses[0]);
          localStorage.setItem(BUSINESS_KEY, JSON.stringify(res.businesses[0]));
        }
      } catch {
        // Token invalid/expired — clear everything
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(BUSINESS_KEY);
        setToken(null);
        setUser(null);
        setBusiness(null);
        setBusinesses([]);
      }
      setLoading(false);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api.post("/api/auth/login", { email, password });
    api.setToken(res.token);
    setToken(res.token);
    setUser(res.user);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));

    // Load businesses
    const me = await api.get("/api/auth/me");
    setBusinesses(me.businesses || []);
    if (me.businesses?.length > 0) {
      setBusiness(me.businesses[0]);
      localStorage.setItem(BUSINESS_KEY, JSON.stringify(me.businesses[0]));
    }
    return res;
  }, []);

  const register = useCallback(async (email, password, name, businessName) => {
    const res = await api.post("/api/auth/register", {
      email,
      password,
      name,
      business_name: businessName,
    });
    api.setToken(res.token);
    setToken(res.token);
    setUser(res.user);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setBusiness(res.business);
    localStorage.setItem(BUSINESS_KEY, JSON.stringify(res.business));
    setBusinesses([res.business]);
    return res;
  }, []);

  const logout = useCallback(() => {
    api.clearToken();
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(BUSINESS_KEY);
    setToken(null);
    setUser(null);
    setBusiness(null);
    setBusinesses([]);
  }, []);

  const switchBusiness = useCallback((biz) => {
    setBusiness(biz);
    localStorage.setItem(BUSINESS_KEY, JSON.stringify(biz));
  }, []);

  const value = {
    token,
    user,
    business,
    businesses,
    loading,
    login,
    register,
    logout,
    switchBusiness,
    isAuthenticated: !!token,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
