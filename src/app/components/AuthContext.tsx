import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";

type AuthState =
  | { status: "disabled"; user: null; session: null }
  | { status: "loading"; user: null; session: null }
  | { status: "signed_out"; user: null; session: null }
  | { status: "signed_in"; user: User; session: Session };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => (supabase ? { status: "loading", user: null, session: null } : { status: "disabled", user: null, session: null }));

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const s = data.session;
      if (s?.user) setState({ status: "signed_in", user: s.user, session: s });
      else setState({ status: "signed_out", user: null, session: null });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!alive) return;
      if (session?.user) setState({ status: "signed_in", user: session.user, session });
      else setState({ status: "signed_out", user: null, session: null });
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

