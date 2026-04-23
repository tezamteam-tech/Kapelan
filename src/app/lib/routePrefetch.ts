type Prefetcher = () => Promise<unknown>;

const prefetchMap: Record<string, Prefetcher> = {
  "/dashboard": () => import("../components/pages/DashboardPage"),
  "/ai-chat": () => import("../components/pages/AIChatPage"),
  "/orders": () => import("../components/pages/OrdersPage"),
  "/tasks": () => import("../components/pages/TasksPage"),
  "/calendar": () => import("../components/pages/CalendarPage"),
  "/warehouse": () => import("../components/pages/WarehousePage"),
  "/procurement": () => import("../components/pages/ProcurementPage"),
  "/documents": () => import("../components/pages/DocumentsPage"),
  "/reminders": () => import("../components/pages/RemindersPage"),
  "/ventilation": () => import("../components/pages/VentilationPage"),
  "/training": () => import("../components/pages/TrainingPage"),
  "/users": () => import("../components/pages/UsersPage"),
  "/settings": () => import("../components/pages/SettingsPage"),
};

export function prefetchRoute(path: string) {
  const key = Object.keys(prefetchMap).find((p) => path === p || path.startsWith(p + "/"));
  const fn = key ? prefetchMap[key] : undefined;
  if (!fn) return;
  void fn().catch(() => {});
}

