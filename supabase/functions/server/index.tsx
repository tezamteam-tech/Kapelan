import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js";
import * as kv from "./kv_store.tsx";
import { PDFDocument, rgb } from "npm:pdf-lib";
import fontkit from "npm:@pdf-lib/fontkit";
import { registerWarehouseRoutes, getAllWarehouseItems, getWarehouseItem as getWhItemById } from "./warehouse.tsx";
import { registerProcurementRoutes } from "./procurement.tsx";
import { registerRemindersRoutes, createServiceReminderForLead } from "./reminders.tsx";
import { registerVentilationRoutes } from "./ventilation.tsx";
import { registerTrainingRoutes } from "./training.tsx";
import { registerInstallOrderRoutes, AC_CATALOG } from "./orders.tsx";
import { registerEquipmentRoutes } from "./equipment.tsx";

const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Supabase client for storage
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const BUCKET_NAME = 'make-1df47c03-measurements';
const IMAGES_BUCKET = 'make-1df47c03-images';

// Initialize storage buckets on startup
async function initBucket() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketNames = buckets?.map((b: { name: string }) => b.name) ?? [];
    if (!bucketNames.includes(BUCKET_NAME)) {
      await supabase.storage.createBucket(BUCKET_NAME);
      console.log('Created storage bucket:', BUCKET_NAME);
    }
    if (!bucketNames.includes(IMAGES_BUCKET)) {
      await supabase.storage.createBucket(IMAGES_BUCKET, { public: false });
      console.log('Created images bucket:', IMAGES_BUCKET);
    }
  } catch (err) {
    console.error('Error initializing storage buckets:', err);
  }
}
initBucket();

// ─── Universal Image Upload ──────────────────────────────────────────────────
// POST /upload-image — multipart/form-data: file + folder
// Returns { url, path }
app.post('/make-server-1df47c03/upload-image', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    const folder = (formData.get('folder') as string | null) ?? 'misc';
    if (!file) return c.json({ error: 'No file provided' }, 400);
    if (!file.type.startsWith('image/')) return c.json({ error: 'Only image files allowed' }, 400);

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${folder}/${Date.now()}-${Math.random().toString(16).slice(2, 10)}.${ext}`;
    const uint8 = new Uint8Array(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(IMAGES_BUCKET)
      .upload(path, uint8, { contentType: file.type, upsert: false });
    if (uploadError) {
      console.error('Upload error:', uploadError);
      return c.json({ error: `Upload failed: ${uploadError.message}` }, 500);
    }

    // Signed URL valid for 1 year (31 536 000 s)
    const { data: signedData, error: signError } = await supabase.storage
      .from(IMAGES_BUCKET)
      .createSignedUrl(path, 31536000);
    if (signError || !signedData?.signedUrl) {
      console.error('Signed URL error:', signError);
      return c.json({ error: 'Could not create signed URL' }, 500);
    }
    console.log('Uploaded image:', path);
    return c.json({ url: signedData.signedUrl, path });
  } catch (err) {
    console.error('Upload endpoint error:', err);
    return c.json({ error: `Server error: ${err}` }, 500);
  }
});

// Health check endpoint
app.get("/make-server-1df47c03/health", (c) => {
  return c.json({ status: "ok" });
});

// System prompt for AI Sales Manager Agent
const AGENT_SYSTEM_PROMPT = `Ты — AI-ассистент менеджера компании Kapelan по установке кондиционеров.

ТВОЯ РОЛЬ — автоматизация работы менеджера. Выполняй реальные действия в CRM через инструменты.

РАБОЧИЙ ПРОЦЕСС (шаг за шагом):
1. search_warehouse_ac — подобрать кондиционер из РЕАЛЬНОГО склада по площади/бюджету (только то, что есть в наличии — stock > 0)
2. check_consumables_stock — проверить расходники и комплектующие для выбранной модели
3. create_installation_order — создать ордер монтажа (кондиционер + расходники + данные клиента)
4. assign_installer — назначить монтажника на ордер и задать дату монтажа
5. create_client_lead — только если нужна отдельная заявка без ордера

ПРАВИЛА:
1. ТОЛЬКО СО СКЛАДА — никогда не предлагай то, чего нет в наличии. Используй search_warehouse_ac.
2. ДЕЙСТВУЙ СРАЗУ — известна площадь? Немедленно вызывай search_warehouse_ac.
3. Длина трассы — 4 м по умолчанию, если не указана.
4. После создания ордера — предложи назначить монтажника.
5. Назначай монтажника, если менеджер указал дату или попросил назначить.
6. Пиши кратко и по делу после каждого шага.

СТИЛЬ: деловой, без воды. Emoji: ❄️ ✅ 📦 🔧 👷
ЯЗЫК: только русский. Никакого украинского.`;

// ─── AI Agent Tools Definition ─────────────────────────────────────────────────
const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_warehouse_ac",
      description: "Подобрать кондиционер/сплит/фанкойл из РЕАЛЬНОГО склада. Возвращает только позиции с остатком > 0. Вызывай сразу как известна площадь помещения.",
      parameters: {
        type: "object",
        properties: {
          area:          { type: "number", description: "Площадь помещения в кв.м" },
          budget:        { type: "number", description: "Максимальный бюджет в гривнах (необязательно)" },
          tier:          { type: "string", enum: ["economy", "standard", "premium"], description: "Ценовой сегмент (необязательно)" },
          equipmentType: { type: "string", enum: ["split_ac", "fan_coil", "chiller", "any"], description: "Тип оборудования: split_ac/fan_coil/chiller/any (по умолчанию any)" }
        },
        required: ["area"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "check_consumables_stock",
      description: "Проверить наличие расходников и комплектующих на складе для монтажа выбранного кондиционера. Используй warehouseAcId из search_warehouse_ac.",
      parameters: {
        type: "object",
        properties: {
          warehouseAcId: { type: "string", description: "ID позиции кондиционера на складе (из результата search_warehouse_ac)" },
          traceLength:   { type: "number", description: "Длина фреоновой трассы в метрах (по умолчанию 4)" }
        },
        required: ["warehouseAcId", "traceLength"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_installation_order",
      description: "Создать ордер монтажа в CRM. Обязательно: имя клиента, телефон, ID кондиционера со склада, площадь помещения.",
      parameters: {
        type: "object",
        properties: {
          clientName:    { type: "string", description: "Имя клиента" },
          clientPhone:   { type: "string", description: "Телефон клиента" },
          clientAddress: { type: "string", description: "Адрес монтажа (если неизвестен — 'Уточнить')" },
          warehouseAcId: { type: "string", description: "ID позиции кондиционера на складе" },
          roomArea:      { type: "number", description: "Площадь помещения в кв.м" },
          roomType:      { type: "string", description: "Тип помещения (квартира / офис / склад / магазин)" },
          traceLength:   { type: "number", description: "Длина трассы в метрах (по умолчанию 4)" },
          acCount:       { type: "number", description: "Количество кондиционеров (по умолчанию 1)" },
          notes:         { type: "string", description: "Примечания к заказу" }
        },
        required: ["clientName", "clientPhone", "warehouseAcId", "roomArea"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "assign_installer",
      description: "Назначить монтажника на ордер монтажа. Можно указать конкретное имя или система выберет первого доступного. Дата необязательна.",
      parameters: {
        type: "object",
        properties: {
          orderId:       { type: "string", description: "ID ордера монтажа" },
          installerName: { type: "string", description: "Имя монтажника (если уже известно)" },
          scheduledDate: { type: "string", description: "Дата монтажа в формате YYYY-MM-DD (необязательно)" }
        },
        required: ["orderId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_client_lead",
      description: "Создать заявку (лид) клиента в CRM без создания ордера монтажа. Используй, если клиент ещё не готов к монтажу.",
      parameters: {
        type: "object",
        properties: {
          clientName:  { type: "string", description: "Имя клиента" },
          clientPhone: { type: "string", description: "Телефон клиента" },
          clientEmail: { type: "string", description: "Email клиента (необязательно)" },
          area:        { type: "number", description: "Площадь помещения в кв.м (необязательно)" },
          roomType:    { type: "string", description: "Тип помещения (необязательно)" },
          budget:      { type: "number", description: "Бюджет клиента в гривнах (необязательно)" },
          notes:       { type: "string", description: "Дополнительные примечания (необязательно)" }
        },
        required: ["clientName", "clientPhone"]
      }
    }
  }
];

// ─── Standard BOM (расходники для сплит-систем) ───────────────────────────────
const STD_SPLIT_BOM = [
  { warehouseId: "wh_pipe_14",    name: 'Медная труба 1/4" (жидкостная)', unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  { warehouseId: "wh_pipe_38",    name: 'Медная труба 3/8" (газовая)',     unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  { warehouseId: "wh_insul_14",   name: "Теплоизоляция 9мм",              unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  { warehouseId: "wh_insul_38",   name: "Теплоизоляция 13мм",             unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  { warehouseId: "wh_drain_pipe", name: "Дренажная труба ø16мм",          unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  { warehouseId: "wh_cable",      name: "Кабель питания 3×1.5мм²",        unit: "м",     qtyFixed: 3,  qtyPerMeter: 1 },
  { warehouseId: "wh_cable_duct", name: "Кабельный канал 60×40",          unit: "м",     qtyFixed: 1,  qtyPerMeter: 1 },
  { warehouseId: "wh_brackets",   name: "Кронштейны наружного блока",     unit: "компл", qtyFixed: 1,  qtyPerMeter: 0 },
  { warehouseId: "wh_dowels",     name: "Дюбель-шуруп 6×60",             unit: "шт",    qtyFixed: 12, qtyPerMeter: 0 },
  { warehouseId: "wh_clamps",     name: "Хомуты для труб",                unit: "шт",    qtyFixed: 4,  qtyPerMeter: 2 },
  { warehouseId: "wh_freon",      name: "Фреон R32 (буфер дозаправки)",   unit: "кг",    qtyFixed: 1,  qtyPerMeter: 0 },
  { warehouseId: "wh_sealant",    name: "Герметик силиконовый",           unit: "шт",    qtyFixed: 1,  qtyPerMeter: 0 },
  { warehouseId: "wh_gland",      name: "Сальники кабельного ввода",      unit: "шт",    qtyFixed: 2,  qtyPerMeter: 0 },
  { warehouseId: "wh_tape",       name: "Самовулканизирующаяся лента",    unit: "м",     qtyFixed: 2,  qtyPerMeter: 0 },
];

const FAN_COIL_BOM_AI = [
  { warehouseId: "wh_ppr_pipe_20", name: "Труба ППР 20мм",                unit: "м",     qtyFixed: 4,  qtyPerMeter: 1 },
  { warehouseId: "wh_insul_19",   name: "Теплоизоляция 19мм",             unit: "м",     qtyFixed: 4,  qtyPerMeter: 1 },
  { warehouseId: "wh_ball_valve", name: 'Шаровой кран 3/4"',              unit: "шт",    qtyFixed: 2,  qtyPerMeter: 0 },
  { warehouseId: "wh_flex_conn",  name: "Гибкая подводка 3/4\"",          unit: "компл", qtyFixed: 1,  qtyPerMeter: 0 },
  { warehouseId: "wh_motor_valve",name: "Моторизированный клапан",        unit: "шт",    qtyFixed: 1,  qtyPerMeter: 0 },
  { warehouseId: "wh_drain_pipe", name: "Дренажная труба ø16мм",          unit: "м",     qtyFixed: 3,  qtyPerMeter: 0.5 },
  { warehouseId: "wh_cable",      name: "Кабель питания 3×1.5мм²",        unit: "м",     qtyFixed: 3,  qtyPerMeter: 1 },
  { warehouseId: "wh_cable_duct", name: "Кабельный канал 60×40",          unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  { warehouseId: "wh_dowels",     name: "Дюбель-шуруп 6×60",             unit: "шт",    qtyFixed: 8,  qtyPerMeter: 0 },
  { warehouseId: "wh_sealant",    name: "Герметик силиконовый",           unit: "шт",    qtyFixed: 1,  qtyPerMeter: 0 },
];

// Default installers seed
const DEFAULT_INSTALLERS = [
  { id: "inst_01", name: "Алексей Коваль",    phone: "+380971234501", level: "master",    status: "available", certYear: 2026 },
  { id: "inst_02", name: "Дмитрий Шевченко",  phone: "+380971234502", level: "specialist",status: "available", certYear: 2026 },
  { id: "inst_03", name: "Иван Бондаренко",   phone: "+380971234503", level: "installer", status: "available", certYear: 2025 },
  { id: "inst_04", name: "Николай Петренко",  phone: "+380971234504", level: "master",    status: "busy",      certYear: 2026 },
  { id: "inst_05", name: "Сергей Лысенко",    phone: "+380971234505", level: "specialist",status: "available", certYear: 2026 },
];

async function getInstallers() {
  const all = await kv.getByPrefix("kapelan_installer:") as string[];
  if (all.length > 0) return all.map((v: string) => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
  for (const inst of DEFAULT_INSTALLERS) await kv.set(`kapelan_installer:${inst.id}`, JSON.stringify(inst));
  return DEFAULT_INSTALLERS;
}

// ─── Tool execution ────────────────────────────────────────────────────────────
async function executeAgentTool(name: string, args: any): Promise<{ result: string; action: any }> {
  try {
    // ── 1. Search warehouse for AC equipment ──────────────────────────────────
    if (name === "search_warehouse_ac") {
      const { area, budget, tier, equipmentType } = args;
      const allItems = await getAllWarehouseItems();
      // Filter equipment items with acSpecs and stock > 0
      let matches = allItems.filter((item: any) =>
        item.itemType === 'equipment' &&
        item.acSpecs &&
        item.stock > 0 &&
        area >= (item.acSpecs.areaMin ?? 0) - 5 &&
        area <= (item.acSpecs.areaMax ?? 9999) + 5
      );
      if (tier) matches = matches.filter((item: any) => item.acSpecs?.tier === tier);
      if (budget) matches = matches.filter((item: any) => item.price <= budget);
      if (equipmentType && equipmentType !== "any") matches = matches.filter((item: any) => item.acSpecs?.equipmentType === equipmentType);
      matches.sort((a: any, b: any) => a.price - b.price);
      const top3 = matches.slice(0, 3);
      if (top3.length === 0) {
        // Fallback: show all available AC equipment
        const allAc = allItems.filter((i: any) => i.itemType === 'equipment' && i.acSpecs && i.stock > 0);
        if (allAc.length === 0) return { result: "На складе нет оборудования в наличии. Обратитесь в отдел закупок.", action: null };
        const closest = allAc.sort((a: any, b: any) => Math.abs((a.acSpecs?.areaMin + a.acSpecs?.areaMax) / 2 - area) - Math.abs((b.acSpecs?.areaMin + b.acSpecs?.areaMax) / 2 - area)).slice(0, 3);
        return {
          result: JSON.stringify(closest.map((i: any) => ({ id: i.id, name: i.name, btu: i.acSpecs?.btu, kw: i.acSpecs?.kw, areaMin: i.acSpecs?.areaMin, areaMax: i.acSpecs?.areaMax, tier: i.acSpecs?.tier, price: i.price, stock: i.stock, features: i.acSpecs?.features, warranty: i.acSpecs?.warranty, equipmentType: i.acSpecs?.equipmentType }))),
          action: { type: "ac_selected", title: `Подобрано ${closest.length} позиции со склада`, data: closest }
        };
      }
      return {
        result: JSON.stringify(top3.map((i: any) => ({ id: i.id, name: i.name, btu: i.acSpecs?.btu, kw: i.acSpecs?.kw, areaMin: i.acSpecs?.areaMin, areaMax: i.acSpecs?.areaMax, tier: i.acSpecs?.tier, price: i.price, stock: i.stock, features: i.acSpecs?.features, warranty: i.acSpecs?.warranty, equipmentType: i.acSpecs?.equipmentType }))),
        action: { type: "ac_selected", title: `Подобрано ${top3.length} позиции со склада`, data: top3 }
      };
    }

    // ── 2. Check consumables ───────────────────────────────────────────────────
    if (name === "check_consumables_stock") {
      const { warehouseAcId, traceLength } = args;
      const tl = Number(traceLength) || 4;
      const allItems = await getAllWarehouseItems();
      const whMap = new Map(allItems.map((i: any) => [i.id, i]));
      const acItem: any = whMap.get(warehouseAcId);
      if (!acItem) return { result: `Позиция ${warehouseAcId} не найдена на складе`, action: null };
      const isFanCoil = acItem.acSpecs?.equipmentType === 'fan_coil';
      const bom = isFanCoil ? FAN_COIL_BOM_AI : STD_SPLIT_BOM;
      const items = bom.map((entry: any) => {
        const qty = Math.ceil(entry.qtyFixed + entry.qtyPerMeter * tl);
        const stockItem: any = whMap.get(entry.warehouseId);
        const stock = stockItem?.stock ?? 0;
        return { id: entry.warehouseId, name: entry.name, unit: entry.unit, qty, stock, inStock: stock >= qty, price: stockItem?.price ?? 0 };
      });
      const allInStock = items.every((i: any) => i.inStock);
      const shortages = items.filter((i: any) => !i.inStock);
      return {
        result: JSON.stringify({ items, allInStock, shortages: shortages.map((s: any) => s.name), traceLength: tl }),
        action: { type: "consumables_checked", title: allInStock ? "Все расходники в наличии ✅" : `Не хватает: ${shortages.length} поз. ⚠️`, data: { items, allInStock, traceLength: tl, acName: acItem.name } }
      };
    }

    // ── 3. Create order ────────────────────────────────────────────────────────
    if (name === "create_installation_order") {
      const { clientName, clientPhone, clientAddress, warehouseAcId, roomArea, roomType, traceLength, acCount, notes } = args;
      const allItems = await getAllWarehouseItems();
      const whMap = new Map(allItems.map((i: any) => [i.id, i]));
      const acItem: any = whMap.get(warehouseAcId);
      if (!acItem) return { result: `Позиция ${warehouseAcId} не найдена на складе`, action: null };
      const tl = Number(traceLength) || 4;
      const count = Number(acCount) || 1;
      const isFanCoil = acItem.acSpecs?.equipmentType === 'fan_coil';
      const bom = isFanCoil ? FAN_COIL_BOM_AI : STD_SPLIT_BOM;
      const consumables = bom.map((entry: any) => {
        const si: any = whMap.get(entry.warehouseId);
        return {
          warehouseId: entry.warehouseId, name: entry.name, unit: entry.unit,
          qtyRequired: Math.ceil((entry.qtyFixed + entry.qtyPerMeter * tl) * count),
          qtyIssued: 0, stockSnapshot: si?.stock ?? 0
        };
      });
      // Add the AC unit itself as a consumable line
      consumables.unshift({ warehouseId: acItem.id, name: acItem.name, unit: "шт", qtyRequired: count, qtyIssued: 0, stockSnapshot: acItem.stock });
      const client = await findOrCreateClient({ name: clientName, phone: clientPhone });
      const leadId = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const lead = {
        id: leadId, clientId: client.id, status: "deal", source: "ai_manager",
        requirements_json: { area: roomArea, roomType: roomType || "квартира" },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      await kv.set(`lead:${leadId}`, JSON.stringify(lead));
      try {
        const leadsIdx = await kv.get(`leads_by_client:${client.id}`);
        const arr = leadsIdx ? JSON.parse(leadsIdx) : [];
        arr.push(leadId); await kv.set(`leads_by_client:${client.id}`, JSON.stringify(arr));
      } catch {}
      const orderId = `ord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const order = {
        id: orderId, clientName, clientPhone,
        clientAddress: clientAddress || "Уточнити адресу",
        leadId, roomArea, roomType: roomType || "квартира", traceLength: tl,
        acModelId: acItem.acSpecs?.equipmentId || acItem.id,
        warehouseAcId: acItem.id,
        acBrand: acItem.name.split(" ")[0],
        acModelName: acItem.name,
        acBtu: acItem.acSpecs?.btu, acKw: acItem.acSpecs?.kw,
        acPrice: acItem.price, acCount: count,
        consumables, consumablesIssued: false,
        installerName: "", scheduledDate: "",
        status: "draft", notes: notes || "", source: "ai",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      await kv.set(`kapelan_order:${orderId}`, JSON.stringify(order));
      try {
        const idxRaw = await kv.get('kapelan_orders_index');
        const idx = idxRaw ? JSON.parse(idxRaw) : [];
        idx.unshift(orderId); await kv.set('kapelan_orders_index', JSON.stringify(idx));
      } catch {}
      try {
        await sendTelegramMessage(
          `🔧 <b>Ордер создан AI-менеджером!</b>\n\n👤 Клиент: <b>${clientName}</b>\n📞 ${clientPhone}\n❄️ ${acItem.name}\n📐 ${roomArea} м²\n🔖 ID: ${orderId.substring(0, 20)}\n🕐 ${new Date().toLocaleString('ru-RU')}`
        );
      } catch {}
      return {
        result: JSON.stringify({ orderId, status: "draft", clientName, acName: acItem.name, price: acItem.price, leadId }),
        action: { type: "order_created", title: "Ордер монтажа создан ✅", data: { order, client, acItem } }
      };
    }

    // ── 4. Assign installer ────────────────────────────────────────────────────
    if (name === "assign_installer") {
      const { orderId, installerName, scheduledDate } = args;
      const installers = await getInstallers();
      const available = installers.filter((i: any) => i.status === "available");
      // Find order
      const orderRaw = await kv.get(`kapelan_order:${orderId}`);
      if (!orderRaw) return { result: `Ордер ${orderId} не знайдено`, action: null };
      const order: any = JSON.parse(orderRaw);
      // Pick installer
      let assigned = installers.find((i: any) => i.name === installerName) ?? available[0];
      if (!assigned) return { result: "Нет доступных монтажников", action: { type: "installer_assigned", title: "Нет монтажников", data: { installers, orderId } } };
      order.installerName = assigned.name;
      order.installerPhone = assigned.phone;
      order.scheduledDate = scheduledDate || "";
      order.status = "assigned";
      order.updatedAt = new Date().toISOString();
      await kv.set(`kapelan_order:${orderId}`, JSON.stringify(order));
      // Mark installer as busy if date set
      if (scheduledDate) {
        assigned.status = "busy";
        await kv.set(`kapelan_installer:${assigned.id}`, JSON.stringify(assigned));
      }
      try {
        await sendTelegramMessage(
          `👷 <b>Монтажник назначен!</b>\n\n🔖 Ордер: ${orderId.slice(-8)}\n👤 Клиент: ${order.clientName}\n🔧 Монтажник: <b>${assigned.name}</b>\n📅 Дата: ${scheduledDate || "Не указана"}`
        );
      } catch {}
      return {
        result: JSON.stringify({ orderId, installerName: assigned.name, scheduledDate, status: "assigned", availableInstallers: available.length }),
        action: { type: "installer_assigned", title: `Монтажник назначен: ${assigned.name}`, data: { installer: assigned, orderId, order, availableInstallers: installers } }
      };
    }

    if (name === "create_client_lead") {
      const { clientName, clientPhone, clientEmail, area, roomType, budget, notes } = args;
      const client = await findOrCreateClient({ name: clientName, phone: clientPhone, email: clientEmail });
      const leadId = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const lead = {
        id: leadId, clientId: client.id, status: "new", source: "ai_manager",
        requirements_json: { area, roomType, budget, additionalNotes: notes },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      await kv.set(`lead:${leadId}`, JSON.stringify(lead));
      try {
        const leadsIdx = await kv.get(`leads_by_client:${client.id}`);
        const arr = leadsIdx ? JSON.parse(leadsIdx) : [];
        arr.push(leadId);
        await kv.set(`leads_by_client:${client.id}`, JSON.stringify(arr));
      } catch {}
      return {
        result: JSON.stringify({ leadId, clientName: client.name, status: "new" }),
        action: { type: "lead_created", title: "Заявка клиента создана", data: { lead, client } }
      };
    }

    return { result: "Инструмент не найден", action: null };
  } catch (err: any) {
    console.error(`Tool execution error [${name}]:`, err);
    return { result: `Ошибка выполнения: ${err.message}`, action: null };
  }
}

