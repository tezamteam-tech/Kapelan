import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { projectId, publicAnonKey } from "../../../../utils/supabase/info";
import { getJson } from "../../lib/apiClient";
import { useRole } from "../RoleContext";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeft, ChevronRight, Loader2, Calendar as CalendarIcon,
  User, Phone, Clock, Wrench, AlertCircle, Filter,
  ChevronDown, ChevronUp, GripVertical, CheckCircle2, PlayCircle,
  XCircle, ArrowRightCircle, Undo2, Pencil, Check, X,
  ListChecks, MessageSquare, CalendarDays, Printer
} from "lucide-react";

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

interface Assignment {
  id: string;
  leadId: string;
  installerId: string;
  installerName: string;
  clientName: string;
  clientPhone: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  notes: string;
  status: string;
  createdAt: string;
}

interface Installer {
  id: string;
  name: string;
  phone: string;
  tgChatId: string | null;
  specialization: string;
  teamId?: string | null;
  teamName?: string | null;
  isTeamLead?: boolean;
  active?: boolean;
}

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; dot: string; icon: typeof CheckCircle2 }> = {
  assigned:     { label: "Назначен",   bg: "bg-blue-100",   text: "text-blue-700",   dot: "bg-blue-500",   icon: ArrowRightCircle },
  in_progress:  { label: "В работе",   bg: "bg-amber-100",  text: "text-amber-700",  dot: "bg-amber-500",  icon: PlayCircle },
  completed:    { label: "Выполнен",   bg: "bg-green-100",  text: "text-green-700",  dot: "bg-green-500",  icon: CheckCircle2 },
  cancelled:    { label: "Отменён",    bg: "bg-red-100",    text: "text-red-700",    dot: "bg-red-500",    icon: XCircle },
};

const STATUS_TRANSITIONS: Record<string, string[]> = {
  assigned:    ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed:   ["assigned"],
  cancelled:   ["assigned"],
};

const DAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
];

const INSTALLER_COLORS = [
  { bg: "bg-blue-100", border: "border-blue-400", text: "text-blue-700", dot: "bg-blue-500" },
  { bg: "bg-emerald-100", border: "border-emerald-400", text: "text-emerald-700", dot: "bg-emerald-500" },
  { bg: "bg-violet-100", border: "border-violet-400", text: "text-violet-700", dot: "bg-violet-500" },
  { bg: "bg-amber-100", border: "border-amber-400", text: "text-amber-700", dot: "bg-amber-500" },
  { bg: "bg-rose-100", border: "border-rose-400", text: "text-rose-700", dot: "bg-rose-500" },
  { bg: "bg-cyan-100", border: "border-cyan-400", text: "text-cyan-700", dot: "bg-cyan-500" },
  { bg: "bg-orange-100", border: "border-orange-400", text: "text-orange-700", dot: "bg-orange-500" },
  { bg: "bg-indigo-100", border: "border-indigo-400", text: "text-indigo-700", dot: "bg-indigo-500" },
];

