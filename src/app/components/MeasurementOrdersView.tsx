import { useState, useEffect, useCallback } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { useRole } from "./RoleContext";
import { useCurrency } from "./CurrencyContext";
import {
  Plus, Search, X, RefreshCw, Loader2, Calendar, User, MapPin,
  Phone, Clock, ClipboardCheck, CheckCircle2, XCircle, Ruler,
  Thermometer, Package, Calculator, ChevronRight, ChevronLeft,
  ArrowRight, Edit3, Trash2, AlertCircle, FileText, Zap,
  Home, Building2, Wrench, Save, Wind, DollarSign, SlidersHorizontal,
  Check, TriangleAlert
} from "lucide-react";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH  = { Authorization: `Bearer ${publicAnonKey}` };
const JH  = { ...AH, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
type MeasurementStatus =
  | "scheduled" | "in_progress" | "measured"
  | "offer_sent" | "approved" | "install_created" | "cancelled";

interface MeasurementConsumable {
  name: string; unit: string; qty: number; pricePerUnit?: number;
}
interface MeasurementOrder {
  id: string;
  leadId?: string;
  clientName: string; clientPhone: string; clientAddress: string; clientComment?: string;
  scheduledDate: string; assignedInstaller: string;
  status: MeasurementStatus;
  roomArea?: number; roomType?: string; traceLength?: number;
  acModelId?: string; acBrand?: string; acModel?: string; acBtu?: number; acPrice?: number;
  consumables?: MeasurementConsumable[];
  installerNotes?: string; measuredAt?: string;
  workCost?: number; totalOfferPrice?: number; offerNotes?: string; offerSentAt?: string;
  installDate?: string; installOrderId?: string;
  createdBy: string; createdAt: string; updatedAt: string;
}

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CFG: Record<MeasurementStatus, { label: string; color: string; bg: string; dot: string; icon: React.ReactNode }> = {
  scheduled:       { label: "Замер назначен",     color: "text-blue-700",    bg: "bg-blue-50 border-blue-200",    dot: "bg-blue-500",    icon: <Calendar size={12}/> },
  in_progress:     { label: "На объекте",         color: "text-amber-700",   bg: "bg-amber-50 border-amber-200",   dot: "bg-amber-500",   icon: <Wrench size={12}/> },
  measured:        { label: "Замер выполнен",      color: "text-teal-700",    bg: "bg-teal-50 border-teal-200",     dot: "bg-teal-500",    icon: <Ruler size={12}/> },
  offer_sent:      { label: "КП отправлено",       color: "text-purple-700",  bg: "bg-purple-50 border-purple-200", dot: "bg-purple-500",  icon: <FileText size={12}/> },
  approved:        { label: "КП одобрено",         color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500", icon: <CheckCircle2 size={12}/> },
  install_created: { label: "Ордер на монтаж",    color: "text-indigo-700",  bg: "bg-indigo-50 border-indigo-200", dot: "bg-indigo-500",  icon: <ClipboardCheck size={12}/> },
  cancelled:       { label: "Отменён",             color: "text-red-600",     bg: "bg-red-50 border-red-200",       dot: "bg-red-400",     icon: <XCircle size={12}/> },
};

// Status flow steps (for stepper display)
const STATUS_STEPS: MeasurementStatus[] = ["scheduled", "in_progress", "measured", "offer_sent", "approved", "install_created"];

const ROOM_TYPES = ["Квартира", "Спальня", "Гостиная", "Кухня", "Офис", "Магазин", "Склад", "Серверная", "Другое"];
const INSTALLERS = ["Иван Петров", "Алексей Смирнов", "Дмитрий Козлов", "Сергей Иванов", "Михаил Новиков"];

const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString("ru-RU", { day:"2-digit", month:"2-digit", year:"2-digit" }) : "—";
const fmtDateTime = (s: string) => s ? new Date(s).toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : "—";
const shortId = (id: string) => id.slice(-6).toUpperCase();

function useToast() {
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const show = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3200);
  }, []);
  return { toast, show };
}

