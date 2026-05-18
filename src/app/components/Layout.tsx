import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Package,
  Settings,
  ShoppingCart,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { subscribeNetworkActivity } from "../lib/apiClient";
import { prefetchRoute } from "../lib/routePrefetch";
import { useRole, type UserRole } from "./RoleContext";

interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { path: "/dashboard", label: "Панель", icon: <LayoutDashboard size={20} />, roles: ["admin"] },
  { path: "/ai-chat", label: "Оконный AI", icon: <MessageSquare size={20} />, roles: ["admin", "manager"] },
  { path: "/orders", label: "Заказы и КП", icon: <ClipboardCheck size={20} />, roles: ["admin", "manager"] },
  { path: "/tasks", label: "Монтажи", icon: <Wrench size={20} />, roles: ["admin", "installer"] },
  { path: "/calendar", label: "Календарь", icon: <CalendarDays size={20} />, roles: ["admin", "manager", "installer"] },
  { path: "/warehouse", label: "Склад", icon: <Package size={20} />, roles: ["admin"] },
  { path: "/procurement", label: "Закупки", icon: <ShoppingCart size={20} />, roles: ["admin"] },
  { path: "/documents", label: "Документы", icon: <FileText size={20} />, roles: ["admin", "manager"] },
  { path: "/clients", label: "Клиенты", icon: <Users size={20} />, roles: ["admin", "manager"] },
  { path: "/users", label: "Команда", icon: <Users size={20} />, roles: ["admin"] },
  { path: "/settings", label: "Настройки", icon: <Settings size={20} />, roles: ["admin"] },
];

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  installer: "Монтажник",
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: "bg-slate-900 text-white",
  manager: "bg-blue-100 text-blue-700",
  installer: "bg-emerald-100 text-emerald-700",
};

export function Layout() {
  const { role, userName, hasAccess } = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatar, setAvatar] = useState("");
  const [netBusy, setNetBusy] = useState(false);

  useEffect(() => {
    try {
      setAvatar(localStorage.getItem("kapelan_user_avatar") || "");
    } catch {
      setAvatar("");
    }
  }, [location.pathname]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeNetworkActivity((count) => {
      if (count > 0) {
        if (timer) return;
        timer = setTimeout(() => {
          setNetBusy(true);
          timer = null;
        }, 180);
        return;
      }
      if (timer) clearTimeout(timer);
      timer = null;
      setNetBusy(false);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);

  const visibleItems = NAV_ITEMS.filter((item) => hasAccess(item.roles));
  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);

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
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <div className={`fixed left-0 right-0 top-0 z-[9998] h-[3px] transition-opacity duration-200 ${netBusy ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <div className="h-full w-1/2 animate-pulse bg-blue-600" />
      </div>

      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-slate-200 bg-white transition-all duration-300 lg:relative lg:translate-x-0",
          collapsed ? "w-[68px]" : "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className={`flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 px-4 ${collapsed ? "justify-center" : ""}`}>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
            <ClipboardList size={20} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-900">Window CRM</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Окна · двери · балконы</p>
            </div>
          )}
          <button onClick={() => setMobileOpen(false)} className="ml-auto text-slate-400 hover:text-slate-600 lg:hidden">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {visibleItems.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => handleNav(item.path)}
                onMouseEnter={() => prefetchRoute(item.path)}
                onFocus={() => prefetchRoute(item.path)}
                title={collapsed ? item.label : undefined}
                className={[
                  "flex w-full items-center gap-3 rounded-lg text-sm transition-all",
                  collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5",
                  active ? "bg-blue-50 font-bold text-blue-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                ].join(" ")}
              >
                <span className={active ? "text-blue-600" : "text-slate-400"}>{item.icon}</span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className={`shrink-0 border-t border-slate-200 p-3 ${collapsed ? "px-2" : ""}`}>
          <button
            onClick={() => void signOut()}
            className={`flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 ${collapsed ? "justify-center px-2 py-2" : "px-3 py-2"}`}
            title="Выйти"
          >
            <LogOut size={16} />
            {!collapsed && "Выйти"}
          </button>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="hidden w-full items-center justify-center gap-2 rounded-lg py-2 text-xs text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600 lg:flex"
          >
            {collapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /><span>Свернуть</span></>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="text-slate-600 hover:text-slate-900 lg:hidden">
              <Menu size={22} />
            </button>
            <h1 className="text-lg font-black leading-tight text-slate-900">
              {visibleItems.find((item) => isActive(item.path))?.label || "Window CRM"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${ROLE_COLORS[role]}`}>{ROLE_LABELS[role]}</span>
            <button
              onClick={() => navigate("/profile")}
              onMouseEnter={() => prefetchRoute("/profile")}
              onFocus={() => prefetchRoute("/profile")}
              className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-blue-600 text-sm font-black text-white"
              title="Профиль"
            >
              {avatar ? <img src={avatar} alt="avatar" className="size-full object-cover" /> : userName.charAt(0).toUpperCase()}
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
