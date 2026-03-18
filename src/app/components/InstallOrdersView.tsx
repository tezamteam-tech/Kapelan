import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { useRole } from "./RoleContext";
import { useCurrency } from "./CurrencyContext";
import {
  Plus, Search, ArrowLeft, Package, User, MapPin, Thermometer,
  Calendar, ClipboardCheck, Zap, CheckCircle2, AlertCircle, Clock,
  ChevronRight, Loader2, Upload, Sparkles, XCircle, Printer,
  X, RefreshCw, Building2, Ruler, TriangleAlert,
} from "lucide-react";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
type OrderStatus = "draft" | "confirmed" | "assigned" | "in_progress" | "paused" | "completed" | "cancelled";
type AcTier = "economy" | "standard" | "premium";

interface OrderConsumable {
  warehouseId: string; name: string; unit: string;
  qtyRequired: number; qtyIssued: number; stockSnapshot: number;
}
interface InstallOrder {
  id: string;
  clientName: string; clientPhone: string; clientAddress: string; leadId?: string;
  roomArea: number; roomType: string; traceLength: number;
  acModelId: string; acBrand: string; acModelName: string; acBtu: number; acKw: number; acPrice: number; acCount: number;
  consumables: OrderConsumable[]; consumablesIssued: boolean;
  installerName: string; scheduledDate: string;
  aiAnalysis?: { area: number; roomType: string; recommendedBtu: number; traceLength: number; notes: string; imageDescription: string };
  status: OrderStatus; notes: string; source: "ai" | "manual";
  createdAt: string; updatedAt: string;
}
interface AcModel {
  id: string; brand: string; model: string; btu: number; kw: number;
  areaMin: number; areaMax: number; refrigerant: string;
  tier: AcTier; features: string[]; price: number; warranty: number;
}
interface AiAnalysis {
  area: number; roomType: string; recommendedBtu: number; traceLength: number; notes: string; imageDescription: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<OrderStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  draft:       { label: "Черновик",    color: "text-slate-600",   bg: "bg-slate-100",   icon: <Clock size={12} /> },
  confirmed:   { label: "Подтверждён", color: "text-blue-700",    bg: "bg-blue-100",    icon: <CheckCircle2 size={12} /> },
  assigned:    { label: "Назначен",    color: "text-violet-700",  bg: "bg-violet-100",  icon: <User size={12} /> },
  in_progress: { label: "Приступили",  color: "text-amber-700",   bg: "bg-amber-100",   icon: <Zap size={12} /> },
  paused:      { label: "Пауза",       color: "text-orange-700",  bg: "bg-orange-100",  icon: <Clock size={12} /> },
  completed:   { label: "Завершён",    color: "text-emerald-700", bg: "bg-emerald-100", icon: <CheckCircle2 size={12} /> },
  cancelled:   { label: "Отменён",     color: "text-red-600",     bg: "bg-red-100",     icon: <XCircle size={12} /> },
};

const TIER_CFG: Record<AcTier, { label: string; color: string; bg: string; border: string }> = {
  economy:  { label: "Эконом",   color: "text-emerald-700", bg: "bg-emerald-50",  border: "border-emerald-200" },
  standard: { label: "Стандарт", color: "text-blue-700",    bg: "bg-blue-50",     border: "border-blue-200" },
  premium:  { label: "Премиум",  color: "text-violet-700",  bg: "bg-violet-50",   border: "border-violet-200" },
};

const STATUS_STEPS: OrderStatus[] = ["draft", "confirmed", "assigned", "in_progress", "completed"];
const ROOM_TYPES = ["Квартира", "Спальня", "Гостиная", "Кухня", "Офис", "Магазин", "Склад", "Серверная", "Другое"];

const fmt = (n: number) => n.toLocaleString("ru-RU");
const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
const shortId = (id: string) => id.slice(-6).toUpperCase();

// ─── Toast hook ───────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState<{ msg: string; type?: "ok" | "err" } | null>(null);
  const show = useCallback((msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);
  return { toast, show };
}

