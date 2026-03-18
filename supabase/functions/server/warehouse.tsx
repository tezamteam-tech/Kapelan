// ─── WAREHOUSE MODULE — routes exported and mounted in index.tsx ──────────────
// This file is NOT standalone — it exports a function that registers routes on `app`
// Usage in index.tsx: import { registerWarehouseRoutes } from "./warehouse.tsx"; registerWarehouseRoutes(app, kv);

import * as kv from "./kv_store.tsx";

export interface WarehouseItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: number;
  sku: string;
  supplier?: string;
  notes?: string;
  imageUrl?: string;
  itemType?: 'consumable' | 'assembly' | 'equipment'; // consumable=simple, assembly=kit with sub-items, equipment=device
  assemblyComponents?: { warehouseId: string; name: string; qty: number; unit: string }[];
  updatedAt: string;
  createdAt: string;
}

export interface StockMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: 'in' | 'out' | 'adjustment';
  qty: number;
  stockBefore: number;
  stockAfter: number;
  reason: string;
  referenceId?: string;
  note?: string;
  createdAt: string;
}

export interface PurchaseOrder {
  id: string;
  itemId: string;
  itemName: string;
  itemUnit: string;
  qtyOrdered: number;
  qtyReceived: number;
  pricePerUnit: number;
  totalCost: number;
  supplier: string;
  status: 'pending' | 'ordered' | 'received' | 'cancelled';
  reason: 'low_stock' | 'manual';
  note?: string;
  createdAt: string;
  updatedAt: string;
}

const now = () => new Date().toISOString();