// ═══════════════════════════════════════════════════════════════════════════════
export function MeasurementOrdersView() {
  const { role, userName } = useRole();
  const { fmtShort } = useCurrency();
  const { toast, show } = useToast();

  const [orders, setOrders] = useState<MeasurementOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedOrder, setSelectedOrder] = useState<MeasurementOrder | null>(null);
  const [mode, setMode] = useState<"list" | "create" | "measure" | "offer">("list");

  // ── Form states ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState<Partial<MeasurementOrder>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/measurement-orders`, { headers: AH });
      const data = await res.json();
      if (data.orders) setOrders(data.orders);
    } catch { show("Ошибка загрузки", false); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = orders.filter(o => {
    const q = search.toLowerCase();
    const matchSearch = !q || o.clientName.toLowerCase().includes(q)
      || o.clientPhone.includes(q) || o.clientAddress.toLowerCase().includes(q)
      || o.assignedInstaller.toLowerCase().includes(q);
    const matchStatus = filterStatus === "all" || o.status === filterStatus;
    return matchSearch && matchStatus;
  });

  // ── Status change ─────────────────────────────────────────────────────────────
  async function changeStatus(order: MeasurementOrder, newStatus: MeasurementStatus) {
    try {
      const res = await fetch(`${API}/measurement-orders/${order.id}`, {
        method: "PATCH", headers: JH, body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.error) { show(data.error, false); return; }
      setOrders(prev => prev.map(o => o.id === order.id ? data.order : o));
      setSelectedOrder(data.order);
      show(`✅ Статус изменён: ${STATUS_CFG[newStatus].label}`);
    } catch (e: any) { show(e.message, false); }
  }

  // ── Create measurement order ──────────────────────────────────────────────────
  async function createOrder() {
    if (!form.clientName?.trim()) { show("Укажите имя клиента", false); return; }
    if (!form.clientPhone?.trim()) { show("Укажите телефон", false); return; }
    if (!form.clientAddress?.trim()) { show("Укажите адрес", false); return; }
    if (!form.scheduledDate) { show("Укажите дату замера", false); return; }
    if (!form.assignedInstaller) { show("Назначьте монтажника", false); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/measurement-orders`, {
        method: "POST", headers: JH, body: JSON.stringify({ ...form, createdBy: userName }),
      });
      const data = await res.json();
      if (data.error) { show(data.error, false); return; }
      setOrders(prev => [data.order, ...prev]);
      setMode("list");
      setForm({});
      show("📐 Ордер на замер создан!");
    } catch (e: any) { show(e.message, false); }
    finally { setSaving(false); }
  }

  // ── Save measurement results ──────────────────────────────────────────────────
  async function saveMeasurement() {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      const updates: Partial<MeasurementOrder> = {
        roomArea: form.roomArea, roomType: form.roomType, traceLength: form.traceLength,
        acBrand: form.acBrand, acModel: form.acModel, acBtu: form.acBtu, acPrice: form.acPrice,
        consumables: form.consumables, installerNotes: form.installerNotes,
        status: "measured",
      };
      const res = await fetch(`${API}/measurement-orders/${selectedOrder.id}`, {
        method: "PATCH", headers: JH, body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.error) { show(data.error, false); return; }
      setOrders(prev => prev.map(o => o.id === selectedOrder.id ? data.order : o));
      setSelectedOrder(data.order);
      setMode("list");
      show("✅ Замер сохранён! Ожидает формирования КП.");
    } catch (e: any) { show(e.message, false); }
    finally { setSaving(false); }
  }

  // ── Save offer / КП ───────────────────────────────────────────────────────────
  async function saveOffer() {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      const updates: Partial<MeasurementOrder> = {
        workCost: form.workCost, totalOfferPrice: form.totalOfferPrice,
        offerNotes: form.offerNotes, installDate: form.installDate,
        status: "offer_sent", offerSentAt: new Date().toISOString(),
      };
      const res = await fetch(`${API}/measurement-orders/${selectedOrder.id}`, {
        method: "PATCH", headers: JH, body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.error) { show(data.error, false); return; }
      setOrders(prev => prev.map(o => o.id === selectedOrder.id ? data.order : o));
      setSelectedOrder(data.order);
      setMode("list");
      show("📄 КП сформировано и отправлено клиенту!");
    } catch (e: any) { show(e.message, false); }
    finally { setSaving(false); }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  async function deleteOrder(id: string) {
    if (!confirm("Удалить ордер на замер?")) return;
    try {
      await fetch(`${API}/measurement-orders/${id}`, { method: "DELETE", headers: AH });
      setOrders(prev => prev.filter(o => o.id !== id));
      if (selectedOrder?.id === id) { setSelectedOrder(null); setMode("list"); }
      show("🗑️ Ордер удалён");
    } catch (e: any) { show(e.message, false); }
  }

  const stats = {
    scheduled: orders.filter(o => o.status === "scheduled").length,
    in_progress: orders.filter(o => o.status === "in_progress").length,
    measured: orders.filter(o => o.status === "measured").length,
    offer_sent: orders.filter(o => o.status === "offer_sent" || o.status === "approved").length,
  };

  // ============================================================================
  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-5 py-3 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-bold text-slate-800">Ордера на замер</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {orders.length} ордеров · {stats.scheduled} назначено · {stats.measured} ждут КП
          </p>
        </div>
        {(role === "admin" || role === "manager") && (
          <button onClick={() => { setForm({ scheduledDate: new Date().toISOString().slice(0, 10) }); setMode("create"); }}
            className="flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-blue-700 active:scale-95 transition-all shadow-sm">
            <Plus size={15} /> Новый замер
          </button>
        )}
      </div>

      {/* ── Stat pills ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 py-2 flex gap-2 overflow-x-auto">
        {([
          ["all",         "Все",              orders.length, "bg-slate-800 text-white", "bg-slate-100 text-slate-500"],
          ["scheduled",   "Назначены",        stats.scheduled, "bg-blue-600 text-white", "bg-blue-50 text-blue-700"],
          ["in_progress", "На объекте",       stats.in_progress, "bg-amber-500 text-white", "bg-amber-50 text-amber-700"],
          ["measured",    "Ждут КП",          stats.measured, "bg-teal-600 text-white", "bg-teal-50 text-teal-700"],
          ["offer_sent",  "КП / Одобрено",    stats.offer_sent, "bg-purple-600 text-white", "bg-purple-50 text-purple-700"],
          ["install_created", "Монтаж создан", orders.filter(o=>o.status==="install_created").length, "bg-indigo-600 text-white", "bg-indigo-50 text-indigo-700"],
          ["cancelled",   "Отменены",         orders.filter(o=>o.status==="cancelled").length, "bg-red-500 text-white", "bg-red-50 text-red-600"],
        ] as [string, string, number, string, string][]).map(([val, label, count, activeClass, inactiveClass]) => (
          <button key={val} onClick={() => setFilterStatus(val)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${filterStatus === val ? activeClass : inactiveClass}`}>
            {label} <span className="opacity-70">({count})</span>
          </button>
        ))}
      </div>

      {/* ── Search ─────────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-100 flex-shrink-0 px-4 py-2">
        <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-2">
          <Search size={13} className="text-slate-400 flex-shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по клиенту, телефону, адресу, монтажнику…"
            className="bg-transparent text-sm flex-1 outline-none text-slate-700 placeholder-slate-400" />
          {search && <button onClick={() => setSearch("")}><X size={13} className="text-slate-400 hover:text-slate-600" /></button>}
        </div>
      </div>

      {/* ── Content area ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LIST */}
        <div className={`flex flex-col ${selectedOrder || mode !== "list" ? "hidden lg:flex lg:w-96 border-r border-slate-200" : "flex-1"} overflow-hidden`}>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 pb-8">
            {loading && orders.length === 0 ? (
              <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-300" size={28} /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <ClipboardCheck size={36} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium mb-3">
                  {filterStatus === "all" ? "Замеров пока нет" : `Нет замеров со статусом «${STATUS_CFG[filterStatus as MeasurementStatus]?.label}»`}
                </p>
                {(role === "admin" || role === "manager") && (
                  <button onClick={() => { setForm({ scheduledDate: new Date().toISOString().slice(0, 10) }); setMode("create"); }}
                    className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold">
                    + Создать первый ордер
                  </button>
                )}
              </div>
            ) : filtered.map(order => (
              <OrderCard key={order.id}
                order={order}
                isSelected={selectedOrder?.id === order.id}
                onClick={() => { setSelectedOrder(order); setMode("list"); }}
                fmtShort={fmtShort}
              />
            ))}
          </div>
        </div>

        {/* DETAIL / FORMS */}
        <div className={`flex-1 overflow-hidden flex flex-col ${!selectedOrder && mode === "list" ? "hidden lg:flex" : ""}`}>

          {/* ── CREATE FORM ───────────────────────────────────────────────────── */}
          {mode === "create" && (
            <CreateForm
              form={form} setForm={setForm}
              onSave={createOrder} saving={saving}
              onCancel={() => { setMode("list"); setForm({}); }}
              installers={INSTALLERS}
            />
          )}

          {/* ── MEASURE FORM (installer fills in data) ────────────────────────── */}
          {mode === "measure" && selectedOrder && (
            <MeasureForm
              order={selectedOrder}
              form={form} setForm={setForm}
              onSave={saveMeasurement} saving={saving}
              onCancel={() => setMode("list")}
              fmtShort={fmtShort}
            />
          )}

          {/* ── OFFER FORM (manager creates КП) ──────────────────────────────── */}
          {mode === "offer" && selectedOrder && (
            <OfferForm
              order={selectedOrder}
              form={form} setForm={setForm}
              onSave={saveOffer} saving={saving}
              onCancel={() => setMode("list")}
              fmtShort={fmtShort}
            />
          )}

          {/* ── ORDER DETAIL ─────────────────────────────────────────────────── */}
          {mode === "list" && selectedOrder && (
            <OrderDetail
              order={selectedOrder}
              role={role}
              fmtShort={fmtShort}
              onClose={() => setSelectedOrder(null)}
              onChangeStatus={changeStatus}
              onMeasure={() => { setForm({ ...selectedOrder }); setMode("measure"); }}
              onOffer={() => { setForm({ workCost: selectedOrder.workCost ?? 0, totalOfferPrice: selectedOrder.totalOfferPrice ?? 0, offerNotes: selectedOrder.offerNotes ?? "", installDate: selectedOrder.installDate ?? "" }); setMode("offer"); }}
              onDelete={() => deleteOrder(selectedOrder.id)}
            />
          )}

          {/* ── EMPTY ────────────────────────────────────────────────────────── */}
          {mode === "list" && !selectedOrder && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3 hidden lg:flex">
              <ClipboardCheck size={40} className="opacity-30" />
              <p className="text-sm">Выберите ордер из списка</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Toast ──────────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl shadow-xl text-white text-sm font-semibold whitespace-nowrap transition-all ${toast.ok ? "bg-green-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Order Card ───────────────────────────────────────────────────────────────
function OrderCard({ order, isSelected, onClick, fmtShort }: {
  order: MeasurementOrder; isSelected: boolean; onClick: () => void;
  fmtShort: (n: number) => string;
}) {
  const cfg = STATUS_CFG[order.status];
  const isUrgent = order.status === "measured"; // needs action from manager

  return (
    <div onClick={onClick}
      className={`rounded-2xl border p-3.5 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${
        isSelected ? "ring-2 ring-blue-500 border-blue-300 bg-blue-50" :
        isUrgent ? "border-amber-300 bg-amber-50/50" :
        "border-slate-200 bg-white"
      }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
              {cfg.icon} {cfg.label}
            </span>
            {isUrgent && <span className="text-[10px] font-bold text-amber-600 animate-pulse">● Ждёт КП</span>}
          </div>
          <p className="font-bold text-slate-800 text-sm mt-1.5 truncate">{order.clientName}</p>
          <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
            <Phone size={9} className="flex-shrink-0" />
            <span>{order.clientPhone}</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
            <MapPin size={9} className="flex-shrink-0" />
            <span className="truncate">{order.clientAddress}</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[10px] font-mono text-slate-400">#{shortId(order.id)}</p>
          <p className="text-[11px] font-semibold text-blue-700 mt-1">{fmtDate(order.scheduledDate)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-1 text-[11px] text-slate-500">
          <User size={10} />
          <span className="truncate max-w-[110px]">{order.assignedInstaller}</span>
        </div>
        {order.totalOfferPrice ? (
          <span className="text-xs font-black text-teal-700">{fmtShort(order.totalOfferPrice)}</span>
        ) : order.traceLength ? (
          <span className="text-[10px] text-slate-400">{order.traceLength}м трасса</span>
        ) : null}
        <ChevronRight size={14} className="text-slate-300" />
      </div>
    </div>
  );
}

// ─── Order Detail ─────────────────────────────────────────────────────────────
function OrderDetail({ order, role, fmtShort, onClose, onChangeStatus, onMeasure, onOffer, onDelete }: {
  order: MeasurementOrder; role: string; fmtShort: (n: number) => string;
  onClose: () => void; onChangeStatus: (o: MeasurementOrder, s: MeasurementStatus) => void;
  onMeasure: () => void; onOffer: () => void; onDelete: () => void;
}) {
  const cfg = STATUS_CFG[order.status];
  const stepIdx = STATUS_STEPS.indexOf(order.status);

  const can = {
    startVisit:    role !== "manager" && order.status === "scheduled",
    fillMeasure:   order.status === "in_progress",
    makeOffer:     (role === "admin" || role === "manager") && order.status === "measured",
    approveOffer:  (role === "admin" || role === "manager") && (order.status === "offer_sent"),
    createInstall: (role === "admin" || role === "manager") && order.status === "approved",
    cancel:        order.status !== "cancelled" && order.status !== "install_created",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-slate-200 bg-white flex items-center gap-3">
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all lg:hidden">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
              {cfg.icon} {cfg.label}
            </span>
            <span className="text-xs text-slate-400 font-mono">#{shortId(order.id)}</span>
          </div>
          <p className="font-bold text-slate-800 mt-0.5">{order.clientName}</p>
        </div>
        {can.cancel && (
          <button onClick={() => onChangeStatus(order, "cancelled")}
            className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition-all" title="Отменить">
            <XCircle size={16} />
          </button>
        )}
        <button onClick={onDelete}
          className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition-all" title="Удалить">
          <Trash2 size={16} />
        </button>
      </div>

      {/* Progress stepper */}
      <div className="flex-shrink-0 bg-slate-50 border-b border-slate-200 px-4 py-2.5">
        <div className="flex items-center gap-1">
          {STATUS_STEPS.map((s, i) => {
            const done = i <= stepIdx && order.status !== "cancelled";
            const active = i === stepIdx;
            return (
              <div key={s} className="flex items-center flex-1">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all text-[9px] font-black ${
                  done ? (active ? "bg-blue-600 text-white ring-2 ring-blue-300" : "bg-blue-100 text-blue-700") : "bg-slate-200 text-slate-400"
                }`}>
                  {done && !active ? <Check size={9} /> : i + 1}
                </div>
                {i < STATUS_STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-0.5 rounded-full ${i < stepIdx ? "bg-blue-300" : "bg-slate-200"}`} />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex mt-1">
          {STATUS_STEPS.map((s, i) => (
            <div key={s} className={`flex-1 text-[8px] font-semibold text-center leading-tight ${i === stepIdx ? "text-blue-600" : "text-slate-400"}`}>
              {STATUS_CFG[s].label.split(" ")[0]}
            </div>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Client info */}
        <Section title="Клиент" icon="👤">
          <InfoRow icon={<User size={13}/>} label="Имя">{order.clientName}</InfoRow>
          <InfoRow icon={<Phone size={13}/>} label="Телефон">
            <a href={`tel:${order.clientPhone}`} className="text-blue-600 font-semibold hover:underline">{order.clientPhone}</a>
          </InfoRow>
          <InfoRow icon={<MapPin size={13}/>} label="Адрес">{order.clientAddress}</InfoRow>
          {order.clientComment && <InfoRow icon={<FileText size={13}/>} label="Комментарий">{order.clientComment}</InfoRow>}
        </Section>

        {/* Scheduling */}
        <Section title="Замер" icon="📐">
          <InfoRow icon={<Calendar size={13}/>} label="Дата замера">{fmtDate(order.scheduledDate)}</InfoRow>
          <InfoRow icon={<User size={13}/>} label="Монтажник">{order.assignedInstaller}</InfoRow>
          {order.measuredAt && <InfoRow icon={<Check size={13}/>} label="Выполнен">{fmtDateTime(order.measuredAt)}</InfoRow>}
        </Section>

        {/* Measurement results */}
        {(order.roomArea || order.traceLength || order.acModel) && (
          <Section title="Результаты замера" icon="📊">
            {order.roomArea && <InfoRow icon={<Home size={13}/>} label="Площадь">{order.roomArea} м² · {order.roomType}</InfoRow>}
            {order.traceLength && <InfoRow icon={<Ruler size={13}/>} label="Длина трассы">{order.traceLength} м</InfoRow>}
            {order.acBrand && <InfoRow icon={<Thermometer size={13}/>} label="Кондиционер">
              {order.acBrand} {order.acModel} {order.acBtu ? `(${order.acBtu.toLocaleString()} BTU)` : ""}
            </InfoRow>}
            {order.acPrice && <InfoRow icon={<DollarSign size={13}/>} label="Цена оборудования">{fmtShort(order.acPrice)}</InfoRow>}
            {order.installerNotes && <InfoRow icon={<FileText size={13}/>} label="Заметки">{order.installerNotes}</InfoRow>}
          </Section>
        )}

        {/* Consumables */}
        {order.consumables && order.consumables.length > 0 && (
          <Section title="Расходники" icon="📦">
            <div className="space-y-1">
              {order.consumables.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-2.5 py-1.5">
                  <span className="text-slate-700 font-medium">{c.name}</span>
                  <span className="text-slate-500 flex-shrink-0">{c.qty} {c.unit}</span>
                  {c.pricePerUnit ? <span className="text-slate-400 flex-shrink-0 ml-2">{fmtShort(c.qty * c.pricePerUnit)}</span> : null}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* КП / Offer */}
        {order.workCost !== undefined && order.workCost > 0 && (
          <Section title="Коммерческое предложение" icon="📄">
            <InfoRow icon={<Wrench size={13}/>} label="Стоимость работ">{fmtShort(order.workCost)}</InfoRow>
            {order.acPrice && <InfoRow icon={<Wind size={13}/>} label="Оборудование">{fmtShort(order.acPrice)}</InfoRow>}
            {order.consumables?.length && (
              <InfoRow icon={<Package size={13}/>} label="Расходники">
                {fmtShort(order.consumables.reduce((s, c) => s + (c.qty * (c.pricePerUnit ?? 0)), 0))}
              </InfoRow>
            )}
            <div className="pt-2 border-t border-slate-100 mt-2">
              <InfoRow icon={<Calculator size={13}/>} label="ИТОГО">
                <span className="text-lg font-black text-teal-700">{fmtShort(order.totalOfferPrice ?? 0)}</span>
              </InfoRow>
            </div>
            {order.installDate && <InfoRow icon={<Calendar size={13}/>} label="Дата монтажа">{fmtDate(order.installDate)}</InfoRow>}
            {order.offerNotes && <InfoRow icon={<FileText size={13}/>} label="Условия">{order.offerNotes}</InfoRow>}
          </Section>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex-shrink-0 border-t border-slate-200 bg-white p-4 space-y-2">
        {can.startVisit && (
          <button onClick={() => onChangeStatus(order, "in_progress")}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 text-white font-bold py-3 rounded-xl hover:bg-amber-600 active:scale-95 transition-all">
            <Wrench size={16} /> Приступить к замеру
          </button>
        )}
        {can.fillMeasure && (
          <button onClick={onMeasure}
            className="w-full flex items-center justify-center gap-2 bg-teal-600 text-white font-bold py-3 rounded-xl hover:bg-teal-700 active:scale-95 transition-all">
            <Ruler size={16} /> Внести результаты замера
          </button>
        )}
        {can.makeOffer && (
          <button onClick={onOffer}
            className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white font-bold py-3 rounded-xl hover:bg-purple-700 active:scale-95 transition-all">
            <FileText size={16} /> Сформировать КП
          </button>
        )}
        {can.approveOffer && (
          <button onClick={() => onChangeStatus(order, "approved")}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white font-bold py-3 rounded-xl hover:bg-emerald-700 active:scale-95 transition-all">
            <CheckCircle2 size={16} /> Подтвердить КП (клиент согласен)
          </button>
        )}
        {can.createInstall && (
          <button onClick={() => onChangeStatus(order, "install_created")}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 active:scale-95 transition-all">
            <ClipboardCheck size={16} /> Создать ордер на монтаж
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Create Form ──────────────────────────────────────────────────────────────
function CreateForm({ form, setForm, onSave, saving, onCancel, installers }: any) {
  const f = <K extends keyof MeasurementOrder>(k: K, v: MeasurementOrder[K]) =>
    setForm((prev: any) => ({ ...prev, [k]: v }));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <FormHeader title="Новый ордер на замер" subtitle="Заявка → выезд монтажника" onCancel={onCancel} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        <FormSection title="Данные клиента">
          <Field label="Имя клиента *">
            <input value={form.clientName ?? ""} onChange={e => f("clientName", e.target.value)}
              placeholder="Иван Иванов" className={inputCls} />
          </Field>
          <Field label="Телефон *">
            <input value={form.clientPhone ?? ""} onChange={e => f("clientPhone", e.target.value)}
              placeholder="+375 XX XXX-XX-XX" className={inputCls} />
          </Field>
          <Field label="Адрес монтажа *">
            <input value={form.clientAddress ?? ""} onChange={e => f("clientAddress", e.target.value)}
              placeholder="г. Минск, ул. Ленина, д. 1, кв. 5" className={inputCls} />
          </Field>
          <Field label="Комментарий клиента">
            <textarea value={form.clientComment ?? ""} onChange={e => f("clientComment", e.target.value)}
              placeholder="Пожелания, ограничения, доп. информация…" rows={2} className={inputCls} />
          </Field>
        </FormSection>

        <FormSection title="Назначение">
          <Field label="Дата замера *">
            <input type="date" value={form.scheduledDate ?? ""} onChange={e => f("scheduledDate", e.target.value)}
              className={inputCls} />
          </Field>
          <Field label="Монтажник *">
            <select value={form.assignedInstaller ?? ""} onChange={e => f("assignedInstaller", e.target.value)}
              className={inputCls}>
              <option value="">— Выберите монтажника —</option>
              {installers.map((inst: string) => <option key={inst} value={inst}>{inst}</option>)}
            </select>
          </Field>
        </FormSection>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-600">
          <strong>💡 Дальнейший процесс:</strong> После создания ордера монтажник видит задачу, выезжает к клиенту, вносит замеры → вы формируете КП → назначаете дату монтажа.
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-slate-200 p-4 flex gap-3">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50">
          Отмена
        </button>
        <button onClick={onSave} disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-2.5 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Создать ордер
        </button>
      </div>
    </div>
  );
}

// ─── Measure Form ─────────────────────────────────────────────────────────────
function MeasureForm({ order, form, setForm, onSave, saving, onCancel, fmtShort }: any) {
  const f = (k: string, v: any) => setForm((prev: any) => ({ ...prev, [k]: v }));

  const [consumables, setConsumables] = useState<MeasurementConsumable[]>(
    form.consumables ?? order.consumables ?? [
      { name: "Медная труба 1/4\"",  unit: "м",    qty: 5,  pricePerUnit: 0 },
      { name: "Медная труба 3/8\"",  unit: "м",    qty: 5,  pricePerUnit: 0 },
      { name: "Теплоизоляция 9мм",  unit: "м",    qty: 5,  pricePerUnit: 0 },
      { name: "Кабель 3×1.5мм²",    unit: "м",    qty: 8,  pricePerUnit: 0 },
      { name: "Дренажная труба",     unit: "м",    qty: 5,  pricePerUnit: 0 },
      { name: "Кронштейны",         unit: "компл", qty: 1, pricePerUnit: 0 },
    ]
  );

  function updateConsumable(i: number, field: string, value: any) {
    setConsumables(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c));
  }
  function removeConsumable(i: number) {
    setConsumables(prev => prev.filter((_, idx) => idx !== i));
  }
  function addConsumable() {
    setConsumables(prev => [...prev, { name: "", unit: "шт", qty: 1, pricePerUnit: 0 }]);
  }

  const totalConsumables = consumables.reduce((s, c) => s + c.qty * (c.pricePerUnit ?? 0), 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <FormHeader
        title="Результаты замера"
        subtitle={`${order.clientName} · ${order.clientAddress}`}
        onCancel={onCancel}
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        <FormSection title="Параметры помещения">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Площадь, м²">
              <input type="number" min={1} value={form.roomArea ?? ""} onChange={e => f("roomArea", Number(e.target.value))}
                placeholder="25" className={inputCls} />
            </Field>
            <Field label="Тип помещения">
              <select value={form.roomType ?? ""} onChange={e => f("roomType", e.target.value)} className={inputCls}>
                <option value="">— выбрать —</option>
                {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Длина трассы, м (труба + кабель)">
            <input type="number" min={1} step={0.5} value={form.traceLength ?? ""}
              onChange={e => f("traceLength", Number(e.target.value))} placeholder="4" className={inputCls} />
          </Field>
        </FormSection>

        <FormSection title="Кондиционер">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Бренд">
              <input value={form.acBrand ?? ""} onChange={e => f("acBrand", e.target.value)}
                placeholder="Dantex" className={inputCls} />
            </Field>
            <Field label="Модель/Артикул">
              <input value={form.acModel ?? ""} onChange={e => f("acModel", e.target.value)}
                placeholder="RK-09S5AT2" className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="BTU">
              <input type="number" value={form.acBtu ?? ""} onChange={e => f("acBtu", Number(e.target.value))}
                placeholder="9000" className={inputCls} />
            </Field>
            <Field label="Цена оборудования">
              <input type="number" step="0.01" value={form.acPrice ?? ""} onChange={e => f("acPrice", Number(e.target.value))}
                placeholder="0" className={inputCls} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Расходники и материалы">
          <div className="space-y-1.5">
            {consumables.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input value={c.name} onChange={e => updateConsumable(i, "name", e.target.value)}
                  placeholder="Название" className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 ring-blue-400" />
                <input type="number" value={c.qty} min={0} step={0.5}
                  onChange={e => updateConsumable(i, "qty", Number(e.target.value))}
                  className="w-14 text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none text-center" />
                <select value={c.unit} onChange={e => updateConsumable(i, "unit", e.target.value)}
                  className="w-14 text-xs border border-slate-200 rounded-lg px-1 py-1.5 outline-none">
                  {["м", "шт", "кг", "компл", "рул"].map(u => <option key={u}>{u}</option>)}
                </select>
                <button onClick={() => removeConsumable(i)}
                  className="text-red-400 hover:text-red-600 p-1 rounded"><X size={13} /></button>
              </div>
            ))}
            <button onClick={addConsumable}
              className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 mt-1">
              <Plus size={12} /> Добавить позицию
            </button>
          </div>
        </FormSection>

        <FormSection title="Заметки монтажника">
          <textarea value={form.installerNotes ?? ""} onChange={e => f("installerNotes", e.target.value)}
            placeholder="Особенности монтажа, пожелания клиента на месте, проблемы доступа…"
            rows={3} className={inputCls} />
        </FormSection>
      </div>

      <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-4">
        <div className="text-xs text-slate-500">
          Расходники: <strong className="text-teal-700">{fmtShort(totalConsumables)}</strong>
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-white">
            Отмена
          </button>
          <button onClick={() => { setForm((prev: any) => ({ ...prev, consumables })); onSave(); }}
            disabled={saving}
            className="flex items-center gap-2 bg-teal-600 text-white font-bold px-5 py-2.5 rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-all">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Сохранить замер
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Offer Form ───────────────────────────────────────────────────────────────
function OfferForm({ order, form, setForm, onSave, saving, onCancel, fmtShort }: any) {
  const f = (k: string, v: any) => setForm((prev: any) => ({ ...prev, [k]: v }));

  const consumablesTotal = (order.consumables ?? []).reduce((s: number, c: MeasurementConsumable) => s + c.qty * (c.pricePerUnit ?? 0), 0);
  const acCost = order.acPrice ?? 0;
  const workCost = Number(form.workCost) || 0;
  const suggestedTotal = acCost + consumablesTotal + workCost;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <FormHeader
        title="Коммерческое предложение"
        subtitle={`${order.clientName} · замер ${fmtDate(order.measuredAt ?? "")}`}
        onCancel={onCancel}
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Cost breakdown summary */}
        <div className="bg-slate-800 text-white rounded-2xl p-4 space-y-2">
          <p className="text-xs font-bold text-slate-300 uppercase tracking-wider">Сводка расходов</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-300">Оборудование</span>
              <span className="font-semibold">{fmtShort(acCost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">Расходники</span>
              <span className="font-semibold">{fmtShort(consumablesTotal)}</span>
            </div>
            {order.traceLength && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Трасса {order.traceLength}м ({order.acBrand} {order.acModel})</span>
              </div>
            )}
            <div className="flex justify-between pt-1.5 border-t border-slate-700">
              <span className="text-slate-300">Работа (ввод ниже)</span>
              <span className="font-semibold text-amber-300">{fmtShort(workCost)}</span>
            </div>
          </div>
          <div className="flex justify-between pt-2 border-t border-slate-600 mt-2">
            <span className="font-bold">Предварительный итог</span>
            <span className="font-black text-teal-300 text-lg">{fmtShort(suggestedTotal)}</span>
          </div>
        </div>

        <FormSection title="Стоимость работ">
          <Field label="Стоимость монтажа (работа)">
            <input type="number" min={0} step={10} value={form.workCost ?? ""}
              onChange={e => f("workCost", Number(e.target.value))}
              placeholder="Введите стоимость работ" className={inputCls} />
          </Field>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700 flex items-start gap-2">
            <TriangleAlert size={13} className="flex-shrink-0 mt-0.5" />
            Типичная стоимость монтажа сплит-системы: 150–350 Br в зависимости от сложности трассы.
          </div>
        </FormSection>

        <FormSection title="Финальная цена для клиента">
          <Field label="Итоговая цена КП (можно скорректировать)">
            <div className="relative">
              <input type="number" min={0} step={10} value={form.totalOfferPrice ?? ""}
                onChange={e => f("totalOfferPrice", Number(e.target.value))}
                placeholder={suggestedTotal > 0 ? String(suggestedTotal) : "Итого для клиента"} className={inputCls} />
            </div>
          </Field>
          {suggestedTotal > 0 && (
            <button onClick={() => f("totalOfferPrice", suggestedTotal)}
              className="text-xs text-blue-600 font-semibold hover:underline">
              ← Использовать предварительный итог: {fmtShort(suggestedTotal)}
            </button>
          )}
        </FormSection>

        <FormSection title="Дата и условия монтажа">
          <Field label="Планируемая дата монтажа">
            <input type="date" value={form.installDate ?? ""} onChange={e => f("installDate", e.target.value)}
              className={inputCls} />
          </Field>
          <Field label="Условия / примечания к КП">
            <textarea value={form.offerNotes ?? ""} onChange={e => f("offerNotes", e.target.value)}
              placeholder="Гарантия 4 года на оборудование, 1 год на монтажные работы…"
              rows={3} className={inputCls} />
          </Field>
        </FormSection>
      </div>

      <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 flex gap-3">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-white">
          Отмена
        </button>
        <button onClick={onSave} disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 bg-purple-600 text-white font-bold py-2.5 rounded-xl hover:bg-purple-700 disabled:opacity-50 transition-all">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          Отправить КП клиенту
        </button>
      </div>
    </div>
  );
}

// ─── Small reusable UI ────────────────────────────────────────────────────────
const inputCls = "w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 ring-blue-400 bg-white";

function FormHeader({ title, subtitle, onCancel }: { title: string; subtitle: string; onCancel: () => void }) {
  return (
    <div className="flex-shrink-0 px-5 py-3.5 border-b border-slate-200 bg-white flex items-center gap-3">
      <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-all">
        <ChevronLeft size={18} />
      </button>
      <div>
        <p className="font-bold text-slate-800 text-sm">{title}</p>
        <p className="text-xs text-slate-400 truncate">{subtitle}</p>
      </div>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-2.5 bg-slate-50 border-b border-slate-100">{title}</p>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        {icon} {title}
      </p>
      <div className="p-4 space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="text-slate-400 mt-0.5 flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-slate-700 font-medium">{children}</p>
      </div>
    </div>
  );
}
