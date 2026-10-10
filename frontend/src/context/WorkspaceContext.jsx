/**
 * WorkspaceContext — workspace-level state that isn't tied to the backend:
 *   - storeName (display name, persisted locally)
 *   - ownerName (display name, persisted locally)
 *
 * The actual API business is managed by AuthContext (demo session).
 */

import { createContext, useContext, useState, useEffect, useCallback } from "react";

const Ctx = createContext(null);

const STORE_KEY = "busyness_store";
const OWNER_KEY = "busyness_owner";
const EVENT = "busyness-workspace-update";

function readInitial() {
  try {
    return {
      storeName: localStorage.getItem(STORE_KEY) || "",
      ownerName: localStorage.getItem(OWNER_KEY) || "",
    };
  } catch {
    return { storeName: "", ownerName: "" };
  }
}

export function WorkspaceProvider({ children }) {
  const [init] = useState(readInitial);
  const [storeName, setStoreNameState] = useState(init.storeName);
  const [ownerName, setOwnerNameState] = useState(init.ownerName);

  // Listen for cross-component updates (e.g. owner input in sidebar)
  useEffect(() => {
    const sync = () => {
      try {
        setStoreNameState(localStorage.getItem(STORE_KEY) || "");
        setOwnerNameState(localStorage.getItem(OWNER_KEY) || "");
      } catch {}
    };
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const setStoreName = useCallback((v) => {
    setStoreNameState(v);
    try {
      localStorage.setItem(STORE_KEY, v);
    } catch {}
  }, []);

  const setOwnerName = useCallback((v) => {
    setOwnerNameState(v);
    try {
      localStorage.setItem(OWNER_KEY, v);
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return (
    <Ctx.Provider value={{ storeName, setStoreName, ownerName, setOwnerName }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}