// ─── Main component ───────────────────────────────────────────────────────────
export function InstallOrdersView() {
  const { role, userName } = useRole();
  const { fmtShort } = useCurrency();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<InstallOrder[]>([]);
  const [selected, setSelected] = useState<InstallOrder | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [prefillLeadId, setPrefillLeadId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast, show: showToast } = useToast();

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/install-orders`, { headers: AH });
      const data = await res.json();
      if (data.orders) setOrders(data.orders);
    } catch { showToast("Ошибка загрузки ордеров", "err"); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // Handle fromLead query param
  useEffect(() => {
    const leadId = searchParams.get("fromLead");
    if (leadId) {
      setPrefillLeadId(leadId);
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Refresh selected order after mutations
  const refreshSelected = async (id: string) => {
    const res = await fetch(`${API}/install-orders/${id}`, { headers: AH });
    const data = await res.json();
    if (data.order) {
      setSelected(data.order);
      setOrders(prev => prev.map(o => o.id === id ? data.order : o));
    }
  };

  // Filtered orders
  const filtered = orders.filter(o => {
    const matchRole = role === "installer" ? o.installerName === userName : true;
    const matchStatus = filterStatus === "all" || o.status === filterStatus;
    const q = search.toLowerCase();
    const matchSearch = !q || o.clientName.toLowerCase().includes(q) ||
      o.clientAddress.toLowerCase().includes(q) || o.acBrand.toLowerCase().includes(q) ||
      shortId(o.id).toLowerCase().includes(q);
    return matchRole && matchStatus && matchSearch;
  });

  // Status counts
  const counts = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center justify-between px-5 py-3 gap-3">
          <div>
            <h1 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <ClipboardCheck size={18} className="text-teal-600" /> Ордера монтажа
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {role === "installer" ? `Назначено вам: ${orders.filter(o => o.installerName === userName).length}` : `Всего ордеров: ${orders.length}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadOrders} disabled={loading} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            {role !== "installer" && (
              <button onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-semibold px-3 py-2 rounded-xl hover:bg-teal-700 active:scale-95 transition-all shadow-sm">
                <Plus size={16} /> Создать ордер
              </button>
            )}
          </div>
        </div>

        {/* Status filter strip */}
        <div className="flex gap-1 px-4 pb-3 overflow-x-auto">
          {[
            { key: "all", label: "Все", count: orders.length },
            { key: "draft", label: "Черновики", count: counts.draft || 0 },
            { key: "confirmed", label: "Подтверждён", count: counts.confirmed || 0 },
            { key: "assigned", label: "Назначен", count: counts.assigned || 0 },
            { key: "in_progress", label: "Приступили", count: counts.in_progress || 0 },
            { key: "paused", label: "Пауза", count: counts.paused || 0 },
            { key: "completed", label: "Завершён", count: counts.completed || 0 },
          ].map(f => (
            <button key={f.key} onClick={() => setFilterStatus(f.key)}
              className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                filterStatus === f.key
                  ? "bg-teal-600 text-white border-teal-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
              }`}>
              {f.label}
              {f.count > 0 && (
                <span className={`w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center ${
                  filterStatus === f.key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                }`}>{f.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content area ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: Order list */}
        <div className={`flex flex-col border-r border-slate-200 bg-white overflow-hidden
          ${selected ? "hidden lg:flex lg:w-[380px] xl:w-[420px]" : "flex-1"}`}>

          {/* Search */}
          <div className="px-3 py-2.5 border-b border-slate-100">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <Search size={15} className="text-slate-400 flex-shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по клиенту, адресу, модели…"
                className="bg-transparent flex-1 text-sm text-slate-700 placeholder-slate-400 outline-none" />
            </div>
          </div>

          {/* Order cards */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {loading && orders.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-slate-300">
                <Loader2 className="animate-spin" size={28} />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-4xl mb-3">📋</p>
                <p className="text-slate-400 font-medium text-sm">Ордеров не найдено</p>
                <p className="text-slate-300 text-xs mt-1">
                  {role !== "installer" ? "Создайте первый ордер монтажа" : "Вам пока не назначены ордера"}
                </p>
              </div>
            ) : (
              filtered.map(o => (
                <OrderCard key={o.id} order={o} isSelected={selected?.id === o.id}
                  onClick={() => setSelected(o)} />
              ))
            )}
          </div>
        </div>

        {/* Right: Detail panel */}
        {selected ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            <OrderDetailPanel
              order={selected}
              onClose={() => setSelected(null)}
              onRefresh={() => { loadOrders(); refreshSelected(selected.id); }}
              onOrderUpdate={(upd) => { setSelected(upd); setOrders(prev => prev.map(o => o.id === upd.id ? upd : o)); }}
              showToast={showToast}
              role={role}
            />
          </div>
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center text-slate-200 flex-col gap-3">
            <ClipboardCheck size={56} strokeWidth={1} />
            <p className="text-slate-400 font-medium">Выберите ордер для просмотра</p>
          </div>
        )}
      </div>

      {/* ── Create modal ────────────────────────────────────────────────────── */}
      {createOpen && (
        <CreateOrderModal
          onClose={() => { setCreateOpen(false); setPrefillLeadId(null); }}
          prefillLeadId={prefillLeadId}
          onCreated={(order) => {
            loadOrders();
            setSelected(order);
            setCreateOpen(false);
            setPrefillLeadId(null);
            showToast(`✅ Ордер #${shortId(order.id)} создан`);
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-sm font-semibold max-w-sm text-center pointer-events-none ${
          toast.type === "err" ? "bg-red-600 text-white" : "bg-slate-800 text-white"
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ORDER CARD
// ══════════════════════════════════════════════════════════════════════════════
function OrderCard({ order: o, isSelected, onClick }: { order: InstallOrder; isSelected: boolean; onClick: () => void }) {
  const st = STATUS_CFG[o.status];
  const allInStock = o.consumables.every(c => c.stockSnapshot >= c.qtyRequired);
  return (
    <button onClick={onClick} className={`w-full text-left rounded-2xl border transition-all ${
      isSelected
        ? "bg-teal-50 border-teal-300 shadow-md"
        : "bg-white border-slate-100 hover:border-teal-200 hover:shadow-sm"
    }`}>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-black text-[10px] text-slate-400 font-mono">#{shortId(o.id)}</span>
              {o.source === "ai" && <span className="text-[9px] bg-violet-100 text-violet-700 font-bold px-1.5 py-0.5 rounded-full">AI</span>}
            </div>
            <p className="font-bold text-slate-800 text-sm truncate">{o.clientName || "Клиент не указан"}</p>
            <p className="text-xs text-slate-400 truncate">{o.clientAddress || "Адрес не указан"}</p>
          </div>
          <span className={`flex-shrink-0 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${st.bg} ${st.color}`}>
            {st.icon} {st.label}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <Thermometer size={10} /> {o.acBrand} · {o.acBtu / 1000}kBTU
          </span>
          <span className="flex items-center gap-1">
            <Ruler size={10} /> {o.roomArea} м²
          </span>
          {o.installerName && (
            <span className="flex items-center gap-1">
              <User size={10} /> {o.installerName.split(" ")[0]}
            </span>
          )}
        </div>
      </div>

      <div className={`border-t px-4 py-2 flex items-center justify-between ${isSelected ? "border-teal-200" : "border-slate-50"}`}>
        <div className="flex items-center gap-1.5">
          <Package size={11} className={o.consumablesIssued ? "text-emerald-500" : allInStock ? "text-slate-400" : "text-amber-500"} />
          <span className={`text-[10px] font-semibold ${o.consumablesIssued ? "text-emerald-600" : allInStock ? "text-slate-400" : "text-amber-600"}`}>
            {o.consumablesIssued ? "Материалы выданы" : allInStock ? "Материалы в наличии" : "Нехватка на складе"}
          </span>
        </div>
        <span className="text-[10px] text-slate-300">{fmtDate(o.createdAt)}</span>
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ORDER DETAIL PANEL
// ══════════════════════════════════════════════════════════════════════════════
function OrderDetailPanel({ order: o, onClose, onRefresh, onOrderUpdate, showToast, role }: {
  order: InstallOrder;
  onClose: () => void;
  onRefresh: () => void;
  onOrderUpdate: (o: InstallOrder) => void;
  showToast: (m: string, t?: "ok" | "err") => void;
  role: string;
}) {
  const [tab, setTab] = useState<"info" | "consumables">("info");
  const [acting, setActing] = useState<string | null>(null);
  const [editInstaller, setEditInstaller] = useState("");
  const [editDate, setEditDate] = useState("");
  const [showAssign, setShowAssign] = useState(false);
  const [shortages, setShortages] = useState<string[]>([]);

  const st = STATUS_CFG[o.status];
  const stepIdx = STATUS_STEPS.indexOf(o.status);

  async function doAction(path: string, body?: object, action?: string) {
    setActing(action ?? path);
    try {
      const res = await fetch(`${API}/install-orders/${o.id}/${path}`, {
        method: "POST", headers: JH, body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Ошибка", "err");
        if (data.shortages) setShortages(data.shortages);
        return;
      }
      setShortages([]);
      onOrderUpdate(data.order);
      showToast("✅ Готово");
    } catch { showToast("Ошибка запроса", "err"); }
    finally { setActing(null); }
  }

  async function doConfirm() {
    const res = await fetch(`${API}/install-orders/${o.id}`, {
      method: "PUT", headers: JH, body: JSON.stringify({ status: "confirmed" }),
    });
    const data = await res.json();
    if (res.ok) { onOrderUpdate(data.order); showToast("✅ Ордер подтверждён"); }
    else showToast(data.error, "err");
  }

  async function doAssign() {
    const res = await fetch(`${API}/install-orders/${o.id}`, {
      method: "PUT", headers: JH,
      body: JSON.stringify({ status: "assigned", installerName: editInstaller, scheduledDate: editDate }),
    });
    const data = await res.json();
    if (res.ok) { onOrderUpdate(data.order); setShowAssign(false); showToast("✅ Монтажник назначен"); }
    else showToast(data.error, "err");
  }

  async function doDelete() {
    if (!confirm(`Удалить ордер #${shortId(o.id)}?`)) return;
    const res = await fetch(`${API}/install-orders/${o.id}`, { method: "DELETE", headers: AH });
    const data = await res.json();
    if (res.ok) { onRefresh(); onClose(); showToast("🗑️ Ордер удалён"); }
    else showToast(data.error, "err");
  }

  function printWorkOrder() {
    const consumableRows = o.consumables.map((c, i) =>
      `<tr><td>${i + 1}</td><td>${c.name}</td><td>${c.unit}</td><td class="num">${c.qtyRequired}</td><td class="num ${c.stockSnapshot >= c.qtyRequired ? 'ok' : 'bad'}">${c.stockSnapshot}</td><td class="num">${c.qtyIssued || "—"}</td></tr>`
    ).join("");

    const nowStr = new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" } as any);
    const win = window.open("", "_blank", "width=860,height=700");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
<title>Ордер монтажа #${shortId(o.id)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;padding:28px;color:#1e293b;font-size:13px}
h1{font-size:20px;font-weight:800;margin-bottom:2px}
.org{font-size:10px;color:#94a3b8;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}
.meta{color:#64748b;font-size:11px;margin-bottom:20px}
.section{margin-bottom:18px}
.section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px}
.field label{font-size:10px;color:#94a3b8;display:block;margin-bottom:1px}
.field span{font-weight:600}
table{width:100%;border-collapse:collapse;margin-top:4px}
thead th{background:#1e293b;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
tbody td{padding:7px 10px;border-bottom:1px solid #f1f5f9;font-size:12px}
tbody tr:nth-child(even) td{background:#f8fafc}
.num{text-align:right;font-weight:600}
.ok{color:#16a34a}
.bad{color:#dc2626}
.sig-block{margin-top:36px;display:flex;gap:60px}
.sig{flex:1}.sig-line{border-top:1px solid #475569;margin-top:42px;padding-top:4px;font-size:10px;color:#64748b}
.footer{margin-top:20px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;color:#94a3b8;font-size:10px}
@media print{body{padding:14px}}
</style></head><body>
<p class="org">Kapelan CRM · Ордер монтажа кондиционера</p>
<h1>Ордер монтажа #${shortId(o.id)}</h1>
<p class="meta">Статус: <b>${st.label}</b> · Источник: ${o.source === "ai" ? "AI-анализ" : "Ручной ввод"} · Сформировано: ${nowStr}</p>
<div class="section"><p class="section-title">Клиент и объект</p>
<div class="grid">
<div class="field"><label>Клиент</label><span>${o.clientName}</span></div>
<div class="field"><label>Телефон</label><span>${o.clientPhone}</span></div>
<div class="field"><label>Адрес объекта</label><span>${o.clientAddress}</span></div>
<div class="field"><label>Тип помещения</label><span>${o.roomType}</span></div>
<div class="field"><label>Площадь</label><span>${o.roomArea} м²</span></div>
<div class="field"><label>Длина трассы</label><span>${o.traceLength} м</span></div>
</div></div>
<div class="section"><p class="section-title">Оборудование</p>
<div class="grid">
<div class="field"><label>Производитель</label><span>${o.acBrand}</span></div>
<div class="field"><label>Модель</label><span>${o.acModelName}</span></div>
<div class="field"><label>Мощность</label><span>${o.acBtu} BTU / ${o.acKw} кВт</span></div>
<div class="field"><label>Кол-во единиц</label><span>${o.acCount} шт.</span></div>
${o.installerName ? `<div class="field"><label>Монтажник</label><span>${o.installerName}</span></div>` : ""}
${o.scheduledDate ? `<div class="field"><label>Дата монтажа</label><span>${new Date(o.scheduledDate).toLocaleDateString("ru-RU")}</span></div>` : ""}
</div></div>
<div class="section"><p class="section-title">Перечень расходных материалов</p>
<table><thead><tr><th>#</th><th>Наименование</th><th>Ед.</th><th style="text-align:right">Нужно</th><th style="text-align:right">На складе</th><th style="text-align:right">Выдано</th></tr></thead>
<tbody>${consumableRows}</tbody></table></div>
${o.notes ? `<div class="section"><p class="section-title">Примечания</p><p style="font-size:12px">${o.notes}</p></div>` : ""}
<div class="sig-block">
<div class="sig"><div class="sig-line">Ответственный менеджер / подпись</div></div>
<div class="sig"><div class="sig-line">Монтажник / подпись о получении</div></div>
</div>
<div class="footer"><span>Kapelan CRM · Ордера монтажа</span><span>${nowStr}</span></div>
</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-slate-600 p-1">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-xs text-slate-400 font-mono">#{shortId(o.id)}</span>
              {o.source === "ai" && <span className="text-[9px] bg-violet-100 text-violet-700 font-bold px-1.5 py-0.5 rounded-full">AI</span>}
              <span className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${st.bg} ${st.color}`}>
                {st.icon} {st.label}
              </span>
            </div>
            <p className="font-bold text-slate-800 mt-0.5 truncate">{o.clientName} · {o.acBrand} {o.acBtu / 1000}k BTU</p>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button onClick={printWorkOrder} title="Печать ордера"
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all">
              <Printer size={16} />
            </button>
            {role === "admin" && (
              <button onClick={doDelete} title="Удалить ордер"
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Status timeline */}
        <div className="flex items-center gap-0 mt-3 mb-1">
          {STATUS_STEPS.map((s, i) => {
            const cfg = STATUS_CFG[s];
            const isDone = i < stepIdx;
            const isCur  = i === stepIdx;
            return (
              <div key={s} className="flex-1 flex items-center">
                <div className={`flex flex-col items-center flex-shrink-0 ${i === 0 ? "" : ""}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border-2 transition-all ${
                    isCur ? `${cfg.bg} border-current ${cfg.color} scale-110 shadow-sm` :
                    isDone ? "bg-teal-100 border-teal-400 text-teal-600" :
                    "bg-slate-50 border-slate-200 text-slate-300"
                  }`}>
                    {isDone ? <CheckCircle2 size={12} /> : isCur ? cfg.icon : <span className="text-[8px] font-bold">{i + 1}</span>}
                  </div>
                  <p className={`text-[8px] mt-0.5 font-semibold leading-tight text-center w-14 ${isCur ? cfg.color : isDone ? "text-teal-600" : "text-slate-300"}`}>
                    {cfg.label}
                  </p>
                </div>
                {i < STATUS_STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 rounded-full ${isDone || isCur ? "bg-teal-300" : "bg-slate-100"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-white border-b border-slate-200 flex-shrink-0">
        {[{ key: "info", label: "Информация" }, { key: "consumables", label: `Расходники (${o.consumables.length})` }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`flex-1 py-2.5 text-xs font-bold border-b-2 transition-all ${
              tab === t.key ? "border-teal-500 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto bg-slate-50">
        {tab === "info" ? (
          <InfoTab order={o} showAssign={showAssign} setShowAssign={setShowAssign}
            editInstaller={editInstaller} setEditInstaller={setEditInstaller}
            editDate={editDate} setEditDate={setEditDate}
            onAssign={doAssign} />
        ) : (
          <ConsumablesTab order={o} shortages={shortages} />
        )}
      </div>

      {/* Action footer — Manager/Admin view */}
      {role !== "installer" && o.status !== "completed" && o.status !== "cancelled" && (
        <div className="bg-white border-t border-slate-200 px-4 py-3 flex-shrink-0 space-y-2">
          {shortages.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <p className="text-xs font-bold text-red-700 mb-1">⚠️ Нехватка на складе:</p>
              {shortages.map((s, i) => <p key={i} className="text-xs text-red-600">• {s}</p>)}
            </div>
          )}
          {o.status === "draft" && (
            <button onClick={doConfirm} disabled={!!acting}
              className="w-full bg-blue-600 text-white py-3 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60">
              {acting ? <Loader2 className="animate-spin mx-auto" size={18} /> : "✅ Подтвердить ордер"}
            </button>
          )}
          {o.status === "confirmed" && !showAssign && (
            <button onClick={() => { setShowAssign(true); setTab("info"); }}
              className="w-full bg-violet-600 text-white py-3 rounded-2xl font-black text-sm active:scale-95">
              👤 Назначить монтажника
            </button>
          )}
          {(o.status === "confirmed" || o.status === "assigned") && !o.consumablesIssued && (
            <button onClick={() => { setShortages([]); doAction("issue", undefined, "issue"); }} disabled={!!acting}
              className="w-full bg-amber-600 text-white py-3 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60">
              {acting === "issue" ? <Loader2 className="animate-spin mx-auto" size={18} /> : "🚀 Монтажники приступили — списать материалы"}
            </button>
          )}
          {o.status === "in_progress" && (
            <div className="flex gap-2">
              <button onClick={() => doAction("pause", {}, "pause")} disabled={!!acting}
                className="flex-1 bg-orange-500 text-white py-3 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60">
                {acting === "pause" ? <Loader2 className="animate-spin mx-auto" size={18} /> : "⏸ Пауза"}
              </button>
              <button onClick={() => doAction("complete", {}, "complete")} disabled={!!acting}
                className="flex-1 bg-emerald-600 text-white py-3 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60">
                {acting === "complete" ? <Loader2 className="animate-spin mx-auto" size={18} /> : "🏁 Завершить"}
              </button>
            </div>
          )}
          {o.status === "paused" && (
            <div className="flex gap-2">
              <button onClick={() => doAction("resume", {}, "resume")} disabled={!!acting}
                className="flex-1 bg-amber-500 text-white py-3 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60">
                {acting === "resume" ? <Loader2 className="animate-spin mx-auto" size={18} /> : "▶️ Возобновить"}
              </button>
              <button onClick={() => doAction("complete", {}, "complete")} disabled={!!acting}
                className="flex-1 bg-emerald-600 text-white py-3 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60">
                {acting === "complete" ? <Loader2 className="animate-spin mx-auto" size={18} /> : "🏁 Завершить"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Action footer — Installer view */}
      {role === "installer" && o.status !== "completed" && o.status !== "cancelled" && (
        <div className="bg-white border-t border-slate-200 px-4 py-3 flex-shrink-0 space-y-2">
          {(o.status === "assigned" || o.status === "confirmed") && !o.consumablesIssued && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
              <p className="text-sm font-bold text-amber-800">⏳ Ожидание выдачи материалов</p>
              <p className="text-xs text-amber-600 mt-1">Менеджер должен выдать материалы со склада</p>
            </div>
          )}
          {o.status === "assigned" && o.consumablesIssued && (
            <button onClick={() => { setShortages([]); doAction("issue", undefined, "issue"); }} disabled={!!acting}
              className="w-full bg-amber-600 text-white py-3.5 rounded-2xl font-black text-sm active:scale-95">
              🚀 Приступить к работе — материалы получены
            </button>
          )}
          {o.status === "in_progress" && (
            <div className="space-y-2">
              <button onClick={() => doAction("pause", {}, "pause")} disabled={!!acting}
                className="w-full bg-orange-500 text-white py-3 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60">
                {acting === "pause" ? <Loader2 className="animate-spin mx-auto" size={18} /> : "⏸ Взять паузу (продолжу завтра)"}
              </button>
              <button onClick={() => doAction("complete", {}, "complete")} disabled={!!acting}
                className="w-full bg-emerald-600 text-white py-3.5 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60">
                {acting === "complete" ? <Loader2 className="animate-spin mx-auto" size={18} /> : "✅ Монтаж выполнен — завершить"}
              </button>
            </div>
          )}
          {o.status === "paused" && (
            <div className="space-y-2">
              <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 text-center">
                <p className="text-xs font-bold text-orange-700">⏸ Монтаж приостановлен</p>
                <p className="text-xs text-orange-600">Продолжите когда будете готовы</p>
              </div>
              <button onClick={() => doAction("resume", {}, "resume")} disabled={!!acting}
                className="w-full bg-amber-500 text-white py-3 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60">
                {acting === "resume" ? <Loader2 className="animate-spin mx-auto" size={18} /> : "▶️ Продолжить монтаж"}
              </button>
              <button onClick={() => doAction("complete", {}, "complete")} disabled={!!acting}
                className="w-full bg-emerald-600 text-white py-3 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60">
                {acting === "complete" ? <Loader2 className="animate-spin mx-auto" size={18} /> : "✅ Завершить монтаж"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Info tab ─────────────────────────────────────────────────────────────────
function InfoTab({ order: o, showAssign, setShowAssign, editInstaller, setEditInstaller, editDate, setEditDate, onAssign }: any) {
  return (
    <div className="p-4 space-y-3">
      {/* AI analysis badge */}
      {o.aiAnalysis && (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} className="text-violet-600" />
            <p className="text-xs font-bold text-violet-700 uppercase tracking-wide">AI-анализ помещения</p>
          </div>
          <p className="text-xs text-violet-700 leading-relaxed">{o.aiAnalysis.imageDescription}</p>
          {o.aiAnalysis.notes && <p className="text-xs text-violet-600 mt-1.5 italic">💡 {o.aiAnalysis.notes}</p>}
        </div>
      )}

      {/* Client */}
      <InfoCard icon={<User size={14} className="text-teal-600" />} title="Клиент">
        <InfoRow label="Имя" value={o.clientName || "—"} />
        <InfoRow label="Телефон" value={o.clientPhone || "—"} />
        <InfoRow label="Адрес" value={o.clientAddress || "—"} />
      </InfoCard>

      {/* Room */}
      <InfoCard icon={<Building2 size={14} className="text-teal-600" />} title="Помещение">
        <InfoRow label="Тип" value={o.roomType} />
        <InfoRow label="Площадь" value={`${o.roomArea} м²`} />
        <InfoRow label="Длина трассы" value={`${o.traceLength} м`} />
      </InfoCard>

      {/* AC */}
      <InfoCard icon={<Thermometer size={14} className="text-teal-600" />} title="Кондиционер">
        <InfoRow label="Производитель" value={o.acBrand} />
        <InfoRow label="Модель" value={o.acModelName} />
        <InfoRow label="Мощность" value={`${o.acBtu} BTU / ${o.acKw} кВт`} />
        <InfoRow label="Количество" value={`${o.acCount} шт. × ${fmtShort(o.acPrice)}`} />
      </InfoCard>

      {/* Assignment */}
      <InfoCard icon={<Calendar size={14} className="text-teal-600" />} title="Назначение">
        {showAssign ? (
          <div className="space-y-2 pt-1">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Имя монтажника</label>
              <input value={editInstaller} onChange={e => setEditInstaller(e.target.value)}
                placeholder="Иванов Иван Иванович"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Дата монтажа</label>
              <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={onAssign} className="flex-1 bg-violet-600 text-white py-2 rounded-xl text-xs font-bold active:scale-95">
                Назначить
              </button>
              <button onClick={() => setShowAssign(false)} className="flex-1 bg-slate-100 text-slate-600 py-2 rounded-xl text-xs font-bold active:scale-95">
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <>
            <InfoRow label="Монтажник" value={o.installerName || "Не назначен"} />
            <InfoRow label="Дата монтажа" value={o.scheduledDate ? new Date(o.scheduledDate).toLocaleDateString("ru-RU") : "Не указана"} />
          </>
        )}
      </InfoCard>

      {o.notes && (
        <InfoCard icon={<AlertCircle size={14} className="text-teal-600" />} title="Примечания">
          <p className="text-sm text-slate-700 leading-relaxed">{o.notes}</p>
        </InfoCard>
      )}
    </div>
  );
}

function InfoCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-50">
        {icon}
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{title}</p>
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-slate-400 flex-shrink-0">{label}</span>
      <span className="text-xs font-semibold text-slate-700 text-right">{value}</span>
    </div>
  );
}

// ── Consumables tab ──────────────────────────────────────────────────────────
function ConsumablesTab({ order: o, shortages }: { order: InstallOrder; shortages: string[] }) {
  const totalCols = o.consumables.length;
  const insufficient = o.consumables.filter(c => c.stockSnapshot < c.qtyRequired).length;
  return (
    <div className="p-4">
      {/* Summary badges */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <div className="bg-slate-100 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600">
          {totalCols} позиций
        </div>
        {insufficient > 0 ? (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-red-600 flex items-center gap-1">
            <TriangleAlert size={11} /> {insufficient} нет на складе
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-emerald-600">
            ✅ Все позиции в наличии
          </div>
        )}
        {o.consumablesIssued && (
          <div className="bg-teal-50 border border-teal-200 rounded-xl px-3 py-1.5 text-xs font-bold text-teal-700">
            📦 Материалы выданы
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-3 py-2.5 text-left font-semibold text-slate-500">Наименование</th>
              <th className="px-3 py-2.5 text-right font-semibold text-slate-500">Нужно</th>
              <th className="px-3 py-2.5 text-right font-semibold text-slate-500">На складе</th>
              {o.consumablesIssued && <th className="px-3 py-2.5 text-right font-semibold text-slate-500">Выдано</th>}
            </tr>
          </thead>
          <tbody>
            {o.consumables.map((c, i) => {
              const enough = c.stockSnapshot >= c.qtyRequired;
              const isShortage = shortages.some(s => s.includes(c.name));
              return (
                <tr key={i} className={`border-b border-slate-50 ${!enough ? "bg-red-50/40" : ""}`}>
                  <td className="px-3 py-2 font-medium text-slate-700 leading-tight">{c.name}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800 whitespace-nowrap">
                    {c.qtyRequired} <span className="text-slate-400 font-normal">{c.unit}</span>
                  </td>
                  <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${enough ? "text-emerald-600" : "text-red-600"}`}>
                    {c.stockSnapshot} <span className="text-slate-400 font-normal">{c.unit}</span>
                    {!enough && <span className="ml-1">⚠️</span>}
                  </td>
                  {o.consumablesIssued && (
                    <td className="px-3 py-2 text-right font-bold text-teal-600 whitespace-nowrap">
                      {c.qtyIssued} <span className="text-slate-400 font-normal">{c.unit}</span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CREATE ORDER MODAL
// ══════════════════════════════════════════════════════════════════════════════
function CreateOrderModal({ onClose, onCreated, prefillLeadId }: {
  onClose: () => void;
  onCreated: (o: InstallOrder) => void;
  prefillLeadId?: string | null;
}) {
  const [mode, setMode] = useState<null | "ai" | "manual">(prefillLeadId ? "manual" : null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 text-base">
              {!mode ? "Новый ордер монтажа" : mode === "ai" ? "🤖 AI-анализ помещения" : "📝 Ручное создание ордера"}
            </h2>
            {mode && <p className="text-xs text-slate-400 mt-0.5">Нажмите «Отмена» чтобы сменить режим</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-all">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!mode ? (
            <ModeSelector onSelect={setMode} />
          ) : mode === "ai" ? (
            <AIOrderFlow onCreated={onCreated} onBack={() => setMode(null)} />
          ) : (
            <ManualOrderFlow onCreated={onCreated} onBack={() => setMode(null)} prefillLeadId={prefillLeadId} />
          )}
        </div>
      </div>
    </div>
  );
}

function ModeSelector({ onSelect }: { onSelect: (m: "ai" | "manual") => void }) {
  return (
    <div className="p-6">
      <p className="text-sm text-slate-500 text-center mb-6">Выберите способ создания ордера</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button onClick={() => onSelect("ai")}
          className="group flex flex-col items-center gap-4 p-6 rounded-2xl border-2 border-violet-200 bg-violet-50 hover:border-violet-400 hover:bg-violet-100 active:scale-95 transition-all text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-200">
            <Sparkles size={28} className="text-white" />
          </div>
          <div>
            <p className="font-black text-slate-800 mb-1">AI-анализ помещения</p>
            <p className="text-xs text-slate-500 leading-relaxed">Загрузите фото или план помещения — AI автоматически определит площадь, подберёт модель кондиционера и рассчитает расходники</p>
          </div>
          <span className="text-xs bg-violet-600 text-white font-bold px-4 py-1.5 rounded-full">Рекомендуем</span>
        </button>

        <button onClick={() => onSelect("manual")}
          className="group flex flex-col items-center gap-4 p-6 rounded-2xl border-2 border-slate-200 bg-slate-50 hover:border-teal-300 hover:bg-teal-50 active:scale-95 transition-all text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center shadow-lg shadow-slate-200">
            <ClipboardCheck size={28} className="text-white" />
          </div>
          <div>
            <p className="font-black text-slate-800 mb-1">Ручное создание</p>
            <p className="text-xs text-slate-500 leading-relaxed">Укажите параметры вручную: клиент, помещение, выберите модель из каталога — система автоматически рассчитает расходники</p>
          </div>
          <span className="text-xs bg-slate-600 text-white font-bold px-4 py-1.5 rounded-full">Полный контроль</span>
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// AI ORDER FLOW
// ══════════════════════════════════════════════════════════════════════════════
function AIOrderFlow({ onCreated, onBack }: { onCreated: (o: InstallOrder) => void; onBack: () => void }) {
  const [step, setStep] = useState<"upload" | "analyzing" | "review" | "form">("upload");
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [suggestedAcId, setSuggestedAcId] = useState("");
  const [catalog, setCatalog] = useState<AcModel[]>([]);
  const [preview, setPreview] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    clientName: "", clientPhone: "", clientAddress: "",
    acModelId: "", traceLength: 5, roomArea: 0, roomType: "", notes: "",
    installerName: "", scheduledDate: "",
  });
  const [consumables, setConsumables] = useState<OrderConsumable[]>([]);
  const [loadingConsumables, setLoadingConsumables] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    fetch(`${API}/install-orders/catalog`, { headers: AH })
      .then(r => r.json()).then(d => { if (d.catalog) setCatalog(d.catalog); });
  }, []);

  // Update consumables preview when AC or trace changes
  useEffect(() => {
    if (!form.acModelId || form.traceLength < 1) return;
    setLoadingConsumables(true);
    fetch(`${API}/install-orders/preview`, {
      method: "POST", headers: JH,
      body: JSON.stringify({ acModelId: form.acModelId, traceLength: form.traceLength }),
    }).then(r => r.json()).then(d => {
      if (d.consumables) setConsumables(d.consumables);
    }).finally(() => setLoadingConsumables(false));
  }, [form.acModelId, form.traceLength]);

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFile(file: File) {
    setErrMsg("");
    setPreview(URL.createObjectURL(file));
    setStep("analyzing");
    try {
      const imageBase64 = await fileToBase64(file);
      const res = await fetch(`${API}/install-orders/analyze`, {
        method: "POST", headers: JH,
        body: JSON.stringify({ imageBase64, mimeType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) { setErrMsg(data.error || "Ошибка AI-анализа"); setStep("upload"); return; }
      setAnalysis(data.analysis);
      setSuggestedAcId(data.suggestedAcModelId);
      setForm(f => ({
        ...f,
        acModelId: data.suggestedAcModelId,
        traceLength: data.analysis.traceLength ?? 5,
        roomArea: data.analysis.area ?? 0,
        roomType: data.analysis.roomType ?? "Квартира",
      }));
      setStep("review");
    } catch (e: any) {
      setErrMsg("Ошибка соединения: " + e.message);
      setStep("upload");
    }
  }

  async function handleCreate() {
    if (!form.clientName || !form.clientPhone || !form.acModelId) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/install-orders`, {
        method: "POST", headers: JH,
        body: JSON.stringify({
          ...form,
          source: "ai",
          aiAnalysis: analysis,
          acCount: 1,
        }),
      });
      const data = await res.json();
      if (res.ok) onCreated(data.order);
    } finally { setSaving(false); }
  }

  const selectedAc = catalog.find(m => m.id === form.acModelId);

  if (step === "upload") return (
    <div className="p-6">
      {errMsg && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
          <p className="text-sm text-red-700 font-semibold">⚠️ {errMsg}</p>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); }}
        className="border-2 border-dashed border-violet-300 rounded-2xl p-12 text-center cursor-pointer hover:border-violet-500 hover:bg-violet-50 transition-all">
        <Upload size={40} className="text-violet-400 mx-auto mb-4" />
        <p className="font-bold text-slate-700 mb-1">Загрузите фото или план помещения</p>
        <p className="text-sm text-slate-400">Перетащите файл или нажмите для выбора</p>
        <p className="text-xs text-slate-300 mt-2">JPG, PNG, PDF · AI определит площадь, тип и рекомендует кондиционер</p>
      </div>
      <button onClick={onBack} className="w-full mt-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 font-medium">
        ← Сменить способ создания
      </button>
    </div>
  );

  if (step === "analyzing") return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center relative">
        <Sparkles size={28} className="text-violet-600" />
        <div className="absolute inset-0 rounded-2xl border-4 border-violet-300 border-t-violet-600 animate-spin" />
      </div>
      <p className="font-bold text-slate-700">AI анализирует изображение…</p>
      <p className="text-sm text-slate-400">Определяю площадь, тип помещения и параметры установки</p>
    </div>
  );

  if (step === "review" && analysis) return (
    <div className="p-5 space-y-4">
      {/* Image preview + AI result */}
      <div className="flex gap-4">
        {preview && <img src={preview} alt="Помещение" className="w-32 h-24 object-cover rounded-xl flex-shrink-0 shadow-sm" />}
        <div className="flex-1 bg-violet-50 border border-violet-200 rounded-xl p-3">
          <p className="text-xs font-bold text-violet-700 uppercase tracking-wide mb-2">Результат AI-анализа</p>
          <p className="text-xs text-violet-700 mb-2 italic">«{analysis.imageDescription}»</p>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div className="bg-white rounded-lg px-2 py-1.5"><span className="text-slate-400">Площадь:</span> <b>{analysis.area} м²</b></div>
            <div className="bg-white rounded-lg px-2 py-1.5"><span className="text-slate-400">Тип:</span> <b>{analysis.roomType}</b></div>
            <div className="bg-white rounded-lg px-2 py-1.5"><span className="text-slate-400">Рек. мощность:</span> <b>{analysis.recommendedBtu} BTU</b></div>
            <div className="bg-white rounded-lg px-2 py-1.5"><span className="text-slate-400">Трасса:</span> <b>{analysis.traceLength} м</b></div>
          </div>
          {analysis.notes && <p className="text-xs text-violet-600 mt-2">💡 {analysis.notes}</p>}
        </div>
      </div>

      {/* Editable fields */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500 block mb-1">Площадь (м²)</label>
          <input type="number" value={form.roomArea} onChange={e => setForm(f => ({ ...f, roomArea: +e.target.value }))}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 block mb-1">Длина трассы (м)</label>
          <input type="number" min={3} max={30} value={form.traceLength} onChange={e => setForm(f => ({ ...f, traceLength: +e.target.value }))}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>
      </div>

      {/* AC selection */}
      <div>
        <label className="text-xs font-semibold text-slate-500 block mb-2">Кондиционер</label>
        <AcSelectorGrid catalog={catalog} selected={form.acModelId} onSelect={id => setForm(f => ({ ...f, acModelId: id }))} suggestedId={suggestedAcId} filterArea={form.roomArea} />
      </div>

      <button onClick={() => setStep("form")} disabled={!form.acModelId}
        className="w-full bg-violet-600 text-white py-3 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-50 shadow-lg shadow-violet-100">
        Далее — заполнить данные клиента →
      </button>
      <button onClick={onBack} className="w-full py-2 text-sm text-slate-400 hover:text-slate-600">
        ← Назад
      </button>
    </div>
  );

  // step === "form"
  return (
    <div className="p-5 space-y-4">
      <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <Thermometer size={16} className="text-teal-600 flex-shrink-0" />
        <div>
          <p className="text-xs font-bold text-teal-700">{selectedAc?.brand} {selectedAc?.model}</p>
          <p className="text-xs text-teal-600">{selectedAc?.btu} BTU · {form.roomArea} м² · трасса {form.traceLength} м</p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Данные клиента</p>
        <FormInput label="Имя клиента *" value={form.clientName} onChange={v => setForm(f => ({ ...f, clientName: v }))} placeholder="Иванов Иван Иванович" />
        <FormInput label="Телефон *" value={form.clientPhone} onChange={v => setForm(f => ({ ...f, clientPhone: v }))} placeholder="+380 XX XXX XX XX" />
        <FormInput label="Адрес объекта *" value={form.clientAddress} onChange={v => setForm(f => ({ ...f, clientAddress: v }))} placeholder="г. Киев, ул. Крещатик, 1, кв. 5" />
        <FormInput label="Монтажник (необязательно)" value={form.installerName} onChange={v => setForm(f => ({ ...f, installerName: v }))} placeholder="ФИО монтажника" />
        <div>
          <label className="text-xs font-semibold text-slate-500 block mb-1">Дата монтажа (необязательно)</label>
          <input type="date" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 block mb-1">Примечания</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
        </div>
      </div>

      {/* Consumables preview */}
      {consumables.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
            Расходники ({consumables.length} позиций)
          </p>
          {loadingConsumables ? (
            <div className="flex items-center gap-2 py-3 text-slate-400 text-sm"><Loader2 size={14} className="animate-spin" /> Пересчёт…</div>
          ) : (
            <ConsumablesPreview consumables={consumables} />
          )}
        </div>
      )}

      <button onClick={handleCreate} disabled={saving || !form.clientName || !form.clientPhone || !form.acModelId}
        className="w-full bg-teal-600 text-white py-3.5 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-50 shadow-lg shadow-teal-100">
        {saving ? <Loader2 className="animate-spin mx-auto" size={18} /> : "✅ Создать ордер монтажа"}
      </button>
      <button onClick={() => setStep("review")} className="w-full py-2 text-sm text-slate-400 hover:text-slate-600">
        ← Назад к выбору модели
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MANUAL ORDER FLOW
// ══════════════════════════════════════════════════════════════════════════════
function ManualOrderFlow({ onCreated, onBack, prefillLeadId }: {
  onCreated: (o: InstallOrder) => void; onBack: () => void; prefillLeadId?: string | null;
}) {
  const [catalog, setCatalog] = useState<AcModel[]>([]);
  const [consumables, setConsumables] = useState<OrderConsumable[]>([]);
  const [loadingConsumables, setLoadingConsumables] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leadInfo, setLeadInfo] = useState<{ source: string } | null>(null);
  const [form, setForm] = useState({
    clientName: "", clientPhone: "", clientAddress: "", roomType: "Квартира",
    roomArea: "", traceLength: "5", acModelId: "", acCount: "1",
    installerName: "", scheduledDate: "", notes: "",
  });

  useEffect(() => {
    fetch(`${API}/install-orders/catalog`, { headers: AH })
      .then(r => r.json()).then(d => { if (d.catalog) setCatalog(d.catalog); });
  }, []);

  // Prefill from lead
  useEffect(() => {
    if (!prefillLeadId) return;
    Promise.all([
      fetch(`${API}/lead/${prefillLeadId}`, { headers: AH }).then(r => r.json()),
    ]).then(([leadData]) => {
      const lead = leadData.lead;
      const client = leadData.client;
      const req = lead?.requirements_json || {};
      if (client) {
        setForm(f => ({
          ...f,
          clientName: client.name || "",
          clientPhone: client.phone || "",
          clientAddress: req.address || "",
          roomArea: req.area ? String(req.area) : "",
          roomType: req.roomType || "Квартира",
          acCount: req.roomsCount ? String(req.roomsCount) : "1",
          notes: req.additionalNotes || "",
        }));
        setLeadInfo({ source: lead.source });
      }
      // Auto-match AC
      if (req.area || req._acRecommendation) {
        const rec = req._acRecommendation;
        fetch(`${API}/ac-match`, {
          method: "POST", headers: JH,
          body: JSON.stringify({
            area: req.area,
            budget: req.budget,
            preferredTier: rec?.preferredTier,
            minBtu: rec?.minBtu,
          }),
        }).then(r => r.json()).then(d => {
          if (d.matches?.[0]) setForm(f => ({ ...f, acModelId: d.matches[0].id }));
        });
      }
    }).catch(() => {});
  }, [prefillLeadId]);

  useEffect(() => {
    if (!form.acModelId || !form.traceLength) return;
    setLoadingConsumables(true);
    fetch(`${API}/install-orders/preview`, {
      method: "POST", headers: JH,
      body: JSON.stringify({ acModelId: form.acModelId, traceLength: +form.traceLength }),
    }).then(r => r.json()).then(d => {
      if (d.consumables) setConsumables(d.consumables);
    }).finally(() => setLoadingConsumables(false));
  }, [form.acModelId, form.traceLength]);

  async function handleCreate() {
    if (!form.clientName || !form.clientPhone || !form.acModelId) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/install-orders`, {
        method: "POST", headers: JH,
        body: JSON.stringify({
          leadId: prefillLeadId || undefined,
          clientName: form.clientName, clientPhone: form.clientPhone,
          clientAddress: form.clientAddress, roomType: form.roomType,
          roomArea: +form.roomArea, traceLength: +form.traceLength,
          acModelId: form.acModelId, acCount: +form.acCount,
          installerName: form.installerName, scheduledDate: form.scheduledDate,
          notes: form.notes, source: "manual",
        }),
      });
      const data = await res.json();
      if (res.ok) onCreated(data.order);
    } finally { setSaving(false); }
  }

  const f = (key: string) => (v: string) => setForm(prev => ({ ...prev, [key]: v }));
  const filterArea = form.roomArea ? +form.roomArea : 0;
  const canCreate = form.clientName && form.clientPhone && form.acModelId;

  return (
    <div className="p-5 space-y-4">
      {/* Lead prefill banner */}
      {prefillLeadId && leadInfo && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-teal-600 flex-shrink-0" />
          <p className="text-xs text-teal-700 font-semibold">Данные загружены из заявки · AI подобрал модель</p>
        </div>
      )}
      {/* Client */}
      <section>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Клиент</p>
        <div className="space-y-2">
          <FormInput label="Имя клиента *" value={form.clientName} onChange={f("clientName")} placeholder="Иванов Иван Иванович" />
          <FormInput label="Телефон *" value={form.clientPhone} onChange={f("clientPhone")} placeholder="+380 XX XXX XX XX" />
          <FormInput label="Адрес объекта" value={form.clientAddress} onChange={f("clientAddress")} placeholder="г. Киев, ул. Крещатик, 1" />
        </div>
      </section>

      {/* Room */}
      <section>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Помещение</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">Тип помещения</label>
            <select value={form.roomType} onChange={e => setForm(p => ({ ...p, roomType: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white">
              {ROOM_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <FormInput label="Площадь (м²)" value={form.roomArea} onChange={f("roomArea")} placeholder="25" type="number" />
          <FormInput label="Длина трассы (м) *" value={form.traceLength} onChange={f("traceLength")} placeholder="5" type="number" />
          <FormInput label="Кол-во блоков" value={form.acCount} onChange={f("acCount")} placeholder="1" type="number" />
        </div>
      </section>

      {/* AC selection */}
      <section>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Модель кондиционера *</p>
        <AcSelectorGrid catalog={catalog} selected={form.acModelId} onSelect={id => setForm(p => ({ ...p, acModelId: id }))} filterArea={filterArea} />
      </section>

      {/* Assignment */}
      <section>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Монтажник (необязательно)</p>
        <div className="grid grid-cols-2 gap-2">
          <FormInput label="Монтажник" value={form.installerName} onChange={f("installerName")} placeholder="ФИО" />
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">Дата монтажа</label>
            <input type="date" value={form.scheduledDate} onChange={e => setForm(p => ({ ...p, scheduledDate: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
        </div>
        <div className="mt-2">
          <label className="text-xs font-semibold text-slate-500 block mb-1">Примечания</label>
          <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
        </div>
      </section>

      {/* Consumables */}
      {form.acModelId && (
        <section>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
            Расходники — автоматический расчёт
          </p>
          {loadingConsumables ? (
            <div className="flex items-center gap-2 py-3 text-slate-400 text-sm"><Loader2 size={14} className="animate-spin" /> Пересчёт…</div>
          ) : consumables.length > 0 ? (
            <ConsumablesPreview consumables={consumables} />
          ) : null}
        </section>
      )}

      <button onClick={handleCreate} disabled={saving || !canCreate}
        className="w-full bg-teal-600 text-white py-3.5 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-50 shadow-lg shadow-teal-100">
        {saving ? <Loader2 className="animate-spin mx-auto" size={18} /> : "✅ Создать ордер монтажа"}
      </button>
      <button onClick={onBack} className="w-full py-2 text-sm text-slate-400 hover:text-slate-600">
        ← Сменить способ создания
      </button>
    </div>
  );
}

// ── AC Selector ───────────────────────────────────────────────────────────────
function AcSelectorGrid({ catalog, selected, onSelect, filterArea, suggestedId }: {
  catalog: AcModel[]; selected: string; onSelect: (id: string) => void; filterArea?: number; suggestedId?: string;
}) {
  const [tier, setTier] = useState<string>("all");
  const filtered = catalog.filter(m => {
    const matchTier = tier === "all" || m.tier === tier;
    const matchArea = !filterArea || filterArea === 0 || (m.areaMin <= filterArea + 10 && m.areaMax >= filterArea - 5);
    return matchTier && matchArea;
  });

  return (
    <div>
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {[{ k: "all", l: "Все" }, { k: "economy", l: "Эконом" }, { k: "standard", l: "Стандарт" }, { k: "premium", l: "Премиум" }].map(t => (
          <button key={t.k} onClick={() => setTier(t.k)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
              tier === t.k ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
            }`}>{t.l}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-4">Нет моделей для данной площади</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {filtered.map(m => {
            const tc = TIER_CFG[m.tier];
            const isSel = m.id === selected;
            const isSugg = m.id === suggestedId;
            return (
              <button key={m.id} onClick={() => onSelect(m.id)}
                className={`w-full text-left rounded-xl border-2 px-3 py-2.5 transition-all active:scale-95 ${
                  isSel
                    ? "border-teal-500 bg-teal-50 shadow-sm"
                    : "border-slate-100 bg-white hover:border-teal-300"
                }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-sm font-bold text-slate-800">{m.brand}</p>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${tc.bg} ${tc.color} ${tc.border}`}>{tc.label}</span>
                      {isSugg && !isSel && <span className="text-[9px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">AI рекомендует</span>}
                    </div>
                    <p className="text-xs text-slate-500 truncate">{m.model}</p>
                    <div className="flex gap-3 mt-1 text-[10px] text-slate-400">
                      <span>{m.btu} BTU</span>
                      <span>{m.areaMin}–{m.areaMax} м²</span>
                      <span className="text-teal-600 font-semibold">{fmtShort(m.price)}</span>
                    </div>
                  </div>
                  {isSel && <CheckCircle2 size={18} className="text-teal-600 flex-shrink-0 mt-0.5" />}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Consumables preview ───────────────────────────────────────────────────────
function ConsumablesPreview({ consumables }: { consumables: OrderConsumable[] }) {
  const insufficient = consumables.filter(c => c.stockSnapshot < c.qtyRequired).length;
  return (
    <div>
      {insufficient > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-2 flex items-center gap-2">
          <TriangleAlert size={13} className="text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-700 font-semibold">{insufficient} позиций не хватает на складе — закупка нужна до выдачи</p>
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-3 py-2 text-left font-semibold text-slate-400">Материал</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-400">Нужно</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-400">Склад</th>
            </tr>
          </thead>
          <tbody>
            {consumables.map((c, i) => {
              const ok = c.stockSnapshot >= c.qtyRequired;
              return (
                <tr key={i} className={`border-b border-slate-50 ${!ok ? "bg-red-50/30" : ""}`}>
                  <td className="px-3 py-1.5 text-slate-700">{c.name}</td>
                  <td className="px-3 py-1.5 text-right font-bold text-slate-800">{c.qtyRequired} <span className="text-slate-400 font-normal">{c.unit}</span></td>
                  <td className={`px-3 py-1.5 text-right font-bold ${ok ? "text-emerald-600" : "text-red-500"}`}>
                    {c.stockSnapshot} {!ok && "⚠️"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Form input helper ─────────────────────────────────────────────────────────
function FormInput({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 block mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
    </div>
  );
}
