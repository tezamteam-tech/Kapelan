import React, { useState, useEffect, useCallback } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import {
  Search, Plus, RefreshCw, Package, ArrowDownToLine, ArrowUpFromLine,
  AlertTriangle, CheckCircle2, Settings, Layers, Thermometer,
  Wrench, ChevronDown, ChevronUp, Edit3, Trash2, X, Loader2,
  Eye, BarChart3, TrendingDown, ShoppingCart, ClipboardList,
  Zap, Droplets, Cable, Hammer, Wind, Gauge, Info, ImageIcon,
  Check, Save
} from "lucide-react";
import { ImageUpload } from "./ui/ImageUpload";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
interface WarehouseItem {
  id: string; name: string; category: string; unit: string;
  stock: number; minStock: number; price: number; sku: string;
  supplier?: string; notes?: string; imageUrl?: string;
  itemType?: "consumable" | "assembly" | "equipment";
  assemblyComponents?: { warehouseId: string; name: string; qty: number; unit: string }[];
  updatedAt: string; createdAt: string;
}
interface StockMovement {
  id: string; itemId: string; itemName: string; type: "in" | "out" | "adjustment";
  qty: number; stockBefore: number; stockAfter: number;
  reason: string; referenceId?: string; note?: string; createdAt: string;
}
interface PurchaseOrder {
  id: string; itemId: string; itemName: string; itemUnit: string;
  qtyOrdered: number; qtyReceived: number; pricePerUnit: number; totalCost: number;
  supplier: string; status: "pending" | "ordered" | "received" | "cancelled";
  reason: "low_stock" | "manual"; note?: string; createdAt: string; updatedAt: string;
}
interface EquipmentModel {
  id: string; type: string; brand: string; model: string;
  powerKw: number; btu?: number; areaMin?: number; areaMax?: number;
  imageUrl: string; price: number; warranty: number; active: boolean;
  installParams: {
    refrigerant: string; liquidPipeOd?: string; gasPipeOd?: string; waterPipeOd?: string;
    maxPipeLength: number; minPipeLength: number; maxHeightDiff: number;
    refrigerantCharge: number; startingCharge: number;
    powerSupply: string; currentA: number; drainType: string;
    toolsRequired: string[]; certRequired: boolean;
  };
  bom: { warehouseId: string; name: string; unit: string; qtyFixed: number; qtyPerMeter: number; notes?: string }[];
  installerNotes: string; createdAt: string; updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
type WHTab = "stock" | "equipment" | "movements" | "orders";

const CATEGORIES = ["Трубопровод", "Дренаж", "Электрика", "Крепёж", "Расходники", "Фурнитура", "Оборудование", "Прочее"];
const UNITS = ["м", "шт", "кг", "компл", "рул", "уп", "л"];
const ITEM_TYPES = [
  { key: "consumable", label: "Расходник", desc: "Простая позиция (труба, кабель, крепёж)", color: "text-blue-700 bg-blue-50 border-blue-200" },
  { key: "assembly",   label: "Комплект",  desc: "Набор из нескольких позиций (монтажный комплект)", color: "text-violet-700 bg-violet-50 border-violet-200" },
  { key: "equipment",  label: "Оборудование", desc: "Устройство (насос, блок управления)", color: "text-teal-700 bg-teal-50 border-teal-200" },
];
const EQ_TYPES = ["split_ac", "chiller", "fan_coil", "vrv"] as const;
const EQ_TYPE_CFG: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  split_ac:  { label: "Сплит-система",  icon: <Wind size={14} />,        color: "text-blue-700",   bg: "bg-blue-50" },
  chiller:   { label: "Чиллер",         icon: <Thermometer size={14} />, color: "text-cyan-700",   bg: "bg-cyan-50" },
  fan_coil:  { label: "Фанкойл",        icon: <Layers size={14} />,      color: "text-violet-700", bg: "bg-violet-50" },
  vrv:       { label: "VRV/VRF",        icon: <Gauge size={14} />,       color: "text-teal-700",   bg: "bg-teal-50" },
};
const REFRIGERANTS = ["R32", "R410A", "R407C", "R22", "water", "—"];
const PIPE_OD_OPTIONS = ['1/4"', '3/8"', '1/2"', '5/8"', '3/4"', '1"', '1.25"', '1.5"', '2"'];
const DRAIN_TYPES = [
  { key: "gravity", label: "Самотёк (гравитация)" },
  { key: "pump",    label: "Дренажный насос" },
  { key: "both",    label: "Любой" },
];
const POWER_SUPPLIES = ["220V/1F", "380V/3F"];
const CAT_ICONS: Record<string, React.ReactNode> = {
  "Трубопровод": <Droplets size={14} className="text-blue-500" />,
  "Дренаж":      <Droplets size={14} className="text-cyan-500" />,
  "Электрика":   <Cable size={14} className="text-amber-500" />,
  "Крепёж":      <Hammer size={14} className="text-slate-500" />,
  "Расходники":  <Zap size={14} className="text-orange-500" />,
  "Фурнитура":   <Settings size={14} className="text-violet-500" />,
  "Оборудование":<Package size={14} className="text-teal-500" />,
  "Прочее":      <Package size={14} className="text-slate-400" />,
};
const DEFAULT_IMG: Record<string, string> = {
  "Трубопровод": "https://images.unsplash.com/photo-1640624910770-af6f133451ac?w=300",
  "Электрика":   "https://images.unsplash.com/photo-1663559147223-6b0d012a4d0a?w=300",
  "Крепёж":      "https://images.unsplash.com/photo-1713662653109-5e372136d4bd?w=300",
  "Расходники":  "https://images.unsplash.com/photo-1632339009787-0626abedd0c9?w=300",
  "Дренаж":      "https://images.unsplash.com/photo-1708244546493-079b001e0b5b?w=300",
  "Фурнитура":   "https://images.unsplash.com/photo-1603417405991-4fd97e52ccea?w=300",
  "Оборудование":"https://images.unsplash.com/photo-1765744893064-dce3184289ef?w=300",
};

const PO_STATUS_CFG = {
  pending:   { label: "Ожидает",  bg: "bg-amber-100",  text: "text-amber-700" },
  ordered:   { label: "Заказано", bg: "bg-blue-100",   text: "text-blue-700" },
  received:  { label: "Получено", bg: "bg-green-100",  text: "text-green-700" },
  cancelled: { label: "Отменено", bg: "bg-slate-100",  text: "text-slate-500" },
};

const fmt = (n: number) => n.toLocaleString("ru-RU");

