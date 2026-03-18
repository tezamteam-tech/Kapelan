// Measurement Orders — visit orders for on-site measurements before AC installation
import { Hono } from "npm:hono";
import * as kv from "./kv_store.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MeasurementStatus =
  | "scheduled"       // Замер назначен
  | "in_progress"     // Монтажник на объекте
  | "measured"        // Замер выполнен, ждёт КП
  | "offer_sent"      // КП отправлено клиенту
  | "approved"        // КП одобрено
  | "install_created" // Ордер на монтаж создан
  | "cancelled";      // Отменён

export interface MeasurementConsumable {
  name: string;
  unit: string;
  qty: number;
  pricePerUnit?: number;
}

export interface MeasurementOrder {
  id: string;
  leadId?: string;
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  clientComment?: string;

  // Scheduling
  scheduledDate: string;           // ISO date
  assignedInstaller: string;

  // Status
  status: MeasurementStatus;

  // Filled by installer on-site
  roomArea?: number;               // actual room area m²
  roomType?: string;               // "Квартира", "Офис" etc.
  traceLength?: number;            // pipe/cable trace length, m
  acModelId?: string;
  acBrand?: string;
  acModel?: string;
  acBtu?: number;
  acPrice?: number;
  consumables?: MeasurementConsumable[];
  installerNotes?: string;
  measuredAt?: string;             // ISO datetime

  // KP / offer
  workCost?: number;               // labour cost
  totalOfferPrice?: number;        // full price for client
  offerNotes?: string;
  offerSentAt?: string;

  // Installation scheduling
  installDate?: string;
  installOrderId?: string;

  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── KV key helpers ───────────────────────────────────────────────────────────
const KEY = (id: string) => `meas_order:${id}`;
const LIST_KEY = "meas_orders:index";

async function listAll(): Promise<MeasurementOrder[]> {
  const ids = (await kv.get<string[]>(LIST_KEY)) ?? [];
  if (!ids.length) return [];
  const results = await Promise.all(ids.map(id => kv.get<MeasurementOrder>(KEY(id))));
  return results
    .filter(Boolean)
    .sort((a, b) => new Date(b!.createdAt).getTime() - new Date(a!.createdAt).getTime()) as MeasurementOrder[];
}

async function saveOrder(order: MeasurementOrder): Promise<void> {
  await kv.set(KEY(order.id), order);
  const ids = (await kv.get<string[]>(LIST_KEY)) ?? [];
  if (!ids.includes(order.id)) {
    await kv.set(LIST_KEY, [order.id, ...ids]);
  }
}

async function deleteOrder(id: string): Promise<void> {
  await kv.del(KEY(id));
  const ids = (await kv.get<string[]>(LIST_KEY)) ?? [];
  await kv.set(LIST_KEY, ids.filter(i => i !== id));
}

// ─── Route registration ───────────────────────────────────────────────────────
export function registerMeasurementOrderRoutes(app: Hono) {

  // GET /measurement-orders — list all
  app.get("/make-server-1df47c03/measurement-orders", async (c) => {
    try {
      const orders = await listAll();
      // optional filter
      const status = c.req.query("status");
      const installer = c.req.query("installer");
      const filtered = orders.filter(o => {
        if (status && o.status !== status) return false;
        if (installer && !o.assignedInstaller.toLowerCase().includes(installer.toLowerCase())) return false;
        return true;
      });
      return c.json({ orders: filtered, total: filtered.length });
    } catch (e: any) {
      console.log("GET measurement-orders error:", e.message);
      return c.json({ error: e.message }, 500);
    }
  });

  // GET /measurement-orders/:id
  app.get("/make-server-1df47c03/measurement-orders/:id", async (c) => {
    try {
      const order = await kv.get<MeasurementOrder>(KEY(c.req.param("id")));
      if (!order) return c.json({ error: "Ордер не найден" }, 404);
      return c.json({ order });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // POST /measurement-orders — create
  app.post("/make-server-1df47c03/measurement-orders", async (c) => {
    try {
      const body = await c.req.json();
      const now = new Date().toISOString();
      const id = `meas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      if (!body.clientName) return c.json({ error: "clientName обязателен" }, 400);
      if (!body.clientPhone) return c.json({ error: "clientPhone обязателен" }, 400);
      if (!body.clientAddress) return c.json({ error: "clientAddress обязателен" }, 400);
      if (!body.scheduledDate) return c.json({ error: "scheduledDate обязателен" }, 400);
      if (!body.assignedInstaller) return c.json({ error: "assignedInstaller обязателен" }, 400);

      const order: MeasurementOrder = {
        id,
        leadId:              body.leadId ?? undefined,
        clientName:          String(body.clientName).trim(),
        clientPhone:         String(body.clientPhone).trim(),
        clientAddress:       String(body.clientAddress).trim(),
        clientComment:       body.clientComment ?? "",
        scheduledDate:       body.scheduledDate,
        assignedInstaller:   String(body.assignedInstaller).trim(),
        status:              "scheduled",
        createdBy:           body.createdBy ?? "manager",
        createdAt:           now,
        updatedAt:           now,
      };

      await saveOrder(order);
      console.log("Created measurement order:", id);
      return c.json({ order }, 201);
    } catch (e: any) {
      console.log("POST measurement-orders error:", e.message);
      return c.json({ error: e.message }, 500);
    }
  });

  // PATCH /measurement-orders/:id — partial update
  app.patch("/make-server-1df47c03/measurement-orders/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const existing = await kv.get<MeasurementOrder>(KEY(id));
      if (!existing) return c.json({ error: "Ордер не найден" }, 404);

      const body = await c.req.json();
      const now = new Date().toISOString();

      // If marking as measured, set measuredAt
      const measuredAt = body.status === "measured" && !existing.measuredAt ? now : existing.measuredAt;

      const updated: MeasurementOrder = {
        ...existing,
        ...body,
        id,
        measuredAt,
        updatedAt: now,
      };

      await saveOrder(updated);
      console.log("Updated measurement order:", id, "→", updated.status);
      return c.json({ order: updated });
    } catch (e: any) {
      console.log("PATCH measurement-orders error:", e.message);
      return c.json({ error: e.message }, 500);
    }
  });

  // DELETE /measurement-orders/:id
  app.delete("/make-server-1df47c03/measurement-orders/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const existing = await kv.get<MeasurementOrder>(KEY(id));
      if (!existing) return c.json({ error: "Ордер не найден" }, 404);
      await deleteOrder(id);
      return c.json({ success: true });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });
}
