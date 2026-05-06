import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import {
  Search, Plus, RefreshCw, Package, ArrowDownToLine, ArrowUpFromLine,
  AlertTriangle, CheckCircle2, Settings, Layers, Thermometer,
  Wrench, ChevronDown, ChevronUp, Edit3, Trash2, X, Loader2,
  Eye, BarChart3, TrendingDown, ShoppingCart, ClipboardList,
  Zap, Droplets, Cable, Hammer, Wind, Gauge, Info, ImageIcon,
  Check, Save, Sparkles, Upload
} from "lucide-react";
import { ImageUpload } from "./ui/ImageUpload";
import { RightSideCard } from "./ui/RightSideCard";
import { AiImportModal } from "./AiImportModal";
import { AiEquipmentImportModal } from "./AiEquipmentImportModal";
import { useCurrency } from "./CurrencyContext";
import { getJson } from "../lib/apiClient";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

async function fetchWith404Fallback(
  path: string,
  init: RequestInit,
  altPath: string,
): Promise<Response> {
  const res = await fetch(`${API}${path}`, init);
  if (res.status !== 404) return res;
  // Some callers used absolute app routes like "/make-server-1df47c03/..." which would
  // double-prefix because API already includes "/make-server-1df47c03".
  const normalizedAlt = String(altPath || "")
    .replace(/^\/make-server-1df47c03\b/i, "")
    .trim();
  if (!normalizedAlt || normalizedAlt === path) return res;
  return await fetch(`${API}${normalizedAlt}`, init);
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface WarehouseItem {
  id: string; name: string; category: string; unit: string;
  stock: number; minStock: number; price: number;
  priceNoVat?: number; priceWithVat?: number;
  buyPrice?: number; buyPricePeriod?: string;
  sku: string;
  supplier?: string;
  availability?: "in_stock_supplier" | "order_only";
  notes?: string; imageUrl?: string;
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

type EnrichMini = {
  enrichment_status: "pending" | "running" | "done" | "needs_review" | "error";
  confidence: number;
  needs_review_reasons?: any[];
  manufacturer_name?: string | null;
  updated_at?: string | null;
};

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
  const { fmtShort, currency } = useCurrency();
  const [tab, setTab] = useState<WHTab>("stock");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [equipment, setEquipment] = useState<EquipmentModel[]>([]);
  const [eqSel, setEqSel] = useState<Record<string, boolean>>({});
  const [eqBulk, setEqBulk] = useState<{ running: boolean; done: number; total: number; last?: string } | null>(null);
  const [eqEnrichBulk, setEqEnrichBulk] = useState<{ running: boolean; done: number; total: number; last?: string } | null>(null);
  const [eqEnrichById, setEqEnrichById] = useState<Record<string, EnrichMini | undefined>>({});
  const [eqEnrichLoading, setEqEnrichLoading] = useState(false);
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
  const [showAiImport, setShowAiImport] = useState(false);
  const [showAiEquipImport, setShowAiEquipImport] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [eqSearch, setEqSearch] = useState("");

  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const showToast = useCallback((text: string, ok = true) => {
    setToast({ text, ok }); setTimeout(() => setToast(null), 3500);
  }, []);

  // In this product model:
  // - "Склад" tab holds installation materials/consumables for equipment
  // - Equipment itself is managed in the "Оборудование" tab (catalog)
  const stockItems = useMemo(() => items.filter((i) => (i.itemType ?? "consumable") !== "equipment"), [items]);

  const stats = {
    total: stockItems.length,
    low: stockItems.filter(i => i.stock < i.minStock).length,
    value: stockItems.reduce((s, i) => s + i.stock * i.price, 0),
    pendingPO: orders.filter(o => o.status === "pending").length,
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [wd, pod, movd, eqd] = await Promise.all([
        getJson<any>(`${API}/warehouse`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true }),
        getJson<any>(`${API}/purchase-orders`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true }),
        getJson<any>(`${API}/warehouse-movements`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true }),
        getJson<any>(`${API}/equipment`, { ttlMs: 2 * 60_000, staleTtlMs: 10 * 60_000, swr: true }),
      ]);
      if (wd.items) setItems(wd.items);
      if (pod.orders) setOrders(pod.orders);
      if (movd.movements) setMovements(movd.movements);
      if (eqd.equipment) setEquipment(eqd.equipment.filter((e: EquipmentModel) => e.active !== false));
    } catch { showToast("Ошибка загрузки", false); }
    finally { setLoading(false); }
  }, [showToast]);

  async function fetchEnrichStatuses(ids: string[]) {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (!uniq.length) return;
    setEqEnrichLoading(true);
    try {
      const B = 250;
      const out: Record<string, EnrichMini | undefined> = {};
      for (let i = 0; i < uniq.length; i += B) {
        const batch = uniq.slice(i, i + B);
        const res = await fetchWith404Fallback(
          `/equipment/enrichment/bulk`,
          { method: "POST", headers: JH, body: JSON.stringify({ equipmentIds: batch }) },
          `/make-server-1df47c03/equipment/enrichment/bulk`,
        );
        const d = await res.json().catch(() => ({}));
        if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
        const byId = (d?.byId && typeof d.byId === "object") ? d.byId : {};
        for (const id of batch) {
          const row = byId[id];
          if (row) out[id] = row as EnrichMini;
        }
      }
      setEqEnrichById((prev) => ({ ...prev, ...out }));
    } catch {
      // silent: status badges are best-effort
    } finally {
      setEqEnrichLoading(false);
    }
  }

  useEffect(() => {
    // refresh enrichment badges when equipment list changes
    if (equipment.length) fetchEnrichStatuses(equipment.map((e) => e.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment.length]);

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
    try {
      const res = await fetch(`${API}/equipment/${id}`, { method: "DELETE", headers: AH });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(String(data?.error ?? `HTTP ${res.status}`));
      }
      setEquipment(prev => prev.filter(e => e.id !== id));
      setEqSel(prev => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (selectedEq?.id === id) setSelectedEq(null);
      showToast("🗑️ Модель архивирована");
    } catch (e: any) {
      showToast(`Ошибка архивирования: ${e?.message || "Failed to fetch"}`, false);
    }
  }

  async function bulkArchiveEquipment(ids: string[], label: string) {
    const uniq = Array.from(new Set(ids)).filter(Boolean);
    if (uniq.length === 0) return;
    if (!confirm(`Архивировать ${label}: ${uniq.length} шт?\n\nЭто скроет модели из каталога.`)) return;
    let ok = 0;
    setEqBulk({ running: true, done: 0, total: uniq.length });
    for (const id of uniq) {
      setEqBulk(prev => prev ? { ...prev, last: id } : prev);
      try {
        const res = await fetch(`${API}/equipment/${id}`, { method: "DELETE", headers: AH });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.error) throw new Error(String(data?.error ?? `HTTP ${res.status}`));
        ok++;
        setEquipment(prev => prev.filter(e => e.id !== id));
        setEqSel(prev => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (selectedEq?.id === id) setSelectedEq(null);
      } catch (e: any) {
        // keep going, show summary at the end
      } finally {
        setEqBulk(prev => prev ? { ...prev, done: Math.min(prev.total, prev.done + 1) } : prev);
      }
      await new Promise(r => setTimeout(r, 40));
    }
    setEqBulk(prev => prev ? { ...prev, running: false } : prev);
    showToast(`🗑️ Архивировано: ${ok} / ${uniq.length}`, ok === uniq.length);
  }

  async function bulkEnrichEquipment(ids: string[], label: string) {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (!uniq.length) return;
    setEqEnrichBulk({ running: true, done: 0, total: uniq.length });
    try {
      const startRes = await fetchWith404Fallback(
        `/equipment/autofill/start`,
        { method: "POST", headers: JH, body: JSON.stringify({ equipmentIds: uniq }) },
        `/make-server-1df47c03/equipment/autofill/start`,
      );
      const startData = await startRes.json().catch(() => ({}));
      if (!startRes.ok || startData.error) throw new Error(startData.error || `HTTP ${startRes.status}`);
      const jobId = String(startData.jobId ?? "").trim();
      if (!jobId) throw new Error("jobId не получен");

      for (let guard = 0; guard < 5000; guard++) {
        const stepRes = await fetchWith404Fallback(
          `/equipment/autofill/step`,
          { method: "POST", headers: JH, body: JSON.stringify({ jobId }) },
          `/make-server-1df47c03/equipment/autofill/step`,
        );
        const stepData = await stepRes.json().catch(() => ({}));
        if (!stepRes.ok || stepData.error) throw new Error(stepData.error || `HTTP ${stepRes.status}`);
        const job = stepData.job;
        const done = Number(job?.done ?? 0) || 0;
        const total = Number(job?.total ?? uniq.length) || uniq.length;
        setEqEnrichBulk(prev => prev ? { ...prev, done, total, last: String(job?.current_equipment_id ?? prev.last ?? "") } : prev);
        if (stepData.done || String(job?.status) === "done") break;
        if (String(job?.status) === "error") throw new Error(String(job?.error ?? "Ошибка автозаполнения"));
        await new Promise(r => setTimeout(r, 350));
      }
      showToast(`✅ Заполнение AI выполнено (${label})`);
    } catch (e: any) {
      showToast(String(e?.message ?? "Ошибка AI-автозаполнения"), false);
    } finally {
      setEqEnrichBulk(prev => prev ? { ...prev, running: false } : prev);
      // refresh equipment list because KV BOM may be updated
      fetchAll();
    }
  }

  async function deleteItem(id: string) {
    const item = items.find(i => i.id === id);
    const name = item?.name ?? "позицию";
    if (!confirm(`Удалить «${name}» со склада?\n\nЭто действие нельзя отменить.`)) return;
    try {
      const res = await fetch(`${API}/warehouse/${id}`, { method: "DELETE", headers: AH });
      const data = await res.json();
      if (data.error) { showToast(`Ошибка: ${data.error}`, false); return; }
      setItems(prev => prev.filter(i => i.id !== id));
      setDetailItem(null);
      showToast(`🗑️ «${name}» удалена со склада`);
    } catch (e: any) {
      showToast(`Ошибка удаления: ${e.message}`, false);
    }
  }

  async function loadItemMovements(itemId: string) {
    const d = await getJson<any>(`${API}/warehouse/${itemId}/movements`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true });
    if (d.movements) setDetailMovements(d.movements);
  }

  const filteredItems = stockItems.filter(item => {
    const q = search.toLowerCase();
    const matchSearch = !q || item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q) || (item.category || "").toLowerCase().includes(q);
    const matchCat = catFilter === "all" || item.category === catFilter;
    const matchStock = stockFilter === "all" ? true : stockFilter === "low" ? item.stock < item.minStock : item.stock >= item.minStock;
    return matchSearch && matchCat && matchStock;
  });

  const cats = ["all", ...Array.from(new Set(stockItems.map(i => i.category))).sort()];
  const groupedItems = filteredItems.reduce((acc, item) => {
    const cat = item.category || "Прочее";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, WarehouseItem[]>);

  const filteredEq = equipment.filter(e => {
    const matchType = eqTab === "all" || e.type === eqTab;
    const q = eqSearch.toLowerCase();
    const matchSearch = !q || e.brand.toLowerCase().includes(q) || e.model.toLowerCase().includes(q)
      || String(e.btu || "").includes(q) || String(e.price || "").includes(q);
    return matchType && matchSearch;
  });

  const filteredEqIds = useMemo(() => filteredEq.map(e => e.id), [filteredEq]);
  const selectedEqIds = useMemo(
    () => filteredEqIds.filter(id => !!eqSel[id]),
    [filteredEqIds, eqSel],
  );
  const allFilteredSelected = filteredEqIds.length > 0 && selectedEqIds.length === filteredEqIds.length;
  function toggleEqAllFiltered(val: boolean) {
    setEqSel(prev => {
      const next = { ...prev };
      for (const id of filteredEqIds) next[id] = val;
      return next;
    });
  }
  function toggleEqOne(id: string, val: boolean) {
    setEqSel(prev => ({ ...prev, [id]: val }));
  }

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
            <p className="text-xs text-slate-400 mt-0.5">{stats.total} позиций · {fmtShort(stats.value)} на складе</p>
          </div>
          <div className="flex gap-2">
            <button onClick={fetchAll} disabled={loading} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all" title="Обновить">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={() => setViewMode(v => v === "cards" ? "table" : "cards")}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl active:scale-95 transition-all shadow-sm ${
                viewMode === "table"
                  ? "bg-slate-800 text-white hover:bg-slate-900"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
              title={viewMode === "table" ? "Показать карточками" : "Показать таблицей"}
            >
              {viewMode === "table" ? <Layers size={14} /> : <ClipboardList size={14} />}
              {viewMode === "table" ? "Карточки" : "Таблица"}
            </button>
            {tab === "stock" && (
              <button onClick={() => setShowAiImport(true)}
                className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-semibold px-3 py-2 rounded-xl hover:opacity-90 active:scale-95 transition-all shadow-sm shadow-violet-200">
                <Sparkles size={13} /> AI-импорт
              </button>
            )}
            {tab === "stock" && (
              <button
                onClick={() => setShowCsvImport(true)}
                className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-2 rounded-xl hover:bg-slate-50 active:scale-95 transition-all shadow-sm"
                title="Импорт склада из CSV"
              >
                <Upload size={14} /> CSV
              </button>
            )}
            {tab === "stock" && (
              <button onClick={() => { setIsNewItem(true); setEditItem({}); }}
                className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-semibold px-3 py-2 rounded-xl hover:bg-teal-700 active:scale-95 transition-all shadow-sm">
                <Plus size={15} /> Добавить позицию
              </button>
            )}
            {tab === "equipment" && (
              <button onClick={() => setShowAiEquipImport(true)}
                className="flex items-center gap-1.5 bg-gradient-to-r from-blue-600 to-teal-600 text-white text-xs font-semibold px-3 py-2 rounded-xl hover:opacity-90 active:scale-95 transition-all shadow-sm shadow-blue-200">
                <Sparkles size={13} /> AI-импорт
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
            { label: "На складе", value: fmtShort(stats.value), color: "text-teal-700", small: true },
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

            {/* Items */}
            <div className="p-4 pb-8">
              {loading && items.length === 0 ? (
                <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-300" size={28} /></div>
              ) : filteredItems.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Package size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="font-medium text-sm">Ничего не найдено</p>
                </div>
              ) : viewMode === "table" ? (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-[900px] w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                        <tr className="text-[11px] text-slate-500 uppercase tracking-wider">
                          <th className="text-left px-3 py-2">Позиция</th>
                          <th className="text-left px-3 py-2">Категория</th>
                          <th className="text-right px-3 py-2">Остаток</th>
                          <th className="text-right px-3 py-2">Мин.</th>
                          <th className="text-right px-3 py-2">Закуп</th>
                          <th className="text-right px-3 py-2">Цена</th>
                          <th className="text-left px-3 py-2">Поставщик</th>
                          <th className="text-left px-3 py-2">SKU</th>
                          <th className="text-right px-3 py-2">Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.map(item => {
                          const lvl = stockLevel(item);
                          return (
                            <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => { setDetailItem(item); loadItemMovements(item.id); }}
                                  className="font-semibold text-slate-800 hover:underline text-left"
                                >
                                  {item.name}
                                </button>
                                {item.notes ? <div className="text-[11px] text-slate-400 line-clamp-1">{item.notes}</div> : null}
                              </td>
                              <td className="px-3 py-2 text-slate-600">{item.category}</td>
                              <td className="px-3 py-2 text-right">
                                <span className={`inline-flex items-center gap-1 text-xs font-bold ${lvl.textColor}`}>
                                  <span className={`w-2 h-2 rounded-full ${lvl.color}`} />
                                  {item.stock} {item.unit}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right text-slate-500">{item.minStock} {item.unit}</td>
                              <td className="px-3 py-2 text-right font-bold text-slate-700">{item.buyPrice ? fmtShort(item.buyPrice) : "—"}</td>
                              <td className="px-3 py-2 text-right font-bold text-teal-700">{fmtShort(item.price)}</td>
                              <td className="px-3 py-2 text-slate-500 text-xs">{item.supplier || "—"}</td>
                              <td className="px-3 py-2 text-slate-500 font-mono text-xs">{item.sku || "—"}</td>
                              <td className="px-3 py-2 text-right">
                                <div className="inline-flex gap-1">
                                  <button onClick={() => setMovModal({ item, dir: "in" })} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200">+ Приход</button>
                                  <button onClick={() => setMovModal({ item, dir: "out" })} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200">- Списать</button>
                                  <button onClick={() => { setEditItem({ ...item }); setIsNewItem(false); }} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200">Ред.</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {Object.entries(groupedItems).map(([cat, catItems]) => (
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
                            onDelete={() => deleteItem(item.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ EQUIPMENT TAB ════════════════════════════════════════════════════ */}
        {tab === "equipment" && (
          <div>
            {/* Search + type filter */}
            <div className="bg-white border-b border-slate-200 px-4 pt-2 pb-2 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl px-3 py-1.5">
                <Search size={13} className="text-slate-400 flex-shrink-0" />
                <input
                  value={eqSearch}
                  onChange={e => setEqSearch(e.target.value)}
                  placeholder="Поиск по бренду, модели, BTU, цене…"
                  className="bg-transparent text-sm flex-1 outline-none text-slate-700 placeholder-slate-400"
                />
                {eqSearch && (
                  <button onClick={() => setEqSearch("")} className="text-slate-400 hover:text-slate-600 transition-all">
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {([["all","Всё оборудование"], ["split_ac","Сплит"], ["chiller","Чиллер"], ["fan_coil","Фанкойл"], ["vrv","VRV/VRF"]] as [string,string][]).map(([t, label]) => (
                  <button key={t} onClick={() => setEqTab(t as any)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      eqTab === t ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    }`}>
                    {label}
                    <span className="opacity-60">
                      ({t === "all" ? equipment.length : equipment.filter(e => e.type === t).length})
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Hint bar */}
            <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Info size={13} className="text-blue-500 flex-shrink-0" />
                <p className="text-xs text-blue-600">Нажмите на карточку — просмотр параметров. Кнопки ✏️ / 🗑️ — редактировать и архивировать.</p>
              </div>
              {eqSearch && (
                <p className="text-xs text-slate-500 flex-shrink-0">Найдено: {filteredEq.length}</p>
              )}
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
              ) : viewMode === "table" ? (
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={(e) => toggleEqAllFiltered(e.target.checked)}
                          className="w-3.5 h-3.5 rounded accent-blue-600"
                        />
                        Выбрать всё (по фильтру)
                      </label>
                      <span className="text-xs text-slate-400">
                        Выбрано: {selectedEqIds.length} / {filteredEqIds.length}
                      </span>
                      {eqBulk?.running && (
                        <span className="text-xs text-slate-500 flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin text-slate-400" />
                          Архивирование: {eqBulk.done} / {eqBulk.total}
                        </span>
                      )}
                      {eqEnrichBulk?.running && (
                        <span className="text-xs text-slate-500 flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin text-slate-400" />
                          Заполнение AI: {eqEnrichBulk.done} / {eqEnrichBulk.total}
                        </span>
                      )}
                      <div className="ml-auto flex gap-2">
                        <button
                          onClick={() => bulkEnrichEquipment(selectedEqIds, "выбранное")}
                          disabled={selectedEqIds.length === 0 || !!eqEnrichBulk?.running || !!eqBulk?.running}
                          className="px-3 py-1.5 rounded-xl bg-teal-600 text-white text-xs font-bold hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Заполнить AI (выбранное)
                        </button>
                        <button
                          onClick={() => bulkArchiveEquipment(selectedEqIds, "выбранное")}
                          disabled={selectedEqIds.length === 0 || !!eqBulk?.running || !!eqEnrichBulk?.running}
                          className="px-3 py-1.5 rounded-xl bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Архивировать выбранное
                        </button>
                        <button
                          onClick={() => bulkArchiveEquipment(filteredEqIds, "всё по фильтру")}
                          disabled={filteredEqIds.length === 0 || !!eqBulk?.running || !!eqEnrichBulk?.running}
                          className="px-3 py-1.5 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Архивировать всё (фильтр)
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                    <table className="min-w-[900px] w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                        <tr className="text-[11px] text-slate-500 uppercase tracking-wider">
                          <th className="w-10 px-3 py-2"></th>
                          <th className="text-left px-3 py-2">Модель</th>
                          <th className="text-left px-3 py-2">AI</th>
                          <th className="text-left px-3 py-2">Тип</th>
                          <th className="text-right px-3 py-2">BTU</th>
                          <th className="text-right px-3 py-2">Цена</th>
                          <th className="text-right px-3 py-2">Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEq.map(eq => (
                          <tr key={eq.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={!!eqSel[eq.id]}
                                onChange={(e) => toggleEqOne(eq.id, e.target.checked)}
                                className="w-3.5 h-3.5 rounded accent-blue-600"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <button
                                onClick={() => setSelectedEq(selectedEq?.id === eq.id ? null : eq)}
                                className="font-semibold text-slate-800 hover:underline text-left"
                              >
                                {eq.brand} {eq.model}
                              </button>
                            </td>
                            <td className="px-3 py-2">
                              <EnrichBadge v={eqEnrichById[eq.id]} />
                            </td>
                            <td className="px-3 py-2 text-slate-600">{EQ_TYPE_CFG[eq.type]?.label ?? eq.type}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{eq.btu ?? "—"}</td>
                            <td className="px-3 py-2 text-right font-bold text-teal-700">{fmtShort(eq.price ?? 0)}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex gap-1">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setIsNewEq(false); setEditEq({ ...eq }); }}
                                  className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200"
                                >
                                  Ред.
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); deleteEquipment(eq.id); }}
                                  className="px-2 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100"
                                >
                                  Архив
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                  {filteredEq.map(eq => (
                    <EquipmentCard key={eq.id} eq={eq} warehouseItems={items} enrich={eqEnrichById[eq.id]}
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
          <div className="p-4 pb-8">
            {movements.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <BarChart3 size={36} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium text-sm">Движений пока нет</p>
              </div>
            ) : viewMode === "table" ? (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                  <table className="min-w-[900px] w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                      <tr className="text-[11px] text-slate-500 uppercase tracking-wider">
                        <th className="text-left px-3 py-2">Дата</th>
                        <th className="text-left px-3 py-2">Позиция</th>
                        <th className="text-left px-3 py-2">Тип</th>
                        <th className="text-right px-3 py-2">Кол-во</th>
                        <th className="text-left px-3 py-2">Причина</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map(m => (
                        <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2 text-slate-500 text-xs font-mono">
                            {new Date(m.createdAt).toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit" })}
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-800">{m.itemName}</td>
                          <td className="px-3 py-2 text-slate-600">
                            {m.type === "in" ? "Приход" : m.type === "out" ? "Списание" : "Корректировка"}
                          </td>
                          <td className={`px-3 py-2 text-right font-black ${
                            m.type === "in" ? "text-green-700" : m.type === "out" ? "text-red-700" : "text-slate-600"
                          }`}>
                            {m.type === "in" ? "+" : m.type === "out" ? "−" : "±"}{m.qty}
                          </td>
                          <td className="px-3 py-2 text-slate-600 text-xs">
                            {m.reason}{m.note ? ` · ${m.note}` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {movements.map(m => (
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
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ ORDERS TAB ════════════════════════════════════════════════════════ */}
        {tab === "orders" && (
          <div className="p-4 pb-8">
            {orders.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <ShoppingCart size={36} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium text-sm">Закупочных заявок нет</p>
              </div>
            ) : viewMode === "table" ? (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                  <table className="min-w-[900px] w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                      <tr className="text-[11px] text-slate-500 uppercase tracking-wider">
                        <th className="text-left px-3 py-2">Позиция</th>
                        <th className="text-right px-3 py-2">Кол-во</th>
                        <th className="text-right px-3 py-2">Закуп</th>
                        <th className="text-right px-3 py-2">Сумма</th>
                        <th className="text-left px-3 py-2">Статус</th>
                        <th className="text-right px-3 py-2">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(po => (
                        <tr key={po.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-800">{po.itemName}</div>
                            <div className="text-[11px] text-slate-400 font-mono">#{po.id.slice(-6)}</div>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700 font-bold">{po.qtyOrdered} {po.itemUnit}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{fmtShort(po.pricePerUnit)}</td>
                          <td className="px-3 py-2 text-right font-black text-indigo-700">{fmtShort(po.totalCost)}</td>
                          <td className="px-3 py-2 text-slate-600">{PO_STATUS_CFG[po.status]?.label ?? po.status}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex gap-1">
                              <button
                                onClick={async () => {
                                  const qty = po.qtyOrdered;
                                  const res = await fetch(`${API}/warehouse/${po.itemId}/stock-in`, {
                                    method: "POST",
                                    headers: JH,
                                    body: JSON.stringify({ qty, reason: "purchase", note: `Получение по заказу ${po.id.slice(-6)}` }),
                                  });
                                  const d = await res.json();
                                  if (d.error) { showToast(d.error, false); return; }
                                  await fetch(`${API}/purchase-orders/${po.id}`, { method: "PATCH", headers: JH, body: JSON.stringify({ status: "received" }) });
                                  showToast("📦 Товар получен, склад пополнен");
                                  fetchAll();
                                }}
                                className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200"
                              >
                                Приход
                              </button>
                              <button
                                onClick={async () => {
                                  const res = await fetch(`${API}/purchase-orders/${po.id}`, { method: "PATCH", headers: JH, body: JSON.stringify({ status: "cancelled" }) });
                                  const d = await res.json();
                                  if (d.success) { showToast("Заказ отменён"); fetchAll(); }
                                  else showToast(d.error || "Ошибка", false);
                                }}
                                className="px-2 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100"
                              >
                                Отмена
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {orders.map(po => (
                  <PurchaseOrderCard
                    key={po.id}
                    po={po}
                    onReceive={async (qty) => {
                      const res = await fetch(`${API}/warehouse/${po.itemId}/stock-in`, {
                        method: "POST",
                        headers: JH,
                        body: JSON.stringify({ qty, reason: "purchase", note: `Получение по заказу ${po.id.slice(-6)}` }),
                      });
                      const d = await res.json();
                      if (d.error) { showToast(d.error, false); return; }
                      await fetch(`${API}/purchase-orders/${po.id}`, { method: "PATCH", headers: JH, body: JSON.stringify({ status: "received" }) });
                      showToast("📦 Товар получен, склад пополнен");
                      fetchAll();
                    }}
                  />
                ))}
              </div>
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
          allowEquipmentType={false}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-sm font-semibold max-w-xs text-center pointer-events-none ${toast.ok ? "bg-slate-800 text-white" : "bg-red-600 text-white"}`}>
          {toast.text}
        </div>
      )}

      {/* ── AI Import Modal (склад) ───────────────────────────────────────────── */}
      {showAiImport && (
        <AiImportModal
          onClose={() => setShowAiImport(false)}
          onImported={(count) => {
            setShowAiImport(false);
            showToast(`✅ Импортировано ${count} позиций на склад`);
            fetchAll();
          }}
        />
      )}

      {/* ── AI Equipment Import Modal (оборудование) ─────────────────────────── */}
      {showAiEquipImport && (
        <AiEquipmentImportModal
          onClose={() => setShowAiEquipImport(false)}
          onImported={(count) => {
            setShowAiEquipImport(false);
            showToast(`✅ Импортировано ${count} моделей оборудования`);
            fetchAll();
          }}
        />
      )}

      {/* ── CSV Import Modal (склад) ─────────────────────────────────────────── */}
      {showCsvImport && (
        <CsvImportModal
          onClose={() => setShowCsvImport(false)}
          onImported={(count) => {
            setShowCsvImport(false);
            showToast(`✅ Импортировано ${count} позиций`);
            fetchAll();
          }}
        />
      )}
    </div>
  );
}

function CsvImportModal({ onClose, onImported }: { onClose: () => void; onImported: (count: number) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  function parseRows(): any[] {
    const raw = text.trim();
    if (!raw) return [];
    const lines = raw.split(/\\r?\\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    const delim = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
    const cells = lines.map((l) => l.split(delim).map((c) => c.trim()));
    const header = cells[0].map((h) => h.toLowerCase());
    const hasHeader = header.includes("name") || header.includes("название") || header.includes("sku");
    const rows = hasHeader ? cells.slice(1) : cells;

    const col = (h: string) => header.indexOf(h);
    const idx = {
      name: col("name") >= 0 ? col("name") : col("название"),
      category: col("category") >= 0 ? col("category") : col("категория"),
      unit: col("unit") >= 0 ? col("unit") : col("ед") >= 0 ? col("ед") : col("единица"),
      sku: col("sku"),
      stock: col("stock") >= 0 ? col("stock") : col("остаток"),
      minStock: col("minstock") >= 0 ? col("minstock") : col("min_stock") >= 0 ? col("min_stock") : col("мин"),
      price: col("price") >= 0 ? col("price") : col("sell_price") >= 0 ? col("sell_price") : col("цена"),
    };

    return rows.map((r) => {
      if (!hasHeader) {
        // Fallback order: name;category;unit;sku;stock;minStock;price
        return {
          name: r[0] ?? "",
          category: r[1] ?? "Прочее",
          unit: r[2] ?? "шт",
          sku: r[3] ?? "",
          stock: Number(String(r[4] ?? "0").replace(",", ".")),
          minStock: Number(String(r[5] ?? "0").replace(",", ".")),
          price: Number(String(r[6] ?? "0").replace(",", ".")),
        };
      }
      const pick = (i: number) => (i >= 0 ? (r[i] ?? "") : "");
      return {
        name: pick(idx.name),
        category: pick(idx.category) || "Прочее",
        unit: pick(idx.unit) || "шт",
        sku: pick(idx.sku),
        stock: Number(String(pick(idx.stock) || "0").replace(",", ".")),
        minStock: Number(String(pick(idx.minStock) || "0").replace(",", ".")),
        price: Number(String(pick(idx.price) || "0").replace(",", ".")),
      };
    }).filter((r) => String(r.name).trim());
  }

  const rows = parseRows();

  return (
    <RightSideCard
      open={true}
      onClose={onClose}
      showHeader={false}
      defaultWidth={640}
      minWidth={640}
      maxWidth={940}
      overlayClassName="bg-black/40 backdrop-blur-sm"
    >
      <div className="w-full h-full flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-black text-slate-800">Импорт склада из CSV</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Колонки: `name;category;unit;sku;stock;minStock;price` (можно с заголовком).
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setErr(""); }}
              placeholder={"name;category;unit;sku;stock;minStock;price\\nТруба 1/4;Трубопровод;м;PIPE-14;100;30;8.28"}
              className="w-full h-64 border border-slate-200 rounded-xl p-3 text-sm font-mono outline-none focus:ring-2 focus:ring-teal-500"
            />
            {err ? <p className="text-xs text-red-600 mt-2">{err}</p> : null}
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Превью</p>
            <p className="text-sm font-semibold text-slate-800 mt-1">Строк: {rows.length}</p>
            <div className="mt-3 space-y-2 max-h-48 overflow-auto">
              {rows.slice(0, 8).map((r, idx) => (
                <div key={idx} className="bg-white border border-slate-200 rounded-lg p-2">
                  <div className="text-sm font-semibold text-slate-800 line-clamp-1">{r.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {r.category} · {r.stock} {r.unit} · мин {r.minStock} · {r.sku ? `SKU ${r.sku} · ` : ""}{r.price}
                  </div>
                </div>
              ))}
              {rows.length > 8 ? <p className="text-xs text-slate-400">…и ещё {rows.length - 8}</p> : null}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700">
            Отмена
          </button>
          <button
            disabled={busy || rows.length === 0}
            onClick={async () => {
              try {
                setBusy(true);
                setErr("");
                let ok = 0;
                for (const r of rows) {
                  const res = await fetch(`${API}/warehouse`, { method: "POST", headers: JH, body: JSON.stringify(r) });
                  const d = await res.json();
                  if (d.error) throw new Error(d.error);
                  ok++;
                }
                onImported(ok);
              } catch (e: any) {
                setErr(e?.message || "Ошибка импорта");
              } finally {
                setBusy(false);
              }
            }}
            className="px-4 py-2 rounded-xl text-sm font-black text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Импортировать
          </button>
        </div>
      </div>
    </RightSideCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAREHOUSE ITEM CARD
// ═══════════════════════════════════════════════════════════════════════════════
function WarehouseItemCard({ item, onDetail, onStockIn, onStockOut, onEdit, onDelete }: {
  item: WarehouseItem; onDetail: () => void; onStockIn: () => void; onStockOut: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const { fmtShort } = useCurrency();
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
            <span className="text-[10px] font-semibold text-slate-500">{fmtShort(item.price)}/{item.unit}</span>
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
            <button onClick={onDelete} title="Удалить позицию"
              className="px-2 bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 rounded-lg py-1 text-[10px] transition-all active:scale-95">
              <Trash2 size={10} />
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
function EquipmentCard({ eq, warehouseItems, onClick, isSelected, onEdit, onDelete, enrich }: {
  eq: EquipmentModel; warehouseItems: WarehouseItem[]; onClick: () => void; isSelected: boolean;
  onEdit?: (e: React.MouseEvent) => void; onDelete?: (e: React.MouseEvent) => void;
  enrich?: EnrichMini;
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
        <div className="absolute bottom-2 left-2">
          <EnrichBadge v={enrich} />
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

        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100">
          <div>
            {eq.price > 0 ? (
              <p className="font-black text-teal-700 text-base leading-none">{fmt(eq.price)} <span className="text-xs font-semibold">BYN</span></p>
            ) : (
              <p className="text-xs font-semibold text-orange-400 italic">Цена не указана</p>
            )}
            <p className="text-[9px] text-slate-400 mt-0.5">гарантия {eq.warranty} лет</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-400">{eq.bom?.length ?? 0} поз. BOM</p>
            <p className="text-[10px] text-slate-400">{eq.installParams?.maxPipeLength}м трасса</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoBadge({ children }: { children: React.ReactNode }) {
  return <span className="bg-slate-100 text-slate-600 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">{children}</span>;
}

function EnrichBadge({ v }: { v?: EnrichMini }) {
  const st = String(v?.enrichment_status ?? "pending");
  const pct = Math.round(Number(v?.confidence ?? 0) * 100);
  const base = "text-[10px] font-black px-2 py-0.5 rounded-full border";
  if (st === "done") return <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}>AI ✓ {pct}%</span>;
  if (st === "needs_review") return <span className={`${base} bg-amber-50 text-amber-700 border-amber-200`}>AI ⚠ {pct}%</span>;
  if (st === "error") return <span className={`${base} bg-red-50 text-red-700 border-red-200`}>AI ✕</span>;
  if (st === "running") return <span className={`${base} bg-slate-50 text-slate-700 border-slate-200`}>AI…</span>;
  return <span className={`${base} bg-slate-50 text-slate-600 border-slate-200`}>AI</span>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EQUIPMENT DETAIL PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function EquipmentDetail({ eq, warehouseItems, onClose, onEdit }: {
  eq: EquipmentModel; warehouseItems: WarehouseItem[]; onClose: () => void; onEdit?: () => void;
}) {
  const { fmtShort } = useCurrency();
  const [detailTab, setDetailTab] = useState<"params" | "bom" | "notes">("params");
  const cfg = EQ_TYPE_CFG[eq.type] || EQ_TYPE_CFG.split_ac;
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [enrichData, setEnrichData] = useState<any | null>(null);
  const [enrichAssets, setEnrichAssets] = useState<any[]>([]);
  const [enrichErr, setEnrichErr] = useState<string>("");

  const bomWithStock = (eq.bom || []).map(entry => ({
    ...entry,
    warehouseItem: warehouseItems.find(i => i.id === entry.warehouseId),
  }));

  async function fetchEnrichment() {
    try {
      setEnrichErr("");
      const res = await fetchWith404Fallback(`/equipment/enrichment?equipmentId=${encodeURIComponent(eq.id)}`, {
        method: "GET",
        headers: AH,
      }, `/make-server-1df47c03/equipment/enrichment?equipmentId=${encodeURIComponent(eq.id)}`);
      if (res.status === 404) {
        throw new Error("API автозаполнения не найден (404). Проверьте деплой Supabase Edge Function make-server-1df47c03.");
      }
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setEnrichData(d.enrichment ?? null);
      setEnrichAssets(Array.isArray(d.assets) ? d.assets : []);
    } catch (e: any) {
      const msg = String(e?.message ?? "Не удалось загрузить результат автозаполнения");
      if (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("network")) {
        setEnrichErr("Нет подключения к интернету/серверу. Проверьте сеть и повторите.");
      } else {
        setEnrichErr(msg);
      }
      setEnrichData(null);
      setEnrichAssets([]);
    }
  }

  useEffect(() => {
    fetchEnrichment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eq.id]);

  // Single unified handler: one button should do everything.
  async function runAutoFill() {
    try {
      setEnrichErr("");
      setEnrichLoading(true);
      const startRes = await fetchWith404Fallback(
        `/equipment/autofill/start`,
        { method: "POST", headers: JH, body: JSON.stringify({ equipmentId: eq.id }) },
        `/make-server-1df47c03/equipment/autofill/start`,
      );
      const startData = await startRes.json().catch(() => ({}));
      if (!startRes.ok || startData.error) throw new Error(startData.error || `HTTP ${startRes.status}`);
      const jobId = String(startData.jobId ?? "").trim();
      if (!jobId) throw new Error("jobId не получен");

      // Step until done (short job: single equipment)
      for (let guard = 0; guard < 30; guard++) {
        const stepRes = await fetchWith404Fallback(
          `/equipment/autofill/step`,
          { method: "POST", headers: JH, body: JSON.stringify({ jobId }) },
          `/make-server-1df47c03/equipment/autofill/step`,
        );
        const stepData = await stepRes.json().catch(() => ({}));
        if (!stepRes.ok || stepData.error) throw new Error(stepData.error || `HTTP ${stepRes.status}`);
        const job = stepData.job;
        const msg = String(job?.progress_message ?? "").trim();
        if (msg) setEnrichErr(msg); // show progress in the same area
        if (stepData.done || String(job?.status) === "done") break;
        if (String(job?.status) === "error") throw new Error(String(job?.error ?? "Ошибка автозаполнения"));
        await new Promise(r => setTimeout(r, 350));
      }

      await fetchEnrichment();
    } catch (e: any) {
      const msg = String(e?.message ?? "Ошибка автозаполнения");
      if (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("network")) {
        setEnrichErr("Нет подключения к интернету/серверу. Проверьте сеть и повторите.");
      } else {
        setEnrichErr(msg);
      }
    } finally {
      setEnrichLoading(false);
    }
  }

  async function openAsset(asset: any) {
    try {
      const path = String(asset?.storage_path ?? asset?.storagePath ?? "").trim();
      const bucket = String(asset?.storage_bucket ?? "").trim();
      if (!path) return;
      const qs = new URLSearchParams({ path });
      if (bucket) qs.set("bucket", bucket);
      const res = await fetchWith404Fallback(`/equipment/asset-url?${qs.toString()}`, { method: "GET", headers: AH }, `/make-server-1df47c03/equipment/asset-url?${qs.toString()}`);
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      const url = String(d.url ?? "");
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // ignore
    }
  }

  return (
    <RightSideCard
      open={true}
      onClose={onClose}
      showHeader={false}
      defaultWidth={640}
      minWidth={640}
      maxWidth={940}
      overlayClassName="bg-black/40"
    >
      <div className="w-full h-full max-w-none max-h-none flex flex-col overflow-hidden">
        {/* Header */}
        <div className="relative h-44 bg-slate-100 flex-shrink-0">
          <img src={eq.imageUrl} alt={eq.model} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute top-3 right-3 flex gap-2">
            <button
              onClick={runAutoFill}
              disabled={enrichLoading}
              className={`bg-white/20 hover:bg-white/40 text-white p-1.5 rounded-full transition-all flex items-center gap-1.5 text-xs font-bold px-3 ${enrichLoading ? "opacity-60" : ""}`}
              title="Автозаполнить из интернета"
            >
              <Sparkles size={13} /> {enrichLoading ? "AI…" : "Заполнить AI"}
            </button>
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
            <p className="font-black text-lg">{fmtShort(eq.price)}</p>
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
          <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Результат автозаполнения</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <InfoBadge>статус: {String(enrichData?.enrichment_status ?? (enrichErr ? "error" : "—"))}</InfoBadge>
                  {Number(enrichData?.confidence ?? 0) > 0 && (
                    <InfoBadge>уверенность: {Math.round(Number(enrichData.confidence) * 100)}%</InfoBadge>
                  )}
                  {enrichData?.manufacturer_name && <InfoBadge>{String(enrichData.manufacturer_name)}</InfoBadge>}
                </div>
                {Array.isArray(enrichData?.needs_review_reasons) && enrichData.needs_review_reasons.length > 0 && (
                  <p className="text-[11px] text-orange-700 font-semibold mt-1">
                    Требует проверки: {enrichData.needs_review_reasons.join(", ")}
                  </p>
                )}
                {enrichErr && <p className="text-[11px] text-red-600 font-semibold mt-1">{enrichErr}</p>}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={fetchEnrichment}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Обновить
                </button>
              </div>
            </div>

            {enrichAssets.length > 0 && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {enrichAssets.slice(0, 6).map((a, idx) => (
                  <button
                    key={idx}
                    onClick={() => openAsset(a)}
                    className="text-left rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-slate-800 truncate">
                        {String(a.kind ?? "asset").toUpperCase()} {a.title ? `• ${String(a.title)}` : ""}
                      </p>
                      <span className="text-[10px] font-bold text-slate-500">
                        {Math.round(Number(a.confidence ?? 0) * 100)}%
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 truncate mt-0.5">{String(a.source_url ?? "")}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

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
    </RightSideCard>
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
  const [idPhotoLoading, setIdPhotoLoading] = useState(false);
  const [idPhotoError, setIdPhotoError] = useState("");
  const idPhotoRef = useRef<HTMLInputElement>(null);

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

  // Note: AI autofill is triggered from the equipment detail panel ("Заполнить AI")
  // and from bulk actions. Edit modal keeps manual editing only.

  async function identifyFromPhoto(file: File) {
    setIdPhotoError("");
    setIdPhotoLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetchWith404Fallback(`/equipment/identify`, { method: "POST", headers: AH, body: fd }, `/make-server-1df47c03/equipment/identify`);
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
      const b = String(d.brand ?? "").trim();
      const m = String(d.model ?? "").trim();
      if (b) setBrand(b);
      if (m) setModel(m);
      if (!b && !m) setIdPhotoError("Не удалось распознать бренд/модель. Попробуйте более чёткое фото шильдика.");
    } catch (e: any) {
      setIdPhotoError(String(e?.message ?? "Ошибка распознавания"));
    } finally {
      setIdPhotoLoading(false);
      if (idPhotoRef.current) idPhotoRef.current.value = "";
    }
  }

  function mergeBomEntries(current: EquipmentModel["bom"], incoming: EquipmentModel["bom"]): EquipmentModel["bom"] {
    const out = [...current];
    for (const inc of incoming) {
      const keyName = String(inc.name || "").trim().toLowerCase();
      const idx = out.findIndex((x) => {
        if (inc.warehouseId && x.warehouseId && inc.warehouseId === x.warehouseId && x.unit === inc.unit) return true;
        return !inc.warehouseId && !x.warehouseId && String(x.name || "").trim().toLowerCase() === keyName && x.unit === inc.unit;
      });
      if (idx >= 0) out[idx] = { ...out[idx], ...inc };
      else out.push(inc);
    }
    return out;
  }

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
    <RightSideCard
      open={true}
      onClose={onClose}
      showHeader={false}
      defaultWidth={640}
      minWidth={640}
      maxWidth={940}
    >
      <div className="w-full h-full max-w-none max-h-none flex flex-col overflow-hidden bg-transparent rounded-none shadow-none">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0 bg-gradient-to-r from-blue-700 to-blue-500 text-white">
          <div>
            <p className="text-xs font-semibold opacity-70">{isNew ? "Новое оборудование" : "Редактирование"}</p>
            <h2 className="font-black text-base leading-tight">
              {brand || "Производитель"} {model || "Модель"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="bg-white/20 hover:bg-white/30 p-1.5 rounded-full">
              <X size={18} />
            </button>
          </div>
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
              <div className="col-span-2">
                <p className="text-[11px] font-bold text-slate-500 mb-1">Распознать по фото шильдика/коробки (fallback)</p>
                <div className="flex items-center gap-2">
                  <input
                    ref={idPhotoRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) identifyFromPhoto(f);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => idPhotoRef.current?.click()}
                    disabled={idPhotoLoading}
                    className={`px-3 py-2 rounded-xl text-xs font-black text-white ${idPhotoLoading ? "bg-slate-400" : "bg-slate-800 hover:bg-slate-900"}`}
                  >
                    {idPhotoLoading ? "Распознаю…" : "Загрузить фото"}
                  </button>
                  <p className="text-[11px] text-slate-500">
                    Лучше всего видно brand/model на шильдике.
                  </p>
                </div>
                {idPhotoError && <p className="text-[11px] text-red-600 font-semibold mt-1">{idPhotoError}</p>}
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
                <label className={LBL}>Цена *</label>
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
    </RightSideCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ITEM DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function ItemDetailModal({ item, movements, onClose, onEdit, onStockIn, onStockOut, onDelete }: {
  item: WarehouseItem; movements: StockMovement[];
  onClose: () => void; onEdit: () => void; onStockIn: () => void; onStockOut: () => void; onDelete: () => void;
}) {
  const { fmtShort } = useCurrency();
  const level = stockLevel(item);
  const img = item.imageUrl || DEFAULT_IMG[item.category] || DEFAULT_IMG["Прочее"];
  return (
    <RightSideCard
      open={true}
      onClose={onClose}
      showHeader={false}
      defaultWidth={640}
      minWidth={640}
      maxWidth={940}
      overlayClassName="bg-black/50"
    >
      <div className="w-full h-full flex flex-col overflow-hidden bg-transparent">
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
                <p className="font-black text-lg text-slate-700">{fmtShort(item.price)}/{item.unit}</p>
                <p className="text-xs text-slate-400">Итого: {fmtShort(item.stock * item.price)}</p>
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
          {(item.supplier || item.availability || item.priceNoVat || item.priceWithVat || item.buyPrice || item.notes) && (
            <div className="bg-slate-50 rounded-2xl p-3 space-y-1.5 text-sm text-slate-600">
              {item.supplier && <p>🏭 Поставщик: <b>{item.supplier}</b></p>}
              {item.availability && <p>📦 Наличие: <b>{item.availability === "order_only" ? "Под заказ" : "В наличии"}</b></p>}
              {(item.priceNoVat || item.priceWithVat) && (
                <p>💰 Продажа: <b>{fmtShort(item.priceNoVat || 0)}</b> без НДС · <b>{fmtShort(item.priceWithVat || item.price || 0)}</b> с НДС</p>
              )}
              {!!item.buyPrice && (
                <p>🧾 Входная: <b>{fmtShort(item.buyPrice || 0)}</b>{item.buyPricePeriod ? ` (${item.buyPricePeriod})` : ""}</p>
              )}
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
    </RightSideCard>
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
    <RightSideCard
      open={true}
      onClose={onClose}
      showHeader={false}
      defaultWidth={640}
      minWidth={640}
      maxWidth={940}
    >
      <div className="w-full h-full max-w-none max-h-none bg-transparent rounded-none shadow-none flex flex-col overflow-hidden">
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
    </RightSideCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ITEM EDIT MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function ItemEditModal({ item, isNew, onClose, onSave, allowEquipmentType = false }: {
  item: Partial<WarehouseItem>; isNew: boolean; onClose: () => void;
  onSave: (body: Partial<WarehouseItem>) => Promise<void>;
  allowEquipmentType?: boolean;
}) {
  const [form, setForm] = useState<Partial<WarehouseItem>>({
    name: "", category: "Прочее", unit: "шт", stock: 0, minStock: 0, price: 0,
    priceNoVat: 0, priceWithVat: 0, buyPrice: 0, buyPricePeriod: "",
    sku: "", supplier: "", availability: "in_stock_supplier", notes: "", imageUrl: "", itemType: "consumable", ...item,
  });
  const [saving, setSaving] = useState(false);
  const [supplierOptions, setSupplierOptions] = useState<string[]>([]);

  const f = (k: keyof WarehouseItem) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API}/suppliers`, { headers: AH });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        const names = Array.isArray(data?.suppliers)
          ? data.suppliers.map((s: any) => String(s?.name ?? "").trim()).filter(Boolean)
          : [];
        setSupplierOptions(Array.from(new Set(names)));
      } catch {
        if (alive) setSupplierOptions([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setForm((p) => {
      const withVat = Number((p.priceWithVat ?? p.price) || 0);
      const noVat = Number(p.priceNoVat ?? (withVat ? withVat / 1.2 : 0));
      if (p.priceWithVat !== undefined && p.priceNoVat !== undefined) return p;
      return { ...p, priceWithVat: withVat, priceNoVat: noVat };
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    const withVat = +((form.priceWithVat as any) || (form.price as any) || 0);
    const noVat = +((form.priceNoVat as any) || (withVat ? (withVat / 1.2) : 0));
    await onSave({
      ...form,
      stock: +((form.stock as any) || 0),
      minStock: +((form.minStock as any) || 0),
      // Keep legacy field for existing calculations/documents.
      price: withVat,
      priceNoVat: noVat,
      priceWithVat: withVat,
      buyPrice: +((form.buyPrice as any) || 0),
      buyPricePeriod: String(form.buyPricePeriod || "").trim(),
    });
    setSaving(false);
  }

  return (
    <RightSideCard
      open={true}
      onClose={onClose}
      showHeader={false}
      defaultWidth={640}
      minWidth={640}
      maxWidth={940}
    >
      <div className="w-full h-full max-w-none max-h-none flex flex-col bg-transparent rounded-none shadow-none">
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
              {ITEM_TYPES.filter((t) => allowEquipmentType || t.key !== "equipment").map(t => (
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
            <FormNum label="Цена без НДС" value={form.priceNoVat} onChange={v => setForm(p => ({ ...p, priceNoVat: +v }))} />
            <FormNum label="Цена с НДС 20%" value={form.priceWithVat} onChange={v => setForm(p => ({ ...p, priceWithVat: +v }))} />
            <FormNum label="Входная цена (закупка)" value={form.buyPrice} onChange={v => setForm(p => ({ ...p, buyPrice: +v }))} />
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1">Артикул / SKU</label>
              <input value={form.sku || ""} onChange={f("sku")} placeholder="PIPE-14" className={INPUT} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold text-slate-500 block mb-1">Поставщик</label>
              <select value={form.supplier || ""} onChange={f("supplier") as any} className={INPUT}>
                <option value="">— Не выбран —</option>
                {supplierOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold text-slate-500 block mb-1">Наличие у поставщика</label>
              <select value={form.availability || "in_stock_supplier"} onChange={f("availability") as any} className={INPUT}>
                <option value="in_stock_supplier">В наличии</option>
                <option value="order_only">Под заказ</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold text-slate-500 block mb-1">Период входной цены (например, март 2026)</label>
              <input value={form.buyPricePeriod || ""} onChange={f("buyPricePeriod" as any)} placeholder="март 2026" className={INPUT} />
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
    </RightSideCard>
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
  const { fmtShort } = useCurrency();
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
          <span className="text-slate-600">По {<b>{fmtShort(po.pricePerUnit)}</b>}</span>
          <span className="font-bold text-teal-700">{fmtShort(po.totalCost)}</span>
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
