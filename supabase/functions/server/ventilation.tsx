// ─── VENTILATION DRAWING ANALYSIS MODULE ─────────────────────────────────────
// Accepts PDF/image → OpenAI Vision → extracts ducts, diameters, nodes
// Produces ventilation_materials_json with price estimation
import * as kv from "./kv_store.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DuctSegment {
  id: string;
  type: "round" | "rectangular";
  diameter?: number;    // mm, for round
  width?: number;       // mm, for rectangular
  height?: number;      // mm, for rectangular
  length: number;       // meters
  material: "galvanized" | "flexible" | "plastic" | "stainless" | "unknown";
  section: "supply" | "exhaust" | "recirculation" | "unknown";
  label?: string;       // marking from drawing
}

export interface VentNode {
  id: string;
  type: "tee" | "elbow_90" | "elbow_45" | "reducer" | "diffuser" | "grille" |
        "damper" | "fan" | "filter" | "flexible_insert" | "other";
  quantity: number;
  diameter?: number;
  width?: number;
  height?: number;
  description?: string;
}

export interface VentSystem {
  type: "supply" | "exhaust" | "supply_exhaust" | "recirculation" | "unknown";
  floors?: number;
  zones?: string[];
}

export interface VentSummary {
  totalDuctLength: number;
  totalDuctArea: number;
  ductsByDiameter: Record<string, number>;
  ductsBySection: Record<string, number>;
  totalNodes: number;
}

export interface VentMaterialItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  pricePerUnit: number;
  total: number;
}

export interface VentilationMaterialsJson {
  analysisId: string;
  sourceFileName: string;
  fileType: "image" | "pdf";
  analyzedAt: string;
  ducts: DuctSegment[];
  nodes: VentNode[];
  system: VentSystem;
  summary: VentSummary;
  materials: VentMaterialItem[];
  totalMaterials: number;
  workCost: number;
  grandTotal: number;
  confidence: "high" | "medium" | "low";
  confidenceReason?: string;
  notes?: string;
  rawAnalysis?: string;
  generatedAt: string;
}

// ─── Price catalog (UAH, 2025 Ukraine market) ─────────────────────────────────
const ROUND_DUCT_PRICES: Record<number, number> = {
  80: 55, 100: 75, 125: 95, 160: 130, 200: 185,
  250: 265, 315: 385, 400: 530, 500: 720, 630: 950, 800: 1300,
};
const RECT_DUCT_UAH_PER_SQM = 380; // UAH per m² of surface

function getRoundDuctPrice(diam: number): number {
  const sizes = Object.keys(ROUND_DUCT_PRICES).map(Number).sort((a, b) => a - b);
  const nearest = sizes.find(s => s >= diam) ?? sizes[sizes.length - 1];
  return ROUND_DUCT_PRICES[nearest] ?? 185;
}

function getDuctPrice(d: DuctSegment): number {
  if (d.type === "round" && d.diameter) {
    if (d.material === "flexible") return Math.round(getRoundDuctPrice(d.diameter) * 0.4);
    return getRoundDuctPrice(d.diameter);
  }
  if (d.type === "rectangular" && d.width && d.height) {
    const perimeter = 2 * (d.width + d.height) / 1000; // meters
    return Math.round(RECT_DUCT_UAH_PER_SQM * perimeter);
  }
  return 185;
}

const NODE_BASE_PRICES: Record<string, number> = {
  tee: 220, elbow_90: 145, elbow_45: 120, reducer: 165,
  diffuser: 380, grille: 220, damper: 850, fan: 0,
  filter: 1600, flexible_insert: 180, other: 150,
};
const TYPE_LABELS: Record<string, string> = {
  tee: "Тройник", elbow_90: "Отвод 90°", elbow_45: "Отвод 45°",
  reducer: "Переход-сужение", diffuser: "Диффузор", grille: "Решётка вентиляционная",
  damper: "Клапан воздушный", fan: "Вентилятор", filter: "Фильтр-бокс",
  flexible_insert: "Гибкая вставка", other: "Фасонное изделие",
};

function getNodePrice(type: string, diameter?: number): number {
  const base = NODE_BASE_PRICES[type] ?? 150;
  if (!diameter) return base;
  const scale = diameter <= 160 ? 0.8 : diameter <= 250 ? 1.0 : diameter <= 400 ? 1.5 : 2.2;
  return Math.round(base * scale);
}

