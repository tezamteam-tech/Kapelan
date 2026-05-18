import * as kv from "./kv_store.tsx";
import { getAllWarehouseItems, getWarehouseItem, saveWarehouseItem, addMovement, type WarehouseItem } from "./warehouse.tsx";
import { createClient } from "npm:@supabase/supabase-js";
// @ts-ignore (Deno edge runtime provides npm imports)
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib";
// @ts-ignore (Deno edge runtime provides npm imports)
import fontkit from "npm:@pdf-lib/fontkit";
// NOTE:
// - This module is KV-backed (like the rest of the demo).
// - It implements order-centric "Order = service" primitives and keeps legacy install orders intact.

type Db = ReturnType<typeof createClient>;
type BomEntry = {
  warehouseId: string;
  name: string;
  unit: string;
  qtyFixed: number;
  qtyPerMeter: number;
};
function db(): Db {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ─── PDF Fonts (Cyrillic-safe) ────────────────────────────────────────────────
let _fontRBytes: ArrayBuffer | null = null;
let _fontBBytes: ArrayBuffer | null = null;

async function fetchLocalFont(relPath: string): Promise<ArrayBuffer> {
  // When deployed, these files are bundled with the function, so `fetch(new URL(..., import.meta.url))` stays local.
  const url = new URL(relPath, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`local font not found: ${relPath} (${res.status})`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 1000) throw new Error(`local font too small: ${relPath} (${buf.byteLength} bytes)`);
  return buf;
}

async function fetchFont(urls: string[]): Promise<ArrayBuffer> {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 1000) continue;
      return buf;
    } catch {
      // try next
    }
  }
  throw new Error(`fonts unavailable: ${urls.join(", ")}`);
}

async function loadFonts() {
  if (!_fontRBytes) {
    _fontRBytes =
      (await fetchLocalFont("./assets/fonts/Roboto-Regular.ttf").catch(() => null)) ??
      (await fetchFont([
        // Cyrillic-safe fallbacks
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
        "https://cdn.jsdelivr.net/npm/pdfmake@0.2.7/fonts/Roboto/Roboto-Regular.ttf",
      ]));
  }
  if (!_fontBBytes) {
    _fontBBytes =
      (await fetchLocalFont("./assets/fonts/Roboto-Bold.ttf").catch(() => null)) ??
      (await fetchFont([
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf",
        "https://cdn.jsdelivr.net/npm/pdfmake@0.2.7/fonts/Roboto/Roboto-Medium.ttf",
      ]));
  }
  return { r: _fontRBytes!, b: _fontBBytes! };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrderType = "installation" | "service" | "repair" | "maintenance" | "sale" | "windows" | "doors" | "balcony_glazing" | "balcony_finish";

export type OrderStatus =
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

export type CatalogKind = "equipment" | "consumable" | "assembly" | "service";

export interface OrderRequest {
  request_channel?: string;
  client_problem?: string;
  client_comment?: string;
  initial_requirements_json?: Record<string, unknown>;
}

export interface OrderOfferLine {
  line_type: CatalogKind | "delivery" | "discount";
  // For now we bind to WarehouseItem IDs for material lines to reuse existing warehouse data.
  warehouse_item_id?: string;
  name: string;
  qty: number;
  unit: string;
  price?: number;
}

export interface OrderOffer {
  version: number;
  status: "draft" | "sent" | "approved" | "rejected" | "superseded";
  currency?: string;
  lines: OrderOfferLine[];
  comment?: string;
  sent_at?: string;
  approved_at?: string;
}

export type SupplySource = "warehouse" | "supplier" | "mixed" | "made_to_order";

export type MaterialLineStatus =
  | "planned"
  | "reserved"
  | "ordered"
  | "received"
  | "issued"
  | "used"
  | "closed"
  | "cancelled";

export interface OrderMaterialRequirement {
  id: string;
  order_id: string;
  item_id: string; // warehouse item id for now
  item_kind: Exclude<CatalogKind, "service">;
  required_qty: number;
  reserved_qty: number;
  to_purchase_qty: number;
  issued_qty: number;
  used_qty: number;
  writeoff_qty: number;
  supply_source: SupplySource;
  supplier_id?: string | null;
  status: MaterialLineStatus;
  created_at: string;
  updated_at: string;
}

export type SupplierRequestStatus =
  | "draft"
  | "pending_send"
  | "sent"
  | "confirmed"
  | "partially_received"
  | "received"
  | "cancelled";

export interface SupplierRequestLine {
  id: string;
  supplier_request_id: string;
  order_material_requirement_id: string;
  item_id: string;
  qty: number;
  qty_received: number;
  qty_remaining: number;
  unit: string;
  price?: number;
  status: "draft" | "sent" | "confirmed" | "received" | "cancelled";
}

export interface SupplierRequest {
  id: string;
  order_id: string;
  supplier_id: string;
  status: SupplierRequestStatus;
  planned_delivery_date?: string;
  comment?: string;
  lines: SupplierRequestLine[];
  created_at: string;
  updated_at: string;
  sent_at?: string;
  closed_at?: string;
}

export interface OrderExecution {
  work_type?: "installation" | "repair" | "maintenance";
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
    // materialRequirementId -> checked
    materials?: Record<string, boolean>;
    equipment?: boolean;
    tools?: Record<string, boolean>;
    ready_confirmed?: boolean;
    updated_at?: string;
  };
}

export interface OrderSurvey {
  status?: "not_needed" | "scheduled" | "done" | "cancelled";
  scheduled_at?: string;
  performed_at?: string;
  assigned_installer_id?: string;
  assigned_installer_name?: string;
  notes?: string;
  photos?: string[];
  // normalized survey outputs we want to feed back into order:
  trace_length_m?: number;
  room_area_m2?: number;
  room_type?: string;
  mount_conditions?: string;
}

export interface WindowConstruct {
  id: string;
  title: string;
  roomName?: string;
  locationLabel?: string;
  constructionType?: string;
  widthMm: number;
  heightMm: number;
  quantity: number;
  profileSystem?: string;
  glassUnit?: string;
  hardwareType?: string;
  colorInside?: string;
  colorOutside?: string;
  lamination?: string;
  sillDepthMm?: number;
  dripCapDepthMm?: number;
  mosquitoNet?: boolean;
  slopes?: string;
  tinting?: string;
  notes?: string;
  segments?: Array<{ id?: string; kind?: string; opening?: string; widthRatio?: number; handleSide?: string }>;
}

export interface Order {
  id: string;
  number: string;
  type: OrderType;
  status: OrderStatus;

  client_id?: string;
  client_name?: string;
  client_phone?: string;
  object_address?: string;

  // Client legal / billing data (for documents)
  client_legal_name?: string;
  client_tax_id?: string; // INN / EDRPOU / etc.
  client_doc_basis?: string; // e.g. "договор №...", "устно", "счет №..."
  client_email?: string;

  responsible_manager?: string;

  // Installation-specific helpers (for MVP):
  equipment_warehouse_id?: string; // equipment in warehouse
  trace_length_m?: number; // used for BOM calc
  room_area_m2?: number;
  room_type?: string;
  window_constructs?: WindowConstruct[];

  request?: OrderRequest;
  survey?: OrderSurvey;
  offer?: OrderOffer;
  execution?: OrderExecution;

  created_at: string;
  updated_at: string;
  closed_at?: string;
}

export interface OrderTimelineEvent {
  id: string;
  order_id: string;
  type: string;
  actor?: string;
  created_at: string;
  payload?: Record<string, unknown>;
}

// ─── KV helpers ───────────────────────────────────────────────────────────────

const PFX = {
  order: "order:",
  orderIndex: "order_index",
  mat: "order_mat:",
  matIndex: (orderId: string) => `order_mat_idx:${orderId}`,
  supReq: "sup_req:",
  supReqIndex: (orderId: string) => `sup_req_idx:${orderId}`,
  timeline: "order_tl:",
  timelineIndex: (orderId: string) => `order_tl_idx:${orderId}`,
} as const;