// Chat endpoint with OpenAI Agent (function calling loop)
app.post("/make-server-1df47c03/chat", async (c) => {
  try {
    const { sessionId, message, history } = await c.req.json();
    
    if (!sessionId || !message) {
      return c.json({ error: "sessionId and message are required" }, 400);
    }

    const apiKey = Deno.env.get("kapelan_openai_api_key");
    if (!apiKey) {
      console.error("OpenAI API key not configured");
      return c.json({ error: "OpenAI API key not configured" }, 500);
    }

    // Build messages (only user/assistant roles for history)
    const oaiMessages: any[] = [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      ...(history || []).filter((m: any) => m.role === "user" || m.role === "assistant"),
      { role: "user", content: message }
    ];

    const collectedActions: any[] = [];
    let finalMessage = "";
    let maxIter = 6;

    while (maxIter-- > 0) {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: oaiMessages,
          tools: AGENT_TOOLS,
          tool_choice: "auto",
          temperature: 0.3,
          max_tokens: 1200
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("OpenAI API error:", errText);
        return c.json({ error: "Failed to get response from AI" }, 500);
      }

      const data = await resp.json();
      const aiMsg = data.choices[0].message;
      oaiMessages.push(aiMsg);

      if (!aiMsg.tool_calls || aiMsg.tool_calls.length === 0) {
        finalMessage = aiMsg.content || "";
        break;
      }

      // Execute all tool calls
      const toolResults = await Promise.all(
        aiMsg.tool_calls.map(async (toolCall: any) => {
          let args: any = {};
          try { args = JSON.parse(toolCall.function.arguments); } catch {}
          const { result, action } = await executeAgentTool(toolCall.function.name, args);
          if (action) collectedActions.push(action);
          return { tool_call_id: toolCall.id, role: "tool" as const, content: result };
        })
      );
      oaiMessages.push(...toolResults);
    }

    // Save clean history
    const updatedHistory = [
      ...(history || []).filter((m: any) => m.role === "user" || m.role === "assistant"),
      { role: "user", content: message },
      { role: "assistant", content: finalMessage }
    ];
    await kv.set(`chat_session:${sessionId}`, JSON.stringify(updatedHistory));

    // ── Save / update session metadata ────────────────────────────────────────
    const existingMeta = await kv.get(`chat_meta:${sessionId}`);
    const metaParsed = existingMeta ? JSON.parse(existingMeta) : null;
    const sessionTitle = metaParsed?.title || message.substring(0, 60) + (message.length > 60 ? "…" : "");
    const actionsCount = (metaParsed?.actionsCount ?? 0) + collectedActions.length;
    const sessionMeta = {
      id: sessionId,
      title: sessionTitle,
      createdAt: metaParsed?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMessage: message.substring(0, 80),
      lastReply: finalMessage.substring(0, 80),
      actionsCount,
      completed: !!(collectedActions.find(a => a.type === "order_created") || collectedActions.find(a => a.type === "lead_created")),
      messageCount: updatedHistory.length
    };
    await kv.set(`chat_meta:${sessionId}`, JSON.stringify(sessionMeta));
    // Add to sessions index if new
    if (!metaParsed) {
      const idxRaw = await kv.get("chat_sessions_index");
      const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
      if (!idx.includes(sessionId)) {
        idx.unshift(sessionId);
        await kv.set("chat_sessions_index", JSON.stringify(idx.slice(0, 200)));
      }
    }

    const orderAction = collectedActions.find(a => a.type === "order_created");
    const leadAction = collectedActions.find(a => a.type === "lead_created");

    return c.json({
      message: finalMessage,
      actions: collectedActions,
      completed: !!(orderAction || leadAction),
      lead: orderAction?.data?.order ? { id: orderAction.data.order.leadId, orderId: orderAction.data.order.id } : leadAction?.data?.lead || null,
      client: orderAction?.data?.client || leadAction?.data?.client || null,
      sessionId
    });

  } catch (error: any) {
    console.error("Error in chat endpoint:", error);
    return c.json({ error: `Failed to process chat: ${error.message}` }, 500);
  }
});

// Get chat history
app.get("/make-server-1df47c03/chat-history/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const historyData = await kv.get(`chat_session:${sessionId}`);
    
    if (!historyData) {
      return c.json({ history: [] });
    }

    const history = JSON.parse(historyData);
    return c.json({ history });

  } catch (error) {
    console.error("Error fetching chat history:", error);
    return c.json({ error: `Failed to fetch chat history: ${error.message}` }, 500);
  }
});

// ─── Installers API ────────────────────────────────────────────────────────────
app.get("/make-server-1df47c03/installers", async (c) => {
  try {
    const installers = await getInstallers();
    return c.json({ installers });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/make-server-1df47c03/installers", async (c) => {
  try {
    const body = await c.req.json();
    const id = body.id || `inst_${Date.now()}`;
    const installer = { id, name: body.name, phone: body.phone || "", level: body.level || "installer", status: body.status || "available", certYear: body.certYear || new Date().getFullYear() };
    await kv.set(`kapelan_installer:${id}`, JSON.stringify(installer));
    return c.json({ installer });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.patch("/make-server-1df47c03/installers/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const raw = await kv.get(`kapelan_installer:${id}`);
    if (!raw) return c.json({ error: "Installer not found" }, 404);
    const installer = { ...JSON.parse(raw), ...await c.req.json() };
    await kv.set(`kapelan_installer:${id}`, JSON.stringify(installer));
    return c.json({ installer });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// POST assign installer to order
app.post("/make-server-1df47c03/install-orders/:id/assign", async (c) => {
  try {
    const orderId = c.req.param("id");
    const raw = await kv.get(`kapelan_order:${orderId}`);
    if (!raw) return c.json({ error: "Ордер не найден" }, 404);
    const order: any = JSON.parse(raw);
    const { installerName, installerPhone, scheduledDate } = await c.req.json();
    order.installerName = installerName || "";
    order.installerPhone = installerPhone || "";
    order.scheduledDate = scheduledDate || "";
    if (order.status === "draft" || order.status === "confirmed") order.status = "assigned";
    order.updatedAt = new Date().toISOString();
    await kv.set(`kapelan_order:${orderId}`, JSON.stringify(order));
    return c.json({ order });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Chat Sessions List ────────────────────────────────────────────────────────
// GET /chat-sessions — list all conversations (metadata only, newest first)
app.get("/make-server-1df47c03/chat-sessions", async (c) => {
  try {
    const idxRaw = await kv.get("chat_sessions_index");
    const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
    const sessions = (await Promise.all(
      idx.map(async (sid) => {
        const raw = await kv.get(`chat_meta:${sid}`);
        return raw ? JSON.parse(raw) : null;
      })
    )).filter(Boolean);
    // Sort by updatedAt desc
    sessions.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return c.json({ sessions });
  } catch (err: any) {
    console.error("Error listing chat sessions:", err);
    return c.json({ error: err.message }, 500);
  }
});

// GET /chat-session/:sessionId — full session (meta + history + actions)
app.get("/make-server-1df47c03/chat-session/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const [metaRaw, histRaw, actionsRaw] = await Promise.all([
      kv.get(`chat_meta:${sessionId}`),
      kv.get(`chat_session:${sessionId}`),
      kv.get(`chat_actions:${sessionId}`)
    ]);
    return c.json({
      meta: metaRaw ? JSON.parse(metaRaw) : null,
      history: histRaw ? JSON.parse(histRaw) : [],
      actions: actionsRaw ? JSON.parse(actionsRaw) : []
    });
  } catch (err: any) {
    console.error("Error fetching chat session:", err);
    return c.json({ error: err.message }, 500);
  }
});

// DELETE /chat-session/:sessionId — remove a conversation
app.delete("/make-server-1df47c03/chat-session/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    await Promise.all([
      kv.del(`chat_meta:${sessionId}`),
      kv.del(`chat_session:${sessionId}`),
      kv.del(`chat_actions:${sessionId}`)
    ]);
    // Remove from index
    const idxRaw = await kv.get("chat_sessions_index");
    if (idxRaw) {
      const idx: string[] = JSON.parse(idxRaw);
      await kv.set("chat_sessions_index", JSON.stringify(idx.filter(id => id !== sessionId)));
    }
    return c.json({ success: true });
  } catch (err: any) {
    console.error("Error deleting chat session:", err);
    return c.json({ error: err.message }, 500);
  }
});