// ─── Build materials list from analysed data ──────────────────────────────────
function buildMaterials(ducts: DuctSegment[], nodes: VentNode[]): VentMaterialItem[] {
  const items: VentMaterialItem[] = [];
  let idx = 1;

  // Group ducts by key
  const ductGroups = new Map<string, { duct: DuctSegment; totalLength: number }>();
  for (const d of ducts) {
    const key = d.type === "round"
      ? `r_${d.diameter}_${d.material}`
      : `q_${d.width}x${d.height}_${d.material}`;
    const ex = ductGroups.get(key);
    if (ex) ex.totalLength += d.length;
    else ductGroups.set(key, { duct: d, totalLength: d.length });
  }

  for (const [, { duct, totalLength }] of ductGroups) {
    const matStr = duct.material === "galvanized" ? ", оцинк. сталь"
      : duct.material === "flexible" ? ", гибкий"
      : duct.material === "plastic" ? ", пластик"
      : duct.material === "stainless" ? ", нерж. сталь" : "";
    const name = duct.type === "round"
      ? `Воздуховод круглый Ø${duct.diameter}${matStr}`
      : `Воздуховод прямоугольный ${duct.width}×${duct.height}${matStr}`;
    const pricePerUnit = getDuctPrice(duct);
    const qty = Math.round(totalLength * 10) / 10;
    const category = duct.material === "flexible" ? "Гибкие воздуховоды" : "Жёсткие воздуховоды";
    items.push({ id: `m${idx++}`, name, category, unit: "м", qty, pricePerUnit, total: Math.round(qty * pricePerUnit) });
  }

  // Connectors (flanges, etc.) estimate: 2 per duct segment
  const totalDuctSegments = ducts.length;
  if (totalDuctSegments > 0) {
    const flangeQty = totalDuctSegments * 2;
    items.push({ id: `m${idx++}`, name: "Фланец соединительный", category: "Крепёж", unit: "шт", qty: flangeQty, pricePerUnit: 45, total: flangeQty * 45 });
    // Hangers: 1 per 2m
    const totalLen = ducts.reduce((s, d) => s + d.length, 0);
    const hangers = Math.ceil(totalLen / 2);
    items.push({ id: `m${idx++}`, name: "Крепление-подвес воздуховода", category: "Крепёж", unit: "шт", qty: hangers, pricePerUnit: 35, total: hangers * 35 });
  }

  // Nodes
  const nodeGroups = new Map<string, { node: VentNode; totalQty: number }>();
  for (const n of nodes) {
    const key = `${n.type}_${n.diameter ?? 0}_${n.width ?? 0}`;
    const ex = nodeGroups.get(key);
    if (ex) ex.totalQty += n.quantity;
    else nodeGroups.set(key, { node: n, totalQty: n.quantity });
  }

  for (const [, { node, totalQty }] of nodeGroups) {
    if (node.type === "fan") continue;
    const typeLabel = TYPE_LABELS[node.type] ?? "Фасонное изделие";
    const dimStr = node.diameter ? ` Ø${node.diameter}` : node.width ? ` ${node.width}×${node.height}` : "";
    const pricePerUnit = getNodePrice(node.type, node.diameter);
    items.push({ id: `m${idx++}`, name: `${typeLabel}${dimStr}`, category: "Фасонные изделия", unit: "шт", qty: totalQty, pricePerUnit, total: totalQty * pricePerUnit });
  }

  // Insulation for supply ducts (60% coverage estimate)
  const supplyLen = ducts.filter(d => d.section === "supply" && d.material !== "flexible").reduce((s, d) => s + d.length, 0);
  if (supplyLen > 2) {
    const area = Math.ceil(supplyLen * 0.65);
    items.push({ id: `m${idx++}`, name: "Теплоизоляция воздуховодов (минвата 50мм, с фольгой)", category: "Изоляция", unit: "м²", qty: area, pricePerUnit: 165, total: area * 165 });
    // Insulation tape
    const tape = Math.ceil(supplyLen / 10) * 2;
    items.push({ id: `m${idx++}`, name: "Лента алюминиевая 50мм", category: "Изоляция", unit: "рул", qty: tape, pricePerUnit: 95, total: tape * 95 });
  }

  // Sealant
  const totalDuctLen = ducts.reduce((s, d) => s + d.length, 0);
  if (totalDuctLen > 5) {
    const sealant = Math.ceil(totalDuctLen / 15);
    items.push({ id: `m${idx++}`, name: "Герметик для воздуховодов", category: "Расходные материалы", unit: "шт", qty: sealant, pricePerUnit: 280, total: sealant * 280 });
  }

  return items;
}

