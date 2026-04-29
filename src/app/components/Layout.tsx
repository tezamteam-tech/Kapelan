import { useCallback, useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router";
import { useRole, type UserRole } from "./RoleContext";
import { prefetchRoute } from "../lib/routePrefetch";
import {
  LayoutDashboard, MessageSquare, ClipboardList, Wrench, Package,
  Bell, Wind, GraduationCap, ShoppingCart, FileText, Settings,
  Users, ChevronLeft, ChevronRight, LogOut, Snowflake, Menu, X,
  CalendarDays, ClipboardCheck, Ruler
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { subscribeNetworkActivity } from "../lib/apiClient";

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
  { path: "/orders",         label: "Ордера",          icon: <ClipboardCheck size={20} />,  roles: ["admin", "manager"] },
  // Order-first: hide legacy modules from navigation
  { path: "/tasks",          label: "Мои задачи",      icon: <Wrench size={20} />,           roles: ["admin", "installer"] },
  { path: "/calendar",       label: "Календарь",       icon: <CalendarDays size={20} />,     roles: ["admin", "manager", "installer"] },
  { path: "/warehouse",      label: "Склад",           icon: <Package size={20} />,          roles: ["admin"] },
  { path: "/procurement",    label: "Закупки",         icon: <ShoppingCart size={20} />,      roles: ["admin"] },
  { path: "/documents",      label: "Документы",       icon: <FileText size={20} />,          roles: ["admin", "manager"] },
  { path: "/clients",        label: "Клиенты",         icon: <Users size={20} />,             roles: ["admin", "manager"] },
  { path: "/reminders",      label: "Напоминания ТО",  icon: <Bell size={20} />,              roles: ["admin", "manager"] },
  { path: "/ventilation",    label: "Вентиляция AI",   icon: <Wind size={20} />,              roles: ["admin", "manager"] },
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
  const { role, userName, hasAccess } = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatar, setAvatar] = useState<string>("");
  const [netBusy, setNetBusy] = useState(false);

  useEffect(() => {
    try {
      setAvatar(localStorage.getItem("kapelan_user_avatar") || "");
    } catch {
      setAvatar("");
    }
  }, [location.pathname]);

  useEffect(() => {
    let t: any = null;
    const unsub = subscribeNetworkActivity((count) => {
      // Avoid flicker for very fast requests
      if (count > 0) {
        if (t) return;
        t = setTimeout(() => {
          setNetBusy(true);
          t = null;
        }, 180);
        return;
      }
      if (t) {
        clearTimeout(t);
        t = null;
      }
      setNetBusy(false);
    });
    return () => {
      if (t) clearTimeout(t);
      unsub();
    };
  }, []);

  const visibleItems = NAV_ITEMS.filter(item => hasAccess(item.roles));

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + "/");

  const handleNav = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const signOut = useCallback(async () => {
    try {
      await supabase?.auth.signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  return (
    <div className="h-screen flex overflow-hidden bg-slate-50">
      {/* Global data loader (shows while API requests in-flight) */}
      <div
        className={[
          "fixed top-0 left-0 right-0 z-[9998] h-[3px] bg-transparent",
          netBusy ? "opacity-100" : "opacity-0 pointer-events-none",
          "transition-opacity duration-200",
        ].join(" ")}
      >
        <div className="h-full w-1/2 bg-blue-600 animate-pulse" />
      </div>

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
                onMouseEnter={() => prefetchRoute(item.path)}
                onFocus={() => prefetchRoute(item.path)}
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

        {/* Auth actions */}
        <div className={`border-t border-slate-200 p-3 flex-shrink-0 ${collapsed ? "px-2" : ""}`}>
          <button
            onClick={() => void signOut()}
            className={`w-full flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-bold ${
              collapsed ? "justify-center px-2 py-2" : "px-3 py-2"
            }`}
            title="Выйти"
          >
            <LogOut size={16} />
            {!collapsed ? "Выйти" : null}
          </button>

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
            <button
              onClick={() => navigate("/profile")}
              onMouseEnter={() => prefetchRoute("/profile")}
              onFocus={() => prefetchRoute("/profile")}
              className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-sm font-bold overflow-hidden"
              title="Профиль"
            >
              {avatar ? (
                <img src={avatar} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                userName.charAt(0).toUpperCase()
              )}
            </button>
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