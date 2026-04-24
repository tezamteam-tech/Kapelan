import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "./AuthContext";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    if (auth.status === "signed_out") {
      nav("/login", { replace: true, state: { from: loc.pathname } });
    }
  }, [auth.status, loc.pathname, nav]);

  if (auth.status === "disabled") {
    return (
      <div className="min-h-[260px] flex items-center justify-center px-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Авторизация</p>
          <h2 className="mt-1 text-lg font-black text-slate-800">Supabase не настроен</h2>
          <p className="mt-2 text-sm text-slate-600">
            Укажи <span className="font-semibold">VITE_SUPABASE_URL</span> и <span className="font-semibold">VITE_SUPABASE_ANON_KEY</span> в окружении.
          </p>
        </div>
      </div>
    );
  }

  if (auth.status === "loading") {
    return (
      <div className="min-h-[220px] flex items-center justify-center text-slate-400">
        Загрузка…
      </div>
    );
  }

  if (auth.status !== "signed_in") return null;
  return <>{children}</>;
}

