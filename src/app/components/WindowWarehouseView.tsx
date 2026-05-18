import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Calculator,
  Layers,
  Package,
  RefreshCw,
  Search,
  ShoppingCart,
  TableProperties,
} from "lucide-react";
import { API_BASE, getJson } from "../lib/apiClient";
import { useCurrency } from "./CurrencyContext";

interface WarehouseItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: number;
  sku: string;
  supplier?: string;
}

interface PurchaseOrder {
  id: string;
  itemName: string;
  itemUnit: string;
  qtyOrdered: number;
  qtyReceived: number;
  totalCost: number;
  supplier: string;
  status: "pending" | "ordered" | "received" | "cancelled";
  createdAt: string;
}

const WINDOW_GROUPS = [
  "Профильные системы",
  "Стеклопакеты",
  "Фурнитура",
  "Подоконники",
  "Отливы",
  "Откосы",
  "Москитные сетки",
  "Монтажные материалы",
];

const MATRIX_EXAMPLES = [
  { name: "Brusbox 60-3 СП24", source: "Avansum", state: "ожидает импорта" },
  { name: "Brusbox 70-5 СП32", source: "Avansum", state: "ожидает импорта" },
  { name: "Rehau Blitz 60 СП32", source: "Avansum", state: "ожидает импорта" },
  { name: "Балконная отделка и работы", source: "Закупки ОС+", state: "ожидает импорта" },
];

function money(n: number) {
  return Math.round(n || 0).toLocaleString("ru-RU");
}

function categoryMatch(category: string) {
  const lower = String(category || "").toLowerCase();
  if (lower.includes("проф")) return "Профильные системы";
  if (lower.includes("стек")) return "Стеклопакеты";
  if (lower.includes("фурн")) return "Фурнитура";
  if (lower.includes("подокон")) return "Подоконники";
  if (lower.includes("отлив")) return "Отливы";
  if (lower.includes("откос")) return "Откосы";
  if (lower.includes("сет")) return "Москитные сетки";
  return "Монтажные материалы";
}

export function WindowWarehouseView() {
  const { fmtShort, currency } = useCurrency();
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [warehouse, purchaseOrders] = await Promise.all([
        getJson<any>(`${API_BASE}/warehouse`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true }),
        getJson<any>(`${API_BASE}/purchase-orders`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true }),
      ]);
      setItems(Array.isArray(warehouse.items) ? warehouse.items : []);
      setOrders(Array.isArray(purchaseOrders.orders) ? purchaseOrders.orders : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const normalizedItems = useMemo(() => {
    return items.map((item) => ({ ...item, windowGroup: categoryMatch(item.category) }));
  }, [items]);

  const filtered = normalizedItems.filter((item) => {
    const q = query.trim().toLowerCase();
    const byQuery = !q || [item.name, item.category, item.sku, item.supplier].some((v) => String(v || "").toLowerCase().includes(q));
    const byGroup = group === "all" || item.windowGroup === group;
    return byQuery && byGroup;
  });

  const totalValue = normalizedItems.reduce((sum, item) => sum + Number(item.stock || 0) * Number(item.price || 0), 0);
  const lowCount = normalizedItems.filter((item) => Number(item.stock || 0) <= Number(item.minStock || 0)).length;
  const pendingOrders = orders.filter((order) => order.status === "pending" || order.status === "ordered");

  return (
    <div className="h-full overflow-auto bg-slate-50">
      <div className="mx-auto max-w-7xl p-4 lg:p-6 space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Склад оконного производства</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Материалы, комплектующие, матрицы цен и закупки для окон, дверей и балконов.
            </p>
          </div>
          <button
            onClick={() => void fetchAll()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Обновить
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <Package className="text-blue-600" size={20} />
            <p className="mt-3 text-2xl font-black text-slate-900">{normalizedItems.length}</p>
            <p className="text-xs font-bold text-slate-500">позиций склада</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <AlertTriangle className={lowCount ? "text-amber-600" : "text-slate-400"} size={20} />
            <p className="mt-3 text-2xl font-black text-slate-900">{lowCount}</p>
            <p className="text-xs font-bold text-slate-500">ниже минимума</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <Boxes className="text-emerald-600" size={20} />
            <p className="mt-3 text-2xl font-black text-slate-900">{fmtShort(totalValue)}</p>
            <p className="text-xs font-bold text-slate-500">стоимость остатков</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <ShoppingCart className="text-violet-600" size={20} />
            <p className="mt-3 text-2xl font-black text-slate-900">{pendingOrders.length}</p>
            <p className="text-xs font-bold text-slate-500">активных закупок</p>
          </div>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <Search size={16} className="text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по материалам, артикулу, поставщику"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
            <select value={group} onChange={(e) => setGroup(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
              <option value="all">Все группы</option>
              {WINDOW_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            <div className="grid grid-cols-[1.6fr_1fr_0.7fr_0.7fr_0.8fr] bg-slate-100 px-3 py-2 text-xs font-black uppercase text-slate-500">
              <span>Позиция</span>
              <span>Группа</span>
              <span>Остаток</span>
              <span>Минимум</span>
              <span>Цена</span>
            </div>
            {filtered.length ? filtered.slice(0, 80).map((item) => (
              <div key={item.id} className="grid grid-cols-[1.6fr_1fr_0.7fr_0.7fr_0.8fr] items-center border-t border-slate-100 px-3 py-3 text-sm">
                <div>
                  <p className="font-bold text-slate-900">{item.name}</p>
                  <p className="text-xs text-slate-400">{item.sku || "без артикула"} · {item.supplier || "поставщик не указан"}</p>
                </div>
                <span className="text-slate-600">{item.windowGroup}</span>
                <span className={item.stock <= item.minStock ? "font-black text-amber-700" : "font-bold text-slate-700"}>{item.stock} {item.unit}</span>
                <span className="text-slate-500">{item.minStock} {item.unit}</span>
                <span className="font-black text-slate-900">{money(item.price)} {currency}</span>
              </div>
            )) : (
              <div className="p-8 text-center text-sm text-slate-400">Материалы не найдены</div>
            )}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <TableProperties size={18} className="text-blue-600" />
              <h2 className="text-base font-black text-slate-900">Матрицы цен</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">Сюда подключаются таблицы ширина x высота из прайсов поставщиков.</p>
            <div className="mt-4 space-y-2">
              {MATRIX_EXAMPLES.map((matrix) => (
                <div key={matrix.name} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                  <div>
                    <p className="text-sm font-black text-slate-900">{matrix.name}</p>
                    <p className="text-xs text-slate-500">{matrix.source}</p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">{matrix.state}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <Calculator size={18} className="text-emerald-600" />
              <h2 className="text-base font-black text-slate-900">Правила BOM</h2>
            </div>
            <div className="mt-4 grid gap-2">
              {[
                "Из размеров изделия считаются профиль, стекло, фурнитура и доборы.",
                "По каждому заказу формируется резерв склада и закупочная потребность.",
                "Для балконов отдельно учитываются отделка, потолок, пол, парапет и работы.",
                "После утверждения КП фиксируется версия спецификации и цены.",
              ].map((rule) => (
                <div key={rule} className="flex gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  <Layers size={16} className="mt-0.5 shrink-0 text-slate-500" />
                  {rule}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