type ViewMode = "month" | "week";

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState<{
    message: string;
    success: boolean;
    action?: { label: string; onClick: () => void };
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  const show = useCallback((
    message: string,
    success = true,
    action?: { label: string; onClick: () => void },
    duration = 4000
  ) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, success, action });
    timerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  const el = (
    <AnimatePresence>
      {toast && (
        <motion.div
          key="toast-msg"
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold text-white flex items-center gap-3 max-w-sm ${toast.success ? "bg-green-600" : "bg-red-600"}`}
        >
          <span className="flex-1">{toast.message}</span>
          {toast.action && (
            <button
              onClick={() => { toast.action!.onClick(); hide(); }}
              className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap"
            >
              <Undo2 className="size-3.5" />
              {toast.action.label}
            </button>
          )}
          <button onClick={hide} className="opacity-60 hover:opacity-100 transition-opacity ml-1">
            <X className="size-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return { show, el };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function CalendarPage() {
  const { role, userName } = useRole();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [installers, setInstallers] = useState<Installer[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [filterInstaller, setFilterInstaller] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [expandedAssignment, setExpandedAssignment] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<{ ids: string[]; status: string } | null>(null);
  const [bulkDateTransfer, setBulkDateTransfer] = useState<{ ids: string[]; fromDate: string; targetDate: string } | null>(null);
  const { show: showToast, el: toastEl } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aData, iData] = await Promise.all([
        getJson<any>(`${API_BASE}/assignments`, { ttlMs: 30_000, staleTtlMs: 10 * 60_000, swr: true }),
        getJson<any>(`${API_BASE}/installers`, { ttlMs: 5 * 60_000, staleTtlMs: 30 * 60_000, swr: true }),
      ]);
      if (aData.assignments) setAssignments(aData.assignments);
      if (iData.installers) setInstallers(iData.installers);
    } catch (err) {
      console.error("Calendar load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isInstallerRole = role === "installer";

  const me = useMemo(() => {
    const name = String(userName || "").trim().toLowerCase();
    if (!name) return null;
    return installers.find(i => String(i.name || "").trim().toLowerCase() === name) ?? null;
  }, [installers, userName]);

  const scopeInstallerIds = useMemo(() => {
    if (!me) return new Set<string>();
    if (me.isTeamLead && me.teamId) {
      const ids = installers
        .filter(i => (i.teamId || null) === me.teamId && (i.active ?? true) !== false)
        .map(i => i.id);
      return new Set(ids);
    }
    return new Set([me.id]);
  }, [installers, me]);

  const scopedAssignments = useMemo(() => {
    if (!isInstallerRole) return assignments;
    if (!me) return [];
    return assignments.filter(a => scopeInstallerIds.has(a.installerId));
  }, [assignments, isInstallerRole, me, scopeInstallerIds]);

  const canDrag = !isInstallerRole;

  // ─── Update assignment (date or status) ─────────────────────────────────────
  const updateAssignment = useCallback(async (id: string, patch: Record<string, any>) => {
    setUpdatingId(id);
    try {
      const res = await fetch(`${API_BASE}/assignments/${id}`, {
        method: "PATCH",
        headers: JH,
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.assignment) {
        setAssignments(prev => prev.map(a => a.id === id ? { ...a, ...data.assignment } : a));
        return data.assignment;
      } else {
        console.error("Update error:", data.error);
        showToast(data.error || "Ошибка обновления", false);
      }
    } catch (err: any) {
      console.error("Update error:", err);
      showToast(`Ошибка: ${err.message}`, false);
    } finally {
      setUpdatingId(null);
    }
  }, [showToast]);

  // ─── Drag & Drop handlers ──────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, assignment: Assignment) => {
    e.dataTransfer.setData("assignmentId", assignment.id);
    e.dataTransfer.effectAllowed = "move";
    // Ghost image
    const ghost = e.currentTarget.cloneNode(true) as HTMLElement;
    ghost.style.position = "absolute";
    ghost.style.top = "-1000px";
    ghost.style.width = "180px";
    ghost.style.opacity = "0.9";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 90, 20);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    setDragOverDate(null);
    const assignmentId = e.dataTransfer.getData("assignmentId");
    if (!assignmentId) return;
    const assignment = assignments.find(a => a.id === assignmentId);
    if (!assignment || assignment.scheduledDate === targetDate) return;

    const oldDate = assignment.scheduledDate;
    // Optimistic update
    setAssignments(prev => prev.map(a => a.id === assignmentId ? { ...a, scheduledDate: targetDate } : a));
    const result = await updateAssignment(assignmentId, { scheduledDate: targetDate });
    if (!result) {
      // Rollback
      setAssignments(prev => prev.map(a => a.id === assignmentId ? { ...a, scheduledDate: oldDate } : a));
    } else {
      const d = new Date(targetDate + "T00:00:00");
      showToast(`Перенесено на ${d.getDate()} ${MONTHS_RU[d.getMonth()]}`);
    }
  }, [assignments, updateAssignment, showToast]);

  const handleDragOver = useCallback((e: React.DragEvent, dateKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverDate(dateKey);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverDate(null);
  }, []);

  // ─── Revert assignments (undo helper) ──────────────────────────────────────
  const revertAssignments = useCallback(async (snapshots: Array<{ id: string; patch: Record<string, any> }>) => {
    setBulkUpdating(true);
    let successCount = 0;
    for (const { id, patch } of snapshots) {
      try {
        const res = await fetch(`${API_BASE}/assignments/${id}`, {
          method: "PATCH",
          headers: JH,
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (data.assignment) {
          setAssignments(prev => prev.map(a => a.id === id ? { ...a, ...data.assignment } : a));
          successCount++;
        }
      } catch (err) {
        console.error(`Revert error for ${id}:`, err);
      }
    }
    setBulkUpdating(false);
    showToast(`Отменено: восстановлено ${successCount} из ${snapshots.length}`);
  }, [showToast]);

  // ─── Status change ─────────────────────────────────────────────────────────
  const changeStatus = useCallback(async (id: string, newStatus: string) => {
    const result = await updateAssignment(id, { status: newStatus });
    if (result) {
      const cfg = STATUS_CFG[newStatus];
      showToast(`Статус: ${cfg?.label || newStatus}`);
    }
  }, [updateAssignment, showToast]);

  // ─── Time change ───────────────────────────────────────────────────────────
  const changeTime = useCallback(async (id: string, newTime: string) => {
    const result = await updateAssignment(id, { scheduledTime: newTime || null });
    if (result) {
      showToast(`Время: ${newTime || "не указано"}`);
    }
  }, [updateAssignment, showToast]);

  // ─── Notes change ──────────────────────────────────────────────────────────
  const changeNotes = useCallback(async (id: string, newNotes: string) => {
    const result = await updateAssignment(id, { notes: newNotes });
    if (result) {
      showToast("Заметка сохранена");
    }
  }, [updateAssignment, showToast]);

  // ─── Date change ───────────────────────────────────────────────────────────
  const changeDate = useCallback(async (id: string, newDate: string) => {
    const old = assignments.find(a => a.id === id)?.scheduledDate;
    setAssignments(prev => prev.map(a => a.id === id ? { ...a, scheduledDate: newDate } : a));
    const result = await updateAssignment(id, { scheduledDate: newDate || null });
    if (!result) {
      setAssignments(prev => prev.map(a => a.id === id ? { ...a, scheduledDate: old ?? null } : a));
    } else {
      const d = new Date(newDate + "T00:00:00");
      showToast(`Дата: ${d.getDate()} ${MONTHS_RU[d.getMonth()]}`);
    }
  }, [assignments, updateAssignment, showToast]);

  // ─── Bulk status change ────────────────────────────────────────────────────
  const bulkChangeStatus = useCallback(async (ids: string[], newStatus: string) => {
    // Сохраняем снимок старых статусов для отмены
    const snapshots = ids.map(id => {
      const a = assignments.find(x => x.id === id);
      return { id, patch: { status: a?.status || "assigned" } };
    });

    setBulkUpdating(true);
    let successCount = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`${API_BASE}/assignments/${id}`, {
          method: "PATCH",
          headers: JH,
          body: JSON.stringify({ status: newStatus }),
        });
        const data = await res.json();
        if (data.assignment) {
          setAssignments(prev => prev.map(a => a.id === id ? { ...a, ...data.assignment } : a));
          successCount++;
        }
      } catch (err) {
        console.error(`Bulk update error for ${id}:`, err);
      }
    }
    setBulkUpdating(false);
    const cfg = STATUS_CFG[newStatus];
    showToast(
      `${successCount} из ${ids.length} → ${cfg?.label || newStatus}`,
      true,
      { label: "Отменить", onClick: () => revertAssignments(snapshots) },
      8000
    );
  }, [assignments, showToast, revertAssignments]);

  // ─── Bulk date transfer ────────────────────────────────────────────────────
  const bulkTransferDate = useCallback(async (ids: string[], targetDate: string) => {
    // Сохраняем снимок старых дат для отмены
    const snapshots = ids.map(id => {
      const a = assignments.find(x => x.id === id);
      return { id, patch: { scheduledDate: a?.scheduledDate ?? null } };
    });

    setBulkUpdating(true);
    let successCount = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`${API_BASE}/assignments/${id}`, {
          method: "PATCH",
          headers: JH,
          body: JSON.stringify({ scheduledDate: targetDate }),
        });
        const data = await res.json();
        if (data.assignment) {
          setAssignments(prev => prev.map(a => a.id === id ? { ...a, ...data.assignment } : a));
          successCount++;
        }
      } catch (err) {
        console.error(`Bulk update error for ${id}:`, err);
      }
    }
    setBulkUpdating(false);
    const d = new Date(targetDate + "T00:00:00");
    showToast(
      `${successCount} из ${ids.length} → ${d.getDate()} ${MONTHS_RU[d.getMonth()]}`,
      true,
      { label: "Отменить", onClick: () => revertAssignments(snapshots) },
      8000
    );
  }, [assignments, showToast, revertAssignments]);

  // ─── Print day schedule ────────────────────────────────────────────────────
  const printDaySchedule = useCallback((date: string, items: Assignment[]) => {
    const d = new Date(date + "T00:00:00");
    const dateLabel = `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
    const dayName = ["Воскресенье","Понедельник","Вторник","Среда","Четверг","Пятница","Суббота"][d.getDay()];

    const rows = items.map((a, i) => {
      const statusLabel = STATUS_CFG[a.status]?.label || a.status;
      const statusColor: Record<string, string> = {
        assigned: "#3b82f6", in_progress: "#f59e0b", completed: "#22c55e", cancelled: "#ef4444"
      };
      const sc = statusColor[a.status] || "#94a3b8";
      return `
        <tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"}">
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#374151;white-space:nowrap">${a.scheduledTime || "—"}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0">
            <div style="font-weight:600;color:#1e293b">${a.clientName}</div>
            <div style="color:#64748b;font-size:11px;margin-top:2px">${a.clientPhone}</div>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#374151">${a.installerName}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0">
            <span style="background:${sc}22;color:${sc};font-weight:700;padding:3px 10px;border-radius:999px;font-size:11px;white-space:nowrap">${statusLabel}</span>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:12px">${a.notes || "—"}</td>
        </tr>
      `;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Расписание: ${dateLabel}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Arial, sans-serif; font-size: 13px; color: #1e293b; padding: 32px; background: #fff; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 28px; border-bottom: 3px solid #1e40af; padding-bottom: 16px; }
    .brand { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px; }
    h1 { font-size: 22px; font-weight: 800; color: #1e293b; }
    .subtitle { font-size: 13px; color: #64748b; margin-top: 3px; }
    .count-badge { background: #eff6ff; color: #1e40af; font-weight: 700; padding: 6px 16px; border-radius: 999px; font-size: 14px; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #1e40af; color: white; }
    th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
    .footer { margin-top: 24px; display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
    @media print {
      body { padding: 16px; }
      @page { margin: 1.5cm; size: A4 landscape; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">CRM — Расписание монтажей</div>
      <h1>${dayName}, ${dateLabel}</h1>
      <div class="subtitle">${items.length} назначений на день</div>
    </div>
    <span class="count-badge">${items.length} записей</span>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:80px">Время</th>
        <th>Клиент / Телефон</th>
        <th style="width:170px">Монтажник</th>
        <th style="width:130px">Статус</th>
        <th>Заметки</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    <span>Распечатано: ${new Date().toLocaleString("ru-RU")}</span>
    <span>CRM Кондиционеры</span>
  </div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=960,height=680");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }, []);

  // ─── Computed data ─────────────────────────────────────────────────────────
  const installerColorMap = useMemo(() => {
    const map: Record<string, typeof INSTALLER_COLORS[0]> = {};
    installers.forEach((inst, idx) => {
      map[inst.id] = INSTALLER_COLORS[idx % INSTALLER_COLORS.length];
    });
    return map;
  }, [installers]);

  const byDate = useMemo(() => {
    const map: Record<string, Assignment[]> = {};
    for (const a of scopedAssignments) {
      if (!a.scheduledDate) continue;
      if (filterInstaller !== "all" && a.installerId !== filterInstaller) continue;
      if (filterStatus !== "all" && a.status !== filterStatus) continue;
      if (!map[a.scheduledDate]) map[a.scheduledDate] = [];
      map[a.scheduledDate].push(a);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (a.scheduledTime || "").localeCompare(b.scheduledTime || ""));
    }
    return map;
  }, [scopedAssignments, filterInstaller, filterStatus]);

  const unscheduled = useMemo(() => {
    return scopedAssignments.filter(a => !a.scheduledDate && (filterInstaller === "all" || a.installerId === filterInstaller) && (filterStatus === "all" || a.status === filterStatus));
  }, [scopedAssignments, filterInstaller, filterStatus]);

  const monthGrid = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let startWeekday = firstDay.getDay() - 1;
    if (startWeekday < 0) startWeekday = 6;
    const days: { date: Date; inMonth: boolean }[] = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
      days.push({ date: new Date(year, month, -i), inMonth: false });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({ date: new Date(year, month, d), inMonth: true });
    }
    while (days.length < 42) {
      const d = new Date(year, month + 1, days.length - lastDay.getDate() - startWeekday + 1);
      days.push({ date: d, inMonth: false });
    }
    return days;
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const monday = getMonday(currentDate);
    return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  }, [currentDate]);

  const today = formatDate(new Date());

  const navigate = (dir: number) => {
    if (viewMode === "month") {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + dir, 1));
    } else {
      const monday = getMonday(currentDate);
      setCurrentDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dir * 7));
    }
  };

  const goToday = () => setCurrentDate(new Date());

  const stats = useMemo(() => {
    const thisMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
    const monthAssignments = scopedAssignments.filter(a => a.scheduledDate?.startsWith(thisMonth));
    const byInstaller: Record<string, number> = {};
    monthAssignments.forEach(a => {
      byInstaller[a.installerName] = (byInstaller[a.installerName] || 0) + 1;
    });
    return {
      total: monthAssignments.length,
      completed: monthAssignments.filter(a => a.status === "completed").length,
      inProgress: monthAssignments.filter(a => a.status === "in_progress").length,
      pending: monthAssignments.filter(a => a.status === "assigned").length,
      byInstaller,
    };
  }, [scopedAssignments, currentDate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {toastEl}

      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 lg:px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-slate-100 rounded-xl">
              <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-200 rounded-l-xl transition-colors">
                <ChevronLeft className="size-5 text-slate-600" />
              </button>
              <button onClick={goToday} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                Сегодня
              </button>
              <button onClick={() => navigate(1)} className="p-2 hover:bg-slate-200 rounded-r-xl transition-colors">
                <ChevronRight className="size-5 text-slate-600" />
              </button>
            </div>

            <h2 className="text-lg font-bold text-slate-800">
              {viewMode === "month"
                ? `${MONTHS_RU[currentDate.getMonth()]} ${currentDate.getFullYear()}`
                : (() => {
                    const mon = weekDays[0];
                    const sun = weekDays[6];
                    return `${mon.getDate()} ${MONTHS_RU[mon.getMonth()].substring(0, 3)} — ${sun.getDate()} ${MONTHS_RU[sun.getMonth()].substring(0, 3)} ${sun.getFullYear()}`;
                  })()
              }
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {!isInstallerRole && (
              <div className="relative">
                <select
                  value={filterInstaller}
                  onChange={e => setFilterInstaller(e.target.value)}
                  className="appearance-none bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-8 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer"
                >
                  <option value="all">Все монтажники</option>
                  {installers.map(inst => (
                    <option key={inst.id} value={inst.id}>{inst.name}</option>
                  ))}
                </select>
                <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
              </div>
            )}

            {/* Status filter */}
            <div className="relative">
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="appearance-none bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-8 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer"
              >
                <option value="all">Все статусы</option>
                {Object.entries(STATUS_CFG).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
              <CheckCircle2 className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
            </div>

            <div className="flex bg-slate-100 rounded-xl">
              <button
                onClick={() => setViewMode("month")}
                className={`px-3 py-2 text-xs font-semibold rounded-l-xl transition-all ${viewMode === "month" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
              >
                Месяц
              </button>
              <button
                onClick={() => setViewMode("week")}
                className={`px-3 py-2 text-xs font-semibold rounded-r-xl transition-all ${viewMode === "week" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
              >
                Неделя
              </button>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex gap-3 mt-3 overflow-x-auto pb-1">
          <StatChip label="Всего" value={stats.total} color="bg-slate-600" />
          <StatChip label="Назначены" value={stats.pending} color="bg-blue-600" />
          <StatChip label="В работе" value={stats.inProgress} color="bg-amber-600" />
          <StatChip label="Выполнено" value={stats.completed} color="bg-green-600" />
          {Object.entries(stats.byInstaller).map(([name, count]) => (
            <StatChip key={name} label={name} value={count} color="bg-violet-600" />
          ))}
          {unscheduled.length > 0 && (
            <StatChip label="Без даты" value={unscheduled.length} color="bg-red-500" />
          )}
        </div>

        {/* Drag hint */}
        {canDrag && (
          <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1">
            <GripVertical className="size-3" /> Перетащите назначение на другой день для переноса даты
          </p>
        )}
      </div>

      {/* Calendar body */}
      <div className="flex-1 overflow-auto flex">
        <div className="flex-1 flex flex-col min-w-0">
          {viewMode === "month" ? (
            <MonthView
              days={monthGrid}
              byDate={byDate}
              today={today}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              installerColorMap={installerColorMap}
              canDrag={canDrag}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              dragOverDate={dragOverDate}
            />
          ) : (
            <WeekView
              days={weekDays}
              byDate={byDate}
              today={today}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              installerColorMap={installerColorMap}
              canDrag={canDrag}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              dragOverDate={dragOverDate}
            />
          )}
        </div>

        {/* Right panel */}
        <div className="w-80 border-l border-slate-200 bg-white flex-shrink-0 overflow-auto hidden lg:block">
          <DayDetail
            date={selectedDate}
            assignments={selectedDate ? (byDate[selectedDate] || []) : []}
            installerColorMap={installerColorMap}
            expandedId={expandedAssignment}
            onToggle={id => setExpandedAssignment(prev => prev === id ? null : id)}
            unscheduled={!selectedDate ? unscheduled : []}
            onChangeStatus={changeStatus}
            updatingId={updatingId}
            canDrag={canDrag}
            onDragStart={handleDragStart}
            onChangeTime={changeTime}
            onChangeNotes={changeNotes}
            onChangeDate={changeDate}
            onRequestBulkChange={(ids, status) => setBulkConfirm({ ids, status })}
            bulkUpdating={bulkUpdating}
            onRequestBulkDateTransfer={(ids, fromDate, targetDate) => setBulkDateTransfer({ ids, fromDate, targetDate })}
            onPrint={printDaySchedule}
          />
        </div>
      </div>

      {/* Bulk confirm modal */}
      <AnimatePresence>
      {bulkConfirm && (() => {
        const cfg = STATUS_CFG[bulkConfirm.status];
        if (!cfg) return null;
        const Icon = cfg.icon;
        return (
          <motion.div key="bulk-confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setBulkConfirm(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.2, ease: "easeOut" }} className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`size-10 rounded-full ${cfg.bg} flex items-center justify-center`}>
                  <Icon className={`size-5 ${cfg.text}`} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">Подтверждение</h3>
                  <p className="text-xs text-slate-500">Массовое изменение статуса</p>
                </div>
              </div>
              <p className="text-sm text-slate-600 mb-1">
                Вы уверены, что хотите изменить статус <span className="font-bold">{bulkConfirm.ids.length}</span> назначений на:
              </p>
              <div className="my-3">
                <span className={`inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-5">После выполнения вы сможете отменить действие через кнопку в уведомлении.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setBulkConfirm(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={() => {
                    const { ids, status } = bulkConfirm;
                    setBulkConfirm(null);
                    bulkChangeStatus(ids, status);
                  }}
                  disabled={bulkUpdating}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:shadow-lg disabled:opacity-50 active:scale-95 ${
                    bulkConfirm.status === "cancelled" ? "bg-red-600 hover:bg-red-700" :
                    bulkConfirm.status === "completed" ? "bg-green-600 hover:bg-green-700" :
                    bulkConfirm.status === "in_progress" ? "bg-amber-600 hover:bg-amber-700" :
                    "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {bulkUpdating ? <Loader2 className="size-4 animate-spin mx-auto" /> : "Подтвердить"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        );
      })()}
      </AnimatePresence>

      {/* Bulk date transfer modal */}
      <AnimatePresence>
      {bulkDateTransfer && (() => {
        const targetDate = bulkDateTransfer.targetDate;
        const d = new Date(targetDate + "T00:00:00");
        return (
          <motion.div key="bulk-date" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setBulkDateTransfer(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.2, ease: "easeOut" }} className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className="size-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <ArrowRightCircle className="size-5 text-blue-700" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">Подтверждение</h3>
                  <p className="text-xs text-slate-500">Массовый перенос назначений</p>
                </div>
              </div>
              <p className="text-sm text-slate-600 mb-1">
                Вы уверены, что хотите перенести <span className="font-bold">{bulkDateTransfer.ids.length}</span> назначений на:
              </p>
              <div className="my-3">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full bg-blue-100 text-blue-700">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  {d.getDate()} {MONTHS_RU[d.getMonth()]}
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-5">После выполнения вы сможете отменить действие через кнопку в уведомлении.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setBulkDateTransfer(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={() => {
                    const { ids, targetDate } = bulkDateTransfer;
                    setBulkDateTransfer(null);
                    bulkTransferDate(ids, targetDate);
                  }}
                  disabled={bulkUpdating}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:shadow-lg disabled:opacity-50 active:scale-95 bg-blue-600 hover:bg-blue-700`}
                >
                  {bulkUpdating ? <Loader2 className="size-4 animate-spin mx-auto" /> : "Подтвердить"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        );
      })()}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`${color} rounded-xl px-3 py-1.5 flex-shrink-0 text-center min-w-[60px]`}>
      <p className="text-white font-bold text-lg leading-none">{value}</p>
      <p className="text-white/70 text-[10px] mt-0.5 leading-tight whitespace-nowrap">{label}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.assigned;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

// ─── Draggable Assignment Chip (for month view) ──────────────────────────────

function DraggableChip({
  assignment, col, onDragStart, canDrag,
}: {
  assignment: Assignment;
  col: typeof INSTALLER_COLORS[0];
  onDragStart: (e: React.DragEvent, a: Assignment) => void;
  canDrag: boolean;
}) {
  const statusDot = STATUS_CFG[assignment.status]?.dot || "bg-blue-500";
  return (
    <div
      draggable={canDrag}
      onDragStart={canDrag ? (e => {
        e.stopPropagation();
        onDragStart(e, assignment);
      }) : undefined}
      className={`${col.bg} ${col.text} rounded px-1.5 py-0.5 text-[9px] font-medium truncate border-l-2 ${col.border} ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} hover:shadow-sm transition-shadow flex items-center gap-1`}
    >
      {canDrag && <GripVertical className="size-2.5 opacity-40 flex-shrink-0" />}
      <span className={`w-1.5 h-1.5 rounded-full ${statusDot} flex-shrink-0`} />
      {assignment.scheduledTime && <span className="opacity-70">{assignment.scheduledTime}</span>}
      <span className="truncate">{assignment.clientName}</span>
    </div>
  );
}

// ─── Month View ──────────────────────────────────────────────────────────────

interface GridViewProps {
  byDate: Record<string, Assignment[]>;
  today: string;
  selectedDate: string | null;
  onSelectDate: (d: string) => void;
  installerColorMap: Record<string, typeof INSTALLER_COLORS[0]>;
  canDrag: boolean;
  onDragStart: (e: React.DragEvent, a: Assignment) => void;
  onDrop: (e: React.DragEvent, date: string) => void;
  onDragOver: (e: React.DragEvent, date: string) => void;
  onDragLeave: () => void;
  dragOverDate: string | null;
}

function MonthView({
  days, byDate, today, selectedDate, onSelectDate, installerColorMap,
  canDrag, onDragStart, onDrop, onDragOver, onDragLeave, dragOverDate,
}: GridViewProps & { days: { date: Date; inMonth: boolean }[] }) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 flex-shrink-0">
        {DAYS_RU.map(d => (
          <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 flex-1 auto-rows-fr">
        {days.map(({ date, inMonth }, idx) => {
          const key = formatDate(date);
          const isToday = key === today;
          const isSelected = key === selectedDate;
          const isDragOver = key === dragOverDate;
          const dayAssignments = byDate[key] || [];
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;

          return (
            <div
              key={idx}
              onClick={() => onSelectDate(key)}
              onDrop={canDrag ? (e => onDrop(e, key)) : undefined}
              onDragOver={canDrag ? (e => onDragOver(e, key)) : undefined}
              onDragLeave={canDrag ? onDragLeave : undefined}
              className={`relative border-b border-r border-slate-100 p-1.5 text-left transition-all min-h-[80px] cursor-pointer ${
                !inMonth ? "bg-slate-50/50" : isWeekend ? "bg-slate-50/30" : "bg-white"
              } ${isSelected ? "ring-2 ring-blue-500 ring-inset z-10" : ""} ${
                isDragOver ? "bg-blue-50 ring-2 ring-blue-400 ring-dashed ring-inset" : "hover:bg-blue-50/30"
              }`}
            >
              {/* Drop indicator */}
              {canDrag && isDragOver && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                  <div className="bg-blue-500 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg">
                    Перенести сюда
                  </div>
                </div>
              )}

              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${
                isToday ? "bg-blue-600 text-white" : !inMonth ? "text-slate-300" : "text-slate-700"
              }`}>
                {date.getDate()}
              </span>

              <div className="mt-0.5 space-y-0.5">
                {dayAssignments.slice(0, 3).map(a => {
                  const col = installerColorMap[a.installerId] || INSTALLER_COLORS[0];
                  return <DraggableChip key={a.id} assignment={a} col={col} onDragStart={onDragStart} canDrag={canDrag} />;
                })}
                {dayAssignments.length > 3 && (
                  <div className="text-[9px] text-slate-400 font-semibold pl-1">
                    +{dayAssignments.length - 3} ещё
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Week View ───────────────────────────────────────────────────────────────

function WeekView({
  days, byDate, today, selectedDate, onSelectDate, installerColorMap,
  canDrag, onDragStart, onDrop, onDragOver, onDragLeave, dragOverDate,
}: GridViewProps & { days: Date[] }) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 flex-shrink-0">
        {days.map((d, i) => {
          const key = formatDate(d);
          const isToday = key === today;
          return (
            <div key={i} className="px-2 py-3 text-center">
              <div className="text-[10px] font-semibold text-slate-400 uppercase">{DAYS_RU[i]}</div>
              <div className={`text-lg font-bold mt-0.5 ${isToday ? "text-blue-600" : "text-slate-800"}`}>
                {d.getDate()}
              </div>
              <div className="text-[10px] text-slate-400">{MONTHS_RU[d.getMonth()].substring(0, 3)}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-7 flex-1">
        {days.map((d, i) => {
          const key = formatDate(d);
          const isToday = key === today;
          const isSelected = key === selectedDate;
          const isDragOver = key === dragOverDate;
          const dayAssignments = byDate[key] || [];

          return (
            <div
              key={i}
              onClick={() => onSelectDate(key)}
              onDrop={canDrag ? (e => onDrop(e, key)) : undefined}
              onDragOver={canDrag ? (e => onDragOver(e, key)) : undefined}
              onDragLeave={canDrag ? onDragLeave : undefined}
              className={`border-r border-slate-100 p-2 text-left transition-all overflow-auto cursor-pointer ${
                isToday ? "bg-blue-50/30" : "bg-white"
              } ${isSelected ? "ring-2 ring-blue-500 ring-inset z-10" : ""} ${
                isDragOver ? "bg-blue-50 ring-2 ring-blue-400 ring-dashed ring-inset" : "hover:bg-blue-50/30"
              }`}
            >
              {canDrag && isDragOver && (
                <div className="flex justify-center mb-2">
                  <div className="bg-blue-500 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg">
                    Перенести сюда
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                {dayAssignments.map(a => {
                  const col = installerColorMap[a.installerId] || INSTALLER_COLORS[0];
                  return (
                    <div
                      key={a.id}
                      draggable={canDrag}
                      onDragStart={canDrag ? (e => { e.stopPropagation(); onDragStart(e, a); }) : undefined}
                      className={`${col.bg} rounded-lg p-2 border-l-3 ${col.border} ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} hover:shadow-sm transition-shadow`}
                    >
                      <div className="flex items-center gap-1 mb-1">
                        {canDrag && <GripVertical className="size-3 opacity-40" />}
                        {a.scheduledTime && (
                          <span className={`text-[10px] font-bold ${col.text}`}>{a.scheduledTime}</span>
                        )}
                        <StatusBadge status={a.status} />
                      </div>
                      <p className={`text-xs font-semibold ${col.text} truncate`}>{a.clientName}</p>
                      <p className="text-[10px] text-slate-500 truncate">👷 {a.installerName}</p>
                    </div>
                  );
                })}
                {dayAssignments.length === 0 && !isDragOver && (
                  <div className="text-center py-4">
                    <p className="text-[10px] text-slate-300">Нет</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Day Detail Panel ────────────────────────────────────────────────────────

function DayDetail({
  date, assignments, installerColorMap, expandedId, onToggle, unscheduled,
  onChangeStatus, updatingId, onDragStart, onChangeTime, onChangeNotes,
  onChangeDate, onRequestBulkChange, bulkUpdating,
  onRequestBulkDateTransfer, onPrint,
}: {
  date: string | null;
  assignments: Assignment[];
  installerColorMap: Record<string, typeof INSTALLER_COLORS[0]>;
  expandedId: string | null;
  onToggle: (id: string) => void;
  unscheduled: Assignment[];
  onChangeStatus: (id: string, status: string) => void;
  updatingId: string | null;
  canDrag: boolean;
  onDragStart: (e: React.DragEvent, a: Assignment) => void;
  onChangeTime: (id: string, time: string) => void;
  onChangeNotes: (id: string, notes: string) => void;
  onChangeDate: (id: string, date: string) => void;
  onRequestBulkChange: (ids: string[], status: string) => void;
  bulkUpdating: boolean;
  onRequestBulkDateTransfer: (ids: string[], fromDate: string, targetDate: string) => void;
  onPrint: (date: string, items: Assignment[]) => void;
}) {
  if (!date && unscheduled.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <CalendarIcon className="size-10 text-slate-200 mb-3" />
        <p className="text-sm font-medium text-slate-400">Выберите день</p>
        <p className="text-xs text-slate-300 mt-1">Нажмите на ячейку календаря для просмотра деталей</p>
      </div>
    );
  }

  const displayDate = date ? new Date(date + "T00:00:00") : null;
  const dateLabel = displayDate
    ? `${displayDate.getDate()} ${MONTHS_RU[displayDate.getMonth()]} ${displayDate.getFullYear()}`
    : "Без даты";
  const items = date ? assignments : unscheduled;

  return (
    <div className="p-4">
      <div className="mb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-800">{dateLabel}</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {items.length === 0 ? "Нет назначений" : `${items.length} назначений`}
            </p>
          </div>
          {date && items.length > 0 && (
            <button
              onClick={() => onPrint(date, items)}
              title="Печать расписания дня"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all border border-slate-200 flex-shrink-0"
            >
              <Printer className="size-3.5" />
              Печать
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-8">
          <div className="size-14 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-2">
            <CalendarIcon className="size-7 text-slate-200" />
          </div>
          <p className="text-sm text-slate-400">Свободный день</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(a => {
            const col = installerColorMap[a.installerId] || INSTALLER_COLORS[0];
            const isExpanded = expandedId === a.id;
            const isUpdating = updatingId === a.id;
            const transitions = STATUS_TRANSITIONS[a.status] || [];

            return (
              <div
                key={a.id}
                draggable={canDrag}
                onDragStart={canDrag ? (e => onDragStart(e, a)) : undefined}
                className={`rounded-xl border ${isExpanded ? "border-slate-300 shadow-sm" : "border-slate-100"} overflow-hidden transition-all ${isUpdating ? "opacity-60" : ""}`}
              >
                <button
                  onClick={() => onToggle(a.id)}
                  className="w-full p-3 text-left hover:bg-slate-50/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`size-8 rounded-full ${col.bg} flex items-center justify-center flex-shrink-0`}>
                        <GripVertical className={`size-4 ${col.text} opacity-50`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{a.clientName}</p>
                        <p className="text-[11px] text-slate-500 truncate">👷 {a.installerName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {a.scheduledTime && (
                        <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-0.5">
                          <Clock className="size-3" />{a.scheduledTime}
                        </span>
                      )}
                      {isExpanded ? <ChevronUp className="size-4 text-slate-400" /> : <ChevronDown className="size-4 text-slate-400" />}
                    </div>
                  </div>
                  <div className="mt-1.5">
                    <StatusBadge status={a.status} />
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-slate-100 space-y-3">
                    {/* Details */}
                    <div className="space-y-2">
                      <DetailRow icon={<User className="size-3.5" />} label="Клиент" value={a.clientName} />
                      <DetailRow icon={<Phone className="size-3.5" />} label="Телефон" value={a.clientPhone} />
                      <DetailRow icon={<Wrench className="size-3.5" />} label="Монтажник" value={a.installerName} />
                      {/* Inline date editor */}
                      <InlineDateEditor
                        assignmentId={a.id}
                        currentDate={a.scheduledDate}
                        onSave={onChangeDate}
                        disabled={isUpdating}
                      />
                      {/* Inline time editor */}
                      <InlineTimeEditor
                        assignmentId={a.id}
                        currentTime={a.scheduledTime}
                        onSave={onChangeTime}
                        disabled={isUpdating}
                      />
                      {/* Inline notes editor */}
                      <InlineNotesEditor
                        assignmentId={a.id}
                        currentNotes={a.notes}
                        onSave={onChangeNotes}
                        disabled={isUpdating}
                      />
                    </div>

                    {/* Status change buttons */}
                    {transitions.length > 0 && (
                      <div className="pt-2 border-t border-slate-100">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Изменить статус</p>
                        <div className="flex flex-wrap gap-1.5">
                          {transitions.map(nextStatus => {
                            const cfg = STATUS_CFG[nextStatus];
                            if (!cfg) return null;
                            const Icon = cfg.icon;
                            return (
                              <button
                                key={nextStatus}
                                onClick={(e) => { e.stopPropagation(); onChangeStatus(a.id, nextStatus); }}
                                disabled={isUpdating}
                                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${cfg.bg} ${cfg.text} hover:shadow-md disabled:opacity-50 active:scale-95`}
                              >
                                {isUpdating ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Icon className="size-3.5" />
                                )}
                                {cfg.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <p className="text-[10px] text-slate-300 pt-1">
                      Создано: {new Date(a.createdAt).toLocaleString("ru-RU")}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Bulk status change */}
      {items.length >= 2 && (
        <div className="mt-4 pt-3 border-t border-slate-200">
          <div className="flex items-center gap-1.5 mb-2">
            <ListChecks className="size-3.5 text-slate-500" />
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Массовое изменение ({items.length})</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(STATUS_CFG).map(([key, cfg]) => {
              const Icon = cfg.icon;
              const eligible = items.filter(a => a.status !== key && (STATUS_TRANSITIONS[a.status] || []).includes(key));
              if (eligible.length === 0) return null;
              return (
                <button
                  key={key}
                  onClick={() => onRequestBulkChange(eligible.map(a => a.id), key)}
                  disabled={bulkUpdating}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${cfg.bg} ${cfg.text} hover:shadow-md disabled:opacity-50 active:scale-95`}
                >
                  {bulkUpdating ? <Loader2 className="size-3 animate-spin" /> : <Icon className="size-3" />}
                  Все → {cfg.label} ({eligible.length})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Bulk date transfer */}
      {date && items.length >= 1 && (
        <BulkDateTransfer
          items={items}
          currentDate={date}
          onRequest={onRequestBulkDateTransfer}
          disabled={bulkUpdating}
        />
      )}

      {/* Installer legend */}
      {items.length > 0 && (
        <div className="mt-6 pt-4 border-t border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Легенда</p>
          <div className="space-y-1.5">
            {[...new Set(items.map(a => a.installerId))].map(instId => {
              const a = items.find(x => x.installerId === instId)!;
              const col = installerColorMap[instId] || INSTALLER_COLORS[0];
              const count = items.filter(x => x.installerId === instId).length;
              return (
                <div key={instId} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${col.dot}`} />
                  <span className="text-xs text-slate-600 flex-1">{a.installerName}</span>
                  <span className="text-xs font-semibold text-slate-400">{count}</span>
                </div>
              );
            })}
          </div>

          {/* Status legend */}
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 mt-4">Статусы</p>
          <div className="space-y-1.5">
            {Object.entries(STATUS_CFG).map(([key, cfg]) => (
              <div key={key} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${cfg.dot}`} />
                <span className="text-xs text-slate-600">{cfg.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Bulk Date Transfer ──────────────────────────────────────────────────────

function BulkDateTransfer({
  items, currentDate, onRequest, disabled,
}: {
  items: Assignment[];
  currentDate: string;
  onRequest: (ids: string[], fromDate: string, targetDate: string) => void;
  disabled: boolean;
}) {
  const [targetDate, setTargetDate] = useState("");
  const [open, setOpen] = useState(false);

  const handleTransfer = () => {
    if (!targetDate || targetDate === currentDate) return;
    onRequest(items.map(a => a.id), currentDate, targetDate);
    setTargetDate("");
    setOpen(false);
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-200">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 transition-colors"
      >
        <CalendarDays className="size-3.5" />
        Перенести все на другую дату ({items.length})
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>
      {open && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="date"
            value={targetDate}
            onChange={e => setTargetDate(e.target.value)}
            className="text-xs text-slate-700 font-medium px-2 py-1.5 border border-slate-300 rounded-lg flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button
            onClick={handleTransfer}
            disabled={disabled || !targetDate || targetDate === currentDate}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-blue-100 text-blue-700 hover:shadow-md disabled:opacity-50 active:scale-95 transition-all"
          >
            {disabled ? <Loader2 className="size-3 animate-spin" /> : <ArrowRightCircle className="size-3" />}
            Перенести
          </button>
        </div>
      )}
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-400 mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-slate-400">{label}</p>
        <p className="text-xs text-slate-700 font-medium break-words">{value}</p>
      </div>
    </div>
  );
}

// ─── Inline Time Editor ──────────────────────────────────────────────────────

function InlineTimeEditor({
  assignmentId, currentTime, onSave, disabled,
}: {
  assignmentId: string;
  currentTime: string | null;
  onSave: (id: string, time: string) => void;
  disabled: boolean;
}) {
  const [time, setTime] = useState(currentTime || "");
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback(() => {
    if (time) {
      onSave(assignmentId, time);
    }
    setEditing(false);
  }, [assignmentId, time, onSave]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  }, [handleSave]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  return (
    <div className="flex items-center gap-2">
      <Clock className="size-3.5 text-slate-500" />
      {editing ? (
        <input
          ref={inputRef}
          type="time"
          value={time}
          onChange={e => setTime(e.target.value)}
          onKeyDown={handleKeyDown}
          className="text-xs text-slate-700 font-medium break-words px-1 py-0.5 border border-slate-300 rounded"
        />
      ) : (
        <span className="text-xs text-slate-700 font-medium break-words">
          {time || "не указано"}
        </span>
      )}
      {editing ? (
        <button
          onClick={handleSave}
          className="text-[10px] font-bold text-slate-500 hover:text-slate-700"
        >
          Сохранить
        </button>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-[10px] font-bold text-slate-500 hover:text-slate-700"
        >
          Изменить
        </button>
      )}
    </div>
  );
}

// ─── Inline Notes Editor ─────────────────────────────────────────────────────

function InlineNotesEditor({
  assignmentId, currentNotes, onSave, disabled,
}: {
  assignmentId: string;
  currentNotes: string;
  onSave: (id: string, notes: string) => void;
  disabled: boolean;
}) {
  const [notes, setNotes] = useState(currentNotes);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback(() => {
    onSave(assignmentId, notes);
    setEditing(false);
  }, [assignmentId, notes, onSave]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  }, [handleSave]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  return (
    <div className="flex items-center gap-2">
      <AlertCircle className="size-3.5 text-slate-500" />
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onKeyDown={handleKeyDown}
          className="text-xs text-slate-700 font-medium break-words px-1 py-0.5 border border-slate-300 rounded"
        />
      ) : (
        <span className="text-xs text-slate-700 font-medium break-words">
          {notes || "нет"}
        </span>
      )}
      {editing ? (
        <button
          onClick={handleSave}
          className="text-[10px] font-bold text-slate-500 hover:text-slate-700"
        >
          Сохранить
        </button>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-[10px] font-bold text-slate-500 hover:text-slate-700"
        >
          Изменить
        </button>
      )}
    </div>
  );
}

// ─── Inline Date Editor ──────────────────────────────────────────────────────

function InlineDateEditor({
  assignmentId, currentDate, onSave, disabled,
}: {
  assignmentId: string;
  currentDate: string | null;
  onSave: (id: string, date: string) => void;
  disabled: boolean;
}) {
  const [date, setDate] = useState(currentDate || "");
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback(() => {
    if (date) {
      onSave(assignmentId, date);
    }
    setEditing(false);
  }, [assignmentId, date, onSave]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  }, [handleSave]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  return (
    <div className="flex items-center gap-2">
      <CalendarIcon className="size-3.5 text-slate-500" />
      {editing ? (
        <input
          ref={inputRef}
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          onKeyDown={handleKeyDown}
          className="text-xs text-slate-700 font-medium break-words px-1 py-0.5 border border-slate-300 rounded"
        />
      ) : (
        <span className="text-xs text-slate-700 font-medium break-words">
          {date || "не указано"}
        </span>
      )}
      {editing ? (
        <button
          onClick={handleSave}
          className="text-[10px] font-bold text-slate-500 hover:text-slate-700"
        >
          Сохранить
        </button>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-[10px] font-bold text-slate-500 hover:text-slate-700"
        >
          Изменить
        </button>
      )}
    </div>
  );
}