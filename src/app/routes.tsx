import React, { Suspense } from "react";
import { createHashRouter, Navigate } from "react-router";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { RoleGuard } from "./components/RoleGuard";
import { RootWrapper } from "./components/RootWrapper";
import type { UserRole } from "./components/RoleContext";

function PageFallback() {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center text-slate-400">
      Загрузка...
    </div>
  );
}

function withSuspense(C: React.ComponentType) {
  return function SuspendedPage() {
    return (
      <Suspense fallback={<PageFallback />}>
        <C />
      </Suspense>
    );
  };
}

function withAccessGuard(C: React.ComponentType, roles: UserRole[]) {
  return function GuardedPage() {
    return (
      <RoleGuard roles={roles}>
        <C />
      </RoleGuard>
    );
  };
}

export const router = createHashRouter([
  {
    path: "/",
    Component: RootWrapper,
    children: [
      {
        path: "login",
        lazy: async () => ({ Component: withSuspense((await import("./components/pages/LoginPage")).LoginPage) }),
      },
      {
        path: "/",
        Component: () => (
          <RequireAuth>
            <Layout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          {
            path: "dashboard",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/DashboardPage")).DashboardPage, ["admin"])) }),
          },
          {
            path: "ai-chat",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/AIChatPage")).AIChatPage, ["admin", "manager"])) }),
          },
          {
            path: "orders",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/OrdersPage")).OrdersPage, ["admin", "manager"])) }),
          },
          { path: "leads", element: <Navigate to="/orders" replace /> },
          { path: "install-orders", element: <Navigate to="/orders" replace /> },
          { path: "measurements", element: <Navigate to="/orders" replace /> },
          {
            path: "tasks",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/TasksPage")).TasksPage, ["admin", "manager", "installer"])) }),
          },
          {
            path: "calendar",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/CalendarPage")).CalendarPage, ["admin", "manager", "installer"])) }),
          },
          {
            path: "warehouse",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/WarehousePage")).WarehousePage, ["admin", "manager", "installer"])) }),
          },
          {
            path: "procurement",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/ProcurementPage")).ProcurementPage, ["admin"])) }),
          },
          {
            path: "documents",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/DocumentsPage")).DocumentsPage, ["admin", "manager"])) }),
          },
          {
            path: "clients",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/ClientsPage")).ClientsPage, ["admin", "manager"])) }),
          },
          {
            path: "users",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/UsersPage")).UsersPage, ["admin"])) }),
          },
          {
            path: "settings",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/SettingsPage")).SettingsPage, ["admin"])) }),
          },
          {
            path: "profile",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/ProfilePage")).ProfilePage) }),
          },
          { path: "*", element: <Navigate to="/dashboard" replace /> },
        ],
      },
    ],
  },
]);