// ─── AI prompt ────────────────────────────────────────────────────────────────
const VENTILATION_PROMPT = `Ты — инженер-проектировщик вентиляционных систем с опытом чтения технических чертежей (CAD).

Проанализируй этот чертёж/схему вентиляции и извлеки ВСЕ данные с максимальной точностью.

ИЗВЛЕКИ:
1. Все участки воздуховодов: диаметр/размеры (мм), длина (м), тип (круглый/прямоугольный), материал, секция (приток/вытяжка)
2. Все узлы и фасонные изделия с количеством: тройники, отводы, переходы, диффузоры, решётки, клапаны, фильтры, вентиляторы
3. Тип системы вентиляции
4. Зоны обслуживания

ВАЖНО:
- Если длины явно не указаны — оцени по масштабу (ищи масштабную линейку на чертеже)
- Если размеры нечёткие — укажи стандартные размеры для похожих систем
- Возвращай ТОЛЬКО валидный JSON, без пояснений, без markdown-блоков

ФОРМАТ ОТВЕТА (строго JSON):
{
  "ducts": [
    {
      "id": "d1",
      "type": "round",
      "diameter": 200,
      "width": null,
      "height": null,
      "length": 8.5,
      "material": "galvanized",
      "section": "supply",
      "label": "маркировка или обозначение с чертежа"
    }
  ],
  "nodes": [
    {
      "id": "n1",
      "type": "tee",
      "quantity": 3,
      "diameter": 200,
      "width": null,
      "height": null,
      "description": "тройник на разветвлении"
    }
  ],
  "system": {
    "type": "supply_exhaust",
    "floors": 1,
    "zones": ["офис", "коридор", "серверная"]
  },
  "summary": {
    "totalDuctLength": 67.5,
    "totalDuctArea": 42.3,
    "ductsByDiameter": {"200": 35.0, "160": 20.0, "125": 12.5},
    "ductsBySection": {"supply": 38.0, "exhaust": 29.5},
    "totalNodes": 18
  },
  "confidence": "high",
  "confidenceReason": "чёткий чертёж с размерами и масштабом",
  "notes": "дополнительные наблюдения по системе"
}

ТИПЫ ВОЗДУХОВОДОВ: "round" или "rectangular"
МАТЕРИАЛЫ: "galvanized" (оцинк.сталь), "flexible" (гибкий), "plastic", "stainless", "unknown"
СЕКЦИИ: "supply" (приток), "exhaust" (вытяжка), "recirculation" (рециркуляция), "unknown"
ТИПЫ УЗЛОВ: "tee" | "elbow_90" | "elbow_45" | "reducer" | "diffuser" | "grille" | "damper" | "fan" | "filter" | "flexible_insert" | "other"
УРОВЕНЬ УВЕРЕННОСТИ: "high" (чёткий чертёж), "medium" (некоторые данные отсутствуют), "low" (плохое качество)`;

