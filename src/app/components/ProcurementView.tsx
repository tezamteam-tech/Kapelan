import React, { useState, useEffect, useCallback } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { useCurrency } from "./CurrencyContext";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH  = { Authorization: `Bearer ${publicAnonKey}` };
const JH  = { ...AH, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
interface SupplierTerms {
  paymentDays: number; deliveryDays: number;
  minOrderAmount: number; currency: string;
}
interface Supplier {
  id: string; name: string; categories: string[];
  contactEmail: string; phone: string; address?: string;
  apiEndpoint: string; apiKey: string;
  terms: SupplierTerms; isActive: boolean; notes?: string;
  createdAt: string; updatedAt: string;
}
interface PurchaseOrder {
  id: string; itemId: string; itemName: string; itemUnit: string;
  qtyOrdered: number; qtyReceived: number;
  pricePerUnit: number; totalCost: number;
  supplier: string; status: "pending" | "ordered" | "received" | "cancelled";
  reason: "low_stock" | "manual"; note?: string;
  createdAt: string; updatedAt: string;
}
interface MockApiResponse {
  success: boolean; confirmationNumber: string; supplierOrderId: string;
  estimatedDeliveryDate: string; totalAmount: number; currency: string;
  message: string; requestedAt: string; respondedAt: string; httpStatus: number; payload: any;
}
interface ProcurementOrderLine {
  purchaseOrderId: string; itemId: string; itemName: string;
  sku: string; unit: string; qty: number;
  pricePerUnit: number; totalCost: number; category: string;
}
interface ProcurementOrder {
  id: string; supplierId: string; supplierName: string; supplierEmail: string;
  categories: string[]; lines: ProcurementOrderLine[];
  totalCost: number; status: "draft" | "sent" | "confirmed" | "cancelled" | "failed";
  sendAttempts: number; lastSentAt?: string;
  mockApiResponse?: MockApiResponse; note?: string;
  createdAt: string; updatedAt: string;
}
interface Stats {
  total: number; draft: number; sent: number; confirmed: number;
  failed: number; cancelled: number; totalSpend: number; activeSuppliers: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const PROC_STATUS: Record<ProcurementOrder["status"], { label: string; bg: string; text: string; dot: string; icon: string }> = {
  draft:     { label: "Черновик",    bg: "bg-slate-100",  text: "text-slate-600",  dot: "bg-slate-400",  icon: "📝" },
  sent:      { label: "Отправлено",  bg: "bg-blue-100",   text: "text-blue-700",   dot: "bg-blue-500",   icon: "📤" },
  confirmed: { label: "Подтверждено",bg: "bg-green-100",  text: "text-green-700",  dot: "bg-green-500",  icon: "✅" },
  failed:    { label: "Ошибка",      bg: "bg-red-100",    text: "text-red-700",    dot: "bg-red-500",    icon: "❌" },
  cancelled: { label: "Отменено",    bg: "bg-slate-100",  text: "text-slate-500",  dot: "bg-slate-400",  icon: "🚫" },
};
const CAT_ICONS: Record<string, string> = {
  "Трубопровод": "🔩", "Дренаж": "💧", "Электрика": "⚡", "Електрика": "⚡",
  "Крепёж": "🔧", "Расходники": "🧪", "Кондиционеры": "❄️", "Прочее": "📦",
};
const SUPPLIER_CATEGORY_GROUPS = [
  { label: "Трубы и дренаж",       cats: ["Трубопровод", "Дренаж"],            icon: "🔩", color: "blue"   },
  { label: "Провода и кабели",      cats: ["Электрика", "Електрика"],            icon: "⚡", color: "yellow" },
  { label: "Расходники",            cats: ["Расходники"],                        icon: "🧪", color: "purple" },
  { label: "Крепёж",               cats: ["Крепёж"],                            icon: "🔧", color: "slate"  },
  { label: "Кондиционеры",         cats: ["Кондиционеры"],                      icon: "❄️", color: "teal"   },
];
type ProcTab = "orders" | "suppliers" | "history";
const fmt = (n: number) => n.toLocaleString("ru-RU");

// ─── ProcurementView ──────────────────────────────────────────────────────────
export function ProcurementView() {
  const { fmtShort } = useCurrency();
  const fmt = fmtShort;
  const [tab, setTab] = useState<ProcTab>("orders");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pendingPOs, setPendingPOs] = useState<PurchaseOrder[]>([]);
  const [procOrders, setProcOrders] = useState<ProcurementOrder[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoBatching, setAutoBatching] = useState(false);

  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [selectedPOs, setSelectedPOs] = useState<Set<string>>(new Set());
  const [sendingOrderId, setSendingOrderId] = useState<string | null>(null);
  const [showBuildModal, setShowBuildModal] = useState(false);
  const [buildSupplierId, setBuildSupplierId] = useState<string>("");
  const [detailOrder, setDetailOrder] = useState<ProcurementOrder | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const showToast = useCallback((text: string, ok = true) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 4500);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [supRes, poRes, procRes, statRes] = await Promise.all([
        fetch(`${API}/suppliers`, { headers: AH }),
        fetch(`${API}/purchase-orders`, { headers: AH }),
        fetch(`${API}/procurement/orders`, { headers: AH }),
        fetch(`${API}/procurement/stats`, { headers: AH }),
      ]);
      const [supD, poD, procD, statD] = await Promise.all([
        supRes.json(), poRes.json(), procRes.json(), statRes.json()
      ]);
      if (supD.suppliers) setSuppliers(supD.suppliers);
      if (poD.orders) setPendingPOs(poD.orders.filter((o: PurchaseOrder) => o.status === "pending"));
      if (procD.orders) setProcOrders(procD.orders);
      if (statD.stats) setStats(statD.stats);
    } catch (e) { console.error("Procurement fetch:", e); showToast("Ошибка загрузки данных", false); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  async function buildOrder(supplierId: string, poIds?: string[]) {
    const res = await fetch(`${API}/procurement/orders`, {
      method: "POST", headers: JH,
      body: JSON.stringify({ supplierId, purchaseOrderIds: poIds }),
    });
    const data = await res.json();
    if (data.order) {
      setProcOrders(prev => [data.order, ...prev]);
      showToast(`📋 Заказ для ${data.order.supplierName} сформирован (${data.order.lines.length} позиций)`);
      setShowBuildModal(false);
      setTab("history");
    } else {
      showToast(data.error || "Ошибка формирования", false);
    }
    return data;
  }

  async function sendOrder(orderId: string) {
    setSendingOrderId(orderId);
    try {
      const res = await fetch(`${API}/procurement/orders/${orderId}/send`, { method: "POST", headers: JH, body: "{}" });
      const data = await res.json();
      if (data.order) {
        setProcOrders(prev => prev.map(o => o.id === orderId ? data.order : o));
        // Update pending POs (some may have become "ordered")
        await fetchAll();
        const r = data.mockApiResponse as MockApiResponse;
        showToast(r.success
          ? `✅ Подтверждено! № ${r.confirmationNumber} · Доставка ${r.estimatedDeliveryDate}`
          : `❌ Ошибка отправки`, r.success);
        setDetailOrder(data.order);
      } else {
        showToast(data.error || "Ошибка отправки", false);
      }
    } catch (e: any) { showToast(e.message, false); }
    finally { setSendingOrderId(null); }
  }

  async function autoBatch() {
    setAutoBatching(true);
    try {
      const res = await fetch(`${API}/procurement/auto-batch`, { method: "POST", headers: JH, body: "{}" });
      const data = await res.json();
      if (data.results) {
        const sent = data.results.filter((r: any) => r.sent).length;
        const total = data.results.length;
        showToast(`🤖 Авто-рассылка: ${total} поставщиков, ${sent} отправлено`);
        await fetchAll();
        setTab("history");
      } else {
        showToast(data.error || data.message || "Ничего не найдено", !data.error);
      }
    } catch (e: any) { showToast(e.message, false); }
    finally { setAutoBatching(false); }
  }

  async function deleteSupplier(id: string) {
    await fetch(`${API}/suppliers/${id}`, { method: "DELETE", headers: AH });
    setSuppliers(prev => prev.filter(s => s.id !== id));
    showToast("Поставщик удалён");
  }

  // Pending POs grouped by resolved supplier
  const posBySupplier = React.useMemo(() => {
    const map = new Map<string, { supplier: Supplier | null; pos: PurchaseOrder[] }>();
    for (const po of pendingPOs) {
      // Find supplier by matching against all categories
      const match = suppliers.find(s => s.isActive);// Will be refined below
      let supMatch: Supplier | null = null;
      for (const sup of suppliers) {
        if (!sup.isActive) continue;
        // We don't have category in PO, use supplier name matching
        if (po.supplier && sup.name.toLowerCase().includes(po.supplier.toLowerCase())) {
          supMatch = sup; break;
        }
      }
      const key = supMatch?.id ?? "__unassigned__";
      if (!map.has(key)) map.set(key, { supplier: supMatch, pos: [] });
      map.get(key)!.pos.push(po);
    }
    return map;
  }, [pendingPOs, suppliers]);

  const TABS: { key: ProcTab; icon: string; label: string; badge?: number }[] = [
    { key: "orders",    icon: "🛒", label: "Заказы",      badge: pendingPOs.length || undefined },
    { key: "history",   icon: "📋", label: "Отправленные", badge: stats?.confirmed || undefined },
    { key: "suppliers", icon: "🏢", label: "Поставщики" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-indigo-900 to-indigo-700 text-white px-4 pt-8 pb-4 flex-shrink-0 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold">🛒 Система закупок</h1>
            <p className="text-indigo-300 text-sm mt-0.5">Поставщики · Заказы · Mock API</p>
          </div>
          <button onClick={fetchAll} disabled={loading}
            className="bg-indigo-700/60 rounded-xl p-2.5 active:scale-90">
            <span className={`text-lg block ${loading ? "animate-spin" : ""}`}>🔄</span>
          </button>
        </div>
        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { l: "Ожидает",      v: String(pendingPOs.length), hot: pendingPOs.length > 0 },
            { l: "Подтверждено", v: String(stats?.confirmed ?? 0), hot: false },
            { l: "Поставщики",   v: String(stats?.activeSuppliers ?? suppliers.length), hot: false },
            { l: "Расходы", v: stats ? (stats.totalSpend >= 1000 ? `${Math.round(stats.totalSpend / 1000)}k` : `${stats.totalSpend}`) : "—", hot: false },
          ].map(s => (
            <div key={s.l} className={`rounded-xl px-2 py-2 text-center ${s.hot ? "bg-amber-600/80" : "bg-indigo-800/50"}`}>
              <p className="text-white font-black text-base leading-none">{s.v}</p>
              <p className="text-white/60 text-[10px] mt-0.5">{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="bg-white border-b border-slate-200 flex flex-shrink-0">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-3 text-[11px] font-semibold flex flex-col items-center gap-0.5 relative transition-colors ${
              tab === t.key ? "text-indigo-800 border-b-2 border-indigo-700" : "text-slate-400"
            }`}>
            <span className="text-base">{t.icon}</span>
            {t.label}
            {t.badge ? <span className="absolute top-1.5 right-3 bg-red-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">

        {/* ══ ORDERS TAB ══════════════════════════════════════════════════════ */}
        {tab === "orders" && (
          <div>
            {/* Auto-batch CTA */}
            <div className="px-4 pt-4 pb-2 space-y-2">
              <button
                onClick={autoBatch}
                disabled={autoBatching || pendingPOs.length === 0}
                className="w-full bg-gradient-to-r from-indigo-700 to-indigo-500 text-white rounded-2xl py-4 font-bold text-sm active:scale-95 shadow-lg shadow-indigo-200 disabled:opacity-60 flex items-center justify-center gap-2.5"
              >
                {autoBatching ? (
                  <><span className="animate-spin text-lg">⏳</span> Формируем и отправляем...</>
                ) : (
                  <><span className="text-xl">🤖</span>
                    <div className="text-left">
                      <p className="font-black">Авто-рассылка всех заявок</p>
                      <p className="text-indigo-200 text-xs font-normal">Группируем по поставщикам и отправляем</p>
                    </div>
                  </>
                )}
              </button>

              <button onClick={() => setShowBuildModal(true)}
                className="w-full bg-white border border-indigo-200 text-indigo-700 rounded-2xl py-3 font-bold text-sm active:scale-95 flex items-center justify-center gap-2">
                <span>📝</span> Сформировать вручную для поставщика
              </button>
            </div>

            {/* Pending POs per supplier */}
            {pendingPOs.length === 0 && !loading ? (
              <EmptyState icon="✅" text="Все заявки обработаны!" sub="Нет новых заявок для отправки" />
            ) : (
              <div className="px-4 pb-8 space-y-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1 mt-2">
                  Ожидает отправки · {pendingPOs.length} позиций
                </p>
                {/* Group by category */}
                {SUPPLIER_CATEGORY_GROUPS.map(group => {
                  const groupPOs = pendingPOs; // show all pending, supplier groups are for UX clarity
                  const matchSupplier = suppliers.find(s =>
                    s.isActive && group.cats.some(c => s.categories.some(sc => sc.toLowerCase() === c.toLowerCase()))
                  );
                  return (
                    <PendingGroup
                      key={group.label}
                      group={group}
                      pendingPOs={pendingPOs}
                      supplier={matchSupplier}
                      onBuild={(supId, poIds) => buildOrder(supId, poIds)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ HISTORY TAB ═════════════════════════════════════════════════════ */}
        {tab === "history" && (
          <div className="px-4 pt-4 pb-8 space-y-3">
            {procOrders.length === 0 && !loading ? (
              <EmptyState icon="📋" text="Отправленных заказов нет" sub="Отправьте первый заказ на вкладке Заказы" />
            ) : procOrders.map(order => (
              <ProcOrderCard
                key={order.id}
                order={order}
                sending={sendingOrderId === order.id}
                onSend={() => sendOrder(order.id)}
                onDetail={() => setDetailOrder(order)}
                onCancel={async () => {
                  await fetch(`${API}/procurement/orders/${order.id}`, { method: "PATCH", headers: JH, body: JSON.stringify({ status: "cancelled" }) });
                  setProcOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "cancelled" } : o));
                  showToast("Заказ отменён");
                }}
              />
            ))}
          </div>
        )}

        {/* ══ SUPPLIERS TAB ════════════════════════════════════════════════════ */}
        {tab === "suppliers" && (
          <div className="px-4 pt-4 pb-8 space-y-3">
            <button onClick={() => setShowNewSupplier(true)}
              className="w-full bg-gradient-to-r from-indigo-700 to-indigo-500 text-white rounded-xl py-3 text-sm font-bold active:scale-95 shadow-md flex items-center justify-center gap-2">
              <span>➕</span> Добавить поставщика
            </button>

            {/* Category mapping legend */}
            <div className="bg-slate-50 rounded-2xl border border-slate-100 p-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Маппинг категорий</p>
              <div className="space-y-1.5">
                {SUPPLIER_CATEGORY_GROUPS.map(g => {
                  const sup = suppliers.find(s => s.isActive && g.cats.some(c => s.categories.some(sc => sc.toLowerCase() === c.toLowerCase())));
                  return (
                    <div key={g.label} className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 font-medium">{g.icon} {g.label}</span>
                      {sup ? (
                        <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">{sup.name}</span>
                      ) : (
                        <span className="text-red-500 font-semibold">⚠️ Не назначен</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {suppliers.map(sup => (
              <SupplierCard
                key={sup.id}
                supplier={sup}
                onEdit={() => setEditSupplier(sup)}
                onDelete={() => deleteSupplier(sup.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {showBuildModal && (
        <BuildOrderModal
          suppliers={suppliers}
          pendingPOs={pendingPOs}
          onClose={() => setShowBuildModal(false)}
          onBuild={buildOrder}
        />
      )}
      {detailOrder && (
        <OrderDetailModal
          order={detailOrder}
          sending={sendingOrderId === detailOrder.id}
          onClose={() => setDetailOrder(null)}
          onSend={() => sendOrder(detailOrder.id)}
        />
      )}
      {(showNewSupplier || editSupplier) && (
        <SupplierFormModal
          supplier={editSupplier ?? undefined}
          onClose={() => { setShowNewSupplier(false); setEditSupplier(null); }}
          onSave={async (body) => {
            if (editSupplier) {
              const res = await fetch(`${API}/suppliers/${editSupplier.id}`, { method: "PATCH", headers: JH, body: JSON.stringify(body) });
              const data = await res.json();
              if (data.supplier) { setSuppliers(prev => prev.map(s => s.id === editSupplier.id ? data.supplier : s)); showToast("Поставщик обновлён ✅"); }
              else showToast(data.error, false);
            } else {
              const res = await fetch(`${API}/suppliers`, { method: "POST", headers: JH, body: JSON.stringify(body) });
              const data = await res.json();
              if (data.supplier) { setSuppliers(prev => [...prev, data.supplier]); showToast("Поставщик добавлен ✅"); }
              else showToast(data.error, false);
            }
            setShowNewSupplier(false); setEditSupplier(null);
          }}
        />
      )}

      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl shadow-xl text-white text-sm font-semibold max-w-xs text-center ${
          toast.ok ? "bg-indigo-700" : "bg-red-600"
        }`}>{toast.text}</div>
      )}
    </div>
  );
}

// ─── Pending Group ────────────────────────────────────────────────────────────
function PendingGroup({ group, pendingPOs, supplier, onBuild }: {
  group: { label: string; cats: string[]; icon: string };
  pendingPOs: PurchaseOrder[];
  supplier?: Supplier;
  onBuild: (supId: string, poIds: string[]) => void;
}) {
  const { fmtShort } = useCurrency();
  // We can't filter by category here (POs don't carry category directly — they come from warehouse items)
  // Show group as informational card for this supplier's categories
  if (!supplier) return null;

  const [building, setBuilding] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-50 to-slate-50 px-4 py-3 flex items-center justify-between border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{group.icon}</span>
          <div>
            <p className="text-sm font-bold text-slate-800">{group.label}</p>
            <p className="text-xs text-indigo-600 font-semibold">→ {supplier.name}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Доставка ~{supplier.terms.deliveryDays} дн.</p>
          <p className="text-xs text-slate-400">Мин. {fmtShort(supplier.terms.minOrderAmount)}</p>
        </div>
      </div>

      {/* Category tags */}
      <div className="px-4 pt-2.5 pb-1 flex flex-wrap gap-1.5">
        {supplier.categories.map(c => (
          <span key={c} className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-100">
            {CAT_ICONS[c] ?? "📦"} {c}
          </span>
        ))}
      </div>

      {/* Supplier info */}
      <div className="px-4 pb-2 text-xs text-slate-400 space-y-0.5">
        <p>📧 {supplier.contactEmail} · 📞 {supplier.phone}</p>
        {supplier.notes && <p className="text-slate-400 line-clamp-1">💬 {supplier.notes}</p>}
      </div>

      {/* CTA */}
      <div className="px-4 pb-4 pt-1">
        <button
          onClick={async () => {
            setBuilding(true);
            await onBuild(supplier.id, undefined as any);
            setBuilding(false);
          }}
          disabled={building || pendingPOs.length === 0}
          className="w-full bg-indigo-600 text-white rounded-xl py-3 text-sm font-bold active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {building ? <span className="animate-spin">⏳</span> : <span>📤</span>}
          {building ? "Формируем..." : `Сформировать заказ для ${supplier.name}`}
        </button>
      </div>
    </div>
  );
}