const DEFAULT_WAREHOUSE: WarehouseItem[] = [
  // ── Трубопровод ─────────────────────────────────────────────────────────────
  { id: 'wh_pipe_14',    name: 'Медная труба 1/4" (жидкостная линия)', category: 'Трубопровод', unit: 'м',     stock: 50,  minStock: 20,  price: 85,   sku: 'PIPE-14',    supplier: 'МедьОпт',    notes: 'Для сплитов до 12000 BTU', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1640624910770-af6f133451ac?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_pipe_38',    name: 'Медная труба 3/8" (газовая линия)',    category: 'Трубопровод', unit: 'м',     stock: 50,  minStock: 20,  price: 120,  sku: 'PIPE-38',    supplier: 'МедьОпт',    notes: 'Для сплитов до 18000 BTU', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1640624910770-af6f133451ac?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_pipe_12',    name: 'Медная труба 1/2" (газовая линия)',    category: 'Трубопровод', unit: 'м',     stock: 20,  minStock: 10,  price: 175,  sku: 'PIPE-12',    supplier: 'МедьОпт',    notes: 'Для сплитов 24000 BTU и чиллеров', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1640624910770-af6f133451ac?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_insul_14',   name: 'Теплоизоляция 9мм (для 1/4")',        category: 'Трубопровод', unit: 'м',     stock: 60,  minStock: 25,  price: 45,   sku: 'INS-9',      supplier: 'АрмаФлекс',  notes: '', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1640624910770-af6f133451ac?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_insul_38',   name: 'Теплоизоляция 13мм (для 3/8")',       category: 'Трубопровод', unit: 'м',     stock: 60,  minStock: 25,  price: 55,   sku: 'INS-13',     supplier: 'АрмаФлекс',  notes: '', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1640624910770-af6f133451ac?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_insul_19',   name: 'Теплоизоляция 19мм (для чил. воды)', category: 'Трубопровод', unit: 'м',     stock: 30,  minStock: 10,  price: 85,   sku: 'INS-19',     supplier: 'АрмаФлекс',  notes: 'Для труб чиллерных систем (толщина стенки 19мм)', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1640624910770-af6f133451ac?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_tape',       name: 'Самовулканизирующаяся лента',          category: 'Трубопровод', unit: 'м',     stock: 30,  minStock: 10,  price: 35,   sku: 'TAPE-SV',    supplier: '',           notes: '', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1640624910770-af6f133451ac?w=400', updatedAt: now(), createdAt: now() },
  // ── Дренаж ───────────────────────────────────────────────────────────────────
  { id: 'wh_drain_pipe', name: 'Дренажная труба ø16мм',               category: 'Дренаж',      unit: 'м',     stock: 40,  minStock: 15,  price: 25,   sku: 'DRAIN-16',   supplier: '',           notes: '', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1640624910770-af6f133451ac?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_drain_pump', name: 'Дренажный насос (кондесатный)',        category: 'Дренаж',      unit: 'шт',   stock: 5,   minStock: 2,   price: 1800, sku: 'PUMP-DRN',   supplier: 'КлиматТех',  notes: 'Для помещений без возможности гравитационного дренажа', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1708244546493-079b001e0b5b?w=400', updatedAt: now(), createdAt: now() },
  // ── Электрика ──────────────────────────────────────────────────────────────
  { id: 'wh_cable',      name: 'Кабель питания 3×1.5мм²',             category: 'Электрика',   unit: 'м',     stock: 100, minStock: 30,  price: 55,   sku: 'CABLE-3X15', supplier: 'КабельМаркет', notes: 'Для сплитов до 12000 BTU', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1663559147223-6b0d012a4d0a?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_cable_25',   name: 'Кабель питания 3×2.5мм²',             category: 'Электрика',   unit: 'м',     stock: 50,  minStock: 20,  price: 85,   sku: 'CABLE-3X25', supplier: 'КабельМаркет', notes: 'Для сплитов 18-24k BTU и фанкойлов', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1663559147223-6b0d012a4d0a?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_cable_duct', name: 'Кабельный канал 60×40',               category: 'Электрика',   unit: 'м',     stock: 40,  minStock: 15,  price: 95,   sku: 'DUCT-6040',  supplier: '',           notes: '', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1663559147223-6b0d012a4d0a?w=400', updatedAt: now(), createdAt: now() },
  // ── Крепёж ────────────────────────────────────────────────────────────────
  { id: 'wh_dowels',     name: 'Дюбель-шуруп 6×60',                  category: 'Крепёж',      unit: 'шт',   stock: 300, minStock: 100, price: 5,    sku: 'DWL-6X60',   supplier: '',           notes: '', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1713662653109-5e372136d4bd?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_clamps',     name: 'Хомуты для крепления труб',           category: 'Крепёж',      unit: 'шт',   stock: 200, minStock: 80,  price: 8,    sku: 'CLMP-STD',   supplier: '',           notes: '', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1713662653109-5e372136d4bd?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_brackets',   name: 'Кронштейны для наружного блока',      category: 'Крепёж',      unit: 'компл', stock: 10,  minStock: 4,   price: 450,  sku: 'BRKT-OUT',   supplier: 'МонтажПро',  notes: 'Комплект: 2 кронштейна + 4 болта M10 + гайки', itemType: 'assembly',
    assemblyComponents: [
      { warehouseId: 'wh_dowels', name: 'Дюбель-шуруп 6×60', qty: 4, unit: 'шт' },
    ],
    imageUrl: 'https://images.unsplash.com/photo-1713662653109-5e372136d4bd?w=400', updatedAt: now(), createdAt: now() },
  // ── Расходники ──────────────────────────────────────────────────────────────
  { id: 'wh_freon',      name: 'Фреон R32 (баллон 10кг)',              category: 'Расходники',  unit: 'кг',   stock: 15,  minStock: 5,   price: 350,  sku: 'R32-KG',     supplier: 'ГазСнаб',    notes: 'GWP=675, работа с манометрной станцией', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1632339009787-0626abedd0c9?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_freon_410',  name: 'Фреон R410A (баллон 11.3кг)',          category: 'Расходники',  unit: 'кг',   stock: 10,  minStock: 5,   price: 320,  sku: 'R410A-KG',   supplier: 'ГазСнаб',    notes: 'GWP=2088, для старых моделей', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1632339009787-0626abedd0c9?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_sealant',    name: 'Герметик силиконовый нейтральный',     category: 'Расходники',  unit: 'шт',   stock: 12,  minStock: 4,   price: 120,  sku: 'SEAL-SIL',   supplier: '',           notes: '', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1706524077391-12206f155e94?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_gland',      name: 'Сальники кабельного ввода',            category: 'Расходники',  unit: 'шт',   stock: 40,  minStock: 15,  price: 25,   sku: 'GLAND-STD',  supplier: '',           notes: '', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1603417405991-4fd97e52ccea?w=400', updatedAt: now(), createdAt: now() },
  // ── Чиллерные системы ─────────────────────────────────────────────────────
  { id: 'wh_ppr_pipe_20', name: 'Труба ПВХ/ППР 20мм (чиллер)',        category: 'Трубопровод', unit: 'м',    stock: 30,  minStock: 10,  price: 55,   sku: 'PPR-20',     supplier: 'АкваПайп',   notes: 'Для разводки холодной воды чиллерных систем', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1640624910770-af6f133451ac?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_ppr_pipe_32', name: 'Труба ПВХ/ППР 32мм (чиллер)',        category: 'Трубопровод', unit: 'м',    stock: 20,  minStock: 8,   price: 90,   sku: 'PPR-32',     supplier: 'АкваПайп',   notes: 'Для магистральных труб чиллерных систем', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1640624910770-af6f133451ac?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_ball_valve',  name: 'Шаровой кран 3/4"',                   category: 'Фурнитура',   unit: 'шт',  stock: 15,  minStock: 6,   price: 180,  sku: 'BV-34',      supplier: '',           notes: 'Полнопроходной, для запорной арматуры', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1713662653109-5e372136d4bd?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_flex_conn',   name: 'Гибкая подводка 3/4" (пара)',         category: 'Фурнитура',   unit: 'компл', stock: 10, minStock: 4,   price: 350,  sku: 'FLEX-34',    supplier: '',           notes: 'Для подключения фанкойлов к чиллерной магистрали', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1713662653109-5e372136d4bd?w=400', updatedAt: now(), createdAt: now() },
  { id: 'wh_motor_valve', name: 'Моторизированный клапан 2-ход. 3/4"', category: 'Фурнитура',  unit: 'шт',  stock: 8,   minStock: 3,   price: 1200, sku: 'MV-2W-34',   supplier: 'ВентКомп',   notes: 'Управление потоком в фанкойле, питание 220В', itemType: 'consumable', imageUrl: 'https://images.unsplash.com/photo-1603417405991-4fd97e52ccea?w=400', updatedAt: now(), createdAt: now() },
];

// ── KV helpers ────────────────────────────────────────────────────────────────
export async function getAllWarehouseItems(): Promise<WarehouseItem[]> {
  try {
    const all = await kv.getByPrefix('wh_item:');
    if (all.length > 0) {
      return (all as string[]).map(r => JSON.parse(r)).filter(Boolean)
        .sort((a: WarehouseItem, b: WarehouseItem) =>
          a.category.localeCompare(b.category, 'ru') || a.name.localeCompare(b.name, 'ru'));
    }
    for (const item of DEFAULT_WAREHOUSE) {
      await kv.set(`wh_item:${item.id}`, JSON.stringify(item));
    }
    return DEFAULT_WAREHOUSE;
  } catch (e) { console.error('getAllWarehouseItems:', e); return []; }
}

export async function getWarehouseItem(id: string): Promise<WarehouseItem | null> {
  const raw = await kv.get(`wh_item:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveWarehouseItem(item: WarehouseItem): Promise<void> {
  item.updatedAt = new Date().toISOString();
  await kv.set(`wh_item:${item.id}`, JSON.stringify(item));
}

export async function addMovement(mov: Omit<StockMovement, 'id' | 'createdAt'>): Promise<StockMovement> {
  const full: StockMovement = {
    ...mov,
    id: `mov_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  await kv.set(`wh_mov:${full.id}`, JSON.stringify(full));
  const idx = await kv.get(`wh_mov_idx:${mov.itemId}`);
  const list: string[] = idx ? JSON.parse(idx) : [];
  list.unshift(full.id);
  await kv.set(`wh_mov_idx:${mov.itemId}`, JSON.stringify(list.slice(0, 200)));
  const gRaw = await kv.get('wh_mov_global');
  const gList: string[] = gRaw ? JSON.parse(gRaw) : [];
  gList.unshift(full.id);
  await kv.set('wh_mov_global', JSON.stringify(gList.slice(0, 500)));
  return full;
}

export async function checkAndCreatePurchaseOrder(item: WarehouseItem): Promise<PurchaseOrder | null> {
  if (item.stock >= item.minStock) return null;
  const existing = await kv.get(`wh_pending_po:${item.id}`);
  if (existing) return null;
  const deficit = item.minStock - item.stock;
  const qtyNeeded = Math.ceil(deficit * 1.5);
  const po: PurchaseOrder = {
    id: `po_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
    itemId: item.id, itemName: item.name, itemUnit: item.unit,
    qtyOrdered: qtyNeeded, qtyReceived: 0,
    pricePerUnit: item.price, totalCost: qtyNeeded * item.price,
    supplier: item.supplier || '—',
    status: 'pending', reason: 'low_stock',
    note: `Автозаявка: остаток ${item.stock} ${item.unit} < мин. ${item.minStock} ${item.unit}`,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await kv.set(`wh_po:${po.id}`, JSON.stringify(po));
  await kv.set(`wh_pending_po:${item.id}`, po.id);
  const idx = await kv.get('wh_po_index');
  const list: string[] = idx ? JSON.parse(idx) : [];
  list.unshift(po.id);
  await kv.set('wh_po_index', JSON.stringify(list));
  console.log(`Auto-PO: ${po.id} for "${item.name}", qty: ${qtyNeeded}`);
  return po;
}

// ── Route registration ───────────────────────────────────────────────────────
export function registerWarehouseRoutes(app: any): void {
  const P = '/make-server-1df47c03';

  // GET all items
  app.get(`${P}/warehouse`, async (c: any) => {
    try {
      const items = await getAllWarehouseItems();
      const lowStockCount = items.filter(i => i.stock < i.minStock).length;
      const totalValue = items.reduce((s, i) => s + i.stock * i.price, 0);
      return c.json({ items, lowStockCount, totalValue });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch warehouse: ${error.message}` }, 500);
    }
  });

  // POST create item
  app.post(`${P}/warehouse`, async (c: any) => {
    try {
      const body = await c.req.json();
      const id = `wh_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;
      const item: WarehouseItem = {
        id, name: body.name || 'Новая позиция', category: body.category || 'Прочее',
        unit: body.unit || 'шт', stock: Number(body.stock ?? 0),
        minStock: Number(body.minStock ?? 0), price: Number(body.price ?? 0),
        sku: body.sku || '', supplier: body.supplier || '', notes: body.notes || '',
        imageUrl: body.imageUrl || '',
        itemType: body.itemType || 'consumable',
        assemblyComponents: body.assemblyComponents || [],
        updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      };
      await saveWarehouseItem(item);
      const po = await checkAndCreatePurchaseOrder(item);
      return c.json({ item, purchaseOrder: po });
    } catch (error: any) {
      return c.json({ error: `Failed to create item: ${error.message}` }, 500);
    }
  });

  // PATCH update item
  app.patch(`${P}/warehouse/:id`, async (c: any) => {
    try {
      const item = await getWarehouseItem(c.req.param('id'));
      if (!item) return c.json({ error: 'Item not found' }, 404);
      const body = await c.req.json();
      const allowed = ['name','category','unit','minStock','price','sku','supplier','notes','imageUrl','itemType','assemblyComponents'];
      for (const key of allowed) { if (body[key] !== undefined) (item as any)[key] = body[key]; }
      await saveWarehouseItem(item);
      const po = await checkAndCreatePurchaseOrder(item);
      return c.json({ item, purchaseOrder: po });
    } catch (error: any) {
      return c.json({ error: `Failed to update item: ${error.message}` }, 500);
    }
  });

  // DELETE item
  app.delete(`${P}/warehouse/:id`, async (c: any) => {
    try {
      await kv.del(`wh_item:${c.req.param('id')}`);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: `Failed to delete: ${error.message}` }, 500);
    }
  });

  // POST stock-in
  app.post(`${P}/warehouse/:id/stock-in`, async (c: any) => {
    try {
      const item = await getWarehouseItem(c.req.param('id'));
      if (!item) return c.json({ error: 'Item not found' }, 404);
      const { qty, reason = 'purchase', note, referenceId, poId } = await c.req.json();
      const qtyNum = Number(qty);
      if (!qtyNum || qtyNum <= 0) return c.json({ error: 'qty must be positive' }, 400);
      const stockBefore = item.stock;
      item.stock += qtyNum;
      await saveWarehouseItem(item);
      const mov = await addMovement({ itemId: item.id, itemName: item.name, type: 'in', qty: qtyNum, stockBefore, stockAfter: item.stock, reason, referenceId, note });
      let updatedPo: PurchaseOrder | null = null;
      if (poId) {
        const poRaw = await kv.get(`wh_po:${poId}`);
        if (poRaw) {
          const po: PurchaseOrder = JSON.parse(poRaw);
          po.qtyReceived = (po.qtyReceived || 0) + qtyNum;
          po.status = po.qtyReceived >= po.qtyOrdered ? 'received' : 'ordered';
          po.updatedAt = new Date().toISOString();
          await kv.set(`wh_po:${poId}`, JSON.stringify(po));
          if (po.status === 'received') await kv.del(`wh_pending_po:${item.id}`);
          updatedPo = po;
        }
      }
      return c.json({ item, movement: mov, purchaseOrder: updatedPo });
    } catch (error: any) {
      return c.json({ error: `Failed to stock-in: ${error.message}` }, 500);
    }
  });

  // POST stock-out
  app.post(`${P}/warehouse/:id/stock-out`, async (c: any) => {
    try {
      const item = await getWarehouseItem(c.req.param('id'));
      if (!item) return c.json({ error: 'Item not found' }, 404);
      const { qty, reason = 'installation', note, referenceId } = await c.req.json();
      const qtyNum = Number(qty);
      if (!qtyNum || qtyNum <= 0) return c.json({ error: 'qty must be positive' }, 400);
      if (item.stock < qtyNum) return c.json({ error: `Недостаточно: есть ${item.stock} ${item.unit}, нужно ${qtyNum}` }, 400);
      const stockBefore = item.stock;
      item.stock -= qtyNum;
      await saveWarehouseItem(item);
      const mov = await addMovement({ itemId: item.id, itemName: item.name, type: 'out', qty: qtyNum, stockBefore, stockAfter: item.stock, reason, referenceId, note });
      const po = await checkAndCreatePurchaseOrder(item);
      return c.json({ item, movement: mov, purchaseOrder: po, lowStockAlert: po !== null });
    } catch (error: any) {
      return c.json({ error: `Failed to stock-out: ${error.message}` }, 500);
    }
  });

  // POST bulk write-off from installation
  app.post(`${P}/warehouse/writeoff-installation`, async (c: any) => {
    try {
      const { leadId, installationId, items: writeItems } = await c.req.json();
      if (!Array.isArray(writeItems) || writeItems.length === 0) {
        return c.json({ error: 'items array required' }, 400);
      }
      const results: any[] = [];
      const errors: string[] = [];
      const newPOs: PurchaseOrder[] = [];
      const allItems = await getAllWarehouseItems();
      for (const wi of writeItems) {
        const qty = Number(wi.qty);
        if (!qty || qty <= 0) continue;
        let item: WarehouseItem | null = null;
        if (wi.itemId) item = await getWarehouseItem(wi.itemId);
        else if (wi.sku) item = allItems.find(i => i.sku === wi.sku) ?? null;
        else if (wi.name) item = allItems.find(i => i.name.toLowerCase().includes(wi.name.toLowerCase())) ?? null;
        if (!item) { errors.push(`Не найдено: ${wi.itemId ?? wi.sku ?? wi.name}`); continue; }
        if (item.stock < qty) { errors.push(`Мало "${item.name}": есть ${item.stock}, нужно ${qty}`); continue; }
        const stockBefore = item.stock;
        item.stock -= qty;
        await saveWarehouseItem(item);
        const mov = await addMovement({ itemId: item.id, itemName: item.name, type: 'out', qty, stockBefore, stockAfter: item.stock, reason: 'installation', referenceId: leadId ?? installationId, note: `Списание по монтажу${leadId ? ' #' + leadId.slice(-6) : ''}` });
        const po = await checkAndCreatePurchaseOrder(item);
        if (po) newPOs.push(po);
        results.push({ item, movement: mov, purchaseOrder: po });
      }
      return c.json({ results, errors, newPurchaseOrders: newPOs, lowStockAlerts: newPOs.length });
    } catch (error: any) {
      return c.json({ error: `Failed to write off: ${error.message}` }, 500);
    }
  });

  // GET movements for item
  app.get(`${P}/warehouse/:id/movements`, async (c: any) => {
    try {
      const idxRaw = await kv.get(`wh_mov_idx:${c.req.param('id')}`);
      if (!idxRaw) return c.json({ movements: [] });
      const ids: string[] = JSON.parse(idxRaw);
      const movs = (await Promise.all(ids.slice(0, 50).map((mid: string) => kv.get(`wh_mov:${mid}`))))
        .filter(Boolean).map((r: any) => JSON.parse(r));
      return c.json({ movements: movs });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch movements: ${error.message}` }, 500);
    }
  });

  // GET all recent movements
  app.get(`${P}/warehouse-movements`, async (c: any) => {
    try {
      const gRaw = await kv.get('wh_mov_global');
      if (!gRaw) return c.json({ movements: [] });
      const ids: string[] = JSON.parse(gRaw);
      const movs = (await Promise.all(ids.slice(0, 100).map((mid: string) => kv.get(`wh_mov:${mid}`))))
        .filter(Boolean).map((r: any) => JSON.parse(r));
      return c.json({ movements: movs });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch movements: ${error.message}` }, 500);
    }
  });

  // GET all POs
  app.get(`${P}/purchase-orders`, async (c: any) => {
    try {
      const idxRaw = await kv.get('wh_po_index');
      if (!idxRaw) return c.json({ orders: [] });
      const ids: string[] = JSON.parse(idxRaw);
      const orders = (await Promise.all(ids.map((id: string) => kv.get(`wh_po:${id}`))))
        .filter(Boolean).map((r: any) => JSON.parse(r))
        .sort((a: PurchaseOrder, b: PurchaseOrder) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return c.json({ orders });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch POs: ${error.message}` }, 500);
    }
  });

  // POST create manual PO
  app.post(`${P}/purchase-orders`, async (c: any) => {
    try {
      const { itemId, qtyOrdered, pricePerUnit, supplier, note } = await c.req.json();
      if (!itemId || !qtyOrdered) return c.json({ error: 'itemId and qtyOrdered required' }, 400);
      const item = await getWarehouseItem(itemId);
      if (!item) return c.json({ error: 'Item not found' }, 404);
      const qty = Number(qtyOrdered); const ppu = Number(pricePerUnit ?? item.price);
      const po: PurchaseOrder = {
        id: `po_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
        itemId: item.id, itemName: item.name, itemUnit: item.unit,
        qtyOrdered: qty, qtyReceived: 0, pricePerUnit: ppu, totalCost: qty * ppu,
        supplier: supplier || item.supplier || '—', status: 'pending', reason: 'manual',
        note: note || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await kv.set(`wh_po:${po.id}`, JSON.stringify(po));
      const idxRaw = await kv.get('wh_po_index');
      const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
      idx.unshift(po.id);
      await kv.set('wh_po_index', JSON.stringify(idx));
      return c.json({ order: po });
    } catch (error: any) {
      return c.json({ error: `Failed to create PO: ${error.message}` }, 500);
    }
  });

  // PATCH update PO status
  app.patch(`${P}/purchase-orders/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`wh_po:${c.req.param('id')}`);
      if (!raw) return c.json({ error: 'PO not found' }, 404);
      const po: PurchaseOrder = JSON.parse(raw);
      const body = await c.req.json();
      const allowed = ['status','qtyOrdered','qtyReceived','supplier','note','pricePerUnit'];
      for (const key of allowed) { if (body[key] !== undefined) (po as any)[key] = body[key]; }
      po.totalCost = po.qtyOrdered * po.pricePerUnit;
      po.updatedAt = new Date().toISOString();
      await kv.set(`wh_po:${c.req.param('id')}`, JSON.stringify(po));
      if (po.status === 'received' || po.status === 'cancelled') {
        await kv.del(`wh_pending_po:${po.itemId}`);
      }
      return c.json({ order: po });
    } catch (error: any) {
      return c.json({ error: `Failed to update PO: ${error.message}` }, 500);
    }
  });
}