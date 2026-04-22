import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
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

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

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
    client_signed?: boolean;
    client_sign_name?: string;
    client_signed_at?: string;
    checklist?: {
      materials?: Record<string, boolean>;
      equipment?: boolean;
      tools?: Record<string, boolean>;
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
  const [partialReceiptReq, setPartialReceiptReq] = useState<SupplierRequest | null>(null);
  const [createPrefill, setCreatePrefill] = useState<{
    client_name?: string;
    client_phone?: string;
    object_address?: string;
  } | null>(null);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const loadWarehouseEquipment = useCallback(async () => {
    try {
      const res = await fetch(`${API}/warehouse`, { headers: AH });
      const data = await res.json();
      const items: WarehouseItem[] = data.items ?? [];
      const eq = items.filter((i) => i.itemType === "equipment");
      setWarehouseEq(eq);
      setWarehouseMap(items.reduce((acc, it) => {
        acc[it.id] = it;
        return acc;
      }, {} as Record<string, WarehouseItem>));
    } catch {}
  }, []);

  const loadInstallers = useCallback(async () => {
    try {
      const res = await fetch(`${API}/installers`, { headers: AH });
      const data = await res.json();
      const list = (data.installers ?? data.items ?? data.data ?? []) as Array<any>;
      const normalized = list
        .map((i) => ({ id: String(i.id ?? i.name ?? ""), name: String(i.name ?? "") }))
        .filter((i) => i.id && i.name);
      setInstallers(normalized);
    } catch {}
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/orders`, { headers: AH });
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch {
      showToast("Ошибка загрузки ордеров", false);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadOrderDetail = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/orders/${id}`, { headers: AH });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setSelected(data.order);
        setMaterials(data.materials ?? []);
        setSupplierRequests(data.supplierRequests ?? []);
        setTimeline(data.timeline ?? []);
      } catch (e: any) {
        showToast(e?.message || "Ошибка загрузки ордера", false);
      } finally {
        setLoading(false);
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
        const res = await fetch(`${API}/leads`, { headers: AH });
        const data = await res.json();
        const lead = (data.leads ?? []).find((l: any) => l.id === leadId);
        if (!lead) throw new Error("Lead не найден");
        const cRes = await fetch(`${API}/client/${lead.clientId}`, { headers: AH });
        const cData = await cRes.json();
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
    client_name: string;
    client_phone: string;
    object_address: string;
    equipment_warehouse_id?: string;
    trace_length_m?: number;
    client_legal_name?: string;
    client_tax_id?: string;
    client_email?: string;
    client_doc_basis?: string;
  }) {
    try {
      const res = await fetch(`${API}/orders`, { method: "POST", headers: JH, body: JSON.stringify({ type: "installation", ...payload }) });
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
      setCreateOpen(false);
      setSelectedId(ord.id);
      showToast("Ордер создан");
    } catch (e: any) {
      showToast(e?.message || "Ошибка создания", false);
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
              onClick={loadOrders}
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
                        onClick={() => setSelectedId(o.id)}
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
                onClick={() => setSelectedId(o.id)}
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
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">{STATUS_LABEL[selected.status]}</span>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
            <ClientDetailsPanel
              order={selected}
              onSave={async (patch) => {
                try {
                  const res = await fetch(`${API}/orders/${selected.id}`, {
                    method: "PATCH",
                    headers: JH,
                    body: JSON.stringify(patch),
                  });
                  const data = await res.json();
                  if (data.error) throw new Error(data.error);
                  setSelected(data.order);
                  setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
                  showToast("Данные клиента сохранены");
                } catch (e: any) {
                  showToast(e?.message || "Ошибка сохранения", false);
                }
              }}
            />

            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <p className="text-xs text-slate-400 font-semibold">Следующие действия</p>
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

            {adminMode !== "warehouse" && role !== "installer" && (
              <OfferEditor
                offer={selected.offer}
                warehouseMap={warehouseMap}
                onCreateDraft={createOfferDraftFromEquipment}
                onSaveLines={saveOfferLines}
              />
            )}

            <SurveyPanel
              survey={selected.survey}
              installers={installers}
              traceLengthCurrent={selected.trace_length_m ?? 4}
              onSchedule={scheduleSurvey}
              onComplete={completeSurvey}
            />

            <ExecutionPlanner
              execution={selected.execution}
              installers={installers}
              onSchedule={scheduleExecution}
              onStart={startExecution}
              onComplete={completeExecution}
              onSavePhotos={saveExecutionPhotos}
              onDownloadAct={downloadActPdf}
            />

            <MaterialsActualPanel
              orderStatus={selected.status}
              materials={materials}
              warehouseMap={warehouseMap}
              onSave={saveActualMaterials}
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

            <TimelinePanel timeline={timeline} />

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
}: {
  warehouseEq: WarehouseItem[];
  prefill: { client_name?: string; client_phone?: string; object_address?: string } | null;
  onClose: () => void;
  onCreate: (payload: {
    client_name: string;
    client_phone: string;
    object_address: string;
    client_legal_name?: string;
    client_tax_id?: string;
    client_email?: string;
    client_doc_basis?: string;
    equipment_warehouse_id?: string;
    trace_length_m?: number;
  }) => void;
}) {
  const [clientName, setClientName] = useState(prefill?.client_name ?? "");
  const [clientPhone, setClientPhone] = useState(prefill?.client_phone ?? "");
  const [address, setAddress] = useState(prefill?.object_address ?? "");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState("");
  const [basis, setBasis] = useState("");
  const [eqId, setEqId] = useState<string>("");
  const [traceLen, setTraceLen] = useState<number>(4);

  const canCreate = clientName.trim().length > 0 && clientPhone.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-xl border border-slate-200" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <p className="text-base font-black text-slate-800">Новый Order (услуга)</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Клиент">
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputCls} placeholder="Имя клиента" />
            </Field>
            <Field label="Телефон">
              <input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className={inputCls} placeholder="+375..." />
            </Field>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Юр.лицо / ФИО (для документов)">
              <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={inputCls} placeholder="ООО “...” / ФИО" />
            </Field>
            <Field label="ИНН / ЕГРПОУ (опц.)">
              <input value={taxId} onChange={(e) => setTaxId(e.target.value)} className={inputCls} placeholder="1234567890" />
            </Field>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Email (опц.)">
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="client@email.com" />
            </Field>
            <Field label="Основание (опц.)">
              <input value={basis} onChange={(e) => setBasis(e.target.value)} className={inputCls} placeholder="Договор №..., счет №..., устно" />
            </Field>
          </div>
          <Field label="Адрес объекта">
            <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} placeholder="Адрес монтажа (можно уточнить)" />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Устройство (со склада, опционально)">
              <select value={eqId} onChange={(e) => setEqId(e.target.value)} className={inputCls}>
                <option value="">— не выбрано —</option>
                {warehouseEq.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} (stock: {i.stock})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Длина трассы (м)">
              <input
                type="number"
                min={1}
                value={traceLen}
                onChange={(e) => setTraceLen(Number(e.target.value))}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50">
              Отмена
            </button>
            <button
              disabled={!canCreate}
              onClick={() =>
                onCreate({
                  client_name: clientName.trim(),
                  client_phone: clientPhone.trim(),
                  object_address: address.trim(),
                  client_legal_name: legalName.trim() || undefined,
                  client_tax_id: taxId.trim() || undefined,
                  client_email: email.trim() || undefined,
                  client_doc_basis: basis.trim() || undefined,
                  equipment_warehouse_id: eqId || undefined,
                  trace_length_m: traceLen,
                  // MVP: offer will be created later; we only create the Order container now
                })
              }
              className={`px-4 py-2 rounded-xl font-semibold text-white ${
                canCreate ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300 cursor-not-allowed"
              }`}
            >
              Создать
            </button>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 text-[11px] text-slate-400">
          После создания: добавим КП и кнопку “Подтвердить ордер” для формирования обеспечения (склад/поставщики).
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
  const [mode, setMode] = useState<"warehouse" | "service">("warehouse");
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

  const canAdd = mode === "warehouse" ? !!warehouseId : name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-xl border border-slate-200" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <p className="text-base font-black text-slate-800">Добавить строку КП</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            <button
              onClick={() => setMode("warehouse")}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border ${mode === "warehouse" ? "bg-blue-50 border-blue-200 text-blue-700" : "border-slate-200 text-slate-600"}`}
            >
              Со склада
            </button>
            <button
              onClick={() => setMode("service")}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border ${mode === "service" ? "bg-blue-50 border-blue-200 text-blue-700" : "border-slate-200 text-slate-600"}`}
            >
              Услуга
            </button>
          </div>

          {mode === "warehouse" ? (
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

          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50">
              Отмена
            </button>
            <button
              disabled={!canAdd}
              onClick={() => {
                if (mode === "warehouse") {
                  const it = warehouseMap[warehouseId];
                  if (!it) return;
                  onAdd({
                    line_type: (it.itemType === "equipment" ? "equipment" : it.itemType === "assembly" ? "assembly" : "consumable") as any,
                    warehouse_item_id: it.id,
                    name: it.name,
                    qty,
                    unit: it.unit,
                    price,
                  });
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
  onSavePhotos,
  onDownloadAct,
}: {
  execution: Order["execution"] | undefined;
  installers: Array<{ id: string; name: string }>;
  onSchedule: (p: { installerId: string; installerName: string; date: string }) => void;
  onStart: () => void;
  onComplete: (p: { completion_notes?: string; client_signed: boolean; client_sign_name?: string }) => void;
  onSavePhotos: (photos: string[]) => void;
  onDownloadAct: () => void;
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

      <div className="px-4 pb-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs font-semibold text-slate-500">Фото (до/после)</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPhotos((p) => [...p, ""])}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50"
            >
              + Фото
            </button>
            <button
              onClick={() => onSavePhotos(photos.filter(Boolean))}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
            >
              Сохранить фото
            </button>
          </div>
        </div>
        {photos.length === 0 ? (
          <p className="text-[11px] text-slate-400">Добавьте фото замера/монтажа для отчётности.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
      </div>
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
    <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-200" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
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

        <div className="p-5 space-y-3 max-h-[70vh] overflow-auto">
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

        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
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

