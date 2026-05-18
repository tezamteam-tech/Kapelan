// Warehouse module (Postgres-backed).
// Exports route registration + helpers used by other modules.

import { createClient } from "npm:@supabase/supabase-js";

export interface WarehouseItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: number; // sell price (legacy field name used by UI/KP)
  // Extended pricing model
  priceNoVat?: number; // selling price without VAT
  priceWithVat?: number; // selling price with VAT 20%
  buyPrice?: number; // purchase price (входная)
  buyPricePeriod?: string; // e.g. "2026-03" or "март 2026"
  sku: string;
  supplier?: string; // legacy: best supplier name (optional)
  availability?: "in_stock_supplier" | "order_only";
  notes?: string;
  imageUrl?: string;
  itemType?: "consumable" | "assembly" | "equipment";
  assemblyComponents?: { warehouseId: string; name: string; qty: number; unit: string }[];
  acSpecs?: Record<string, any>; // optional legacy (used by AI tools); persisted later
  updatedAt: string;
  createdAt: string;
}

export interface StockMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: "in" | "out" | "adjustment";
  qty: number;
  stockBefore: number;
  stockAfter: number;
  reason: string;
  referenceId?: string;
  note?: string;
  createdAt: string;
}

export interface PurchaseOrder {
  // Legacy flat PO line shape used by current UI
  id: string;
  itemId: string;
  itemName: string;
  itemUnit: string;
  qtyOrdered: number;
  qtyReceived: number;
  pricePerUnit: number;
  totalCost: number;
  supplier: string;
  status: "pending" | "ordered" | "received" | "cancelled";
  reason: "low_stock" | "manual";
  note?: string;
  createdAt: string;
  updatedAt: string;
}

type Db = ReturnType<typeof createClient>;