// ─── Chunked base64 encoder (avoids stack overflow for large files) ─────────
function toBase64(buffer: ArrayBuffer): string {
  const uint8 = new Uint8Array(buffer);
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < uint8.length; i += chunk) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ─── OpenAI: image via chat/completions ──────────────────────────────────────
async function analyzeImage(apiKey: string, base64: string, mimeType: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: VENTILATION_PROMPT },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}`, detail: "high" } },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI Vision error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── OpenAI: PDF via Files API → Responses API ───────────────────────────────
async function uploadToOpenAI(apiKey: string, ab: ArrayBuffer, filename: string, mime: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([ab], { type: mime }), filename);
  fd.append("purpose", "user_data");
  const res = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: fd,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI Files API error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return data.id;
}

async function analyzePdf(apiKey: string, fileId: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      max_output_tokens: 4096,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: VENTILATION_PROMPT },
          { type: "input_file", file_id: fileId },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI Responses API error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  // Extract text from Responses API format
  const content = data.output?.[0]?.content;
  if (Array.isArray(content)) {
    return content.find((c: any) => c.type === "output_text")?.text ?? "";
  }
  return data.output_text ?? JSON.stringify(data);
}

async function deleteOpenAIFile(apiKey: string, fileId: string): Promise<void> {
  try {
    await fetch(`https://api.openai.com/v1/files/${fileId}`, {
      method: "DELETE", headers: { "Authorization": `Bearer ${apiKey}` },
    });
  } catch { /* best-effort */ }
}

// ─── Parse AI JSON response ───────────────────────────────────────────────────
function parseAIJson(text: string): any {
  let clean = text.trim();
  // Strip markdown code blocks if present
  clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  // Find first { ... }
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end !== -1) clean = clean.slice(start, end + 1);
  return JSON.parse(clean);
}