// POST /chat-session-actions/:sessionId — save full actions log for a session
app.post("/make-server-1df47c03/chat-session-actions/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const { actions } = await c.req.json();
    await kv.set(`chat_actions:${sessionId}`, JSON.stringify(actions || []));
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Save requirements manually
app.post("/make-server-1df47c03/save-requirements", async (c) => {
  try {
    const { sessionId, requirements } = await c.req.json();
    
    if (!sessionId || !requirements) {
      return c.json({ error: "sessionId and requirements are required" }, 400);
    }

    await kv.set(`requirements:${sessionId}`, JSON.stringify(requirements));
    
    return c.json({ success: true });

  } catch (error) {
    console.error("Error saving requirements:", error);
    return c.json({ error: `Failed to save requirements: ${error.message}` }, 500);
  }
});

// Get requirements
app.get("/make-server-1df47c03/requirements/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const requirementsData = await kv.get(`requirements:${sessionId}`);
    
    if (!requirementsData) {
      return c.json({ requirements: null });
    }

    const requirements = JSON.parse(requirementsData);
    return c.json({ requirements });

  } catch (error) {
    console.error("Error fetching requirements:", error);
    return c.json({ error: `Failed to fetch requirements: ${error.message}` }, 500);
  }
});

// Helper function to find or create client
async function findOrCreateClient(clientData: { name: string; phone: string; email?: string | null }) {
  try {
    // Search for existing client by phone
    const clientsData = await kv.getByPrefix("client:");
    
    for (const value of clientsData) {
      const client = JSON.parse(value);
      if (client.phone === clientData.phone) {
        console.log("Found existing client:", client.id);
        return client;
      }
    }

    // Create new client
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newClient = {
      id: clientId,
      name: clientData.name,
      phone: clientData.phone,
      email: clientData.email || null,
      type: "individual",
      notes: "",
      createdAt: new Date().toISOString()
    };

    await kv.set(`client:${clientId}`, JSON.stringify(newClient));
    console.log("Created new client:", clientId);
    
    return newClient;
  } catch (error) {
    console.error("Error in findOrCreateClient:", error);
    throw error;
  }
}