function db(): Db {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

const AVAIL_TAG_RE = /\[\[availability:(in_stock_supplier|order_only)\]\]/i;
const SELL_NO_VAT_TAG_RE = /\[\[sell_no_vat:([0-9.,\s]+)\]\]/i;
const SELL_WITH_VAT_TAG_RE = /\[\[sell_with_vat:([0-9.,\s]+)\]\]/i;
const BUY_PRICE_TAG_RE = /\[\[buy_price:([0-9.,\s]+)\]\]/i;
const BUY_PERIOD_TAG_RE = /\[\[buy_period:([^\]]+)\]\]/i;
function parseTagNum(notes: any, re: RegExp): number | undefined {
  const s = String(notes ?? "");
  const m = s.match(re);
  if (!m) return undefined;
  const n = Number(String(m[1] ?? "").replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}
function parseBuyPeriodFromNotes(notes: any): string | undefined {
  const s = String(notes ?? "");
  const m = s.match(BUY_PERIOD_TAG_RE);
  const v = String(m?.[1] ?? "").trim();
  return v || undefined;
}
function parseAvailabilityFromNotes(notes: any): "in_stock_supplier" | "order_only" | undefined {
  const s = String(notes ?? "");
  const m = s.match(AVAIL_TAG_RE);
  if (!m) return undefined;
  return m[1] === "in_stock_supplier" ? "in_stock_supplier" : "order_only";
}
function stripAvailabilityTag(notes: any): string {
  return String(notes ?? "")
    .replace(AVAIL_TAG_RE, "")
    .replace(SELL_NO_VAT_TAG_RE, "")
    .replace(SELL_WITH_VAT_TAG_RE, "")
    .replace(BUY_PRICE_TAG_RE, "")
    .replace(BUY_PERIOD_TAG_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function mergeNotesWithMeta(notes: any, meta: {
  availability?: string;
  priceNoVat?: number;
  priceWithVat?: number;
  buyPrice?: number;
  buyPricePeriod?: string;
}): string | null {
  const base = stripAvailabilityTag(notes);
  const av = meta.availability === "in_stock_supplier" ? "in_stock_supplier" : meta.availability === "order_only" ? "order_only" : "";
  const tags: string[] = [];
  if (av) tags.push(`[[availability:${av}]]`);
  if (Number.isFinite(Number(meta.priceNoVat))) tags.push(`[[sell_no_vat:${Number(meta.priceNoVat).toFixed(2)}]]`);
  if (Number.isFinite(Number(meta.priceWithVat))) tags.push(`[[sell_with_vat:${Number(meta.priceWithVat).toFixed(2)}]]`);
  if (Number.isFinite(Number(meta.buyPrice))) tags.push(`[[buy_price:${Number(meta.buyPrice).toFixed(2)}]]`);
  if (String(meta.buyPricePeriod ?? "").trim()) tags.push(`[[buy_period:${String(meta.buyPricePeriod).trim()}]]`);
  const merged = [base, ...tags].filter(Boolean).join("\n");
  return merged || null;
}

function toWarehouseItem(row: any): WarehouseItem {
  const availability = parseAvailabilityFromNotes(row.notes);
  const taggedNoVat = parseTagNum(row.notes, SELL_NO_VAT_TAG_RE);
  const taggedWithVat = parseTagNum(row.notes, SELL_WITH_VAT_TAG_RE);
  const fallbackWithVat = Number(row.sell_price ?? 0);
  const priceWithVat = taggedWithVat ?? fallbackWithVat;
  const priceNoVat = taggedNoVat ?? (priceWithVat > 0 ? Math.round((priceWithVat / 1.2) * 100) / 100 : 0);
  const buyPrice = parseTagNum(row.notes, BUY_PRICE_TAG_RE);
  const buyPricePeriod = parseBuyPeriodFromNotes(row.notes);
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    category: String(row.category ?? "Прочее"),
    unit: String(row.unit ?? "шт"),
    stock: Number(row.on_hand_qty ?? 0),
    minStock: Number(row.min_stock ?? 0),
    price: priceWithVat,
    priceNoVat,
    priceWithVat,
    sku: String(row.sku ?? ""),
    supplier: row.best_supplier_name ?? undefined,
    availability: availability ?? "in_stock_supplier",
    buyPrice: buyPrice,
    buyPricePeriod,
    notes: stripAvailabilityTag(row.notes) || undefined,
    imageUrl: row.image_url ?? undefined,
    itemType: (row.item_type ?? "consumable"),
    assemblyComponents: row.assembly_components ?? [],
    acSpecs: row.ac_specs ?? undefined,
    updatedAt: row.updated_at ?? new Date().toISOString(),
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

async function upsertStock(itemId: string, onHandQty: number) {
  const supabase = db();
  const { error } = await supabase
    .from("warehouse_stock")
    .upsert({ warehouse_item_id: itemId, on_hand_qty: onHandQty }, { onConflict: "warehouse_item_id" });
  if (error) throw new Error(error.message);
}

export async function getAllWarehouseItems(): Promise<WarehouseItem[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("warehouse_items")
    .select(`
      id,name,category,unit,sku,item_type,min_stock,sell_price,notes,image_url,created_at,updated_at,
      warehouse_stock(on_hand_qty)
    `)
    .eq("is_active", true);
  if (error) {
    console.error("getAllWarehouseItems:", error);
    return [];
  }
  const items = (data ?? []).map((r: any) => toWarehouseItem({
    ...r,
    on_hand_qty: r.warehouse_stock?.on_hand_qty ?? 0,
  }));
  await attachBestSupplierPricing(items);
  items.sort((a, b) => a.category.localeCompare(b.category, "ru") || a.name.localeCompare(b.name, "ru"));
  return items;
}

export async function getWarehouseItem(id: string): Promise<WarehouseItem | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("warehouse_items")
    .select(`
      id,name,category,unit,sku,item_type,min_stock,sell_price,notes,image_url,created_at,updated_at,
      warehouse_stock(on_hand_qty)
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const item = toWarehouseItem({ ...data, on_hand_qty: data.warehouse_stock?.on_hand_qty ?? 0 });
  await attachBestSupplierPricing([item]);
  return item;
}

async function attachBestSupplierPricing(items: WarehouseItem[]) {
  const ids = items.map((i) => i.id).filter(Boolean);
  if (ids.length === 0) return;

  const supabase = db();
  const { data, error } = await supabase
    .from("catalog_links")
    .select("warehouse_item_id,is_primary,priority,supplier_items(buy_price,suppliers(name))")
    .in("warehouse_item_id", ids);
  if (error) {
    // Do not fail warehouse view if links not set yet
    return;
  }

  const byWh: Record<string, any[]> = {};
  for (const r of (data ?? []) as any[]) {
    const whId = String(r.warehouse_item_id ?? "");
    if (!whId) continue;
    (byWh[whId] ??= []).push(r);
  }

  for (const it of items) {
    const links = byWh[it.id] ?? [];
    if (links.length === 0) continue;
    links.sort((a: any, b: any) =>
      (b.is_primary ? 0 : 1) - (a.is_primary ? 0 : 1) ||
      Number(a.priority ?? 100) - Number(b.priority ?? 100) ||
      Number(a.supplier_items?.buy_price ?? 0) - Number(b.supplier_items?.buy_price ?? 0),
    );
    const best = links[0];
    const buy = best?.supplier_items?.buy_price;
    const name = best?.supplier_items?.suppliers?.name;
    if (buy !== undefined && buy !== null) it.buyPrice = Number(buy);
    if (name) it.supplier = String(name);
  }
}

async function addMovementInternal(mov: Omit<StockMovement, "id" | "createdAt">) {
  const supabase = db();
  const { data, error } = await supabase
    .from("inventory_movements")
    .insert({
      warehouse_item_id: mov.itemId,
      direction: mov.type === "adjustment" ? "adjust" : mov.type,
      qty: mov.qty,
      reason: mov.reason,
      reference_type: mov.referenceId ? "legacy" : null,
      reference_id: null,
      note: mov.note ?? null,
    })
    .select("id,created_at")
    .single();
  if (error) throw new Error(error.message);
  return {
    ...mov,
    id: String(data.id),
    createdAt: String(data.created_at),
  } satisfies StockMovement;
}

// Exported for compatibility with order_core.tsx (server-side reserves/writeoffs).
export async function saveWarehouseItem(item: WarehouseItem): Promise<void> {
  const supabase = db();
  // Update catalog fields (best-effort) and stock
  const { error } = await supabase
    .from("warehouse_items")
    .update({
      name: item.name,
      category: item.category,
      unit: item.unit,
      sku: item.sku || null,
      item_type: item.itemType || "consumable",
      min_stock: Number(item.minStock ?? 0),
      sell_price: Number(item.priceWithVat ?? item.price ?? 0),
      notes: mergeNotesWithMeta(item.notes, {
        availability: item.availability,
        priceNoVat: item.priceNoVat ?? ((item.priceWithVat ?? item.price) ? Number(item.priceWithVat ?? item.price) / 1.2 : undefined),
        priceWithVat: item.priceWithVat ?? item.price,
        buyPrice: item.buyPrice,
        buyPricePeriod: item.buyPricePeriod,
      }),
      image_url: item.imageUrl ?? null,
    })
    .eq("id", item.id);
  if (error) throw new Error(error.message);
  await upsertStock(item.id, Number(item.stock ?? 0));
}

export async function addMovement(mov: Omit<StockMovement, "id" | "createdAt">): Promise<StockMovement> {
  return await addMovementInternal(mov);
}

async function createLowStockPurchaseRequest(item: WarehouseItem): Promise<PurchaseOrder | null> {
  if (item.stock >= item.minStock) return null;

  const deficit = item.minStock - item.stock;
  const qtyNeeded = Math.ceil(deficit * 1.5);
  const supabase = db();

  const { data: pr, error: prErr } = await supabase
    .from("purchase_requests")
    .insert({
      status: "pending",
      reason: "low_stock",
      note: `Автозаявка: остаток ${item.stock} ${item.unit} < мин. ${item.minStock} ${item.unit}`,
    })
    .select("id,created_at,updated_at,note")
    .single();
  if (prErr) throw new Error(prErr.message);

  const { data: line, error: lineErr } = await supabase
    .from("purchase_request_lines")
    .insert({
      purchase_request_id: pr.id,
      warehouse_item_id: item.id,
      qty: qtyNeeded,
      unit: item.unit,
      sell_price: item.price,
    })
    .select("id")
    .single();
  if (lineErr) throw new Error(lineErr.message);

  return {
    id: String(line.id),
    itemId: item.id,
    itemName: item.name,
    itemUnit: item.unit,
    qtyOrdered: qtyNeeded,
    qtyReceived: 0,
    pricePerUnit: item.price,
    totalCost: qtyNeeded * item.price,
    supplier: item.supplier || "—",
    status: "pending",
    reason: "low_stock",
    note: pr.note ?? undefined,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
  };
}

// ── Route registration ───────────────────────────────────────────────────────
export function registerWarehouseRoutes(app: any): void {
  const P = "/make-server-1df47c03";

  app.get(`${P}/warehouse`, async (c: any) => {
    try {
      const items = await getAllWarehouseItems();
      const lowStockCount = items.filter((i) => i.stock < i.minStock).length;
      const totalValue = items.reduce((s, i) => s + i.stock * i.price, 0);
      return c.json({ items, lowStockCount, totalValue });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch warehouse: ${error.message}` }, 500);
    }
  });

  // reseed disabled on prod
  app.post(`${P}/warehouse/reseed`, (c: any) => c.json({ error: "reseed disabled on prod" }, 410));

  app.post(`${P}/warehouse`, async (c: any) => {
    try {
      const body = await c.req.json();
      const supabase = db();
      const { data, error } = await supabase
        .from("warehouse_items")
        .insert({
          name: body.name || "Новая позиция",
          category: body.category || "Прочее",
          unit: body.unit || "шт",
          sku: body.sku || null,
          item_type: body.itemType || "consumable",
          min_stock: Number(body.minStock ?? 0),
          sell_price: Number(body.priceWithVat ?? body.price ?? 0),
          notes: mergeNotesWithMeta(body.notes, {
            availability: body.availability,
            priceNoVat: body.priceNoVat ?? ((body.priceWithVat ?? body.price) ? Number(body.priceWithVat ?? body.price) / 1.2 : undefined),
            priceWithVat: body.priceWithVat ?? body.price,
            buyPrice: body.buyPrice,
            buyPricePeriod: body.buyPricePeriod,
          }),
          image_url: body.imageUrl || null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await upsertStock(String(data.id), Number(body.stock ?? 0));
      const item = await getWarehouseItem(String(data.id));
      if (!item) throw new Error("Item not found after insert");
      const purchaseOrder = await createLowStockPurchaseRequest(item);
      return c.json({ item, purchaseOrder });
    } catch (error: any) {
      return c.json({ error: `Failed to create item: ${error.message}` }, 500);
    }
  });

  app.patch(`${P}/warehouse/:id`, async (c: any) => {
    try {
      const id = c.req.param("id");
      const existing = await getWarehouseItem(id);
      if (!existing) return c.json({ error: "Item not found" }, 404);
      const body = await c.req.json();

      const patch: any = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.category !== undefined) patch.category = body.category;
      if (body.unit !== undefined) patch.unit = body.unit;
      if (body.minStock !== undefined) patch.min_stock = Number(body.minStock);
      if (body.priceWithVat !== undefined || body.price !== undefined) patch.sell_price = Number(body.priceWithVat ?? body.price);
      if (body.sku !== undefined) patch.sku = body.sku || null;
      if (
        body.notes !== undefined ||
        body.availability !== undefined ||
        body.priceNoVat !== undefined ||
        body.priceWithVat !== undefined ||
        body.price !== undefined ||
        body.buyPrice !== undefined ||
        body.buyPricePeriod !== undefined
      ) {
        patch.notes = mergeNotesWithMeta(body.notes ?? existing.notes, {
          availability: body.availability ?? existing.availability,
          priceNoVat:
            body.priceNoVat ??
            existing.priceNoVat ??
            ((body.priceWithVat ?? body.price ?? existing.priceWithVat ?? existing.price)
              ? Number(body.priceWithVat ?? body.price ?? existing.priceWithVat ?? existing.price) / 1.2
              : undefined),
          priceWithVat: body.priceWithVat ?? body.price ?? existing.priceWithVat ?? existing.price,
          buyPrice: body.buyPrice ?? existing.buyPrice,
          buyPricePeriod: body.buyPricePeriod ?? existing.buyPricePeriod,
        });
      }
      if (body.imageUrl !== undefined) patch.image_url = body.imageUrl || null;
      if (body.itemType !== undefined) patch.item_type = body.itemType;

      const supabase = db();
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("warehouse_items").update(patch).eq("id", id);
        if (error) throw new Error(error.message);
      }
      if (body.stock !== undefined) await upsertStock(id, Number(body.stock ?? existing.stock));

      const fresh = await getWarehouseItem(id);
      if (!fresh) throw new Error("Item not found after update");
      const purchaseOrder = await createLowStockPurchaseRequest(fresh);
      return c.json({ item: fresh, purchaseOrder });
    } catch (error: any) {
      return c.json({ error: `Failed to update item: ${error.message}` }, 500);
    }
  });

  app.delete(`${P}/warehouse/:id`, async (c: any) => {
    try {
      const supabase = db();
      const { error } = await supabase.from("warehouse_items").delete().eq("id", c.req.param("id"));
      if (error) throw new Error(error.message);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: `Failed to delete: ${error.message}` }, 500);
    }
  });

  app.post(`${P}/warehouse/:id/stock-in`, async (c: any) => {
    try {
      const item = await getWarehouseItem(c.req.param("id"));
      if (!item) return c.json({ error: "Item not found" }, 404);
      const { qty, reason = "purchase", note, referenceId } = await c.req.json();
      const qtyNum = Number(qty);
      if (!qtyNum || qtyNum <= 0) return c.json({ error: "qty must be positive" }, 400);
      const stockBefore = item.stock;
      const stockAfter = stockBefore + qtyNum;

      await upsertStock(item.id, stockAfter);
      const movement = await addMovement({
        itemId: item.id,
        itemName: item.name,
        type: "in",
        qty: qtyNum,
        stockBefore,
        stockAfter,
        reason,
        referenceId,
        note,
      });
      const fresh = await getWarehouseItem(item.id);
      return c.json({ item: fresh, movement, purchaseOrder: null });
    } catch (error: any) {
      return c.json({ error: `Failed to stock-in: ${error.message}` }, 500);
    }
  });

  app.post(`${P}/warehouse/:id/stock-out`, async (c: any) => {
    try {
      const item = await getWarehouseItem(c.req.param("id"));
      if (!item) return c.json({ error: "Item not found" }, 404);
      const { qty, reason = "installation", note, referenceId } = await c.req.json();
      const qtyNum = Number(qty);
      if (!qtyNum || qtyNum <= 0) return c.json({ error: "qty must be positive" }, 400);
      if (item.stock < qtyNum) return c.json({ error: `Недостаточно: есть ${item.stock} ${item.unit}, нужно ${qtyNum}` }, 400);
      const stockBefore = item.stock;
      const stockAfter = stockBefore - qtyNum;

      await upsertStock(item.id, stockAfter);
      const movement = await addMovement({
        itemId: item.id,
        itemName: item.name,
        type: "out",
        qty: qtyNum,
        stockBefore,
        stockAfter,
        reason,
        referenceId,
        note,
      });
      const fresh = await getWarehouseItem(item.id);
      if (!fresh) throw new Error("Item not found after stock-out");
      const purchaseOrder = await createLowStockPurchaseRequest(fresh);
      return c.json({ item: fresh, movement, purchaseOrder, lowStockAlert: purchaseOrder !== null });
    } catch (error: any) {
      return c.json({ error: `Failed to stock-out: ${error.message}` }, 500);
    }
  });

  // Legacy bulk writeoff used by installer flows
  app.post(`${P}/warehouse/writeoff-installation`, async (c: any) => {
    try {
      const { leadId, installationId, items: writeItems } = await c.req.json();
      if (!Array.isArray(writeItems) || writeItems.length === 0) return c.json({ error: "items array required" }, 400);

      const results: any[] = [];
      const errors: string[] = [];
      const newPOs: PurchaseOrder[] = [];
      const allItems = await getAllWarehouseItems();

      for (const wi of writeItems) {
        const qty = Number(wi.qty);
        if (!qty || qty <= 0) continue;
        let item: WarehouseItem | null = null;
        if (wi.itemId) item = await getWarehouseItem(wi.itemId);
        else if (wi.sku) item = allItems.find((i) => i.sku === wi.sku) ?? null;
        else if (wi.name) item = allItems.find((i) => i.name.toLowerCase().includes(String(wi.name).toLowerCase())) ?? null;

        if (!item) {
          errors.push(`Не найдено: ${wi.itemId ?? wi.sku ?? wi.name}`);
          continue;
        }
        if (item.stock < qty) {
          errors.push(`Мало "${item.name}": есть ${item.stock}, нужно ${qty}`);
          continue;
        }

        const stockBefore = item.stock;
        const stockAfter = stockBefore - qty;
        await upsertStock(item.id, stockAfter);
        const movement = await addMovement({
          itemId: item.id,
          itemName: item.name,
          type: "out",
          qty,
          stockBefore,
          stockAfter,
          reason: "installation",
          referenceId: leadId ?? installationId,
          note: `Списание по монтажу${leadId ? " #" + String(leadId).slice(-6) : ""}`,
        });
        const fresh = await getWarehouseItem(item.id);
        const po = fresh ? await createLowStockPurchaseRequest(fresh) : null;
        if (po) newPOs.push(po);
        results.push({ item: fresh, movement, purchaseOrder: po });
      }

      return c.json({ results, errors, newPurchaseOrders: newPOs, lowStockAlerts: newPOs.length });
    } catch (error: any) {
      return c.json({ error: `Failed to write off: ${error.message}` }, 500);
    }
  });

  app.get(`${P}/warehouse/:id/movements`, async (c: any) => {
    try {
      const supabase = db();
      const itemId = c.req.param("id");
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("id,direction,qty,reason,note,created_at")
        .eq("warehouse_item_id", itemId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      const item = await getWarehouseItem(itemId);
      const itemName = item?.name ?? "—";
      const movements: StockMovement[] = (data ?? []).map((m: any) => ({
        id: String(m.id),
        itemId,
        itemName,
        type: m.direction === "adjust" ? "adjustment" : m.direction,
        qty: Number(m.qty),
        stockBefore: 0,
        stockAfter: 0,
        reason: String(m.reason),
        note: m.note ?? undefined,
        createdAt: String(m.created_at),
      }));
      return c.json({ movements });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch movements: ${error.message}` }, 500);
    }
  });

  app.get(`${P}/warehouse-movements`, async (c: any) => {
    try {
      const supabase = db();
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("id,warehouse_item_id,direction,qty,reason,note,created_at,warehouse_items(name)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      const movements: StockMovement[] = (data ?? []).map((m: any) => ({
        id: String(m.id),
        itemId: String(m.warehouse_item_id),
        itemName: String(m.warehouse_items?.name ?? "—"),
        type: m.direction === "adjust" ? "adjustment" : m.direction,
        qty: Number(m.qty),
        stockBefore: 0,
        stockAfter: 0,
        reason: String(m.reason),
        note: m.note ?? undefined,
        createdAt: String(m.created_at),
      }));
      return c.json({ movements });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch movements: ${error.message}` }, 500);
    }
  });

  // Legacy endpoint: return purchase request lines (flat list)
  app.get(`${P}/purchase-orders`, async (c: any) => {
    try {
      const supabase = db();
      const { data, error } = await supabase
        .from("purchase_request_lines")
        .select(`
          id,qty,unit,buy_price,created_at,
          purchase_requests(status,reason,note,created_at,updated_at),
          warehouse_items(id,name,unit)
        `)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      const orders: PurchaseOrder[] = (data ?? []).map((l: any) => ({
        id: String(l.id),
        itemId: String(l.warehouse_items?.id ?? ""),
        itemName: String(l.warehouse_items?.name ?? "—"),
        itemUnit: String(l.warehouse_items?.unit ?? l.unit ?? "шт"),
        qtyOrdered: Number(l.qty ?? 0),
        qtyReceived: 0,
        pricePerUnit: Number(l.buy_price ?? 0),
        totalCost: Number(l.qty ?? 0) * Number(l.buy_price ?? 0),
        supplier: "—",
        status: (l.purchase_requests?.status ?? "pending"),
        reason: (l.purchase_requests?.reason ?? "manual"),
        note: l.purchase_requests?.note ?? undefined,
        createdAt: l.purchase_requests?.created_at ?? l.created_at,
        updatedAt: l.purchase_requests?.updated_at ?? l.created_at,
      }));
      return c.json({ orders });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch POs: ${error.message}` }, 500);
    }
  });

  app.post(`${P}/purchase-orders`, async (c: any) => {
    try {
      const { itemId, qtyOrdered, pricePerUnit, supplier, note } = await c.req.json();
      if (!itemId || !qtyOrdered) return c.json({ error: "itemId and qtyOrdered required" }, 400);
      const item = await getWarehouseItem(itemId);
      if (!item) return c.json({ error: "Item not found" }, 404);
      const qty = Number(qtyOrdered);
      const ppu = Number(pricePerUnit ?? 0);

      const supabase = db();
      const { data: pr, error: prErr } = await supabase
        .from("purchase_requests")
        .insert({ status: "pending", reason: "manual", note: note || "" })
        .select("id,created_at,updated_at,note")
        .single();
      if (prErr) throw new Error(prErr.message);

      const { data: line, error: lineErr } = await supabase
        .from("purchase_request_lines")
        .insert({ purchase_request_id: pr.id, warehouse_item_id: item.id, qty, unit: item.unit, buy_price: ppu || null })
        .select("id")
        .single();
      if (lineErr) throw new Error(lineErr.message);

      const order: PurchaseOrder = {
        id: String(line.id),
        itemId: item.id,
        itemName: item.name,
        itemUnit: item.unit,
        qtyOrdered: qty,
        qtyReceived: 0,
        pricePerUnit: ppu,
        totalCost: qty * ppu,
        supplier: supplier || item.supplier || "—",
        status: "pending",
        reason: "manual",
        note: pr.note ?? undefined,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
      };
      return c.json({ order });
    } catch (error: any) {
      return c.json({ error: `Failed to create PO: ${error.message}` }, 500);
    }
  });

  app.patch(`${P}/purchase-orders/:id`, async (c: any) => {
    try {
      const supabase = db();
      const body = await c.req.json();
      if (!body.status) return c.json({ error: "status required" }, 400);
      const { data: line, error: lineErr } = await supabase
        .from("purchase_request_lines")
        .select("purchase_request_id")
        .eq("id", c.req.param("id"))
        .single();
      if (lineErr) throw new Error(lineErr.message);
      const { error } = await supabase.from("purchase_requests").update({ status: body.status }).eq("id", line.purchase_request_id);
      if (error) throw new Error(error.message);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: `Failed to update PO: ${error.message}` }, 500);
    }
  });
}