// ─── Register routes ──────────────────────────────────────────────────────────
export function registerVentilationRoutes(app: any): void {
  const P = "/make-server-1df47c03";

  // POST /ventilation/analyze — main analysis endpoint
  app.post(`${P}/ventilation/analyze`, async (c: any) => {
    const apiKey = Deno.env.get("kapelan_openai_api_key");
    if (!apiKey) return c.json({ error: "kapelan_openai_api_key not configured" }, 500);

    try {
      const formData = await c.req.formData();
      const file = formData.get("file") as File | null;
      if (!file) return c.json({ error: "Поле 'file' обязательно" }, 400);

      const filename = file.name ?? "drawing";
      const mimeType = file.type || (filename.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      const isPdf = mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
      const isImage = mimeType.startsWith("image/");

      if (!isPdf && !isImage) {
        return c.json({ error: "Поддерживаются PDF и изображения (PNG, JPG, WEBP, GIF)" }, 400);
      }

      const ab = await file.arrayBuffer();
      const sizeMB = ab.byteLength / (1024 * 1024);
      if (sizeMB > 20) return c.json({ error: `Файл слишком большой: ${sizeMB.toFixed(1)} МБ (максимум 20 МБ)` }, 400);

      console.log(`[ventilation] analyze: ${filename} (${mimeType}, ${sizeMB.toFixed(2)}MB)`);

      let rawAnalysis: string;
      let openaiFileId: string | null = null;

      if (isImage) {
        const base64 = toBase64(ab);
        rawAnalysis = await analyzeImage(apiKey, base64, mimeType);
      } else {
        // PDF: upload → Responses API → delete
        openaiFileId = await uploadToOpenAI(apiKey, ab, filename, mimeType);
        console.log(`[ventilation] PDF uploaded to OpenAI: ${openaiFileId}`);
        rawAnalysis = await analyzePdf(apiKey, openaiFileId);
        await deleteOpenAIFile(apiKey, openaiFileId);
        console.log(`[ventilation] OpenAI file deleted`);
      }

      console.log(`[ventilation] raw AI response (first 400): ${rawAnalysis.slice(0, 400)}`);

      // Parse AI JSON
      let aiData: any;
      try {
        aiData = parseAIJson(rawAnalysis);
      } catch (parseErr: any) {
        console.error("[ventilation] JSON parse failed:", parseErr.message, "\nRaw:", rawAnalysis.slice(0, 800));
        return c.json({
          error: `AI вернул некорректный ответ: ${parseErr.message}`,
          rawAnalysis: rawAnalysis.slice(0, 2000),
        }, 500);
      }

      const ducts: DuctSegment[] = (aiData.ducts ?? []).map((d: any, i: number) => ({
        id: d.id ?? `d${i + 1}`,
        type: d.type ?? "round",
        diameter: d.diameter ?? undefined,
        width: d.width ?? undefined,
        height: d.height ?? undefined,
        length: Number(d.length) || 0,
        material: d.material ?? "galvanized",
        section: d.section ?? "unknown",
        label: d.label ?? "",
      }));

      const nodes: VentNode[] = (aiData.nodes ?? []).map((n: any, i: number) => ({
        id: n.id ?? `n${i + 1}`,
        type: n.type ?? "other",
        quantity: Number(n.quantity) || 1,
        diameter: n.diameter ?? undefined,
        width: n.width ?? undefined,
        height: n.height ?? undefined,
        description: n.description ?? "",
      }));

      const materials = buildMaterials(ducts, nodes);
      const totalMaterials = materials.reduce((s, m) => s + m.total, 0);

      const aiSum = aiData.summary ?? {};
      const summary: VentSummary = {
        totalDuctLength: Number(aiSum.totalDuctLength) || ducts.reduce((s, d) => s + d.length, 0),
        totalDuctArea: Number(aiSum.totalDuctArea) || 0,
        ductsByDiameter: aiSum.ductsByDiameter ?? {},
        ductsBySection: aiSum.ductsBySection ?? {},
        totalNodes: Number(aiSum.totalNodes) || nodes.reduce((s, n) => s + n.quantity, 0),
      };

      const analysisId = `vent_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;
      const result: VentilationMaterialsJson = {
        analysisId,
        sourceFileName: filename,
        fileType: isPdf ? "pdf" : "image",
        analyzedAt: new Date().toISOString(),
        ducts,
        nodes,
        system: {
          type: aiData.system?.type ?? "unknown",
          floors: aiData.system?.floors,
          zones: aiData.system?.zones ?? [],
        },
        summary,
        materials,
        totalMaterials,
        workCost: 0,
        grandTotal: totalMaterials,
        confidence: aiData.confidence ?? "medium",
        confidenceReason: aiData.confidenceReason ?? "",
        notes: aiData.notes ?? "",
        rawAnalysis,
        generatedAt: new Date().toISOString(),
      };

      await kv.set(`ventilation:${analysisId}`, JSON.stringify(result));
      console.log(`[ventilation] saved: ${analysisId}, ducts: ${ducts.length}, nodes: ${nodes.length}, total: ${totalMaterials}`);

      return c.json({ analysis: result });
    } catch (error: any) {
      console.error("[ventilation] analyze error:", error);
      return c.json({ error: `Ошибка анализа: ${error.message}` }, 500);
    }
  });

  // GET /ventilation/analyses — list all (lightweight)
  app.get(`${P}/ventilation/analyses`, async (c: any) => {
    try {
      const all = await kv.getByPrefix("ventilation:");
      const list = (all as string[]).map(s => {
        try {
          const a: VentilationMaterialsJson = JSON.parse(s);
          return {
            analysisId: a.analysisId,
            sourceFileName: a.sourceFileName,
            fileType: a.fileType,
            analyzedAt: a.analyzedAt,
            confidence: a.confidence,
            summary: a.summary,
            totalMaterials: a.totalMaterials,
            grandTotal: a.grandTotal,
            ductsCount: a.ducts.length,
            nodesCount: a.nodes.length,
          };
        } catch { return null; }
      }).filter(Boolean)
        .sort((a: any, b: any) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime());
      return c.json({ analyses: list });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // GET /ventilation/analyses/:id — full detail
  app.get(`${P}/ventilation/analyses/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`ventilation:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Анализ не найден" }, 404);
      return c.json({ analysis: JSON.parse(raw) });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // PATCH /ventilation/analyses/:id — update materials prices or workCost
  app.patch(`${P}/ventilation/analyses/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`ventilation:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Анализ не найден" }, 404);
      const analysis: VentilationMaterialsJson = JSON.parse(raw);
      const body = await c.req.json();

      if (Array.isArray(body.materials)) {
        analysis.materials = body.materials;
        analysis.totalMaterials = body.materials.reduce((s: number, m: any) => s + (m.total ?? 0), 0);
      }
      if (body.workCost !== undefined) analysis.workCost = Number(body.workCost) || 0;
      analysis.grandTotal = analysis.totalMaterials + analysis.workCost;

      await kv.set(`ventilation:${analysis.analysisId}`, JSON.stringify(analysis));
      return c.json({ analysis });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // DELETE /ventilation/analyses/:id
  app.delete(`${P}/ventilation/analyses/:id`, async (c: any) => {
    try {
      await kv.del(`ventilation:${c.req.param("id")}`);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });
}