// Create lead from session
app.post("/make-server-1df47c03/create-lead", async (c) => {
  try {
    const { sessionId, clientData, requirements } = await c.req.json();
    
    if (!sessionId || !clientData || !requirements) {
      return c.json({ error: "sessionId, clientData, and requirements are required" }, 400);
    }

    // Find or create client
    const client = await findOrCreateClient(clientData);

    // Create lead
    const leadId = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const lead = {
      id: leadId,
      clientId: client.id,
      status: "new",
      source: "ai_chat",
      sessionId: sessionId,
      requirements_json: requirements,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await kv.set(`lead:${leadId}`, JSON.stringify(lead));
    
    // Update client's leads list
    const clientLeadsKey = `leads_by_client:${client.id}`;
    const existingLeadsData = await kv.get(clientLeadsKey);
    const existingLeads = existingLeadsData ? JSON.parse(existingLeadsData) : [];
    existingLeads.push(leadId);
    await kv.set(clientLeadsKey, JSON.stringify(existingLeads));

    console.log("Created lead:", leadId, "for client:", client.id);

    return c.json({
      success: true,
      client: client,
      lead: lead
    });

  } catch (error) {
    console.error("Error creating lead:", error);
    return c.json({ error: `Failed to create lead: ${error.message}` }, 500);
  }
});

// Update lead status
app.post("/make-server-1df47c03/update-lead-status", async (c) => {
  try {
    const { leadId, status } = await c.req.json();
    
    if (!leadId || !status) {
      return c.json({ error: "leadId and status are required" }, 400);
    }

    const validStatuses = ["new", "measurement", "offer", "deal", "done"];
    if (!validStatuses.includes(status)) {
      return c.json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` }, 400);
    }

    const leadData = await kv.get(`lead:${leadId}`);
    if (!leadData) {
      return c.json({ error: "Lead not found" }, 404);
    }

    const lead = JSON.parse(leadData);
    const prevStatus = lead.status;
    lead.status = status;
    lead.updatedAt = new Date().toISOString();

    await kv.set(`lead:${leadId}`, JSON.stringify(lead));

    // ── Auto-create service reminder when installation is done ────────────────
    if (status === "done" && prevStatus !== "done") {
      try {
        const clientData = await kv.get(`client:${lead.clientId}`);
        const client = clientData ? JSON.parse(clientData) : null;
        if (client) {
          // Try to get AC model from offer
          let acModel: string | null = null;
          try {
            const offerIdRaw = await kv.get(`offer_by_lead:${leadId}`);
            if (offerIdRaw) {
              const offerRaw = await kv.get(`offer:${offerIdRaw}`);
              if (offerRaw) {
                const offer = JSON.parse(offerRaw);
                const recommended = offer.variants?.find((v: any) => v.isRecommended) ?? offer.variants?.[0];
                if (recommended?.ac?.name) acModel = `${recommended.ac.name} (${recommended.ac.btu / 1000}kBTU)`;
              }
            }
          } catch { /* silent */ }

          const reminder = await createServiceReminderForLead(
            leadId,
            client.id,
            client.name,
            client.phone,
            client.email,
            acModel,
            null, // address (not stored yet)
          );

          // Notify admin in TG about new reminder creation
          try {
            const dueDate = new Date(reminder.reminderDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
            await sendTelegramMessage(
              `✅ <b>Монтаж завершён!</b>\n\n👤 Клиент: <b>${client.name}</b>\n📞 ${client.phone}\n${acModel ? `❄️ ${acModel}\n` : ""}` +
              `\n🔔 Напоминание о ТО создано автоматически\n📅 Дата ТО: <b>${dueDate}</b>\n\n🕐 ${new Date().toLocaleString("ru-RU")}`
            );
          } catch { /* silent */ }

          lead._serviceReminderId = reminder.id;
          await kv.set(`lead:${leadId}`, JSON.stringify(lead));
          console.log(`ServiceReminder auto-created for lead ${leadId}: ${reminder.id}`);
        }
      } catch (remErr) {
        console.error("Auto-create reminder error:", remErr);
      }
    }

    return c.json({ success: true, lead });

  } catch (error) {
    console.error("Error updating lead status:", error);
    return c.json({ error: `Failed to update lead status: ${error.message}` }, 500);
  }
});

// Get lead by ID
app.get("/make-server-1df47c03/lead/:leadId", async (c) => {
  try {
    const leadId = c.req.param("leadId");
    const leadData = await kv.get(`lead:${leadId}`);
    
    if (!leadData) {
      return c.json({ error: "Lead not found" }, 404);
    }

    const lead = JSON.parse(leadData);
    
    // Get client data
    const clientData = await kv.get(`client:${lead.clientId}`);
    const client = clientData ? JSON.parse(clientData) : null;

    return c.json({ lead, client });

  } catch (error) {
    console.error("Error fetching lead:", error);
    return c.json({ error: `Failed to fetch lead: ${error.message}` }, 500);
  }
});

// Get all leads
app.get("/make-server-1df47c03/leads", async (c) => {
  try {
    const leadsData = await kv.getByPrefix("lead:");
    const leads = leadsData.map(data => JSON.parse(data));
    
    // Sort by createdAt desc
    leads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return c.json({ leads });

  } catch (error) {
    console.error("Error fetching leads:", error);
    return c.json({ error: `Failed to fetch leads: ${error.message}` }, 500);
  }
});

// Get client by ID
app.get("/make-server-1df47c03/client/:clientId", async (c) => {
  try {
    const clientId = c.req.param("clientId");
    const clientData = await kv.get(`client:${clientId}`);
    
    if (!clientData) {
      return c.json({ error: "Client not found" }, 404);
    }

    const client = JSON.parse(clientData);
    
    // Get client's leads
    const leadsListData = await kv.get(`leads_by_client:${clientId}`);
    const leadsList = leadsListData ? JSON.parse(leadsListData) : [];
    
    const leads = [];
    for (const leadId of leadsList) {
      const leadData = await kv.get(`lead:${leadId}`);
      if (leadData) {
        leads.push(JSON.parse(leadData));
      }
    }

    return c.json({ client, leads });

  } catch (error) {
    console.error("Error fetching client:", error);
    return c.json({ error: `Failed to fetch client: ${error.message}` }, 500);
  }
});

// ─── MEASUREMENT ENDPOINTS ───────────────────────────────────────────────────

// Upload photo for a lead measurement
app.post("/make-server-1df47c03/upload-photo", async (c) => {
  try {
    const formData = await c.req.formData();
    const photo = formData.get('photo') as File;
    const leadId = formData.get('leadId') as string;

    if (!photo || !leadId) {
      return c.json({ error: 'photo and leadId are required' }, 400);
    }

    const fileName = `${leadId}/${Date.now()}_${photo.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const arrayBuffer = await photo.arrayBuffer();

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, arrayBuffer, { contentType: photo.type, upsert: false });

    if (error) {
      console.error('Storage upload error:', error);
      return c.json({ error: `Upload failed: ${error.message}` }, 500);
    }

    const { data: signedUrlData } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(data.path, 60 * 60 * 24 * 30); // 30 days

    console.log('Photo uploaded:', data.path);
    return c.json({ url: signedUrlData?.signedUrl, path: data.path });

  } catch (error) {
    console.error('Error in upload-photo endpoint:', error);
    return c.json({ error: `Upload error: ${error.message}` }, 500);
  }
});

// Create or update a measurement
app.post("/make-server-1df47c03/measurements", async (c) => {
  try {
    const body = await c.req.json();
    const { leadId, traceLength, cable, drainage, workCost, notes, photos, signature } = body;

    if (!leadId) {
      return c.json({ error: 'leadId is required' }, 400);
    }

    // Check if a measurement already exists for this lead
    const existingMeasurementId = await kv.get(`measurement_by_lead:${leadId}`);
    let measurementId: string;
    let createdAt: string = new Date().toISOString();
    const isNew = !existingMeasurementId;

    if (existingMeasurementId) {
      measurementId = existingMeasurementId;
      // Preserve original createdAt
      const existingData = await kv.get(`measurement:${measurementId}`);
      if (existingData) {
        const existing = JSON.parse(existingData);
        createdAt = existing.createdAt || createdAt;
      }
    } else {
      measurementId = `measurement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await kv.set(`measurement_by_lead:${leadId}`, measurementId);
    }

    const measurement = {
      id: measurementId,
      leadId,
      traceLength: typeof traceLength === 'number' ? traceLength : parseFloat(traceLength) || 0,
      cable: cable || '',
      drainage: drainage || '',
      workCost: typeof workCost === 'number' ? workCost : parseFloat(workCost) || 0,
      notes: notes || '',
      photos: Array.isArray(photos) ? photos : [],
      signature: signature || null,
      createdAt,
      updatedAt: new Date().toISOString(),
    };

    // Auto-generate materials_json from template
    try {
      const template = await loadTemplate('default');
      const materials_json = computeMaterials(measurement, template);
      (measurement as any).materials_json = materials_json;
      console.log('Auto-generated materials_json for measurement:', measurementId,
        '| items:', materials_json.items.length,
        '| total:', materials_json.grandTotal);
    } catch (matErr) {
      console.error('Error generating materials_json:', matErr);
    }

    await kv.set(`measurement:${measurementId}`, JSON.stringify(measurement));
    console.log('Measurement saved:', measurementId, 'for lead:', leadId);

    // Send Telegram notification for new measurements
    if (isNew) {
      try {
        const leadData = await kv.get(`lead:${leadId}`);
        const lead = leadData ? JSON.parse(leadData) : null;
        const clientData = lead ? await kv.get(`client:${lead.clientId}`) : null;
        const client = clientData ? JSON.parse(clientData) : null;

        const tgText = [
          `📏 <b>Новый замер выполнен!</b>`,
          ``,
          `👤 Клиент: <b>${client?.name || 'Неизвестен'}</b>`,
          `📞 Телефон: ${client?.phone || '—'}`,
          ``,
          `🔧 Трасса: <b>${measurement.traceLength} м</b>`,
          `🔌 Кабель: ${measurement.cable}`,
          `💧 Дренаж: ${measurement.drainage}`,
          `💰 Стоимость работ: <b>${measurement.workCost.toLocaleString()} ₴</b>`,
          measurement.notes ? `📝 Примечания: ${measurement.notes}` : '',
          measurement.photos.length ? `📸 Фото: ${measurement.photos.length} шт.` : '',
          measurement.signature ? `✍️ Подпись клиента: получена` : '',
          ``,
          `🕐 ${new Date().toLocaleString('ru-RU')}`,
        ].filter(Boolean).join('\n');

        await sendTelegramMessage(tgText);
      } catch (tgErr) {
        console.error('TG notification error (measurement):', tgErr);
      }
    }

    return c.json({ measurement });

  } catch (error) {
    console.error('Error saving measurement:', error);
    return c.json({ error: `Failed to save measurement: ${error.message}` }, 500);
  }
});

// Get measurement by lead ID
app.get("/make-server-1df47c03/measurements/lead/:leadId", async (c) => {
  try {
    const leadId = c.req.param('leadId');
    const measurementId = await kv.get(`measurement_by_lead:${leadId}`);

    if (!measurementId) {
      return c.json({ measurement: null });
    }

    const measurementData = await kv.get(`measurement:${measurementId}`);
    if (!measurementData) {
      return c.json({ measurement: null });
    }

    return c.json({ measurement: JSON.parse(measurementData) });

  } catch (error) {
    console.error('Error fetching measurement by lead:', error);
    return c.json({ error: `Failed to fetch measurement: ${error.message}` }, 500);
  }
});

// Get measurement by ID
app.get("/make-server-1df47c03/measurements/:measurementId", async (c) => {
  try {
    const measurementId = c.req.param('measurementId');
    const measurementData = await kv.get(`measurement:${measurementId}`);

    if (!measurementData) {
      return c.json({ error: 'Measurement not found' }, 404);
    }

    return c.json({ measurement: JSON.parse(measurementData) });

  } catch (error) {
    console.error('Error fetching measurement:', error);
    return c.json({ error: `Failed to fetch measurement: ${error.message}` }, 500);
  }
});

// Get all measurements
app.get("/make-server-1df47c03/measurements", async (c) => {
  try {
    const measurementsData = await kv.getByPrefix('measurement:');
    const measurements = measurementsData
      .map(data => { try { return JSON.parse(data); } catch { return null; } })
      .filter(Boolean);

    measurements.sort((a: any, b: any) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return c.json({ measurements });

  } catch (error) {
    console.error('Error fetching all measurements:', error);
    return c.json({ error: `Failed to fetch measurements: ${error.message}` }, 500);
  }
});

// ─── MATERIAL TEMPLATES & AUTO-CALCULATION ───────────────────────────────────

// Types
interface TemplateItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  pricePerUnit: number;
  enabled: boolean;
  // Formula fields
  formulaType: 'linear' | 'pieces' | 'fixed' | 'freon' | 'conditional_pump' | 'skip_if_no_drain';
  reserve: number;       // multiplier added on top: e.g. 0.15 means +15%
  fixedQty?: number;     // for formulaType=fixed or conditional_pump
  pieceStep?: number;    // for formulaType=pieces: ceil(traceLength / pieceStep)
  pieceExtra?: number;   // extra pieces added after ceil
  freonBase?: number;    // for formulaType=freon: base kg
  freonPerMeter?: number;// for formulaType=freon: additional kg per meter
}

interface MaterialTemplate {
  id: string;
  name: string;
  items: TemplateItem[];
  updatedAt: string;
}

interface MaterialItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  pricePerUnit: number;
  total: number;
  note?: string;
}

interface MaterialsJson {
  templateId: string;
  templateName: string;
  items: MaterialItem[];
  totalMaterials: number;
  workCost: number;
  grandTotal: number;
  generatedAt: string;
}

// Default template
const DEFAULT_TEMPLATE: MaterialTemplate = {
  id: 'default',
  name: 'Стандартный монтаж сплит-системы',
  updatedAt: new Date().toISOString(),
  items: [
    // ── Трубопровод ──
    { id: 'pipe_14', name: 'Медная труба 1/4" (жидкостная)', category: 'Трубопровод', unit: 'м', pricePerUnit: 85, enabled: true, formulaType: 'linear', reserve: 0.15 },
    { id: 'pipe_38', name: 'Медная труба 3/8" (газовая)', category: 'Трубопровод', unit: 'м', pricePerUnit: 120, enabled: true, formulaType: 'linear', reserve: 0.15 },
    { id: 'insul_14', name: 'Теплоизоляция 9мм (1/4")', category: 'Трубопровод', unit: 'м', pricePerUnit: 45, enabled: true, formulaType: 'linear', reserve: 0.15 },
    { id: 'insul_38', name: 'Теплоизоляция 13мм (3/8")', category: 'Трубопровод', unit: 'м', pricePerUnit: 55, enabled: true, formulaType: 'linear', reserve: 0.15 },
    { id: 'tape', name: 'Самовулканизирующаяся лента', category: 'Трубопровод', unit: 'м', pricePerUnit: 35, enabled: true, formulaType: 'linear', reserve: 0.10 },
    // ── Дренаж ──
    { id: 'drain_pipe', name: 'Дренажная труба ø16мм', category: 'Дренаж', unit: 'м', pricePerUnit: 25, enabled: true, formulaType: 'skip_if_no_drain', reserve: 0.20 },
    { id: 'drain_pump', name: 'Дренажный насос', category: 'Дренаж', unit: 'шт', pricePerUnit: 1800, enabled: true, formulaType: 'conditional_pump', reserve: 0, fixedQty: 1 },
    // ── Электрика ──
    { id: 'cable', name: 'Кабель питания', category: 'Электрика', unit: 'м', pricePerUnit: 55, enabled: true, formulaType: 'linear', reserve: 0.20 },
    { id: 'cable_duct', name: 'Кабельный канал 60×40', category: 'Электрика', unit: 'м', pricePerUnit: 95, enabled: true, formulaType: 'linear', reserve: 0.10 },
    // ── Крепёж ──
    { id: 'dowels', name: 'Дюбель-шуруп 6×60', category: 'Крепёж', unit: 'шт', pricePerUnit: 5, enabled: true, formulaType: 'pieces', reserve: 0, pieceStep: 0.5, pieceExtra: 4 },
    { id: 'clamps', name: 'Хомуты для крепления труб', category: 'Крепёж', unit: 'шт', pricePerUnit: 8, enabled: true, formulaType: 'pieces', reserve: 0, pieceStep: 0.5, pieceExtra: 2 },
    { id: 'brackets', name: 'Кронштейны для наружного блока (пара)', category: 'Крепёж', unit: 'компл', pricePerUnit: 450, enabled: true, formulaType: 'fixed', reserve: 0, fixedQty: 1 },
    // ── Расходники ──
    { id: 'freon', name: 'Фреон R32 (дозаправка)', category: 'Расходники', unit: 'кг', pricePerUnit: 350, enabled: true, formulaType: 'freon', reserve: 0, freonBase: 0.3, freonPerMeter: 0.025 },
    { id: 'sealant', name: 'Герметик силиконовый', category: 'Расходники', unit: 'шт', pricePerUnit: 120, enabled: true, formulaType: 'fixed', reserve: 0, fixedQty: 1 },
    { id: 'gland', name: 'Сальники кабельного ввода', category: 'Расходники', unit: 'шт', pricePerUnit: 25, enabled: true, formulaType: 'fixed', reserve: 0, fixedQty: 2 },
  ],
};

// Core calculation engine
function computeMaterials(measurement: {
  traceLength: number;
  drainage: string;
  workCost: number;
}, template: MaterialTemplate): MaterialsJson {
  const L = Math.max(0, measurement.traceLength);
  const hasPump = /насос|pump|принудит/i.test(measurement.drainage);
  const noDrain = /без дрен��ж|no drain/i.test(measurement.drainage);

  const items: MaterialItem[] = [];

  for (const t of template.items) {
    if (!t.enabled) continue;

    let qty = 0;
    let note: string | undefined;

    switch (t.formulaType) {
      case 'linear':
        qty = Math.ceil((L * (1 + t.reserve)) * 10) / 10;
        if (t.reserve > 0) note = `трасса ${L}м + запас ${Math.round(t.reserve * 100)}%`;
        break;

      case 'pieces':
        qty = Math.ceil(L / (t.pieceStep ?? 0.5)) + (t.pieceExtra ?? 0);
        note = `1 шт / ${t.pieceStep ?? 0.5}м трассы`;
        break;

      case 'fixed':
        qty = t.fixedQty ?? 1;
        break;

      case 'freon':
        qty = Math.round(((t.freonBase ?? 0.3) + L * (t.freonPerMeter ?? 0.025)) * 100) / 100;
        note = `база ${t.freonBase}кг + ${t.freonPerMeter}кг/м`;
        break;

      case 'conditional_pump':
        if (!hasPump) continue; // skip if no pump drainage
        qty = t.fixedQty ?? 1;
        break;

      case 'skip_if_no_drain':
        if (noDrain) continue; // skip if no drainage selected
        qty = Math.ceil((L * (1 + t.reserve)) * 10) / 10;
        if (t.reserve > 0) note = `трасса ${L}м + запас ${Math.round(t.reserve * 100)}%`;
        break;
    }

    if (qty <= 0) continue;

    items.push({
      id: t.id,
      name: t.name,
      category: t.category,
      unit: t.unit,
      qty,
      pricePerUnit: t.pricePerUnit,
      total: Math.round(qty * t.pricePerUnit),
      note,
    });
  }

  const totalMaterials = items.reduce((sum, i) => sum + i.total, 0);
  const workCost = measurement.workCost ?? 0;

  return {
    templateId: template.id,
    templateName: template.name,
    items,
    totalMaterials,
    workCost,
    grandTotal: totalMaterials + workCost,
    generatedAt: new Date().toISOString(),
  };
}

// Load template (falls back to default)
async function loadTemplate(id = 'default'): Promise<MaterialTemplate> {
  try {
    const raw = await kv.get(`material_template:${id}`);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Error loading template:', e);
  }
  return DEFAULT_TEMPLATE;
}

// GET all templates list
app.get('/make-server-1df47c03/material-templates', async (c) => {
  try {
    const raw = await kv.get('material_template:default');
    const template = raw ? JSON.parse(raw) : DEFAULT_TEMPLATE;
    return c.json({ templates: [template] });
  } catch (error) {
    console.error('Error fetching templates:', error);
    return c.json({ error: `Failed to fetch templates: ${error.message}` }, 500);
  }
});

// GET single template
app.get('/make-server-1df47c03/material-templates/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const template = await loadTemplate(id);
    return c.json({ template });
  } catch (error) {
    console.error('Error fetching template:', error);
    return c.json({ error: `Failed to fetch template: ${error.message}` }, 500);
  }
});

// POST save template
app.post('/make-server-1df47c03/material-templates/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const template: MaterialTemplate = { ...body, id, updatedAt: new Date().toISOString() };
    await kv.set(`material_template:${id}`, JSON.stringify(template));
    console.log('Template saved:', id);
    return c.json({ template });
  } catch (error) {
    console.error('Error saving template:', error);
    return c.json({ error: `Failed to save template: ${error.message}` }, 500);
  }
});

// POST recalculate materials for existing measurement
app.post('/make-server-1df47c03/measurements/:measurementId/recalculate', async (c) => {
  try {
    const measurementId = c.req.param('measurementId');
    const raw = await kv.get(`measurement:${measurementId}`);
    if (!raw) return c.json({ error: 'Measurement not found' }, 404);

    const measurement = JSON.parse(raw);
    const template = await loadTemplate('default');
    const materials_json = computeMaterials(measurement, template);

    measurement.materials_json = materials_json;
    measurement.updatedAt = new Date().toISOString();
    await kv.set(`measurement:${measurementId}`, JSON.stringify(measurement));

    console.log('Recalculated materials for measurement:', measurementId);
    return c.json({ measurement, materials_json });
  } catch (error) {
    console.error('Error recalculating materials:', error);
    return c.json({ error: `Failed to recalculate: ${error.message}` }, 500);
  }
});

// ─── TELEGRAM NOTIFICATIONS ──────────────────────────────────────────────────

async function getTgConfig(): Promise<{ chatId: string | null; botToken: string | null }> {
  const chatId = await kv.get('config:tgAdminChatId');
  const botToken = Deno.env.get('tg_bot_biznes_mova') || null;
  return { chatId: chatId || null, botToken };
}

async function sendTelegramMessage(text: string): Promise<boolean> {
  try {
    const { chatId, botToken } = await getTgConfig();
    if (!chatId || !botToken) {
      console.log('Telegram not configured, skipping notification');
      return false;
    }
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('Telegram sendMessage error:', data.description);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error sending Telegram message:', err);
    return false;
  }
}

// Config GET
app.get('/make-server-1df47c03/config', async (c) => {
  try {
    const chatId = await kv.get('config:tgAdminChatId');
    return c.json({ tgAdminChatId: chatId || '' });
  } catch (error) {
    console.error('Error getting config:', error);
    return c.json({ error: `Failed to get config: ${error.message}` }, 500);
  }
});

// Config POST
app.post('/make-server-1df47c03/config', async (c) => {
  try {
    const { tgAdminChatId } = await c.req.json();
    if (tgAdminChatId !== undefined) {
      await kv.set('config:tgAdminChatId', String(tgAdminChatId).trim());
    }
    return c.json({ success: true });
  } catch (error) {
    console.error('Error saving config:', error);
    return c.json({ error: `Failed to save config: ${error.message}` }, 500);
  }
});

// TG Test
app.post('/make-server-1df47c03/tg-test', async (c) => {
  try {
    const { chatId, botToken } = await getTgConfig();
    if (!botToken) {
      return c.json({ error: 'Telegram bot token not configured (env: tg_bot_biznes_mova)' }, 400);
    }
    if (!chatId) {
      return c.json({ error: 'Chat ID не настроен. Сохраните Chat ID в настройках.' }, 400);
    }
    const ok = await sendTelegramMessage(
      `✅ <b>Тест уведомлений</b>\n\nCRM кондиционеры — подключение работает!\n🕐 ${new Date().toLocaleString('ru-RU')}`
    );
    if (ok) return c.json({ success: true });
    return c.json({ error: 'Не удалось отправить сообщение. Проверьте Chat ID.' }, 500);
  } catch (error) {
    console.error('Error in tg-test:', error);
    return c.json({ error: `Ошибка: ${error.message}` }, 500);
  }
});

// ─── AC CATALOG ───────────────────────────────────────────────────────────────

interface AcModel {
  id: string;
  brand: string;
  model: string;
  btu: number;
  kw: number;
  area: number;       // max recommended area m²
  tier: 'economy' | 'standard' | 'premium';
  features: string[]; // inverter, wifi, silent, filter, hyper_heat
  price: number;      // ₴ per unit
  warranty: number;   // years
}

const DEFAULT_AC_CATALOG: AcModel[] = [
  // ── Эконом ──
  { id: 'chigo_09', brand: 'Chigo', model: 'CS-09H3A-150', btu: 9000,  kw: 2.6, area: 25, tier: 'economy',  features: [],                              price: 9800,  warranty: 1 },
  { id: 'chigo_12', brand: 'Chigo', model: 'CS-12H3A-150', btu: 12000, kw: 3.5, area: 35, tier: 'economy',  features: [],                              price: 12500, warranty: 1 },
  { id: 'chigo_18', brand: 'Chigo', model: 'CS-18H3A-150', btu: 18000, kw: 5.2, area: 50, tier: 'economy',  features: [],                              price: 16200, warranty: 1 },
  { id: 'aux_09',   brand: 'AUX',   model: 'ASW-09A4/FA',  btu: 9000,  kw: 2.6, area: 25, tier: 'economy',  features: [],                              price: 10500, warranty: 1 },
  { id: 'aux_12',   brand: 'AUX',   model: 'ASW-12A4/FA',  btu: 12000, kw: 3.5, area: 35, tier: 'economy',  features: [],                              price: 13500, warranty: 1 },
  { id: 'aux_18',   brand: 'AUX',   model: 'ASW-18A4/FA',  btu: 18000, kw: 5.0, area: 50, tier: 'economy',  features: [],                              price: 16800, warranty: 1 },
  { id: 'aux_24',   brand: 'AUX',   model: 'ASW-24A4/FA',  btu: 24000, kw: 7.0, area: 70, tier: 'economy',  features: [],                              price: 21500, warranty: 1 },
  // ── Стандарт ──
  { id: 'samsung_09', brand: 'Samsung', model: 'AR09TXHQASIXUA', btu: 9000,  kw: 2.6, area: 25, tier: 'standard', features: ['inverter','wifi'],          price: 18500, warranty: 3 },
  { id: 'samsung_12', brand: 'Samsung', model: 'AR12TXHQASIXUA', btu: 12000, kw: 3.5, area: 35, tier: 'standard', features: ['inverter','wifi'],          price: 22000, warranty: 3 },
  { id: 'samsung_18', brand: 'Samsung', model: 'AR18TXHQASIXUA', btu: 18000, kw: 5.0, area: 50, tier: 'standard', features: ['inverter','wifi'],          price: 28500, warranty: 3 },
  { id: 'lg_09',      brand: 'LG',      model: 'S09EQ',           btu: 9000,  kw: 2.6, area: 25, tier: 'standard', features: ['inverter','silent'],        price: 17800, warranty: 3 },
  { id: 'lg_12',      brand: 'LG',      model: 'S12EQ',           btu: 12000, kw: 3.5, area: 35, tier: 'standard', features: ['inverter','silent'],        price: 21500, warranty: 3 },
  { id: 'lg_18',      brand: 'LG',      model: 'S18ET',           btu: 18000, kw: 5.0, area: 50, tier: 'standard', features: ['inverter','silent'],        price: 27000, warranty: 3 },
  { id: 'haier_09',   brand: 'Haier',   model: 'AS09BS4HRA',      btu: 9000,  kw: 2.6, area: 25, tier: 'standard', features: ['inverter','wifi','silent'], price: 19200, warranty: 3 },
  { id: 'haier_12',   brand: 'Haier',   model: 'AS12BS4HRA',      btu: 12000, kw: 3.5, area: 35, tier: 'standard', features: ['inverter','wifi','silent'], price: 23500, warranty: 3 },
  // ── Премиум ──
  { id: 'daikin_09',     brand: 'Daikin',     model: 'FTXB25C/RXB25C',  btu: 9000,  kw: 2.5, area: 25, tier: 'premium', features: ['inverter','wifi','silent','filter'], price: 32000, warranty: 5 },
  { id: 'daikin_12',     brand: 'Daikin',     model: 'FTXB35C/RXB35C',  btu: 12000, kw: 3.5, area: 35, tier: 'premium', features: ['inverter','wifi','silent','filter'], price: 38000, warranty: 5 },
  { id: 'daikin_18',     brand: 'Daikin',     model: 'FTXB50C/RXB50C',  btu: 18000, kw: 5.0, area: 50, tier: 'premium', features: ['inverter','wifi','silent','filter'], price: 46000, warranty: 5 },
  { id: 'mitsubishi_09', brand: 'Mitsubishi', model: 'MSZ-LN25VG/MUZ',  btu: 9000,  kw: 2.5, area: 25, tier: 'premium', features: ['inverter','wifi','silent','hyper_heat'], price: 35000, warranty: 5 },
  { id: 'mitsubishi_12', brand: 'Mitsubishi', model: 'MSZ-LN35VG/MUZ',  btu: 12000, kw: 3.5, area: 35, tier: 'premium', features: ['inverter','wifi','silent','hyper_heat'], price: 42000, warranty: 5 },
  { id: 'mitsubishi_18', brand: 'Mitsubishi', model: 'MSZ-LN50VG/MUZ',  btu: 18000, kw: 5.0, area: 50, tier: 'premium', features: ['inverter','wifi','silent','hyper_heat'], price: 52000, warranty: 5 },
];

async function loadAcCatalog(): Promise<AcModel[]> {
  try {
    const raw = await kv.get('ac_catalog');
    if (raw) return JSON.parse(raw);
  } catch (e) { console.error('Error loading AC catalog:', e); }
  return DEFAULT_AC_CATALOG;
}

// GET catalog
app.get('/make-server-1df47c03/ac-catalog', async (c) => {
  try {
    const catalog = await loadAcCatalog();
    return c.json({ catalog });
  } catch (error) {
    console.error('Error fetching AC catalog:', error);
    return c.json({ error: `Failed to fetch catalog: ${error.message}` }, 500);
  }
});

// POST save catalog (full replace)
app.post('/make-server-1df47c03/ac-catalog', async (c) => {
  try {
    const { catalog } = await c.req.json();
    await kv.set('ac_catalog', JSON.stringify(catalog));
    return c.json({ success: true, catalog });
  } catch (error) {
    console.error('Error saving AC catalog:', error);
    return c.json({ error: `Failed to save catalog: ${error.message}` }, 500);
  }
});

// POST reset catalog to defaults
app.post('/make-server-1df47c03/ac-catalog/reset', async (c) => {
  try {
    await kv.set('ac_catalog', JSON.stringify(DEFAULT_AC_CATALOG));
    return c.json({ success: true, catalog: DEFAULT_AC_CATALOG });
  } catch (error) {
    return c.json({ error: `Failed to reset: ${error.message}` }, 500);
  }
});

// ─── OFFER GENERATION ─────────────────────────────────────────────────────────

interface OfferVariant {
  tier: 'economy' | 'standard' | 'premium';
  label: string;
  ac: AcModel;
  acCount: number;
  acTotal: number;
  materialsTotal: number;
  workCost: number;
  subtotal: number;
  discount: number;
  total: number;
  isRecommended: boolean;
  notes: string;
  features: string[];
}

interface Offer {
  id: string;
  leadId: string;
  clientId: string;
  variants: OfferVariant[];
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  validDays: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// Helpers
function btuForArea(area: number): number {
  if (area <= 20) return 7000;
  if (area <= 26) return 9000;
  if (area <= 35) return 12000;
  if (area <= 50) return 18000;
  if (area <= 70) return 24000;
  return 28000;
}

const FEATURE_LABELS: Record<string, string> = {
  inverter:   'Инвертор',
  wifi:       'Wi-Fi управление',
  silent:     'Тихий режим',
  filter:     'Очистка воздуха',
  hyper_heat: 'Обогрев до -25°C',
};

function selectAcForTier(
  catalog: AcModel[],
  tier: 'economy' | 'standard' | 'premium',
  areaPerRoom: number,
  preferences: string[],
): AcModel | null {
  const targetBtu = btuForArea(areaPerRoom);
  const tierModels = catalog.filter(m => m.tier === tier);
  if (tierModels.length === 0) return null;

  // Sort by BTU proximity
  const sorted = [...tierModels].sort((a, b) =>
    Math.abs(a.btu - targetBtu) - Math.abs(b.btu - targetBtu)
  );

  // Among closest BTU group, prefer models matching preferences
  const prefs = (preferences || []).map(p => p.toLowerCase());
  const closestBtu = sorted[0].btu;
  const closestGroup = sorted.filter(m => Math.abs(m.btu - closestBtu) < 2000);

  if (prefs.length > 0) {
    const withPrefs = closestGroup.filter(m =>
      prefs.some(p => m.features.includes(p))
    );
    if (withPrefs.length > 0) return withPrefs[0];
  }

  return closestGroup[0];
}

function buildVariant(
  tier: 'economy' | 'standard' | 'premium',
  ac: AcModel,
  roomsCount: number,
  materialsTotal: number,
  workCost: number,
  discount: number,
  budget: number | null,
): OfferVariant {
  const LABELS = { economy: 'Эконом', standard: 'Стандарт', premium: 'Премиум' };
  const acCount = Math.max(1, roomsCount);
  const acTotal = ac.price * acCount;
  const subtotal = acTotal + materialsTotal + workCost;
  const discountAmt = Math.round(subtotal * discount);
  const total = subtotal - discountAmt;

  const features = ac.features.map(f => FEATURE_LABELS[f] ?? f);

  let notes = '';
  if (tier === 'economy') notes = 'Надёжное базовое решение. Доступная цена, проверенный бренд.';
  if (tier === 'standard') notes = 'Инверторная технология: экономия электроэнергии до 40%. Оптимальное соотношение цена/качество.';
  if (tier === 'premium') notes = `Лучшие мировые бренды. Гарантия ${ac.warranty} лет, максимальный комфорт и надёжность.`;

  return {
    tier,
    label: LABELS[tier],
    ac,
    acCount,
    acTotal,
    materialsTotal,
    workCost,
    subtotal,
    discount: discountAmt,
    total,
    isRecommended: tier === 'standard',
    notes,
    features,
  };
}

// POST generate offer for a lead
app.post('/make-server-1df47c03/offers/generate', async (c) => {
  try {
    const { leadId, discountPct = 0, validDays = 14, notes = '' } = await c.req.json();
    if (!leadId) return c.json({ error: 'leadId is required' }, 400);

    // Load lead
    const leadRaw = await kv.get(`lead:${leadId}`);
    if (!leadRaw) return c.json({ error: 'Lead not found' }, 404);
    const lead = JSON.parse(leadRaw);
    const req = lead.requirements_json || {};

    // Load measurement (optional)
    const measurementId = await kv.get(`measurement_by_lead:${leadId}`);
    let measurement: any = null;
    if (measurementId) {
      const mRaw = await kv.get(`measurement:${measurementId}`);
      if (mRaw) measurement = JSON.parse(mRaw);
    }

    // Load catalog
    const catalog = await loadAcCatalog();

    // Parameters
    const area: number = req.area || 25;
    const roomsCount: number = req.roomsCount || 1;
    const preferences: string[] = req.preferences || [];
    const budget: number | null = req.budget || null;
    const areaPerRoom = area / roomsCount;

    const materialsTotal = measurement?.materials_json?.totalMaterials ?? 0;
    const workCost = measurement?.workCost ?? 0;
    const discount = (discountPct || 0) / 100;

    // Generate variants for all 3 tiers
    const variants: OfferVariant[] = [];
    for (const tier of ['economy', 'standard', 'premium'] as const) {
      const ac = selectAcForTier(catalog, tier, areaPerRoom, preferences);
      if (ac) {
        variants.push(buildVariant(tier, ac, roomsCount, materialsTotal, workCost, discount, budget));
      }
    }

    if (variants.length === 0) {
      return c.json({ error: 'No suitable AC models found in catalog' }, 400);
    }

    // Save offer
    const offerId = `offer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const offer: Offer = {
      id: offerId,
      leadId,
      clientId: lead.clientId,
      variants,
      status: 'draft',
      validDays,
      notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`offer:${offerId}`, JSON.stringify(offer));
    // Index: offers_by_lead
    const existingList = await kv.get(`offers_by_lead:${leadId}`);
    const offerList: string[] = existingList ? JSON.parse(existingList) : [];
    offerList.unshift(offerId);
    await kv.set(`offers_by_lead:${leadId}`, JSON.stringify(offerList));

    console.log('Offer generated:', offerId, 'for lead:', leadId, 'variants:', variants.length);
    return c.json({ offer });

  } catch (error) {
    console.error('Error generating offer:', error);
    return c.json({ error: `Failed to generate offer: ${error.message}` }, 500);
  }
});

// GET all offers
app.get('/make-server-1df47c03/offers', async (c) => {
  try {
    const raw = await kv.getByPrefix('offer:');
    const offers = raw
      .map(d => { try { return JSON.parse(d); } catch { return null; } })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return c.json({ offers });
  } catch (error) {
    console.error('Error fetching offers:', error);
    return c.json({ error: `Failed to fetch offers: ${error.message}` }, 500);
  }
});

// GET offers by lead
app.get('/make-server-1df47c03/offers/lead/:leadId', async (c) => {
  try {
    const leadId = c.req.param('leadId');
    const listRaw = await kv.get(`offers_by_lead:${leadId}`);
    if (!listRaw) return c.json({ offers: [] });
    const ids: string[] = JSON.parse(listRaw);
    const offers = (await Promise.all(ids.map(id => kv.get(`offer:${id}`))))
      .filter(Boolean)
      .map(d => JSON.parse(d!));
    return c.json({ offers });
  } catch (error) {
    console.error('Error fetching offers by lead:', error);
    return c.json({ error: `Failed to fetch offers: ${error.message}` }, 500);
  }
});

// GET single offer
app.get('/make-server-1df47c03/offers/:offerId', async (c) => {
  try {
    const offerId = c.req.param('offerId');
    const raw = await kv.get(`offer:${offerId}`);
    if (!raw) return c.json({ error: 'Offer not found' }, 404);
    return c.json({ offer: JSON.parse(raw) });
  } catch (error) {
    console.error('Error fetching offer:', error);
    return c.json({ error: `Failed to fetch offer: ${error.message}` }, 500);
  }
});

// PATCH update offer (status, notes, discount)
app.patch('/make-server-1df47c03/offers/:offerId', async (c) => {
  try {
    const offerId = c.req.param('offerId');
    const raw = await kv.get(`offer:${offerId}`);
    if (!raw) return c.json({ error: 'Offer not found' }, 404);
    const offer = JSON.parse(raw);
    const patch = await c.req.json();
    const allowed = ['status', 'notes', 'validDays'];
    for (const key of allowed) {
      if (patch[key] !== undefined) (offer as any)[key] = patch[key];
    }
    offer.updatedAt = new Date().toISOString();
    await kv.set(`offer:${offerId}`, JSON.stringify(offer));
    return c.json({ offer });
  } catch (error) {
    console.error('Error updating offer:', error);
    return c.json({ error: `Failed to update offer: ${error.message}` }, 500);
  }
});


// ─── PDF DOCUMENT GENERATION ─────────────────────────────────────────────────

const DOC_BUCKET = 'make-1df47c03-documents';

async function initDocBucket() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b: any) => b.name === DOC_BUCKET)) {
      await supabase.storage.createBucket(DOC_BUCKET);
      console.log('Created documents bucket:', DOC_BUCKET);
    }
  } catch (err) { console.error('Error init doc bucket:', err); }
}
initDocBucket();

