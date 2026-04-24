import React from "react";
import { Navigate, useLocation } from "react-router";
import { useRole, type UserRole } from "./RoleContext";

function defaultRouteForRole(role: UserRole) {
  if (role === "admin") return "/dashboard";
  if (role === "manager") return "/orders";
  return "/tasks";
}

export function RoleGuard({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const { role, hasAccess } = useRole();
  const location = useLocation();

  if (hasAccess(roles)) return <>{children}</>;

  const fallback = defaultRouteForRole(role);
  return (
    <div className="h-full min-h-[280px] flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Доступ ограничен</p>
        <h2 className="mt-1 text-lg font-black text-slate-800">У вас нет прав на этот раздел</h2>
        <p className="mt-2 text-sm text-slate-600">
          Роль: <span className="font-semibold">{role}</span>
        </p>
        <p className="mt-1 text-xs text-slate-400 break-all">
          {location.pathname}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Navigate to={fallback} replace state={{ from: location.pathname }} />
        </div>
      </div>
    </div>
  );
}

