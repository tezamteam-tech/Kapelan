import React, { Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { RootWrapper } from "./components/RootWrapper";
import { Layout } from "./components/Layout";

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

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootWrapper,
    children: [
      {
        path: "/",
        Component: Layout,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          {
            path: "dashboard",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/DashboardPage")).DashboardPage) }),
          },
          {
            path: "ai-chat",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/AIChatPage")).AIChatPage) }),
          },
          {
            path: "orders",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/OrdersPage")).OrdersPage) }),
          },
          // Order-first: legacy entry points redirect to Orders
          { path: "leads", element: <Navigate to="/orders" replace /> },
          { path: "install-orders", element: <Navigate to="/orders" replace /> },
          { path: "measurements", element: <Navigate to="/orders" replace /> },
          {
            path: "tasks",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/TasksPage")).TasksPage) }),
          },
          {
            path: "calendar",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/CalendarPage")).CalendarPage) }),
          },
          {
            path: "warehouse",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/WarehousePage")).WarehousePage) }),
          },
          {
            path: "procurement",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/ProcurementPage")).ProcurementPage) }),
          },
          {
            path: "documents",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/DocumentsPage")).DocumentsPage) }),
          },
          {
            path: "reminders",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/RemindersPage")).RemindersPage) }),
          },
          {
            path: "ventilation",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/VentilationPage")).VentilationPage) }),
          },
          {
            path: "training",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/TrainingPage")).TrainingPage) }),
          },
          {
            path: "users",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/UsersPage")).UsersPage) }),
          },
          {
            path: "settings",
            lazy: async () => ({ Component: withSuspense((await import("./components/pages/SettingsPage")).SettingsPage) }),
          },
          { path: "*", element: <Navigate to="/dashboard" replace /> },
        ],
      },
    ],
  },
]);