// Font cache
let _fontRBytes: ArrayBuffer | null = null;
let _fontBBytes: ArrayBuffer | null = null;

async function loadFonts() {
  const base = 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/fonts/Roboto/';
  if (!_fontRBytes) _fontRBytes = await fetch(base + 'Roboto-Regular.ttf').then(r => r.arrayBuffer());
  if (!_fontBBytes) _fontBBytes = await fetch(base + 'Roboto-Medium.ttf').then(r => r.arrayBuffer());
  return { r: _fontRBytes!, b: _fontBBytes! };
}

// ─── Layout constants & helpers ───────────────────────────────────────────────
const PH = 841.89, PW = 595.28, ML = 50, MR = 50, CW = PW - ML - MR;

const C = {
  navy:  rgb(0.10, 0.22, 0.45), blue:  rgb(0.18, 0.42, 0.72),
  teal:  rgb(0.05, 0.55, 0.44), light: rgb(0.94, 0.96, 0.99),
  border:rgb(0.78, 0.82, 0.88), text:  rgb(0.10, 0.10, 0.13),
  muted: rgb(0.43, 0.45, 0.52), white: rgb(1, 1, 1),
  green: rgb(0.06, 0.55, 0.34),
};

interface PdfCtx { doc: any; page: any; y: number; fontR: any; fontB: any; }

function newPage(ctx: PdfCtx) { ctx.page = ctx.doc.addPage([PW, PH]); ctx.y = 60; }
function ensureSpace(ctx: PdfCtx, n: number) { if (ctx.y + n > PH - 70) newPage(ctx); }
function pdfY(topY: number, elemH = 0) { return PH - topY - elemH; }
function txtW(font: any, t: string, s: number) { try { return font.widthOfTextAtSize(String(t), s); } catch { return 0; } }