// ─── Procurement Order Card ───────────────────────────────────────────────────
function ProcOrderCard({ order, sending, onSend, onDetail, onCancel }: {
  order: ProcurementOrder; sending: boolean;
  onSend: () => void; onDetail: () => void; onCancel: () => void;
}) {
  const { fmtShort } = useCurrency();
  const s = PROC_STATUS[order.status];
  const dt = new Date(order.createdAt).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit" });

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
      order.status === "confirmed" ? "border-green-200" :
      order.status === "failed" ? "border-red-200" : "border-slate-100"
    }`}>
      <button onClick={onDetail} className="w-full px-4 pt-3.5 pb-2.5 text-left active:bg-slate-50">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{s.icon}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>{s.label}</span>
              {order.sendAttempts > 0 && (
                <span className="text-[10px] text-slate-400">попыток: {order.sendAttempts}</span>
              )}
            </div>
            <p className="text-sm font-bold text-slate-800 truncate">🏢 {order.supplierName}</p>
            <p className="text-xs text-slate-400">{order.lines.length} позиций · {dt}</p>
            {order.categories.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {order.categories.map(c => (
                  <span key={c} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full font-medium">{CAT_ICONS[c] ?? "📦"} {c}</span>
                ))}
              </div>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-base font-black text-slate-800">{fmtShort(order.totalCost)}</p>
            {order.mockApiResponse?.confirmationNumber && (
              <p className="text-[10px] text-green-700 font-mono font-bold">{order.mockApiResponse.confirmationNumber}</p>
            )}
          </div>
        </div>
      </button>

      {/* Actions */}
      {(order.status === "draft" || order.status === "failed") && (
        <div className="border-t border-slate-100 flex">
          <button onClick={onCancel}
            className="flex-1 py-2.5 text-xs font-bold text-slate-400 active:bg-slate-50 border-r border-slate-100 flex items-center justify-center gap-1">
            🚫 Отменить
          </button>
          <button onClick={onSend} disabled={sending}
            className="flex-1 py-2.5 text-xs font-bold text-white bg-indigo-600 active:bg-indigo-700 flex items-center justify-center gap-1.5 disabled:opacity-60">
            {sending ? <><span className="animate-spin">⏳</span> Отправляем...</> : <><span>📤</span> Отправить поставщику</>}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Order Detail Modal ───────────────────────────────────────────────────────
function OrderDetailModal({ order, sending, onClose, onSend }: {
  order: ProcurementOrder; sending: boolean;
  onClose: () => void; onSend: () => void;
}) {
  const { fmtShort } = useCurrency();
  const s = PROC_STATUS[order.status];
  const r = order.mockApiResponse;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-w-md mx-auto pb-8 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{s.icon}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>{s.label}</span>
              </div>
              <p className="font-black text-slate-800 text-lg">{order.supplierName}</p>
              <p className="text-sm text-slate-400">📧 {order.supplierEmail}</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-black text-indigo-700">{fmtShort(order.totalCost)}</p>
              <p className="text-xs text-slate-400">{order.lines.length} позиций</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Mock API Response block */}
          {r && (
            <div className={`rounded-2xl p-4 border ${r.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
              <p className={`text-xs font-bold uppercase tracking-widest mb-2 ${r.success ? "text-green-700" : "text-red-700"}`}>
                {r.success ? "✅ Mock API — Подтверждено" : "❌ Mock API — Ошибка"}
              </p>
              {r.success && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Номер подтверждения</span>
                    <span className="font-mono font-bold text-green-800">{r.confirmationNumber}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">ID заказа поставщика</span>
                    <span className="font-mono font-bold text-slate-700">{r.supplierOrderId}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Ожидаемая доставка</span>
                    <span className="font-bold text-indigo-700">{r.estimatedDeliveryDate}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">HTTP статус</span>
                    <span className={`font-bold font-mono ${r.httpStatus === 200 ? "text-green-700" : "text-amber-700"}`}>
                      {r.httpStatus} {r.httpStatus === 200 ? "OK" : ""}
                    </span>
                  </div>
                  <div className="mt-2 bg-white rounded-xl p-2 border border-green-100">
                    <p className="text-xs text-green-800">💬 {r.message}</p>
                  </div>
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-green-100/50">
                <p className="text-[10px] text-slate-400">
                  Запрос: {new Date(r.requestedAt).toLocaleTimeString("ru-RU")} →
                  Ответ: {new Date(r.respondedAt).toLocaleTimeString("ru-RU")}
                </p>
              </div>
            </div>
          )}

          {/* Request Payload preview */}
          {r?.payload && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Тело запроса (Mock API)</p>
              <div className="bg-slate-900 rounded-xl p-3 overflow-x-auto">
                <pre className="text-[10px] text-green-400 font-mono whitespace-pre-wrap">
                  {JSON.stringify({ ...r.payload, items: r.payload.items?.slice(0, 3) }, null, 2)}
                  {r.payload.items?.length > 3 ? `\n  // ... ещё ${r.payload.items.length - 3} позиций` : ""}
                </pre>
              </div>
            </div>
          )}

          {/* Lines table */}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Позиции заказа</p>
            <div className="space-y-1.5">
              {order.lines.map((line, i) => (
                <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2">
                  <span className="text-base flex-shrink-0">{CAT_ICONS[line.category] ?? "📦"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">{line.itemName}</p>
                    <p className="text-[10px] text-slate-400">{line.sku} · {line.category}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-bold text-slate-700">{line.qty} {line.unit}</p>
                    <p className="text-[10px] text-indigo-700 font-semibold">{fmtShort(line.totalCost)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline */}
          <div className="space-y-1 text-xs text-slate-400">
            <p>📅 Создано: {new Date(order.createdAt).toLocaleString("ru-RU")}</p>
            {order.lastSentAt && <p>📤 Отправлено: {new Date(order.lastSentAt).toLocaleString("ru-RU")}</p>}
          </div>

          {/* Send / close */}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-3 text-sm font-semibold">Закрыть</button>
            {(order.status === "draft" || order.status === "failed") && (
              <button onClick={onSend} disabled={sending}
                className="flex-1 bg-indigo-600 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-60 active:scale-95 flex items-center justify-center gap-1.5">
                {sending ? <><span className="animate-spin">⏳</span> Отправляем...</> : "📤 Отправить"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Build Order Modal ────────────────────────────────────────────────────────
function BuildOrderModal({ suppliers, pendingPOs, onClose, onBuild }: {
  suppliers: Supplier[]; pendingPOs: PurchaseOrder[];
  onClose: () => void;
  onBuild: (supId: string, poIds?: string[]) => Promise<void>;
}) {
  const { fmtShort } = useCurrency();
  const [supId, setSupId] = useState(suppliers[0]?.id ?? "");
  const [building, setBuilding] = useState(false);

  const sel = suppliers.find(s => s.id === supId);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-w-md mx-auto p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
        <p className="font-black text-slate-800 text-lg">📋 Сформировать заказ</p>

        <div>
          <label className="text-xs font-semibold text-slate-500 block mb-1.5">Поставщик</label>
          <select value={supId} onChange={e => setSupId(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
            {suppliers.filter(s => s.isActive).map(s => (
              <option key={s.id} value={s.id}>{s.name} — {s.categories.join(", ")}</option>
            ))}
          </select>
        </div>

        {sel && (
          <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100 space-y-1.5 text-sm">
            <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-2">Инфо о поставщике</p>
            <div className="flex justify-between"><span className="text-slate-600">Доставка</span><span className="font-bold">{sel.terms.deliveryDays} дн.</span></div>
            <div className="flex justify-between"><span className="text-slate-600">Мин. заказ</span><span className="font-bold">{fmtShort(sel.terms.minOrderAmount)}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">Оплата</span><span className="font-bold">Net {sel.terms.paymentDays}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">API эндпоинт</span><span className="font-mono text-xs text-indigo-700 truncate max-w-[180px]">{sel.apiEndpoint.replace("https://", "")}</span></div>
            <div className="pt-1 flex flex-wrap gap-1">
              {sel.categories.map(c => <span key={c} className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full">{CAT_ICONS[c] ?? "📦"} {c}</span>)}
            </div>
          </div>
        )}

        <p className="text-xs text-slate-500">
          Будут включены все pending-заявки из категорий поставщика. После формирования — нажмите «Отправить» на карточке заказа.
        </p>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-3 text-sm font-semibold">Отмена</button>
          <button
            onClick={async () => { setBuilding(true); await onBuild(supId); setBuilding(false); }}
            disabled={building || !supId || pendingPOs.length === 0}
            className="flex-1 bg-indigo-600 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-60 active:scale-95">
            {building ? "Формируем..." : "📋 Сформировать"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Supplier Card ────────────────────────────────────────────────────────────
function SupplierCard({ supplier, onEdit, onDelete }: {
  supplier: Supplier; onEdit: () => void; onDelete: () => void;
}) {
  const { fmtShort } = useCurrency();
  const [expanded, setExpanded] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${!supplier.isActive ? "opacity-60" : "border-slate-100"}`}>
      <button onClick={() => setExpanded(e => !e)} className="w-full px-4 pt-3.5 pb-2.5 text-left active:bg-slate-50">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
            <span className="text-xl">🏢</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-slate-800">{supplier.name}</p>
              {!supplier.isActive && <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-semibold">Неактивный</span>}
            </div>
            <p className="text-xs text-slate-400 mt-0.5 truncate">📧 {supplier.contactEmail} · 📞 {supplier.phone}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {supplier.categories.map(c => (
                <span key={c} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full font-semibold border border-indigo-100">
                  {CAT_ICONS[c] ?? "📦"} {c}
                </span>
              ))}
            </div>
          </div>
          <span className="text-slate-300 text-sm flex-shrink-0 mt-1">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { l: "Доставка", v: `${supplier.terms.deliveryDays} дн.` },
              { l: "Оплата", v: `Net ${supplier.terms.paymentDays}` },
              { l: "Мин. сумма", v: fmtShort(supplier.terms.minOrderAmount) },
            ].map(s => (
              <div key={s.l} className="bg-slate-50 rounded-xl p-2 text-center">
                <p className="text-[9px] text-slate-400">{s.l}</p>
                <p className="text-xs font-bold text-slate-700 mt-0.5">{s.v}</p>
              </div>
            ))}
          </div>

          {/* API info */}
          <div className="bg-slate-900 rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-slate-400 mb-1 font-semibold uppercase">Mock API Endpoint</p>
            <p className="text-xs font-mono text-green-400 break-all">{supplier.apiEndpoint}</p>
            <p className="text-[10px] text-slate-500 mt-1">Key: {supplier.apiKey.slice(0, 20)}...</p>
          </div>

          {supplier.notes && <p className="text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2">💬 {supplier.notes}</p>}
          {supplier.address && <p className="text-xs text-slate-400">📍 {supplier.address}</p>}

          <div className="flex gap-2">
            <button onClick={onEdit} className="flex-1 bg-slate-100 text-slate-700 rounded-xl py-2.5 text-xs font-semibold active:scale-95">✏️ Редактировать</button>
            {!confirmDel
              ? <button onClick={() => setConfirmDel(true)} className="bg-red-50 text-red-500 border border-red-100 rounded-xl px-4 py-2.5 text-xs font-semibold active:scale-95">🗑️</button>
              : <button onClick={onDelete} className="bg-red-600 text-white rounded-xl px-4 py-2.5 text-xs font-bold active:scale-95">Удалить?</button>
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Supplier Form Modal ──────────────────────────────────────────────────────
const ALL_CATS = ["Трубопровод", "Дренаж", "Электрика", "Електрика", "Розходники", "Расходники", "Крепёж", "Кондиционеры", "Прочее"];

function SupplierFormModal({ supplier, onClose, onSave }: {
  supplier?: Supplier;
  onClose: () => void;
  onSave: (body: any) => Promise<void>;
}) {
  const { currency } = useCurrency();
  const [form, setForm] = useState({
    name: supplier?.name ?? "",
    categories: supplier?.categories ?? [],
    contactEmail: supplier?.contactEmail ?? "",
    phone: supplier?.phone ?? "",
    address: supplier?.address ?? "",
    apiEndpoint: supplier?.apiEndpoint ?? "https://api.supplier.ua/orders",
    apiKey: supplier?.apiKey ?? `key-${Math.random().toString(36).substr(2, 12)}`,
    terms: {
      paymentDays: supplier?.terms.paymentDays ?? 14,
      deliveryDays: supplier?.terms.deliveryDays ?? 5,
      minOrderAmount: supplier?.terms.minOrderAmount ?? 1000,
      currency: supplier?.terms.currency ?? "UAH",
    },
    isActive: supplier?.isActive !== false,
    notes: supplier?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const f = (k: string) => (v: any) => setForm(p => ({ ...p, [k]: v }));
  const fT = (k: string) => (v: any) => setForm(p => ({ ...p, terms: { ...p.terms, [k]: v } }));

  function toggleCat(cat: string) {
    setForm(p => ({
      ...p,
      categories: p.categories.includes(cat) ? p.categories.filter(c => c !== cat) : [...p.categories, cat],
    }));
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-w-md mx-auto pb-8 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-slate-100">
          <p className="font-bold text-slate-800 text-lg">{supplier ? "Редактировать поставщика" : "Новый поставщик"}</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Basic info */}
          {[
            { label: "Название *", key: "name" },
            { label: "Email", key: "contactEmail" },
            { label: "Телефон", key: "phone" },
            { label: "Адрес", key: "address" },
          ].map(({ label, key }) => (
            <div key={key}>
              <label className="text-xs font-semibold text-slate-500 block mb-1">{label}</label>
              <input type="text" value={(form as any)[key]} onChange={e => f(key)(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          ))}

          {/* Categories */}
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-2">Категории товаров</label>
            <div className="flex flex-wrap gap-2">
              {ALL_CATS.map(cat => (
                <button key={cat} type="button" onClick={() => toggleCat(cat)}
                  className={`text-xs px-3 py-1.5 rounded-xl font-semibold border transition-all ${
                    form.categories.includes(cat)
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-slate-50 text-slate-600 border-slate-200"
                  }`}>
                  {CAT_ICONS[cat] ?? "📦"} {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Terms */}
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-2">Условия поставки</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: "Дни доставки", k: "deliveryDays" },
                { l: "Оплата (дни)", k: "paymentDays" },
                { l: `Мин. сумма ${currency.symbol}`, k: "minOrderAmount" },
              ].map(({ l, k }) => (
                <div key={k}>
                  <p className="text-[10px] text-slate-400 mb-1">{l}</p>
                  <input type="number" min={0} value={(form.terms as any)[k]}
                    onChange={e => fT(k)(+e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
              ))}
            </div>
          </div>

          {/* API */}
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-2">Настройки Mock API</label>
            <div className="bg-slate-900 rounded-xl p-3 space-y-2">
              <div>
                <p className="text-[10px] text-slate-400 mb-1">Endpoint</p>
                <input type="text" value={form.apiEndpoint} onChange={e => f("apiEndpoint")(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-2 text-xs font-mono text-green-400 focus:outline-none focus:ring-1 focus:ring-green-500" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 mb-1">API Key</p>
                <input type="text" value={form.apiKey} onChange={e => f("apiKey")(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-2 text-xs font-mono text-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-500" />
              </div>
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
            <span className="text-sm font-semibold text-slate-700">Активный поставщик</span>
            <button onClick={() => f("isActive")(!form.isActive)}
              className={`relative w-12 h-6 rounded-full transition-colors ${form.isActive ? "bg-green-500" : "bg-slate-300"}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.isActive ? "translate-x-6" : ""}`} />
            </button>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">Примечания</label>
            <textarea value={form.notes} onChange={e => f("notes")(e.target.value)} rows={2}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-3 text-sm font-semibold">Отмена</button>
            <button
              onClick={async () => { if (!form.name) return; setSaving(true); await onSave(form); setSaving(false); }}
              disabled={saving || !form.name || form.categories.length === 0}
              className="flex-1 bg-indigo-600 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-60 active:scale-95">
              {saving ? "Сохранение..." : supplier ? "💾 Сохранить" : "➕ Добавить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function EmptyState({ icon, text, sub }: { icon: string; text: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center py-14 text-slate-400 gap-2 px-8">
      <span className="text-4xl">{icon}</span>
      <p className="text-sm font-semibold text-center">{text}</p>
      {sub && <p className="text-xs text-center text-slate-300">{sub}</p>}
    </div>
  );
}