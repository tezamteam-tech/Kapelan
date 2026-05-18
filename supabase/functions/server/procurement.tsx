// Procurement module (Postgres-backed).
// Suppliers + batching purchase requests into supplier purchase orders.

import { createClient } from "npm:@supabase/supabase-js";
import { getAllWarehouseItems } from "./warehouse.tsx";

export interface Supplier {
  id: string;
  name: string;
  categories: string[];
  contactEmail: string;
  phone: string;
  address?: string;
  terms: {
    paymentDays: number;
    deliveryDays: number;
    minOrderAmount: number;
    currency: string;
  };
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProcurementOrderLine {
  purchaseOrderId: string; // legacy: purchase_request_line id
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  qty: number;
  pricePerUnit: number;
  totalCost: number;
  category: string;
}

export interface ProcurementOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierEmail: string;
  categories: string[];
  lines: ProcurementOrderLine[];
  totalCost: number;
  status: "draft" | "sent" | "confirmed" | "cancelled" | "failed";
  sendAttempts: number;
  lastSentAt?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierItem {
  id: string;
  supplierId: string;
  supplierName?: string;
  name: string;
  sku: string;
  unit: string;
  category: string;
  buyPrice: number;
  sellPrice: number;
  availability: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogLink {
  id: string;
  warehouseItemId?: string | null;
  supplierItemId: string;
  isPrimary: boolean;
  priority: number;
  createdAt: string;
}

type Db = ReturnType<typeof createClient>;

function db(): Db {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function toSupplier(row: any): Supplier {
  const terms = row.terms ?? {};
  return {
    id: String(row.id),
    name: String(row.name),
    categories: (row.categories ?? []) as string[],
    contactEmail: String(row.contact_email ?? ""),
    phone: String(row.phone ?? ""),
    address: row.address ?? undefined,
    terms: {
      paymentDays: Number(terms.paymentDays ?? terms.payment_days ?? 0),
      deliveryDays: Number(terms.deliveryDays ?? terms.delivery_days ?? 0),
      minOrderAmount: Number(terms.minOrderAmount ?? terms.min_order_amount ?? 0),
      currency: String(terms.currency ?? "BYN"),
    },
    isActive: row.is_active !== false,
    notes: row.notes ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function resolveSupplierForCategory(category: string, suppliers: Supplier[]): Supplier | null {
  const active = suppliers.filter((s) => s.isActive);
  const cat = category.trim().toLowerCase();
  const exact = active.find((s) => s.categories.some((c) => c.toLowerCase() === cat));
  if (exact) return exact;
  const fuzzy = active.find((s) => s.categories.some((c) => cat.includes(c.toLowerCase()) || c.toLowerCase().includes(cat)));
  return fuzzy ?? null;
}

function toSupplierItem(row: any): SupplierItem {
  return {
    id: String(row.id),
    supplierId: String(row.supplier_id),
    supplierName: row.suppliers?.name ? String(row.suppliers.name) : undefined,
    name: String(row.name ?? ""),
    sku: String(row.sku ?? ""),
    unit: String(row.unit ?? "шт"),
    category: String(row.category ?? "Прочее"),
    buyPrice: Number(row.buy_price ?? 0),
    sellPrice: Number(row.sell_price ?? 0),
    availability: String(row.availability ?? "order_only"),
    isActive: row.is_active !== false,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toCatalogLink(row: any): CatalogLink {
  return {
    id: String(row.id),
    warehouseItemId: row.warehouse_item_id ? String(row.warehouse_item_id) : null,
    supplierItemId: String(row.supplier_item_id),
    isPrimary: !!row.is_primary,
    priority: Number(row.priority ?? 100),
    createdAt: String(row.created_at),
  };
}

async function getAllSuppliers(): Promise<Supplier[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id,name,categories,contact_email,phone,address,terms,is_active,notes,created_at,updated_at")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toSupplier);
}

async function getSupplier(id: string): Promise<Supplier | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id,name,categories,contact_email,phone,address,terms,is_active,notes,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toSupplier(data) : null;
}

async function listProcurementOrders(): Promise<ProcurementOrder[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(`
      id,supplier_id,status,total_cost,note,created_at,updated_at,
      suppliers(name,contact_email),
      purchase_order_lines(id,warehouse_item_id,name,sku,unit,qty_ordered,buy_price,total_cost,category)
    `)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  return (data ?? []).map((o: any) => {
    const lines: ProcurementOrderLine[] = (o.purchase_order_lines ?? []).map((l: any) => ({
      purchaseOrderId: String(l.id),
      itemId: String(l.warehouse_item_id ?? ""),
      itemName: String(l.name ?? "—"),
      sku: String(l.sku ?? ""),
      unit: String(l.unit ?? "шт"),
      qty: Number(l.qty_ordered ?? 0),
      pricePerUnit: Number(l.buy_price ?? 0),
      totalCost: Number(l.total_cost ?? 0),
      category: String(l.category ?? ""),
    }));
    const cats = [...new Set(lines.map((l) => l.category).filter(Boolean))];
    return {
      id: String(o.id),
      supplierId: String(o.supplier_id),
      supplierName: String(o.suppliers?.name ?? "—"),
      supplierEmail: String(o.suppliers?.contact_email ?? ""),
      categories: cats,
      lines,
      totalCost: Number(o.total_cost ?? 0),
      status: (o.status ?? "draft"),
      sendAttempts: 0,
      lastSentAt: undefined,
      note: o.note ?? undefined,
      createdAt: String(o.created_at),
      updatedAt: String(o.updated_at),
    } satisfies ProcurementOrder;
  });
}

async function buildProcOrderFromRequestLines(
  supplier: Supplier,
  requestLineIds: string[],
  note?: string,
): Promise<ProcurementOrder> {
  const supabase = db();

  const { data: lines, error: linesErr } = await supabase
    .from("purchase_request_lines")
    .select(`
      id,qty,unit,buy_price,
      purchase_requests(id,status),
      warehouse_items(id,name,sku,category,unit)
    `)
    .in("id", requestLineIds);
  if (linesErr) throw new Error(linesErr.message);
  const rawLines = (lines ?? [])
    .filter((l: any) => (l.purchase_requests?.status ?? "pending") === "pending")
    .map((l: any) => ({
      id: String(l.id),
      qty: Number(l.qty ?? 0),
      unit: String(l.warehouse_items?.unit ?? l.unit ?? "шт"),
      buy: Number(l.buy_price ?? 0),
      itemId: String(l.warehouse_items?.id ?? ""),
      name: String(l.warehouse_items?.name ?? "—"),
      sku: String(l.warehouse_items?.sku ?? ""),
      category: String(l.warehouse_items?.category ?? ""),
      prId: String(l.purchase_requests?.id ?? ""),
    }))
    .filter((l: any) => l.qty > 0 && l.itemId);

  if (rawLines.length === 0) throw new Error("No pending lines");

  // Restrict to supplier categories
  const filtered = rawLines.filter((l: any) =>
    supplier.categories.some((c) => c.toLowerCase() === l.category.toLowerCase() || l.category.toLowerCase().includes(c.toLowerCase())),
  );
  if (filtered.length === 0) throw new Error("No lines matched supplier categories");

  const totalCost = filtered.reduce((s: number, l: any) => s + l.qty * l.buy, 0);

  // Create purchase order + lines
  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .insert({
      supplier_id: supplier.id,
      status: "draft",
      total_cost: totalCost,
      note: note || "",
    })
    .select("id,created_at,updated_at")
    .single();
  if (poErr) throw new Error(poErr.message);

  const insertLines = filtered.map((l: any) => ({
    purchase_order_id: po.id,
    warehouse_item_id: l.itemId,
    name: l.name,
    sku: l.sku || null,
    unit: l.unit,
    qty_ordered: l.qty,
    buy_price: l.buy,
    total_cost: l.qty * l.buy,
    category: l.category || null,
  }));

  const { error: polErr } = await supabase.from("purchase_order_lines").insert(insertLines);
  if (polErr) throw new Error(polErr.message);

  // Mark related purchase requests as ordered (so they disappear from pending)
  const prIds = [...new Set(filtered.map((l: any) => l.prId).filter(Boolean))];
  if (prIds.length > 0) {
    const { error: updErr } = await supabase.from("purchase_requests").update({ status: "ordered" }).in("id", prIds);
    if (updErr) throw new Error(updErr.message);
  }

  const outLines: ProcurementOrderLine[] = filtered.map((l: any) => ({
    purchaseOrderId: l.id,
    itemId: l.itemId,
    itemName: l.name,
    sku: l.sku,
    unit: l.unit,
    qty: l.qty,
    pricePerUnit: l.buy,
    totalCost: l.qty * l.buy,
    category: l.category,
  }));
  const cats = [...new Set(outLines.map((l) => l.category).filter(Boolean))];

  return {
    id: String(po.id),
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierEmail: supplier.contactEmail,
    categories: cats,
    lines: outLines,
    totalCost,
    status: "draft",
    sendAttempts: 0,
    lastSentAt: undefined,
    note: note || "",
    createdAt: String(po.created_at),
    updatedAt: String(po.updated_at),
  };
}

export function registerProcurementRoutes(app: any): void {
  const P = "/make-server-1df47c03";

  // Suppliers
  app.get(`${P}/suppliers`, async (c: any) => {
    try {
      const suppliers = await getAllSuppliers();
      return c.json({ suppliers });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.post(`${P}/suppliers`, async (c: any) => {
    try {
      const body = await c.req.json();
      const supabase = db();
      const { data, error } = await supabase
        .from("suppliers")
        .insert({
          name: body.name,
          categories: body.categories ?? [],
          contact_email: body.contactEmail ?? "",
          phone: body.phone ?? "",
          address: body.address ?? null,
          terms: body.terms ?? {},
          is_active: body.isActive !== false,
          notes: body.notes ?? "",
        })
        .select("id,name,categories,contact_email,phone,address,terms,is_active,notes,created_at,updated_at")
        .single();
      if (error) throw new Error(error.message);
      return c.json({ supplier: toSupplier(data) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.patch(`${P}/suppliers/:id`, async (c: any) => {
    try {
      const body = await c.req.json();
      const patch: any = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.categories !== undefined) patch.categories = body.categories;
      if (body.contactEmail !== undefined) patch.contact_email = body.contactEmail;
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.address !== undefined) patch.address = body.address || null;
      if (body.terms !== undefined) patch.terms = body.terms;
      if (body.isActive !== undefined) patch.is_active = body.isActive;
      if (body.notes !== undefined) patch.notes = body.notes;

      const supabase = db();
      const { data, error } = await supabase
        .from("suppliers")
        .update(patch)
        .eq("id", c.req.param("id"))
        .select("id,name,categories,contact_email,phone,address,terms,is_active,notes,created_at,updated_at")
        .single();
      if (error) throw new Error(error.message);
      return c.json({ supplier: toSupplier(data) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.delete(`${P}/suppliers/:id`, async (c: any) => {
    try {
      const supabase = db();
      const { error } = await supabase.from("suppliers").delete().eq("id", c.req.param("id"));
      if (error) throw new Error(error.message);
      return c.json({ success: true });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── Supplier items (catalog) ────────────────────────────────────────────────
  app.get(`${P}/supplier-items`, async (c: any) => {
    try {
      const supplierId = c.req.query("supplierId");
      const q = (c.req.query("q") ?? "").toLowerCase();
      const supabase = db();
      let query = supabase
        .from("supplier_items")
        .select("id,supplier_id,name,sku,unit,category,buy_price,sell_price,availability,is_active,created_at,updated_at,suppliers(name)")
        .order("updated_at", { ascending: false });
      if (supplierId) query = query.eq("supplier_id", supplierId);
      if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,category.ilike.%${q}%`);
      const { data, error } = await query.limit(500);
      if (error) throw new Error(error.message);
      return c.json({ items: (data ?? []).map(toSupplierItem) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.post(`${P}/supplier-items`, async (c: any) => {
    try {
      const body = await c.req.json();
      if (!body.supplierId) return c.json({ error: "supplierId required" }, 400);
      const supabase = db();
      const { data, error } = await supabase
        .from("supplier_items")
        .upsert({
          supplier_id: body.supplierId,
          name: body.name ?? "Новая позиция",
          sku: body.sku || null,
          unit: body.unit ?? "шт",
          category: body.category ?? "Прочее",
          buy_price: Number(body.buyPrice ?? 0),
          sell_price: Number(body.sellPrice ?? 0),
          availability: body.availability ?? "order_only",
          is_active: body.isActive !== false,
        }, { onConflict: "supplier_id,sku" })
        .select("id,supplier_id,name,sku,unit,category,buy_price,sell_price,availability,is_active,created_at,updated_at,suppliers(name)")
        .single();
      if (error) throw new Error(error.message);
      return c.json({ item: toSupplierItem(data) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.patch(`${P}/supplier-items/:id`, async (c: any) => {
    try {
      const body = await c.req.json();
      const patch: any = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.sku !== undefined) patch.sku = body.sku || null;
      if (body.unit !== undefined) patch.unit = body.unit;
      if (body.category !== undefined) patch.category = body.category;
      if (body.buyPrice !== undefined) patch.buy_price = Number(body.buyPrice ?? 0);
      if (body.sellPrice !== undefined) patch.sell_price = Number(body.sellPrice ?? 0);
      if (body.availability !== undefined) patch.availability = body.availability;
      if (body.isActive !== undefined) patch.is_active = body.isActive;

      const supabase = db();
      const { data, error } = await supabase
        .from("supplier_items")
        .update(patch)
        .eq("id", c.req.param("id"))
        .select("id,supplier_id,name,sku,unit,category,buy_price,sell_price,availability,is_active,created_at,updated_at,suppliers(name)")
        .single();
      if (error) throw new Error(error.message);
      return c.json({ item: toSupplierItem(data) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // Bulk upsert price list + optional cleanup/linking
  // body: { supplierId, items: [{name,sku,category,unit,buyPrice,sellPrice,availability,isActive?}], options?: { autoLink?: boolean; deactivateMissing?: boolean } }
  app.post(`${P}/supplier-items/bulk-upsert`, async (c: any) => {
    try {
      const body = await c.req.json();
      const supplierId = body?.supplierId;
      const itemsIn = Array.isArray(body?.items) ? body.items : [];
      const options = body?.options ?? {};
      const autoLink = options?.autoLink !== false;
      const deactivateMissing = options?.deactivateMissing === true;

      if (!supplierId) return c.json({ error: "supplierId required" }, 400);
      if (itemsIn.length === 0) return c.json({ ok: true, upserted: 0, linked: 0, deactivated: 0 });

      const supabase = db();

      // Normalize
      const norm = itemsIn
        .map((r: any) => ({
          name: String(r.name ?? "").trim(),
          sku: String(r.sku ?? "").trim(),
          category: String(r.category ?? "Прочее").trim() || "Прочее",
          unit: String(r.unit ?? "шт").trim() || "шт",
          buyPrice: Number(r.buyPrice ?? 0),
          sellPrice: Number(r.sellPrice ?? 0),
          availability: r.availability === "in_stock_supplier" ? "in_stock_supplier" : "order_only",
          isActive: r.isActive !== false,
        }))
        .filter((r: any) => r.name);

      // Split: with SKU (upsertable via unique supplier_id+sku) and without SKU (match by exact name)
      const withSku = norm.filter((r: any) => r.sku);
      const withoutSku = norm.filter((r: any) => !r.sku);

      let upserted = 0;
      const touchedSupplierItemIds: string[] = [];

      if (withSku.length) {
        const payload = withSku.map((r: any) => ({
          supplier_id: supplierId,
          name: r.name,
          sku: r.sku,
          unit: r.unit,
          category: r.category,
          buy_price: Math.max(0, r.buyPrice || 0),
          sell_price: Math.max(0, r.sellPrice || 0),
          availability: r.availability,
          is_active: r.isActive,
        }));
        const { data, error } = await supabase
          .from("supplier_items")
          .upsert(payload, { onConflict: "supplier_id,sku" })
          .select("id");
        if (error) throw new Error(error.message);
        upserted += (data ?? []).length;
        (data ?? []).forEach((d: any) => touchedSupplierItemIds.push(String(d.id)));
      }

      if (withoutSku.length) {
        // Find existing by exact name for supplier, update them; otherwise insert
        const names = [...new Set(withoutSku.map((r: any) => r.name))];
        const { data: existing, error: exErr } = await supabase
          .from("supplier_items")
          .select("id,name")
          .eq("supplier_id", supplierId)
          .in("name", names);
        if (exErr) throw new Error(exErr.message);
        const byName = new Map<string, any>((existing ?? []).map((e: any) => [String(e.name), e]));

        const toUpdate: any[] = [];
        const toInsert: any[] = [];
        for (const r of withoutSku) {
          const ex = byName.get(r.name);
          if (ex) {
            toUpdate.push({
              id: ex.id,
              supplier_id: supplierId,
              name: r.name,
              sku: null,
              unit: r.unit,
              category: r.category,
              buy_price: Math.max(0, r.buyPrice || 0),
              sell_price: Math.max(0, r.sellPrice || 0),
              availability: r.availability,
              is_active: r.isActive,
            });
          } else {
            toInsert.push({
              supplier_id: supplierId,
              name: r.name,
              sku: null,
              unit: r.unit,
              category: r.category,
              buy_price: Math.max(0, r.buyPrice || 0),
              sell_price: Math.max(0, r.sellPrice || 0),
              availability: r.availability,
              is_active: r.isActive,
            });
          }
        }

        if (toUpdate.length) {
          for (const u of toUpdate) {
            const { data, error } = await supabase.from("supplier_items").update(u).eq("id", u.id).select("id").single();
            if (error) throw new Error(error.message);
            touchedSupplierItemIds.push(String(data.id));
            upserted += 1;
          }
        }
        if (toInsert.length) {
          const { data, error } = await supabase.from("supplier_items").insert(toInsert).select("id");
          if (error) throw new Error(error.message);
          upserted += (data ?? []).length;
          (data ?? []).forEach((d: any) => touchedSupplierItemIds.push(String(d.id)));
        }
      }

      // Deactivate items not present in this import
      let deactivated = 0;
      if (deactivateMissing) {
        // Build "present keys": prefer sku else name
        const presentSku = [...new Set(withSku.map((r: any) => r.sku))];
        const presentNamesNoSku = [...new Set(withoutSku.map((r: any) => r.name))];

        // Deactivate SKUs not present (only for rows with non-null sku)
        if (presentSku.length > 0) {
          const { data: toDeact, error: tdErr } = await supabase
            .from("supplier_items")
            .select("id")
            .eq("supplier_id", supplierId)
            .not("sku", "is", null)
            .not("sku", "in", `(${presentSku.map((s: string) => `"${s.replaceAll('"', '\\"')}"`).join(",")})`);
          if (!tdErr && (toDeact?.length ?? 0) > 0) {
            const ids = toDeact!.map((r: any) => r.id);
            const { error } = await supabase.from("supplier_items").update({ is_active: false }).in("id", ids);
            if (!error) deactivated += ids.length;
          }
        }

        // Deactivate non-sku items not present by exact name
        if (presentNamesNoSku.length > 0) {
          const { data: toDeact2, error: tdErr2 } = await supabase
            .from("supplier_items")
            .select("id")
            .eq("supplier_id", supplierId)
            .is("sku", null)
            .not("name", "in", `(${presentNamesNoSku.map((s: string) => `"${s.replaceAll('"', '\\"')}"`).join(",")})`);
          if (!tdErr2 && (toDeact2?.length ?? 0) > 0) {
            const ids = toDeact2!.map((r: any) => r.id);
            const { error } = await supabase.from("supplier_items").update({ is_active: false }).in("id", ids);
            if (!error) deactivated += ids.length;
          }
        }
      }

      // Auto-link to warehouse items (SKU exact, fallback name ilike) and set primary if none exists yet
      let linked = 0;
      if (autoLink && touchedSupplierItemIds.length > 0) {
        // Load touched supplier items
        const { data: supItems, error: sErr } = await supabase
          .from("supplier_items")
          .select("id,name,sku,category,unit,buy_price,sell_price")
          .in("id", touchedSupplierItemIds);
        if (sErr) throw new Error(sErr.message);

        // Warehouse index
        const skus = [...new Set((supItems ?? []).map((i: any) => String(i.sku ?? "").trim()).filter(Boolean))];
        let whBySku = new Map<string, any>();
        if (skus.length > 0) {
          const { data: whRows, error: whErr } = await supabase
            .from("warehouse_items")
            .select("id,sku,name")
            .in("sku", skus);
          if (!whErr) whBySku = new Map((whRows ?? []).map((w: any) => [String(w.sku), w]));
        }

        // Existing primary links for warehouse items to avoid overriding
        const candidateWhIds: string[] = [];
        const matches: { supplierItemId: string; warehouseItemId: string }[] = [];
        for (const si of (supItems ?? []) as any[]) {
          const sku = String(si.sku ?? "").trim();
          if (sku && whBySku.get(sku)) {
            const wh = whBySku.get(sku);
            matches.push({ supplierItemId: String(si.id), warehouseItemId: String(wh.id) });
            candidateWhIds.push(String(wh.id));
            continue;
          }
          // Fallback: name ilike first hit
          const nm = String(si.name ?? "").trim();
          if (!nm) continue;
          const { data: wh2 } = await supabase
            .from("warehouse_items")
            .select("id")
            .ilike("name", `%${nm.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`)
            .limit(1);
          if (wh2?.[0]?.id) {
            matches.push({ supplierItemId: String(si.id), warehouseItemId: String(wh2[0].id) });
            candidateWhIds.push(String(wh2[0].id));
          }
        }

        const uniqWh = [...new Set(candidateWhIds)];
        const primaryExists = new Set<string>();
        if (uniqWh.length > 0) {
          const { data: prim } = await supabase
            .from("catalog_links")
            .select("warehouse_item_id")
            .eq("is_primary", true)
            .in("warehouse_item_id", uniqWh);
          (prim ?? []).forEach((r: any) => primaryExists.add(String(r.warehouse_item_id)));
        }

        for (const m of matches) {
          const shouldPrimary = !primaryExists.has(m.warehouseItemId);
          const { data: linkRow, error: lErr } = await supabase
            .from("catalog_links")
            .upsert({
              supplier_item_id: m.supplierItemId,
              warehouse_item_id: m.warehouseItemId,
              is_primary: shouldPrimary,
              priority: 10,
            }, { onConflict: "supplier_item_id" })
            .select("id,is_primary,warehouse_item_id")
            .single();
          if (lErr) continue;
          linked += 1;
          if (linkRow?.is_primary && linkRow?.warehouse_item_id) primaryExists.add(String(linkRow.warehouse_item_id));
        }
      }

      return c.json({ ok: true, upserted, linked, deactivated });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── Catalog links (supplier_item ↔ warehouse_item) ──────────────────────────
  app.get(`${P}/catalog-links`, async (c: any) => {
    try {
      const supplierItemId = c.req.query("supplierItemId");
      const supplierId = c.req.query("supplierId");
      const warehouseItemId = c.req.query("warehouseItemId");
      const supabase = db();
      let query = supabase
        .from("catalog_links")
        .select("id,warehouse_item_id,supplier_item_id,is_primary,priority,created_at,supplier_items!inner(supplier_id)")
        .order("is_primary", { ascending: false })
        .order("priority", { ascending: true })
        .limit(500);
      if (supplierItemId) query = query.eq("supplier_item_id", supplierItemId);
      if (supplierId) query = query.eq("supplier_items.supplier_id", supplierId);
      if (warehouseItemId) query = query.eq("warehouse_item_id", warehouseItemId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return c.json({ links: (data ?? []).map(toCatalogLink) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.post(`${P}/catalog-links`, async (c: any) => {
    try {
      const body = await c.req.json();
      if (!body.supplierItemId) return c.json({ error: "supplierItemId required" }, 400);
      const supabase = db();
      const isPrimary = !!body.isPrimary;
      const whId = body.warehouseItemId ?? null;
      const priority = Number(body.priority ?? 100);

      const { data, error } = await supabase
        .from("catalog_links")
        .insert({
          supplier_item_id: body.supplierItemId,
          warehouse_item_id: whId,
          is_primary: isPrimary,
          priority,
        })
        .select("id,warehouse_item_id,supplier_item_id,is_primary,priority,created_at")
        .single();
      if (error) throw new Error(error.message);

      // enforce single primary per warehouse_item_id
      if (isPrimary && whId) {
        await supabase
          .from("catalog_links")
          .update({ is_primary: false })
          .eq("warehouse_item_id", whId)
          .neq("id", data.id);
      }

      return c.json({ link: toCatalogLink(data) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.patch(`${P}/catalog-links/:id`, async (c: any) => {
    try {
      const body = await c.req.json();
      const patch: any = {};
      if (body.warehouseItemId !== undefined) patch.warehouse_item_id = body.warehouseItemId || null;
      if (body.supplierItemId !== undefined) patch.supplier_item_id = body.supplierItemId;
      if (body.isPrimary !== undefined) patch.is_primary = !!body.isPrimary;
      if (body.priority !== undefined) patch.priority = Number(body.priority ?? 100);

      const supabase = db();
      const { data, error } = await supabase
        .from("catalog_links")
        .update(patch)
        .eq("id", c.req.param("id"))
        .select("id,warehouse_item_id,supplier_item_id,is_primary,priority,created_at")
        .single();
      if (error) throw new Error(error.message);

      if (data.is_primary && data.warehouse_item_id) {
        await supabase
          .from("catalog_links")
          .update({ is_primary: false })
          .eq("warehouse_item_id", data.warehouse_item_id)
          .neq("id", data.id);
      }

      return c.json({ link: toCatalogLink(data) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.delete(`${P}/catalog-links/:id`, async (c: any) => {
    try {
      const supabase = db();
      const { error } = await supabase.from("catalog_links").delete().eq("id", c.req.param("id"));
      if (error) throw new Error(error.message);
      return c.json({ success: true });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // Procurement orders (purchase_orders)
  app.get(`${P}/procurement/orders`, async (c: any) => {
    try {
      const orders = await listProcurementOrders();
      return c.json({ orders });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // Create procurement order from pending purchase request lines
  app.post(`${P}/procurement/orders`, async (c: any) => {
    try {
      const body = await c.req.json();
      const { supplierId, purchaseOrderIds, note } = body;
      if (!supplierId) return c.json({ error: "supplierId required" }, 400);

      const supplier = await getSupplier(supplierId);
      if (!supplier) return c.json({ error: "Supplier not found" }, 404);

      let ids: string[] = Array.isArray(purchaseOrderIds) ? purchaseOrderIds : [];
      if (ids.length === 0) {
        // Auto-pick pending purchase requests matching supplier categories
        const supabase = db();
        const { data, error } = await supabase
          .from("purchase_request_lines")
          .select("id,purchase_requests(status),warehouse_items(category)")
          .limit(1000);
        if (error) throw new Error(error.message);
        ids = (data ?? [])
          .filter((l: any) => (l.purchase_requests?.status ?? "pending") === "pending")
          .filter((l: any) => {
            const cat = String(l.warehouse_items?.category ?? "");
            return supplier.categories.some((c) => c.toLowerCase() === cat.toLowerCase() || cat.toLowerCase().includes(c.toLowerCase()));
          })
          .map((l: any) => String(l.id));
      }
      if (ids.length === 0) return c.json({ error: "No matching pending purchase orders" }, 400);

      const order = await buildProcOrderFromRequestLines(supplier, ids, note);
      return c.json({ order });
    } catch (e: any) {
      return c.json({ error: `Failed to create procurement order: ${e.message}` }, 500);
    }
  });

  // Send procurement order (no mock; just status transition)
  app.post(`${P}/procurement/orders/:id/send`, async (c: any) => {
    try {
      const supabase = db();
      const id = c.req.param("id");
      const { data: po, error: poErr } = await supabase
        .from("purchase_orders")
        .select("id,status,total_cost,supplier_id")
        .eq("id", id)
        .single();
      if (poErr) throw new Error(poErr.message);
      if (po.status === "cancelled") return c.json({ error: "Order is cancelled" }, 400);

      // Validate min order
      const supplier = await getSupplier(String(po.supplier_id));
      if (!supplier) return c.json({ error: "Supplier not found" }, 404);
      if (Number(po.total_cost ?? 0) < supplier.terms.minOrderAmount) {
        return c.json({
          error: `Минимальная сумма заказа у ${supplier.name}: ${supplier.terms.minOrderAmount}. Текущая: ${Number(po.total_cost ?? 0).toFixed(0)}`,
        }, 400);
      }

      const { error: updErr } = await supabase
        .from("purchase_orders")
        .update({ status: "confirmed" })
        .eq("id", id);
      if (updErr) throw new Error(updErr.message);

      const orders = await listProcurementOrders();
      const updated = orders.find((o) => o.id === id);
      return c.json({ order: updated ?? null });
    } catch (e: any) {
      return c.json({ error: `Failed to send order: ${e.message}` }, 500);
    }
  });

  // Cancel/update
  app.patch(`${P}/procurement/orders/:id`, async (c: any) => {
    try {
      const body = await c.req.json();
      const patch: any = {};
      if (body.status) patch.status = body.status;
      if (body.note !== undefined) patch.note = body.note;
      const supabase = db();
      const { error } = await supabase.from("purchase_orders").update(patch).eq("id", c.req.param("id"));
      if (error) throw new Error(error.message);
      const orders = await listProcurementOrders();
      const updated = orders.find((o) => o.id === c.req.param("id"));
      return c.json({ order: updated ?? null });
    } catch (e: any) {
      return c.json({ error: `Failed to update order: ${e.message}` }, 500);
    }
  });

  // Auto-batch: disabled on prod initially (avoid unintended sends)
  app.post(`${P}/procurement/auto-batch`, async (c: any) => {
    return c.json({ error: "auto-batch disabled on prod" }, 410);
  });

  // Stats
  app.get(`${P}/procurement/stats`, async (c: any) => {
    try {
      const orders = await listProcurementOrders();
      const suppliers = await getAllSuppliers();
      const stats = {
        total: orders.length,
        draft: orders.filter((o) => o.status === "draft").length,
        sent: orders.filter((o) => o.status === "sent").length,
        confirmed: orders.filter((o) => o.status === "confirmed").length,
        failed: orders.filter((o) => o.status === "failed").length,
        cancelled: orders.filter((o) => o.status === "cancelled").length,
        totalSpend: orders.filter((o) => o.status === "confirmed").reduce((s, o) => s + Number(o.totalCost ?? 0), 0),
        activeSuppliers: suppliers.filter((s) => s.isActive).length,
      };
      return c.json({ stats });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });
}

