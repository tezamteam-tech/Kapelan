// ─── PROCUREMENT MODULE ───────────────────────────────────────────────────────
// Supplier catalog, order batching, mock-API dispatch, status tracking
import * as kv from "./kv_store.tsx";
import { getAllWarehouseItems } from "./warehouse.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface Supplier {
  id: string;
  name: string;
  categories: string[];          // which warehouse categories this supplier covers
  contactEmail: string;
  phone: string;
  address?: string;
  apiEndpoint: string;           // mock URL
  apiKey: string;                // mock key
  terms: {
    paymentDays: number;         // net payment days
    deliveryDays: number;        // estimated delivery
    minOrderAmount: number;      // UAH
    currency: string;
  };
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProcurementOrderLine {
  purchaseOrderId: string;       // link to existing PO
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  qty: number;
  pricePerUnit: number;
  totalCost: number;
  category: string;
}

export interface MockApiResponse {
  success: boolean;
  confirmationNumber: string;
  supplierOrderId: string;
  estimatedDeliveryDate: string;
  totalAmount: number;
  currency: string;
  message: string;
  requestedAt: string;
  respondedAt: string;
  httpStatus: number;
  payload: any;                  // echoed request body for debugging
}

export interface ProcurementOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierEmail: string;
  categories: string[];          // categories included in this batch
  lines: ProcurementOrderLine[];
  totalCost: number;
  status: 'draft' | 'sent' | 'confirmed' | 'cancelled' | 'failed';
  sendAttempts: number;
  lastSentAt?: string;
  mockApiResponse?: MockApiResponse;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Default supplier catalog ─────────────────────────────────────────────────
//   3 main groups as requested: Расходники | Провода (Электрика) | Трубы (Трубопровод + Дренаж)
//   + extra suppliers for Крепёж and Кондиционеры

