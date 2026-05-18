import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js";
import * as kv from "./kv_store.tsx";
import { PDFDocument, rgb } from "npm:pdf-lib";
import fontkit from "npm:@pdf-lib/fontkit";
import { registerWarehouseRoutes, getAllWarehouseItems, getWarehouseItem as getWhItemById } from "./warehouse.tsx";
import { registerProcurementRoutes } from "./procurement.tsx";
import { registerMeasurementOrderRoutes } from "./measurement_orders.tsx";
import { registerOrderCoreRoutes } from "./order_core.tsx";

const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Explicit preflight handler for browsers (avoid non-2xx on OPTIONS)
app.options("*", (c) => {
  return c.body(null, 204);
});

// Supabase client for storage
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const BUCKET_NAME = 'make-1df47c03-measurements';
const IMAGES_BUCKET = 'make-1df47c03-images';
const WINDOW_ASSETS_BUCKET = 'window-assets';

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
    if (!bucketNames.includes(WINDOW_ASSETS_BUCKET)) {
      await supabase.storage.createBucket(WINDOW_ASSETS_BUCKET, { public: false });
      console.log('Created window assets bucket:', WINDOW_ASSETS_BUCKET);
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

// ─── Bootstrap: load core data in one request ────────────────────────────────
// GET /bootstrap?role=admin|manager|installer
app.get("/make-server-1df47c03/bootstrap", async (c) => {
  try {
    const role = String(c.req.query("role") ?? "").trim();

    const [companyRaw, ordersLite, warehouse, purchaseOrders] = await Promise.all([
      kv.get("config:company"),
      // Use order_core list (lite) for fast initial render
      fetch(new URL("/make-server-1df47c03/orders?lite=1", c.req.url), { headers: c.req.raw.headers }).then((r) => r.json()).catch(() => ({ orders: [] })),
      // Warehouse is admin-only heavy; for manager/installer return empty to reduce payload
      role === "admin"
        ? fetch(new URL("/make-server-1df47c03/warehouse", c.req.url), { headers: c.req.raw.headers }).then((r) => r.json()).catch(() => ({ items: [], lowStockCount: 0, totalValue: 0 }))
        : Promise.resolve({ items: [], lowStockCount: 0, totalValue: 0 }),
      role === "admin"
        ? fetch(new URL("/make-server-1df47c03/purchase-orders", c.req.url), { headers: c.req.raw.headers }).then((r) => r.json()).catch(() => ({ orders: [] }))
        : Promise.resolve({ orders: [] }),
    ]);

    const defCompany = {
      companyName: 'ООО "Оконная Служба Плюс"',
      companyCode: "12345678",
      companyDirector: "Иванов И.И.",
      companyPhone: "+375 33 9-006-006",
      city: "Витебск",
      currency: { symbol: "Br", name: "BYN", position: "suffix" },
      vat: { enabledByDefault: false, percent: 20 },
    };
    const company = companyRaw ? { ...defCompany, ...JSON.parse(String(companyRaw)) } : defCompany;

    return c.json({
      company,
      ordersLite,
      warehouse,
      purchaseOrders,
      ts: Date.now(),
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Legacy AI sales chat was removed during the window-business pivot.
// The active assistant lives in the frontend window workflow and order-core APIs.

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
          await sendTelegramMessage(
            `✅ <b>Монтаж завершен</b>\n\nКлиент: <b>${client.name}</b>\nТелефон: ${client.phone}\nЗаказ переведен в выполненные.\n\n${new Date().toLocaleString("ru-RU")}`
          );
        }
      } catch (notifyErr) {
        console.error("Completion notification error:", notifyErr);
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
    
    const leads: any[] = [];
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

// List clients (admin)
app.get("/make-server-1df47c03/clients", async (c) => {
  try {
    const clientsData = await kv.getByPrefix("client:");
    const clients = clientsData
      .map((v: any) => {
        try { return JSON.parse(v); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ru"));
    return c.json({ clients });
  } catch (error: any) {
    console.error("Error fetching clients:", error);
    return c.json({ error: `Failed to fetch clients: ${error.message}` }, 500);
  }
});

// Create client (admin)
app.post("/make-server-1df47c03/clients", async (c) => {
  try {
    const body = await c.req.json();
    const name = String(body?.name ?? "").trim();
    const phone = String(body?.phone ?? "").trim();
    const email = body?.email ? String(body.email).trim() : null;
    if (!name || !phone) return c.json({ error: "name and phone are required" }, 400);
    const type = String(body?.type ?? "individual");
    const legal_name = body?.legal_name ? String(body.legal_name).trim() : "";
    const tax_id = body?.tax_id ? String(body.tax_id).trim() : "";
    const address = body?.address ? String(body.address).trim() : "";
    const notes = body?.notes ? String(body.notes).trim() : "";
    const doc_basis = body?.doc_basis ? String(body.doc_basis).trim() : "";

    // Reuse existing by phone if found
    const clientsData = await kv.getByPrefix("client:");
    for (const value of clientsData) {
      try {
        const client = JSON.parse(value);
        if (String(client.phone ?? "").trim() === phone) {
          // update name/email best-effort
          const updated = {
            ...client,
            name,
            phone,
            email,
            type: type || client.type || "individual",
            legal_name: legal_name || client.legal_name || "",
            tax_id: tax_id || client.tax_id || "",
            address: address || client.address || "",
            notes: notes || client.notes || "",
            doc_basis: doc_basis || client.doc_basis || "",
            updatedAt: new Date().toISOString(),
          };
          await kv.set(`client:${client.id}`, JSON.stringify(updated));
          return c.json({ client: updated });
        }
      } catch {
        // ignore
      }
    }

    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newClient = {
      id: clientId,
      name,
      phone,
      email,
      type: type === "company" ? "company" : "individual",
      legal_name,
      tax_id,
      address,
      notes,
      doc_basis,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`client:${clientId}`, JSON.stringify(newClient));
    return c.json({ client: newClient });
  } catch (error: any) {
    console.error("Error creating client:", error);
    return c.json({ error: `Failed to create client: ${error.message}` }, 500);
  }
});

// Update client (admin)
app.patch("/make-server-1df47c03/client/:clientId", async (c) => {
  try {
    const clientId = c.req.param("clientId");
    const raw = await kv.get(`client:${clientId}`);
    if (!raw) return c.json({ error: "Client not found" }, 404);
    const client = JSON.parse(raw);

    const body = await c.req.json().catch(() => ({}));
    const next = {
      ...client,
      name: body?.name != null ? String(body.name).trim() : client.name,
      phone: body?.phone != null ? String(body.phone).trim() : client.phone,
      email: body?.email === null ? null : (body?.email != null ? String(body.email).trim() : client.email),
      type: body?.type != null ? String(body.type) : client.type,
      legal_name: body?.legal_name != null ? String(body.legal_name).trim() : (client.legal_name || ""),
      tax_id: body?.tax_id != null ? String(body.tax_id).trim() : (client.tax_id || ""),
      address: body?.address != null ? String(body.address).trim() : (client.address || ""),
      notes: body?.notes != null ? String(body.notes).trim() : (client.notes || ""),
      doc_basis: body?.doc_basis != null ? String(body.doc_basis).trim() : (client.doc_basis || ""),
      updatedAt: new Date().toISOString(),
    };

    if (!String(next.name ?? "").trim() || !String(next.phone ?? "").trim()) {
      return c.json({ error: "name and phone are required" }, 400);
    }

    await kv.set(`client:${clientId}`, JSON.stringify(next));
    return c.json({ client: next });
  } catch (error: any) {
    console.error("Error updating client:", error);
    return c.json({ error: `Failed to update client: ${error.message}` }, 500);
  }
});

// Delete client + cascade (admin)
app.delete("/make-server-1df47c03/client/:clientId", async (c) => {
  try {
    const clientId = c.req.param("clientId");
    const raw = await kv.get(`client:${clientId}`);
    if (!raw) return c.json({ error: "Client not found" }, 404);
    const client = JSON.parse(raw);

    // Delete leads + related entities
    const leadsListData = await kv.get(`leads_by_client:${clientId}`);
    const leadIds: string[] = leadsListData ? JSON.parse(leadsListData) : [];

    for (const leadId of leadIds) {
      // documents
      const docListRaw = await kv.get(`documents_by_lead:${leadId}`);
      const docIds: string[] = docListRaw ? JSON.parse(docListRaw) : [];
      for (const docId of docIds) {
        await kv.del(`document:${docId}`);
      }
      await kv.del(`documents_by_lead:${leadId}`);

      // measurement
      const measId = await kv.get(`measurement_by_lead:${leadId}`);
      if (measId) await kv.del(`measurement:${measId}`);
      await kv.del(`measurement_by_lead:${leadId}`);

      // offers (best-effort)
      const offerId = await kv.get(`offer_by_lead:${leadId}`);
      if (offerId) await kv.del(`offer:${offerId}`);
      await kv.del(`offer_by_lead:${leadId}`);

      await kv.del(`lead:${leadId}`);
    }
    await kv.del(`leads_by_client:${clientId}`);

    // Delete orders created by AI-manager (order:) matching client phone
    const phone = String(client.phone ?? "").trim();
    if (phone) {
      const idxRaw = await kv.get("order_index");
      const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
      const keep: string[] = [];
      for (const oid of idx) {
        const oraw = await kv.get(`order:${oid}`);
        if (!oraw) continue;
        try {
          const o = JSON.parse(oraw);
          const oPhone = String(o.client_phone ?? "").trim();
          if (oPhone && oPhone === phone) {
            await kv.del(`order:${oid}`);
          } else {
            keep.push(oid);
          }
        } catch {
          keep.push(oid);
        }
      }
      await kv.set("order_index", JSON.stringify(keep));

      // Legacy kapelan_order:* (best-effort phone match)
      const kap = await kv.getByPrefix("kapelan_order:");
      for (const v of kap) {
        try {
          const o = JSON.parse(v);
          const oPhone = String(o.clientPhone ?? o.client_phone ?? "").trim();
          if (oPhone && oPhone === phone && o.id) {
            await kv.del(`kapelan_order:${o.id}`);
          }
        } catch {
          // ignore
        }
      }
    }

    // Finally delete client record
    await kv.del(`client:${clientId}`);

    return c.json({ success: true, deleted: { clientId, leads: leadIds.length } });
  } catch (error: any) {
    console.error("Error deleting client:", error);
    return c.json({ error: `Failed to delete client: ${error.message}` }, 500);
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
    const [chatId, companyRaw] = await Promise.all([
      kv.get('config:tgAdminChatId'),
      kv.get('config:company'),
    ]);
    const company = companyRaw ? JSON.parse(String(companyRaw)) : null;
    return c.json({ tgAdminChatId: chatId || '', company });
  } catch (error) {
    console.error('Error getting config:', error);
    return c.json({ error: `Failed to get config: ${error.message}` }, 500);
  }
});

// Config POST
app.post('/make-server-1df47c03/config', async (c) => {
  try {
    const { tgAdminChatId, company } = await c.req.json();
    if (tgAdminChatId !== undefined) {
      await kv.set('config:tgAdminChatId', String(tgAdminChatId).trim());
    }
    if (company && typeof company === 'object') {
      let prev: any = {};
      try {
        const prevRaw = await kv.get('config:company');
        if (prevRaw) prev = JSON.parse(String(prevRaw));
      } catch {}
      await kv.set('config:company', JSON.stringify({ ...prev, ...company }));
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
      `✅ <b>Тест уведомлений</b>\n\nWindow CRM — подключение работает!\n${new Date().toLocaleString('ru-RU')}`
    );
    if (ok) return c.json({ success: true });
    return c.json({ error: 'Не удалось отправить сообщение. Проверьте Chat ID.' }, 500);
  } catch (error) {
    console.error('Error in tg-test:', error);
    return c.json({ error: `Ошибка: ${error.message}` }, 500);
  }
});

// Legacy lead-based catalog, offer and document generator removed.
// Current documents are generated by the order-centric window workflow.

app.get('/make-server-1df47c03/company-config', async (c) => {
  try {
    const raw = await kv.get('config:company');
    const def = { companyName: 'ООО "Оконная Служба Плюс"', companyCode: '12345678', companyDirector: 'Иванов И.И.', companyPhone: '+375 33 9-006-006', city: 'Витебск' };
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

// Register measurement orders routes
registerMeasurementOrderRoutes(app);

// Register order-centric core (Orders module)
registerOrderCoreRoutes(app);

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

// Legacy requirement matching and pasted-dialog parsing were removed during the window-business pivot.

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
    const { name, phone, tgChatId, specialization, notes, photoUrl, teamId, teamName, isTeamLead } = body;
    if (!name || !phone) return c.json({ error: 'name and phone are required' }, 400);

    const id = body.id || `installer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const installer = {
      id, name, phone,
      tgChatId: tgChatId || null,
      specialization: specialization || 'general',
      notes: notes || '',
      photoUrl: photoUrl || null,
      teamId: teamId || null,
      teamName: teamName || null,
      isTeamLead: !!isTeamLead,
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

app.patch('/make-server-1df47c03/installers/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const raw = await kv.get(`installer:${id}`);
    if (!raw) return c.json({ error: 'Installer not found' }, 404);
    const existing = JSON.parse(raw);
    const patch = await c.req.json();
    const installer = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    await kv.set(`installer:${id}`, JSON.stringify(installer));
    return c.json({ installer });
  } catch (error: any) {
    console.error('Error patching installer:', error);
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
      teamId: installer.teamId || null,
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
    lead.assignedInstallerTeamId = installer.teamId || null;
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

// ─── EVERIS TEMPLATE DOCUMENT PACKAGE ────────────────────────────────────────

function numToWordsBYN(amount: number): string {
  const rounded = Math.round(amount * 100);
  const whole = Math.floor(rounded / 100);
  const kop = rounded % 100;
  const onesM  = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
  const onesF  = ['','одна','две','три','четыре','пять','шесть','семь','восемь','девять'];
  const teens  = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
  const tenths = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
  const hunds  = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
  const w3 = (n: number, fem = false): string => {
    const h=Math.floor(n/100),rest=n%100,t=Math.floor(rest/10),o=rest%10;
    let r=''; if(h) r+=hunds[h]+' '; if(t===1) r+=teens[o]+' ';
    else { if(t) r+=tenths[t]+' '; if(o) r+=(fem?onesF:onesM)[o]+' '; } return r.trim();
  };
  const rubleF=(n:number)=>{const o=n%10,t=n%100;return t>=11&&t<=14?'белорусских рублей':o===1?'белорусский рубль':o>=2&&o<=4?'белорусских рубля':'белорусских рублей';};
  const thF=(n:number)=>{const o=n%10,t=n%100;return t>=11&&t<=14?'тысяч':o===1?'тысяча':o>=2&&o<=4?'тысячи':'тысяч';};
  const kopF=(n:number)=>{const o=n%10,t=n%100;return t>=11&&t<=14?'копеек':o===1?'копейка':o>=2&&o<=4?'копейки':'копеек';};
  let res='';
  const th=Math.floor(whole/1000),rem=whole%1000;
  if(th>0) res+=w3(th,true)+' '+thF(th)+' ';
  if(rem>0||whole===0) res+=(w3(rem)||'ноль');
  res=res.trim()||'ноль'; res=res.charAt(0).toUpperCase()+res.slice(1);
  return `${res} ${rubleF(whole)} ${String(kop).padStart(2,'0')} ${kopF(kop)}`;
}

function numToWordsOnly(whole: number): string {
  const onesM  = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
  const onesF  = ['','одна','две','три','четыре','пять','шесть','семь','восемь','девять'];
  const teens  = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
  const tenths = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
  const hunds  = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
  const w3 = (n: number, fem = false): string => {
    const h=Math.floor(n/100),rest=n%100,t=Math.floor(rest/10),o=rest%10;
    let r=''; if(h) r+=hunds[h]+' '; if(t===1) r+=teens[o]+' ';
    else { if(t) r+=tenths[t]+' '; if(o) r+=(fem?onesF:onesM)[o]+' '; } return r.trim();
  };
  const thF=(n:number)=>{const o=n%10,t=n%100;return t>=11&&t<=14?'тысяч':o===1?'тысяча':o>=2&&o<=4?'тысячи':'тысяч';};
  let res='';
  const th=Math.floor(whole/1000),rem=whole%1000;
  if(th>0) res+=w3(th,true)+' '+thF(th)+' ';
  if(rem>0||whole===0) res+=(w3(rem)||'ноль');
  return res.trim()||'ноль';
}

function amountFull(amount: number, withVat: boolean): string {
  const rounded = Math.round(amount * 100);
  const whole = Math.floor(rounded / 100);
  const kop = rounded % 100;
  const rubleF=(n:number)=>{const o=n%10,t=n%100;return t>=11&&t<=14?'белорусских рублей':o===1?'белорусский рубль':o>=2&&o<=4?'белорусских рубля':'белорусских рублей';};
  const kopF=(n:number)=>{const o=n%10,t=n%100;return t>=11&&t<=14?'копеек':o===1?'копейка':o>=2&&o<=4?'копейки':'копеек';};
  const words = numToWordsOnly(whole);
  const kapStr = ` ${kop} ${kopF(kop)}`;
  const tax = withVat ? '' : ', без НДС (УСН согласно ст. 289 главы 34 Налогового кодекса Республики Беларусь)';
  return `${whole} (${words}) ${rubleF(whole)}${kapStr}${tax}`;
}

function toInitials(fullName: string): string {
  const p = fullName.trim().split(/\s+/);
  if(p.length<2) return fullName;
  const last=p[0],first=p[1],mid=p[2];
  return mid ? `${first[0]}.${mid[0]}. ${last}` : `${first[0]}. ${last}`;
}

// Legacy company-specific document package generator removed.
// Order documents are handled by order_core and the window templates.

Deno.serve(app.fetch);
