import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Calculator,
  Layers,
  Package,
  RefreshCw,
  Search,
  ShoppingCart,
  TableProperties,
  X,
} from "lucide-react";
import { API_BASE, getJson, invalidateUrlPrefix, JH } from "../lib/apiClient";
import { useCurrency } from "./CurrencyContext";
import { useRole } from "./RoleContext";

interface WarehouseItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: number;
  buyPrice?: number;
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

type StockAction = "in" | "out";

interface StockModalState {
  action: StockAction;
  item: WarehouseItem | null;
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
  { name: "Brusbox 60-3 СП24", source: "Avansum", state: "импорт подключен" },
  { name: "Brusbox 70-5 СП32", source: "Avansum", state: "импорт подключен" },
  { name: "Rehau Blitz 60 СП32", source: "Avansum", state: "импорт подключен" },
  { name: "Балконная отделка и работы", source: "Закупки ОС+", state: "импорт подключен" },
];

const ROLE_COPY = {
  admin: {
    title: "Полный складской контур",
    text: "Пополнение, списание, закупочная цена, остатки, минимумы и контроль дефицита.",
  },
  manager: {
    title: "Наличие для КП",
    text: "Видны остатки и статус материалов для обещаний клиенту. Закупочная цена и движения скрыты.",
  },
  installer: {
    title: "Расход на монтаже",
    text: "Видны материалы для работ. Можно списать фактический расход после монтажа.",
  },
} as const;

function money(n: number) {
  return Math.round(n || 0).toLocaleString("ru-RU");
}

function categoryMatch(category: string) {
  const lower = String(category || "").toLowerCase();
  if (lower.includes("profile") || lower.includes("проф")) return "Профильные системы";
  if (lower.includes("glass") || lower.includes("стек")) return "Стеклопакеты";
  if (lower.includes("hardware") || lower.includes("фурн") || lower.includes("ручк") || lower.includes("петл")) return "Фурнитура";
  if (lower.includes("подокон")) return "Подоконники";
  if (lower.includes("отлив")) return "Отливы";
  if (lower.includes("откос")) return "Откосы";
  if (lower.includes("сет")) return "Москитные сетки";
  return "Монтажные материалы";
}

function reasonLabel(action: StockAction, role: string) {
  if (action === "in") return "purchase_receipt";
  return role === "installer" ? "installation_consumption" : "manual_writeoff";
}

