import { createContext, useContext, useMemo, useCallback, type ReactNode } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "./AuthContext";

export type UserRole = "admin" | "manager" | "installer";

interface RoleContextType {
  role: UserRole;
  setRole: (role: UserRole) => void;
  userName: string;
  setUserName: (name: string) => void;
  hasAccess: (requiredRoles: UserRole[]) => boolean;
}

const RoleContext = createContext<RoleContextType | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();

  const role: UserRole = useMemo(() => {
    if (auth.status === "signed_in") {
      const r = String((auth.user.user_metadata as any)?.role ?? "");
      if (r === "admin" || r === "manager" || r === "installer") return r;
      return "manager";
    }
    // fallback (dev/offline)
    try {
      const r = localStorage.getItem("kapelan_role") as UserRole | null;
      return r || "admin";
    } catch {
      return "admin";
    }
  }, [auth]);

  const userName = useMemo(() => {
    if (auth.status === "signed_in") {
      const n = String((auth.user.user_metadata as any)?.name ?? "");
      return n || auth.user.email || "Пользователь";
    }
    try {
      return localStorage.getItem("kapelan_user_name") || "Администратор";
    } catch {
      return "Администратор";
    }
  }, [auth]);

  const setRole = useCallback((r: UserRole) => {
    // For security: role is defined by auth (user_metadata.role).
    // Keep localStorage fallback for demo mode (no Supabase).
    if (auth.status === "signed_in") return;
    try {
      localStorage.setItem("kapelan_role", r);
    } catch {}
  }, [auth.status]);

  const setUserName = useCallback((n: string) => {
    if (auth.status === "signed_in") {
      if (!supabase) return;
      void supabase.auth.updateUser({ data: { ...(auth.user.user_metadata as any), name: n } });
      return;
    }
    try {
      localStorage.setItem("kapelan_user_name", n);
    } catch {}
  }, [auth]);

  const hasAccess = useCallback((requiredRoles: UserRole[]) => {
    if (role === "admin") return true;
    return requiredRoles.includes(role);
  }, [role]);

  const value = useMemo(() => ({ role, setRole, userName, setUserName, hasAccess }), [hasAccess, role, setRole, setUserName, userName]);
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