const DEFAULT_SUPPLIERS: Supplier[] = [
  {
    id: 'sup_tubes',
    name: 'МедьОпт',
    categories: ['Трубопровод', 'Дренаж'],
    contactEmail: 'orders@medopt.ua',
    phone: '+380 44 111-22-33',
    address: 'г. Киев, ул. Промышленная 14',
    apiEndpoint: 'https://api.medopt.ua/v1/orders',
    apiKey: 'mock-key-medopt-001',
    terms: { paymentDays: 30, deliveryDays: 3, minOrderAmount: 2000, currency: 'UAH' },
    isActive: true,
    notes: 'Медные трубы и теплоизоляция. Скидка 5% от 10 000 ₴.',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'sup_cables',
    name: 'КабельМаркет',
    categories: ['Электрика'],
    contactEmail: 'supply@cablemarket.ua',
    phone: '+380 44 222-33-44',
    address: 'г. Харьков, ул. Кабельная 5',
    apiEndpoint: 'https://api.cablemarket.ua/orders/new',
    apiKey: 'mock-key-cables-002',
    terms: { paymentDays: 14, deliveryDays: 2, minOrderAmount: 1000, currency: 'UAH' },
    isActive: true,
    notes: 'Кабели, кабель-каналы. Доставка на следующий день от 5 000 ₴.',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'sup_consumables',
    name: 'ГазСнаб',
    categories: ['Расходники'],
    contactEmail: 'orders@gazsnab.ua',
    phone: '+380 44 333-44-55',
    address: 'г. Днепр, ул. Химическая 8',
    apiEndpoint: 'https://api.gazsnab.ua/procurement',
    apiKey: 'mock-key-gassnab-003',
    terms: { paymentDays: 7, deliveryDays: 5, minOrderAmount: 500, currency: 'UAH' },
    isActive: true,
    notes: 'Фреон R32, R410. Сертифицированный поставщик. Требуется лицензия.',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'sup_hardware',
    name: 'МонтажПро',
    categories: ['Крепёж'],
    contactEmail: 'zakaz@montajpro.ua',
    phone: '+380 44 444-55-66',
    address: 'г. Киев, ул. Строительная 22',
    apiEndpoint: 'https://api.montajpro.ua/api/orders',
    apiKey: 'mock-key-hardware-004',
    terms: { paymentDays: 14, deliveryDays: 2, minOrderAmount: 300, currency: 'UAH' },
    isActive: true,
    notes: 'Дюбели, хомуты, кронштейны. Оптом дешевле.',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'sup_ac',
    name: 'КлиматТех',
    categories: ['Кондиционеры', 'Дренаж'],
    contactEmail: 'b2b@klimattech.ua',
    phone: '+380 44 555-66-77',
    address: 'м. Одеса, вул. Морська 3',
    apiEndpoint: 'https://api.klimattech.ua/orders',
    apiKey: 'mock-key-ac-005',
    terms: { paymentDays: 45, deliveryDays: 7, minOrderAmount: 10000, currency: 'UAH' },
    isActive: true,
    notes: 'Кондиционеры, дренажные насосы. Официальный дистрибьютор Mitsubishi, LG.',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
];

// ─── KV helpers ───────────────────────────────────────────────────────────────
async function getAllSuppliers(): Promise<Supplier[]> {
  try {
    const all = await kv.getByPrefix('supplier:');
    if (all.length > 0) {
      return (all as string[]).map(r => JSON.parse(r)).filter(Boolean)
        .sort((a: Supplier, b: Supplier) => a.name.localeCompare(b.name, 'ru'));
    }
    // Seed defaults on first boot
    for (const s of DEFAULT_SUPPLIERS) {
      await kv.set(`supplier:${s.id}`, JSON.stringify(s));
    }
    return DEFAULT_SUPPLIERS;
  } catch (e) { console.error('getAllSuppliers:', e); return []; }
}

async function getSupplier(id: string): Promise<Supplier | null> {
  const r = await kv.get(`supplier:${id}`);
  return r ? JSON.parse(r) : null;
}

async function saveSupplier(s: Supplier): Promise<void> {
  s.updatedAt = new Date().toISOString();
  await kv.set(`supplier:${s.id}`, JSON.stringify(s));
}

async function getProcOrder(id: string): Promise<ProcurementOrder | null> {
  const r = await kv.get(`proc_order:${id}`);
  return r ? JSON.parse(r) : null;
}

async function saveProcOrder(o: ProcurementOrder): Promise<void> {
  o.updatedAt = new Date().toISOString();
  await kv.set(`proc_order:${o.id}`, JSON.stringify(o));
}

async function getAllProcOrders(): Promise<ProcurementOrder[]> {
  const idxRaw = await kv.get('proc_order_index');
  if (!idxRaw) return [];
  const ids: string[] = JSON.parse(idxRaw);
  const orders = (await Promise.all(ids.map((id: string) => kv.get(`proc_order:${id}`))))
    .filter(Boolean).map((r: any) => JSON.parse(r))
    .sort((a: ProcurementOrder, b: ProcurementOrder) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return orders;
}

async function indexProcOrder(id: string): Promise<void> {
  const raw = await kv.get('proc_order_index');
  const list: string[] = raw ? JSON.parse(raw) : [];
  if (!list.includes(id)) list.unshift(id);
  await kv.set('proc_order_index', JSON.stringify(list));
}

// ─── Supplier resolution logic ────────────────────────────────────────────────
function resolveSupplierForCategory(category: string, suppliers: Supplier[]): Supplier | null {
  const active = suppliers.filter(s => s.isActive);
  // Normalize category variants
  const cat = category.trim();
  // Priority match: exact category in supplier.categories[]
  const exact = active.find(s => s.categories.some(c =>
    c.toLowerCase() === cat.toLowerCase()
  ));
  if (exact) return exact;
  // Fuzzy: partial match
  const fuzzy = active.find(s => s.categories.some(c =>
    cat.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(cat.toLowerCase())
  ));
  return fuzzy ?? null;
}

// ─── Mock API Dispatcher ──────────────────────────────────────────────────────
async function sendToSupplierMockApi(
  supplier: Supplier,
  order: ProcurementOrder,
): Promise<MockApiResponse> {
  const requestedAt = new Date().toISOString();
  const payload = {
    orderId: order.id,
    buyerName: 'ТОВ "КЛІМАТ СЕРВІС"',
    buyerEmail: 'procurement@klimatsvc.ua',
    supplierApiKey: supplier.apiKey,
    currency: supplier.terms.currency,
    requestedDeliveryDays: supplier.terms.deliveryDays,
    items: order.lines.map(l => ({
      sku: l.sku,
      name: l.itemName,
      qty: l.qty,
      unit: l.unit,
      pricePerUnit: l.pricePerUnit,
      totalCost: l.totalCost,
    })),
    totalAmount: order.totalCost,
    notes: order.note || '',
    timestamp: requestedAt,
  };

  // Simulate network delay 300–800ms
  await new Promise(res => setTimeout(res, 300 + Math.random() * 500));

  // Actually attempt mock HTTP call (will fail, but we catch it gracefully)
  let httpStatus = 200;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(supplier.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': supplier.apiKey,
        'X-Order-Id': order.id,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    httpStatus = res.status;
  } catch (_e) {
    // Expected — external URL not reachable in sandbox; proceed with mock
    httpStatus = 200;
    console.log(`Mock API: ${supplier.apiEndpoint} simulated (offline in sandbox)`);
  }

  // Generate realistic mock response
  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + supplier.terms.deliveryDays);
  const confirmNum = `${supplier.id.toUpperCase().replace('SUP_', '')}-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000) + 10000)}`;
  const supplierOid = `SO-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;

  return {
    success: true,
    confirmationNumber: confirmNum,
    supplierOrderId: supplierOid,
    estimatedDeliveryDate: deliveryDate.toISOString().split('T')[0],
    totalAmount: order.totalCost,
    currency: supplier.terms.currency,
    message: `Заказ ${confirmNum} принят. Ожидайте доставку ${deliveryDate.toLocaleDateString('ru-RU')} от ${supplier.name}.`,
    requestedAt,
    respondedAt: new Date().toISOString(),
    httpStatus,
    payload,
  };
}

// ─── Build procurement order from pending POs ─────────────────────────────────
async function buildProcurementOrder(
  supplier: Supplier,
  pendingPOs: any[],
  warehouseItems: any[],
): Promise<ProcurementOrder | null> {
  const lines: ProcurementOrderLine[] = [];
  const categories = new Set<string>();

  for (const po of pendingPOs) {
    const item = warehouseItems.find((i: any) => i.id === po.itemId);
    const sup = resolveSupplierForCategory(po.itemName, [supplier]);
    // Only include POs whose category matches this supplier
    const poCategory = item?.category ?? '';
    const supplierCoversCategory = supplier.categories.some(c =>
      c.toLowerCase() === poCategory.toLowerCase() ||
      poCategory.toLowerCase().includes(c.toLowerCase())
    );
    if (!supplierCoversCategory) continue;

    categories.add(poCategory);
    lines.push({
      purchaseOrderId: po.id,
      itemId: po.itemId,
      itemName: po.itemName,
      sku: item?.sku ?? po.itemId,
      unit: po.itemUnit,
      qty: po.qtyOrdered - po.qtyReceived,
      pricePerUnit: po.pricePerUnit,
      totalCost: (po.qtyOrdered - po.qtyReceived) * po.pricePerUnit,
      category: poCategory,
    });
  }

  if (lines.length === 0) return null;
  const totalCost = lines.reduce((s, l) => s + l.totalCost, 0);

  const id = `proc_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;
  return {
    id,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierEmail: supplier.contactEmail,
    categories: Array.from(categories),
    lines,
    totalCost,
    status: 'draft',
    sendAttempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Route registration ───────────────────────────────────────────────────────
export function registerProcurementRoutes(app: any): void {
  const P = '/make-server-1df47c03';

  // ── GET all suppliers ────────────────────────────────────────────────────────
  app.get(`${P}/suppliers`, async (c: any) => {
    try {
      const suppliers = await getAllSuppliers();
      return c.json({ suppliers });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch suppliers: ${error.message}` }, 500);
    }
  });

  // ── POST create supplier ─────────────────────────────────────────────────────
  app.post(`${P}/suppliers`, async (c: any) => {
    try {
      const body = await c.req.json();
      const id = `sup_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const supplier: Supplier = {
        id,
        name: body.name || 'Новый поставщик',
        categories: body.categories || [],
        contactEmail: body.contactEmail || '',
        phone: body.phone || '',
        address: body.address || '',
        apiEndpoint: body.apiEndpoint || `https://api.supplier-${id}.ua/orders`,
        apiKey: body.apiKey || `key-${id}`,
        terms: {
          paymentDays: Number(body.terms?.paymentDays ?? 14),
          deliveryDays: Number(body.terms?.deliveryDays ?? 5),
          minOrderAmount: Number(body.terms?.minOrderAmount ?? 0),
          currency: body.terms?.currency ?? 'UAH',
        },
        isActive: body.isActive !== false,
        notes: body.notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveSupplier(supplier);
      return c.json({ supplier });
    } catch (error: any) {
      return c.json({ error: `Failed to create supplier: ${error.message}` }, 500);
    }
  });

  // ── PATCH update supplier ────────────────────────────────────────────────────
  app.patch(`${P}/suppliers/:id`, async (c: any) => {
    try {
      const supplier = await getSupplier(c.req.param('id'));
      if (!supplier) return c.json({ error: 'Supplier not found' }, 404);
      const body = await c.req.json();
      const allowed = ['name', 'categories', 'contactEmail', 'phone', 'address',
        'apiEndpoint', 'apiKey', 'terms', 'isActive', 'notes'];
      for (const key of allowed) {
        if (body[key] !== undefined) (supplier as any)[key] = body[key];
      }
      await saveSupplier(supplier);
      return c.json({ supplier });
    } catch (error: any) {
      return c.json({ error: `Failed to update supplier: ${error.message}` }, 500);
    }
  });

  // ── DELETE supplier ──────────────────────────────────────────────────────────
  app.delete(`${P}/suppliers/:id`, async (c: any) => {
    try {
      await kv.del(`supplier:${c.req.param('id')}`);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: `Failed to delete: ${error.message}` }, 500);
    }
  });

  // ── GET resolve supplier for a category ─────────────────────────────────────
  app.get(`${P}/suppliers/resolve/:category`, async (c: any) => {
    try {
      const category = decodeURIComponent(c.req.param('category'));
      const suppliers = await getAllSuppliers();
      const supplier = resolveSupplierForCategory(category, suppliers);
      return c.json({ supplier, category });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // ── GET all procurement orders ───────────────────────────────────────────────
  app.get(`${P}/procurement/orders`, async (c: any) => {
    try {
      const orders = await getAllProcOrders();
      return c.json({ orders });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch procurement orders: ${error.message}` }, 500);
    }
  });

  // ── POST create procurement order (batch from pending POs) ───────────────────
  // body: { supplierId, purchaseOrderIds?: string[] }
  // If purchaseOrderIds omitted — auto-pick all pending POs for supplier's categories
  app.post(`${P}/procurement/orders`, async (c: any) => {
    try {
      const body = await c.req.json();
      const { supplierId, purchaseOrderIds, note } = body;
      if (!supplierId) return c.json({ error: 'supplierId required' }, 400);

      const supplier = await getSupplier(supplierId);
      if (!supplier) return c.json({ error: 'Supplier not found' }, 404);

      // Load pending POs
      const poIdxRaw = await kv.get('wh_po_index');
      if (!poIdxRaw) return c.json({ error: 'No purchase orders found' }, 404);
      const allPoIds: string[] = JSON.parse(poIdxRaw);
      const allPOs = (await Promise.all(allPoIds.map((id: string) => kv.get(`wh_po:${id}`))))
        .filter(Boolean).map((r: any) => JSON.parse(r));

      // Filter: pending + matching IDs (if specified)
      const targetPOs = allPOs.filter((po: any) => {
        const statusOk = po.status === 'pending' || po.status === 'ordered';
        const idOk = !purchaseOrderIds || purchaseOrderIds.includes(po.id);
        return statusOk && idOk;
      });

      if (targetPOs.length === 0) return c.json({ error: 'No matching pending purchase orders' }, 400);

      const warehouseItems = await getAllWarehouseItems();
      const order = await buildProcurementOrder(supplier, targetPOs, warehouseItems);
      if (!order) return c.json({ error: 'No lines matched supplier categories' }, 400);

      order.note = note || '';
      await saveProcOrder(order);
      await indexProcOrder(order.id);

      console.log(`Procurement order created: ${order.id} → ${supplier.name} (${order.lines.length} lines)`);
      return c.json({ order });
    } catch (error: any) {
      console.error('Create procurement order error:', error);
      return c.json({ error: `Failed to create procurement order: ${error.message}` }, 500);
    }
  });

  // ── POST send procurement order to supplier (mock API) ───────────────────────
  app.post(`${P}/procurement/orders/:id/send`, async (c: any) => {
    try {
      const order = await getProcOrder(c.req.param('id'));
      if (!order) return c.json({ error: 'Procurement order not found' }, 404);
      if (order.status === 'cancelled') return c.json({ error: 'Order is cancelled' }, 400);

      const supplier = await getSupplier(order.supplierId);
      if (!supplier) return c.json({ error: 'Supplier not found' }, 404);

      // Check min order
      if (order.totalCost < supplier.terms.minOrderAmount) {
        return c.json({
          error: `Минимальная сумма заказа у ${supplier.name}: ${supplier.terms.minOrderAmount} ₴. Текущая: ${order.totalCost.toFixed(0)} ₴`,
        }, 400);
      }

      console.log(`Sending to mock API: ${supplier.apiEndpoint} for order ${order.id}`);
      order.sendAttempts = (order.sendAttempts || 0) + 1;
      order.lastSentAt = new Date().toISOString();

      const mockResp = await sendToSupplierMockApi(supplier, order);
      order.mockApiResponse = mockResp;
      order.status = mockResp.success ? 'confirmed' : 'failed';

      await saveProcOrder(order);

      // Update all linked purchase orders → status "ordered"
      if (mockResp.success) {
        for (const line of order.lines) {
          const poRaw = await kv.get(`wh_po:${line.purchaseOrderId}`);
          if (!poRaw) continue;
          const po = JSON.parse(poRaw);
          po.status = 'ordered';
          po.updatedAt = new Date().toISOString();
          po.note = (po.note ? po.note + ' | ' : '') + `Отправлено: ${mockResp.confirmationNumber}`;
          await kv.set(`wh_po:${line.purchaseOrderId}`, JSON.stringify(po));
        }
      }

      console.log(`Mock API response: ${mockResp.confirmationNumber} (${order.status})`);
      return c.json({ order, mockApiResponse: mockResp });
    } catch (error: any) {
      console.error('Send procurement order error:', error);
      return c.json({ error: `Failed to send order: ${error.message}` }, 500);
    }
  });

  // ── POST cancel procurement order ────────────────────────────────────────────
  app.patch(`${P}/procurement/orders/:id`, async (c: any) => {
    try {
      const order = await getProcOrder(c.req.param('id'));
      if (!order) return c.json({ error: 'Order not found' }, 404);
      const body = await c.req.json();
      if (body.status) order.status = body.status;
      if (body.note !== undefined) order.note = body.note;
      await saveProcOrder(order);
      return c.json({ order });
    } catch (error: any) {
      return c.json({ error: `Failed to update order: ${error.message}` }, 500);
    }
  });

  // ── POST auto-batch: group ALL pending POs by category→supplier, send ────────
  app.post(`${P}/procurement/auto-batch`, async (c: any) => {
    try {
      const suppliers = await getAllSuppliers();
      const warehouseItems = await getAllWarehouseItems();

      // Load all pending POs
      const poIdxRaw = await kv.get('wh_po_index');
      if (!poIdxRaw) return c.json({ results: [], message: 'No purchase orders' });
      const allPoIds: string[] = JSON.parse(poIdxRaw);
      const allPOs = (await Promise.all(allPoIds.map((id: string) => kv.get(`wh_po:${id}`))))
        .filter(Boolean).map((r: any) => JSON.parse(r))
        .filter((po: any) => po.status === 'pending');

      if (allPOs.length === 0) return c.json({ results: [], message: 'No pending purchase orders' });

      const results: { supplier: string; order: ProcurementOrder; sent: boolean; response?: MockApiResponse; error?: string }[] = [];
      const processedPOIds = new Set<string>();

      for (const supplier of suppliers.filter((s: Supplier) => s.isActive)) {
        // Filter POs not yet processed + matching supplier categories
        const supplierPOs = allPOs.filter((po: any) => {
          if (processedPOIds.has(po.id)) return false;
          const item = warehouseItems.find((i: any) => i.id === po.itemId);
          const cat = item?.category ?? '';
          return supplier.categories.some(c =>
            c.toLowerCase() === cat.toLowerCase() ||
            cat.toLowerCase().includes(c.toLowerCase())
          );
        });

        if (supplierPOs.length === 0) continue;

        const order = await buildProcurementOrder(supplier, supplierPOs, warehouseItems);
        if (!order) continue;

        await saveProcOrder(order);
        await indexProcOrder(order.id);
        supplierPOs.forEach((po: any) => processedPOIds.add(po.id));

        // Auto-send if above min order
        let sent = false;
        let mockResp: MockApiResponse | undefined;
        let errMsg: string | undefined;

        if (order.totalCost >= supplier.terms.minOrderAmount) {
          try {
            order.sendAttempts = 1;
            order.lastSentAt = new Date().toISOString();
            mockResp = await sendToSupplierMockApi(supplier, order);
            order.mockApiResponse = mockResp;
            order.status = mockResp.success ? 'confirmed' : 'failed';
            await saveProcOrder(order);
            if (mockResp.success) {
              for (const line of order.lines) {
                const poRaw = await kv.get(`wh_po:${line.purchaseOrderId}`);
                if (!poRaw) continue;
                const po = JSON.parse(poRaw);
                po.status = 'ordered';
                po.updatedAt = new Date().toISOString();
                po.note = (po.note ? po.note + ' | ' : '') + `Подтверждено: ${mockResp.confirmationNumber}`;
                await kv.set(`wh_po:${line.purchaseOrderId}`, JSON.stringify(po));
              }
            }
            sent = true;
          } catch (e: any) {
            errMsg = e.message;
            order.status = 'failed';
            await saveProcOrder(order);
          }
        } else {
          errMsg = `Сумма мала: ${order.totalCost} ₴ < мин. ${supplier.terms.minOrderAmount} ₴`;
        }

        results.push({ supplier: supplier.name, order, sent, response: mockResp, error: errMsg });
      }

      console.log(`Auto-batch: ${results.length} suppliers processed, ${results.filter(r => r.sent).length} sent`);
      return c.json({ results, totalProcessed: allPOs.length, totalBatches: results.length });
    } catch (error: any) {
      console.error('Auto-batch error:', error);
      return c.json({ error: `Auto-batch failed: ${error.message}` }, 500);
    }
  });

  // ── GET procurement stats ────────────────────────────────────────────────────
  app.get(`${P}/procurement/stats`, async (c: any) => {
    try {
      const [orders, suppliers] = await Promise.all([getAllProcOrders(), getAllSuppliers()]);
      const stats = {
        total: orders.length,
        draft: orders.filter(o => o.status === 'draft').length,
        sent: orders.filter(o => o.status === 'sent').length,
        confirmed: orders.filter(o => o.status === 'confirmed').length,
        failed: orders.filter(o => o.status === 'failed').length,
        cancelled: orders.filter(o => o.status === 'cancelled').length,
        totalSpend: orders.filter(o => o.status === 'confirmed')
          .reduce((s, o) => s + o.totalCost, 0),
        activeSuppliers: suppliers.filter(s => s.isActive).length,
      };
      return c.json({ stats });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });
}
