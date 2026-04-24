import React, { Suspense } from "react";
import { createHashRouter, Navigate } from "react-router";
import { RootWrapper } from "./components/RootWrapper";
import { Layout } from "./components/Layout";
import { RoleGuard } from "./components/RoleGuard";
import type { UserRole } from "./components/RoleContext";
import { RequireAuth } from "./components/RequireAuth";

function PageFallback() {
  return (
    <div className="h-full min-h-[240px] flex items-center justify-center text-slate-400">
      Загрузка…
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

// Hash router makes refresh/deep-links work on static hosting.
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
          // Order-first: legacy entry points redirect to Orders
          { path: "leads", element: <Navigate to="/orders" replace /> },
          { path: "install-orders", element: <Navigate to="/orders" replace /> },
          { path: "measurements", element: <Navigate to="/orders" replace /> },
          {
            path: "tasks",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/TasksPage")).TasksPage, ["admin", "installer"])) }),
          },
          {
            path: "calendar",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/CalendarPage")).CalendarPage, ["admin", "manager"])) }),
          },
          {
            path: "warehouse",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/WarehousePage")).WarehousePage, ["admin"])) }),
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
            path: "reminders",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/RemindersPage")).RemindersPage, ["admin", "manager"])) }),
          },
          {
            path: "ventilation",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/VentilationPage")).VentilationPage, ["admin", "manager", "installer"])) }),
          },
          {
            path: "training",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/TrainingPage")).TrainingPage, ["admin", "manager", "installer"])) }),
          },
          {
            path: "users",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/UsersPage")).UsersPage, ["admin"])) }),
          },
          {
            path: "clients",
            lazy: async () => ({ Component: withSuspense(withAccessGuard((await import("./components/pages/ClientsPage")).ClientsPage, ["admin", "manager"])) }),
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