function wrapText(font: any, text: string, size: number, maxW: number): string[] {
  const words = String(text).split(' '); const lines: string[] = []; let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (txtW(font, test, size) > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line); return lines.length ? lines : [''];
}

function drawText(ctx: PdfCtx, text: string, opts: { x?: number; size?: number; bold?: boolean; color?: any; align?: 'left'|'center'|'right'; maxW?: number; lineH?: number } = {}) {
  const { x = ML, size = 10, bold = false, color = C.text, align = 'left', maxW = CW, lineH } = opts;
  const font = bold ? ctx.fontB : ctx.fontR; const lh = lineH ?? size * 1.45;
  for (const line of wrapText(font, text, size, maxW)) {
    ensureSpace(ctx, lh); let dx = x;
    const w = txtW(font, line, size);
    if (align === 'center') dx = x + (maxW - w) / 2; else if (align === 'right') dx = x + maxW - w;
    ctx.page.drawText(line, { x: dx, y: pdfY(ctx.y, size * 0.2), font, size, color }); ctx.y += lh;
  }
}

function gap(ctx: PdfCtx, h: number) { ctx.y += h; }

function hRule(ctx: PdfCtx, color = C.border, thickness = 0.5) {
  ctx.page.drawLine({ start: { x: ML, y: pdfY(ctx.y) }, end: { x: ML + CW, y: pdfY(ctx.y) }, color, thickness });
}

function fillRect(ctx: PdfCtx, x: number, w: number, h: number, fill: any) {
  ctx.page.drawRectangle({ x, y: pdfY(ctx.y, h), width: w, height: h, color: fill });
}
function borderRect(ctx: PdfCtx, x: number, w: number, h: number, color: any, bw = 0.7) {
  ctx.page.drawRectangle({ x, y: pdfY(ctx.y, h), width: w, height: h, borderColor: color, borderWidth: bw });
}

function sectionHeader(ctx: PdfCtx, title: string, fill = C.navy) {
  ensureSpace(ctx, 34); gap(ctx, 8);
  fillRect(ctx, ML, CW, 22, fill);
  ctx.page.drawText(title, { x: ML + 8, y: pdfY(ctx.y, 15), font: ctx.fontB, size: 10, color: C.white });
  ctx.y += 22; gap(ctx, 5);
}

function drawTable(ctx: PdfCtx, cols: { label: string; w: number; align?: 'left'|'center'|'right' }[], rows: string[][]) {
  const RH = 17, HH = 21, totalW = cols.reduce((s, c) => s + c.w, 0);
  ensureSpace(ctx, HH + Math.min(rows.length, 8) * RH + 4);

  // Header
  fillRect(ctx, ML, totalW, HH, C.blue);
  let cx = ML;
  for (const col of cols) {
    const tw = txtW(ctx.fontB, col.label, 9); let tx = cx + 4;
    if (col.align === 'center') tx = cx + (col.w - tw) / 2; else if (col.align === 'right') tx = cx + col.w - tw - 4;
    ctx.page.drawText(col.label, { x: tx, y: pdfY(ctx.y, 14), font: ctx.fontB, size: 9, color: C.white }); cx += col.w;
  }
  const headerStartY = ctx.y; ctx.y += HH;

  // Rows
  for (let ri = 0; ri < rows.length; ri++) {
    if (ctx.y + RH > PH - 70) {
      // Draw border up to here then new page
      ctx.page.drawRectangle({ x: ML, y: pdfY(ctx.y), width: totalW, height: ctx.y - headerStartY, borderColor: C.border, borderWidth: 0.8 });
      newPage(ctx);
    }
    if (ri % 2 === 0) fillRect(ctx, ML, totalW, RH, C.light);
    cx = ML;
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci]; let cell = String(rows[ri][ci] ?? '');
      while (cell.length > 2 && txtW(ctx.fontR, cell, 9) > col.w - 8) cell = cell.slice(0, -1);
      if (cell !== String(rows[ri][ci] ?? '')) cell += '…';
      const tw = txtW(ctx.fontR, cell, 9); let tx = cx + 4;
      if (col.align === 'center') tx = cx + (col.w - tw) / 2; else if (col.align === 'right') tx = cx + col.w - tw - 4;
      ctx.page.drawText(cell, { x: tx, y: pdfY(ctx.y, 12), font: ctx.fontR, size: 9, color: C.text }); cx += col.w;
    }
    ctx.page.drawLine({ start: { x: ML, y: pdfY(ctx.y, RH) }, end: { x: ML + totalW, y: pdfY(ctx.y, RH) }, color: C.border, thickness: 0.3 });
    ctx.y += RH;
  }

  // Final border
  const tableH = ctx.y - headerStartY;
  ctx.page.drawRectangle({ x: ML, y: pdfY(ctx.y), width: totalW, height: tableH, borderColor: C.border, borderWidth: 0.8 });
  // Column dividers
  cx = ML;
  for (const col of cols.slice(0, -1)) {
    cx += col.w;
    ctx.page.drawLine({ start: { x: cx, y: pdfY(ctx.y) }, end: { x: cx, y: pdfY(headerStartY) }, color: C.border, thickness: 0.4 });
  }
  gap(ctx, 6);
}

function keyVal(ctx: PdfCtx, pairs: [string, string][], indent = 0) {
  for (const [key, val] of pairs) {
    ensureSpace(ctx, 14);
    ctx.page.drawText(key, { x: ML + indent, y: pdfY(ctx.y, 8 * 0.2), font: ctx.fontB, size: 9, color: C.muted });
    ctx.page.drawText(val, { x: ML + indent + 130, y: pdfY(ctx.y, 8 * 0.2), font: ctx.fontR, size: 9, color: C.text });
    ctx.y += 14;
  }
}

function amountBox(ctx: PdfCtx, label: string, amount: string, fill = C.navy) {
  ensureSpace(ctx, 28); fillRect(ctx, ML, CW, 26, fill);
  ctx.page.drawText(label, { x: ML + 10, y: pdfY(ctx.y, 17), font: ctx.fontB, size: 11, color: C.white });
  const aw = txtW(ctx.fontB, amount, 13);
  ctx.page.drawText(amount, { x: ML + CW - aw - 10, y: pdfY(ctx.y, 18), font: ctx.fontB, size: 13, color: C.white });
  ctx.y += 26;
}

function signatureBlock(ctx: PdfCtx) {
  ensureSpace(ctx, 80); gap(ctx, 12); hRule(ctx); gap(ctx, 14);
  const half = (CW - 30) / 2;
  ctx.page.drawText('ИСПОЛНИТЕЛЬ:', { x: ML, y: pdfY(ctx.y, 10), font: ctx.fontB, size: 10, color: C.navy });
  ctx.page.drawText('ЗАКАЗЧИК:', { x: ML + half + 30, y: pdfY(ctx.y, 10), font: ctx.fontB, size: 10, color: C.navy });
  ctx.y += 16;
  for (const lbl of ['Подпись:', 'Ф.И.О.:', 'Дата:']) {
    ctx.page.drawText(lbl, { x: ML, y: pdfY(ctx.y, 7), font: ctx.fontR, size: 8, color: C.muted });
    ctx.page.drawText(lbl, { x: ML + half + 30, y: pdfY(ctx.y, 7), font: ctx.fontR, size: 8, color: C.muted });
    ctx.page.drawLine({ start: { x: ML + 50, y: pdfY(ctx.y, 5) }, end: { x: ML + half - 5, y: pdfY(ctx.y, 5) }, color: C.border, thickness: 0.7 });
    ctx.page.drawLine({ start: { x: ML + half + 80, y: pdfY(ctx.y, 5) }, end: { x: ML + CW, y: pdfY(ctx.y, 5) }, color: C.border, thickness: 0.7 });
    ctx.y += 16;
  }
  gap(ctx, 4);
  ctx.page.drawText('М.П.', { x: ML, y: pdfY(ctx.y, 7), font: ctx.fontR, size: 8, color: C.muted });
  ctx.page.drawText('М.П.', { x: ML + half + 30, y: pdfY(ctx.y, 7), font: ctx.fontR, size: 8, color: C.muted });
}

// ─── Contract PDF ─────────────────────────────────────────────────────────────
async function generateContractPDF(d: {
  contractNumber: string; contractDate: string; city: string;
  companyName: string; companyCode: string; companyDirector: string; companyPhone: string;
  client: { name: string; phone: string; email?: string | null };
  variant: OfferVariant; materialsItems: MaterialItem[];
  advancePct: number; advanceAmount: number; balanceAmount: number; totalAmount: number; notes: string;
}): Promise<Uint8Array> {
  const fonts = await loadFonts();
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontR = await pdfDoc.embedFont(fonts.r);
  const fontB = await pdfDoc.embedFont(fonts.b);
  const ctx: PdfCtx = { doc: pdfDoc, page: pdfDoc.addPage([PW, PH]), y: 0, fontR, fontB };
  const v = d.variant;
  const fN = (n: number) => n.toLocaleString('uk-UA');

  // Header bar
  fillRect(ctx, 0, PW, 52, C.navy);
  ctx.page.drawText(d.companyName, { x: ML, y: PH - 22, font: fontB, size: 13, color: C.white });
  ctx.page.drawText(`ИНН: ${d.companyCode}  •  ${d.companyPhone}`, { x: ML, y: PH - 37, font: fontR, size: 9, color: rgb(0.7, 0.8, 0.95) });
  const title = `ДОГОВІР № ${d.contractNumber}`;
  ctx.page.drawText(title, { x: PW - MR - txtW(fontB, title, 14), y: PH - 22, font: fontB, size: 14, color: C.white });
  const sub = `от ${d.contractDate}  •  г. ${d.city}`;
  ctx.page.drawText(sub, { x: PW - MR - txtW(fontR, sub, 9), y: PH - 37, font: fontR, size: 9, color: rgb(0.7, 0.8, 0.95) });
  ctx.y = 58;

  // Parties
  gap(ctx, 5); drawText(ctx, 'СТОРОНЫ ДОГОВОРА', { bold: true, size: 10, color: C.navy }); gap(ctx, 4);
  const startY = ctx.y; const half = (CW - 20) / 2;
  ctx.page.drawText('ИСПОЛНИТЕЛЬ:', { x: ML + 4, y: pdfY(ctx.y, 9), font: fontB, size: 9, color: C.navy }); ctx.y += 13;
  keyVal(ctx, [['Компания:', d.companyName], ['Директор:', d.companyDirector], ['Телефон:', d.companyPhone], ['ИНН:', d.companyCode]], 4);
  const leftH = ctx.y - startY + 6; ctx.y = startY;
  ctx.page.drawText('ЗАКАЗЧИК:', { x: ML + half + 24, y: pdfY(ctx.y, 9), font: fontB, size: 9, color: C.navy }); ctx.y += 13;
  keyVal(ctx, [['Ф.И.О.:', d.client.name], ['Телефон:', d.client.phone], ['Email:', d.client.email || '—'], ['Документ:', 'Паспорт']], half + 24);
  ctx.page.drawLine({ start: { x: ML + half + 12, y: pdfY(startY - 2) }, end: { x: ML + half + 12, y: pdfY(startY + leftH - 2) }, color: C.border, thickness: 0.6 });
  ctx.y = startY + leftH;
  gap(ctx, 4); hRule(ctx); gap(ctx, 10);

  // Article 1: Subject
  sectionHeader(ctx, '1. ПРЕДМЕТ ДОГОВОРА', C.navy);
  drawText(ctx, `Исполнитель обязуется выполнить поставку и монтаж климатического оборудования (${v.ac.brand} ${v.ac.model}, ${v.acCount} шт.), а Заказчик обязуется принять и оплатить работы в соответствии с условиями настоящего Договора и Спецификации (Приложение №1).`, { size: 9.5, maxW: CW });
  gap(ctx, 3);
  drawText(ctx, `Мощность охлаждения: ${v.ac.kw} кВт (${(v.ac.btu / 1000).toFixed(0)} BTU). Рекомендуемая площадь помещения: до ${v.ac.area} м².`, { size: 9.5, maxW: CW });
  gap(ctx, 6);

  // Article 2: Equipment
  sectionHeader(ctx, '2. ОБОРУДОВАНИЕ И МОНТАЖНЫЕ МАТЕРИАЛЫ', C.blue);
  const eqRows: string[][] = [
    ['1', `Кондиционер (${v.tier === 'economy' ? 'Эконом' : v.tier === 'standard' ? 'Стандарт' : 'Премиум'})`, `${v.ac.brand} ${v.ac.model}`, String(v.acCount), fN(v.ac.price), fN(v.acTotal)],
    ...d.materialsItems.slice(0, 14).map((m, i) => [String(i + 2), m.name, `${m.qty} ${m.unit}`, '1', fN(m.pricePerUnit), fN(m.total)]),
  ];
  drawTable(ctx,
    [{ label: '№', w: 24, align: 'center' }, { label: 'Наименование', w: 165 }, { label: 'Модель / Количество', w: 130 },
     { label: 'Кол-во', w: 40, align: 'center' }, { label: 'Цена, ₴', w: 66, align: 'right' }, { label: 'Сумма, ₴', w: 70, align: 'right' }],
    eqRows
  );

  // Article 3: Works
  sectionHeader(ctx, '3. МОНТАЖНЫЕ РАБОТЫ', C.blue);
  drawTable(ctx,
    [{ label: '№', w: 24, align: 'center' }, { label: 'Вид работ', w: 350 }, { label: 'Сумма, ₴', w: 121, align: 'right' }],
    [
      ['1', 'Монтаж внутреннего и наружного блоков', fN(Math.round(v.workCost * 0.4))],
      ['2', 'Прокладка медной фреоновой трассы и дренажа', fN(Math.round(v.workCost * 0.3))],
      ['3', 'Прокладка кабеля питания и подключение', fN(Math.round(v.workCost * 0.2))],
      ['4', 'Вакуумирование, заправка фреоном R32, пуско-наладка', fN(Math.round(v.workCost * 0.1))],
    ]
  );

  // Article 4: Payment
  sectionHeader(ctx, '4. СТОИМОСТЬ И УСЛОВИЯ ОПЛАТЫ', C.teal);
  ensureSpace(ctx, 100);
  for (const [lbl, val] of [
    ['Стоимость оборудования:', fN(v.acTotal) + ' ₴'],
    ['Стоимость материалов:', fN(v.materialsTotal) + ' ₴'],
    ['Стоимость монтажных работ:', fN(v.workCost) + ' ₴'],
    ...(v.discount > 0 ? [['Скидка:', '– ' + fN(v.discount) + ' ₴']] : []),
  ] as [string,string][]) {
    ctx.page.drawText(lbl, { x: ML + 4, y: pdfY(ctx.y, 8), font: fontR, size: 9.5, color: C.text });
    ctx.page.drawText(val, { x: ML + CW - txtW(fontB, val, 9.5), y: pdfY(ctx.y, 8), font: fontB, size: 9.5, color: C.text });
    ctx.y += 15;
  }
  gap(ctx, 4); hRule(ctx, C.border, 0.8); gap(ctx, 8);
  amountBox(ctx, 'ИТОГОВАЯ СТОИМОСТЬ (с НДС):', fN(d.totalAmount) + ' ₴', C.navy); gap(ctx, 5);
  amountBox(ctx, `АВАНС (${d.advancePct}%) — до начала монтажа:`, fN(d.advanceAmount) + ' ₴', C.teal); gap(ctx, 5);
  ensureSpace(ctx, 22); fillRect(ctx, ML, CW, 20, rgb(0.94, 0.98, 0.95)); borderRect(ctx, ML, CW, 20, C.teal, 0.6);
  ctx.page.drawText('Остаток — в день завершения работ:', { x: ML + 8, y: pdfY(ctx.y, 13), font: fontR, size: 9.5, color: C.text });
  const bw2 = txtW(fontB, fN(d.balanceAmount) + ' ₴', 11);
  ctx.page.drawText(fN(d.balanceAmount) + ' ₴', { x: ML + CW - bw2 - 8, y: pdfY(ctx.y, 14), font: fontB, size: 11, color: C.teal });
  ctx.y += 20; gap(ctx, 8);

  // Article 5: Guarantees
  sectionHeader(ctx, '5. ГАРАНТИИ И ОТВЕТСТВЕННОСТЬ', C.navy);
  for (const txt of [
    `5.1. Гарантийный срок на оборудование: ${v.ac.warranty} год(года) с даты монтажа.`,
    `5.2. Гарантийный срок на монтажные работы: 12 месяцев.`,
    `5.3. Гарантия не распространяется на механические повреждения и нарушение условий эксплуатации.`,
    `5.4. Скрытые дефекты монтажа устраняются бесплатно в течение 5 рабочих дней.`,
  ]) { drawText(ctx, txt, { size: 9.5, maxW: CW }); gap(ctx, 2); }
  if (d.notes) { gap(ctx, 4); drawText(ctx, `Примечания: ${d.notes}`, { size: 9, color: C.muted, maxW: CW }); }

  signatureBlock(ctx);
  return pdfDoc.save();
}

