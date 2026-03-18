import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router";
import { useRole, type UserRole } from "./RoleContext";
import {
  LayoutDashboard, MessageSquare, ClipboardList, Wrench, Package,
  Bell, Wind, GraduationCap, ShoppingCart, FileText, Settings,
  Users, ChevronLeft, ChevronRight, LogOut, Snowflake, Menu, X,
  CalendarDays, ClipboardCheck
} from "lucide-react";

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  roles: UserRole[]; // who can see
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/dashboard",      label: "Дашборд",         icon: <LayoutDashboard size={20} />, roles: ["admin"] },
  { path: "/ai-chat",        label: "AI Менеджер",     icon: <MessageSquare size={20} />,   roles: ["admin", "manager"] },
  { path: "/leads",          label: "Заявки",          icon: <ClipboardList size={20} />,    roles: ["admin", "manager"] },
  { path: "/install-orders", label: "Ордера монтажа",  icon: <ClipboardCheck size={20} />,  roles: ["admin", "manager", "installer"] },
  { path: "/tasks",          label: "Мои задачи",      icon: <Wrench size={20} />,           roles: ["admin", "installer"] },
  { path: "/calendar",       label: "Календарь",       icon: <CalendarDays size={20} />,     roles: ["admin", "manager"] },
  { path: "/warehouse",      label: "Склад",           icon: <Package size={20} />,          roles: ["admin"] },
  { path: "/procurement",    label: "Закупки",         icon: <ShoppingCart size={20} />,      roles: ["admin"] },
  { path: "/documents",      label: "Документы",       icon: <FileText size={20} />,          roles: ["admin", "manager"] },
  { path: "/reminders",      label: "Напоминания ТО",  icon: <Bell size={20} />,              roles: ["admin", "manager"] },
  { path: "/ventilation",    label: "Вентиляция AI",   icon: <Wind size={20} />,              roles: ["admin", "manager", "installer"] },
  { path: "/training",       label: "Обучение",        icon: <GraduationCap size={20} />,     roles: ["admin", "manager", "installer"] },
  { path: "/users",          label: "Пользователи",    icon: <Users size={20} />,             roles: ["admin"] },
  { path: "/settings",       label: "Настройки",       icon: <Settings size={20} />,           roles: ["admin"] },
];

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  installer: "Монтажник",
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: "bg-purple-100 text-purple-700",
  manager: "bg-blue-100 text-blue-700",
  installer: "bg-amber-100 text-amber-700",
};

export function Layout() {
  const { role, setRole, userName, hasAccess } = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = NAV_ITEMS.filter(item => hasAccess(item.roles));

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + "/");

  const handleNav = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
    <div className="h-screen flex overflow-hidden bg-slate-50">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        flex flex-col bg-white border-r border-slate-200 transition-all duration-300 z-50 flex-shrink-0
        ${collapsed ? "w-[68px]" : "w-64"}
        fixed lg:relative inset-y-0 left-0
        ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        {/* Logo */}
        <div className={`flex items-center gap-3 px-4 h-16 border-b border-slate-200 flex-shrink-0 ${collapsed ? "justify-center" : ""}`}>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center flex-shrink-0">
            <Snowflake size={20} className="text-white" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">Kapelan CRM</p>
              <p className="text-[10px] text-slate-400">Кондиционирование</p>
            </div>
          )}
          {/* Close on mobile */}
          <button onClick={() => setMobileOpen(false)} className="ml-auto lg:hidden text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {visibleItems.map(item => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => handleNav(item.path)}
                title={collapsed ? item.label : undefined}
                className={`
                  w-full flex items-center gap-3 rounded-xl transition-all text-sm
                  ${collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"}
                  ${active
                    ? "bg-blue-50 text-blue-700 font-semibold shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
                  }
                `}
              >
                <span className={`flex-shrink-0 ${active ? "text-blue-600" : "text-slate-400"}`}>
                  {item.icon}
                </span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Role switcher */}
        <div className={`border-t border-slate-200 p-3 flex-shrink-0 ${collapsed ? "px-2" : ""}`}>
          {!collapsed && (
            <div className="mb-2">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1.5 px-1">Роль</p>
              <div className="flex gap-1">
                {(["admin", "manager", "installer"] as UserRole[]).map(r => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    className={`flex-1 text-[10px] py-1.5 rounded-lg font-semibold transition-all ${
                      role === r ? ROLE_COLORS[r] : "text-slate-400 hover:bg-slate-100"
                    }`}
                  >
                    {r === "admin" ? "Админ" : r === "manager" ? "Менеджер" : "Монтажник"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="hidden lg:flex w-full items-center justify-center gap-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg py-2 text-xs transition-all"
          >
            {collapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /><span>Свернуть</span></>}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden text-slate-600 hover:text-slate-800">
              <Menu size={22} />
            </button>
            <div>
              <h1 className="text-lg font-bold text-slate-800 leading-tight">
                {visibleItems.find(i => isActive(i.path))?.label || "Kapelan CRM"}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ROLE_COLORS[role]}`}>
              {ROLE_LABELS[role]}
            </span>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-sm font-bold">
              {userName.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}