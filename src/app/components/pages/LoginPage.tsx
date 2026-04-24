import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../AuthContext";

export function LoginPage() {
  const auth = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as any)?.from || "/orders";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  const disabledReason = useMemo(() => {
    if (!supabase) return "Supabase не настроен";
    if (!email.trim()) return "Введите email";
    if (!password) return "Введите пароль";
    return "";
  }, [email, password]);

  const signIn = useCallback(async () => {
    if (!supabase) return;
    if (loading) return;
    setErr("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      nav(from, { replace: true });
    } catch (e: any) {
      setErr(e?.message || "Ошибка авторизации");
    } finally {
      setLoading(false);
    }
  }, [email, from, loading, nav, password]);

  useEffect(() => {
    if (auth.status === "signed_in") nav(from, { replace: true });
  }, [auth.status, from, nav]);

  if (auth.status === "signed_in") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400">
        Перенаправление…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Вход</h1>
        <p className="text-xs text-slate-500 mt-1">Войдите по email и паролю.</p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
              placeholder="name@company.com"
              autoComplete="email"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Пароль</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void signIn();
              }}
              type="password"
              className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>
        </div>

        {err && (
          <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {err}
          </div>
        )}

        <button
          onClick={() => void signIn()}
          disabled={!!disabledReason || loading}
          className={`mt-4 w-full px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 ${
            !!disabledReason || loading ? "bg-slate-200 text-slate-500 cursor-not-allowed" : "bg-slate-900 text-white hover:bg-slate-800"
          }`}
          title={disabledReason || undefined}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : null}
          Войти
        </button>
      </div>
    </div>
  );
}