// ─── Specification PDF ────────────────────────────────────────────────────────
async function generateSpecificationPDF(d: {
  contractNumber: string; contractDate: string;
  companyName: string; companyPhone: string;
  client: { name: string; phone: string };
  variant: OfferVariant; materialsItems: MaterialItem[]; totalAmount: number;
}): Promise<Uint8Array> {
  const fonts = await loadFonts();
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontR = await pdfDoc.embedFont(fonts.r);
  const fontB = await pdfDoc.embedFont(fonts.b);
  const ctx: PdfCtx = { doc: pdfDoc, page: pdfDoc.addPage([PW, PH]), y: 0, fontR, fontB };
  const v = d.variant; const fN = (n: number) => n.toLocaleString('uk-UA');

  // Header bar
  fillRect(ctx, 0, PW, 52, C.teal);
  ctx.page.drawText(d.companyName, { x: ML, y: PH - 22, font: fontB, size: 13, color: C.white });
  ctx.page.drawText(`Тел: ${d.companyPhone}`, { x: ML, y: PH - 37, font: fontR, size: 9, color: rgb(0.75, 0.93, 0.87) });
  const specTitle = 'СПЕЦИФИКАЦИЯ (Приложение №1)';
  ctx.page.drawText(specTitle, { x: PW - MR - txtW(fontB, specTitle, 12), y: PH - 20, font: fontB, size: 12, color: C.white });
  const specSub = `к Договору № ${d.contractNumber} от ${d.contractDate}`;
  ctx.page.drawText(specSub, { x: PW - MR - txtW(fontR, specSub, 9), y: PH - 36, font: fontR, size: 9, color: rgb(0.75, 0.93, 0.87) });
  ctx.y = 58;

  gap(ctx, 4);
  ctx.page.drawText(`Заказчик: ${d.client.name}  •  ${d.client.phone}`, { x: ML, y: pdfY(ctx.y, 8), font: fontR, size: 9, color: C.muted });
  ctx.y += 16; hRule(ctx); gap(ctx, 10);

  // 1. Equipment
  sectionHeader(ctx, '1. КЛИМАТИЧЕСКОЕ ОБОРУДОВАНИЕ', C.teal);
  const feats = v.ac.features.map((f: string) => FEATURE_LABELS[f] ?? f).join(', ') || '—';
  drawTable(ctx,
    [{ label: '№', w: 22, align: 'center' }, { label: 'Бренд', w: 72 }, { label: 'Модель', w: 128 },
     { label: 'Характеристики', w: 115 }, { label: 'Кол-во', w: 38, align: 'center' },
     { label: 'Цена, ₴', w: 58, align: 'right' }, { label: 'Сумма, ₴', w: 62, align: 'right' }],
    [['1', v.ac.brand, v.ac.model, `${v.ac.kw}кВт/${(v.ac.btu/1000).toFixed(0)}BTU`, String(v.acCount), fN(v.ac.price), fN(v.acTotal)]]
  );
  drawText(ctx, `Гарантия: ${v.ac.warranty} год(а). Функции: ${feats}.`, { size: 8.5, color: C.muted, maxW: CW }); gap(ctx, 4);

  // 2. Materials
  if (d.materialsItems.length > 0) {
    sectionHeader(ctx, '2. МОНТАЖНЫЕ МАТЕРИАЛЫ И КОМПЛЕКТУЮЩИЕ', C.teal);
    const matRows = d.materialsItems.map((m, i) => [String(i + 1), m.name, m.category, m.unit, String(m.qty), fN(m.pricePerUnit), fN(m.total)]);
    drawTable(ctx,
      [{ label: '№', w: 22, align: 'center' }, { label: 'Наименование', w: 152 }, { label: 'Категория', w: 78 },
       { label: 'Ед.', w: 28, align: 'center' }, { label: 'Кол-во', w: 38, align: 'center' },
       { label: 'Цена, ₴', w: 58, align: 'right' }, { label: 'Сумма, ₴', w: 119, align: 'right' }],
      matRows
    );
    gap(ctx, 2);
  }

  // 3. Works
  sectionHeader(ctx, '3. МОНТАЖНЫЕ РАБОТЫ', C.teal);
  drawTable(ctx,
    [{ label: '№', w: 22, align: 'center' }, { label: 'Вид работ', w: 313 },
     { label: 'Ед.', w: 30, align: 'center' }, { label: 'Кол-во', w: 40, align: 'center' }, { label: 'Сумма, ₴', w: 90, align: 'right' }],
    [
      ['1', 'Монтаж внутреннего и наружного блоков', 'компл', '1', fN(Math.round(v.workCost * 0.4))],
      ['2', 'Прокладка медной фреоновой трассы и дренажа', 'компл', '1', fN(Math.round(v.workCost * 0.3))],
      ['3', 'Прокладка кабеля питания и подключение', 'компл', '1', fN(Math.round(v.workCost * 0.2))],
      ['4', 'Вакуумирование, заправка фреоном, пуско-наладка', 'компл', '1', fN(Math.round(v.workCost * 0.1))],
    ]
  );

  // 4. Totals
  sectionHeader(ctx, '4. ИТОГ', C.navy);
  ensureSpace(ctx, 80);
  for (const [lbl, val] of [
    ['Оборудование:', fN(v.acTotal) + ' ₴'],
    ['Монтажные материалы:', fN(v.materialsTotal) + ' ₴'],
    ['Монтажные работы:', fN(v.workCost) + ' ₴'],
    ...(v.discount > 0 ? [['Скидка:', '– ' + fN(v.discount) + ' ₴']] : []),
  ] as [string,string][]) {
    ctx.page.drawText(lbl, { x: ML + 4, y: pdfY(ctx.y, 8), font: fontR, size: 9.5, color: C.text });
    ctx.page.drawText(val, { x: ML + CW - txtW(fontR, val, 9.5), y: pdfY(ctx.y, 8), font: fontR, size: 9.5, color: C.text });
    ctx.y += 14;
  }
  gap(ctx, 6); amountBox(ctx, 'ИТОГОВАЯ СТОИМОСТЬ:', fN(d.totalAmount) + ' ₴', C.navy); gap(ctx, 6);
  drawText(ctx, `Настоящая спецификация является неотъемлемой частью Договора № ${d.contractNumber} от ${d.contractDate}.`, { size: 9, color: C.muted, maxW: CW });
  signatureBlock(ctx);
  return pdfDoc.save();
}

// ─── Document storage & endpoints ────────────────────────────────────────────
interface DocumentRecord {
  id: string; leadId: string; clientId: string; offerId: string;
  contractNumber: string; contractDate: string; selectedTier: string;
  advancePct: number; totalAmount: number; advanceAmount: number; balanceAmount: number;
  contractPath: string; contractUrl: string; specPath: string; specUrl: string;
  createdAt: string;
}

async function signDocUrl(path: string): Promise<string> {
  const { data } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 30);
  return data?.signedUrl ?? '';
}

