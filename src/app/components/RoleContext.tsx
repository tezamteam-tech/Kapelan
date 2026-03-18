import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

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
  const [role, setRoleState] = useState<UserRole>(() => {
    try {
      return (localStorage.getItem("kapelan_role") as UserRole) || "admin";
    } catch {
      return "admin";
    }
  });
  const [userName, setUserNameState] = useState(() => {
    try {
      return localStorage.getItem("kapelan_user_name") || "Администратор";
    } catch {
      return "Администратор";
    }
  });

  const setRole = useCallback((r: UserRole) => {
    setRoleState(r);
    try { localStorage.setItem("kapelan_role", r); } catch {}
  }, []);

  const setUserName = useCallback((n: string) => {
    setUserNameState(n);
    try { localStorage.setItem("kapelan_user_name", n); } catch {}
  }, []);

  const hasAccess = useCallback((requiredRoles: UserRole[]) => {
    if (role === "admin") return true;
    return requiredRoles.includes(role);
  }, [role]);

  return (
    <RoleContext.Provider value={{ role, setRole, userName, setUserName, hasAccess }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
