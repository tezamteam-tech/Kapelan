// ─── INSTALL ORDERS MODULE ────────────────────────────────────────────────────
// Manages AC installation orders: catalog with BOM, order lifecycle,
// AI room analysis, warehouse consumable issuance.
import * as kv from "./kv_store.tsx";
import { getWarehouseItem, saveWarehouseItem, addMovement } from "./warehouse.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BomEntry {
  warehouseId: string;
  name: string;
  unit: string;
  qtyFixed: number;     // always added regardless of trace length
  qtyPerMeter: number;  // added per meter of copper trace
}

export interface AcModel {
  id: string;
  brand: string;
  model: string;
  btu: number;
  kw: number;
  areaMin: number;
  areaMax: number;
  refrigerant: string;
  tier: "economy" | "standard" | "premium";
  features: string[];
  price: number;
  warranty: number;
  bom: BomEntry[];
}

export type OrderStatus = "draft" | "confirmed" | "assigned" | "in_progress" | "paused" | "completed" | "cancelled";

export interface OrderConsumable {
  warehouseId: string;
  name: string;
  unit: string;
  qtyRequired: number;
  qtyIssued: number;
  stockSnapshot: number; // stock at order creation time
}

export interface InstallOrder {
  id: string;
  // Client
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  leadId?: string;
  // Room
  roomArea: number;
  roomType: string;
  traceLength: number;
  // AC
  acModelId: string;
  acBrand: string;
  acModelName: string;
  acBtu: number;
  acKw: number;
  acPrice: number;
  acCount: number;
  // Consumables
  consumables: OrderConsumable[];
  consumablesIssued: boolean;
  // Assignment
  installerName: string;
  scheduledDate: string;
  // AI analysis (optional)
  aiAnalysis?: {
    area: number;
    roomType: string;
    recommendedBtu: number;
    traceLength: number;
    notes: string;
    imageDescription: string;
  };
  // Meta
  status: OrderStatus;
  notes: string;
  source: "ai" | "manual";
  createdAt: string;
  updatedAt: string;
}

// ─── Standard BOM ─────────────────────────────────────────────────────────────
// qty = Math.ceil(qtyFixed + qtyPerMeter × traceLength)
// warehouseId matches the IDs seeded in warehouse.tsx DEFAULT_WAREHOUSE

