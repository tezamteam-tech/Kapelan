import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useRole } from "./RoleContext";
import {
  Plus,
  RefreshCw,
  Search,
  ClipboardList,
  CheckCircle2,
  Package,
  Truck,
  CalendarDays,
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { ImageUpload } from "./ui/ImageUpload";
import { API_BASE, AH, JH, getJson, invalidateUrlPrefix } from "../lib/apiClient";

const API = API_BASE;

type OrderStatus =
  | "new"
  | "qualification"
  | "survey_scheduled"
  | "survey_done"
  | "offer_prepared"
  | "offer_sent"
  | "offer_approved"
  | "awaiting_supply"
  | "ready_to_schedule"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "closed"
  | "cancelled";

type OrderType = "installation" | "service" | "repair" | "maintenance" | "sale";

interface Order {
  id: string;
  number: string;
  type: OrderType;
  status: OrderStatus;
  client_id?: string;
  client_name?: string;
  client_phone?: string;
  object_address?: string;
  client_legal_name?: string;
  client_tax_id?: string;
  client_doc_basis?: string;
  client_email?: string;
  equipment_warehouse_id?: string;
  trace_length_m?: number;
  created_at: string;
  updated_at: string;
  offer?: {
    version: number;
    status: "draft" | "sent" | "approved" | "rejected" | "superseded";
    currency?: string;
    lines: Array<{
      line_type: "equipment" | "consumable" | "assembly" | "service" | "delivery" | "discount";
      warehouse_item_id?: string;
      name: string;
      qty: number;
      unit: string;
      price?: number;
    }>;
  };
  execution?: {
    status?: "not_scheduled" | "scheduled" | "in_progress" | "done" | "cancelled";
    prep_status?: "not_started" | "packing" | "ready" | "departed";
    scheduled_at?: string;
    started_at?: string;
    completed_at?: string;
    assigned_installer_id?: string;
    assigned_installer_name?: string;
    completion_notes?: string;
    photos?: string[];
    signed_act_url?: string;
    client_signed?: boolean;
    client_sign_name?: string;
    client_signed_at?: string;
    checklist?: {
      materials?: Record<string, boolean>;
      equipment?: boolean;
      tools?: Record<string, boolean>;
      custom?: Array<{ id: string; text: string; done: boolean }>;
      ready_confirmed?: boolean;
      updated_at?: string;
    };
  };
  survey?: {
    status?: "not_needed" | "scheduled" | "done" | "cancelled";
    scheduled_at?: string;
    performed_at?: string;
    assigned_installer_id?: string;
    assigned_installer_name?: string;
    notes?: string;
    photos?: string[];
    trace_length_m?: number;
    room_area_m2?: number;
    room_type?: string;
    mount_conditions?: string;
  };
}

interface WarehouseItem {
  id: string;
  name: string;
  unit: string;
  stock: number;
  itemType?: "consumable" | "assembly" | "equipment";
  price?: number;
}

interface MaterialLine {
  id: string;
  item_id: string;
  item_kind: "equipment" | "consumable" | "assembly";
  required_qty: number;
  reserved_qty: number;
  to_purchase_qty: number;
  used_qty?: number;
  writeoff_qty?: number;
  supply_source: "warehouse" | "supplier" | "mixed" | "made_to_order";
  supplier_id?: string | null;
  status: string;
}

interface SupplierRequest {
  id: string;
  supplier_id: string;
  status: string;
  lines: Array<{ id: string; item_id: string; qty: number; qty_received?: number; qty_remaining?: number; unit: string; status: string }>;
}

interface TimelineEvent {
  id: string;
  type: string;
  created_at: string;
  payload?: Record<string, any>;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "Новый",
  qualification: "Квалификация",
  survey_scheduled: "Замер назначен",
  survey_done: "Замер выполнен",
  offer_prepared: "КП подготовлено",
  offer_sent: "КП отправлено",
  offer_approved: "КП утверждено",
  awaiting_supply: "Ожидаем поставку",
  ready_to_schedule: "Готов к планированию",
  scheduled: "Запланирован",
  in_progress: "В работе",
  completed: "Выполнен",
  closed: "Закрыт",
  cancelled: "Отменён",
};

function prepBadge(prep?: string) {
  if (!prep) return null;
  const map: Record<string, { label: string; cls: string }> = {
    not_started: { label: "Сбор: не начат", cls: "bg-slate-100 text-slate-700" },
    packing: { label: "Сбор: собирают", cls: "bg-amber-100 text-amber-700" },
    ready: { label: "Сбор: готов", cls: "bg-emerald-100 text-emerald-700" },
    departed: { label: "Выезд", cls: "bg-blue-100 text-blue-700" },
  };
  return map[prep] ?? { label: prep, cls: "bg-slate-100 text-slate-700" };
}

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function badgeForSupply(materials: MaterialLine[]) {
  if (!materials.length) return { label: "—", cls: "bg-slate-100 text-slate-600" };
  const missing = materials.some((m) => m.to_purchase_qty > 0);
  const partial = materials.some((m) => m.reserved_qty > 0) && missing;
  if (!missing) return { label: "OK", cls: "bg-emerald-100 text-emerald-700" };
  if (partial) return { label: "Partial", cls: "bg-amber-100 text-amber-700" };
  return { label: "Missing", cls: "bg-red-100 text-red-700" };
}

export function OrdersView() {
  const navigate = useNavigate();
  const { role, userName } = useRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [q, setQ] = useState("");
  const [prepFilter, setPrepFilter] = useState<"all" | "departed" | "packing" | "ready" | "not_started">("all");
  const [installerScope, setInstallerScope] = useState<"my" | "all">("my");
  const [adminMode, setAdminMode] = useState<"full" | "warehouse">("full");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const [materials, setMaterials] = useState<MaterialLine[]>([]);
  const [supplierRequests, setSupplierRequests] = useState<SupplierRequest[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [warehouseEq, setWarehouseEq] = useState<WarehouseItem[]>([]);
  const [warehouseMap, setWarehouseMap] = useState<Record<string, WarehouseItem>>({});
  const [installers, setInstallers] = useState<Array<{ id: string; name: string }>>([]);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [partialReceiptReq, setPartialReceiptReq] = useState<SupplierRequest | null>(null);
  const [activeStep, setActiveStep] = useState<OrderStepKey>("qualification");
  const [revertingToNew, setRevertingToNew] = useState(false);
  const [statusFlash, setStatusFlash] = useState<{ from: string; to: string } | null>(null);
  const [createPrefill, setCreatePrefill] = useState<{
    client_id?: string;
    client_name?: string;
    client_phone?: string;
    object_address?: string;
    client_legal_name?: string;
    client_tax_id?: string;
    client_email?: string;
    client_doc_basis?: string;
  } | null>(null);

  const applyStepStatus = useCallback(async (step: OrderStepKey) => {
    if (!selected) return;
    const currentStep = stepForStatus(selected.status);
    const curIdx = STEP_CFG.findIndex((s) => s.key === currentStep);
    const targetIdx = STEP_CFG.findIndex((s) => s.key === step);
    if (curIdx !== -1 && targetIdx !== -1 && Math.abs(targetIdx - curIdx) > 1) {
      showToast(
        `Нельзя применить шаг «${STEP_CFG.find((x) => x.key === step)?.label}» с пропуском. ` +
          `Сначала примените соседний шаг (${targetIdx > curIdx ? "следующий" : "предыдущий"}).`,
        false,
      );
      return;
    }
    const stepToStatus: Record<OrderStepKey, OrderStatus> = {
      qualification: "qualification",
      survey: "survey_scheduled",
      offer: "offer_prepared",
      supply: "awaiting_supply",
      schedule: "ready_to_schedule",
      execute: "in_progress",
      close: "completed",
    };
    const nextStatus = stepToStatus[step];
    if (nextStatus === selected.status) return;
    const states = stepStatesForOrder(selected, materials, supplierRequests);
    const st = states[step];
    if (st.blockedReason) {
      showToast(`Нельзя перейти на шаг «${STEP_CFG.find((x) => x.key === step)?.label}»: ${st.blockedReason}`, false);
      return;
    }
    if (!confirm(`Сменить статус ордера на «${STATUS_LABEL[nextStatus]}»?\n\nМожно откатывать назад, но делайте осознанно.`)) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}`, { method: "PATCH", headers: JH, body: JSON.stringify({ status: nextStatus }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      flashStatus(STATUS_LABEL[selected.status] ?? String(selected.status), STATUS_LABEL[nextStatus] ?? String(nextStatus));
      showToast(`Статус: ${STATUS_LABEL[nextStatus]}`);
    } catch (e: any) {
      showToast(e?.message || "Не удалось изменить статус", false);
    }
  }, [selected, materials, supplierRequests, setOrders]);

  useEffect(() => {
    if (!selected) return;
    setActiveStep(stepForStatus(selected.status));
  }, [selected?.id, selected?.status]);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const flashStatus = useCallback((from: string, to: string) => {
    setStatusFlash({ from, to });
    setTimeout(() => setStatusFlash(null), 2600);
  }, []);

  const detailAbortRef = React.useRef<AbortController | null>(null);

  const loadWarehouseEquipment = useCallback(async (opts?: { force?: boolean }) => {
    try {
      const data = await getJson<{ items?: WarehouseItem[] }>(`${API}/warehouse`, {
        ttlMs: 2 * 60_000,
        force: opts?.force,
      });
      const items: WarehouseItem[] = data.items ?? [];
      const eq = items.filter((i) => String(i.itemType ?? "").toLowerCase() === "equipment");
      setWarehouseEq(eq);
      setWarehouseMap(items.reduce((acc, it) => {
        acc[it.id] = it;
        return acc;
      }, {} as Record<string, WarehouseItem>));
    } catch (e: any) {
      showToast(e?.message || "Не удалось загрузить склад", false);
    }
  }, [showToast]);

  const loadInstallers = useCallback(async (opts?: { force?: boolean }) => {
    try {
      const data = await getJson<any>(`${API}/installers`, { ttlMs: 5 * 60_000, force: opts?.force });
      const list = (data.installers ?? data.items ?? data.data ?? []) as Array<any>;
      const normalized = list
        .map((i) => ({ id: String(i.id ?? i.name ?? ""), name: String(i.name ?? "") }))
        .filter((i) => i.id && i.name);
      setInstallers(normalized);
    } catch {}
  }, []);

  const loadOrders = useCallback(async (opts?: { force?: boolean }) => {
    setLoading(true);
    try {
      const data = await getJson<{ orders?: Order[] }>(`${API}/orders?lite=1`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, force: opts?.force });
      setOrders(data.orders ?? []);
    } catch {
      showToast("Ошибка загрузки ордеров", false);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const prefetchOrderDetail = useCallback(async (id: string) => {
    try {
      // Warm cache: return instantly on click (SWR will refresh later)
      await getJson<any>(`${API}/orders/${id}?light=1`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true });
      // Also prefetch tab data in background
      void getJson<any>(`${API}/orders/${id}/materials`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true }).catch(() => null);
      void getJson<any>(`${API}/orders/${id}/supplier-requests`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true }).catch(() => null);
      void getJson<any>(`${API}/orders/${id}/timeline`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true }).catch(() => null);
    } catch {
      // ignore
    }
  }, []);

  const loadOrderDetail = useCallback(
    async (id: string) => {
      detailAbortRef.current?.abort();
      const ac = new AbortController();
      detailAbortRef.current = ac;
      setDetailLoading(true);
      try {
        // Fast path: load only base order first
        const base = await getJson<any>(`${API}/orders/${id}?light=1`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, signal: ac.signal, swr: true });
        if (base.error) throw new Error(base.error);
        setSelected(base.order);

        // Load heavy parts in parallel (each cached)
        const [m, s, t] = await Promise.all([
          getJson<any>(`${API}/orders/${id}/materials`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, signal: ac.signal, swr: true }),
          getJson<any>(`${API}/orders/${id}/supplier-requests`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, signal: ac.signal, swr: true }),
          getJson<any>(`${API}/orders/${id}/timeline`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, signal: ac.signal, swr: true }),
        ]);
        setMaterials(m.materials ?? []);
        setSupplierRequests(s.supplierRequests ?? []);
        setTimeline(t.timeline ?? []);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        showToast(e?.message || "Ошибка загрузки ордера", false);
      } finally {
        if (detailAbortRef.current === ac) detailAbortRef.current = null;
        setDetailLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    loadOrders();
    loadWarehouseEquipment();
    loadInstallers();
  }, [loadOrders, loadWarehouseEquipment, loadInstallers]);

  // Compatibility: create Order from Lead (legacy flow)
  useEffect(() => {
    const leadId = searchParams.get("fromLead");
    if (!leadId) return;
    (async () => {
      try {
        const data = await getJson<any>(`${API}/leads`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true });
        const lead = (data.leads ?? []).find((l: any) => l.id === leadId);
        if (!lead) throw new Error("Lead не найден");
        const cData = await getJson<any>(`${API}/client/${lead.clientId}`, { ttlMs: 10 * 60_000, staleTtlMs: 60 * 60_000, swr: true });
        const client = cData.client;
        setCreatePrefill({
          client_name: client?.name ?? "",
          client_phone: client?.phone ?? "",
          object_address: lead?.requirements_json?.address ?? "",
        });
        setCreateOpen(true);
      } catch (e: any) {
        showToast(e?.message || "Не удалось загрузить Lead", false);
      } finally {
        setSearchParams({}, { replace: true });
      }
    })();
  }, [searchParams, setSearchParams, showToast]);

  // Create Order from Client (primary flow)
  useEffect(() => {
    const clientId = searchParams.get("fromClient");
    if (!clientId) return;
    (async () => {
      try {
        const cData = await getJson<any>(`${API}/client/${clientId}`, { ttlMs: 10 * 60_000, staleTtlMs: 60 * 60_000, swr: true });
        const client = cData.client;
        if (!client) throw new Error("Клиент не найден");
        setCreatePrefill({
          client_id: clientId,
          client_name: client?.name ?? "",
          client_phone: client?.phone ?? "",
          object_address: client?.address ?? "",
          client_legal_name: client?.legal_name ?? "",
          client_tax_id: client?.tax_id ?? "",
          client_email: client?.email ?? "",
          client_doc_basis: client?.doc_basis ?? "",
        });
        setCreateOpen(true);
      } catch (e: any) {
        showToast(e?.message || "Не удалось загрузить клиента", false);
      } finally {
        setSearchParams({}, { replace: true });
      }
    })();
  }, [searchParams, setSearchParams, showToast]);

  // Open create modal explicitly (order-first flow)
  useEffect(() => {
    const create = searchParams.get("create");
    if (!create) return;
    setCreatePrefill(null);
    setCreateOpen(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (selectedId) loadOrderDetail(selectedId);
    else {
      setSelected(null);
      setMaterials([]);
      setSupplierRequests([]);
      setTimeline([]);
    }
  }, [selectedId, loadOrderDetail]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const base = orders.filter((o) => {
      const blob = `${o.number} ${o.client_name ?? ""} ${o.client_phone ?? ""} ${o.object_address ?? ""}`.toLowerCase();
      const matchQ = !qq || blob.includes(qq);
      const p = o.execution?.prep_status;
      const matchPrep =
        prepFilter === "all"
          ? true
          : prepFilter === "departed"
            ? p === "departed"
            : prepFilter === "ready"
              ? p === "ready"
              : prepFilter === "packing"
                ? p === "packing"
                : p === "not_started" || !p;
      const matchInstaller =
        role !== "installer"
          ? true
          : installerScope === "all"
            ? true
            : (o.execution?.assigned_installer_name ?? "") === userName;
      return matchQ && matchPrep && matchInstaller;
    });
    return base;
  }, [orders, q, prepFilter, role, installerScope, userName]);

  const adminInstallerGroups = useMemo(() => {
    const by: Record<string, Order[]> = {};
    for (const o of filtered) {
      const inst = o.execution?.assigned_installer_name || "Не назначено";
      (by[inst] ??= []).push(o);
    }
    const entries = Object.entries(by).map(([name, list]) => ({
      name,
      list: list.slice().sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
      departed: list.filter((o) => o.execution?.prep_status === "departed").length,
      packing: list.filter((o) => o.execution?.prep_status === "packing").length,
      ready: list.filter((o) => o.execution?.prep_status === "ready").length,
      notStarted: list.filter((o) => o.execution?.prep_status === "not_started" || !o.execution?.prep_status).length,
    }));
    // Put assigned installers first
    entries.sort((a, b) => (a.name === "Не назначено" ? 1 : 0) - (b.name === "Не назначено" ? 1 : 0) || a.name.localeCompare(b.name, "ru"));
    return entries;
  }, [filtered]);

  async function createOrder(payload: {
    client_id?: string;
    client_name: string;
    client_phone: string;
    object_address: string;
    equipment_warehouse_id?: string;
    trace_length_m?: number;
    client_legal_name?: string;
    client_tax_id?: string;
    client_email?: string;
    client_doc_basis?: string;
    offer?: any;
  }) {
    try {
      if (creating) return;
      setCreating(true);
      const idemKey = `ord_create_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const res = await fetch(`${API}/orders`, {
        method: "POST",
        headers: { ...JH, "Idempotency-Key": idemKey },
        body: JSON.stringify({ type: "installation", ...payload }),
      });
      const raw = await res.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`Сервер вернул не-JSON: ${raw.slice(0, 200)}`);
      }
      if (data.error) throw new Error(data.error);
      const ord: Order = data.order;
      setOrders((prev) => [ord, ...prev]);
      invalidateUrlPrefix(`${API}/orders`);
      setCreateOpen(false);
      setSelectedId(ord.id);
      showToast("Ордер создан");
    } catch (e: any) {
      showToast(e?.message || "Ошибка создания", false);
    } finally {
      setCreating(false);
    }
  }

  async function createOfferDraftFromEquipment() {
    if (!selected) return;
    const eqId = selected.equipment_warehouse_id;
    if (!eqId) {
      showToast("Выберите устройство (equipment) в ордере, чтобы собрать КП", false);
      return;
    }
    const eq = warehouseMap[eqId];
    if (!eq) {
      showToast("Не найдено устройство на складе", false);
      return;
    }
    try {
      const offer = {
        version: 1,
        status: "draft",
        currency: "UAH",
        lines: [
          {
            line_type: "equipment",
            warehouse_item_id: eq.id,
            name: eq.name,
            qty: 1,
            unit: eq.unit,
            price: eq.price,
          },
        ],
      };
      const res = await fetch(`${API}/orders/${selected.id}`, { method: "PATCH", headers: JH, body: JSON.stringify({ offer }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      showToast("КП (черновик) создано");
    } catch (e: any) {
      showToast(e?.message || "Ошибка создания КП", false);
    }
  }

  async function saveOfferLines(nextLines: NonNullable<Order["offer"]>["lines"]) {
    if (!selected) return;
    try {
      const nextOffer = {
        version: selected.offer?.version ?? 1,
        status: selected.offer?.status ?? "draft",
        currency: selected.offer?.currency ?? "UAH",
        lines: nextLines,
      };
      const res = await fetch(`${API}/orders/${selected.id}`, {
        method: "PATCH",
        headers: JH,
        body: JSON.stringify({ offer: nextOffer, status: selected.status === "offer_approved" ? selected.status : "offer_prepared" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      showToast("КП сохранено");
    } catch (e: any) {
      showToast(e?.message || "Ошибка сохранения КП", false);
    }
  }

  async function scheduleExecution(payload: { installerId: string; installerName: string; date: string }) {
    if (!selected) return;
    try {
      const execution = {
        ...(selected.execution ?? {}),
        status: "scheduled",
        scheduled_at: payload.date,
        assigned_installer_id: payload.installerId,
        assigned_installer_name: payload.installerName,
      };
      const res = await fetch(`${API}/orders/${selected.id}`, {
        method: "PATCH",
        headers: JH,
        body: JSON.stringify({ execution, status: "scheduled" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      showToast("Монтаж запланирован");
    } catch (e: any) {
      showToast(e?.message || "Ошибка планирования", false);
    }
  }

  async function startExecution() {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/execution/start`, { method: "POST", headers: JH });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      setTimeline(data.timeline ?? timeline);
      showToast("Работы начаты");
    } catch (e: any) {
      showToast(e?.message || "Ошибка старта", false);
    }
  }

  async function completeExecution(payload: { completion_notes?: string; client_signed: boolean; client_sign_name?: string }) {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/execution/complete`, {
        method: "POST",
        headers: JH,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      setTimeline(data.timeline ?? timeline);
      showToast("Работы завершены");
    } catch (e: any) {
      showToast(e?.message || "Ошибка завершения", false);
    }
  }

  async function saveActualMaterials(lines: Array<{ materialId: string; used_qty: number; writeoff_qty: number }>) {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/materials/usage`, {
        method: "POST",
        headers: JH,
        body: JSON.stringify({ lines }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMaterials(data.materials ?? materials);
      setTimeline(data.timeline ?? timeline);
      showToast("Факт материалов сохранён");
    } catch (e: any) {
      showToast(e?.message || "Ошибка сохранения материалов", false);
    }
  }

  async function saveExecutionPhotos(photos: string[]) {
    if (!selected) return;
    try {
      const execution = { ...(selected.execution ?? {}), photos };
      const res = await fetch(`${API}/orders/${selected.id}`, {
        method: "PATCH",
        headers: JH,
        body: JSON.stringify({ execution }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      showToast("Фото сохранены");
    } catch (e: any) {
      showToast(e?.message || "Ошибка сохранения фото", false);
    }
  }

  async function saveSignedAct(url: string | undefined) {
    if (!selected) return;
    try {
      const execution = { ...(selected.execution ?? {}), signed_act_url: url || undefined };
      const res = await fetch(`${API}/orders/${selected.id}`, {
        method: "PATCH",
        headers: JH,
        body: JSON.stringify({ execution }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      showToast("Акт загружен");
    } catch (e: any) {
      showToast(e?.message || "Ошибка сохранения акта", false);
    }
  }

  async function scheduleSurvey(payload: { installerId: string; installerName: string; date: string }) {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/survey/schedule`, {
        method: "POST",
        headers: JH,
        body: JSON.stringify({ installerId: payload.installerId, installerName: payload.installerName, scheduledAt: payload.date }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      setTimeline(data.timeline ?? timeline);
      showToast("Замер назначен");
    } catch (e: any) {
      showToast(e?.message || "Ошибка назначения замера", false);
    }
  }

  async function completeSurvey(payload: { performedAt: string; trace_length_m?: number; notes?: string; mount_conditions?: string }) {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/survey/complete`, {
        method: "POST",
        headers: JH,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      setTimeline(data.timeline ?? timeline);
      showToast("Замер выполнен, ордер обновлен");
    } catch (e: any) {
      showToast(e?.message || "Ошибка сохранения замера", false);
    }
  }

  async function approveOffer() {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/offer/approve`, { method: "POST", headers: JH });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      showToast("КП утверждено");
    } catch (e: any) {
      showToast(e?.message || "Ошибка", false);
    }
  }

  async function sendOffer() {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/offer/send`, { method: "POST", headers: JH });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      showToast("КП отправлено");
    } catch (e: any) {
      showToast(e?.message || "Ошибка", false);
    }
  }

  async function confirmOrder() {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/confirm`, { method: "POST", headers: JH });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelected(data.order);
      setMaterials(data.materials ?? []);
      setSupplierRequests(data.supplierRequests ?? []);
      // timeline is not returned by confirm endpoint yet, keep previous
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      showToast("Ордер подтвержден: план обеспечения сформирован");
    } catch (e: any) {
      showToast(e?.message || "Ошибка подтверждения", false);
    }
  }

  async function sendSupplierRequest(reqId: string) {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/supplier-requests/${reqId}/send`, { method: "POST", headers: JH });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSupplierRequests(data.supplierRequests ?? []);
      setTimeline(data.timeline ?? timeline);
      showToast("Заявка поставщику отправлена");
    } catch (e: any) {
      showToast(e?.message || "Ошибка отправки", false);
    }
  }

  async function cancelSupplierRequest(reqId: string) {
    if (!selected) return;
    const reason = prompt("Причина отмены заявки поставщику (опционально):") ?? "";
    try {
      const res = await fetch(`${API}/orders/${selected.id}/supplier-requests/${reqId}/cancel`, {
        method: "POST",
        headers: JH,
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSupplierRequests(data.supplierRequests ?? []);
      setTimeline(data.timeline ?? timeline);
      showToast("Заявка отменена");
    } catch (e: any) {
      showToast(e?.message || "Ошибка отмены", false);
    }
  }

  async function recalcSupply() {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/supply/recalc`, { method: "POST", headers: JH });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSupplierRequests(data.supplierRequests ?? []);
      setTimeline(data.timeline ?? timeline);
      showToast("Заявки пересчитаны");
    } catch (e: any) {
      showToast(e?.message || "Ошибка пересчета", false);
    }
  }

  async function downloadActPdf() {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/act/pdf`, { headers: AH });
      if (!res.ok) throw new Error("Не удалось скачать акт");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `act_${selected.number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Акт скачан");
    } catch (e: any) {
      showToast(e?.message || "Ошибка скачивания", false);
    }
  }

  async function downloadOfferPdf() {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/offer/pdf`, { headers: AH });
      if (!res.ok) throw new Error("Не удалось скачать КП");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `offer_${selected.number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("КП скачано");
    } catch (e: any) {
      showToast(e?.message || "Ошибка скачивания", false);
    }
  }

  async function receiveSupplierRequest(reqId: string) {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/supplier-requests/${reqId}/receive`, { method: "POST", headers: JH, body: JSON.stringify({}) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.order) {
        setSelected(data.order);
        setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      }
      setSupplierRequests(data.supplierRequests ?? []);
      setMaterials(data.materials ?? materials);
      setTimeline(data.timeline ?? timeline);
      showToast("Приемка выполнена");
    } catch (e: any) {
      showToast(e?.message || "Ошибка приемки", false);
    }
  }

  async function receiveSupplierRequestPartial(reqId: string, lines: Array<{ lineId: string; qtyReceived: number }>) {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/orders/${selected.id}/supplier-requests/${reqId}/receive`, {
        method: "POST",
        headers: JH,
        body: JSON.stringify({ lines }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.order) {
        setSelected(data.order);
        setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      }
      setSupplierRequests(data.supplierRequests ?? []);
      setMaterials(data.materials ?? materials);
      setTimeline(data.timeline ?? timeline);
      showToast("Приемка (частичная) выполнена");
    } catch (e: any) {
      showToast(e?.message || "Ошибка приемки", false);
    }
  }

  const nextActions = useMemo(() => {
    if (!selected) return [];
    const acts: Array<{ key: string; title: string; hint?: string; enabled?: boolean; onClick?: () => void }> = [];
    const offerStatus = selected.offer?.status;

    if (!selected.offer) {
      acts.push({
        key: "create_offer",
        title: "Создать КП (черновик)",
        hint: "Нужно для дальнейшего подтверждения ордера",
        enabled: true,
        onClick: createOfferDraftFromEquipment,
      });
      return acts;
    }

    if ((selected.offer.lines?.length ?? 0) === 0) {
      acts.push({ key: "fill_offer", title: "Заполнить КП", hint: "Добавьте хотя бы одну строку (оборудование/материалы/услуги)", enabled: false });
      return acts;
    }

    if (offerStatus === "draft") {
      acts.push({ key: "send_offer", title: "Отправить КП", hint: "После отправки можно утверждать", enabled: true, onClick: sendOffer });
      return acts;
    }

    if (offerStatus === "sent") {
      acts.push({ key: "approve_offer", title: "Утвердить КП", hint: "После утверждения можно подтвердить ордер", enabled: true, onClick: approveOffer });
      return acts;
    }

    if (offerStatus === "approved") {
      acts.push({
        key: "confirm_order",
        title: "Подтвердить ордер (обеспечение)",
        hint: "Сформирует материалы, резерв и заявки поставщикам",
        enabled: true,
        onClick: confirmOrder,
      });
    }

    if (selected.status === "ready_to_schedule" || selected.status === "scheduled") {
      acts.push({ key: "schedule", title: "Запланировать монтаж", hint: "Выберите монтажника и дату ниже", enabled: false });
    }

    return acts;
  }, [selected, createOfferDraftFromEquipment, sendOffer, approveOffer, confirmOrder]);

  const syncClientToOrder = useCallback(async () => {
    if (!selected?.client_id) {
      showToast("У ордера нет привязки к клиенту", false);
      return;
    }
    try {
      const cData = await getJson<any>(`${API}/client/${selected.client_id}`, { ttlMs: 10 * 60_000, staleTtlMs: 60 * 60_000, swr: true });
      const client = cData.client;
      if (!client) throw new Error("Клиент не найден");
      const patch: any = {
        client_id: selected.client_id,
        client_name: client?.name ?? "",
        client_phone: client?.phone ?? "",
        object_address: client?.address ?? "",
        client_legal_name: client?.legal_name ?? undefined,
        client_tax_id: client?.tax_id ?? undefined,
        client_email: client?.email ?? undefined,
        client_doc_basis: client?.doc_basis ?? undefined,
      };
      const res = await fetch(`${API}/orders/${selected.id}`, { method: "PATCH", headers: JH, body: JSON.stringify(patch) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setSelected(data.order);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      invalidateUrlPrefix(`${API}/orders/${selected.id}`);
      showToast("Данные клиента синхронизированы");
    } catch (e: any) {
      showToast(e?.message || "Ошибка синхронизации", false);
    }
  }, [selected, showToast]);

  return (
    <div className="flex h-full bg-slate-50">
      {/* Left: list */}
      <div className={`flex flex-col bg-white border-r border-slate-200 ${selected ? "hidden lg:flex lg:w-[420px]" : "flex-1"} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <ClipboardList size={18} className="text-blue-600" /> Ордера
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">Order-centric · {orders.length}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadOrders()}
              disabled={loading}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={() => { setCreatePrefill(null); setCreateOpen(true); }}
              className="flex items-center gap-1.5 bg-blue-600 text-white text-sm font-semibold px-3 py-2 rounded-xl hover:bg-blue-700 active:scale-95 transition-all shadow-sm"
            >
              <Plus size={16} /> Новый ордер
            </button>
          </div>
        </div>

        <div className="px-4 py-2.5 border-b border-slate-100">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <Search size={15} className="text-slate-400 flex-shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по номеру, клиенту, телефону, адресу…"
              className="bg-transparent flex-1 text-sm text-slate-700 placeholder-slate-400 outline-none"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {role === "installer" && (
              <>
                <span className="text-[11px] font-bold text-slate-500">Монтажник:</span>
                <button
                  onClick={() => setInstallerScope("my")}
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
                    installerScope === "my" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
                  }`}
                >
                  Мои
                </button>
                <button
                  onClick={() => setInstallerScope("all")}
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
                    installerScope === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
                  }`}
                >
                  Все
                </button>
              </>
            )}
            {role === "admin" && (
              <>
                <span className="text-[11px] font-bold text-slate-500">Режим:</span>
                <button
                  onClick={() => setAdminMode("full")}
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
                    adminMode === "full" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
                  }`}
                >
                  Полный
                </button>
                <button
                  onClick={() => setAdminMode("warehouse")}
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
                    adminMode === "warehouse" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
                  }`}
                >
                  Склад
                </button>
              </>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {([
              { key: "all", label: "Все" },
              { key: "not_started", label: "Сбор не начат" },
              { key: "packing", label: "Собирают" },
              { key: "ready", label: "Готов" },
              { key: "departed", label: "Выезд" },
            ] as const).map((f) => (
              <button
                key={f.key}
                onClick={() => setPrepFilter(f.key)}
                className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                  prepFilter === f.key
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {role === "admin" && (
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black text-slate-700">Админ-панель: кто с какими ордерами</p>
              <p className="text-[11px] text-slate-400">{adminInstallerGroups.length} групп</p>
            </div>
            <div className="mt-2 space-y-2 max-h-[200px] overflow-auto pr-1">
              {adminInstallerGroups.map((g) => (
                <div key={g.name} className="bg-white border border-slate-200 rounded-2xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-slate-800 truncate">{g.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Ордера: {g.list.length} · Выезд: {g.departed} · Готов: {g.ready} · Собирают: {g.packing}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      {g.departed > 0 && <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-blue-100 text-blue-700">Выезд</span>}
                      {g.ready > 0 && <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Готов</span>}
                      {g.packing > 0 && <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700">Собирают</span>}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {g.list.slice(0, 4).map((o) => (
                      <button
                        key={o.id}
                        onMouseEnter={() => void prefetchOrderDetail(o.id)}
                        onFocus={() => void prefetchOrderDetail(o.id)}
                        onClick={() => {
                          setSelected(o);
                          setMaterials([]);
                          setSupplierRequests([]);
                          setTimeline([]);
                          setSelectedId(o.id);
                        }}
                        className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                        title={o.object_address || ""}
                      >
                        {o.number}
                      </button>
                    ))}
                    {g.list.length > 4 && <span className="text-[11px] text-slate-400 self-center">+{g.list.length - 4}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading && orders.length === 0 ? (
            <div className="flex justify-center py-16 text-slate-300">
              <Loader2 className="animate-spin" size={28} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-slate-400 font-medium text-sm">Ордеров не найдено</p>
            </div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                onMouseEnter={() => void prefetchOrderDetail(o.id)}
                onFocus={() => void prefetchOrderDetail(o.id)}
                onClick={() => {
                  setSelected(o);
                  setMaterials([]);
                  setSupplierRequests([]);
                  setTimeline([]);
                  setSelectedId(o.id);
                }}
                className={`w-full text-left rounded-2xl border p-3 transition-all ${
                  selectedId === o.id ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-slate-800 truncate">{o.number}</p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {(o.client_name || "Клиент") + (o.object_address ? ` · ${o.object_address}` : "")}
                    </p>
                    {o.execution?.assigned_installer_name && (
                      <p className="text-[11px] text-slate-400 truncate mt-1">
                        Монтаж: {o.execution.assigned_installer_name}
                        {o.execution.prep_status ? ` · сбор: ${o.execution.prep_status}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                      {STATUS_LABEL[o.status]}
                    </span>
                    {o.execution?.prep_status && (
                      (() => {
                        const b = prepBadge(o.execution?.prep_status);
                        return b ? <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${b.cls}`}>{b.label}</span> : null;
                      })()
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>{fmtDateTime(o.created_at)}</span>
                  <span className="flex items-center gap-1">
                    <CalendarDays size={12} /> {o.trace_length_m ?? 4}м
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: details */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="bg-white border-b border-slate-200 px-4 lg:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => setSelectedId(null)} className="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-600">
                <ArrowLeft size={18} />
              </button>
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-800 truncate">{selected.number}</p>
                <p className="text-xs text-slate-500 truncate">
                  {selected.client_name || "Клиент"} · {selected.client_phone || "—"} · {selected.object_address || "Адрес: уточнить"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {detailLoading && <Loader2 size={16} className="animate-spin text-slate-300" />}
              {statusFlash && (
                <span className="hidden sm:inline-flex text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-900 border border-indigo-200">
                  {statusFlash.from} → {statusFlash.to}
                </span>
              )}
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">{STATUS_LABEL[selected.status]}</span>
              {role === "admin" && (
                <button
                  onClick={async () => {
                    if (!confirm(`Удалить ордер ${selected.number}?`)) return;
                    try {
                      const res = await fetch(`${API}/orders/${selected.id}`, { method: "DELETE", headers: AH });
                      const txt = await res.text();
                      let data: any = {};
                      try { data = txt ? JSON.parse(txt) : {}; } catch { throw new Error(txt.slice(0, 120)); }
                      if (!res.ok || data.error) throw new Error(data.error || "Не удалось удалить");
                      setOrders((prev) => prev.filter((o) => o.id !== selected.id));
                      setSelectedId(null);
                      showToast("Ордер удален");
                    } catch (e: any) {
                      showToast(e?.message || "Ошибка удаления", false);
                    }
                  }}
                  className="px-3 py-2 rounded-xl text-xs font-semibold border border-red-200 text-red-700 bg-red-50 hover:bg-red-100"
                >
                  Удалить
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
            <ClientSummaryCard
              order={selected}
              onOpenClients={
                role === "admin" || role === "manager"
                  ? () => {
                      const url = selected.client_id
                        ? `/clients?id=${encodeURIComponent(selected.client_id)}`
                        : (selected.client_phone ? `/clients?q=${encodeURIComponent(selected.client_phone)}` : "/clients");
                      navigate(url);
                    }
                  : undefined
              }
              onSyncFromClient={selected.client_id ? syncClientToOrder : undefined}
            />

            <OrderStepper
              status={selected.status}
              activeKey={activeStep}
              states={stepStatesForOrder(selected, materials, supplierRequests)}
              onStepClick={(key) => {
                setActiveStep(key);
                const st = stepStatesForOrder(selected, materials, supplierRequests)[key];
                if (st.blockedReason) {
                  showToast(`Чтобы выполнить шаг «${STEP_CFG.find((x) => x.key === key)?.label}», нужно: ${st.blockedReason}`, false);
                }
              }}
            />

            {(role === "admin" || role === "manager") && (
              <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="text-xs text-slate-500">
                  Текущий статус: <span className="font-extrabold text-slate-800">{STATUS_LABEL[selected.status]}</span>
                  {" · "}
                  Открыт экран: <span className="font-extrabold text-indigo-800">{STEP_CFG.find((s) => s.key === activeStep)?.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => applyStepStatus(activeStep)}
                    className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                    title="Проставит статус под выбранный шаг (только соседний шаг без пропусков)"
                  >
                    Применить статус шага
                  </button>
                </div>
              </div>
            )}

            {activeStep === "qualification" && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-extrabold text-slate-800">Старт / Квалификация</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Здесь менеджер понимает вводные и выбирает следующий шаг: замер, КП или планирование.
                    Это не “действие”, а экран навигации по процессу.
                  </p>
                </div>
                {(role === "admin" || role === "manager") && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!selected) return;
                      if (!confirm("Вернуть статус ордера на «Новый»?")) return;
                      const from = STATUS_LABEL[selected.status] ?? selected.status;
                      const to = STATUS_LABEL.new;
                      setRevertingToNew(true);
                      try {
                        const res = await fetch(`${API}/orders/${selected.id}`, { method: "PATCH", headers: JH, body: JSON.stringify({ status: "new" }) });
                        const data = await res.json();
                        if (data.error) throw new Error(data.error);
                        setSelected(data.order);
                        setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
                        flashStatus(from, to);
                        showToast(`Статус изменён: ${from} → ${to}`);
                      } catch (e: any) {
                        showToast(e?.message || "Не удалось изменить статус", false);
                      } finally {
                        setRevertingToNew(false);
                      }
                    }}
                    disabled={revertingToNew}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border ${
                      revertingToNew
                        ? "border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed"
                        : "border-slate-200 text-slate-700 bg-white hover:bg-slate-50"
                    }`}
                  >
                    {revertingToNew ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        Возврат…
                      </span>
                    ) : (
                      "← Вернуть на «Новый»"
                    )}
                  </button>
                )}
              </div>
              {nextActions.length === 0 ? (
                <p className="text-sm text-slate-500 mt-1">Нет обязательных действий. Можно планировать/исполнять.</p>
              ) : (
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {nextActions.map((a) => (
                    <button
                      key={a.key}
                      disabled={a.enabled === false || !a.onClick}
                      onClick={a.onClick}
                      className={`text-left rounded-2xl border px-4 py-3 transition-all ${
                        a.enabled === false || !a.onClick
                          ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                          : "border-blue-200 bg-blue-50 text-slate-800 hover:border-blue-300"
                      }`}
                    >
                      <p className="text-sm font-extrabold">{a.title}</p>
                      {a.hint && <p className="text-[11px] mt-0.5 text-slate-500">{a.hint}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}

            {activeStep === "offer" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs text-slate-400 font-semibold">КП</p>
                <p className="text-sm font-bold text-slate-800 mt-1">
                  {selected.offer ? (selected.offer.status === "approved" ? "Утверждено" : "Не утверждено") : "Нет"}
                </p>
                {!selected.offer && (
                  <div className="mt-2">
                    <p className="text-xs text-slate-400">
                      КП нужно для подтверждения ордера. Для MVP можно создать черновик КП из выбранного оборудования.
                    </p>
                    <button
                      onClick={createOfferDraftFromEquipment}
                      className="mt-3 w-full flex items-center justify-center gap-2 bg-slate-900 text-white text-sm font-semibold px-3 py-2 rounded-xl hover:bg-slate-800 active:scale-[0.99] transition-all"
                    >
                      <CheckCircle2 size={16} /> Создать КП (черновик)
                    </button>
                  </div>
                )}
                {selected.offer && selected.offer.status !== "approved" && (
                  <div className="mt-3 space-y-2">
                    <button
                      onClick={sendOffer}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white text-sm font-semibold px-3 py-2 rounded-xl hover:bg-blue-700 active:scale-[0.99] transition-all"
                    >
                      <Truck size={16} /> Отправить КП
                    </button>
                    <button
                      onClick={approveOffer}
                      disabled={selected.offer.status !== "sent"}
                      className={`w-full flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2 rounded-xl active:scale-[0.99] transition-all ${
                        selected.offer.status === "sent"
                          ? "bg-slate-900 text-white hover:bg-slate-800"
                          : "bg-slate-200 text-slate-500 cursor-not-allowed"
                      }`}
                    >
                      <CheckCircle2 size={16} /> Утвердить КП
                    </button>
                    <p className="text-[11px] text-slate-400">
                      После утверждения можно подтверждать ордер для расчета материалов, резерва и заявок поставщикам.
                    </p>
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs text-slate-400 font-semibold">Комплектование</p>
                {(() => {
                  const b = badgeForSupply(materials);
                  return (
                    <div className="mt-1 flex items-center justify-between">
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${b.cls}`}>{b.label}</span>
                      <span className="text-xs text-slate-400">{materials.length} поз.</span>
                    </div>
                  );
                })()}
                <button
                  onClick={confirmOrder}
                  className="mt-3 w-full flex items-center justify-center gap-2 bg-blue-600 text-white text-sm font-semibold px-3 py-2 rounded-xl hover:bg-blue-700 active:scale-[0.99] transition-all"
                >
                  <Package size={16} /> Подтвердить ордер (обеспечение)
                </button>
                <p className="text-[11px] text-slate-400 mt-2">
                  Сформирует потребность, резерв со склада и заявки поставщикам по дефициту.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs text-slate-400 font-semibold">Поставщики</p>
                <p className="text-sm font-bold text-slate-800 mt-1">{supplierRequests.length ? `${supplierRequests.length} заявок` : "—"}</p>
                <div className="mt-2 space-y-1">
                  {supplierRequests.slice(0, 3).map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-xs text-slate-600">
                      <span className="truncate">{r.supplier_id}</span>
                      <span className="text-slate-400">{r.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            )}

            {activeStep === "offer" && adminMode !== "warehouse" && role !== "installer" && (
              <div>
                <OfferEditor
                  offer={selected.offer}
                  warehouseMap={warehouseMap}
                  onCreateDraft={createOfferDraftFromEquipment}
                  onSaveLines={saveOfferLines}
                />
              </div>
            )}

            {activeStep === "survey" && (
            <div>
              <SurveyPanel
                survey={selected.survey}
                installers={installers}
                traceLengthCurrent={selected.trace_length_m ?? 4}
                onSchedule={scheduleSurvey}
                onComplete={completeSurvey}
              />
            </div>
            )}

            {activeStep === "schedule" && (
              <>
                <div className="bg-white border border-slate-200 rounded-2xl p-4">
                  <p className="text-xs text-slate-400 font-semibold">Планирование</p>
                  <p className="text-sm font-bold text-slate-800 mt-1">Чек‑лист подготовки к выезду</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    На этом шаге формируем действия для монтажников: комплект со склада, инструменты, готовность.
                  </p>
                </div>

                <ExecutionPlanner
                  execution={selected.execution}
                  installers={installers}
                  onSchedule={scheduleExecution}
                  onStart={startExecution}
                  onComplete={completeExecution}
                  onDownloadAct={downloadActPdf}
                  mode="plan"
                />

                <InstallerChecklistPanel
                  orderNumber={selected.number}
                  equipmentWarehouseId={selected.equipment_warehouse_id}
                  materials={materials}
                  warehouseMap={warehouseMap}
                  supplierRequests={supplierRequests}
                  execution={selected.execution}
                  onSaveChecklist={async (next, nextPrep) => {
                    if (!selected) return;
                    if (nextPrep === "departed") {
                      const res = await fetch(`${API}/orders/${selected.id}/execution/depart`, {
                        method: "POST",
                        headers: JH,
                        body: JSON.stringify({ note: "Выезд на монтаж" }),
                      });
                      const data = await res.json();
                      if (data.error) throw new Error(data.error);
                      if (data.order) {
                        setSelected(data.order);
                        setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
                        setTimeline(data.timeline ?? timeline);
                        showToast("Выезд зафиксирован");
                      }
                    } else {
                      const execution = { ...(selected.execution ?? {}), checklist: next, prep_status: nextPrep };
                      const res = await fetch(`${API}/orders/${selected.id}`, {
                        method: "PATCH",
                        headers: JH,
                        body: JSON.stringify({ execution }),
                      });
                      const data = await res.json();
                      if (data.order) {
                        setSelected(data.order);
                        setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
                        showToast("Чеклист сохранен");
                      }
                    }
                  }}
                />
              </>
            )}

            {activeStep === "execute" && (
              <>
                <ExecutionPlanner
                  execution={selected.execution}
                  installers={installers}
                  onSchedule={scheduleExecution}
                  onStart={startExecution}
                  onComplete={completeExecution}
                  onDownloadAct={downloadActPdf}
                  mode="execute"
                />
              </>
            )}

            {activeStep === "execute" && (
              <MaterialsActualPanel
                orderStatus={selected.status}
                materials={materials}
                warehouseMap={warehouseMap}
                onSave={saveActualMaterials}
              />
            )}

            {activeStep === "execute" && (
              <InstallerChecklistPanel
                orderNumber={selected.number}
                equipmentWarehouseId={selected.equipment_warehouse_id}
                materials={materials}
                warehouseMap={warehouseMap}
                supplierRequests={supplierRequests}
                execution={selected.execution}
                onSaveChecklist={async (next, nextPrep) => {
                  if (!selected) return;
                  if (nextPrep === "departed") {
                    const res = await fetch(`${API}/orders/${selected.id}/execution/depart`, {
                      method: "POST",
                      headers: JH,
                      body: JSON.stringify({ note: "Выезд на монтаж" }),
                    });
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);
                    if (data.order) {
                      setSelected(data.order);
                      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
                      setTimeline(data.timeline ?? timeline);
                      showToast("Выезд зафиксирован");
                    }
                  } else {
                    const execution = { ...(selected.execution ?? {}), checklist: next, prep_status: nextPrep };
                    const res = await fetch(`${API}/orders/${selected.id}`, {
                      method: "PATCH",
                      headers: JH,
                      body: JSON.stringify({ execution }),
                    });
                    const data = await res.json();
                    if (data.order) {
                      setSelected(data.order);
                      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
                      showToast("Чеклист сохранен");
                    }
                  }
                }}
              />
            )}

            {activeStep === "offer" && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-800">Документы</p>
                <span className="text-xs text-slate-400">Order</span>
              </div>
              <div className="p-4 flex flex-wrap items-center gap-2">
                <button
                  onClick={downloadOfferPdf}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                >
                  Скачать КП (PDF)
                </button>
                <button
                  onClick={downloadActPdf}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
                >
                  Скачать акт выполненных работ (PDF)
                </button>
                <span className="text-[11px] text-slate-400">
                  Черновики формируются из данных ордера (клиент/реквизиты/адрес), КП и исполнения.
                </span>
              </div>
            </div>
            )}

            {activeStep === "close" && (
              <>
                {selected.status !== "completed" && selected.status !== "closed" && selected.status !== "cancelled" && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                    <p className="text-sm font-extrabold text-amber-900">Закрытие обычно делается после выполнения</p>
                    <p className="text-[11px] text-amber-800 mt-1">
                      Но фото/акт можно загружать сразу с объекта — это помогает контролировать качество.
                    </p>
                  </div>
                )}
                <CloseoutPanel
                  execution={selected.execution}
                  onSavePhotos={saveExecutionPhotos}
                  onSaveSignedAct={saveSignedAct}
                />
                <TimelinePanel timeline={timeline} />
              </>
            )}

            {activeStep === "supply" && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-800">Материалы</p>
                <span className="text-xs text-slate-400">{materials.length}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {materials.length === 0 ? (
                  <div className="p-4 text-sm text-slate-400">Пока не сформировано. Утвердите КП и/или подтвердите ордер.</div>
                ) : (
                  materials.map((m) => (
                    <div key={m.id} className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {warehouseMap[m.item_id]?.name ?? m.item_id}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {m.item_kind} · source: {m.supply_source}
                          {m.supplier_id ? ` · ${m.supplier_id}` : ""}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-black text-slate-800">
                          {m.required_qty} / <span className="text-emerald-700">{m.reserved_qty}</span> /{" "}
                          <span className="text-amber-700">{m.to_purchase_qty}</span>
                        </p>
                        <p className="text-[11px] text-slate-400">нужно / резерв / к закупке</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            )}

            {activeStep === "supply" && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-800">Заявки поставщикам</p>
                  <span className="text-xs text-slate-400">{supplierRequests.length}</span>
                </div>
                <button
                  onClick={recalcSupply}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  Пересчитать
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {supplierRequests.length === 0 ? (
                  <div className="p-4 text-sm text-slate-400">Нет заявок. Если есть дефицит — появятся после подтверждения ордера.</div>
                ) : (
                  supplierRequests.map((r) => (
                    <div key={r.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-extrabold text-slate-800 truncate">{r.supplier_id}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">id: {r.id}</p>
                        </div>
                        {(() => {
                          const b = supplierReqBadge(r.status);
                          return <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${b.cls}`}>{b.label}</span>;
                        })()}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500">
                        {(() => {
                          const total = r.lines.reduce((s, l) => s + (l.qty ?? 0), 0);
                          const received = r.lines.reduce((s, l) => s + (l.qty_received ?? 0), 0);
                          return `Принято: ${received} / ${total}`;
                        })()}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(() => {
                          const canSend = r.status === "draft" || r.status === "pending_send";
                          const canCancel = r.status !== "received" && r.status !== "cancelled";
                          const canReceive = r.status !== "cancelled" && r.status !== "received";
                          return (
                            <>
                        <button
                          onClick={() => sendSupplierRequest(r.id)}
                          disabled={!canSend}
                          className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                            canSend ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-200 text-slate-500 cursor-not-allowed"
                          }`}
                        >
                          Отправить
                        </button>
                        <button
                          onClick={() => cancelSupplierRequest(r.id)}
                          disabled={!canCancel}
                          className={`px-3 py-2 rounded-xl border text-xs font-semibold ${
                            canCancel ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-slate-200 text-slate-400 cursor-not-allowed bg-slate-50"
                          }`}
                        >
                          Отменить
                        </button>
                        <button
                          onClick={() => setPartialReceiptReq(r)}
                          disabled={!canReceive}
                          className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                            canReceive ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-200 text-slate-500 cursor-not-allowed"
                          }`}
                        >
                          Приемка (частичная)
                        </button>
                        <button
                          onClick={() => receiveSupplierRequest(r.id)}
                          disabled={!canReceive}
                          className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                            canReceive ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-200 text-slate-500 cursor-not-allowed"
                          }`}
                        >
                          Приемка (полная)
                        </button>
                        <span className="text-[11px] text-slate-400 self-center">
                          Приемка добавит приход на склад и закроет дефициты по материалам.
                        </span>
                            </>
                          );
                        })()}
                      </div>
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                        {r.lines.map((ln) => (
                          <div key={ln.id} className="border border-slate-200 rounded-xl px-3 py-2">
                            <p className="text-xs font-semibold text-slate-800 truncate">
                              {warehouseMap[ln.item_id]?.name ?? ln.item_id}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              заказано: {ln.qty} {ln.unit} · принято: {ln.qty_received ?? 0} · осталось:{" "}
                              {ln.qty_remaining ?? Math.max(0, ln.qty - (ln.qty_received ?? 0))} · {ln.status}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            )}
          </div>
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center text-slate-300">
          <div className="text-center">
            <p className="text-4xl mb-3">📦</p>
            <p className="text-slate-400 font-medium text-sm">Выберите ордер слева</p>
          </div>
        </div>
      )}

      {/* Create modal */}
      {createOpen && (
        <CreateOrderModal
          warehouseEq={warehouseEq}
          prefill={createPrefill}
          onClose={() => setCreateOpen(false)}
          onCreate={createOrder}
          creating={creating}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-[100]">
          <div
            className={`px-4 py-3 rounded-2xl shadow-lg border text-sm font-semibold ${
              toast.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
            }`}
          >
            {toast.msg}
          </div>
        </div>
      )}

      {partialReceiptReq && (
        <PartialReceiptModal
          req={partialReceiptReq}
          warehouseMap={warehouseMap}
          onClose={() => setPartialReceiptReq(null)}
          onSubmit={async (lines) => {
            await receiveSupplierRequestPartial(partialReceiptReq.id, lines);
            setPartialReceiptReq(null);
          }}
        />
      )}
    </div>
  );
}

function CreateOrderModal({
  warehouseEq,
  prefill,
  onClose,
  onCreate,
  creating,
}: {
  warehouseEq: WarehouseItem[];
  prefill: {
    client_id?: string;
    client_name?: string;
    client_phone?: string;
    object_address?: string;
    client_legal_name?: string;
    client_tax_id?: string;
    client_email?: string;
    client_doc_basis?: string;
  } | null;
  onClose: () => void;
  onCreate: (payload: {
    client_id?: string;
    client_name: string;
    client_phone: string;
    object_address: string;
    client_legal_name?: string;
    client_tax_id?: string;
    client_email?: string;
    client_doc_basis?: string;
    equipment_warehouse_id?: string;
    trace_length_m?: number;
    offer?: any;
  }) => void;
  creating?: boolean;
}) {
  type ClientLite = {
    id: string;
    name: string;
    phone: string;
    email?: string | null;
    type?: string;
    legal_name?: string;
    tax_id?: string;
    address?: string;
    doc_basis?: string;
  };

  const [step, setStep] = useState<"client" | "order">("client");
  const [clientQ, setClientQ] = useState("");
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [clientCreating, setClientCreating] = useState(false);

  const [selClient, setSelClient] = useState<ClientLite | null>(() => {
    if (!prefill?.client_id) return null;
    return {
      id: prefill.client_id,
      name: prefill.client_name || "",
      phone: prefill.client_phone || "",
      email: prefill.client_email || null,
      legal_name: prefill.client_legal_name || "",
      tax_id: prefill.client_tax_id || "",
      address: prefill.object_address || "",
      doc_basis: prefill.client_doc_basis || "",
    };
  });

  const [address, setAddress] = useState(prefill?.object_address ?? "");
  const eqMap = useMemo(() => {
    const m: Record<string, WarehouseItem> = {};
    for (const i of warehouseEq) m[i.id] = i;
    return m;
  }, [warehouseEq]);

  type EquipmentModelLite = {
    id: string;
    type?: string;
    brand?: string;
    model?: string;
    price?: number;
    warranty?: number;
    imageUrl?: string;
    warehouseItemId?: string;
    active?: boolean;
  };
  const [catalogEq, setCatalogEq] = useState<EquipmentModelLite[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [eqLines, setEqLines] = useState<Array<{ id: string; qty: number }>>([{ id: "", qty: 1 }]);
  const [traceLen, setTraceLen] = useState<number>(4);

  // New client draft
  const [cType, setCType] = useState<"individual" | "company">("individual");
  const [cName, setCName] = useState(prefill?.client_name ?? "");
  const [cPhone, setCPhone] = useState(prefill?.client_phone ?? "");
  const [cEmail, setCEmail] = useState(prefill?.client_email ?? "");
  const [cLegalName, setCLegalName] = useState(prefill?.client_legal_name ?? "");
  const [cTaxId, setCTaxId] = useState(prefill?.client_tax_id ?? "");
  const [cAddress, setCAddress] = useState(prefill?.object_address ?? "");
  const [cBasis, setCBasis] = useState(prefill?.client_doc_basis ?? "");

  useEffect(() => {
    (async () => {
      setClientsLoading(true);
      try {
        const res = await fetch(`${API}/clients`, { headers: AH });
        const data = await res.json().catch(() => ({}));
        setClients(Array.isArray(data.clients) ? data.clients : []);
      } catch {
        setClients([]);
      } finally {
        setClientsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    // If warehouse has no equipment items, fallback to equipment catalog (KV module).
    if (warehouseEq.length > 0) return;
    let alive = true;
    (async () => {
      setCatalogLoading(true);
      try {
        const data = await getJson<{ equipment?: EquipmentModelLite[] }>(`${API}/equipment`, { ttlMs: 2 * 60_000, staleTtlMs: 10 * 60_000, swr: true });
        if (!alive) return;
        const list = Array.isArray(data.equipment) ? data.equipment : [];
        setCatalogEq(list.filter((e) => e && e.active !== false));
      } catch {
        if (!alive) return;
        setCatalogEq([]);
      } finally {
        if (!alive) return;
        setCatalogLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [warehouseEq.length]);

  const filteredClients = useMemo(() => {
    const qq = clientQ.trim().toLowerCase();
    if (!qq) return clients;
    return clients.filter((c) => (`${c.name} ${c.phone} ${c.legal_name ?? ""} ${c.tax_id ?? ""}`).toLowerCase().includes(qq));
  }, [clientQ, clients]);

  const canNext = Boolean(selClient?.id);
  const canCreate = Boolean(selClient?.id) && address.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={onClose}>
      <div
        className="w-full sm:max-w-xl h-[92vh] sm:h-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-xl border border-slate-200 flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <p className="text-base font-black text-slate-800">Новый Order (услуга)</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="p-4 sm:p-5 space-y-4 overflow-auto">
          {step === "client" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Шаг 1</p>
                  <p className="text-sm font-black text-slate-800 mt-1">Клиент</p>
                </div>
                <button type="button" onClick={() => setCreateClientOpen((v) => !v)} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold">
                  + Новый клиент
                </button>
              </div>

              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <Search size={14} className="text-slate-400" />
                <input value={clientQ} onChange={(e) => setClientQ(e.target.value)} className="bg-transparent flex-1 outline-none text-sm" placeholder="Поиск по ФИО/телефону/юр.данным…" />
                {clientsLoading ? <Loader2 size={14} className="animate-spin text-slate-300" /> : null}
              </div>

              <div className="max-h-[360px] overflow-auto border border-slate-200 rounded-2xl">
                {filteredClients.map((c) => {
                  const active = selClient?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelClient(c);
                        setAddress(c.address ?? "");
                        setCreateClientOpen(false);
                      }}
                      className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ${active ? "bg-indigo-50" : "bg-white"}`}
                    >
                      <p className="text-sm font-extrabold text-slate-900 truncate">{c.name || "—"}</p>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{c.phone || "—"}</p>
                      {(c.legal_name || c.tax_id) ? (
                        <p className="text-[11px] text-slate-400 truncate mt-1">
                          {c.legal_name || "—"}{c.tax_id ? ` · УНП: ${c.tax_id}` : ""}
                        </p>
                      ) : null}
                    </button>
                  );
                })}
                {filteredClients.length === 0 ? <div className="p-6 text-sm text-slate-400">Клиентов не найдено</div> : null}
              </div>

              {createClientOpen && (
                <div className="border border-slate-200 rounded-2xl p-3 bg-white">
                  <p className="text-sm font-black text-slate-800">Создать клиента</p>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field label="Тип">
                      <select value={cType} onChange={(e) => setCType(e.target.value as any)} className={inputCls}>
                        <option value="individual">Физ. лицо</option>
                        <option value="company">Юр. лицо</option>
                      </select>
                    </Field>
                    <div />
                    <Field label="ФИО / Контакт">
                      <input value={cName} onChange={(e) => setCName(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="Телефон">
                      <input value={cPhone} onChange={(e) => setCPhone(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="Email (опц.)">
                      <input value={cEmail} onChange={(e) => setCEmail(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="Адрес (опц.)">
                      <input value={cAddress} onChange={(e) => setCAddress(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="Юр. название (опц.)">
                      <input value={cLegalName} onChange={(e) => setCLegalName(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="УНП/ИНН (опц.)">
                      <input value={cTaxId} onChange={(e) => setCTaxId(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="Основание (опц.)">
                      <input value={cBasis} onChange={(e) => setCBasis(e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setCreateClientOpen(false)} className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50">
                      Отмена
                    </button>
                    <button
                      type="button"
                      disabled={clientCreating || !cName.trim() || !cPhone.trim()}
                      onClick={async () => {
                        if (clientCreating) return;
                        setClientCreating(true);
                        try {
                          const res = await fetch(`${API}/clients`, {
                            method: "POST",
                            headers: JH,
                            body: JSON.stringify({
                              type: cType,
                              name: cName.trim(),
                              phone: cPhone.trim(),
                              email: cEmail.trim() ? cEmail.trim() : null,
                              legal_name: cLegalName.trim(),
                              tax_id: cTaxId.trim(),
                              address: cAddress.trim(),
                              doc_basis: cBasis.trim(),
                            }),
                          });
                          const d = await res.json().catch(() => ({}));
                          if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
                          const created = d.client as ClientLite;
                          setClients((prev) => [created, ...prev]);
                          setSelClient(created);
                          setAddress(created.address ?? "");
                          setCreateClientOpen(false);
                        } finally {
                          setClientCreating(false);
                        }
                      }}
                      className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black disabled:opacity-60"
                    >
                      {clientCreating ? "Создание…" : "Создать"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Шаг 2</p>
                  <p className="text-sm font-black text-slate-800 mt-1">Ордер</p>
                </div>
                <button type="button" onClick={() => setStep("client")} className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50">
                  ← Клиент
                </button>
              </div>

              {selClient ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                  <p className="text-xs font-bold text-slate-500">Клиент</p>
                  <p className="text-sm font-black text-slate-900 mt-0.5">{selClient.name}</p>
                  <p className="text-xs text-slate-600">{selClient.phone}</p>
                </div>
              ) : null}

              <Field label="Адрес объекта">
                <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} placeholder="Адрес монтажа (можно уточнить)" />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Оборудование (кондиционеры) — можно несколько">
                  <div className="space-y-2">
                    {eqLines.map((ln, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2">
                        <select
                          value={ln.id}
                          onChange={(e) => setEqLines((p) => p.map((x, i) => (i === idx ? { ...x, id: e.target.value } : x)))}
                          className={`col-span-12 md:col-span-9 ${inputCls}`}
                        >
                          <option value="">
                            {warehouseEq.length
                              ? "— выбрать оборудование —"
                              : (catalogLoading ? "— загрузка каталога… —" : (catalogEq.length ? "— выбрать из каталога —" : "— нет оборудования —"))}
                          </option>
                          {warehouseEq.length > 0 ? (
                            warehouseEq.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} (stock: {i.stock})
                              </option>
                            ))
                          ) : (
                            catalogEq.map((m) => (
                              <option key={m.id} value={`cat:${m.id}`}>
                                {(m.brand || "").trim()} {(m.model || "").trim()} {m.type ? `· ${m.type}` : ""}{typeof m.price === "number" ? ` · ${m.price}` : ""}
                              </option>
                            ))
                          )}
                        </select>
                        <input
                          type="number"
                          min={1}
                          value={ln.qty}
                          onChange={(e) => setEqLines((p) => p.map((x, i) => (i === idx ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))}
                          className={`col-span-6 md:col-span-2 ${inputCls}`}
                        />
                        <button
                          type="button"
                          onClick={() => setEqLines((p) => p.filter((_, i) => i !== idx))}
                          className="col-span-6 md:col-span-1 px-3 py-2 rounded-xl border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 text-xs font-bold"
                          title="Удалить строку"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setEqLines((p) => [...p, { id: "", qty: 1 }])}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      + Добавить оборудование
                    </button>
                    {warehouseEq.length === 0 ? (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        В “Склад” пока не подтянулось оборудование с типом <b>equipment</b>. Поэтому показываю <b>каталог оборудования</b>. При выборе модели,
                        если она ещё не связана со складом — система автоматически создаст складскую позицию “Оборудование” (остаток 0) и привяжет ордер к ней.
                      </div>
                    ) : null}
                  </div>
                </Field>
                <Field label="Длина трассы (м)">
                  <input type="number" min={1} value={traceLen} onChange={(e) => setTraceLen(Number(e.target.value))} className={inputCls} />
                </Field>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 sm:px-5 py-4 border-t border-slate-100 bg-white">
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50">
              Отмена
            </button>
            {step === "client" ? (
              <button
                type="button"
                disabled={!canNext}
                onClick={() => setStep("order")}
                className={`px-4 py-2 rounded-xl font-semibold text-white ${canNext ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300 cursor-not-allowed"}`}
              >
                Дальше →
              </button>
            ) : (
              <button
                disabled={!canCreate || Boolean(creating)}
                onClick={async () => {
                  // Resolve selected equipment lines:
                  // - warehouse id: keep
                  // - cat:<id>: use linked warehouseItemId or create a warehouse equipment item on the fly
                  const resolveEquipmentWarehouseId = async (rawId: string): Promise<{ warehouseId: string; fallback?: { name: string; unit: string; price: number } } | null> => {
                    const v = String(rawId || "");
                    if (!v) return null;
                    if (!v.startsWith("cat:")) return { warehouseId: v };
                    const catId = v.slice(4);
                    const model = catalogEq.find((x) => String(x.id) === catId) ?? null;
                    if (!model) return null;
                    const linked = (model.warehouseItemId ?? "").trim();
                    if (linked) {
                      return {
                        warehouseId: linked,
                        fallback: {
                          name: `${(model.brand ?? "").trim()} ${(model.model ?? "").trim()}`.trim() || linked,
                          unit: "шт",
                          price: Number(model.price ?? 0),
                        },
                      };
                    }

                    // Create a warehouse item for this equipment model (stock=0).
                    const name = `${(model.brand ?? "").trim()} ${(model.model ?? "").trim()}`.trim() || `Оборудование ${catId}`;
                    const res = await fetch(`${API}/warehouse`, {
                      method: "POST",
                      headers: JH,
                      body: JSON.stringify({
                        name,
                        category: "Оборудование",
                        unit: "шт",
                        stock: 0,
                        price: Number(model.price ?? 0),
                        itemType: "equipment",
                        imageUrl: model.imageUrl ?? null,
                        // helps order_core.tsx infer BOM via equipmentId
                        acSpecs: { equipmentId: catId, equipmentType: model.type ?? "any" },
                      }),
                    });
                    const d = await res.json().catch(() => ({}));
                    if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
                    const created: WarehouseItem | undefined = d.item;
                    const wid = String(created?.id ?? "");
                    if (!wid) throw new Error("Не удалось создать складскую позицию для оборудования");
                    return { warehouseId: wid, fallback: { name, unit: "шт", price: Number(model.price ?? 0) } };
                  };

                  let resolved: Array<{ rawId: string; qty: number; warehouseId: string; fallback?: { name: string; unit: string; price: number } }> = [];
                  try {
                    const parts = await Promise.all(
                      eqLines
                        .filter((x) => x.id)
                        .map(async (x) => {
                          const r = await resolveEquipmentWarehouseId(x.id);
                          if (!r) return null;
                          return { rawId: x.id, qty: Number(x.qty) || 1, warehouseId: r.warehouseId, fallback: r.fallback };
                        }),
                    );
                    resolved = parts.filter(Boolean) as any;
                  } catch (e: any) {
                    alert(e?.message || "Не удалось подготовить оборудование");
                    return;
                  }

                  onCreate({
                    client_id: selClient?.id,
                    client_name: selClient?.name ?? "",
                    client_phone: selClient?.phone ?? "",
                    object_address: address.trim(),
                    client_legal_name: selClient?.legal_name ? String(selClient.legal_name) : undefined,
                    client_tax_id: selClient?.tax_id ? String(selClient.tax_id) : undefined,
                    client_email: selClient?.email ? String(selClient.email) : undefined,
                    client_doc_basis: selClient?.doc_basis ? String(selClient.doc_basis) : undefined,
                    equipment_warehouse_id: resolved.find((x) => x.warehouseId)?.warehouseId || undefined,
                    trace_length_m: traceLen,
                    offer: (() => {
                      const lines = resolved
                        .filter((x) => x.warehouseId)
                        .map((x) => {
                          const it = eqMap[x.warehouseId];
                          const fb = x.fallback;
                          return {
                            line_type: "equipment",
                            warehouse_item_id: x.warehouseId,
                            name: it?.name ?? fb?.name ?? x.warehouseId,
                            qty: Number(x.qty) || 1,
                            unit: it?.unit ?? fb?.unit ?? "шт",
                            price: it?.price ?? fb?.price ?? 0,
                          };
                        });
                      if (!lines.length) return undefined;
                      return { version: 1, status: "draft", currency: "UAH", lines };
                    })(),
                  });
                }}
                className={`px-4 py-2 rounded-xl font-semibold text-white ${canCreate && !creating ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300 cursor-not-allowed"}`}
              >
                {creating ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    Создание…
                  </span>
                ) : (
                  "Создать"
                )}
              </button>
            )}
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            После создания: добавим КП и кнопку “Подтвердить ордер” для формирования обеспечения (склад/поставщики).
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

type OrderStepKey = "qualification" | "survey" | "offer" | "supply" | "schedule" | "execute" | "close";

const STEP_CFG: Array<{ key: OrderStepKey; label: string; icon: React.ReactNode }> = [
  { key: "qualification", label: "Квалификация", icon: <ClipboardList size={14} /> },
  { key: "survey", label: "Замер", icon: <CalendarDays size={14} /> },
  { key: "offer", label: "КП", icon: <CheckCircle2 size={14} /> },
  { key: "supply", label: "Обеспечение", icon: <Package size={14} /> },
  { key: "schedule", label: "Планирование", icon: <CalendarDays size={14} /> },
  { key: "execute", label: "Исполнение", icon: <Truck size={14} /> },
  { key: "close", label: "Закрытие", icon: <CheckCircle2 size={14} /> },
];

function stepForStatus(s: OrderStatus): OrderStepKey {
  if (s === "new" || s === "qualification") return "qualification";
  if (s === "survey_scheduled" || s === "survey_done") return "survey";
  if (s === "offer_prepared" || s === "offer_sent" || s === "offer_approved") return "offer";
  if (s === "awaiting_supply") return "supply";
  if (s === "ready_to_schedule" || s === "scheduled") return "schedule";
  if (s === "in_progress") return "execute";
  if (s === "completed") return "close";
  return "close";
}

type StepState = { done: boolean; blockedReason?: string };

function stepStatesForOrder(order: Order, materials: MaterialLine[], supplierRequests: SupplierRequest[]): Record<OrderStepKey, StepState> {
  const hasClient = Boolean(order.client_name?.trim() && order.client_phone?.trim() && order.object_address?.trim());
  const surveyHasAssignee = Boolean(order.survey?.assigned_installer_id && order.survey?.scheduled_at);
  const surveyDone = order.survey?.status === "done" || Boolean(order.survey?.performed_at);
  const offerHasLines = Boolean(order.offer && (order.offer.lines?.length ?? 0) > 0);
  const offerApproved = order.offer?.status === "approved" || order.status === "offer_approved" || order.status === "awaiting_supply" || order.status === "ready_to_schedule" || order.status === "scheduled" || order.status === "in_progress" || order.status === "completed" || order.status === "closed";
  const materialsBuilt = (materials?.length ?? 0) > 0;
  const hasDeficit = materials.some((m) => (m.to_purchase_qty ?? 0) > 0);
  const supplierReqsCreated = (supplierRequests?.length ?? 0) > 0;

  const execHasAssignee = Boolean(order.execution?.assigned_installer_id && order.execution?.scheduled_at);
  const checklistReady = Boolean(order.execution?.checklist?.ready_confirmed);
  const departed = order.execution?.prep_status === "departed";
  const started = order.execution?.status === "in_progress" || Boolean(order.execution?.started_at);
  const executionDone = order.execution?.status === "done" || Boolean(order.execution?.completed_at) || order.status === "completed" || order.status === "closed";

  const closeHasPhotos = (order.execution?.photos?.length ?? 0) > 0;
  const closeHasAct = Boolean(order.execution?.signed_act_url);
  const closeHasClientSign = Boolean(order.execution?.client_signed);

  const current = stepForStatus(order.status);
  const currentIdx = STEP_CFG.findIndex((s) => s.key === current);
  const idxOf = (k: OrderStepKey) => STEP_CFG.findIndex((s) => s.key === k);
  const isPast = (k: OrderStepKey) => idxOf(k) < currentIdx;

  const qualification: StepState = {
    done: isPast("qualification") || (order.status !== "new" && hasClient),
    blockedReason: !hasClient ? "Заполните клиента/телефон/адрес объекта" : undefined,
  };

  const survey: StepState = {
    done: isPast("survey") || surveyDone,
    blockedReason: !hasClient ? "Сначала заполните клиента/адрес" : (!surveyHasAssignee ? "Назначьте замер: монтажник и дата" : undefined),
  };

  const offer: StepState = {
    done: isPast("offer") || offerApproved,
    blockedReason: !offerHasLines ? "Сначала создайте КП и добавьте строки" : undefined,
  };

  const supply: StepState = {
    done: isPast("supply") || (materialsBuilt && (!hasDeficit || supplierReqsCreated)),
    blockedReason: !offerApproved ? "Сначала утвердите КП" : (!materialsBuilt ? "Сначала подтвердите ордер (обеспечение), чтобы сформировать материалы" : undefined),
  };

  const schedule: StepState = {
    done: isPast("schedule") || departed || (execHasAssignee && checklistReady && !hasDeficit),
    blockedReason: !materialsBuilt ? "Сначала сформируйте материалы (шаг «Обеспечение»)" : (hasDeficit ? "Есть дефициты: дождитесь поставки/приёмки или закройте дефицит" : (!execHasAssignee ? "Назначьте монтажника и дату" : (!checklistReady ? "Соберите чек‑лист выезда: материалы/инструменты" : undefined))),
  };

  const execute: StepState = {
    done: isPast("execute") || executionDone,
    blockedReason: !execHasAssignee ? "Сначала запланируйте монтаж (монтажник + дата)" : undefined,
  };

  const close: StepState = {
    done: isPast("close") || (executionDone && closeHasPhotos && closeHasAct),
    blockedReason: !executionDone ? "Сначала завершите работы" : (!closeHasPhotos ? "Загрузите фото выполненных работ" : (!closeHasAct ? "Загрузите подписанный акт" : (!closeHasClientSign ? "Отметьте подпись клиента (в исполнении)" : undefined))),
  };

  return { qualification, survey, offer, supply, schedule, execute, close };
}

function OrderStepper({
  status,
  activeKey,
  states,
  onStepClick,
}: {
  status: OrderStatus;
  activeKey?: OrderStepKey;
  states?: Partial<Record<OrderStepKey, StepState>>;
  onStepClick?: (key: OrderStepKey) => void;
}) {
  const current = stepForStatus(status);
  const idx = STEP_CFG.findIndex((s) => s.key === current);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-3 py-2 overflow-x-auto">
      <div className="min-w-max flex items-center gap-2">
        {STEP_CFG.map((s, i) => {
          const isCurrent = s.key === current;
          const isActive = activeKey ? s.key === activeKey : isCurrent;
          const isDone = i < idx;
          const st = states?.[s.key];
          const done = Boolean(st?.done) || isDone;
          const blocked = Boolean(st?.blockedReason) && !done;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onStepClick?.(s.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold whitespace-nowrap transition-all ${
                isActive
                  ? "border-indigo-200 bg-indigo-50 text-indigo-900 ring-2 ring-indigo-100"
                  : done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                    : blocked
                      ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span className="opacity-90">{s.icon}</span>
              {s.label}
              {done && <span className="ml-1 text-[10px] font-black">✓</span>}
              {blocked && <span className="ml-1 text-[10px] font-black">!</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ClientSummaryCard({
  order,
  onOpenClients,
  onSyncFromClient,
}: {
  order: Order;
  onOpenClients?: () => void;
  onSyncFromClient?: () => void;
}) {
  const name = order.client_name || "Клиент";
  const phone = order.client_phone || "—";
  const addr = order.object_address || "Адрес: уточнить";
  const legal = order.client_legal_name || "";
  const tax = order.client_tax_id || "";
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400 font-semibold">Клиент (только просмотр)</p>
          <p className="text-sm font-extrabold text-slate-800 truncate mt-0.5">{name}</p>
          <p className="text-xs text-slate-600 truncate mt-0.5">{phone} · {addr}</p>
          {(legal || tax) && (
            <p className="text-[11px] text-slate-500 truncate mt-1">
              {legal ? legal : "—"}{tax ? ` · ИНН: ${tax}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {onOpenClients && (
            <button
              type="button"
              onClick={onOpenClients}
              className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 text-slate-700 bg-white hover:bg-slate-50"
            >
              Открыть клиента
            </button>
          )}
          {onSyncFromClient && (
            <button
              type="button"
              onClick={onSyncFromClient}
              className="px-3 py-2 rounded-xl text-xs font-semibold border border-indigo-200 text-indigo-800 bg-indigo-50 hover:bg-indigo-100"
              title="Подтянуть актуальные данные из карточки клиента"
            >
              Синхронизировать
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        Редактирование клиента делается в разделе «Клиенты», здесь данные используются для КП/акта.
      </p>
    </div>
  );
}

const inputCls =
  "w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300";

function ClientDetailsPanel({
  order,
  onSave,
}: {
  order: Order;
  onSave: (patch: Partial<Order>) => void;
}) {
  const [name, setName] = useState(order.client_name ?? "");
  const [phone, setPhone] = useState(order.client_phone ?? "");
  const [address, setAddress] = useState(order.object_address ?? "");
  const [legalName, setLegalName] = useState(order.client_legal_name ?? "");
  const [taxId, setTaxId] = useState(order.client_tax_id ?? "");
  const [email, setEmail] = useState(order.client_email ?? "");
  const [basis, setBasis] = useState(order.client_doc_basis ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(order.client_name ?? "");
    setPhone(order.client_phone ?? "");
    setAddress(order.object_address ?? "");
    setLegalName(order.client_legal_name ?? "");
    setTaxId(order.client_tax_id ?? "");
    setEmail(order.client_email ?? "");
    setBasis(order.client_doc_basis ?? "");
  }, [
    order.client_name,
    order.client_phone,
    order.object_address,
    order.client_legal_name,
    order.client_tax_id,
    order.client_email,
    order.client_doc_basis,
  ]);

  const dirty =
    name !== (order.client_name ?? "") ||
    phone !== (order.client_phone ?? "") ||
    address !== (order.object_address ?? "") ||
    legalName !== (order.client_legal_name ?? "") ||
    taxId !== (order.client_tax_id ?? "") ||
    email !== (order.client_email ?? "") ||
    basis !== (order.client_doc_basis ?? "");

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-800">Клиент и реквизиты (внутри ордера)</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Используется при формировании КП и акта.</p>
        </div>
        <button
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({
                client_name: name.trim(),
                client_phone: phone.trim(),
                object_address: address.trim(),
                client_legal_name: legalName.trim() || undefined,
                client_tax_id: taxId.trim() || undefined,
                client_email: email.trim() || undefined,
                client_doc_basis: basis.trim() || undefined,
              } as any);
            } finally {
              setSaving(false);
            }
          }}
          className={`px-3 py-2 rounded-xl text-xs font-semibold ${
            dirty && !saving ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500 cursor-not-allowed"
          }`}
        >
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Сохранение…
            </span>
          ) : (
            "Сохранить"
          )}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Клиент">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Телефон">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Юр.лицо / ФИО (для документов)">
          <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={inputCls} placeholder="ООО “...” / ФИО" />
        </Field>
        <Field label="ИНН / ЕГРПОУ">
          <input value={taxId} onChange={(e) => setTaxId(e.target.value)} className={inputCls} placeholder="—" />
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Email">
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="—" />
        </Field>
        <Field label="Основание (договор/счет)">
          <input value={basis} onChange={(e) => setBasis(e.target.value)} className={inputCls} placeholder="—" />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Адрес объекта">
          <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} placeholder="—" />
        </Field>
      </div>
    </div>
  );
}

function OfferEditor({
  offer,
  warehouseMap,
  onCreateDraft,
  onSaveLines,
}: {
  offer: Order["offer"] | undefined;
  warehouseMap: Record<string, WarehouseItem>;
  onCreateDraft: () => void;
  onSaveLines: (lines: NonNullable<Order["offer"]>["lines"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftLines, setDraftLines] = useState<NonNullable<Order["offer"]>["lines"]>(offer?.lines ?? []);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    setDraftLines(offer?.lines ?? []);
  }, [offer?.lines]);

  const total = useMemo(() => {
    return draftLines.reduce((s, l) => s + (l.price ?? 0) * (l.qty ?? 0), 0);
  }, [draftLines]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800">КП (внутри Order)</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {offer ? `v${offer.version} · ${offer.status}` : "КП отсутствует"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!offer && (
            <button
              onClick={onCreateDraft}
              className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
            >
              Создать черновик
            </button>
          )}
          {offer && (
            <>
              <button
                onClick={() => setEditing((v) => !v)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50"
              >
                {editing ? "Готово" : "Редактировать"}
              </button>
              {editing && (
                <>
                  <button
                    onClick={() => setAddOpen(true)}
                    className="px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                  >
                    + Строка
                  </button>
                  <button
                    onClick={() => onSaveLines(draftLines)}
                    className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
                  >
                    Сохранить КП
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {(!offer || draftLines.length === 0) ? (
          <div className="p-4 text-sm text-slate-400">
            Добавьте строки КП (оборудование, материалы, услуги). После утверждения КП можно подтверждать ордер для обеспечения.
          </div>
        ) : (
          draftLines.map((l, idx) => (
            <div key={`${idx}-${l.name}`} className="px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{l.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {l.line_type}{l.warehouse_item_id ? ` · ${l.warehouse_item_id}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {editing ? (
                  <>
                    <input
                      type="number"
                      min={0}
                      value={l.qty}
                      onChange={(e) => {
                        const qty = Number(e.target.value);
                        setDraftLines((prev) => prev.map((x, i) => (i === idx ? { ...x, qty } : x)));
                      }}
                      className="w-20 bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-sm"
                    />
                    <input
                      type="number"
                      min={0}
                      value={l.price ?? 0}
                      onChange={(e) => {
                        const price = Number(e.target.value);
                        setDraftLines((prev) => prev.map((x, i) => (i === idx ? { ...x, price } : x)));
                      }}
                      className="w-28 bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-sm"
                    />
                    <button
                      onClick={() => setDraftLines((prev) => prev.filter((_, i) => i !== idx))}
                      className="px-2.5 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
                      title="Удалить строку"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <div className="text-right">
                    <p className="text-sm font-black text-slate-800">
                      {l.qty} {l.unit}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {(l.price ?? 0) * (l.qty ?? 0)} {offer.currency ?? "UAH"}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {offer && (
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-sm">
          <span className="text-slate-400">Итого</span>
          <span className="font-black text-slate-800">
            {total.toLocaleString("ru-RU")} {offer.currency ?? "UAH"}
          </span>
        </div>
      )}

      {addOpen && offer && (
        <AddOfferLineModal
          warehouseMap={warehouseMap}
          onClose={() => setAddOpen(false)}
          onAdd={(line) => {
            setDraftLines((prev) => [...prev, line]);
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AddOfferLineModal({
  warehouseMap,
  onClose,
  onAdd,
}: {
  warehouseMap: Record<string, WarehouseItem>;
  onClose: () => void;
  onAdd: (line: NonNullable<Order["offer"]>["lines"][number]) => void;
}) {
  const [mode, setMode] = useState<"warehouse" | "supplier" | "service">("warehouse");
  const [warehouseId, setWarehouseId] = useState("");
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [unit, setUnit] = useState("шт");

  const items = useMemo(() => Object.values(warehouseMap).sort((a, b) => a.name.localeCompare(b.name, "ru")), [warehouseMap]);

  useEffect(() => {
    if (!warehouseId) return;
    const it = warehouseMap[warehouseId];
    if (!it) return;
    setName(it.name);
    setUnit(it.unit);
    setPrice(it.price ?? 0);
  }, [warehouseId, warehouseMap]);

  const canAdd = (mode === "warehouse" || mode === "supplier") ? !!warehouseId : name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={onClose}>
      <div
        className="w-full sm:max-w-xl h-[92vh] sm:h-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-xl border border-slate-200 flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <p className="text-base font-black text-slate-800">Добавить строку КП</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="p-4 sm:p-5 space-y-4 overflow-auto">
          <div className="flex gap-2">
            <button
              onClick={() => setMode("warehouse")}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border ${mode === "warehouse" ? "bg-blue-50 border-blue-200 text-blue-700" : "border-slate-200 text-slate-600"}`}
            >
              Со склада
            </button>
            <button
              onClick={() => setMode("supplier")}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border ${mode === "supplier" ? "bg-blue-50 border-blue-200 text-blue-700" : "border-slate-200 text-slate-600"}`}
              title="Позиция есть в каталоге/складе, но будем покупать у поставщика"
            >
              У поставщика
            </button>
            <button
              onClick={() => setMode("service")}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border ${mode === "service" ? "bg-blue-50 border-blue-200 text-blue-700" : "border-slate-200 text-slate-600"}`}
            >
              Услуга
            </button>
          </div>

          {mode === "warehouse" || mode === "supplier" ? (
            <Field label="Позиция склада">
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={inputCls}>
                <option value="">— выберите позицию —</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Название услуги">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Монтаж / замер / доставка…" />
            </Field>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Кол-во">
              <input type="number" min={0} value={qty} onChange={(e) => setQty(Number(e.target.value))} className={inputCls} />
            </Field>
            <Field label="Ед.">
              <input value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Цена">
              <input type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} className={inputCls} />
            </Field>
          </div>
        </div>

        <div className="px-4 sm:px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-white">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50">
            Отмена
          </button>
          <button
            disabled={!canAdd}
            onClick={() => {
              if (mode === "warehouse" || mode === "supplier") {
                const it = warehouseMap[warehouseId];
                if (!it) return;
                onAdd({
                  line_type: (it.itemType === "equipment" ? "equipment" : it.itemType === "assembly" ? "assembly" : "consumable") as any,
                  warehouse_item_id: it.id,
                  name: it.name,
                  qty,
                  unit: it.unit,
                  price,
                  ...(mode === "supplier" ? ({ force_supply_source: "supplier" } as any) : {}),
                } as any);
              } else {
                onAdd({ line_type: "service", name: name.trim(), qty, unit, price });
              }
            }}
            className={`px-4 py-2 rounded-xl font-semibold text-white ${canAdd ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300 cursor-not-allowed"}`}
          >
            Добавить
          </button>
        </div>
      </div>
    </div>
  );
}

function SurveyPanel({
  survey,
  installers,
  traceLengthCurrent,
  onSchedule,
  onComplete,
}: {
  survey: Order["survey"] | undefined;
  installers: Array<{ id: string; name: string }>;
  traceLengthCurrent: number;
  onSchedule: (p: { installerId: string; installerName: string; date: string }) => void;
  onComplete: (p: { performedAt: string; trace_length_m?: number; notes?: string; mount_conditions?: string }) => void;
}) {
  const [installerId, setInstallerId] = useState(survey?.assigned_installer_id ?? "");
  const [scheduledAt, setScheduledAt] = useState(survey?.scheduled_at ?? "");
  const [performedAt, setPerformedAt] = useState(survey?.performed_at ?? "");
  const [traceLen, setTraceLen] = useState<number>(survey?.trace_length_m ?? traceLengthCurrent);
  const [notes, setNotes] = useState(survey?.notes ?? "");
  const [conds, setConds] = useState(survey?.mount_conditions ?? "");

  useEffect(() => {
    setInstallerId(survey?.assigned_installer_id ?? "");
    setScheduledAt(survey?.scheduled_at ?? "");
    setPerformedAt(survey?.performed_at ?? "");
    setTraceLen(survey?.trace_length_m ?? traceLengthCurrent);
    setNotes(survey?.notes ?? "");
    setConds(survey?.mount_conditions ?? "");
  }, [survey?.assigned_installer_id, survey?.scheduled_at, survey?.performed_at, survey?.trace_length_m, survey?.notes, survey?.mount_conditions, traceLengthCurrent]);

  const installerName = installers.find((i) => i.id === installerId)?.name ?? "";
  const canSchedule = installerId && scheduledAt;
  const canComplete = (survey?.status === "scheduled" || survey?.status === "done" || !survey?.status) && (performedAt || true);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-800">Замер (часть Order)</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {survey?.status ? `status: ${survey.status}` : "не назначен"}
          </p>
        </div>
      </div>
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Исполнитель (замер)">
          <select value={installerId} onChange={(e) => setInstallerId(e.target.value)} className={inputCls}>
            <option value="">— выбрать —</option>
            {installers.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Дата замера">
          <input type="date" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={inputCls} />
        </Field>
        <div className="flex items-end">
          <button
            disabled={!canSchedule}
            onClick={() => onSchedule({ installerId, installerName, date: scheduledAt })}
            className={`w-full px-4 py-2 rounded-xl font-semibold text-white ${canSchedule ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300 cursor-not-allowed"}`}
          >
            Назначить замер
          </button>
        </div>
      </div>
      <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Факт дата">
          <input type="date" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Трасса (м)">
          <input type="number" min={1} value={traceLen} onChange={(e) => setTraceLen(Number(e.target.value))} className={inputCls} />
        </Field>
        <div className="flex items-end">
          <button
            disabled={!canComplete}
            onClick={() =>
              onComplete({
                performedAt: performedAt || new Date().toISOString().slice(0, 10),
                trace_length_m: traceLen,
                notes: notes.trim(),
                mount_conditions: conds.trim(),
              })
            }
            className={`w-full px-4 py-2 rounded-xl font-semibold text-white ${canComplete ? "bg-slate-900 hover:bg-slate-800" : "bg-slate-300 cursor-not-allowed"}`}
          >
            Завершить замер
          </button>
        </div>
        <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Условия/детали монтажа">
            <textarea value={conds} onChange={(e) => setConds(e.target.value)} className={`${inputCls} min-h-[88px]`} placeholder="Штроба/высота/препятствия/дренаж/электрика…" />
          </Field>
          <Field label="Комментарий замера">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} min-h-[88px]`} placeholder="Что уточнили, что нужно изменить в ордере…" />
          </Field>
        </div>
      </div>
    </div>
  );
}

function ExecutionPlanner({
  execution,
  installers,
  onSchedule,
  onStart,
  onComplete,
  onDownloadAct,
  mode,
}: {
  execution: Order["execution"] | undefined;
  installers: Array<{ id: string; name: string }>;
  onSchedule: (p: { installerId: string; installerName: string; date: string }) => void;
  onStart: () => void;
  onComplete: (p: { completion_notes?: string; client_signed: boolean; client_sign_name?: string }) => void;
  onDownloadAct: () => void;
  mode?: "plan" | "execute";
}) {
  const [installerId, setInstallerId] = useState(execution?.assigned_installer_id ?? "");
  const [date, setDate] = useState(execution?.scheduled_at ?? "");
  const [notes, setNotes] = useState(execution?.completion_notes ?? "");
  const [clientSigned, setClientSigned] = useState(Boolean(execution?.client_signed));
  const [clientName, setClientName] = useState(execution?.client_sign_name ?? "");
  const [photos, setPhotos] = useState<string[]>(execution?.photos ?? []);

  useEffect(() => {
    setInstallerId(execution?.assigned_installer_id ?? "");
    setDate(execution?.scheduled_at ?? "");
    setNotes(execution?.completion_notes ?? "");
    setClientSigned(Boolean(execution?.client_signed));
    setClientName(execution?.client_sign_name ?? "");
    setPhotos(execution?.photos ?? []);
  }, [execution?.assigned_installer_id, execution?.scheduled_at, execution?.completion_notes, execution?.client_signed, execution?.client_sign_name]);

  const installerName = installers.find((i) => i.id === installerId)?.name ?? "";
  const can = installerId && date;

  const showPlan = mode === "plan" || !mode;
  const showExecute = mode === "execute" || !mode;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-800">Исполнение (монтаж)</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {execution?.status ? `status: ${execution.status}` : "Не запланировано"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!clientSigned && (
            <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700">
              Нет отметки подписи клиента
            </span>
          )}
          <button
            onClick={onDownloadAct}
            className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
          >
            Скачать акт
          </button>
        </div>
      </div>
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Монтажник">
          <select value={installerId} onChange={(e) => setInstallerId(e.target.value)} className={inputCls}>
            <option value="">— выбрать —</option>
            {installers.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Дата">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        <div className="flex items-end">
          <button
            disabled={!can}
            onClick={() => onSchedule({ installerId, installerName, date })}
            className={`w-full px-4 py-2 rounded-xl font-semibold text-white ${can ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300 cursor-not-allowed"}`}
          >
            Запланировать
          </button>
        </div>
      </div>

      {showExecute && (
      <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div className="md:col-span-2">
          <Field label="Комментарий по работам (план/факт)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${inputCls} min-h-[72px]`}
              placeholder="Что сделали, нюансы, рекомендации…"
            />
          </Field>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onStart}
            disabled={execution?.status === "in_progress" || execution?.status === "done"}
            className={`flex-1 px-4 py-2 rounded-xl font-semibold text-white ${
              execution?.status === "in_progress" || execution?.status === "done"
                ? "bg-slate-300 cursor-not-allowed"
                : "bg-amber-600 hover:bg-amber-700"
            }`}
          >
            Начать
          </button>
          <button
            onClick={() => onComplete({ completion_notes: notes.trim(), client_signed: clientSigned, client_sign_name: clientName.trim() })}
            disabled={execution?.status !== "in_progress"}
            className={`flex-1 px-4 py-2 rounded-xl font-semibold text-white ${
              execution?.status === "in_progress" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-300 cursor-not-allowed"
            }`}
          >
            Завершить
          </button>
        </div>
      </div>
      )}

      {showExecute && (
      <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-1">
          <Field label="Подпись клиента">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={clientSigned} onChange={(e) => setClientSigned(e.target.checked)} />
              Подписано
            </label>
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="ФИО клиента (для акта)">
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputCls} placeholder="Иванов Иван" />
          </Field>
        </div>
      </div>
      )}

      {/* фото/акт переехали в шаг "Закрытие" */}
    </div>
  );
}

function InstallerChecklistPanel({
  orderNumber,
  equipmentWarehouseId,
  materials,
  warehouseMap,
  supplierRequests,
  execution,
  onSaveChecklist,
}: {
  orderNumber: string;
  equipmentWarehouseId?: string;
  materials: MaterialLine[];
  warehouseMap: Record<string, WarehouseItem>;
  supplierRequests: SupplierRequest[];
  execution?: Order["execution"];
  onSaveChecklist: (next: NonNullable<Order["execution"]>["checklist"], nextPrep: NonNullable<Order["execution"]>["prep_status"]) => void;
}) {
  const equipmentName = equipmentWarehouseId ? (warehouseMap[equipmentWarehouseId]?.name ?? equipmentWarehouseId) : "—";

  const takeFromWarehouse = useMemo(() => {
    return materials
      .filter((m) => (m.reserved_qty ?? 0) > 0)
      .map((m) => ({
        id: m.id,
        itemId: m.item_id,
        name: warehouseMap[m.item_id]?.name ?? m.item_id,
        qty: m.reserved_qty,
      }));
  }, [materials, warehouseMap]);

  const needToBuy = useMemo(() => {
    return materials
      .filter((m) => (m.to_purchase_qty ?? 0) > 0)
      .map((m) => ({
        id: m.id,
        itemId: m.item_id,
        name: warehouseMap[m.item_id]?.name ?? m.item_id,
        qty: m.to_purchase_qty,
        supplier: m.supplier_id ?? "—",
      }));
  }, [materials, warehouseMap]);

  const activeSupplierReqs = useMemo(() => supplierRequests.filter((r) => r.status !== "received" && r.status !== "cancelled"), [supplierRequests]);

  const [check, setCheck] = useState<NonNullable<NonNullable<Order["execution"]>["checklist"]>>(() => execution?.checklist ?? {});
  const [customText, setCustomText] = useState("");

  useEffect(() => {
    setCheck(execution?.checklist ?? {});
  }, [execution?.checklist]);

  const toolsList = useMemo(
    () => [
      "Перфоратор",
      "Вакуумный насос",
      "Манометрический коллектор",
      "Труборез/развальцовка",
      "Ключи/шестигранники",
      "Лестница",
    ],
    [],
  );

  const customPresets = useMemo(
    () => [
      "Согласовать время с клиентом",
      "Подтвердить доступ/пропуск на объект",
      "Проверить наличие всех комплектующих на складе",
      "Забрать лестницу/стремянку",
      "Забрать инструмент (вакуумный насос/коллектор)",
      "Проверить трассу/штробу/условия монтажа",
      "Предупредить клиента о пыли/шуме и времени работ",
      "Проверить питание/автомат/кабель",
      "Подготовить место для внешнего блока (крепёж/кронштейн)",
    ],
    [],
  );

  const materialsChecked = check.materials ?? {};
  const toolsChecked = check.tools ?? {};
  const equipmentChecked = Boolean(check.equipment);

  const totalToTake = takeFromWarehouse.length + 1; // + equipment line
  const takenCount =
    (equipmentChecked ? 1 : 0) +
    takeFromWarehouse.reduce((s, m) => s + (materialsChecked[m.id] ? 1 : 0), 0);

  const toolsTotal = toolsList.length;
  const toolsCount = toolsList.reduce((s, t) => s + (toolsChecked[t] ? 1 : 0), 0);

  const allPacked = takenCount === totalToTake && toolsCount === toolsTotal && !needToBuy.length;
  const prepStatus: NonNullable<Order["execution"]>["prep_status"] =
    allPacked ? "ready" : (takenCount > 0 || toolsCount > 0) ? "packing" : "not_started";

  const save = () => {
    const next: NonNullable<Order["execution"]>["checklist"] = {
      ...check,
      materials: materialsChecked,
      tools: toolsChecked,
      equipment: equipmentChecked,
      ready_confirmed: allPacked,
      updated_at: new Date().toISOString(),
    };
    onSaveChecklist(next, prepStatus);
  };

  const canDepart = allPacked && prepStatus === "ready";

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-800">Чеклист выезда</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Order {orderNumber}</p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className={`px-2 py-1 rounded-full font-bold ${needToBuy.length ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
            Дефицит: {needToBuy.length}
          </span>
          <span className="px-2 py-1 rounded-full font-bold bg-slate-100 text-slate-700">
            Резерв: {takeFromWarehouse.length}
          </span>
          <span className={`px-2 py-1 rounded-full font-bold ${prepStatus === "ready" ? "bg-emerald-100 text-emerald-700" : prepStatus === "packing" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}>
            Сбор: {prepStatus === "ready" ? "готов" : prepStatus === "packing" ? "собирают" : "не начат"}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500">Оборудование</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-slate-800 truncate">{equipmentName}</p>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={equipmentChecked} onChange={(e) => setCheck((p) => ({ ...p, equipment: e.target.checked }))} />
              Взято
            </label>
          </div>
        </div>

        <div className="border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500">Взять со склада (резерв)</p>
          {takeFromWarehouse.length === 0 ? (
            <p className="text-sm text-slate-400 mt-1">Нет позиций в резерве.</p>
          ) : (
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              {takeFromWarehouse.map((x) => (
                <div key={x.id} className="border border-slate-200 rounded-xl px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">{x.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">резерв: {x.qty}</p>
                    </div>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(materialsChecked[x.id])}
                        onChange={(e) =>
                          setCheck((p) => ({ ...p, materials: { ...(p.materials ?? {}), [x.id]: e.target.checked } }))
                        }
                      />
                      Взято
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500">Инструменты (чек)</p>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
            {toolsList.map((t) => (
              <label key={t} className="border border-slate-200 rounded-xl px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-sm text-slate-800 font-semibold truncate">{t}</span>
                <input
                  type="checkbox"
                  checked={Boolean(toolsChecked[t])}
                  onChange={(e) => setCheck((p) => ({ ...p, tools: { ...(p.tools ?? {}), [t]: e.target.checked } }))}
                />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">Отметьте инструменты перед выездом. Это видно администратору.</p>
        </div>

        <div className="border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500">Доп. действия (свой чек‑лист)</p>
          <div className="mt-2 flex flex-col sm:flex-row gap-2">
            <input
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              className={inputCls}
              placeholder="Например: забрать лестницу у Петра / согласовать пропуск / предупредить клиента…"
            />
            <button
              type="button"
              onClick={() => {
                const text = customText.trim();
                if (!text) return;
                const item = { id: `c_${Date.now()}_${Math.random().toString(16).slice(2)}`, text, done: false };
                setCheck((p) => ({ ...p, custom: [...(p.custom ?? []), item] }));
                setCustomText("");
              }}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
            >
              Добавить
            </button>
          </div>
          <div className="mt-3">
            <p className="text-[11px] text-slate-400 font-semibold mb-2">Быстро добавить:</p>
            <div className="flex flex-wrap gap-2">
              {customPresets.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setCheck((p) => {
                      const exists = (p.custom ?? []).some((x) => (x.text || "").toLowerCase() === t.toLowerCase());
                      if (exists) return p;
                      const item = { id: `c_${Date.now()}_${Math.random().toString(16).slice(2)}`, text: t, done: false };
                      return { ...p, custom: [...(p.custom ?? []), item] };
                    });
                  }}
                  className="px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  + {t}
                </button>
              ))}
            </div>
          </div>
          {(check.custom ?? []).length === 0 ? (
            <p className="text-[11px] text-slate-400 mt-2">Добавьте свои пункты — они сохранятся в ордере и будут видны всем.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {(check.custom ?? []).map((it) => (
                <div key={it.id} className="flex items-start justify-between gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-white">
                  <label className="flex items-start gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={Boolean(it.done)}
                      onChange={(e) =>
                        setCheck((p) => ({
                          ...p,
                          custom: (p.custom ?? []).map((x) => (x.id === it.id ? { ...x, done: e.target.checked } : x)),
                        }))
                      }
                      className="mt-1"
                    />
                    <span className={`text-sm font-semibold break-words ${it.done ? "text-slate-400 line-through" : "text-slate-800"}`}>
                      {it.text}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setCheck((p) => ({ ...p, custom: (p.custom ?? []).filter((x) => x.id !== it.id) }))}
                    className="px-2 py-1 rounded-lg border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50"
                    title="Удалить пункт"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500">Нужно докупить (дефицит)</p>
          {needToBuy.length === 0 ? (
            <p className="text-sm text-slate-400 mt-1">Дефицитов нет. Можно планировать выезд.</p>
          ) : (
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              {needToBuy.map((x) => (
                <div key={x.id} className="border border-amber-200 bg-amber-50 rounded-xl px-3 py-2">
                  <p className="text-xs font-semibold text-slate-800 truncate">{x.name}</p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    дефицит: {x.qty} · {x.supplier}
                  </p>
                </div>
              ))}
            </div>
          )}
          {activeSupplierReqs.length > 0 && (
            <p className="text-[11px] text-slate-400 mt-2">
              Активных заявок поставщикам: {activeSupplierReqs.length}. После приемки дефициты должны уйти в 0.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-slate-500">
            Собрано (материалы+оборудование): {takenCount}/{totalToTake} · Инструменты: {toolsCount}/{toolsTotal}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setCheck((p) => ({
                  ...p,
                  equipment: true,
                  materials: takeFromWarehouse.reduce((acc, m) => ({ ...acc, [m.id]: true }), p.materials ?? {}),
                  tools: toolsList.reduce((acc, t) => ({ ...acc, [t]: true }), p.tools ?? {}),
                }));
              }}
              className="px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50"
            >
              Отметить всё
            </button>
            <button
              onClick={save}
              className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
            >
              Сохранить чеклист
            </button>
            <button
              disabled={!canDepart}
              onClick={() => {
                const next = {
                  ...check,
                  materials: materialsChecked,
                  tools: toolsChecked,
                  equipment: equipmentChecked,
                  ready_confirmed: true,
                  updated_at: new Date().toISOString(),
                };
                onSaveChecklist(next, "departed");
              }}
              className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                canDepart ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-200 text-slate-500 cursor-not-allowed"
              }`}
              title={canDepart ? "Зафиксировать выезд на монтаж" : "Сначала соберите материалы/инструменты и уберите дефициты"}
            >
              Готов к выезду
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CloseoutPanel({
  execution,
  onSavePhotos,
  onSaveSignedAct,
}: {
  execution?: Order["execution"];
  onSavePhotos: (photos: string[]) => void;
  onSaveSignedAct: (url: string | undefined) => void;
}) {
  const [photos, setPhotos] = useState<string[]>(execution?.photos ?? []);
  const [signedAct, setSignedAct] = useState<string | undefined>(execution?.signed_act_url);

  useEffect(() => {
    setPhotos(execution?.photos ?? []);
    setSignedAct(execution?.signed_act_url);
  }, [execution?.photos, execution?.signed_act_url]);

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-800">Закрытие ордера</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Фото выполненных работ и подписанные документы.</p>
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3">
            <p className="text-xs font-semibold text-slate-500 mb-2">Подписанный акт (фото/скан)</p>
            <ImageUpload
              value={signedAct}
              onChange={(v) => setSignedAct(v)}
              folder="misc"
              aspect="square"
              label="Акт"
            />
            <button
              onClick={() => onSaveSignedAct(signedAct)}
              className="mt-2 w-full px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
            >
              Сохранить акт
            </button>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-semibold text-slate-500">Фото выполненных работ</p>
              <button
                onClick={() => setPhotos((p) => [...p, ""])}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-white"
              >
                + Фото
              </button>
            </div>
            {photos.length === 0 ? (
              <p className="text-[11px] text-slate-400">Добавьте фото (до/после) для контроля качества.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {photos.map((url, idx) => (
                  <div key={idx} className="relative">
                    <ImageUpload
                      value={url || undefined}
                      onChange={(next) => setPhotos((p) => p.map((x, i) => (i === idx ? next : x)))}
                      folder="misc"
                      aspect="square"
                      label={`Фото ${idx + 1}`}
                    />
                    <button
                      onClick={() => setPhotos((p) => p.filter((_, i) => i !== idx))}
                      className="absolute top-2 right-2 bg-white/90 hover:bg-red-600 hover:text-white text-slate-700 text-xs font-bold px-2 py-1 rounded-lg border border-slate-200"
                      title="Удалить слот"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => onSavePhotos(photos.filter(Boolean))}
              className="mt-2 w-full px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
            >
              Сохранить фото
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MaterialsActualPanel({
  orderStatus,
  materials,
  warehouseMap,
  onSave,
}: {
  orderStatus: OrderStatus;
  materials: MaterialLine[];
  warehouseMap: Record<string, WarehouseItem>;
  onSave: (lines: Array<{ materialId: string; used_qty: number; writeoff_qty: number }>) => void;
}) {
  const [values, setValues] = useState<Record<string, { used: number; writeoff: number }>>({});
  const [onlyWorkset, setOnlyWorkset] = useState(true);

  useEffect(() => {
    const next: Record<string, { used: number; writeoff: number }> = {};
    for (const m of materials) {
      next[m.id] = { used: Number(m.used_qty ?? 0), writeoff: Number(m.writeoff_qty ?? 0) };
    }
    setValues(next);
  }, [materials]);

  const canEdit = orderStatus === "in_progress" || orderStatus === "completed";
  const hasLines = materials.length > 0;
  const visible = useMemo(() => {
    if (!onlyWorkset) return materials;
    return materials.filter((m) => (m.required_qty ?? 0) > 0 || (m.reserved_qty ?? 0) > 0 || (m.to_purchase_qty ?? 0) > 0);
  }, [materials, onlyWorkset]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-800">Материалы (факт)</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Ускоренный режим для монтажника</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600 flex items-center gap-2">
            <input type="checkbox" checked={onlyWorkset} onChange={(e) => setOnlyWorkset(e.target.checked)} />
            Только рабочий набор
          </label>
          <span className="text-xs text-slate-400">{visible.length}</span>
        </div>
      </div>
      {!hasLines ? (
        <div className="p-4 text-sm text-slate-400">Нет строк материалов. Сначала подтвердите ордер (обеспечение).</div>
      ) : (
        <div className="divide-y divide-slate-100">
          <div className="px-4 py-3 flex flex-wrap gap-2 items-center">
            <button
              disabled={!canEdit}
              onClick={() =>
                setValues((prev) => {
                  const next = { ...prev };
                  for (const m of visible) next[m.id] = { used: m.required_qty ?? 0, writeoff: next[m.id]?.writeoff ?? 0 };
                  return next;
                })
              }
              className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                canEdit ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500 cursor-not-allowed"
              }`}
            >
              Использовано = план
            </button>
            <button
              disabled={!canEdit}
              onClick={() =>
                setValues((prev) => {
                  const next = { ...prev };
                  for (const m of visible) next[m.id] = { used: m.reserved_qty ?? 0, writeoff: next[m.id]?.writeoff ?? 0 };
                  return next;
                })
              }
              className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                canEdit ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500 cursor-not-allowed"
              }`}
            >
              Использовано = резерв
            </button>
            <button
              disabled={!canEdit}
              onClick={() =>
                setValues((prev) => {
                  const next = { ...prev };
                  for (const m of visible) next[m.id] = { used: next[m.id]?.used ?? 0, writeoff: 0 };
                  return next;
                })
              }
              className={`px-3 py-2 rounded-xl border text-xs font-semibold ${
                canEdit ? "border-slate-200 text-slate-700 hover:bg-slate-50" : "border-slate-200 text-slate-400 cursor-not-allowed bg-slate-50"
              }`}
            >
              Списано = 0
            </button>
          </div>

          {visible.map((m) => (
            <div key={m.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{warehouseMap[m.item_id]?.name ?? m.item_id}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    план: {m.required_qty} · резерв: {m.reserved_qty} · к закупке: {m.to_purchase_qty}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 w-[240px] flex-shrink-0">
                  <div>
                    <p className="text-[11px] text-slate-400 font-semibold mb-1">Использовано</p>
                    <input
                      type="number"
                      min={0}
                      disabled={!canEdit}
                      value={values[m.id]?.used ?? 0}
                      onChange={(e) =>
                        setValues((p) => ({
                          ...p,
                          [m.id]: { used: Math.max(0, Number(e.target.value)), writeoff: p[m.id]?.writeoff ?? 0 },
                        }))
                      }
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400 font-semibold mb-1">Списано</p>
                    <input
                      type="number"
                      min={0}
                      disabled={!canEdit}
                      value={values[m.id]?.writeoff ?? 0}
                      onChange={(e) =>
                        setValues((p) => ({
                          ...p,
                          [m.id]: { used: p[m.id]?.used ?? 0, writeoff: Math.max(0, Number(e.target.value)) },
                        }))
                      }
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  disabled={!canEdit}
                  onClick={() => setValues((p) => ({ ...p, [m.id]: { used: m.required_qty ?? 0, writeoff: p[m.id]?.writeoff ?? 0 } }))}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${
                    canEdit ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-slate-50 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  = план
                </button>
                <button
                  disabled={!canEdit}
                  onClick={() => setValues((p) => ({ ...p, [m.id]: { used: m.reserved_qty ?? 0, writeoff: p[m.id]?.writeoff ?? 0 } }))}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${
                    canEdit ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-slate-50 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  = резерв
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-end">
        <button
          disabled={!canEdit || !hasLines}
          onClick={() =>
            onSave(
              visible.map((m) => ({
                materialId: m.id,
                used_qty: values[m.id]?.used ?? 0,
                writeoff_qty: values[m.id]?.writeoff ?? 0,
              })),
            )
          }
          className={`px-4 py-2 rounded-xl font-semibold text-white ${
            canEdit && hasLines ? "bg-slate-900 hover:bg-slate-800" : "bg-slate-300 cursor-not-allowed"
          }`}
        >
          Сохранить факт материалов
        </button>
      </div>
    </div>
  );
}

function TimelinePanel({ timeline }: { timeline: TimelineEvent[] }) {
  const items = useMemo(() => {
    return (timeline ?? []).slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [timeline]);

  const label = (t: string) => {
    const m: Record<string, string> = {
      "order.created": "Создан ордер",
      "order.updated": "Изменен ордер",
      "offer.created": "Создано КП",
      "offer.sent": "КП отправлено",
      "offer.approved": "КП утверждено",
      "order.confirmed_for_execution": "Ордер подтвержден (обеспечение)",
      "supplier_request.sent": "Заявка поставщику отправлена",
      "supplier_request.received": "Приемка по заявке поставщика",
      "supplier_request.cancelled": "Заявка поставщику отменена",
      "supply.recalculated": "Пересчитаны заявки поставщикам",
      "order.ready_to_schedule": "Ордер готов к планированию",
    };
    return m[t] ?? t;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <p className="text-sm font-bold text-slate-800">История (Timeline)</p>
        <span className="text-xs text-slate-400">{items.length}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {items.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">Событий пока нет.</div>
        ) : (
          items.slice(0, 30).map((e) => (
            <div key={e.id} className="px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{label(e.type)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5 truncate">{e.type}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[11px] text-slate-500">{fmtDateTime(e.created_at)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function supplierReqBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Черновик", cls: "bg-slate-100 text-slate-700" },
    pending_send: { label: "К отправке", cls: "bg-amber-100 text-amber-700" },
    sent: { label: "Отправлено", cls: "bg-blue-100 text-blue-700" },
    confirmed: { label: "Подтверждено", cls: "bg-violet-100 text-violet-700" },
    partially_received: { label: "Частично получено", cls: "bg-amber-100 text-amber-700" },
    received: { label: "Получено", cls: "bg-emerald-100 text-emerald-700" },
    cancelled: { label: "Отменено", cls: "bg-red-100 text-red-700" },
  };
  return map[status] ?? { label: status, cls: "bg-slate-100 text-slate-700" };
}

function PartialReceiptModal({
  req,
  warehouseMap,
  onClose,
  onSubmit,
}: {
  req: SupplierRequest;
  warehouseMap: Record<string, WarehouseItem>;
  onClose: () => void;
  onSubmit: (lines: Array<{ lineId: string; qtyReceived: number }>) => void | Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const v: Record<string, number> = {};
    for (const ln of req.lines ?? []) v[ln.id] = 0;
    return v;
  });
  const [saving, setSaving] = useState(false);

  const canSubmit = useMemo(() => {
    return Object.values(values).some((n) => Number(n) > 0);
  }, [values]);

  return (
    <div className="fixed inset-0 z-[95] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={onClose}>
      <div
        className="w-full sm:max-w-2xl h-[92vh] sm:h-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-xl border border-slate-200 flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <p className="text-base font-black text-slate-800 truncate">Приемка (частичная)</p>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
              {req.supplier_id} · {req.id}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100">
            ✕
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-3 overflow-auto">
          {req.lines.map((ln) => {
            const max = ln.qty;
            const name = warehouseMap[ln.item_id]?.name ?? ln.item_id;
            const val = values[ln.id] ?? 0;
            const received = ln.qty_received ?? 0;
            const remaining = ln.qty_remaining ?? Math.max(0, ln.qty - received);
            return (
              <div key={ln.id} className="border border-slate-200 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                      заказано: {ln.qty} {ln.unit} · принято: {received} · осталось: {remaining} · status: {ln.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setValues((p) => ({ ...p, [ln.id]: 0 }))}
                      className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50"
                    >
                      0
                    </button>
                    <button
                      onClick={() => setValues((p) => ({ ...p, [ln.id]: remaining }))}
                      className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50"
                    >
                      Всё
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <Field label="Принято">
                    <input
                      type="number"
                      min={0}
                      max={remaining}
                      value={val}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        const clamped = Number.isFinite(n) ? Math.max(0, Math.min(remaining, n)) : 0;
                        setValues((p) => ({ ...p, [ln.id]: clamped }));
                      }}
                      className={inputCls}
                    />
                  </Field>
                  <div className="md:col-span-2 text-[11px] text-slate-400">
                    Приемка увеличит остаток на складе и уменьшит дефицит в материалах ордера.
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 sm:px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-white">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50">
            Отмена
          </button>
          <button
            disabled={!canSubmit || saving}
            onClick={async () => {
              setSaving(true);
              try {
                const lines = Object.entries(values)
                  .map(([lineId, qtyReceived]) => ({ lineId, qtyReceived: Number(qtyReceived) }))
                  .filter((x) => x.qtyReceived > 0);
                await onSubmit(lines);
              } finally {
                setSaving(false);
              }
            }}
            className={`px-4 py-2 rounded-xl font-semibold text-white ${
              canSubmit && !saving ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-300 cursor-not-allowed"
            }`}
          >
            {saving ? "Принимаю…" : "Принять"}
          </button>
        </div>
      </div>
    </div>
  );
}