export function WindowWarehouseView() {
  const { fmtShort, currency } = useCurrency();
  const { role } = useRole();
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [modal, setModal] = useState<StockModalState | null>(null);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const canReplenish = role === "admin";
  const canWriteOff = role === "admin" || role === "installer";
  const canSeeCosts = role === "admin";

  const fetchAll = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const [warehouse, purchaseOrders] = await Promise.all([
        getJson<any>(`${API_BASE}/warehouse`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true, force }),
        getJson<any>(`${API_BASE}/purchase-orders`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true, force }),
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

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return modal?.item ?? null;
    return normalizedItems.find((item) => item.id === selectedItemId) ?? modal?.item ?? null;
  }, [modal?.item, normalizedItems, selectedItemId]);

  const totalValue = normalizedItems.reduce((sum, item) => sum + Number(item.stock || 0) * Number(canSeeCosts ? item.buyPrice || item.price || 0 : item.price || 0), 0);
  const lowCount = normalizedItems.filter((item) => Number(item.stock || 0) <= Number(item.minStock || 0)).length;
  const pendingOrders = orders.filter((order) => order.status === "pending" || order.status === "ordered");

  const openModal = (action: StockAction, item?: WarehouseItem) => {
    setModal({ action, item: item ?? null });
    setSelectedItemId(item?.id ?? "");
    setQty("");
    setNote("");
    setError("");
  };

  const closeModal = () => {
    if (saving) return;
    setModal(null);
    setError("");
  };

  const submitStockAction = async () => {
    if (!modal) return;
    const item = selectedItem;
    const qtyNum = Number(String(qty).replace(",", "."));
    if (!item) {
      setError("Выберите позицию склада.");
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError("Укажите количество больше нуля.");
      return;
    }
    if (modal.action === "out" && qtyNum > Number(item.stock || 0)) {
      setError(`На складе ${item.stock} ${item.unit}, списать ${qtyNum} нельзя.`);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const endpoint = modal.action === "in" ? "stock-in" : "stock-out";
      const response = await fetch(`${API_BASE}/warehouse/${item.id}/${endpoint}`, {
        method: "POST",
        headers: JH,
        body: JSON.stringify({
          qty: qtyNum,
          reason: reasonLabel(modal.action, role),
          note: note.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `HTTP ${response.status}`);
      }
      invalidateUrlPrefix(`${API_BASE}/warehouse`);
      invalidateUrlPrefix(`${API_BASE}/purchase-orders`);
      await fetchAll(true);
      closeModal();
    } catch (e: any) {
      setError(String(e?.message || "Не удалось провести движение склада."));
    } finally {
      setSaving(false);
    }
  };

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
          <div className="flex flex-col gap-2 sm:flex-row">
            {canReplenish && (
              <button
                onClick={() => openModal("in")}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
              >
                <ArrowDownToLine size={16} /> Пополнить склад
              </button>
            )}
            {canWriteOff && (
              <button
                onClick={() => openModal("out")}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
              >
                <ArrowUpFromLine size={16} /> Списать расход
              </button>
            )}
            <button
              onClick={() => void fetchAll(true)}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Обновить
            </button>
          </div>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-black text-slate-900">{ROLE_COPY[role].title}</p>
          <p className="mt-1 text-sm text-slate-500">{ROLE_COPY[role].text}</p>
        </section>

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
            <p className="mt-3 text-2xl font-black text-slate-900">{canSeeCosts ? fmtShort(totalValue) : "скрыто"}</p>
            <p className="text-xs font-bold text-slate-500">{canSeeCosts ? "стоимость остатков" : "закупочная экономика"}</p>
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

          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <div className={`grid min-w-[920px] ${canWriteOff ? "grid-cols-[1.6fr_1fr_0.7fr_0.7fr_0.8fr_0.7fr]" : "grid-cols-[1.6fr_1fr_0.7fr_0.7fr_0.8fr]"} bg-slate-100 px-3 py-2 text-xs font-black uppercase text-slate-500`}>
              <span>Позиция</span>
              <span>Группа</span>
              <span>Остаток</span>
              <span>Минимум</span>
              <span>{canSeeCosts ? "Цена" : "Статус"}</span>
              {canWriteOff && <span>Действие</span>}
            </div>
            {filtered.length ? filtered.slice(0, 120).map((item) => {
              const low = item.stock <= item.minStock;
              return (
                <div key={item.id} className={`grid min-w-[920px] ${canWriteOff ? "grid-cols-[1.6fr_1fr_0.7fr_0.7fr_0.8fr_0.7fr]" : "grid-cols-[1.6fr_1fr_0.7fr_0.7fr_0.8fr]"} items-center border-t border-slate-100 px-3 py-3 text-sm`}>
                  <div>
                    <p className="font-bold text-slate-900">{item.name}</p>
                    <p className="text-xs text-slate-400">{item.sku || "без артикула"} · {item.supplier || "поставщик не указан"}</p>
                  </div>
                  <span className="text-slate-600">{item.windowGroup}</span>
                  <span className={low ? "font-black text-amber-700" : "font-bold text-slate-700"}>{item.stock} {item.unit}</span>
                  <span className="text-slate-500">{item.minStock} {item.unit}</span>
                  <span className="font-black text-slate-900">
                    {canSeeCosts ? `${money(item.price)} ${currency}` : low ? "нужна закупка" : "есть"}
                  </span>
                  {canWriteOff && (
                    <span className="flex gap-2">
                      {canReplenish && (
                        <button onClick={() => openModal("in", item)} className="rounded-md border border-slate-200 p-2 text-blue-600 hover:bg-blue-50" title="Пополнить">
                          <ArrowDownToLine size={15} />
                        </button>
                      )}
                      <button onClick={() => openModal("out", item)} className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" title="Списать">
                        <ArrowUpFromLine size={15} />
                      </button>
                    </span>
                  )}
                </div>
              );
            }) : (
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
            <p className="mt-1 text-sm text-slate-500">Таблицы ширина x высота из прайсов поставщиков подключаются к конфигуратору КП.</p>
            <div className="mt-4 space-y-2">
              {MATRIX_EXAMPLES.map((matrix) => (
                <div key={matrix.name} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                  <div>
                    <p className="text-sm font-black text-slate-900">{matrix.name}</p>
                    <p className="text-xs text-slate-500">{matrix.source}</p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">{matrix.state}</span>
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

      {modal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-black text-slate-900">{modal.action === "in" ? "Пополнить склад" : "Списать расход"}</h2>
                <p className="text-sm text-slate-500">{modal.action === "in" ? "Приход материалов от поставщика или ручная корректировка." : "Фактический расход на монтаж, производство или ручное списание."}</p>
              </div>
              <button onClick={closeModal} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <label className="block">
                <span className="text-xs font-bold uppercase text-slate-500">Позиция</span>
                <select
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
                >
                  <option value="">Выберите материал</option>
                  {normalizedItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · остаток {item.stock} {item.unit}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase text-slate-500">Количество {selectedItem ? `, ${selectedItem.unit}` : ""}</span>
                <input
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  inputMode="decimal"
                  placeholder="Например 12"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase text-slate-500">Комментарий</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder={modal.action === "in" ? "Поставка, накладная, поставщик" : "Заказ, объект, бригада"}
                  className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                />
              </label>
              {selectedItem && (
                <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  Сейчас на складе: <span className="font-black text-slate-900">{selectedItem.stock} {selectedItem.unit}</span>
                  {modal.action === "out" && qty ? `, после списания: ${Math.max(0, selectedItem.stock - Number(String(qty).replace(",", ".")) || 0)} ${selectedItem.unit}` : ""}
                </div>
              )}
              {error && <div className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button onClick={closeModal} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                Отмена
              </button>
              <button
                onClick={() => void submitStockAction()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving && <RefreshCw size={15} className="animate-spin" />}
                Провести
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