app.post('/make-server-1df47c03/documents/generate', async (c) => {
  try {
    const body = await c.req.json();
    const {
      leadId, offerId, selectedTier = 'standard', advancePct = 50,
      contractNumber, notes = '',
      companyName = 'ООО "КЛИМАТ СЕРВИС"', companyCode = '12345678',
      companyDirector = 'Директор', companyPhone = '+380 44 000-00-00', city = 'Киев',
    } = body;

    if (!leadId || !offerId) return c.json({ error: 'leadId and offerId are required' }, 400);

    const [leadRaw, offerRaw] = await Promise.all([kv.get(`lead:${leadId}`), kv.get(`offer:${offerId}`)]);
    if (!leadRaw) return c.json({ error: 'Lead not found' }, 404);
    if (!offerRaw) return c.json({ error: 'Offer not found' }, 404);

    const lead = JSON.parse(leadRaw);
    const offer = JSON.parse(offerRaw);
    const clientRaw = await kv.get(`client:${lead.clientId}`);
    const client = clientRaw ? JSON.parse(clientRaw) : { name: '—', phone: '—', email: null };
    const variant: OfferVariant = offer.variants.find((v: OfferVariant) => v.tier === selectedTier) ?? offer.variants[0];
    if (!variant) return c.json({ error: 'Variant not found' }, 400);

    // Materials
    const measId = await kv.get(`measurement_by_lead:${leadId}`);
    let materialsItems: MaterialItem[] = [];
    if (measId) { const mr = await kv.get(`measurement:${measId}`); if (mr) materialsItems = JSON.parse(mr).materials_json?.items ?? []; }

    const totalAmount = variant.total;
    const advanceAmount = Math.round(totalAmount * advancePct / 100);
    const balanceAmount = totalAmount - advanceAmount;
    const contractDate = new Date().toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const docNum = contractNumber || `${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

    const pdfData = { contractNumber: docNum, contractDate, city, companyName, companyCode, companyDirector, companyPhone, client, variant, materialsItems, advancePct, advanceAmount, balanceAmount, totalAmount, notes };

    console.log('Generating PDFs for lead:', leadId, 'tier:', selectedTier);
    const [contractBytes, specBytes] = await Promise.all([generateContractPDF(pdfData), generateSpecificationPDF(pdfData)]);

    const prefix = `${leadId}/${docNum}`;
    const contractPath = `${prefix}_contract.pdf`;
    const specPath = `${prefix}_specification.pdf`;

    const [cUp, sUp] = await Promise.all([
      supabase.storage.from(DOC_BUCKET).upload(contractPath, contractBytes, { contentType: 'application/pdf', upsert: true }),
      supabase.storage.from(DOC_BUCKET).upload(specPath, specBytes, { contentType: 'application/pdf', upsert: true }),
    ]);
    if (cUp.error) throw new Error(`Contract upload: ${cUp.error.message}`);
    if (sUp.error) throw new Error(`Spec upload: ${sUp.error.message}`);

    const [contractUrl, specUrl] = await Promise.all([signDocUrl(contractPath), signDocUrl(specPath)]);

    const docId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const doc: DocumentRecord = { id: docId, leadId, clientId: lead.clientId, offerId, contractNumber: docNum, contractDate, selectedTier, advancePct, totalAmount, advanceAmount, balanceAmount, contractPath, contractUrl, specPath, specUrl, createdAt: new Date().toISOString() };

    await kv.set(`document:${docId}`, JSON.stringify(doc));
    const dlRaw = await kv.get(`documents_by_lead:${leadId}`);
    const dl: string[] = dlRaw ? JSON.parse(dlRaw) : [];
    dl.unshift(docId);
    await kv.set(`documents_by_lead:${leadId}`, JSON.stringify(dl));

    console.log('Documents saved:', docId);
    return c.json({ document: doc });
  } catch (error) {
    console.error('Error generating documents:', error);
    return c.json({ error: `Failed to generate documents: ${error.message}` }, 500);
  }
});

app.get('/make-server-1df47c03/documents/lead/:leadId', async (c) => {
  try {
    const leadId = c.req.param('leadId');
    const listRaw = await kv.get(`documents_by_lead:${leadId}`);
    if (!listRaw) return c.json({ documents: [] });
    const ids: string[] = JSON.parse(listRaw);
    const docs: DocumentRecord[] = [];
    for (const id of ids) {
      const raw = await kv.get(`document:${id}`); if (!raw) continue;
      const doc = JSON.parse(raw);
      const [cu, su] = await Promise.all([signDocUrl(doc.contractPath), signDocUrl(doc.specPath)]);
      docs.push({ ...doc, contractUrl: cu, specUrl: su });
    }
    return c.json({ documents: docs });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return c.json({ error: `Failed to fetch documents: ${error.message}` }, 500);
  }
});

app.get('/make-server-1df47c03/documents/:docId', async (c) => {
  try {
    const raw = await kv.get(`document:${c.req.param('docId')}`);
    if (!raw) return c.json({ error: 'Document not found' }, 404);
    const doc = JSON.parse(raw);
    const [cu, su] = await Promise.all([signDocUrl(doc.contractPath), signDocUrl(doc.specPath)]);
    return c.json({ document: { ...doc, contractUrl: cu, specUrl: su } });
  } catch (error) { return c.json({ error: `Failed to fetch document: ${error.message}` }, 500); }
});

app.get('/make-server-1df47c03/company-config', async (c) => {
  try {
    const raw = await kv.get('config:company');
    const def = { companyName: 'ООО "КЛИМАТ СЕРВИС"', companyCode: '12345678', companyDirector: 'Иванов И.И.', companyPhone: '+380 44 000-00-00', city: 'Киев' };
    return c.json({ config: raw ? { ...def, ...JSON.parse(raw) } : def });
  } catch (error) { return c.json({ error: error.message }, 500); }
});

app.post('/make-server-1df47c03/company-config', async (c) => {
  try {
    const body = await c.req.json();
    await kv.set('config:company', JSON.stringify(body));
    return c.json({ success: true, config: body });
  } catch (error) { return c.json({ error: error.message }, 500); }
});

// Register warehouse routes
registerWarehouseRoutes(app);

// Register procurement routes
registerProcurementRoutes(app);

// Register service reminders routes
registerRemindersRoutes(app);

// Register ventilation analysis routes
registerVentilationRoutes(app);

// Register training & certification routes
registerTrainingRoutes(app);

// Register install orders routes
registerInstallOrderRoutes(app);

// Register equipment catalog routes
registerEquipmentRoutes(app);

// ─── MANUAL LEAD CREATION ─────────────────────────────────────────────────────
app.post('/make-server-1df47c03/leads/create', async (c) => {
  try {
    const body = await c.req.json();
    const { clientName, clientPhone, clientEmail, area, roomType, roomsCount, budget, preferences, address, additionalNotes } = body;
    if (!clientName || !clientPhone) return c.json({ error: 'clientName и clientPhone обязательны' }, 400);

    const client = await findOrCreateClient({ name: clientName, phone: clientPhone, email: clientEmail || null });

    const leadId = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const lead = {
      id: leadId,
      clientId: client.id,
      status: 'new',
      source: 'manual',
      requirements_json: {
        area: area ? Number(area) : null,
        roomType: roomType || null,
        roomsCount: roomsCount ? Number(roomsCount) : null,
        preferences: preferences || [],
        budget: budget ? Number(budget) : null,
        additionalNotes: additionalNotes || '',
        address: address || null,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`lead:${leadId}`, JSON.stringify(lead));
    const clKey = `leads_by_client:${client.id}`;
    const existing = await kv.get(clKey);
    const list = existing ? JSON.parse(existing) : [];
    list.push(leadId);
    await kv.set(clKey, JSON.stringify(list));
    console.log('[leads/create] manual lead:', leadId, 'for', clientName);
    return c.json({ success: true, client, lead }, 201);
  } catch (error: any) {
    console.error('[leads/create] error:', error);
    return c.json({ error: `Failed: ${error.message}` }, 500);
  }
});

// ─── MATCH AC FROM REQUIREMENTS ──────────────────────────────────────────────
app.post('/make-server-1df47c03/ac-match', async (c) => {
  try {
    const { area, budget, preferredTier, minBtu } = await c.req.json();
    const areaNum = Number(area) || 0;
    const budgetNum = Number(budget) || 0;
    const btu = Number(minBtu) || Math.max(7000, Math.round(areaNum * 100));

    let candidates = AC_CATALOG.filter(m =>
      (areaNum === 0 || (m.areaMin <= areaNum + 10 && m.areaMax >= areaNum - 5))
      && (budgetNum === 0 || m.price <= budgetNum * 1.2)
    );
    if (preferredTier && candidates.some(m => m.tier === preferredTier)) {
      candidates = candidates.filter(m => m.tier === preferredTier);
    }
    if (candidates.length === 0) candidates = [...AC_CATALOG];

    const scored = candidates.map(m => ({
      ...m,
      score: (
        (Math.abs((m.areaMin + m.areaMax) / 2 - areaNum) < 8 ? 20 : 0) +
        (budgetNum > 0 && m.price <= budgetNum ? 15 : 0) +
        (preferredTier && m.tier === preferredTier ? 10 : 0) +
        (Math.abs(m.btu - btu) < 2000 ? 10 : 0)
      ),
    })).sort((a, b) => b.score - a.score);

    return c.json({ matches: scored.slice(0, 3) });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── PARSE CONVERSATION (paste client dialog) ────────────────────────────────

const PARSE_CONVERSATION_PROMPT = `Ты — AI-ассистент CRM-системы для компании по установке кондиционеров.

Менеджер вставляет переписку с клиентом (из мессенджера, email, или телефонного разговора).
Твоя задача — проанализировать диалог и извлечь ВСЮ полезную информацию.

ОБЯЗАТЕЛЬНО верни JSON объект (и ТОЛЬКО JSON, без markdown):
{
  "client": {
    "name": "Имя клиента (если не указано — 'Клиент')",
    "phone": "Телефон (если есть)",
    "email": "Email или null"
  },
  "requirements": {
    "area": число или null,
    "roomType": "тип помещения или null",
    "roomsCount": число или null,
    "preferences": ["список пожеланий"],
    "budget": число или null,
    "additionalNotes": "любая доп. информация из диалога",
    "address": "адрес если упоминается или null"
  },
  "suggestedAction": "краткая рекомендация менеджеру (что делать дальше)",
  "summary": "краткое резюме диалога в 2-3 предложения",
  "acRecommendation": {
    "minBtu": число,
    "preferredTier": "economy/standard/premium",
    "reason": "почему этот вариант"
  },
  "urgency": "low/medium/high",
  "confidence": число от 0 до 100
}

Если какие-то данные не найдены в диалоге — ставь null.
Анализируй контекст: если клиент упоминает детей/аллергию — добавь "filter" в preferences.
Если упоминает шум — добавь "silent". Если говорит про управление с телефона — "wifi".
Если budget не указан явно, но клиент говорит "недорого/бюджетный" — ставь tier economy.
Если "лучшее/премиум/качество" — premium. Иначе standard.`;

app.post('/make-server-1df47c03/parse-conversation', async (c) => {
  try {
    const { conversation } = await c.req.json();
    if (!conversation || conversation.trim().length < 10) {
      return c.json({ error: 'Текст переписки слишком короткий' }, 400);
    }

    const apiKey = Deno.env.get('kapelan_openai_api_key');
    if (!apiKey) return c.json({ error: 'OpenAI API key not configured' }, 500);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: PARSE_CONVERSATION_PROMPT },
          { role: 'user', content: `Вот переписка с клиентом:\n\n${conversation}` },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI parse-conversation error:', err);
      return c.json({ error: 'AI не смог обработать переписку' }, 500);
    }

    const data = await response.json();
    let aiText = data.choices[0].message.content;
    aiText = aiText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(aiText);
    } catch {
      console.error('Failed to parse AI response as JSON:', aiText);
      return c.json({ error: 'AI вернул некорректный ответ. Попробуйте снова.', raw: aiText }, 500);
    }

    return c.json({ parsed });
  } catch (error: any) {
    console.error('Error in parse-conversation:', error);
    return c.json({ error: `Ошибка: ${error.message}` }, 500);
  }
});

// Create lead from parsed conversation
app.post('/make-server-1df47c03/create-lead-from-conversation', async (c) => {
  try {
    const { clientData, requirements, acRecommendation } = await c.req.json();
    if (!clientData) return c.json({ error: 'clientData is required' }, 400);

    const client = await findOrCreateClient({
      name: clientData.name || 'Клиент',
      phone: clientData.phone || '',
      email: clientData.email || null,
    });

    const leadId = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const lead = {
      id: leadId,
      clientId: client.id,
      status: 'new',
      source: 'conversation_paste',
      requirements_json: {
        ...requirements,
        _acRecommendation: acRecommendation || null,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`lead:${leadId}`, JSON.stringify(lead));

    const clientLeadsKey = `leads_by_client:${client.id}`;
    const existingLeadsData = await kv.get(clientLeadsKey);
    const existingLeads = existingLeadsData ? JSON.parse(existingLeadsData) : [];
    existingLeads.push(leadId);
    await kv.set(clientLeadsKey, JSON.stringify(existingLeads));

    // Telegram notification
    try {
      const req = requirements || {};
      const tgText = [
        `📋 <b>Новая заявка из переписки!</b>`,
        ``,
        `👤 Клиент: <b>${client.name}</b>`,
        `📞 Телефон: ${client.phone || '—'}`,
        client.email ? `📧 Email: ${client.email}` : '',
        ``,
        req.area ? `📐 Площадь: <b>${req.area} м²</b>` : '',
        req.roomType ? `🏠 Тип: ${req.roomType}` : '',
        req.roomsCount ? `🚪 Комнат: ${req.roomsCount}` : '',
        req.budget ? `💰 Бюджет: ${Number(req.budget).toLocaleString()} ₴` : '',
        req.address ? `📍 Адрес: ${req.address}` : '',
        acRecommendation ? `❄️ Рекомендация: ${acRecommendation.preferredTier} (${acRecommendation.minBtu} BTU)` : '',
        ``,
        `🕐 ${new Date().toLocaleString('ru-RU')}`,
      ].filter(Boolean).join('\n');
      await sendTelegramMessage(tgText);
    } catch (tgErr) {
      console.error('TG notification error (conversation lead):', tgErr);
    }

    console.log('Created lead from conversation:', leadId);
    return c.json({ success: true, client, lead });
  } catch (error: any) {
    console.error('Error creating lead from conversation:', error);
    return c.json({ error: `Failed: ${error.message}` }, 500);
  }
});

// ─── INSTALLER MANAGEMENT & ASSIGNMENT ───────────────────────────────────────

app.get('/make-server-1df47c03/installers', async (c) => {
  try {
    const raw = await kv.getByPrefix('installer:');
    const installers = raw.map(d => { try { return JSON.parse(d); } catch { return null; } }).filter(Boolean);
    installers.sort((a: any, b: any) => a.name.localeCompare(b.name));
    return c.json({ installers });
  } catch (error: any) {
    console.error('Error fetching installers:', error);
    return c.json({ error: `Failed: ${error.message}` }, 500);
  }
});

app.post('/make-server-1df47c03/installers', async (c) => {
  try {
    const body = await c.req.json();
    const { name, phone, tgChatId, specialization, notes, photoUrl } = body;
    if (!name || !phone) return c.json({ error: 'name and phone are required' }, 400);

    const id = body.id || `installer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const installer = {
      id, name, phone,
      tgChatId: tgChatId || null,
      specialization: specialization || 'general',
      notes: notes || '',
      photoUrl: photoUrl || null,
      active: true,
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`installer:${id}`, JSON.stringify(installer));
    console.log('Installer saved:', id);
    return c.json({ installer });
  } catch (error: any) {
    console.error('Error saving installer:', error);
    return c.json({ error: `Failed: ${error.message}` }, 500);
  }
});

app.delete('/make-server-1df47c03/installers/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await kv.del(`installer:${id}`);
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: `Failed: ${error.message}` }, 500);
  }
});

app.post('/make-server-1df47c03/assign-installer', async (c) => {
  try {
    const { leadId, installerId, scheduledDate, scheduledTime, notes } = await c.req.json();
    if (!leadId || !installerId) return c.json({ error: 'leadId and installerId required' }, 400);

    const leadRaw = await kv.get(`lead:${leadId}`);
    if (!leadRaw) return c.json({ error: 'Lead not found' }, 404);
    const lead = JSON.parse(leadRaw);

    const installerRaw = await kv.get(`installer:${installerId}`);
    if (!installerRaw) return c.json({ error: 'Installer not found' }, 404);
    const installer = JSON.parse(installerRaw);

    const clientRaw = await kv.get(`client:${lead.clientId}`);
    const client = clientRaw ? JSON.parse(clientRaw) : null;

    const measId = await kv.get(`measurement_by_lead:${leadId}`);
    let measurement: any = null;
    if (measId) {
      const mRaw = await kv.get(`measurement:${measId}`);
      if (mRaw) measurement = JSON.parse(mRaw);
    }

    const assignmentId = `assignment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const assignment = {
      id: assignmentId, leadId, installerId,
      installerName: installer.name,
      clientName: client?.name || '—',
      clientPhone: client?.phone || '—',
      scheduledDate: scheduledDate || null,
      scheduledTime: scheduledTime || null,
      notes: notes || '',
      status: 'assigned',
      createdAt: new Date().toISOString(),
    };

    await kv.set(`assignment:${assignmentId}`, JSON.stringify(assignment));
    await kv.set(`assignment_by_lead:${leadId}`, assignmentId);

    lead.assignedInstallerId = installerId;
    lead.assignedInstallerName = installer.name;
    lead.assignmentId = assignmentId;
    lead.scheduledDate = scheduledDate || null;
    lead.scheduledTime = scheduledTime || null;
    lead.updatedAt = new Date().toISOString();
    await kv.set(`lead:${leadId}`, JSON.stringify(lead));

    // Telegram to installer
    if (installer.tgChatId) {
      try {
        const { botToken } = await getTgConfig();
        if (botToken) {
          const req = lead.requirements_json || {};
          const tgText = [
            `🔧 <b>Новое назначение!</b>`,
            ``,
            `👤 Клиент: <b>${client?.name || '—'}</b>`,
            `📞 Телефон: <a href="tel:${client?.phone}">${client?.phone || '—'}</a>`,
            client?.email ? `📧 ${client.email}` : '',
            ``,
            scheduledDate ? `📅 Дата: <b>${scheduledDate}</b>` : '',
            scheduledTime ? `🕐 Время: <b>${scheduledTime}</b>` : '',
            req.address ? `📍 Адрес: ${req.address}` : '',
            ``,
            req.area ? `📐 Площадь: ${req.area} м²` : '',
            req.roomsCount ? `🚪 Комнат: ${req.roomsCount}` : '',
            measurement ? `📏 Трасса: ${measurement.traceLength} м` : '',
            measurement ? `💰 Стоимость работ: ${measurement.workCost?.toLocaleString()} ₴` : '',
            measurement?.materials_json ? `📦 Материалы: ${measurement.materials_json.totalMaterials?.toLocaleString()} ₴` : '',
            notes ? `📝 ${notes}` : '',
            ``,
            `⚡ Подтвердите получение задачи!`,
          ].filter(Boolean).join('\n');

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: installer.tgChatId, text: tgText, parse_mode: 'HTML' }),
          });
          console.log('Telegram sent to installer:', installer.name);
        }
      } catch (tgErr) {
        console.error('TG installer notification error:', tgErr);
      }
    }

    // Notify admin
    try {
      await sendTelegramMessage(
        `✅ <b>Монтажник назначен!</b>\n\n` +
        `👷 ${installer.name}\n` +
        `👤 Клиент: ${client?.name || '—'}\n` +
        (scheduledDate ? `📅 ${scheduledDate} ${scheduledTime || ''}\n` : '') +
        `\n🕐 ${new Date().toLocaleString('ru-RU')}`
      );
    } catch { /* silent */ }

    return c.json({ success: true, assignment, lead });
  } catch (error: any) {
    console.error('Error assigning installer:', error);
    return c.json({ error: `Failed: ${error.message}` }, 500);
  }
});

app.get('/make-server-1df47c03/assignment/lead/:leadId', async (c) => {
  try {
    const leadId = c.req.param('leadId');
    const assignmentId = await kv.get(`assignment_by_lead:${leadId}`);
    if (!assignmentId) return c.json({ assignment: null });
    const raw = await kv.get(`assignment:${assignmentId}`);
    if (!raw) return c.json({ assignment: null });
    return c.json({ assignment: JSON.parse(raw) });
  } catch (error: any) {
    return c.json({ error: `Failed: ${error.message}` }, 500);
  }
});

// GET all assignments
app.get('/make-server-1df47c03/assignments', async (c) => {
  try {
    const raw = await kv.getByPrefix('assignment:');
    const assignments = raw
      .map(d => { try { return JSON.parse(d); } catch { return null; } })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return c.json({ assignments });
  } catch (error: any) {
    console.error('Error fetching assignments:', error);
    return c.json({ error: `Failed: ${error.message}` }, 500);
  }
});

// PATCH update assignment status
app.patch('/make-server-1df47c03/assignments/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const raw = await kv.get(`assignment:${id}`);
    if (!raw) return c.json({ error: 'Assignment not found' }, 404);
    const assignment = JSON.parse(raw);
    const patch = await c.req.json();
    for (const key of ['status', 'scheduledDate', 'scheduledTime', 'notes']) {
      if (patch[key] !== undefined) (assignment as any)[key] = patch[key];
    }
    assignment.updatedAt = new Date().toISOString();
    await kv.set(`assignment:${id}`, JSON.stringify(assignment));
    return c.json({ assignment });
  } catch (error: any) {
    return c.json({ error: `Failed: ${error.message}` }, 500);
  }
});

Deno.serve(app.fetch);