const STD_BOM: BomEntry[] = [
  // Copper pipe (liquid + gas line, same length as trace + 2m buffer each)
  { warehouseId: "wh_pipe_14",    name: 'Медная труба 1/4" (жидкостная линия)', unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  { warehouseId: "wh_pipe_38",    name: 'Медная труба 3/8" (газовая линия)',     unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  // Insulation
  { warehouseId: "wh_insul_14",   name: 'Теплоизоляция 9мм (для 1/4")',         unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  { warehouseId: "wh_insul_38",   name: 'Теплоизоляция 13мм (для 3/8")',        unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  // Drain
  { warehouseId: "wh_drain_pipe", name: "Дренажная труба ø16мм",                unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  // Electrical
  { warehouseId: "wh_cable",      name: "Кабель питания 3×1.5мм²",              unit: "м",     qtyFixed: 3,  qtyPerMeter: 1 },
  { warehouseId: "wh_cable_duct", name: "Кабельный канал 60×40",                unit: "м",     qtyFixed: 1,  qtyPerMeter: 1 },
  // Hardware (fixed)
  { warehouseId: "wh_brackets",   name: "Кронштейны для наружного блока",       unit: "компл", qtyFixed: 1,  qtyPerMeter: 0 },
  { warehouseId: "wh_dowels",     name: "Дюбель-шуруп 6×60",                   unit: "шт",    qtyFixed: 12, qtyPerMeter: 0 },
  { warehouseId: "wh_clamps",     name: "Хомуты для крепления труб",            unit: "шт",    qtyFixed: 4,  qtyPerMeter: 2 },
  // Refrigerant + sealants
  { warehouseId: "wh_freon",      name: "Фреон R32 (буфер дозаправки)",         unit: "кг",    qtyFixed: 1,  qtyPerMeter: 0 },
  { warehouseId: "wh_sealant",    name: "Герметик силиконовый",                 unit: "шт",    qtyFixed: 1,  qtyPerMeter: 0 },
  { warehouseId: "wh_gland",      name: "Сальники кабельного ввода",            unit: "шт",    qtyFixed: 2,  qtyPerMeter: 0 },
  { warehouseId: "wh_tape",       name: "Самовулканизирующаяся лента",          unit: "м",     qtyFixed: 2,  qtyPerMeter: 0 },
];

// ─── AC Catalog (10 models across 3 tiers) ───────────────────────────────────

export const AC_CATALOG: AcModel[] = [
  // ── Economy ─────────────────────────────────────────────────────────────────
  {
    id: "ac_eco_07", brand: "Cooper&Hunter", model: "CH-S07FTXF2-NG Wi-Fi",
    btu: 7000, kw: 2.1, areaMin: 15, areaMax: 22, refrigerant: "R32",
    tier: "economy", price: 15900, warranty: 3,
    features: ["Инвертор", "Wi-Fi управление", "Обогрев до -15°C"],
    bom: STD_BOM,
  },
  {
    id: "ac_eco_09", brand: "Midea", model: "MSAFAU-09HRDN1-I/O",
    btu: 9000, kw: 2.6, areaMin: 22, areaMax: 30, refrigerant: "R32",
    tier: "economy", price: 18500, warranty: 3,
    features: ["Инвертор", "Авторестарт", "Обогрев до -15°C"],
    bom: STD_BOM,
  },
  {
    id: "ac_eco_12", brand: "Midea", model: "MSAFAU-12HRDN1-I/O",
    btu: 12000, kw: 3.5, areaMin: 30, areaMax: 40, refrigerant: "R32",
    tier: "economy", price: 22000, warranty: 3,
    features: ["Инвертор", "Авторестарт", "Обогрев до -15°C"],
    bom: STD_BOM,
  },
  // ── Standard ────────────────────────────────────────────────────────────────
  {
    id: "ac_std_09", brand: "Samsung", model: "AR09TXHQASINUA WindFree",
    btu: 9000, kw: 2.6, areaMin: 22, areaMax: 30, refrigerant: "R32",
    tier: "standard", price: 27000, warranty: 5,
    features: ["Инвертор", "Wi-Fi управление", "Тихий режим", "Обогрев до -20°C"],
    bom: STD_BOM,
  },
  {
    id: "ac_std_12", brand: "Samsung", model: "AR12TXHQASINUA WindFree",
    btu: 12000, kw: 3.5, areaMin: 30, areaMax: 42, refrigerant: "R32",
    tier: "standard", price: 31000, warranty: 5,
    features: ["Инвертор", "Wi-Fi управление", "Тихий режим", "Обогрев до -20°C"],
    bom: STD_BOM,
  },
  {
    id: "ac_std_18", brand: "LG", model: "S18ET.NSKSUA Dual Inverter",
    btu: 18000, kw: 5.0, areaMin: 42, areaMax: 58, refrigerant: "R32",
    tier: "standard", price: 43000, warranty: 5,
    features: ["Инвертор", "Wi-Fi управление", "Очистка воздуха", "Обогрев до -20°C"],
    bom: STD_BOM,
  },
  {
    id: "ac_std_24", brand: "LG", model: "S24ET.NSKSUA Dual Inverter",
    btu: 24000, kw: 7.0, areaMin: 58, areaMax: 78, refrigerant: "R32",
    tier: "standard", price: 57000, warranty: 5,
    features: ["Инвертор", "Wi-Fi управление", "Очистка воздуха", "Обогрев до -20°C"],
    bom: STD_BOM,
  },
  // ── Premium ─────────────────────────────────────────────────────────────────
  {
    id: "ac_prm_09", brand: "Daikin", model: "FTXB25C/RXB25C Eco",
    btu: 9000, kw: 2.5, areaMin: 22, areaMax: 30, refrigerant: "R32",
    tier: "premium", price: 46000, warranty: 7,
    features: ["Инвертор", "Wi-Fi управление", "Тихий режим", "Очистка воздуха", "Обогрев до -25°C"],
    bom: STD_BOM,
  },
  {
    id: "ac_prm_12", brand: "Daikin", model: "FTXB35C/RXB35C Eco",
    btu: 12000, kw: 3.4, areaMin: 30, areaMax: 42, refrigerant: "R32",
    tier: "premium", price: 54000, warranty: 7,
    features: ["Инвертор", "Wi-Fi управление", "Тихий режим", "Очистка воздуха", "Обогрев до -25°C"],
    bom: STD_BOM,
  },
  {
    id: "ac_prm_18", brand: "Mitsubishi Electric", model: "MSZ-LN50VG/MUZ-LN50VG",
    btu: 18000, kw: 5.0, areaMin: 42, areaMax: 58, refrigerant: "R32",
    tier: "premium", price: 82000, warranty: 7,
    features: ["Инвертор", "Wi-Fi управление", "Тихий режим", "Очистка воздуха", "Обогрев до -25°C", "Дизайнерский корпус"],
    bom: STD_BOM,
  },
];

// ─── AI analysis prompt ───────────────────────────────────────────────────────

const ROOM_ANALYSIS_PROMPT = `Ты — эксперт по климатическому оборудованию. Проанализируй фотографию помещения или план/чертёж здания.

Определи:
1. Площадь помещения в м² (если чертёж — вычисли из размеров, если фото — оцени визуально)
2. Тип помещения (спальня / гостиная / офис / кухня / магазин / склад / серверная — на русском)
3. Рекомендуемая мощность кондиционера в BTU. Выбери ТОЛЬКО из: 7000, 9000, 12000, 18000, 24000
   Ориентир: ~1000 BTU на 10 м². Для офисов/кухонь — плюс 20%. Для помещений с большими окнами на юг — плюс 15%.
4. Ориентировочная длина фреоновой трассы в метрах (путь трубопровода от внутреннего блока до наружного). Минимум 3м.
5. Замечания для монтажника (особенности помещения, препятствия, рекомендации)

Верни ТОЛЬКО валидный JSON без каких-либо пояснений до или после:
{"area":<число>,"roomType":"<тип>","recommendedBtu":<7000|9000|12000|18000|24000>,"traceLength":<число>,"notes":"<замечания или пустая строка>","imageDescription":"<1 предложение что видишь на изображении>"}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function calcConsumables(bom: BomEntry[], traceLength: number): Promise<OrderConsumable[]> {
  return Promise.all(
    bom.map(async (entry) => {
      const qtyRequired = Math.ceil(entry.qtyFixed + entry.qtyPerMeter * traceLength);
      const wItem = await getWarehouseItem(entry.warehouseId);
      return {
        warehouseId: entry.warehouseId,
        name: entry.name,
        unit: entry.unit,
        qtyRequired,
        qtyIssued: 0,
        stockSnapshot: wItem?.stock ?? 0,
      } as OrderConsumable;
    })
  );
}

async function getAllOrders(): Promise<InstallOrder[]> {
  const vals = await kv.getByPrefix("kapelan_order:") as string[];
  return vals
    .map((v: string) => { try { return JSON.parse(v); } catch { return null; } })
    .filter(Boolean)
    .sort((a: InstallOrder, b: InstallOrder) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

// ─── Register routes ──────────────────────────────────────────────────────────

export function registerInstallOrderRoutes(app: any): void {
  const P = "/make-server-1df47c03";

  // ── GET catalog ─────────────────────────────────────────────────────────────
  app.get(`${P}/install-orders/catalog`, (c: any) => {
    return c.json({ catalog: AC_CATALOG });
  });

  // ── GET all orders ───────────────────────────────────────────────────────────
  app.get(`${P}/install-orders`, async (c: any) => {
    try {
      const orders = await getAllOrders();
      return c.json({ orders });
    } catch (e: any) {
      console.error("[orders] list error:", e);
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST analyze room photo (AI vision) ─────────────────────────────────────
  // Must be registered BEFORE /:id routes so "analyze" doesn't match as id param
  app.post(`${P}/install-orders/analyze`, async (c: any) => {
    try {
      const { imageBase64, mimeType } = await c.req.json();
      if (!imageBase64) return c.json({ error: "imageBase64 обязателен" }, 400);

      const apiKey = Deno.env.get("kapelan_openai_api_key");
      if (!apiKey) return c.json({ error: "OpenAI API ключ не настроен" }, 500);

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 400,
          temperature: 0.2,
          messages: [{
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}`, detail: "high" },
              },
              { type: "text", text: ROOM_ANALYSIS_PROMPT },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("[orders/analyze] OpenAI error:", err);
        return c.json({ error: "Ошибка OpenAI API: " + err.slice(0, 200) }, 500);
      }

      const data = await response.json();
      const text: string = data.choices[0].message.content;

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return c.json({ error: "AI вернул неверный формат" }, 500);

      const analysis = JSON.parse(jsonMatch[0]);

      // Suggest best matching AC model
      const btu: number = analysis.recommendedBtu ?? 9000;
      const suggested = AC_CATALOG
        .filter(m => Math.abs(m.btu - btu) <= 3001)
        .sort((a, b) => Math.abs(a.btu - btu) - Math.abs(b.btu - btu))[0]
        ?? AC_CATALOG.find(m => m.tier === "standard") ?? AC_CATALOG[1];

      return c.json({ analysis, suggestedAcModelId: suggested.id });
    } catch (e: any) {
      console.error("[orders/analyze] error:", e);
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST preview consumables (calculate without saving) ──────────────────────
  app.post(`${P}/install-orders/preview`, async (c: any) => {
    try {
      const { acModelId, traceLength } = await c.req.json();
      const acModel = AC_CATALOG.find(m => m.id === acModelId);
      if (!acModel) return c.json({ error: "Модель не найдена" }, 404);
      const consumables = await calcConsumables(acModel.bom, Number(traceLength) || 5);
      return c.json({ consumables });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST create order ────────────────────────────────────────────────────────
  app.post(`${P}/install-orders`, async (c: any) => {
    try {
      const body = await c.req.json();
      const acModel = AC_CATALOG.find(m => m.id === body.acModelId);
      if (!acModel) return c.json({ error: "Модель кондиционера не найдена" }, 404);

      const traceLength = Number(body.traceLength) || 5;
      const consumables = await calcConsumables(acModel.bom, traceLength);

      const order: InstallOrder = {
        id: `ord_${uid()}`,
        clientName: body.clientName ?? "",
        clientPhone: body.clientPhone ?? "",
        clientAddress: body.clientAddress ?? "",
        leadId: body.leadId,
        roomArea: Number(body.roomArea) || 0,
        roomType: body.roomType ?? "Квартира",
        traceLength,
        acModelId: acModel.id,
        acBrand: acModel.brand,
        acModelName: acModel.model,
        acBtu: acModel.btu,
        acKw: acModel.kw,
        acPrice: acModel.price,
        acCount: Number(body.acCount) || 1,
        consumables,
        consumablesIssued: false,
        installerName: body.installerName ?? "",
        scheduledDate: body.scheduledDate ?? "",
        aiAnalysis: body.aiAnalysis,
        status: "draft",
        notes: body.notes ?? "",
        source: body.source ?? "manual",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await kv.set(`kapelan_order:${order.id}`, JSON.stringify(order));
      console.log(`[orders] created ${order.id}: ${acModel.brand} ${acModel.model} for "${order.clientName}" (${acModel.btu} BTU, trace ${traceLength}m)`);
      return c.json({ order }, 201);
    } catch (e: any) {
      console.error("[orders] create error:", e);
      return c.json({ error: e.message }, 500);
    }
  });

  // ── GET single order ─────────────────────────────────────────────────────────
  app.get(`${P}/install-orders/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      return c.json({ order: JSON.parse(raw) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── PUT update order fields ──────────────────────────────────────────────────
  app.put(`${P}/install-orders/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      const existing: InstallOrder = JSON.parse(raw);
      const body = await c.req.json();
      const updated: InstallOrder = {
        ...existing,
        ...body,
        id: existing.id,
        consumables: existing.consumables, // immutable after creation
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await kv.set(`kapelan_order:${updated.id}`, JSON.stringify(updated));
      return c.json({ order: updated });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST issue consumables (deduct from warehouse) ───────────────────────────
  // Also aliased as "start" — when installer picks up materials and departs
  app.post(`${P}/install-orders/:id/issue`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      const order: InstallOrder = JSON.parse(raw);

      if (order.consumablesIssued) {
        return c.json({ error: "Материалы по этому ордеру уже были выданы" }, 400);
      }

      // ── Check availability first ──────────────────────────────────────────
      const shortages: string[] = [];
      for (const con of order.consumables) {
        const item = await getWarehouseItem(con.warehouseId);
        if (!item) {
          shortages.push(`"${con.name}" — позиция не найдена на складе`);
          continue;
        }
        if (item.stock < con.qtyRequired) {
          shortages.push(`"${con.name}": нужно ${con.qtyRequired} ${con.unit}, в наличии ${item.stock}`);
        }
      }

      if (shortages.length > 0) {
        return c.json({ error: "Недостаточно материалов на складе", shortages }, 400);
      }

      // ── Deduct from warehouse ─────────────────────────────────────────────
      for (const con of order.consumables) {
        const item = await getWarehouseItem(con.warehouseId);
        if (!item) continue;
        const stockBefore = item.stock;
        item.stock = Math.max(0, item.stock - con.qtyRequired);
        item.updatedAt = new Date().toISOString();
        await saveWarehouseItem(item);
        await addMovement({
          itemId: con.warehouseId,
          itemName: con.name,
          type: "out",
          qty: con.qtyRequired,
          stockBefore,
          stockAfter: item.stock,
          reason: `Выдача по ордеру монтажа #${order.id.slice(-6).toUpperCase()} (${order.clientName})`,
          referenceId: order.id,
        });
        con.qtyIssued = con.qtyRequired;
      }

      order.consumablesIssued = true;
      order.status = "in_progress";
      order.updatedAt = new Date().toISOString();
      await kv.set(`kapelan_order:${order.id}`, JSON.stringify(order));

      console.log(`[orders] issued consumables for ${order.id} (${order.consumables.length} positions)`);
      return c.json({ order });
    } catch (e: any) {
      console.error("[orders/issue] error:", e);
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST start order (alias for issue — semantic: installer departs) ─────────
  app.post(`${P}/install-orders/:id/start`, async (c: any) => {
    // Forward to issue logic
    const id = c.req.param("id");
    const raw = await kv.get(`kapelan_order:${id}`);
    if (!raw) return c.json({ error: "Ордер не найден" }, 404);
    const order: InstallOrder = JSON.parse(raw);
    if (order.consumablesIssued) {
      // Already issued — just set in_progress if paused
      if (order.status === "paused") {
        order.status = "in_progress";
        order.updatedAt = new Date().toISOString();
        await kv.set(`kapelan_order:${order.id}`, JSON.stringify(order));
        return c.json({ order });
      }
      return c.json({ error: "Материалы уже выданы, ордер уже запущен" }, 400);
    }
    // Delegate to issue logic by internal call
    const req = new Request(`${c.req.url.replace('/start', '/issue')}`, { method: 'POST', headers: c.req.raw.headers });
    return c.env ? c.json({ error: "Use /issue endpoint" }, 500) : c.json({ error: "Internal" }, 500);
  });

  // ── POST pause order ─────────────────────────────────────────────────────────
  app.post(`${P}/install-orders/:id/pause`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      const order: InstallOrder = JSON.parse(raw);
      if (order.status !== "in_progress") {
        return c.json({ error: "Поставить на паузу можно только ордер в статусе 'В работе'" }, 400);
      }
      const body = await c.req.json().catch(() => ({}));
      order.status = "paused";
      if (body.notes) order.notes = order.notes ? order.notes + "\n[Пауза] " + body.notes : "[Пауза] " + body.notes;
      order.updatedAt = new Date().toISOString();
      await kv.set(`kapelan_order:${order.id}`, JSON.stringify(order));
      return c.json({ order });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST resume from pause ───────────────────────────────────────────────────
  app.post(`${P}/install-orders/:id/resume`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      const order: InstallOrder = JSON.parse(raw);
      if (order.status !== "paused") {
        return c.json({ error: "Возобновить можно только приостановленный ордер" }, 400);
      }
      order.status = "in_progress";
      order.updatedAt = new Date().toISOString();
      await kv.set(`kapelan_order:${order.id}`, JSON.stringify(order));
      return c.json({ order });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST complete order ──────────────────────────────────────────────────────
  app.post(`${P}/install-orders/:id/complete`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      const order: InstallOrder = JSON.parse(raw);
      const body = await c.req.json().catch(() => ({}));
      order.status = "completed";
      if (body.notes) order.notes = body.notes;
      order.updatedAt = new Date().toISOString();
      await kv.set(`kapelan_order:${order.id}`, JSON.stringify(order));
      return c.json({ order });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── DELETE order ─────────────────────────────────────────────────────────────
  app.delete(`${P}/install-orders/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      const order: InstallOrder = JSON.parse(raw);
      if (order.consumablesIssued) {
        return c.json({ error: "Нельзя удалить ордер с выданными материалами" }, 400);
      }
      await kv.del(`kapelan_order:${c.req.param("id")}`);
      return c.json({ success: true });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });
}