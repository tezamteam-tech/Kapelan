import { Outlet } from "react-router";
import { RoleProvider } from "./RoleContext";
import { CurrencyProvider } from "./CurrencyContext";
import { AuthProvider } from "./AuthContext";
import { useEffect, useMemo, useState } from "react";
import { useRole } from "./RoleContext";
import { API_BASE, getJson, primeJson } from "../lib/apiClient";
import { useCurrency } from "./CurrencyContext";

export function RootWrapper() {
  // Bootstrap prefetch: one request at app init to make navigation snappy.
  // We keep it in RootWrapper so it runs once after auth/role resolved.
  function Bootstrap() {
    const { role } = useRole();
    const { setCurrency, CURRENCIES } = useCurrency();
    const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const [hint, setHint] = useState<string>("Подготавливаем данные…");

    const showOverlay = useMemo(() => status === "loading", [status]);

    useEffect(() => {
      let alive = true;
      (async () => {
        try {
          setStatus("loading");
          setHint("Подготавливаем данные…");
          const data = await getJson<any>(`${API_BASE}/bootstrap?role=${encodeURIComponent(role)}`, { ttlMs: 30_000, staleTtlMs: 5 * 60_000, swr: true });
          if (!alive || !data) return;

          // Prime caches for common endpoints used across pages.
          if (data.company) primeJson(`${API_BASE}/company-config`, { config: data.company }, { ttlMs: 60_000, staleTtlMs: 10 * 60_000 });
          // Sync global currency from server company config (single source of truth)
          try {
            const cc = data?.company?.currency;
            const next =
              cc?.name ? (CURRENCIES.find((x) => x.name === cc.name) ?? cc) : null;
            if (next?.name && next?.symbol) setCurrency(next);
          } catch {
            // ignore
          }
          if (data.ordersLite) primeJson(`${API_BASE}/orders?lite=1`, data.ordersLite, { ttlMs: 30_000, staleTtlMs: 5 * 60_000 });
          if (data.equipment) primeJson(`${API_BASE}/equipment`, data.equipment, { ttlMs: 2 * 60_000, staleTtlMs: 10 * 60_000 });
          if (role === "admin" || role === "manager" || role === "installer") {
            if (data.warehouse) primeJson(`${API_BASE}/warehouse`, data.warehouse, { ttlMs: 60_000, staleTtlMs: 10 * 60_000 });
            if (data.purchaseOrders) primeJson(`${API_BASE}/purchase-orders`, data.purchaseOrders, { ttlMs: 60_000, staleTtlMs: 10 * 60_000 });
          }
          setStatus("ready");
        } catch {
          // ignore bootstrap errors; pages will load on demand
          if (!alive) return;
          setStatus("error");
          setHint("Не удалось заранее загрузить данные — продолжим по мере открытия разделов.");
          // Hide overlay quickly to not block the app
          setTimeout(() => {
            if (!alive) return;
            setStatus("ready");
          }, 600);
        }
      })();
      return () => {
        alive = false;
      };
    }, [role]);
    return showOverlay ? (
      <div className="fixed inset-0 z-[9999] bg-white/70 backdrop-blur-sm flex items-center justify-center">
        <div className="w-full max-w-md mx-6 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Инициализация</p>
          <h2 className="mt-1 text-lg font-black text-slate-800">Загружаем основные данные</h2>
          <p className="mt-2 text-sm text-slate-600">{hint}</p>
          <div className="mt-4 h-2 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full w-2/3 bg-blue-600 rounded-full animate-pulse" />
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Первая загрузка может занять чуть больше времени — дальше переходы по разделам будут быстрее.
          </p>
        </div>
      </div>
    ) : null;
  }

  return (
    <AuthProvider>
      <RoleProvider>
        <CurrencyProvider>
          <Bootstrap />
          <Outlet />
        </CurrencyProvider>
      </RoleProvider>
    </AuthProvider>
  );
}