function now() {
  return new Date().toISOString();
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function indexOrder(id: string) {
  const raw = await kv.get(PFX.orderIndex);
  const list: string[] = raw ? JSON.parse(raw) : [];
  if (!list.includes(id)) list.unshift(id);
  await kv.set(PFX.orderIndex, JSON.stringify(list.slice(0, 2000)));
}

async function saveOrder(order: Order) {
  order.updated_at = now();
  await kv.set(`${PFX.order}${order.id}`, JSON.stringify(order));
  await indexOrder(order.id);
}

async function getOrder(orderId: string): Promise<Order | null> {
  const raw = await kv.get(`${PFX.order}${orderId}`);
  if (!raw) return null;
  const s = String(raw);
  // Treat empty-string markers as deleted in KV demo
  if (!s.trim()) return null;
  return JSON.parse(s);
}

async function getAllOrders(): Promise<Order[]> {
  const raw = await kv.get(PFX.orderIndex);
  if (!raw) return [];
  const ids: string[] = JSON.parse(raw);
  const rows = await Promise.all(ids.map((id) => kv.get(`${PFX.order}${id}`)));
  return rows
    .filter(Boolean)
    .map((r) => JSON.parse(r as string))
    .sort((a: Order, b: Order) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

async function unindexOrder(id: string) {
  const raw = await kv.get(PFX.orderIndex);
  const list: string[] = raw ? JSON.parse(raw) : [];
  const next = list.filter((x) => x !== id);
  await kv.set(PFX.orderIndex, JSON.stringify(next.slice(0, 2000)));
}

async function resolveCreateIdempotencyKey(c: any): Promise<string> {
  const h = (c?.req?.header?.("Idempotency-Key") ?? c?.req?.header?.("idempotency-key") ?? "").toString().trim();
  return h;
}

async function getOrderIdByIdemKey(key: string): Promise<string | null> {
  if (!key) return null;
  const raw = await kv.get(`idem:order_create:${key}`);
  return raw ? String(raw) : null;
}

async function setOrderIdByIdemKey(key: string, orderId: string) {
  if (!key) return;
  await kv.set(`idem:order_create:${key}`, orderId);
}

async function pushTimeline(orderId: string, type: string, payload?: Record<string, unknown>) {
  const ev: OrderTimelineEvent = {
    id: uid("tl"),
    order_id: orderId,
    type,
    created_at: now(),
    payload,
  };
  await kv.set(`${PFX.timeline}${ev.id}`, JSON.stringify(ev));
  const idxRaw = await kv.get(PFX.timelineIndex(orderId));
  const list: string[] = idxRaw ? JSON.parse(idxRaw) : [];
  list.unshift(ev.id);
  await kv.set(PFX.timelineIndex(orderId), JSON.stringify(list.slice(0, 500)));
}

async function getTimeline(orderId: string): Promise<OrderTimelineEvent[]> {
  const idxRaw = await kv.get(PFX.timelineIndex(orderId));
  if (!idxRaw) return [];
  const ids: string[] = JSON.parse(idxRaw);
  const rows = await Promise.all(ids.map((id) => kv.get(`${PFX.timeline}${id}`)));
  return rows.filter(Boolean).map((r) => JSON.parse(r as string));
}

async function getMaterialLines(orderId: string): Promise<OrderMaterialRequirement[]> {
  const idxRaw = await kv.get(PFX.matIndex(orderId));
  if (!idxRaw) return [];
  const ids: string[] = JSON.parse(idxRaw);
  const rows = await Promise.all(ids.map((id) => kv.get(`${PFX.mat}${id}`)));
  return rows.filter(Boolean).map((r) => JSON.parse(r as string));
}

async function replaceMaterialLines(orderId: string, lines: OrderMaterialRequirement[]) {
  // overwrite index; leave old dangling (demo KV limitation)
  const ids = lines.map((l) => l.id);
  await kv.set(PFX.matIndex(orderId), JSON.stringify(ids));
  await Promise.all(lines.map((l) => kv.set(`${PFX.mat}${l.id}`, JSON.stringify(l))));
}

async function getSupplierRequests(orderId: string): Promise<SupplierRequest[]> {
  const idxRaw = await kv.get(PFX.supReqIndex(orderId));
  if (!idxRaw) return [];
  const ids: string[] = JSON.parse(idxRaw);
  const rows = await Promise.all(ids.map((id) => kv.get(`${PFX.supReq}${id}`)));
  return rows.filter(Boolean).map((r) => JSON.parse(r as string));
}

async function replaceSupplierRequests(orderId: string, reqs: SupplierRequest[]) {
  const ids = reqs.map((r) => r.id);
  await kv.set(PFX.supReqIndex(orderId), JSON.stringify(ids));
  await Promise.all(reqs.map((r) => kv.set(`${PFX.supReq}${r.id}`, JSON.stringify(r))));
}

async function saveSupplierRequest(req: SupplierRequest) {
  req.updated_at = now();
  await kv.set(`${PFX.supReq}${req.id}`, JSON.stringify(req));
  const idxRaw = await kv.get(PFX.supReqIndex(req.order_id));
  const list: string[] = idxRaw ? JSON.parse(idxRaw) : [];
  if (!list.includes(req.id)) {
    list.unshift(req.id);
    await kv.set(PFX.supReqIndex(req.order_id), JSON.stringify(list));
  }
}

async function getSupplierRequestById(reqId: string): Promise<SupplierRequest | null> {
  const raw = await kv.get(`${PFX.supReq}${reqId}`);
  return raw ? JSON.parse(raw) : null;
}

async function updateMaterialLine(line: OrderMaterialRequirement) {
  line.updated_at = now();
  await kv.set(`${PFX.mat}${line.id}`, JSON.stringify(line));
}

async function getMaterialLineById(id: string): Promise<OrderMaterialRequirement | null> {
  const raw = await kv.get(`${PFX.mat}${id}`);
  return raw ? JSON.parse(raw) : null;
}

// Core logic: derive material requirements from editable BOM.

function calcBomRequirements(bom: BomEntry[], traceLengthM: number): Array<{ itemId: string; qty: number; unit: string; name: string }> {
  return bom.map((b) => {
    const qty = Math.ceil(b.qtyFixed + b.qtyPerMeter * traceLengthM);
    return { itemId: b.warehouseId, qty, unit: b.unit, name: b.name };
  });
}

async function getEquipmentBomFromKv(equipmentId: string): Promise<BomEntry[] | null> {
  const raw = await kv.get(`kapelan_equip:${equipmentId}`);
  if (!raw) return null;
  try {
    const eq = JSON.parse(raw);
    const bom = Array.isArray(eq?.bom) ? eq.bom : null;
    if (!bom) return null;
    return bom
      .map((e: any) => ({
        warehouseId: String(e.warehouseId ?? ""),
        name: String(e.name ?? ""),
        unit: String(e.unit ?? "шт"),
        qtyFixed: Number(e.qtyFixed ?? 0),
        qtyPerMeter: Number(e.qtyPerMeter ?? 0),
      }))
      .filter((e: any) => e.warehouseId && e.name);
  } catch {
    return null;
  }
}

function supplyPlanForItem(required: number, available: number): { reserved: number; toPurchase: number; supply: SupplySource } {
  if (available >= required) return { reserved: required, toPurchase: 0, supply: "warehouse" };
  if (available > 0) return { reserved: available, toPurchase: required - available, supply: "mixed" };
  return { reserved: 0, toPurchase: required, supply: "supplier" };
}

function inferSupplierId(item: WarehouseItem): string | null {
  // In current demo warehouse items use string supplier names, not IDs.
  // For MVP we create pseudo supplier id from name.
  const s = (item.supplier ?? "").trim();
  if (!s) return null;
  return `sup_name:${s.toLowerCase().replace(/\s+/g, "_")}`;
}

function hasWindowConstructs(order: Order): boolean {
  return Array.isArray(order.window_constructs) && order.window_constructs.length > 0;
}

function hasProductLines(order: Order): boolean {
  return (order.offer?.lines ?? []).some((l) => l.line_type === "equipment" || l.line_type === "assembly");
}

function isWindowOrder(order: Order): boolean {
  return ["windows", "doors", "balcony_glazing", "balcony_finish"].includes(String(order.type));
}

// ─── Public routes ────────────────────────────────────────────────────────────

export function registerOrderCoreRoutes(app: any) {
  const P = "/make-server-1df47c03";

  // GET /orders
  app.get(`${P}/orders`, async (c: any) => {
    const lite = String(c.req.query("lite") ?? "").trim() === "1";
    const orders = await getAllOrders();
    if (!lite) return c.json({ orders });
    // Reduce payload for faster list rendering on client
    const slim = orders.map((o) => ({
      id: o.id,
      number: o.number,
      type: o.type,
      status: o.status,
      client_name: o.client_name ?? "",
      client_phone: o.client_phone ?? "",
      object_address: o.object_address ?? "",
      trace_length_m: o.trace_length_m,
      execution: o.execution
        ? {
            status: o.execution.status,
            prep_status: o.execution.prep_status,
            scheduled_at: o.execution.scheduled_at,
            assigned_installer_id: o.execution.assigned_installer_id,
            assigned_installer_name: o.execution.assigned_installer_name,
          }
        : undefined,
      created_at: o.created_at,
      updated_at: o.updated_at,
      // keep minimal offer metadata if exists
      offer: o.offer ? { version: o.offer.version, status: o.offer.status, currency: o.offer.currency } : undefined,
    }));
    return c.json({ orders: slim });
  });

  // POST /orders (create)
  app.post(`${P}/orders`, async (c: any) => {
    const idemKey = await resolveCreateIdempotencyKey(c);
    if (idemKey) {
      const existingId = await getOrderIdByIdemKey(idemKey);
      if (existingId) {
        const existing = await getOrder(existingId);
        if (existing) return c.json({ order: existing, idempotent: true });
      }
    }
    const body = await c.req.json();
    const createdAt = now();

    const eqId: string | undefined = body.equipment_warehouse_id ?? undefined;
    const traceLen: number = typeof body.trace_length_m === "number" ? body.trace_length_m : 4;

    // Create a minimal draft offer by default (so that approval/confirm flow is unblocked).
    // If equipment selected, include it as the first line. Prices are optional in MVP.
    let offer: OrderOffer | undefined;
    if (body.offer) {
      offer = body.offer as OrderOffer;
    } else {
      const lines: OrderOfferLine[] = [];
      if (eqId) {
        const eqItem = await getWarehouseItem(eqId);
        if (eqItem) {
          lines.push({
            line_type: "equipment",
            warehouse_item_id: eqItem.id,
            name: eqItem.name,
            qty: 1,
            unit: eqItem.unit,
            price: eqItem.price,
          });
        }
      }
      offer = { version: 1, status: "draft", currency: "UAH", lines };
    }

    const order: Order = {
      id: uid("ord"),
      number: `ORD-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`,
      type: (body.type as OrderType) ?? "installation",
      status: "new",
      client_id: body.client_id ? String(body.client_id) : undefined,
      client_name: body.client_name ?? "",
      client_phone: body.client_phone ?? "",
      object_address: body.object_address ?? "",
      client_legal_name: body.client_legal_name ?? undefined,
      client_tax_id: body.client_tax_id ?? undefined,
      client_doc_basis: body.client_doc_basis ?? undefined,
      client_email: body.client_email ?? undefined,
      responsible_manager: body.responsible_manager ?? "",
      equipment_warehouse_id: eqId,
      trace_length_m: traceLen,
      room_area_m2: typeof body.room_area_m2 === "number" ? body.room_area_m2 : undefined,
      room_type: body.room_type ?? undefined,
      window_constructs: Array.isArray(body.window_constructs) ? body.window_constructs : undefined,
      request: body.request ?? {},
      offer,
      execution: body.execution ?? undefined,
      created_at: createdAt,
      updated_at: createdAt,
    };
    await saveOrder(order);
    if (idemKey) await setOrderIdByIdemKey(idemKey, order.id);
    await pushTimeline(order.id, "order.created", { type: order.type });
    if (order.offer) await pushTimeline(order.id, "offer.created", { version: order.offer.version, lines: order.offer.lines.length });
    return c.json({ order });
  });

  // GET /orders/:id
  app.get(`${P}/orders/:id`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);
    const light = String(c.req.query("light") ?? "").trim() === "1";
    if (light) return c.json({ order });

    // Parallelize to reduce total latency
    const [materials, supplierRequests, timeline] = await Promise.all([
      getMaterialLines(id),
      getSupplierRequests(id),
      getTimeline(id),
    ]);
    return c.json({ order, materials, supplierRequests, timeline });
  });

  // PATCH /orders/:id (update)
  app.patch(`${P}/orders/:id`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);
    const bodyRaw = await c.req.json().catch(() => ({}));
    const requestedStatus = typeof bodyRaw?.status === "string" ? String(bodyRaw.status) : undefined;
    // Never allow changing identifiers through patch payload
    const { status: _status, id: _id, number: _number, created_at: _createdAt, ...body } = (bodyRaw ?? {}) as any;
    const prevStatus = order.status;
    const next: Order = {
      ...order,
      ...body,
      request: { ...(order.request ?? {}), ...(body.request ?? {}) },
      survey: body.survey ? { ...(order.survey ?? {}), ...(body.survey ?? {}) } : order.survey,
      offer: body.offer ? { ...(order.offer ?? { version: 1, status: "draft", lines: [] }), ...body.offer } : order.offer,
      execution: body.execution ? { ...(order.execution ?? {}), ...body.execution } : order.execution,
    };

    // Harden status transitions: status changes must use action endpoints,
    // except a minimal set of safe transitions used by UI draft flows.
    if (requestedStatus && requestedStatus !== prevStatus) {
      const allowedDirect = new Set<OrderStatus>(["qualification", "offer_prepared", "cancelled", "new"]);
      if (!allowedDirect.has(requestedStatus as OrderStatus)) {
        return c.json({ error: `Direct status change is not allowed via PATCH (requested: ${requestedStatus}). Use action endpoints.` }, 400);
      }
      // Prevent skipping forward: allow only narrow cases.
      const can =
        (prevStatus === "new" && requestedStatus === "qualification") ||
        // Allow keeping qualification while editing details
        (prevStatus === "qualification" && requestedStatus === "qualification") ||
        // Allow marking offer prepared when editing offer draft
        (requestedStatus === "offer_prepared" && ["survey_done", "offer_prepared", "offer_sent", "offer_approved", "qualification", "survey_scheduled"].includes(prevStatus)) ||
        // Allow cancelling from any non-final state
        (requestedStatus === "cancelled" && !["closed"].includes(prevStatus)) ||
        // Allow admin reset to new only before execution starts
        (requestedStatus === "new" && ["new", "qualification"].includes(prevStatus));
      if (!can) {
        return c.json({ error: `Invalid status transition via PATCH: ${prevStatus} -> ${requestedStatus}` }, 400);
      }
      // AC baseline: qualification requires client + object data.
      if (requestedStatus === "qualification") {
        const name = String(next.client_name ?? "").trim();
        const phone = String(next.client_phone ?? "").trim();
        const addr = String(next.object_address ?? "").trim();
        if (!name || !phone || !addr) {
          return c.json({ error: "Для квалификации заполните: клиент, телефон и адрес объекта" }, 400);
        }
      }
      next.status = requestedStatus as OrderStatus;
    }
    await saveOrder(next);
    if (next.status !== prevStatus) {
      await pushTimeline(id, "order.status.changed", { from: prevStatus, to: next.status });
    }
    await pushTimeline(id, "order.updated", { fields: Object.keys(body ?? {}) });
    return c.json({ order: next });
  });

  // DELETE /orders/:id (admin)
  app.delete(`${P}/orders/:id`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);

    // Remove indices first
    await unindexOrder(id);
    await kv.set(`${PFX.order}${id}`, ""); // soft delete marker (KV demo)
    // Also clear related indices (materials, supplier requests, timeline)
    await kv.set(PFX.matIndex(id), JSON.stringify([]));
    await kv.set(PFX.supReqIndex(id), JSON.stringify([]));
    await kv.set(PFX.timelineIndex(id), JSON.stringify([]));

    await pushTimeline(id, "order.deleted", { at: now() });
    return c.json({ success: true });
  });

  // ── Survey (замер) inside Order ────────────────────────────────────────────
  // POST /orders/:id/survey/schedule { installerId, installerName, scheduledAt }
  app.post(`${P}/orders/:id/survey/schedule`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);
    const body = await c.req.json();
    const scheduledAt = String(body?.scheduledAt ?? "");
    if (!scheduledAt) return c.json({ error: "scheduledAt required" }, 400);
    order.survey = {
      ...(order.survey ?? {}),
      status: "scheduled",
      scheduled_at: scheduledAt,
      assigned_installer_id: body?.installerId ? String(body.installerId) : order.survey?.assigned_installer_id,
      assigned_installer_name: body?.installerName ? String(body.installerName) : order.survey?.assigned_installer_name,
    };
    order.status = "survey_scheduled";
    await saveOrder(order);
    await pushTimeline(id, "survey.scheduled", { scheduled_at: scheduledAt, installer: order.survey.assigned_installer_name ?? "" });
    const timeline = await getTimeline(id);
    return c.json({ order, timeline });
  });

  // POST /orders/:id/survey/complete { performedAt, trace_length_m, notes, photos?, mount_conditions? }
  app.post(`${P}/orders/:id/survey/complete`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);
    const body = await c.req.json();
    const performedAt = String(body?.performedAt ?? now());
    const traceLen = typeof body?.trace_length_m === "number" ? body.trace_length_m : undefined;
    const roomArea = typeof body?.room_area_m2 === "number" ? body.room_area_m2 : undefined;
    const roomType = body?.room_type ? String(body.room_type) : undefined;
    const notes = body?.notes ? String(body.notes) : undefined;
    const mountConditions = body?.mount_conditions ? String(body.mount_conditions) : undefined;
    const photos = Array.isArray(body?.photos) ? body.photos.map((p: any) => String(p)) : undefined;

    order.survey = {
      ...(order.survey ?? {}),
      status: "done",
      performed_at: performedAt,
      trace_length_m: traceLen ?? order.survey?.trace_length_m,
      room_area_m2: roomArea ?? order.survey?.room_area_m2,
      room_type: roomType ?? order.survey?.room_type,
      notes,
      mount_conditions: mountConditions,
      photos,
    };

    // Feed survey results back into order (so everything stays in one place)
    if (typeof traceLen === "number") order.trace_length_m = traceLen;
    if (typeof roomArea === "number") order.room_area_m2 = roomArea;
    if (roomType) order.room_type = roomType;

    const traceFinal = typeof order.trace_length_m === "number" ? order.trace_length_m : undefined;
    if (!isWindowOrder(order) && !(typeof traceFinal === "number" && traceFinal > 0)) {
      return c.json({ error: "Для завершения замера укажите длину трассы (trace_length_m)" }, 400);
    }

    order.status = "survey_done";
    await saveOrder(order);
    await pushTimeline(id, "survey.completed", { performed_at: performedAt, trace_length_m: traceLen ?? null });
    const timeline = await getTimeline(id);
    return c.json({ order, timeline });
  });

  // POST /orders/:id/offer/approve
  app.post(`${P}/orders/:id/offer/approve`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);
    if (!order.offer) return c.json({ error: "Offer not found" }, 400);
    if (order.offer.status !== "sent") {
      return c.json({ error: "Offer must be sent before approval" }, 400);
    }
    order.offer.status = "approved";
    order.offer.approved_at = now();
    order.status = "offer_approved";
    await saveOrder(order);
    await pushTimeline(id, "offer.approved", { version: order.offer.version });
    return c.json({ order });
  });

  // POST /orders/:id/offer/send
  app.post(`${P}/orders/:id/offer/send`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);
    if (!order.offer) return c.json({ error: "Offer not found" }, 400);
    if (!order.offer.lines?.length) return c.json({ error: "Offer has no lines" }, 400);
    const hasEquipmentLine = (order.offer.lines ?? []).some((l) => l.line_type === "equipment");
    if (!hasEquipmentLine && !hasProductLines(order) && !order.equipment_warehouse_id && !hasWindowConstructs(order)) {
      return c.json({ error: "Для отправки КП добавьте изделие/оконную конструкцию или строку оборудования в КП" }, 400);
    }
    if (order.offer.status === "approved") return c.json({ error: "Offer already approved" }, 400);
    order.offer.status = "sent";
    order.offer.sent_at = now();
    order.status = "offer_sent";
    await saveOrder(order);
    await pushTimeline(id, "offer.sent", { version: order.offer.version, lines: order.offer.lines.length });
    return c.json({ order });
  });

  // POST /orders/:id/confirm (confirmOrderForExecution)
  app.post(`${P}/orders/:id/confirm`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);

    if (!order.offer || order.offer.status !== "approved") {
      return c.json({ error: "Approved offer required" }, 400);
    }

    const traceLen = typeof order.trace_length_m === "number" ? order.trace_length_m : NaN;
    if (!isWindowOrder(order) && !(typeof traceLen === "number" && traceLen > 0)) {
      return c.json({ error: "Перед подтверждением укажите длину трассы (trace_length_m). Обычно она появляется после замера." }, 400);
    }

    const hasEquipmentLine = (order.offer.lines ?? []).some((l) => l.line_type === "equipment");
    if (!hasEquipmentLine && !hasProductLines(order) && !order.equipment_warehouse_id && !hasWindowConstructs(order)) {
      return c.json({ error: "Перед подтверждением добавьте оконную конструкцию или строку изделия в КП" }, 400);
    }

    // Build requirement set.
    // MVP rule: reserve explicit offer items and editable BOM lines.
    const reqMap = new Map<string, { qty: number; unit?: string; name?: string; kind: Exclude<CatalogKind, "service"> }>();
    const forceSupplier = new Set<string>();

    if (order.equipment_warehouse_id) {
      const eqItem = await getWarehouseItem(order.equipment_warehouse_id);
      if (eqItem) {
        reqMap.set(eqItem.id, { qty: 1, unit: eqItem.unit, name: eqItem.name, kind: "equipment" });
      }

      // Prefer BOM from editable product metadata if warehouse item is linked.
      const linkedBomId = (eqItem as any)?.bomId ? String((eqItem as any).bomId) : "";
      const linkedBom = linkedBomId ? await getEquipmentBomFromKv(linkedBomId) : null;
      const bomToUse: BomEntry[] | null = (linkedBom && linkedBom.length)
        ? linkedBom
        : null;

      if (bomToUse?.length) {
        for (const r of calcBomRequirements(bomToUse, traceLen)) {
          if (!r.itemId) continue;
          const prev = reqMap.get(r.itemId);
          if (prev) prev.qty += r.qty;
          else reqMap.set(r.itemId, { qty: r.qty, unit: r.unit, name: r.name, kind: "consumable" });
        }
      }
    }

    // Also include any warehouse-bound lines from offer
    for (const line of order.offer.lines ?? []) {
      if (!line.warehouse_item_id) continue;
      if (line.line_type === "service" || line.line_type === "delivery" || line.line_type === "discount") continue;
      if (String((line as any)?.force_supply_source ?? "") === "supplier") {
        forceSupplier.add(String(line.warehouse_item_id));
      }
      const prev = reqMap.get(line.warehouse_item_id);
      if (prev) prev.qty += line.qty;
      else reqMap.set(line.warehouse_item_id, { qty: line.qty, unit: line.unit, name: line.name, kind: (line.line_type as any) });
    }

    // Load warehouse snapshot for availability
    const whItems = await getAllWarehouseItems();
    const whById = new Map(whItems.map((i) => [i.id, i]));

    const lines: OrderMaterialRequirement[] = [];
    let hasDeficit = false;

    for (const [itemId, r] of reqMap.entries()) {
      const whItem = whById.get(itemId) ?? null;
      const available = forceSupplier.has(itemId) ? 0 : (whItem?.stock ?? 0);
      const plan = supplyPlanForItem(r.qty, available);
      if (plan.toPurchase > 0) hasDeficit = true;

      const supplierId = whItem ? inferSupplierId(whItem) : null;
      const t = now();
      lines.push({
        id: uid("mat"),
        order_id: id,
        item_id: itemId,
        item_kind: r.kind,
        required_qty: r.qty,
        reserved_qty: plan.reserved,
        to_purchase_qty: plan.toPurchase,
        issued_qty: 0,
        used_qty: 0,
        writeoff_qty: 0,
        supply_source: plan.supply,
        supplier_id: plan.toPurchase > 0 ? supplierId : null,
        status: plan.reserved > 0 ? "reserved" : "planned",
        created_at: t,
        updated_at: t,
      });
    }

    // Reserve warehouse stock for reserved_qty (hard reserve in this KV demo)
    for (const l of lines) {
      if (l.reserved_qty <= 0) continue;
      const item = whById.get(l.item_id);
      if (!item) continue;
      if (item.stock < l.reserved_qty) continue; // should not happen due to plan, but guard
      const before = item.stock;
      item.stock -= l.reserved_qty;
      await saveWarehouseItem(item);
      await addMovement({
        itemId: item.id,
        itemName: item.name,
        type: "out",
        qty: l.reserved_qty,
        stockBefore: before,
        stockAfter: item.stock,
        reason: "reserve_for_order",
        referenceId: id,
        note: `Резерв под Order ${order.number}`,
      });
    }

    await replaceMaterialLines(id, lines);

    // Create supplier requests grouped by supplier_id (only for to_purchase_qty > 0)
    const bySupplier = new Map<string, OrderMaterialRequirement[]>();
    for (const l of lines) {
      if (l.to_purchase_qty <= 0) continue;
      const sup = (l.supplier_id ?? "").trim();
      const key = sup || "sup_unassigned";
      const list = bySupplier.get(key) ?? [];
      list.push(l);
      bySupplier.set(key, list);
    }

    const supReqs: SupplierRequest[] = [];
    for (const [supplierId, mats] of bySupplier.entries()) {
      const t = now();
      const reqId = uid("supreq");
      const req: SupplierRequest = {
        id: reqId,
        order_id: id,
        supplier_id: supplierId,
        status: "draft",
        created_at: t,
        updated_at: t,
        lines: mats.map((m) => ({
          id: uid("supreqln"),
          supplier_request_id: reqId,
          order_material_requirement_id: m.id,
          item_id: m.item_id,
          qty: m.to_purchase_qty,
          qty_received: 0,
          qty_remaining: m.to_purchase_qty,
          unit: whById.get(m.item_id)?.unit ?? "шт",
          status: "draft",
        })),
      };
      supReqs.push(req);
    }

    await replaceSupplierRequests(id, supReqs);

    // Create procurement-facing purchase requests for any deficits.
    // Note: order_core itself is KV-backed (string IDs), so we store order reference in note.
    try {
      const supabase = db();
      const deficitLines = lines.filter((l) => (l.to_purchase_qty ?? 0) > 0);
      if (deficitLines.length > 0) {
        const noteBase = `Order ${order.number} (${id})`;
        const { data: pr, error: prErr } = await supabase
          .from("purchase_requests")
          .insert({ status: "pending", reason: "order", note: noteBase })
          .select("id")
          .single();
        if (!prErr && pr?.id) {
          const prLines = deficitLines.map((l) => {
            const wh = whById.get(l.item_id);
            return {
              purchase_request_id: pr.id,
              warehouse_item_id: l.item_id,
              qty: l.to_purchase_qty,
              unit: wh?.unit ?? "шт",
              buy_price: (wh as any)?.buyPrice ?? null,
              sell_price: (wh as any)?.price ?? null,
            };
          });
          await supabase.from("purchase_request_lines").insert(prLines);
        }
      }
    } catch (e) {
      // Never block order confirmation due to procurement helper.
      console.error("purchase_requests from order deficits failed:", e);
    }

    order.status = hasDeficit ? "awaiting_supply" : "ready_to_schedule";
    await saveOrder(order);
    await pushTimeline(id, "order.confirmed_for_execution", {
      materials_count: lines.length,
      supplier_requests: supReqs.length,
      status: order.status,
    });

    const timeline = await getTimeline(id);
    return c.json({ order, materials: lines, supplierRequests: supReqs, timeline });
  });

  // GET /orders/:id/materials
  app.get(`${P}/orders/:id/materials`, async (c: any) => {
    const id = c.req.param("id");
    const lines = await getMaterialLines(id);
    return c.json({ materials: lines });
  });

  // GET /orders/:id/supplier-requests
  app.get(`${P}/orders/:id/supplier-requests`, async (c: any) => {
    const id = c.req.param("id");
    const reqs = await getSupplierRequests(id);
    return c.json({ supplierRequests: reqs });
  });

  // POST /orders/:id/supplier-requests/:reqId/send
  app.post(`${P}/orders/:id/supplier-requests/:reqId/send`, async (c: any) => {
    const orderId = c.req.param("id");
    const reqId = c.req.param("reqId");
    const order = await getOrder(orderId);
    if (!order) return c.json({ error: "Order not found" }, 404);
    const req = await getSupplierRequestById(reqId);
    if (!req || req.order_id !== orderId) return c.json({ error: "SupplierRequest not found" }, 404);
    if (req.status === "cancelled") return c.json({ error: "SupplierRequest cancelled" }, 400);
    req.status = "confirmed";
    req.sent_at = now();
    req.lines = (req.lines ?? []).map((l) => ({ ...l, status: l.status === "cancelled" ? "cancelled" : "confirmed" }));
    await saveSupplierRequest(req);
    await pushTimeline(orderId, "supplier_request.sent", { supplier_request_id: reqId, supplier_id: req.supplier_id, lines: req.lines.length });
    const supplierRequests = await getSupplierRequests(orderId);
    const timeline = await getTimeline(orderId);
    return c.json({ supplierRequest: req, supplierRequests, timeline });
  });

  // POST /orders/:id/supplier-requests/:reqId/cancel
  // body: { reason?: string }
  app.post(`${P}/orders/:id/supplier-requests/:reqId/cancel`, async (c: any) => {
    const orderId = c.req.param("id");
    const reqId = c.req.param("reqId");
    const order = await getOrder(orderId);
    if (!order) return c.json({ error: "Order not found" }, 404);
    const req = await getSupplierRequestById(reqId);
    if (!req || req.order_id !== orderId) return c.json({ error: "SupplierRequest not found" }, 404);
    if (req.status === "received") return c.json({ error: "SupplierRequest already received" }, 400);
    const body = await c.req.json().catch(() => ({}));
    req.status = "cancelled";
    req.closed_at = now();
    req.comment = body?.reason ? String(body.reason) : req.comment;
    req.lines = (req.lines ?? []).map((l) => ({ ...l, status: "cancelled" }));
    await saveSupplierRequest(req);
    await pushTimeline(orderId, "supplier_request.cancelled", { supplier_request_id: reqId, reason: body?.reason ?? "" });
    const supplierRequests = await getSupplierRequests(orderId);
    const timeline = await getTimeline(orderId);
    return c.json({ supplierRequest: req, supplierRequests, timeline });
  });

  // POST /orders/:id/supply/recalc
  // Rebuild supplier requests from current material deficits (to_purchase_qty)
  app.post(`${P}/orders/:id/supply/recalc`, async (c: any) => {
    const orderId = c.req.param("id");
    const order = await getOrder(orderId);
    if (!order) return c.json({ error: "Order not found" }, 404);

    const mats = await getMaterialLines(orderId);
    const whItems = await getAllWarehouseItems();
    const whById = new Map(whItems.map((i) => [i.id, i]));

    // Build supplier requests grouped by supplier_id for remaining deficits
    const bySupplier = new Map<string, OrderMaterialRequirement[]>();
    for (const m of mats) {
      const need = m.to_purchase_qty ?? 0;
      if (need <= 0) continue;
      const wh = whById.get(m.item_id);
      const sup = m.supplier_id ?? (wh ? inferSupplierId(wh) : null);
      const key = (sup ?? "").trim() || "sup_unassigned";
      const list = bySupplier.get(key) ?? [];
      list.push({ ...m, supplier_id: sup });
      bySupplier.set(key, list);
    }

    const reqs: SupplierRequest[] = [];
    for (const [supplierId, lines] of bySupplier.entries()) {
      const t = now();
      const reqId = uid("supreq");
      reqs.push({
        id: reqId,
        order_id: orderId,
        supplier_id: supplierId,
        status: "draft",
        created_at: t,
        updated_at: t,
        lines: lines.map((m) => ({
          id: uid("supreqln"),
          supplier_request_id: reqId,
          order_material_requirement_id: m.id,
          item_id: m.item_id,
          qty: m.to_purchase_qty,
          qty_received: 0,
          qty_remaining: m.to_purchase_qty,
          unit: whById.get(m.item_id)?.unit ?? "шт",
          status: "draft",
        })),
      });
    }

    await replaceSupplierRequests(orderId, reqs);
    await pushTimeline(orderId, "supply.recalculated", { supplier_requests: reqs.length });

    const supplierRequests = await getSupplierRequests(orderId);
    const timeline = await getTimeline(orderId);
    return c.json({ supplierRequests, timeline });
  });

  // POST /orders/:id/supplier-requests/:reqId/receive
  // body: { lines?: [{ lineId, qtyReceived }] }  (if omitted -> receive all qty)
  app.post(`${P}/orders/:id/supplier-requests/:reqId/receive`, async (c: any) => {
    const orderId = c.req.param("id");
    const reqId = c.req.param("reqId");
    const order = await getOrder(orderId);
    if (!order) return c.json({ error: "Order not found" }, 404);
    const req = await getSupplierRequestById(reqId);
    if (!req || req.order_id !== orderId) return c.json({ error: "SupplierRequest not found" }, 404);
    if (req.status === "cancelled") return c.json({ error: "SupplierRequest cancelled" }, 400);

    const body = await c.req.json().catch(() => ({}));
    const overrides: Record<string, number> = {};
    for (const ln of (body?.lines ?? []) as Array<any>) {
      if (!ln?.lineId) continue;
      overrides[String(ln.lineId)] = Number(ln.qtyReceived ?? 0);
    }

    // Receive items to warehouse and close material deficits for these lines (accumulative)
    for (const ln of req.lines ?? []) {
      if (ln.status === "cancelled") continue;
      const qtyRequest = ln.qty ?? 0;
      const prevReceived = ln.qty_received ?? 0;
      const prevRemaining = ln.qty_remaining ?? Math.max(0, qtyRequest - prevReceived);

      const requestedNow = Object.prototype.hasOwnProperty.call(overrides, ln.id) ? overrides[ln.id] : prevRemaining;
      const qtyNow = Math.max(0, Math.min(Number(requestedNow ?? 0), prevRemaining));
      if (qtyNow <= 0) continue;

      const whItem = await getWarehouseItem(ln.item_id);
      if (whItem) {
        const before = whItem.stock;
        whItem.stock += qtyNow;
        await saveWarehouseItem(whItem);
        await addMovement({
          itemId: whItem.id,
          itemName: whItem.name,
          type: "in",
          qty: qtyNow,
          stockBefore: before,
          stockAfter: whItem.stock,
          reason: "supplier_receipt",
          referenceId: orderId,
          note: `Приемка по заявке ${reqId} (Order ${order.number})`,
        });
      }

      const mat = await getMaterialLineById(ln.order_material_requirement_id);
      if (mat) {
        mat.to_purchase_qty = Math.max(0, mat.to_purchase_qty - qtyNow);
        if (mat.to_purchase_qty === 0 && mat.status === "ordered") mat.status = "received";
        if (mat.to_purchase_qty === 0 && (mat.status === "planned" || mat.status === "reserved")) {
          // This line was planned for supplier; mark received if fully covered.
          mat.status = "received";
        }
        await updateMaterialLine(mat);
      }

      ln.qty_received = prevReceived + qtyNow;
      ln.qty_remaining = Math.max(0, qtyRequest - ln.qty_received);
      ln.status = ln.qty_remaining === 0 ? "received" : "confirmed";
    }

    // Update supplier request status
    const allReceived = (req.lines ?? []).filter((l) => l.status !== "cancelled").every((l) => l.status === "received");
    req.status = allReceived ? "received" : "partially_received";
    req.closed_at = allReceived ? now() : req.closed_at;
    await saveSupplierRequest(req);

    // Re-evaluate order status: if all materials have no to_purchase_qty -> ready_to_schedule
    const mats = await getMaterialLines(orderId);
    const hasDeficit = mats.some((m) => (m.to_purchase_qty ?? 0) > 0);
    if (!hasDeficit && (order.status === "awaiting_supply" || order.status === "offer_approved")) {
      order.status = "ready_to_schedule";
      await saveOrder(order);
      await pushTimeline(orderId, "order.ready_to_schedule", { reason: "all_supply_received" });
    }

    await pushTimeline(orderId, "supplier_request.received", { supplier_request_id: reqId, status: req.status });

    const supplierRequests = await getSupplierRequests(orderId);
    const materials = await getMaterialLines(orderId);
    const timeline = await getTimeline(orderId);
    const freshOrder = await getOrder(orderId);
    return c.json({ order: freshOrder, supplierRequest: req, supplierRequests, materials, timeline });
  });

  // GET /orders/:id/timeline
  app.get(`${P}/orders/:id/timeline`, async (c: any) => {
    const id = c.req.param("id");
    const timeline = await getTimeline(id);
    return c.json({ timeline });
  });

  // ── Documents: Act of completed works (PDF) ────────────────────────────────
  // GET /orders/:id/act/pdf
  app.get(`${P}/orders/:id/act/pdf`, async (c: any) => {
    try {
      const id = c.req.param("id");
      const order = await getOrder(id);
      if (!order) return c.json({ error: "Order not found" }, 404);

      // Build a minimal PDF (draft) filled from Order.
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);
      const fonts = await loadFonts();
      const page = pdf.addPage([595.28, 841.89]); // A4
      const font = await pdf.embedFont(fonts.r);
      const fontBold = await pdf.embedFont(fonts.b);

    const margin = 48;
    let y = 841.89 - margin;
    const lineH = 16;

    const draw = (text: string, opts?: { bold?: boolean; size?: number; color?: any }) => {
      const size = opts?.size ?? 12;
      const f = opts?.bold ? fontBold : font;
      page.drawText(text, { x: margin, y, size, font: f, color: opts?.color ?? rgb(0.1, 0.1, 0.1) });
      y -= lineH;
    };

    const drawKv = (k: string, v: string) => {
      page.drawText(k, { x: margin, y, size: 10, font: fontBold, color: rgb(0.35, 0.35, 0.35) });
      page.drawText(v, { x: margin + 160, y, size: 10, font, color: rgb(0.15, 0.15, 0.15) });
      y -= 14;
    };

    draw("АКТ ВЫПОЛНЕННЫХ РАБОТ (черновик)", { bold: true, size: 16 });
    draw(`По ордеру: ${order.number}`, { bold: true, size: 12, color: rgb(0.05, 0.3, 0.6) });
    y -= 8;

    drawKv("Дата составления:", new Date().toLocaleDateString("ru-RU"));
    drawKv("Клиент:", order.client_name || "—");
    if (order.client_legal_name) drawKv("Юр. лицо:", order.client_legal_name);
    if (order.client_tax_id) drawKv("ИНН/ЕГРПОУ:", order.client_tax_id);
    drawKv("Телефон:", order.client_phone || "—");
    if (order.client_email) drawKv("Email:", order.client_email);
    drawKv("Адрес объекта:", order.object_address || "—");
    if (order.client_doc_basis) drawKv("Основание:", order.client_doc_basis);
    drawKv("Тип услуги:", order.type);
    drawKv("Статус ордера:", order.status);
    if (order.execution?.assigned_installer_name) {
      drawKv("Исполнитель:", order.execution.assigned_installer_name);
    }
    if (order.execution?.scheduled_at) {
      drawKv("Дата выезда:", String(order.execution.scheduled_at));
    }
    if (typeof order.trace_length_m === "number") {
      drawKv("Трасса (м):", String(order.trace_length_m));
    }

    y -= 10;
    draw("Перечень работ/позиций (из КП):", { bold: true, size: 12 });

    const lines = order.offer?.lines ?? [];
    const printable = lines.filter((l) => l.line_type !== "discount");

    if (printable.length === 0) {
      draw("— (КП не заполнено)", { size: 11 });
    } else {
      let idx = 1;
      for (const l of printable) {
        const price = typeof l.price === "number" ? l.price : 0;
        const total = price * (l.qty ?? 0);
        const row = `${idx}. ${l.name} — ${l.qty} ${l.unit}${price ? ` × ${price}` : ""}${price ? ` = ${total}` : ""}`;
        // naive wrapping
        const chunks = row.match(/.{1,90}/g) ?? [row];
        for (const ch of chunks) draw(ch, { size: 10 });
        idx++;
        // MVP: no page splitting; keep within first page.
      }
    }

    y -= 12;
    draw("Результат работ:", { bold: true, size: 12 });
    draw("Работы выполнены в полном объеме. Претензий по объему и качеству работ не имею.", { size: 10 });

    y -= 18;
    draw("Подписи:", { bold: true, size: 12 });
    draw("Исполнитель: ____________________    Клиент: ____________________", { size: 10 });

      const bytes = await pdf.save();
      await pushTimeline(id, "document.act.generated", { bytes: bytes.length });

      return new Response(bytes, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="act_${order.number}.pdf"`,
        },
      });
    } catch (e: any) {
      return c.text(`ACT_PDF_ERROR: ${e?.message || String(e)}`, 500);
    }
  });

  // ── Documents: Commercial offer (PDF) ──────────────────────────────────────
  // GET /orders/:id/offer/pdf
  app.get(`${P}/orders/:id/offer/pdf`, async (c: any) => {
    try {
      const id = c.req.param("id");
      const order = await getOrder(id);
      if (!order) return c.json({ error: "Order not found" }, 404);

      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);
      const fonts = await loadFonts();
      const page = pdf.addPage([595.28, 841.89]); // A4
      const font = await pdf.embedFont(fonts.r);
      const fontBold = await pdf.embedFont(fonts.b);

    const margin = 48;
    let y = 841.89 - margin;
    const lineH = 16;

    const draw = (text: string, opts?: { bold?: boolean; size?: number; color?: any }) => {
      const size = opts?.size ?? 12;
      const f = opts?.bold ? fontBold : font;
      page.drawText(text, { x: margin, y, size, font: f, color: opts?.color ?? rgb(0.1, 0.1, 0.1) });
      y -= lineH;
    };
    const drawKv = (k: string, v: string) => {
      page.drawText(k, { x: margin, y, size: 10, font: fontBold, color: rgb(0.35, 0.35, 0.35) });
      page.drawText(v, { x: margin + 160, y, size: 10, font, color: rgb(0.15, 0.15, 0.15) });
      y -= 14;
    };

    draw("КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ (черновик)", { bold: true, size: 16 });
    draw(`По ордеру: ${order.number}`, { bold: true, size: 12, color: rgb(0.05, 0.3, 0.6) });
    y -= 8;

    drawKv("Дата:", new Date().toLocaleDateString("ru-RU"));
    drawKv("Клиент:", order.client_name || "—");
    if (order.client_legal_name) drawKv("Юр. лицо:", order.client_legal_name);
    if (order.client_tax_id) drawKv("ИНН/ЕГРПОУ:", order.client_tax_id);
    drawKv("Телефон:", order.client_phone || "—");
    if (order.client_email) drawKv("Email:", order.client_email);
    drawKv("Адрес:", order.object_address || "—");

    y -= 10;
    draw("Состав предложения:", { bold: true, size: 12 });

    const lines = order.offer?.lines ?? [];
    const printable = lines.filter((l) => l.line_type !== "discount");

    let total = 0;
    if (printable.length === 0) {
      draw("— (КП не заполнено)", { size: 11 });
    } else {
      let idx = 1;
      for (const l of printable) {
        const price = typeof l.price === "number" ? l.price : 0;
        const qty = typeof l.qty === "number" ? l.qty : 0;
        const rowTotal = price * qty;
        total += rowTotal;
        const row = `${idx}. ${l.name} — ${qty} ${l.unit}${price ? ` × ${price}` : ""}${price ? ` = ${rowTotal}` : ""}`;
        const chunks = row.match(/.{1,90}/g) ?? [row];
        for (const ch of chunks) draw(ch, { size: 10 });
        idx++;
      }
    }

    y -= 12;
    draw(`Итого: ${Math.round(total * 100) / 100}`, { bold: true, size: 12 });

    y -= 12;
    draw("Примечание:", { bold: true, size: 11 });
    draw("Данное КП сформировано из данных ордера. Уточнения/дополнения ведутся в рамках ордера.", { size: 10 });

      const bytes = await pdf.save();
      await pushTimeline(id, "document.offer.generated", { bytes: bytes.length, version: order.offer?.version ?? 0 });

      return new Response(bytes, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="offer_${order.number}.pdf"`,
        },
      });
    } catch (e: any) {
      return c.text(`OFFER_PDF_ERROR: ${e?.message || String(e)}`, 500);
    }
  });

  // ── Documents: Builder render endpoint (PDF/DOC/HTML preview) ──────────────
  // POST /orders/:id/documents/render
  // body: { docType: "offer"|"contract"|"act", format: "pdf"|"doc"|"html", includeImages?, title?, date?, items?, workStages?, notes?, notesHtml?, bodyHtml?, company? }
  app.post(`${P}/orders/:id/documents/render`, async (c: any) => {
    try {
      const id = c.req.param("id");
      const order = await getOrder(id);
      if (!order) return c.json({ error: "Order not found" }, 404);

      const body = await c.req.json().catch(() => ({}));
      const docType = String(body?.docType ?? "offer");
      const format = String(body?.format ?? "pdf");
      const includeImages = Boolean(body?.includeImages);

      const title = String(
        body?.title ??
          (docType === "act"
            ? "АКТ ВЫПОЛНЕННЫХ РАБОТ"
            : docType === "contract"
              ? "ДОГОВОР НА ВЫПОЛНЕНИЕ РАБОТ"
              : "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ"),
      );
      const dateStr = String(body?.date ?? new Date().toLocaleDateString("ru-RU"));
      const notes = String(body?.notes ?? "");
      const notesHtml = String(body?.notesHtml ?? "");
      const bodyHtml = String(body?.bodyHtml ?? "");
      const company = body?.company ?? null;

      const itemsInput = Array.isArray(body?.items) ? body.items : null;
      const items = (itemsInput ?? (order.offer?.lines ?? []))
        .filter((l: any) => (l?.line_type ?? "") !== "discount")
        .map((l: any) => ({
          name: String(l?.name ?? ""),
          qty: Number(l?.qty ?? 0),
          unit: String(l?.unit ?? ""),
          price: Number(l?.price ?? 0),
          imageUrl: l?.imageUrl ? String(l.imageUrl) : "",
        }))
        .filter((i: any) => i.name);

      const workStages = Array.isArray(body?.workStages)
        ? body.workStages.map((s: any) => ({ title: String(s?.title ?? ""), amount: Number(s?.amount ?? 0) })).filter((s: any) => s.title)
        : [];

      const totalItems = items.reduce((s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
      const totalStages = workStages.reduce((s: number, st: any) => s + (Number(st.amount) || 0), 0);
      const total = Math.round((totalItems + totalStages) * 100) / 100;

      const escape = (s: string) =>
        s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

      const stripHtml = (s: string) =>
        String(s ?? "")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<\/p>/gi, "\n")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<li>/gi, "• ")
          .replace(/<\/li>/gi, "\n")
          .replace(/<\/h\d>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

      const htmlDoc = (() => {
        const rows = items
          .map((i: any, idx: number) => {
            const rowTotal = (Number(i.price) || 0) * (Number(i.qty) || 0);
            const img = includeImages ? String(i.imageUrl ?? "").trim() : "";
            return `<tr>
  <td style="border:1px solid #e5e7eb;padding:6px;">${idx + 1}</td>
  ${includeImages ? `<td style="border:1px solid #e5e7eb;padding:6px;">
    ${img ? `<img src="${escape(img)}" style="width:64px;height:48px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;" />` : `<span style="color:#94a3b8;font-size:11px;">—</span>`}
  </td>` : ""}
  <td style="border:1px solid #e5e7eb;padding:6px;">${escape(i.name)}</td>
  <td style="border:1px solid #e5e7eb;padding:6px;text-align:right;">${i.qty}</td>
  <td style="border:1px solid #e5e7eb;padding:6px;">${escape(i.unit)}</td>
  <td style="border:1px solid #e5e7eb;padding:6px;text-align:right;">${i.price}</td>
  <td style="border:1px solid #e5e7eb;padding:6px;text-align:right;">${Math.round(rowTotal * 100) / 100}</td>
</tr>`;
          })
          .join("");

        const stagesHtml = workStages.length
          ? `<h3 style="margin:16px 0 8px 0;font-size:13px;">Этапы работ</h3>
<table style="width:100%;border-collapse:collapse;font-size:12px;">
<thead><tr>
  <th style="border:1px solid #e5e7eb;padding:6px;text-align:left;">Этап</th>
  <th style="border:1px solid #e5e7eb;padding:6px;text-align:right;">Сумма</th>
</tr></thead>
<tbody>
${workStages
  .map((s: any) => `<tr><td style="border:1px solid #e5e7eb;padding:6px;">${escape(s.title)}</td><td style="border:1px solid #e5e7eb;padding:6px;text-align:right;">${Math.round((Number(s.amount) || 0) * 100) / 100}</td></tr>`)
  .join("")}
</tbody></table>`
          : "";

        const notesBlock = notesHtml
          ? `<div style="margin-top:16px;"><h3 style="margin:0 0 6px 0;font-size:13px;">Комментарий</h3><div style="font-size:12px;line-height:1.45;">${notesHtml}</div></div>`
          : (notes ? `<div style="margin-top:16px;"><h3 style="margin:0 0 6px 0;font-size:13px;">Комментарий</h3><div style="font-size:12px;line-height:1.45;white-space:pre-wrap;">${escape(notes)}</div></div>` : "");

        const companyBlock = (() => {
          if (!company) return "";
          const name = escape(String(company?.name ?? ""));
          const city = escape(String(company?.city ?? ""));
          const address = escape(String(company?.address ?? ""));
          const taxId = escape(String(company?.taxId ?? ""));
          const iban = escape(String(company?.iban ?? ""));
          const bank = escape(String(company?.bank ?? ""));
          const bic = escape(String(company?.bic ?? ""));
          const phone = escape(String(company?.phone ?? ""));
          const email = escape(String(company?.email ?? ""));
          return `<div style="font-size:11px;color:#334155;">
  ${name ? `<div style="font-weight:700;">${name}</div>` : ""}
  ${(city || address) ? `<div>${[city, address].filter(Boolean).join(", ")}</div>` : ""}
  ${taxId ? `<div>${taxId}</div>` : ""}
  ${iban ? `<div>${iban}</div>` : ""}
  ${bank ? `<div>${bank}${bic ? `, БИК ${bic}` : ""}</div>` : (bic ? `<div>БИК ${bic}</div>` : "")}
  ${phone ? `<div>Тел.: ${phone}</div>` : ""}
  ${email ? `<div>Email: ${email}</div>` : ""}
</div>`;
        })();

        const clientBlock = `<div style="margin-top:16px;font-size:12px;color:#334155;">
  <div><b>Клиент:</b> ${escape(order.client_name || "—")}</div>
  <div><b>Телефон:</b> ${escape(order.client_phone || "—")}</div>
  <div><b>Адрес объекта:</b> ${escape(order.object_address || "—")}</div>
  ${order.client_legal_name ? `<div><b>Юр. лицо:</b> ${escape(order.client_legal_name)}</div>` : ""}
  ${order.client_tax_id ? `<div><b>ИНН/ЕГРПОУ:</b> ${escape(order.client_tax_id)}</div>` : ""}
  ${order.client_email ? `<div><b>Email:</b> ${escape(order.client_email)}</div>` : ""}
  ${order.client_doc_basis ? `<div><b>Основание:</b> ${escape(order.client_doc_basis)}</div>` : ""}
</div>`;

        const windowSchemes = (() => {
          const list = Array.isArray(order.window_constructs) ? order.window_constructs : [];
          if (!list.length) return "";
          const renderSvg = (w: any) => {
            const width = 330;
            const height = 190;
            const pad = 22;
            const frameW = width - pad * 2;
            const frameH = height - pad * 2 - 18;
            const segments = Array.isArray(w?.segments) && w.segments.length ? w.segments : [{ opening: "fixed", widthRatio: 1 }];
            const total = segments.reduce((s: number, x: any) => s + Math.max(0.2, Number(x?.widthRatio) || 1), 0);
            let x = pad;
            const parts = segments.map((seg: any) => {
              const sw = frameW * (Math.max(0.2, Number(seg?.widthRatio) || 1) / total);
              const cx = x;
              x += sw;
              const opening = String(seg?.opening ?? "fixed");
              const marker = opening === "fixed"
                ? ""
                : opening === "sliding"
                  ? `<path d="M ${cx + 12} ${pad + frameH / 2} H ${cx + sw - 22} M ${cx + sw - 34} ${pad + frameH / 2 - 10} L ${cx + sw - 20} ${pad + frameH / 2} L ${cx + sw - 34} ${pad + frameH / 2 + 10}" fill="none" stroke="#2563eb" stroke-width="2"/>`
                  : `<path d="M ${cx + 8} ${pad + 8} L ${cx + sw - 8} ${pad + frameH / 2} L ${cx + 8} ${pad + frameH - 8}" fill="none" stroke="#2563eb" stroke-width="2"/>`;
              const handle = opening === "fixed" ? "" : `<rect x="${cx + sw - 12}" y="${pad + frameH / 2 - 12}" width="4" height="24" rx="2" fill="#0f172a"/>`;
              return `<rect x="${cx}" y="${pad}" width="${sw}" height="${frameH}" fill="#eff6ff" stroke="#0f172a" stroke-width="2"/>${marker}${handle}`;
            }).join("");
            return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${pad}" y="${pad}" width="${frameW}" height="${frameH}" fill="none" stroke="#0f172a" stroke-width="4"/>
  ${parts}
  <text x="${width / 2}" y="${height - 18}" text-anchor="middle" font-family="Arial" font-size="12" fill="#0f172a">${escape(String(w?.widthMm ?? ""))} x ${escape(String(w?.heightMm ?? ""))} мм</text>
</svg>`;
          };
          return `<h3 style="margin:18px 0 8px 0;font-size:13px;">Схемы конструкций</h3>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
${list.map((w: any, idx: number) => `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;break-inside:avoid;">
  <div style="font-size:12px;font-weight:700;margin-bottom:6px;">${idx + 1}. ${escape(String(w?.title ?? "Конструкция"))}</div>
  ${renderSvg(w)}
  <div style="font-size:11px;color:#475569;margin-top:6px;">${escape(String(w?.profileSystem ?? ""))}${w?.glassUnit ? ` · ${escape(String(w.glassUnit))}` : ""}${w?.hardwareType ? ` · ${escape(String(w.hardwareType))}` : ""}</div>
</div>`).join("")}
</div>`;
        })();

        const itemsTable = `<h3 style="margin:18px 0 8px 0;font-size:13px;">${docType === "act" ? "Перечень работ/позиций" : "Состав предложения"}</h3>
  <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead>
      <tr>
        <th style="border:1px solid #e5e7eb;padding:6px;text-align:left;width:36px;">№</th>
        ${includeImages ? `<th style="border:1px solid #e5e7eb;padding:6px;text-align:left;width:72px;">Фото</th>` : ""}
        <th style="border:1px solid #e5e7eb;padding:6px;text-align:left;">Позиция</th>
        <th style="border:1px solid #e5e7eb;padding:6px;text-align:right;width:60px;">Кол-во</th>
        <th style="border:1px solid #e5e7eb;padding:6px;text-align:left;width:60px;">Ед.</th>
        <th style="border:1px solid #e5e7eb;padding:6px;text-align:right;width:80px;">Цена</th>
        <th style="border:1px solid #e5e7eb;padding:6px;text-align:right;width:90px;">Сумма</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="${includeImages ? 7 : 6}" style="border:1px solid #e5e7eb;padding:10px;color:#64748b;">— (нет позиций)</td></tr>`}
    </tbody>
  </table>`;

        const totalsBlock = `<div style="margin-top:14px;display:flex;justify-content:flex-end;">
  <div style="min-width:260px;border:1px solid #e5e7eb;border-radius:10px;padding:10px;background:#f8fafc;">
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
      <span style="color:#64748b;">Позиции</span><b>${Math.round(totalItems * 100) / 100}</b>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
      <span style="color:#64748b;">Этапы</span><b>${Math.round(totalStages * 100) / 100}</b>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;">
      <span style="color:#0f172a;"><b>Итого</b></span><span style="color:#0f172a;"><b>${total}</b></span>
    </div>
  </div>
</div>`;

        const bodySrc =
          bodyHtml?.trim()
            ? bodyHtml
            : `<h1 style="margin:0;font-size:18px;letter-spacing:0.2px;">${escape(title)}</h1>
<div style="margin-top:6px;font-size:12px;color:#475569;">№ {{ORDER_NUMBER}} · от {{DOC_DATE}}</div>
{{COMPANY_BLOCK}}
{{CLIENT_BLOCK}}
{{WINDOW_SCHEMES}}
{{ITEMS_TABLE}}
{{WORK_STAGES}}
{{TOTALS}}
{{NOTES}}`;

        const bodyRendered = String(bodySrc)
          .replaceAll("{{ORDER_NUMBER}}", escape(order.number))
          .replaceAll("{{DOC_DATE}}", escape(dateStr))
          .replaceAll("{{COMPANY_BLOCK}}", companyBlock)
          .replaceAll("{{CLIENT_BLOCK}}", clientBlock)
          .replaceAll("{{WINDOW_SCHEMES}}", windowSchemes)
          .replaceAll("{{ITEMS_TABLE}}", itemsTable)
          .replaceAll("{{WORK_STAGES}}", stagesHtml || "")
          .replaceAll("{{TOTALS}}", totalsBlock)
          .replaceAll("{{NOTES}}", notesBlock || "");

        return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(title)}</title></head>
<body style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
<div style="max-width:794px;margin:0 auto;padding:32px;">
  ${bodyRendered}
</div>
</body></html>`;
      })();

      if (format === "html") {
        await pushTimeline(id, "document.rendered", { docType, format: "html", bytes: htmlDoc.length });
        return new Response(new TextEncoder().encode(htmlDoc), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // DOC (simple HTML .doc)
      if (format === "doc") {
        await pushTimeline(id, "document.rendered", { docType, format: "doc", bytes: htmlDoc.length });
        return new Response(new TextEncoder().encode(htmlDoc), {
          headers: {
            "Content-Type": "application/msword; charset=utf-8",
            "Content-Disposition": `attachment; filename="${docType}_${order.number}.doc"`,
          },
        });
      }

      // PDF: reuse lightweight implementation
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);
      const fonts = await loadFonts();
      const page = pdf.addPage([595.28, 841.89]);
      const font = await pdf.embedFont(fonts.r);
      const fontBold = await pdf.embedFont(fonts.b);
      const margin = 48;
      let y = 841.89 - margin;
      const lineH = 16;
      const draw = (text: string, opts?: { bold?: boolean; size?: number; color?: any }) => {
        const size = opts?.size ?? 12;
        const f = opts?.bold ? fontBold : font;
        page.drawText(text, { x: margin, y, size, font: f, color: opts?.color ?? rgb(0.1, 0.1, 0.1) });
        y -= lineH;
      };
      const drawKv = (k: string, v: string) => {
        page.drawText(k, { x: margin, y, size: 10, font: fontBold, color: rgb(0.35, 0.35, 0.35) });
        page.drawText(v, { x: margin + 160, y, size: 10, font, color: rgb(0.15, 0.15, 0.15) });
        y -= 14;
      };

      draw(`${title} (черновик)`, { bold: true, size: 16 });
      draw(`По ордеру: ${order.number}`, { bold: true, size: 12, color: rgb(0.05, 0.3, 0.6) });
      y -= 8;

      drawKv("Дата:", dateStr);
      drawKv("Клиент:", order.client_name || "—");
      if (order.client_legal_name) drawKv("Юр. лицо:", order.client_legal_name);
      if (order.client_tax_id) drawKv("ИНН/ЕГРПОУ:", order.client_tax_id);
      drawKv("Телефон:", order.client_phone || "—");
      if (order.client_email) drawKv("Email:", order.client_email);
      drawKv("Адрес:", order.object_address || "—");
      if (order.client_doc_basis) drawKv("Основание:", order.client_doc_basis);

      if (hasWindowConstructs(order)) {
        y -= 10;
        draw("Оконные конструкции:", { bold: true, size: 12 });
        for (const [i, w] of (order.window_constructs ?? []).entries()) {
          const title = String(w.title ?? `Конструкция ${i + 1}`);
          const dims = `${Number(w.widthMm) || 0}x${Number(w.heightMm) || 0} мм`;
          const meta = [w.profileSystem, w.glassUnit, w.hardwareType].filter(Boolean).join(", ");
          draw(`${i + 1}. ${title} — ${dims}${meta ? `, ${meta}` : ""}`, { size: 10 });
        }
      }

      y -= 10;
      draw(docType === "act" ? "Перечень работ/позиций:" : "Состав предложения:", { bold: true, size: 12 });

      let idx = 1;
      for (const it of items) {
        const rowTotal = (Number(it.price) || 0) * (Number(it.qty) || 0);
        const row = `${idx}. ${it.name} — ${it.qty} ${it.unit}${it.price ? ` × ${it.price}` : ""}${it.price ? ` = ${rowTotal}` : ""}`;
        const chunks = row.match(/.{1,90}/g) ?? [row];
        for (const ch of chunks) draw(ch, { size: 10 });
        idx++;
      }
      if (items.length === 0) draw("— (нет позиций)", { size: 11 });

      if (workStages.length) {
        y -= 10;
        draw("Этапы работ:", { bold: true, size: 12 });
        for (const st of workStages) draw(`- ${st.title} — ${st.amount}`, { size: 10 });
      }

      y -= 12;
      draw(`Итого: ${total}`, { bold: true, size: 12 });
      if (notes) {
        y -= 8;
        draw("Примечание:", { bold: true, size: 11 });
        for (const ch of notes.match(/.{1,90}/g) ?? [notes]) draw(ch, { size: 10 });
      }

      const bodyText = stripHtml(bodyHtml || "");
      if (bodyText) {
        y -= 10;
        draw("Текст документа:", { bold: true, size: 11 });
        for (const ch of bodyText.match(/.{1,90}/g) ?? [bodyText]) {
          if (y < 72) break;
          draw(ch, { size: 9 });
        }
      }

      y -= 18;
      draw("Подписи:", { bold: true, size: 12 });
      draw("Исполнитель: ____________________    Клиент: ____________________", { size: 10 });

      const bytes = await pdf.save();
      await pushTimeline(id, "document.rendered", { docType, format: "pdf", bytes: bytes.length });
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${docType}_${order.number}.pdf"`,
        },
      });
    } catch (e: any) {
      return c.text(`DOC_RENDER_ERROR: ${e?.message || String(e)}`, 500);
    }
  });

  // ── Execution workflow (installer-friendly) ────────────────────────────────
  // POST /orders/:id/execution/schedule
  // body: { installerId, installerName, scheduledAt }
  app.post(`${P}/orders/:id/execution/schedule`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);
    const body = await c.req.json().catch(() => ({}));

    const installerId = String(body?.installerId ?? "").trim();
    const installerName = String(body?.installerName ?? "").trim();
    const scheduledAt = String(body?.scheduledAt ?? "").trim();

    if (!installerId || !scheduledAt) return c.json({ error: "installerId and scheduledAt required" }, 400);

    // Allow scheduling only when supply is ready (or already scheduled)
    if (!(order.status === "ready_to_schedule" || order.status === "scheduled")) {
      return c.json({ error: `Order must be ready_to_schedule to schedule (current: ${order.status})` }, 400);
    }

    // Ensure there is no supply deficit (if materials exist)
    const mats = await getMaterialLines(id);
    const hasDeficit = mats.some((m) => (m.to_purchase_qty ?? 0) > 0);
    if (hasDeficit) {
      return c.json({ error: "Cannot schedule while awaiting supply", code: "AWAITING_SUPPLY" }, 400);
    }

    order.execution = {
      ...(order.execution ?? {}),
      status: "scheduled",
      scheduled_at: scheduledAt,
      assigned_installer_id: installerId,
      assigned_installer_name: installerName || order.execution?.assigned_installer_name,
    };
    order.status = "scheduled";
    await saveOrder(order);
    await pushTimeline(id, "execution.scheduled", {
      scheduled_at: scheduledAt,
      assigned_installer_id: installerId,
      assigned_installer_name: installerName,
    });
    const timeline = await getTimeline(id);
    return c.json({ order, timeline });
  });

  // POST /orders/:id/execution/start
  app.post(`${P}/orders/:id/execution/start`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);
    if (order.status !== "scheduled") {
      return c.json({ error: `Order must be scheduled to start execution (current: ${order.status})` }, 400);
    }
    order.execution = { ...(order.execution ?? {}), status: "in_progress", started_at: now() };
    order.status = "in_progress";
    await saveOrder(order);
    await pushTimeline(id, "execution.started", { started_at: order.execution.started_at });
    const timeline = await getTimeline(id);
    return c.json({ order, timeline });
  });

  // POST /orders/:id/execution/complete
  // body: { completion_notes?, client_sign_name?, client_signed? }
  app.post(`${P}/orders/:id/execution/complete`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);
    if (order.status !== "in_progress") {
      return c.json({ error: `Order must be in_progress to complete execution (current: ${order.status})` }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    order.execution = {
      ...(order.execution ?? {}),
      status: "done",
      completed_at: now(),
      completion_notes: body?.completion_notes ? String(body.completion_notes) : order.execution?.completion_notes,
      client_signed: Boolean(body?.client_signed ?? order.execution?.client_signed),
      client_sign_name: body?.client_sign_name ? String(body.client_sign_name) : order.execution?.client_sign_name,
      client_signed_at: Boolean(body?.client_signed) ? now() : order.execution?.client_signed_at,
    };
    order.status = "completed";
    await saveOrder(order);
    await pushTimeline(id, "execution.completed", {
      completed_at: order.execution.completed_at,
      client_signed: order.execution.client_signed ?? false,
    });
    const timeline = await getTimeline(id);
    return c.json({ order, timeline });
  });

  // POST /orders/:id/close
  // Close the order after execution is completed.
  app.post(`${P}/orders/:id/close`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);

    if (order.status === "closed") {
      const timeline = await getTimeline(id);
      return c.json({ order, timeline, idempotent: true });
    }

    if (order.status !== "completed") {
      return c.json({ error: `Order must be completed to close (current: ${order.status})` }, 400);
    }

    order.status = "closed";
    order.closed_at = now();
    await saveOrder(order);
    await pushTimeline(id, "order.closed", { closed_at: order.closed_at });
    const timeline = await getTimeline(id);
    return c.json({ order, timeline });
  });

  // POST /orders/:id/execution/depart
  // Marks that installers are packed and departed to site.
  app.post(`${P}/orders/:id/execution/depart`, async (c: any) => {
    const id = c.req.param("id");
    const order = await getOrder(id);
    if (!order) return c.json({ error: "Order not found" }, 404);
    if (order.status !== "scheduled") {
      return c.json({ error: `Order must be scheduled to depart (current: ${order.status})` }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    order.execution = {
      ...(order.execution ?? {}),
      prep_status: "departed",
      checklist: {
        ...(order.execution?.checklist ?? {}),
        ready_confirmed: true,
        updated_at: now(),
      },
    };
    // Keep status as scheduled; execution status should remain scheduled until start.
    await saveOrder(order);
    await pushTimeline(id, "execution.departed", { at: now(), note: body?.note ?? "" });
    const timeline = await getTimeline(id);
    return c.json({ order, timeline });
  });

  // ── Materials actual usage (plan vs fact) ──────────────────────────────────
  // POST /orders/:id/materials/usage
  // body: { lines: [{ materialId, used_qty, writeoff_qty }] }
  app.post(`${P}/orders/:id/materials/usage`, async (c: any) => {
    const orderId = c.req.param("id");
    const order = await getOrder(orderId);
    if (!order) return c.json({ error: "Order not found" }, 404);
    const body = await c.req.json();
    const updates = Array.isArray(body?.lines) ? body.lines : [];
    const mats = await getMaterialLines(orderId);
    const byId = new Map(mats.map((m) => [m.id, m]));

    for (const u of updates) {
      const id = String(u.materialId ?? "");
      if (!id) continue;
      const m = byId.get(id);
      if (!m) continue;
      const used = Math.max(0, Number(u.used_qty ?? 0));
      const writeoff = Math.max(0, Number(u.writeoff_qty ?? 0));
      m.used_qty = used;
      m.writeoff_qty = writeoff;
      m.status = "used";
      await updateMaterialLine(m);
    }

    await pushTimeline(orderId, "materials.actual_saved", { lines: updates.length });
    const materials = await getMaterialLines(orderId);
    const timeline = await getTimeline(orderId);
    return c.json({ materials, timeline });
  });
}
