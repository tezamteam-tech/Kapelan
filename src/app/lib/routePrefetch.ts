type Prefetcher = () => Promise<unknown>;

// Optional data warmup (fills apiClient cache via getJson SWR).
// Kept lightweight; bootstrap covers the bulk of initial needs.
type DataPrefetcher = () => void;

const prefetchMap: Record<string, Prefetcher> = {
  "/dashboard": () => import("../components/pages/DashboardPage"),
  "/ai-chat": () => import("../components/pages/AIChatPage"),
  "/orders": () => import("../components/pages/OrdersPage"),
  "/tasks": () => import("../components/pages/TasksPage"),
  "/calendar": () => import("../components/pages/CalendarPage"),
  "/warehouse": () => import("../components/pages/WarehousePage"),
  "/procurement": () => import("../components/pages/ProcurementPage"),
  "/documents": () => import("../components/pages/DocumentsPage"),
  "/clients": () => import("../components/pages/ClientsPage"),
  "/reminders": () => import("../components/pages/RemindersPage"),
  "/ventilation": () => import("../components/pages/VentilationPage"),
  "/training": () => import("../components/pages/TrainingPage"),
  "/users": () => import("../components/pages/UsersPage"),
  "/settings": () => import("../components/pages/SettingsPage"),
  "/profile": () => import("../components/pages/ProfilePage"),
};

const dataPrefetchMap: Record<string, DataPrefetcher> = {};

export function prefetchRoute(path: string) {
  const key = Object.keys(prefetchMap).find((p) => path === p || path.startsWith(p + "/"));
  const fn = key ? prefetchMap[key] : undefined;
  if (!fn) return;
  void fn().catch(() => {});
  // Warm data cache if mapped
  const df = key ? dataPrefetchMap[key] : undefined;
  if (df) df();
}

