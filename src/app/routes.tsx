import { createBrowserRouter, Navigate } from "react-router";
import { RootWrapper } from "./components/RootWrapper";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./components/pages/DashboardPage";
import { AIChatPage } from "./components/pages/AIChatPage";
import { LeadsPage } from "./components/pages/LeadsPage";
import { TasksPage } from "./components/pages/TasksPage";
import { WarehousePage } from "./components/pages/WarehousePage";
import { ProcurementPage } from "./components/pages/ProcurementPage";
import { RemindersPage } from "./components/pages/RemindersPage";
import { VentilationPage } from "./components/pages/VentilationPage";
import { TrainingPage } from "./components/pages/TrainingPage";
import { DocumentsPage } from "./components/pages/DocumentsPage";
import { UsersPage } from "./components/pages/UsersPage";
import { SettingsPage } from "./components/pages/SettingsPage";
import { CalendarPage } from "./components/pages/CalendarPage";
import { InstallOrdersPage } from "./components/pages/InstallOrdersPage";
import { MeasurementOrdersPage } from "./components/pages/MeasurementOrdersPage";

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
          { path: "dashboard", Component: DashboardPage },
          { path: "ai-chat", Component: AIChatPage },
          { path: "leads", Component: LeadsPage },
          { path: "install-orders", Component: InstallOrdersPage },
          { path: "measurements", Component: MeasurementOrdersPage },
          { path: "tasks", Component: TasksPage },
          { path: "calendar", Component: CalendarPage },
          { path: "warehouse", Component: WarehousePage },
          { path: "procurement", Component: ProcurementPage },
          { path: "documents", Component: DocumentsPage },
          { path: "reminders", Component: RemindersPage },
          { path: "ventilation", Component: VentilationPage },
          { path: "training", Component: TrainingPage },
          { path: "users", Component: UsersPage },
          { path: "settings", Component: SettingsPage },
          { path: "*", element: <Navigate to="/dashboard" replace /> },
        ],
      },
    ],
  },
]);