function stockLevel(item: WarehouseItem) {
  if (item.stock === 0) return { color: "bg-red-500", textColor: "text-red-700", bgCard: "border-red-200 bg-red-50", label: "Нет", icon: "🔴" };
  if (item.stock < item.minStock) return { color: "bg-orange-500", textColor: "text-orange-700", bgCard: "border-orange-200 bg-orange-50", label: "Мало", icon: "🟠" };
  if (item.stock < item.minStock * 1.5) return { color: "bg-amber-400", textColor: "text-amber-700", bgCard: "border-amber-200 bg-amber-50", label: "OK", icon: "🟡" };
  return { color: "bg-emerald-500", textColor: "text-emerald-700", bgCard: "border-transparent bg-white", label: "OK", icon: "🟢" };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function WarehouseView() {
  const [tab, setTab] = useState<WHTab>("stock");
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [equipment, setEquipment] = useState<EquipmentModel[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "ok">("all");

  const [editItem, setEditItem] = useState<Partial<WarehouseItem> | null>(null);
  const [isNewItem, setIsNewItem] = useState(false);
  const [movModal, setMovModal] = useState<{ item: WarehouseItem; dir: "in" | "out" } | null>(null);
  const [detailItem, setDetailItem] = useState<WarehouseItem | null>(null);
  const [detailMovements, setDetailMovements] = useState<StockMovement[]>([]);
  const [selectedEq, setSelectedEq] = useState<EquipmentModel | null>(null);
  const [eqTab, setEqTab] = useState<"all" | "split_ac" | "chiller" | "fan_coil">("all");
  const [editEq, setEditEq] = useState<Partial<EquipmentModel> | null>(null);
  const [isNewEq, setIsNewEq] = useState(false);

  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const showToast = useCallback((text: string, ok = true) => {
    setToast({ text, ok }); setTimeout(() => setToast(null), 3500);
  }, []);

  const stats = {
    total: items.length,
    low: items.filter(i => i.stock < i.minStock).length,
    value: items.reduce((s, i) => s + i.stock * i.price, 0),
    pendingPO: orders.filter(o => o.status === "pending").length,
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [wRes, poRes, movRes, eqRes] = await Promise.all([
        fetch(`${API}/warehouse`, { headers: AH }),
        fetch(`${API}/purchase-orders`, { headers: AH }),
        fetch(`${API}/warehouse-movements`, { headers: AH }),
        fetch(`${API}/equipment`, { headers: AH }),
      ]);
      const [wd, pod, movd, eqd] = await Promise.all([wRes.json(), poRes.json(), movRes.json(), eqRes.json()]);
      if (wd.items) setItems(wd.items);
      if (pod.orders) setOrders(pod.orders);
      if (movd.movements) setMovements(movd.movements);
      if (eqd.equipment) setEquipment(eqd.equipment.filter((e: EquipmentModel) => e.active !== false));
    } catch { showToast("Ошибка загрузки", false); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function doStockMove(itemId: string, dir: "in" | "out", qty: number, reason: string, note: string) {
    const res = await fetch(`${API}/warehouse/${itemId}/stock-${dir}`, {
      method: "POST", headers: JH, body: JSON.stringify({ qty, reason, note }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    setItems(prev => prev.map(i => i.id === itemId ? data.item : i));
    if (data.movement) setMovements(prev => [data.movement, ...prev]);
    if (data.purchaseOrder) { setOrders(prev => [data.purchaseOrder, ...prev]); showToast(`⚠️ Создана закупочная заявка на "${data.item.name}"`, true); }
    else showToast(dir === "in" ? "📦 Приход оформлен" : "📤 Списание выполнено");
  }

  async function saveItem(body: Partial<WarehouseItem>) {
    const isNew = !body.id;
    const res = await fetch(`${API}/warehouse${isNew ? "" : "/" + body.id}`, {
      method: isNew ? "POST" : "PATCH", headers: JH, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) { showToast(data.error, false); return; }
    if (isNew) setItems(prev => [data.item, ...prev]);
    else setItems(prev => prev.map(i => i.id === data.item.id ? data.item : i));
    showToast(isNew ? "✅ Позиция добавлена" : "✅ Сохранено");
    setEditItem(null);
  }

  async function saveEquipment(body: Partial<EquipmentModel>) {
    const res = await fetch(`${API}/equipment`, {
      method: "POST", headers: JH, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) { showToast(data.error, false); return; }
    const saved: EquipmentModel = data.equipment;
    setEquipment(prev => {
      const exists = prev.find(e => e.id === saved.id);
      return exists ? prev.map(e => e.id === saved.id ? saved : e) : [saved, ...prev];
    });
    showToast(body.id ? "✅ Оборудование обновлено" : "✅ Оборудование добавлено");
    setEditEq(null);
    if (selectedEq?.id === saved.id) setSelectedEq(saved);
  }

  async function deleteEquipment(id: string) {
    if (!confirm("Архивировать модель оборудования?")) return;
    const res = await fetch(`${API}/equipment/${id}`, { method: "DELETE", headers: AH });
    const data = await res.json();
    if (data.error) { showToast(data.error, false); return; }
    setEquipment(prev => prev.filter(e => e.id !== id));
    if (selectedEq?.id === id) setSelectedEq(null);
    showToast("🗑️ Модель архивирована");
  }

  async function deleteItem(id: string) {
    if (!confirm("Удалить позицию?")) return;
    await fetch(`${API}/warehouse/${id}`, { method: "DELETE", headers: AH });
    setItems(prev => prev.filter(i => i.id !== id));
    setDetailItem(null);
    showToast("🗑️ Удалено");
  }

  async function loadItemMovements(itemId: string) {
    const res = await fetch(`${API}/warehouse/${itemId}/movements`, { headers: AH });
    const d = await res.json();
    if (d.movements) setDetailMovements(d.movements);
  }

  const filteredItems = items.filter(item => {
    const q = search.toLowerCase();
    const matchSearch = !q || item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q) || (item.category || "").toLowerCase().includes(q);
    const matchCat = catFilter === "all" || item.category === catFilter;
    const matchStock = stockFilter === "all" ? true : stockFilter === "low" ? item.stock < item.minStock : item.stock >= item.minStock;
    return matchSearch && matchCat && matchStock;
  });

  const cats = ["all", ...Array.from(new Set(items.map(i => i.category))).sort()];
  const groupedItems = filteredItems.reduce((acc, item) => {
    const cat = item.category || "Прочее";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, WarehouseItem[]>);

  const filteredEq = eqTab === "all" ? equipment : equipment.filter(e => e.type === eqTab);

  const TABS = [
    { key: "stock" as WHTab,     icon: <Package size={15} />,    label: "Склад",       badge: stats.low || undefined },
    { key: "equipment" as WHTab, icon: <Wind size={15} />,       label: "Оборудование" },
    { key: "movements" as WHTab, icon: <BarChart3 size={15} />,  label: "Движение" },
    { key: "orders" as WHTab,    icon: <ShoppingCart size={15} />, label: "Закупки", badge: stats.pendingPO || undefined },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0">
        <div className="px-5 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-slate-800">Склад и оборудование</h1>
            <p className="text-xs text-slate-400 mt-0.5">{items.length} позиций · {fmt(stats.value)} ₴ на складе</p>
          </div>
          <div className="flex gap-2">
            <button onClick={fetchAll} disabled={loading} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            {tab === "stock" && (
              <button onClick={() => { setIsNewItem(true); setEditItem({}); }}
                className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-semibold px-3 py-2 rounded-xl hover:bg-teal-700 active:scale-95 transition-all shadow-sm">
                <Plus size={15} /> Добавить позицию
              </button>
            )}
            {tab === "equipment" && (
              <button onClick={() => { setIsNewEq(true); setEditEq({}); }}
                className="flex items-center gap-1.5 bg-blue-600 text-white text-sm font-semibold px-3 py-2 rounded-xl hover:bg-blue-700 active:scale-95 transition-all shadow-sm">
                <Plus size={15} /> Добавить модель
              </button>
            )}
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-0 border-t border-slate-100">
          {[
            { label: "Позиций", value: stats.total, color: "text-slate-700" },
            { label: "Мало/нет", value: stats.low, color: stats.low > 0 ? "text-red-600" : "text-slate-400" },
            { label: "На складе", value: `${fmt(stats.value)} ₴`, color: "text-teal-700", small: true },
            { label: "Закупки", value: stats.pendingPO, color: stats.pendingPO > 0 ? "text-orange-600" : "text-slate-400" },
          ].map(s => (
            <div key={s.label} className="text-center py-2 border-r border-slate-100 last:border-0">
              <p className={`font-black text-lg leading-tight ${s.color} ${s.small ? "text-sm" : ""}`}>{s.value}</p>
              <p className="text-[10px] text-slate-400 font-semibold">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div className="flex border-t border-slate-100">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-all border-b-2 relative ${
                tab === t.key ? "border-teal-600 text-teal-700" : "border-transparent text-slate-400 hover:text-slate-600"
              }`}>
              {t.icon} {t.label}
              {t.badge ? (
                <span className="absolute top-1 right-2 size-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* ══ STOCK TAB ════════════════════════════════════════════════════════ */}
        {tab === "stock" && (
          <div>
            {/* Filters */}
            <div className="bg-white border-b border-slate-100 px-4 py-2 flex gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl px-3 py-1.5 flex-1 min-w-[160px]">
                <Search size={13} className="text-slate-400 flex-shrink-0" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск…"
                  className="bg-transparent text-sm flex-1 outline-none text-slate-700 placeholder-slate-400" />
              </div>
              <div className="flex gap-1.5 overflow-x-auto">
                {["all", "low", "ok"].map(f => (
                  <button key={f} onClick={() => setStockFilter(f as any)}
                    className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-all ${
                      stockFilter === f ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    }`}>
                    {f === "all" ? "Все" : f === "low" ? "🔴 Мало" : "🟢 OK"}
                  </button>
                ))}
              </div>
            </div>

            {/* Category filter pills */}
            <div className="px-4 py-2 flex gap-1.5 overflow-x-auto border-b border-slate-100 bg-white">
              {cats.map(cat => (
                <button key={cat} onClick={() => setCatFilter(cat)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all ${
                    catFilter === cat ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}>
                  {cat !== "all" && CAT_ICONS[cat]}
                  {cat === "all" ? "Все категории" : cat}
                </button>
              ))}
            </div>

            {/* Items grouped by category */}
            <div className="p-4 space-y-5 pb-8">
              {loading && items.length === 0 ? (
                <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-300" size={28} /></div>
              ) : filteredItems.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Package size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="font-medium text-sm">Ничего не найдено</p>
                </div>
              ) : (
                Object.entries(groupedItems).map(([cat, catItems]) => (
                  <div key={cat}>
                    <div className="flex items-center gap-2 mb-2">
                      {CAT_ICONS[cat] || <Package size={13} className="text-slate-400" />}
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{cat}</h3>
                      <span className="text-[10px] text-slate-400">({catItems.length})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                      {catItems.map(item => (
                        <WarehouseItemCard
                          key={item.id}
                          item={item}
                          onDetail={() => { setDetailItem(item); loadItemMovements(item.id); }}
                          onStockIn={() => setMovModal({ item, dir: "in" })}
                          onStockOut={() => setMovModal({ item, dir: "out" })}
                          onEdit={() => { setEditItem({ ...item }); setIsNewItem(false); }}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ══ EQUIPMENT TAB ════════════════════════════════════════════════════ */}
        {tab === "equipment" && (
          <div>
            {/* Equipment type filter */}
            <div className="bg-white border-b border-slate-200 px-4 py-2 flex gap-2 overflow-x-auto">
              {(["all", "split_ac", "chiller", "fan_coil"] as const).map(t => {
                const cfg = t === "all" ? null : EQ_TYPE_CFG[t];
                return (
                  <button key={t} onClick={() => setEqTab(t)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      eqTab === t ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    }`}>
                    {cfg?.icon}{cfg ? cfg.label : "Всё оборудование"}
                    <span className="opacity-60">({t === "all" ? equipment.length : equipment.filter(e => e.type === t).length})</span>
                  </button>
                );
              })}
            </div>

            {/* Hint bar */}
            <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center gap-2">
              <Info size={13} className="text-blue-500 flex-shrink-0" />
              <p className="text-xs text-blue-600">Нажмите на карточку — просмотр параметров. Кнопки ✏️ / 🗑️ — редактировать и архивировать.</p>
            </div>

            <div className="p-4 pb-8">
              {loading && equipment.length === 0 ? (
                <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-300" size={28} /></div>
              ) : filteredEq.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Wind size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="font-medium text-sm mb-3">Моделей нет</p>
                  <button onClick={() => { setIsNewEq(true); setEditEq({}); }}
                    className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold">
                    + Добавить первую модель
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                  {filteredEq.map(eq => (
                    <EquipmentCard key={eq.id} eq={eq} warehouseItems={items}
                      onClick={() => setSelectedEq(selectedEq?.id === eq.id ? null : eq)}
                      isSelected={selectedEq?.id === eq.id}
                      onEdit={e => { e.stopPropagation(); setIsNewEq(false); setEditEq({ ...eq }); }}
                      onDelete={e => { e.stopPropagation(); deleteEquipment(eq.id); }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ MOVEMENTS TAB ════════════════════════════════════════════════════ */}
        {tab === "movements" && (
          <div className="p-4 pb-8 space-y-2">
            {movements.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <BarChart3 size={36} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium text-sm">Движений пока нет</p>
              </div>
            ) : (
              movements.map(m => (
                <div key={m.id} className={`bg-white rounded-xl border px-4 py-3 flex items-start gap-3 ${
                  m.type === "in" ? "border-green-200" : m.type === "out" ? "border-red-200" : "border-slate-200"
                }`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    m.type === "in" ? "bg-green-100" : m.type === "out" ? "bg-red-100" : "bg-slate-100"
                  }`}>
                    {m.type === "in" ? <ArrowDownToLine size={14} className="text-green-600" /> :
                     m.type === "out" ? <ArrowUpFromLine size={14} className="text-red-600" /> :
                     <Settings size={14} className="text-slate-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm truncate">{m.itemName}</p>
                    <p className="text-xs text-slate-500">{m.reason} {m.note ? `· ${m.note}` : ""}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{new Date(m.createdAt).toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit" })}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`font-black text-sm ${m.type === "in" ? "text-green-600" : m.type === "out" ? "text-red-600" : "text-slate-500"}`}>
                      {m.type === "in" ? "+" : m.type === "out" ? "−" : "±"}{m.qty}
                    </p>
                    <p className="text-[10px] text-slate-400">{m.stockBefore} → {m.stockAfter}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ══ ORDERS TAB ════════════════════════════════════════════════════════ */}
        {tab === "orders" && (
          <div className="p-4 pb-8 space-y-2">
            {orders.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <ShoppingCart size={36} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium text-sm">Закупочных заявок нет</p>
              </div>
            ) : (
              orders.map(po => (
                <PurchaseOrderCard key={po.id} po={po} onReceive={async (qty) => {
                  const res = await fetch(`${API}/warehouse/${po.itemId}/stock-in`, {
                    method: "POST", headers: JH, body: JSON.stringify({ qty, reason: "purchase", poId: po.id, note: `Получение по заказу ${po.id.slice(-6)}` }),
                  });
                  const d = await res.json();
                  if (d.error) { showToast(d.error, false); return; }
                  setItems(prev => prev.map(i => i.id === po.itemId ? d.item : i));
                  setMovements(prev => [d.movement, ...prev]);
                  await fetch(`${API}/purchase-orders/${po.id}`, { method: "PATCH", headers: JH, body: JSON.stringify({ status: "received", qtyReceived: qty }) });
                  setOrders(prev => prev.map(o => o.id === po.id ? { ...o, status: "received", qtyReceived: qty } : o));
                  showToast("📦 Товар получен, склад пополнен");
                }} />
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Equipment Detail Slideout ─────────────────────────────────────────── */}
      {selectedEq && (
        <EquipmentDetail eq={selectedEq} warehouseItems={items}
          onClose={() => setSelectedEq(null)}
          onEdit={() => { setIsNewEq(false); setEditEq({ ...selectedEq }); }}
        />
      )}

      {/* ── Equipment Edit Modal ─────────────────────────────────────────────── */}
      {editEq !== null && (
        <EquipmentEditModal
          eq={editEq} isNew={isNewEq}
          warehouseItems={items}
          onClose={() => setEditEq(null)}
          onSave={saveEquipment}
        />
      )}

      {/* ── Item Detail Modal ──────────────────────────────────────────────────── */}
      {detailItem && (
        <ItemDetailModal
          item={detailItem} movements={detailMovements}
          onClose={() => setDetailItem(null)}
          onEdit={() => { setEditItem({ ...detailItem }); setIsNewItem(false); setDetailItem(null); }}
          onStockIn={() => { setMovModal({ item: detailItem, dir: "in" }); setDetailItem(null); }}
          onStockOut={() => { setMovModal({ item: detailItem, dir: "out" }); setDetailItem(null); }}
          onDelete={() => deleteItem(detailItem.id)}
        />
      )}

      {/* ── Stock Move Modal ──────────────────────────────────────────────────── */}
      {movModal && (
        <StockMoveModal
          item={movModal.item} dir={movModal.dir}
          onClose={() => setMovModal(null)}
          onConfirm={async (qty, reason, note) => {
            try { await doStockMove(movModal.item.id, movModal.dir, qty, reason, note); setMovModal(null); }
            catch (e: any) { showToast(e.message, false); }
          }}
        />
      )}

      {/* ── Edit/Create Item Modal ────────────────────────────────────────────── */}
      {editItem !== null && (
        <ItemEditModal
          item={editItem} isNew={isNewItem}
          onClose={() => setEditItem(null)}
          onSave={saveItem}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-sm font-semibold max-w-xs text-center pointer-events-none ${toast.ok ? "bg-slate-800 text-white" : "bg-red-600 text-white"}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAREHOUSE ITEM CARD
// ═══════════════════════════════════════════════════════════════════════════════
function WarehouseItemCard({ item, onDetail, onStockIn, onStockOut, onEdit }: {
  item: WarehouseItem; onDetail: () => void; onStockIn: () => void; onStockOut: () => void; onEdit: () => void;
}) {
  const level = stockLevel(item);
  const img = item.imageUrl || DEFAULT_IMG[item.category] || DEFAULT_IMG["Про��ее"];
  const typeTag = ITEM_TYPES.find(t => t.key === item.itemType);

  return (
    <div className={`rounded-2xl border overflow-hidden shadow-sm transition-all hover:shadow-md ${level.bgCard}`}>
      <div className="flex">
        {/* Image */}
        <div className="w-20 h-20 flex-shrink-0 relative overflow-hidden bg-slate-100">
          <img src={img} alt={item.name} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).src = DEFAULT_IMG["Прочее"]; }} />
          {typeTag && (
            <div className={`absolute top-1 left-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full ${typeTag.color}`}>
              {typeTag.label}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 p-2.5">
          <p className="font-bold text-slate-800 text-xs leading-tight line-clamp-2">{item.name}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{item.sku || item.category}</p>

          <div className="flex items-center justify-between mt-1.5">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${level.color}`} />
              <span className={`font-black text-sm ${level.textColor}`}>{item.stock}</span>
              <span className="text-[10px] text-slate-400">{item.unit}</span>
              {item.stock < item.minStock && item.stock > 0 && (
                <span className="text-[9px] text-orange-600 font-bold">мин {item.minStock}</span>
              )}
            </div>
            <span className="text-[10px] font-semibold text-slate-500">{fmt(item.price)} ₴/{item.unit}</span>
          </div>

          {/* Actions */}
          <div className="flex gap-1 mt-1.5">
            <button onClick={onStockIn} title="Приход"
              className="flex-1 flex items-center justify-center gap-0.5 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg py-1 text-[10px] font-bold transition-all active:scale-95">
              <ArrowDownToLine size={10} /> +
            </button>
            <button onClick={onStockOut} title="Списание"
              className="flex-1 flex items-center justify-center gap-0.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg py-1 text-[10px] font-bold transition-all active:scale-95">
              <ArrowUpFromLine size={10} /> −
            </button>
            <button onClick={onDetail} title="Подробнее"
              className="px-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg py-1 text-[10px] transition-all active:scale-95">
              <Eye size={10} />
            </button>
            <button onClick={onEdit} title="Редактировать"
              className="px-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg py-1 text-[10px] transition-all active:scale-95">
              <Edit3 size={10} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EQUIPMENT CARD
// ═══════════════════════════════════════════════════════════════════════════════
function EquipmentCard({ eq, warehouseItems, onClick, isSelected, onEdit, onDelete }: {
  eq: EquipmentModel; warehouseItems: WarehouseItem[]; onClick: () => void; isSelected: boolean;
  onEdit?: (e: React.MouseEvent) => void; onDelete?: (e: React.MouseEvent) => void;
}) {
  const cfg = EQ_TYPE_CFG[eq.type] || EQ_TYPE_CFG.split_ac;
  return (
    <div onClick={onClick}
      className={`rounded-2xl border overflow-hidden shadow-sm cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${isSelected ? "ring-2 ring-teal-500 border-teal-300" : "border-slate-200 bg-white"}`}>
      {/* Image */}
      <div className="relative h-36 overflow-hidden bg-slate-100">
        <img src={eq.imageUrl} alt={`${eq.brand} ${eq.model}`} className="w-full h-full object-cover" />
        <div className={`absolute top-2 left-2 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${cfg.bg} ${cfg.color}`}>
          {cfg.icon} {cfg.label}
        </div>
        <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-full">
          {eq.warranty} лет
        </div>
        {/* Action buttons on hover */}
        {(onEdit || onDelete) && (
          <div className="absolute bottom-2 right-2 flex gap-1.5">
            {onEdit && (
              <button onClick={onEdit}
                className="bg-white/90 hover:bg-white text-blue-600 p-1.5 rounded-lg shadow-md transition-all active:scale-95 backdrop-blur-sm"
                title="Редактировать">
                <Edit3 size={13} />
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete}
                className="bg-white/90 hover:bg-white text-red-500 p-1.5 rounded-lg shadow-md transition-all active:scale-95 backdrop-blur-sm"
                title="Архивировать">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="p-3">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{eq.brand}</p>
        <p className="font-bold text-slate-800 text-sm leading-tight">{eq.model}</p>

        <div className="flex flex-wrap gap-1 mt-2">
          {eq.btu && <InfoBadge>{eq.btu.toLocaleString()} BTU</InfoBadge>}
          <InfoBadge>{eq.powerKw} кВт</InfoBadge>
          {eq.areaMin && eq.areaMax && <InfoBadge>{eq.areaMin}–{eq.areaMax} м²</InfoBadge>}
          <InfoBadge>{eq.installParams?.refrigerant}</InfoBadge>
          <InfoBadge>{eq.installParams?.powerSupply}</InfoBadge>
        </div>

        <div className="flex items-center justify-between mt-2.5">
          <p className="font-black text-teal-700 text-sm">{fmt(eq.price)} ₴</p>
          <p className="text-[10px] text-slate-400">{eq.bom?.length ?? 0} позиций BOM</p>
        </div>
      </div>
    </div>
  );
}

function InfoBadge({ children }: { children: React.ReactNode }) {
  return <span className="bg-slate-100 text-slate-600 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">{children}</span>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EQUIPMENT DETAIL PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function EquipmentDetail({ eq, warehouseItems, onClose, onEdit }: {
  eq: EquipmentModel; warehouseItems: WarehouseItem[]; onClose: () => void; onEdit?: () => void;
}) {
  const [detailTab, setDetailTab] = useState<"params" | "bom" | "notes">("params");
  const cfg = EQ_TYPE_CFG[eq.type] || EQ_TYPE_CFG.split_ac;

  const bomWithStock = (eq.bom || []).map(entry => ({
    ...entry,
    warehouseItem: warehouseItems.find(i => i.id === entry.warehouseId),
  }));

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-white h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="relative h-44 bg-slate-100 flex-shrink-0">
          <img src={eq.imageUrl} alt={eq.model} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute top-3 right-3 flex gap-2">
            {onEdit && (
              <button onClick={onEdit}
                className="bg-white/20 hover:bg-white/40 text-white p-1.5 rounded-full transition-all flex items-center gap-1.5 text-xs font-bold px-3">
                <Edit3 size={13} /> Изменить
              </button>
            )}
            <button onClick={onClose} className="bg-white/20 hover:bg-white/40 text-white p-1.5 rounded-full transition-all">
              <X size={16} />
            </button>
          </div>
          <div className="absolute bottom-3 left-3 text-white">
            <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mb-1 ${cfg.bg} ${cfg.color}`}>
              {cfg.icon} {cfg.label}
            </div>
            <p className="font-bold text-sm">{eq.brand}</p>
            <p className="text-xl font-black leading-tight">{eq.model}</p>
          </div>
          <div className="absolute bottom-3 right-3 text-right text-white">
            <p className="font-black text-lg">{fmt(eq.price)} ₴</p>
            <p className="text-[10px] opacity-70">гарантия {eq.warranty} лет</p>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-slate-200 flex-shrink-0">
          {(["params", "bom", "notes"] as const).map(t => (
            <button key={t} onClick={() => setDetailTab(t)}
              className={`flex-1 py-2.5 text-xs font-bold transition-all border-b-2 ${detailTab === t ? "border-teal-500 text-teal-700" : "border-transparent text-slate-400"}`}>
              {t === "params" ? "⚙️ Параметры монтажа" : t === "bom" ? "📦 BOM расходников" : "📝 Заметки монтажнику"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {detailTab === "params" && (
            <div className="space-y-3">
              <ParamSection title="Хладагент и трубопровод">
                <ParamRow label="Хладагент" value={eq.installParams?.refrigerant ?? "—"} highlight />
                {eq.installParams?.liquidPipeOd && <ParamRow label='Жидкостная линия' value={eq.installParams.liquidPipeOd} />}
                {eq.installParams?.gasPipeOd && <ParamRow label='Газовая линия' value={eq.installParams.gasPipeOd} />}
                {eq.installParams?.waterPipeOd && <ParamRow label='Водяная труба' value={eq.installParams.waterPipeOd} />}
                <ParamRow label="Макс. длина трассы" value={`${eq.installParams?.maxPipeLength ?? 0} м`} />
                <ParamRow label="Мин. длина трассы" value={`${eq.installParams?.minPipeLength ?? 0} м`} />
                <ParamRow label="Макс. перепад высот" value={`${eq.installParams?.maxHeightDiff ?? 0} м`} />
                {(eq.installParams?.refrigerantCharge ?? 0) > 0 && (
                  <ParamRow label="Дозаправка" value={`${eq.installParams!.refrigerantCharge} г/м сверх ${eq.installParams!.minPipeLength} м`} highlight />
                )}
                {(eq.installParams?.startingCharge ?? 0) > 0 && (
                  <ParamRow label="Заводская закладка" value={`${eq.installParams!.startingCharge} кг`} />
                )}
              </ParamSection>
              <ParamSection title="Электропитание">
                <ParamRow label="Питание" value={eq.installParams?.powerSupply ?? "—"} highlight />
                <ParamRow label="Макс. ток" value={`${eq.installParams?.currentA ?? 0} А`} />
                <ParamRow label="Рекомендуемый автомат" value={`${Math.ceil((eq.installParams?.currentA ?? 0) * 1.25)} А`} />
              </ParamSection>
              <ParamSection title="Дренаж и инструмент">
                <ParamRow label="Тип дренажа" value={
                  eq.installParams?.drainType === "gravity" ? "Самотёк" :
                  eq.installParams?.drainType === "pump" ? "Насос" : "Любой"
                } />
                {eq.installParams?.certRequired && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <p className="text-xs font-bold text-red-700">⚠️ Требуется допуск к работе с хладагентом</p>
                  </div>
                )}
                <div className="mt-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Необходимый инструмент</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(eq.installParams?.toolsRequired ?? []).map((tool, i) => (
                      <span key={i} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded-lg font-semibold flex items-center gap-1">
                        <Wrench size={9} /> {tool}
                      </span>
                    ))}
                  </div>
                </div>
              </ParamSection>
            </div>
          )}

          {detailTab === "bom" && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 mb-3">
                Расчёт для стандартной трассы. Итоговое кол-во = фикс. + (кол-во×метры трассы)
              </p>
              {bomWithStock.map((entry, i) => {
                const wItem = entry.warehouseItem;
                const stockOk = !wItem || wItem.stock >= entry.qtyFixed + 3;
                return (
                  <div key={i} className={`rounded-xl border p-3 ${!stockOk ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-start gap-2">
                      {wItem?.imageUrl && (
                        <img src={wItem.imageUrl} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" alt="" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800 text-xs leading-tight">{entry.name}</p>
                        {entry.notes && <p className="text-[10px] text-slate-400 mt-0.5 italic">{entry.notes}</p>}
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] text-slate-500">
                            {entry.qtyFixed > 0 && `${entry.qtyFixed} ${entry.unit} фиксировано`}
                            {entry.qtyFixed > 0 && entry.qtyPerMeter > 0 && " + "}
                            {entry.qtyPerMeter > 0 && `${entry.qtyPerMeter} ${entry.unit}/м трассы`}
                          </span>
                          {wItem && (
                            <span className={`text-[10px] font-bold ${stockOk ? "text-emerald-600" : "text-orange-600"}`}>
                              На складе: {wItem.stock} {wItem.unit}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {detailTab === "notes" && (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-amber-800 mb-2 flex items-center gap-1.5">
                  <Info size={13} /> Заметки для монтажника
                </p>
                <p className="text-sm text-amber-700 leading-relaxed whitespace-pre-line">{eq.installerNotes || "Заметок нет."}</p>
              </div>
              {eq.areaMin && eq.areaMax && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                  <p className="text-xs font-bold text-blue-700 mb-1">📐 Рекомендуемая площадь</p>
                  <p className="text-2xl font-black text-blue-800">{eq.areaMin}–{eq.areaMax} м²</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ParamSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-50 rounded-2xl p-3">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
function ParamRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-xs font-bold ${highlight ? "text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full" : "text-slate-700"}`}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EQUIPMENT EDIT MODAL
// ═══════════════════════════════════════════════════════════════════════════════
type EqStep = "basic" | "params" | "bom" | "notes";
const DEFAULT_INSTALL_PARAMS = {
  refrigerant: "R32", liquidPipeOd: '1/4"', gasPipeOd: '3/8"', waterPipeOd: "",
  maxPipeLength: 20, minPipeLength: 3, maxHeightDiff: 12,
  refrigerantCharge: 8, startingCharge: 0,
  powerSupply: "220V/1F", currentA: 10, drainType: "gravity",
  toolsRequired: [] as string[], certRequired: false,
};
const LBL = "text-[11px] font-bold text-slate-500 block mb-1";
const INP = "w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white";
const INP_SM = "border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white";

function EqSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{title}</p>
      {children}
    </div>
  );
}

function EquipmentEditModal({ eq, isNew, warehouseItems, onClose, onSave }: {
  eq: Partial<EquipmentModel>; isNew: boolean;
  warehouseItems: WarehouseItem[];
  onClose: () => void;
  onSave: (body: Partial<EquipmentModel>) => Promise<void>;
}) {
  const [step, setStep] = useState<EqStep>("basic");
  const [saving, setSaving] = useState(false);

  // Basic fields
  const [type, setType] = useState(eq.type || "split_ac");
  const [brand, setBrand] = useState(eq.brand || "");
  const [model, setModel] = useState(eq.model || "");
  const [imageUrl, setImageUrl] = useState(eq.imageUrl || "");
  const [price, setPrice] = useState(eq.price ?? 0);
  const [warranty, setWarranty] = useState(eq.warranty ?? 3);
  const [powerKw, setPowerKw] = useState(eq.powerKw ?? 0);
  const [btu, setBtu] = useState(eq.btu ?? 0);
  const [areaMin, setAreaMin] = useState(eq.areaMin ?? 0);
  const [areaMax, setAreaMax] = useState(eq.areaMax ?? 0);

  // Install params
  const [params, setParams] = useState<any>({ ...DEFAULT_INSTALL_PARAMS, ...(eq.installParams || {}) });
  const [toolInput, setToolInput] = useState("");

  // BOM
  const [bom, setBom] = useState<EquipmentModel["bom"]>(eq.bom || []);
  const [bomSearch, setBomSearch] = useState("");
  const [addingBom, setAddingBom] = useState(false);
  const [newBomEntry, setNewBomEntry] = useState({
    warehouseId: "", name: "", unit: "м", qtyFixed: 1, qtyPerMeter: 0, notes: "",
  });

  // Notes
  const [installerNotes, setInstallerNotes] = useState(eq.installerNotes || "");

  const pSet = (k: string, v: any) => setParams((p: any) => ({ ...p, [k]: v }));

  function addTool() {
    const t = toolInput.trim(); if (!t) return;
    pSet("toolsRequired", [...(params.toolsRequired || []), t]);
    setToolInput("");
  }
  function removeTool(i: number) {
    pSet("toolsRequired", (params.toolsRequired || []).filter((_: any, idx: number) => idx !== i));
  }

  function addBomEntry() {
    if (!newBomEntry.name) return;
    setBom(prev => [...prev, { ...newBomEntry, qtyFixed: +newBomEntry.qtyFixed, qtyPerMeter: +newBomEntry.qtyPerMeter }]);
    setNewBomEntry({ warehouseId: "", name: "", unit: "м", qtyFixed: 1, qtyPerMeter: 0, notes: "" });
    setAddingBom(false);
  }
  function removeBomEntry(i: number) { setBom(prev => prev.filter((_, idx) => idx !== i)); }
  function updateBomEntry(i: number, k: string, v: any) {
    setBom(prev => prev.map((e, idx) => idx === i ? { ...e, [k]: v } : e));
  }

  const filteredWH = warehouseItems.filter(i =>
    !bomSearch || i.name.toLowerCase().includes(bomSearch.toLowerCase()) || i.sku.toLowerCase().includes(bomSearch.toLowerCase())
  ).slice(0, 20);

  const STEPS: { key: EqStep; label: string; icon: string }[] = [
    { key: "basic",  label: "Основное",  icon: "📋" },
    { key: "params", label: "Монтаж",    icon: "⚙️" },
    { key: "bom",    label: "BOM",       icon: "📦" },
    { key: "notes",  label: "Заметки",   icon: "📝" },
  ];
  const stepIdx = STEPS.findIndex(s => s.key === step);

  async function handleSave() {
    if (!brand || !model) { alert("Заполните производителя и модель"); setStep("basic"); return; }
    setSaving(true);
    await onSave({
      ...(eq.id ? { id: eq.id } : {}),
      type, brand, model, imageUrl, price: +price, warranty: +warranty,
      powerKw: +powerKw, btu: +btu || undefined,
      areaMin: +areaMin || undefined, areaMax: +areaMax || undefined,
      installParams: {
        ...params,
        currentA: +params.currentA, maxPipeLength: +params.maxPipeLength,
        minPipeLength: +params.minPipeLength, maxHeightDiff: +params.maxHeightDiff,
        refrigerantCharge: +params.refrigerantCharge, startingCharge: +params.startingCharge,
      },
      bom, installerNotes, active: true,
    });
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2">
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[95vh] flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0 bg-gradient-to-r from-blue-700 to-blue-500 text-white">
          <div>
            <p className="text-xs font-semibold opacity-70">{isNew ? "Новое оборудование" : "Редактирование"}</p>
            <h2 className="font-black text-base leading-tight">
              {brand || "Производитель"} {model || "Модель"}
            </h2>
          </div>
          <button onClick={onClose} className="bg-white/20 hover:bg-white/30 p-1.5 rounded-full">
            <X size={18} />
          </button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-slate-200 flex-shrink-0 bg-slate-50">
          {STEPS.map((s) => (
            <button key={s.key} onClick={() => setStep(s.key)}
              className={`flex-1 flex flex-col items-center py-2.5 text-[10px] font-bold transition-all border-b-2 ${
                step === s.key ? "border-blue-500 text-blue-700 bg-white" : "border-transparent text-slate-400 hover:text-slate-600"
              }`}>
              <span className="text-base leading-tight">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── BASIC ── */}
          {step === "basic" && (<>
            <div>
              <label className={LBL}>Тип оборудования *</label>
              <div className="grid grid-cols-2 gap-2">
                {EQ_TYPES.map(t => {
                  const cfg = EQ_TYPE_CFG[t];
                  return (
                    <button key={t} type="button" onClick={() => setType(t)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-bold transition-all ${
                        type === t ? `${cfg.bg} ${cfg.color} border-current ring-1 ring-current` : "border-slate-200 text-slate-400"
                      }`}>
                      {cfg.icon} {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <ImageUpload
              label="Фотография оборудования"
              value={imageUrl}
              onChange={setImageUrl}
              folder="equipment"
              aspect="wide"
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={LBL}>Производитель *</label>
                <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Samsung, Daikin, AERMEC…" className={INP} />
              </div>
              <div className="col-span-2">
                <label className={LBL}>Модель *</label>
                <input value={model} onChange={e => setModel(e.target.value)} placeholder="AR12TXHQASINUA WindFree" className={INP} />
              </div>
              <div>
                <label className={LBL}>Мощность (кВт) *</label>
                <input type="number" value={powerKw || ""} onChange={e => setPowerKw(+e.target.value)} step={0.1} min={0} placeholder="3.5" className={INP} />
              </div>
              <div>
                <label className={LBL}>BTU (опц.)</label>
                <input type="number" value={btu || ""} onChange={e => setBtu(+e.target.value)} step={1000} min={0} placeholder="12000" className={INP} />
              </div>
              <div>
                <label className={LBL}>Площадь от (м²)</label>
                <input type="number" value={areaMin || ""} onChange={e => setAreaMin(+e.target.value)} min={0} placeholder="30" className={INP} />
              </div>
              <div>
                <label className={LBL}>Площадь до (м²)</label>
                <input type="number" value={areaMax || ""} onChange={e => setAreaMax(+e.target.value)} min={0} placeholder="45" className={INP} />
              </div>
              <div>
                <label className={LBL}>Цена (₴) *</label>
                <input type="number" value={price || ""} onChange={e => setPrice(+e.target.value)} min={0} placeholder="25000" className={INP} />
              </div>
              <div>
                <label className={LBL}>Гарантия (лет)</label>
                <input type="number" value={warranty} onChange={e => setWarranty(+e.target.value)} min={1} max={20} className={INP} />
              </div>
            </div>
          </>)}

          {/* ── PARAMS ── */}
          {step === "params" && (<>
            <EqSection title="Хладагент / рабочее тело">
              <div>
                <label className={LBL}>Хладагент</label>
                <div className="flex flex-wrap gap-1.5">
                  {REFRIGERANTS.map(r => (
                    <button key={r} type="button" onClick={() => pSet("refrigerant", r)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                        params.refrigerant === r ? "bg-teal-600 text-white border-teal-600" : "border-slate-200 text-slate-500 hover:border-teal-300"
                      }`}>{r}</button>
                  ))}
                </div>
              </div>
              {params.refrigerant !== "water" && params.refrigerant !== "—" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LBL}>Жидкостная линия</label>
                    <select value={params.liquidPipeOd || ""} onChange={e => pSet("liquidPipeOd", e.target.value)} className={INP}>
                      <option value="">— не нужна —</option>
                      {PIPE_OD_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LBL}>Газовая линия</label>
                    <select value={params.gasPipeOd || ""} onChange={e => pSet("gasPipeOd", e.target.value)} className={INP}>
                      <option value="">— не нужна —</option>
                      {PIPE_OD_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {params.refrigerant === "water" && (
                <div>
                  <label className={LBL}>Диаметр водяной трубы</label>
                  <select value={params.waterPipeOd || ""} onChange={e => pSet("waterPipeOd", e.target.value)} className={INP}>
                    <option value="">— выбрать —</option>
                    {PIPE_OD_OPTIONS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              )}
            </EqSection>

            <EqSection title="Параметры трассы">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={LBL}>Мин. длина (м)</label>
                  <input type="number" value={params.minPipeLength} onChange={e => pSet("minPipeLength", +e.target.value)} min={0} className={INP} />
                </div>
                <div>
                  <label className={LBL}>Макс. длина (м)</label>
                  <input type="number" value={params.maxPipeLength} onChange={e => pSet("maxPipeLength", +e.target.value)} min={0} className={INP} />
                </div>
                <div>
                  <label className={LBL}>Перепад высот (м)</label>
                  <input type="number" value={params.maxHeightDiff} onChange={e => pSet("maxHeightDiff", +e.target.value)} min={0} className={INP} />
                </div>
              </div>
              {params.refrigerant !== "water" && params.refrigerant !== "—" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LBL}>Зав. закладка (кг)</label>
                    <input type="number" value={params.startingCharge} onChange={e => pSet("startingCharge", +e.target.value)} step={0.01} min={0} className={INP} />
                  </div>
                  <div>
                    <label className={LBL}>Дозаправка (г/м)</label>
                    <input type="number" value={params.refrigerantCharge} onChange={e => pSet("refrigerantCharge", +e.target.value)} min={0} className={INP} />
                    <p className="text-[10px] text-slate-400 mt-0.5">грамм/метр сверх мин. длины</p>
                  </div>
                </div>
              )}
            </EqSection>

            <EqSection title="Электропитание">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LBL}>Тип питания</label>
                  <div className="flex gap-2">
                    {POWER_SUPPLIES.map(ps => (
                      <button key={ps} type="button" onClick={() => pSet("powerSupply", ps)}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                          params.powerSupply === ps ? "bg-amber-500 text-white border-amber-500" : "border-slate-200 text-slate-500"
                        }`}>{ps}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={LBL}>Макс. ток (А)</label>
                  <input type="number" value={params.currentA} onChange={e => pSet("currentA", +e.target.value)} min={0} className={INP} />
                  <p className="text-[10px] text-slate-400 mt-0.5">Автомат: {Math.ceil(+params.currentA * 1.25)} А</p>
                </div>
              </div>
            </EqSection>

            <EqSection title="Дренаж и доп. требования">
              <div>
                <label className={LBL}>Тип дренажа</label>
                <div className="space-y-1.5">
                  {DRAIN_TYPES.map(d => (
                    <button key={d.key} type="button" onClick={() => pSet("drainType", d.key)}
                      className={`w-full text-left px-3 py-2 rounded-xl border text-sm transition-all ${
                        params.drainType === d.key ? "bg-blue-50 border-blue-400 text-blue-700 font-bold" : "border-slate-200 text-slate-500"
                      }`}>
                      {params.drainType === d.key ? "● " : "○ "}{d.label}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => pSet("certRequired", !params.certRequired)}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-slate-300 transition-all text-left">
                <div className={`w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0 transition-all ${params.certRequired ? "bg-red-500 border-red-500" : "border-slate-300"}`}>
                  {params.certRequired && <Check size={12} className="text-white" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Требуется допуск на хладагент</p>
                  <p className="text-xs text-slate-400">Обязательная сертификация монтажника</p>
                </div>
              </button>
              <div>
                <label className={LBL}>Необходимый инструмент</label>
                <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
                  {(params.toolsRequired || []).map((t: string, i: number) => (
                    <span key={i} className="flex items-center gap-1 bg-slate-100 text-slate-600 text-[11px] font-semibold px-2 py-1 rounded-lg">
                      <Wrench size={9} /> {t}
                      <button onClick={() => removeTool(i)} className="text-slate-400 hover:text-red-500 ml-0.5"><X size={10} /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={toolInput} onChange={e => setToolInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTool(); }}}
                    placeholder="Манометрная станция R32…" className={`${INP} flex-1`} />
                  <button type="button" onClick={addTool} className="bg-slate-800 text-white px-3 rounded-xl text-sm font-bold">+</button>
                </div>
              </div>
            </EqSection>
          </>)}

          {/* ── BOM ── */}
          {step === "bom" && (
            <div className="space-y-3">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs text-blue-700 font-semibold">
                  📦 <b>BOM</b> — список расходников для монтажа. Укажите: фиксированное кол-во (всегда) + на метр трассы.
                </p>
              </div>
              {bom.map((entry, i) => (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {entry.warehouseId && (() => {
                        const wi = warehouseItems.find(w => w.id === entry.warehouseId);
                        return wi?.imageUrl ? <img src={wi.imageUrl} className="w-6 h-6 rounded object-cover" alt="" /> : null;
                      })()}
                      <p className="font-bold text-slate-800 text-xs">{entry.name || "Без названия"}</p>
                    </div>
                    <button onClick={() => removeBomEntry(i)} className="text-red-400 hover:text-red-600 p-0.5"><X size={14} /></button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Фиксировано</label>
                      <input type="number" value={entry.qtyFixed} onChange={e => updateBomEntry(i, "qtyFixed", +e.target.value)} min={0} step={0.5} className={INP_SM} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 block mb-0.5">На метр трассы</label>
                      <input type="number" value={entry.qtyPerMeter} onChange={e => updateBomEntry(i, "qtyPerMeter", +e.target.value)} min={0} step={0.5} className={INP_SM} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Ед. изм.</label>
                      <select value={entry.unit} onChange={e => updateBomEntry(i, "unit", e.target.value)} className={INP_SM}>
                        {UNITS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                  <input value={entry.notes || ""} onChange={e => updateBomEntry(i, "notes", e.target.value)}
                    placeholder="Примечание" className={`${INP_SM} w-full`} />
                </div>
              ))}

              {addingBom ? (
                <div className="border-2 border-dashed border-blue-300 rounded-xl p-4 bg-blue-50 space-y-3">
                  <p className="text-xs font-bold text-blue-700">Добавить позицию в BOM</p>
                  <div>
                    <label className={LBL}>Поиск по складу</label>
                    <input value={bomSearch} onChange={e => setBomSearch(e.target.value)}
                      placeholder="Труба, кабель, хомут…" className={INP} />
                    {bomSearch && (
                      <div className="mt-1.5 border border-slate-200 rounded-xl overflow-hidden max-h-40 overflow-y-auto bg-white">
                        {filteredWH.length === 0
                          ? <p className="p-2 text-xs text-slate-400 text-center">Не найдено</p>
                          : filteredWH.map(wi => (
                            <button key={wi.id} type="button"
                              onClick={() => { setNewBomEntry(p => ({ ...p, warehouseId: wi.id, name: wi.name, unit: wi.unit })); setBomSearch(""); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-slate-50 border-b border-slate-100 last:border-0">
                              {wi.imageUrl && <img src={wi.imageUrl} className="w-6 h-6 rounded object-cover flex-shrink-0" alt="" />}
                              <span className="font-semibold text-slate-700 flex-1">{wi.name}</span>
                              <span className="text-slate-400">{wi.unit}</span>
                            </button>
                          ))
                        }
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <label className={LBL}>Название *</label>
                      <input value={newBomEntry.name} onChange={e => setNewBomEntry(p => ({ ...p, name: e.target.value }))}
                        placeholder='Медная труба 1/4"' className={INP} />
                    </div>
                    <div>
                      <label className={LBL}>Фиксировано</label>
                      <input type="number" value={newBomEntry.qtyFixed} onChange={e => setNewBomEntry(p => ({ ...p, qtyFixed: +e.target.value }))} min={0} step={0.5} className={INP} />
                    </div>
                    <div>
                      <label className={LBL}>На метр трассы</label>
                      <input type="number" value={newBomEntry.qtyPerMeter} onChange={e => setNewBomEntry(p => ({ ...p, qtyPerMeter: +e.target.value }))} min={0} step={0.5} className={INP} />
                    </div>
                    <div>
                      <label className={LBL}>Ед. изм.</label>
                      <select value={newBomEntry.unit} onChange={e => setNewBomEntry(p => ({ ...p, unit: e.target.value }))} className={INP}>
                        {UNITS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={LBL}>Примечание</label>
                      <input value={newBomEntry.notes} onChange={e => setNewBomEntry(p => ({ ...p, notes: e.target.value }))} className={INP} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={addBomEntry} disabled={!newBomEntry.name}
                      className="flex-1 bg-blue-600 text-white py-2 rounded-xl font-bold text-sm disabled:opacity-50">
                      ✅ Добавить
                    </button>
                    <button onClick={() => setAddingBom(false)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-500 font-bold text-sm">Отмена</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAddingBom(true)}
                  className="w-full border-2 border-dashed border-slate-300 hover:border-blue-400 text-slate-400 hover:text-blue-600 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2">
                  <Plus size={16} /> Добавить позицию в BOM
                </button>
              )}
            </div>
          )}

          {/* ── NOTES ── */}
          {step === "notes" && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                <p className="text-xs text-amber-700">Заметки видят монтажники при открытии ордера. Укажите особенности монтажа, обязательные процедуры, порядок пуска.</p>
              </div>
              <div>
                <label className={LBL}>Заметки для монтажника</label>
                <textarea value={installerNotes} onChange={e => setInstallerNotes(e.target.value)} rows={10}
                  placeholder={"Пример:\n• Обязательна азотная продувка трассы\n• Проверить давление 40 бар 24 часа\n• Газовая линия — трубка 1/2\""}
                  className={`${INP} resize-none`} />
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-500 space-y-1">
                <p className="font-bold text-slate-600">Рекомендуется указать:</p>
                {["Диаметры труб и тип вальцовки","Требования к герметизации и опрессовке","Настройки Wi-Fi и управляющих кабелей","Особенности пуска и проверки"].map(h => (
                  <p key={h}>• {h}</p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-5 py-3 flex gap-2 items-center flex-shrink-0 bg-slate-50">
          <div className="flex gap-1 flex-1">
            {STEPS.map((s) => (
              <button key={s.key} onClick={() => setStep(s.key)}
                className={`h-2 rounded-full transition-all ${step === s.key ? "bg-blue-600 flex-1" : "bg-slate-300 w-2"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {stepIdx > 0 && (
              <button onClick={() => setStep(STEPS[stepIdx - 1].key)}
                className="px-4 py-2.5 rounded-xl bg-slate-200 text-slate-600 font-bold text-sm active:scale-95">
                ← Назад
              </button>
            )}
            {stepIdx < STEPS.length - 1 ? (
              <button onClick={() => setStep(STEPS[stepIdx + 1].key)}
                className="px-4 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm active:scale-95">
                Далее →
              </button>
            ) : (
              <button onClick={handleSave} disabled={saving || !brand || !model}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-green-600 text-white font-bold text-sm disabled:opacity-60 active:scale-95">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {isNew ? "Создать модель" : "Сохранить"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ITEM DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function ItemDetailModal({ item, movements, onClose, onEdit, onStockIn, onStockOut, onDelete }: {
  item: WarehouseItem; movements: StockMovement[];
  onClose: () => void; onEdit: () => void; onStockIn: () => void; onStockOut: () => void; onDelete: () => void;
}) {
  const level = stockLevel(item);
  const img = item.imageUrl || DEFAULT_IMG[item.category] || DEFAULT_IMG["Прочее"];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header image */}
        <div className="relative h-36 flex-shrink-0">
          <img src={img} className="w-full h-full object-cover" alt={item.name} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <button onClick={onClose} className="absolute top-3 right-3 bg-white/20 hover:bg-white/40 text-white p-1.5 rounded-full">
            <X size={16} />
          </button>
          <div className="absolute bottom-3 left-3 text-white">
            <p className="font-black text-base leading-tight">{item.name}</p>
            <p className="text-xs opacity-70">{item.sku} · {item.category}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Stock status */}
          <div className={`rounded-2xl border p-4 ${level.bgCard}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">На складе</p>
                <p className={`font-black text-3xl ${level.textColor}`}>{item.stock} <span className="text-lg">{item.unit}</span></p>
                <p className="text-xs text-slate-400 mt-1">Минимум: {item.minStock} {item.unit}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">Цена</p>
                <p className="font-black text-lg text-slate-700">{fmt(item.price)} ₴/{item.unit}</p>
                <p className="text-xs text-slate-400">Итого: {fmt(item.stock * item.price)} ₴</p>
              </div>
            </div>
          </div>

          {/* Assembly components */}
          {item.itemType === "assembly" && item.assemblyComponents?.length ? (
            <div className="bg-violet-50 border border-violet-200 rounded-2xl p-3">
              <p className="text-xs font-bold text-violet-700 mb-2">📦 Состав комплекта</p>
              {item.assemblyComponents.map((c, i) => (
                <div key={i} className="flex justify-between text-xs text-violet-700 py-1 border-b border-violet-100 last:border-0">
                  <span>{c.name}</span><span className="font-bold">{c.qty} {c.unit}</span>
                </div>
              ))}
            </div>
          ) : null}

          {/* Info */}
          {(item.supplier || item.notes) && (
            <div className="bg-slate-50 rounded-2xl p-3 space-y-1.5 text-sm text-slate-600">
              {item.supplier && <p>🏭 Поставщик: <b>{item.supplier}</b></p>}
              {item.notes && <p className="text-xs text-slate-500 italic">{item.notes}</p>}
            </div>
          )}

          {/* Recent movements */}
          {movements.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Последние движения</p>
              <div className="space-y-1.5">
                {movements.slice(0, 5).map(m => (
                  <div key={m.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100">
                    <div>
                      <span className={m.type === "in" ? "text-green-600" : "text-red-600"}>{m.type === "in" ? "▲" : "▼"} {m.reason}</span>
                      {m.note && <span className="text-slate-400 ml-1">· {m.note.slice(0, 40)}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${m.type === "in" ? "text-green-600" : "text-red-600"}`}>{m.type === "in" ? "+" : "-"}{m.qty}</span>
                      <span className="text-slate-400">{new Date(m.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="border-t border-slate-200 px-4 py-3 flex gap-2 flex-shrink-0">
          <button onClick={onStockIn} className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 text-white py-2.5 rounded-xl text-sm font-bold active:scale-95">
            <ArrowDownToLine size={14} /> Приход
          </button>
          <button onClick={onStockOut} className="flex-1 flex items-center justify-center gap-1.5 bg-red-500 text-white py-2.5 rounded-xl text-sm font-bold active:scale-95">
            <ArrowUpFromLine size={14} /> Списание
          </button>
          <button onClick={onEdit} className="px-3 bg-slate-100 text-slate-600 rounded-xl font-bold active:scale-95">
            <Edit3 size={16} />
          </button>
          <button onClick={onDelete} className="px-3 bg-red-50 text-red-400 rounded-xl font-bold active:scale-95">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STOCK MOVE MODAL
// ═══════════════════════════════════════════════════════════════════════════════
const REASONS_IN = ["purchase", "return", "adjustment", "manual"];
const REASONS_OUT = ["installation", "adjustment", "return", "manual"];
const REASON_LABELS: Record<string, string> = {
  purchase: "📦 Закупка", return: "↩️ Возврат", adjustment: "✏️ Коррекция", manual: "👤 Вручную",
  installation: "🔧 Монтаж",
};
function StockMoveModal({ item, dir, onClose, onConfirm }: {
  item: WarehouseItem; dir: "in" | "out"; onClose: () => void;
  onConfirm: (qty: number, reason: string, note: string) => Promise<void>;
}) {
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(dir === "in" ? "purchase" : "installation");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = +qty;
    if (!n || n <= 0) return;
    setSaving(true);
    await onConfirm(n, reason, note);
    setSaving(false);
  }
  const img = item.imageUrl || DEFAULT_IMG[item.category] || DEFAULT_IMG["Прочее"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="relative h-28 flex-shrink-0">
          <img src={img} className="w-full h-full object-cover" alt={item.name} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
          <button onClick={onClose} className="absolute top-2 right-2 bg-white/20 text-white p-1 rounded-full"><X size={14} /></button>
          <div className="absolute bottom-2 left-3 text-white">
            <p className={`text-xs font-bold ${dir === "in" ? "text-green-400" : "text-red-400"}`}>{dir === "in" ? "▲ ПРИХОД" : "▼ СПИСАНИЕ"}</p>
            <p className="font-bold text-sm leading-tight">{item.name}</p>
          </div>
          <div className="absolute bottom-2 right-3 text-right text-white">
            <p className="text-xs opacity-70">На складе</p>
            <p className="font-black">{item.stock} {item.unit}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">Количество ({item.unit}) *</label>
            <input type="number" value={qty} onChange={e => setQty(e.target.value)} min={0.01} step={0.01}
              placeholder={`Введите кол-во`} required autoFocus
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-lg font-black focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">Причина</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(dir === "in" ? REASONS_IN : REASONS_OUT).map(r => (
                <button key={r} type="button" onClick={() => setReason(r)}
                  className={`text-xs font-semibold px-3 py-2 rounded-xl border transition-all ${reason === r ? "bg-teal-600 text-white border-teal-600" : "border-slate-200 text-slate-500 hover:border-teal-300"}`}>
                  {REASON_LABELS[r] || r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">Примечание</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Необязательно"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
          <button type="submit" disabled={saving || !qty}
            className={`w-full py-3 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60 ${dir === "in" ? "bg-green-600 text-white" : "bg-red-500 text-white"}`}>
            {saving ? <Loader2 className="animate-spin mx-auto" size={18} /> : dir === "in" ? "✅ Оформить приход" : "📤 Оформить списание"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ITEM EDIT MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function ItemEditModal({ item, isNew, onClose, onSave }: {
  item: Partial<WarehouseItem>; isNew: boolean; onClose: () => void;
  onSave: (body: Partial<WarehouseItem>) => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<WarehouseItem>>({
    name: "", category: "Прочее", unit: "шт", stock: 0, minStock: 0, price: 0,
    sku: "", supplier: "", notes: "", imageUrl: "", itemType: "consumable", ...item,
  });
  const [saving, setSaving] = useState(false);

  const f = (k: keyof WarehouseItem) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    await onSave({ ...form, stock: +((form.stock as any) || 0), minStock: +((form.minStock as any) || 0), price: +((form.price as any) || 0) });
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
          <h2 className="font-bold text-slate-800">{isNew ? "Новая позиция" : "Редактировать"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          <ImageUpload
            label="Фото позиции"
            value={form.imageUrl || ""}
            onChange={url => setForm(p => ({ ...p, imageUrl: url }))}
            folder="warehouse"
            aspect="wide"
          />

          {/* Type */}
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">Тип позиции</label>
            <div className="grid grid-cols-3 gap-2">
              {ITEM_TYPES.map(t => (
                <button key={t.key} type="button" onClick={() => setForm(p => ({ ...p, itemType: t.key as any }))}
                  className={`text-xs font-bold px-2 py-2.5 rounded-xl border transition-all text-center ${form.itemType === t.key ? t.color : "border-slate-200 text-slate-400 hover:border-slate-300"}`}>
                  <p>{t.label}</p>
                  <p className="font-normal text-[9px] mt-0.5 opacity-70">{t.desc.slice(0, 25)}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-bold text-slate-500 block mb-1">Название *</label>
              <input value={form.name || ""} onChange={f("name")} required placeholder='Медная труба 1/4"' className={INPUT} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1">Категория</label>
              <select value={form.category} onChange={f("category") as any} className={INPUT}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1">Единица измерения</label>
              <select value={form.unit} onChange={f("unit") as any} className={INPUT}>
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <FormNum label="Нач. остаток" value={form.stock} onChange={v => setForm(p => ({ ...p, stock: +v }))} />
            <FormNum label="Минимум (алерт)" value={form.minStock} onChange={v => setForm(p => ({ ...p, minStock: +v }))} />
            <FormNum label="Цена за ед. (₴)" value={form.price} onChange={v => setForm(p => ({ ...p, price: +v }))} />
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1">Артикул / SKU</label>
              <input value={form.sku || ""} onChange={f("sku")} placeholder="PIPE-14" className={INPUT} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold text-slate-500 block mb-1">Поставщик</label>
              <input value={form.supplier || ""} onChange={f("supplier")} placeholder="МедьОпт" className={INPUT} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold text-slate-500 block mb-1">Примечания</label>
              <textarea value={form.notes || ""} onChange={f("notes")} rows={2} placeholder="Применение, особенности хранения..."
                className={INPUT + " resize-none"} />
            </div>
          </div>

          <button type="submit" disabled={saving || !form.name}
            className="w-full bg-teal-600 text-white py-3.5 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60 shadow-lg">
            {saving ? <Loader2 className="animate-spin mx-auto" size={18} /> : isNew ? "✅ Добавить позицию" : "💾 Сохранить изменения"}
          </button>
        </form>
      </div>
    </div>
  );
}

function FormNum({ label, value, onChange }: { label: string; value?: number; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs font-bold text-slate-500 block mb-1">{label}</label>
      <input type="number" value={value ?? ""} onChange={e => onChange(e.target.value)} min={0} step={0.01} className={INPUT} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PURCHASE ORDER CARD
// ═══════════════════════════════════════════════════════════════════════════════
function PurchaseOrderCard({ po, onReceive }: { po: PurchaseOrder; onReceive: (qty: number) => Promise<void> }) {
  const [receiveQty, setReceiveQty] = useState(po.qtyOrdered - po.qtyReceived);
  const [receiving, setReceiving] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const sc = PO_STATUS_CFG[po.status];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-800 text-sm truncate">{po.itemName}</p>
            <p className="text-xs text-slate-400 mt-0.5">{po.supplier} · {new Date(po.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })}</p>
          </div>
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
        </div>
        <div className="flex gap-3 text-sm">
          <span className="text-slate-600">Заказано: <b>{po.qtyOrdered} {po.itemUnit}</b></span>
          <span className="text-slate-600">По {<b>{fmt(po.pricePerUnit)} ₴</b>}</span>
          <span className="font-bold text-teal-700">{fmt(po.totalCost)} ₴</span>
        </div>
        {po.note && <p className="text-xs text-slate-400 mt-1 italic">{po.note}</p>}

        {po.status !== "received" && po.status !== "cancelled" && (
          !showReceive ? (
            <button onClick={() => setShowReceive(true)}
              className="w-full mt-3 bg-green-600 text-white py-2 rounded-xl font-bold text-sm active:scale-95">
              📦 Оформить получение
            </button>
          ) : (
            <div className="mt-3 flex gap-2 items-center">
              <input type="number" value={receiveQty} onChange={e => setReceiveQty(+e.target.value)} min={1} max={po.qtyOrdered}
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-green-400" />
              <span className="text-sm text-slate-500">{po.itemUnit}</span>
              <button onClick={async () => { setReceiving(true); await onReceive(receiveQty); setReceiving(false); setShowReceive(false); }}
                disabled={receiving || receiveQty <= 0}
                className="bg-green-600 text-white px-4 py-2 rounded-xl font-bold text-sm active:scale-95 disabled:opacity-60">
                {receiving ? <Loader2 className="animate-spin" size={14} /> : "✅"}
              </button>
              <button onClick={() => setShowReceive(false)} className="text-slate-400 p-2"><X size={14} /></button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// INPUT constant for old components (teal focus, used by ItemEditModal / StockMoveModal)
const INPUT = "w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white";
