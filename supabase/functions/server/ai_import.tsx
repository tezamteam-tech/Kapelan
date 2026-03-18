// AI Import Route — parses uploaded CSV/XLSX/PDF catalogs and returns structured warehouse items
// Usage: import { registerAiImportRoutes } from "./ai_import.tsx"; registerAiImportRoutes(app);

import { Hono } from "npm:hono";

const OPENAI_KEY = () => Deno.env.get("kapelan_openai_api_key") ?? "";

const CATEGORIES = ["Трубопровод", "Дренаж", "Электрика", "Крепёж", "Расходники", "Фурнитура", "Оборудование", "Прочее"];
const UNITS = ["м", "шт", "кг", "компл", "рул", "уп", "л"];

// ─── CSV parser (simple, no deps) ───────────────────────────────────────────
function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
  return lines.map(line => {
    const cells: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inQ) { inQ = true; continue; }
      if (ch === '"' && inQ) { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; continue; }
      if ((ch === "," || ch === ";") && !inQ) { cells.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}

function csvToText(text: string): string {
  const rows = parseCSV(text);
  if (!rows.length) return text;
  const headers = rows[0];
  return rows.slice(1).map((row, ri) =>
    headers.map((h, i) => `${h}: ${row[i] ?? ""}`).join(" | ")
  ).join("\n");
}

// ─── XLSX → CSV text using npm:xlsx ─────────────────────────────────────────
async function xlsxToText(buffer: ArrayBuffer): Promise<string> {
  const XLSX = await import("npm:xlsx");
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const sheetTexts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(ws);
    sheetTexts.push(`--- Лист: ${sheetName} ---\n${csv}`);
  }
  return sheetTexts.join("\n\n");
}

// ─── PDF → text ──────────────────────────────────────────────────────────────
async function pdfToText(buffer: ArrayBuffer): Promise<string> {
  try {
    // @ts-ignore
    const pdfParse = (await import("npm:pdf-parse/lib/pdf-parse.js")).default;
    const result = await pdfParse(Buffer.from(buffer));
    return result.text || "";
  } catch (e: any) {
    console.log("pdf-parse failed:", e.message);
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const text = decoder.decode(buffer);
    const readable = text.replace(/[^\x20-\x7E\u0400-\u04FF\n\r\t]/g, " ")
                         .replace(/\s{3,}/g, "\n")
                         .trim();
    if (readable.length < 50) throw new Error("Не удалось извлечь текст из PDF. Конвертируйте в CSV или XLSX.");
    return readable;
  }
}

// ─── File reading helper ──────────────────────────────────────────────────────
async function readFileContent(file: File): Promise<string> {
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) throw new Error("Файл больше 10 МБ");

  const fileName = file.name.toLowerCase();
  if (fileName.endsWith(".csv") || fileName.endsWith(".txt")) {
    return csvToText(await file.text());
  } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const raw = await xlsxToText(buf);
    return raw;
  } else if (fileName.endsWith(".pdf")) {
    return pdfToText(await file.arrayBuffer());
  }
  throw new Error("Поддерживаются форматы: CSV, XLSX, XLS, PDF, TXT");
}

// ─── OpenAI call — WAREHOUSE ITEMS ───────────────────────────────────────────
async function parseWarehouseWithAI(text: string, fileName: string): Promise<any[]> {
  const truncated = text.length > 30000 ? text.slice(0, 30000) + "\n\n[...файл обрезан]" : text;

  const systemPrompt = `Ты — AI-ассистент для управления складом HVAC-компании (кондиционирование и вентиляция).
Тебе дан текст из каталога/прайса клиента. Твоя задача — извлечь ВСЕ товарные позиции в JSON.

Категории: "Трубопровод", "Дренаж", "Электрика", "Крепёж", "Расходники", "Фурнитура", "Оборудование", "Прочее"
Единицы: "м", "шт", "кг", "компл", "рул", "уп", "л"
itemType: "consumable" | "assembly" | "equipment"

Правила:
- Если цена/количество не указаны — ставь 0
- minStock: для расходников 5-20, для редких 1-2
- SKU генерируй если не указан (PIPE-001, CABLE-002 и т.п.)
- Вернуть ТОЛЬКО JSON без markdown`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Файл: ${fileName}\n\n${truncated}\n\nВерни JSON: { "items": [{ "name","category","unit","stock","minStock","price","sku","supplier","notes","itemType" }] }` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 8000,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI вернул пустой ответ");

  let parsed: any;
  try { parsed = JSON.parse(content); } catch { throw new Error("OpenAI вернул невалидный JSON"); }

  const items = parsed.items ?? parsed.data ?? (Array.isArray(parsed) ? parsed : []);
  if (!items.length) throw new Error("AI не нашёл позиций в файле. Проверьте формат данных.");

  return items.map((item: any, idx: number) => ({
    name:      String(item.name || `Позиция ${idx + 1}`).trim(),
    category:  CATEGORIES.includes(item.category) ? item.category : "Прочее",
    unit:      UNITS.includes(item.unit) ? item.unit : "шт",
    stock:     Math.max(0, Number(item.stock) || 0),
    minStock:  Math.max(0, Number(item.minStock) || 5),
    price:     Math.max(0, Number(item.price) || 0),
    sku:       String(item.sku || `AI-${String(idx + 1).padStart(3, "0")}`).trim(),
    supplier:  String(item.supplier || "").trim(),
    notes:     String(item.notes || "").trim(),
    itemType:  ["consumable", "assembly", "equipment"].includes(item.itemType) ? item.itemType : "consumable",
  }));
}

// ─── OpenAI call — EQUIPMENT (AC MODELS) ────────────────────────────────────
async function parseEquipmentWithAI(text: string, fileName: string): Promise<any[]> {
  const truncated = text.length > 40000 ? text.slice(0, 40000) + "\n\n[...файл обрезан]" : text;

  const systemPrompt = `Ты — AI-ассистент для HVAC-CRM системы компании по установке кондиционеров.
Тебе дан текст из каталога/прайса кондиционеров. Извлеки ВСЕ модели кондиционеров.

Формат BTU:
- 07 или 07S = 7000 BTU = 2.1 кВт, площадь 15-20 м²
- 09 или 09S = 9000 BTU = 2.6 кВт, площадь 20-25 м²
- 12 = 12000 BTU = 3.5 кВт, площадь 30-35 м²
- 18 = 18000 BTU = 5.3 кВт, площадь 45-55 м²
- 24 = 24000 BTU = 7.0 кВт, площадь 60-70 м²
- 36 = 36000 BTU = 10.5 кВт, площадь 90-100 м²
- 48 = 48000 BTU = 14.0 кВт, площадь 120-130 м²

type:
- "split_ac" — сплит-система (по умолчанию для большинства кондиционеров)
- "chiller" — чиллер
- "fan_coil" — фанкойл
- "vrv" — VRV/VRF система

Хладагент по умолчанию R32 для современных, R410A для старых моделей.

Серия/бренд: определяй из названия. Если "Dantex" упоминается — это бренд.
Если таблица содержит серии (например "Серия ADVANCE PRO PLUS 2 INVERTER") — используй это как часть model.

Из цены:
- Ищи числа в колонках "Цена", "РЦЦ", "руб", "BYN", "Price" или последних числовых колонках
- Цена должна быть разумной (1000-50000 BYN для кондиционеров)

Из технических данных:
- liquidPipeOd: 1/4" (жидкостная труба)
- gasPipeOd: 3/8", 1/2", 5/8" (газовая труба)
- maxPipeLength: максимальная длина трассы в метрах (15, 25, 30, 50)
- maxHeightDiff: максимальный перепад высот в метрах (10, 25, 30)
- currentA: автомат в амперах (10, 16, 20, 25)
- powerSupply: "220V/1F" для обычных, "380V/3F" для крупных (36k+)

Если данные не указаны, используй разумные значения по умолчанию:
- maxPipeLength: 15, minPipeLength: 3, maxHeightDiff: 10
- refrigerantCharge: 20 (г/м), startingCharge: 0.4
- drainType: "gravity", certRequired: true
- toolsRequired: ["Манифольд", "Вакуумный насос", "Развальцовщик"]
- warranty: 4

Вернуть ТОЛЬКО JSON без markdown.`;

  const userPrompt = `Файл: ${fileName}

${truncated}

Верни JSON:
{
  "items": [
    {
      "type": "split_ac",
      "brand": "Бренд",
      "model": "Артикул/Модель",
      "btu": 9000,
      "powerKw": 2.6,
      "areaMin": 20,
      "areaMax": 25,
      "price": 1500,
      "warranty": 4,
      "installerNotes": "Инверторный. Хладагент R32.",
      "installParams": {
        "refrigerant": "R32",
        "liquidPipeOd": "1/4\\"",
        "gasPipeOd": "3/8\\"",
        "maxPipeLength": 15,
        "minPipeLength": 3,
        "maxHeightDiff": 10,
        "refrigerantCharge": 20,
        "startingCharge": 0.4,
        "powerSupply": "220V/1F",
        "currentA": 10,
        "drainType": "gravity",
        "toolsRequired": ["Манифольд", "Вакуумный насос", "Развальцовщик"],
        "certRequired": true
      }
    }
  ]
}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 16000,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI вернул пустой ответ");

  let parsed: any;
  try { parsed = JSON.parse(content); } catch { throw new Error("OpenAI вернул невалидный JSON"); }

  const items = parsed.items ?? parsed.data ?? (Array.isArray(parsed) ? parsed : []);
  if (!items.length) throw new Error("AI не нашёл моделей в файле. Проверьте формат данных.");

  const now = () => new Date().toISOString();
  const DEFAULT_IMG = "https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?w=600";

  return items.map((item: any, idx: number) => {
    const btu = Number(item.btu) || 9000;
    const installParams = item.installParams || {};
    return {
      id:     `eq_ai_${Date.now()}_${idx}`,
      type:   ["split_ac", "chiller", "fan_coil", "vrv"].includes(item.type) ? item.type : "split_ac",
      brand:  String(item.brand || "Неизвестно").trim(),
      model:  String(item.model || `Модель ${idx + 1}`).trim(),
      btu,
      powerKw:  Number(item.powerKw) || Math.round(btu / 3412 * 10) / 10,
      areaMin:  Number(item.areaMin) || Math.floor(btu / 500),
      areaMax:  Number(item.areaMax) || Math.ceil(btu / 400),
      imageUrl: DEFAULT_IMG,
      price:    Math.max(0, Number(item.price) || 0),
      warranty: Number(item.warranty) || 4,
      installerNotes: String(item.installerNotes || "").trim(),
      installParams: {
        refrigerant:       String(installParams.refrigerant || "R32"),
        liquidPipeOd:      String(installParams.liquidPipeOd || '1/4"'),
        gasPipeOd:         String(installParams.gasPipeOd || '3/8"'),
        waterPipeOd:       installParams.waterPipeOd ? String(installParams.waterPipeOd) : undefined,
        maxPipeLength:     Number(installParams.maxPipeLength) || 15,
        minPipeLength:     Number(installParams.minPipeLength) || 3,
        maxHeightDiff:     Number(installParams.maxHeightDiff) || 10,
        refrigerantCharge: Number(installParams.refrigerantCharge) || 20,
        startingCharge:    Number(installParams.startingCharge) || 0.4,
        powerSupply:       String(installParams.powerSupply || "220V/1F"),
        currentA:          Number(installParams.currentA) || 10,
        drainType:         ["gravity", "pump", "both"].includes(installParams.drainType) ? installParams.drainType : "gravity",
        toolsRequired:     Array.isArray(installParams.toolsRequired) ? installParams.toolsRequired : ["Манифольд", "Вакуумный насос", "Развальцовщик"],
        certRequired:      installParams.certRequired !== false,
      },
      bom: [],
      active: true,
      createdAt: now(),
      updatedAt: now(),
    };
  });
}

// ─── Route registration ───────────────────────────────────────────────────────
export function registerAiImportRoutes(app: Hono) {

  // POST /warehouse/ai-import — parse warehouse items from file
  app.post("/make-server-1df47c03/warehouse/ai-import", async (c) => {
    try {
      if (!OPENAI_KEY()) return c.json({ error: "OpenAI API ключ не настроен (kapelan_openai_api_key)" }, 500);

      const contentType = c.req.header("content-type") ?? "";
      if (!contentType.includes("multipart/form-data")) return c.json({ error: "Ожидается multipart/form-data" }, 400);

      const formData = await c.req.formData();
      const file = formData.get("file") as File | null;
      if (!file) return c.json({ error: "Файл не передан (поле 'file')" }, 400);

      console.log(`Warehouse AI Import: "${file.name}" (${file.size} bytes)`);
      const textContent = await readFileContent(file);
      if (!textContent.trim()) return c.json({ error: "Файл пустой или не содержит текста" }, 400);

      const items = await parseWarehouseWithAI(textContent, file.name);
      console.log(`Warehouse AI Import: got ${items.length} items`);
      return c.json({ items, count: items.length, fileName: file.name });
    } catch (e: any) {
      console.log("Warehouse AI Import error:", e.message);
      return c.json({ error: e.message }, 500);
    }
  });

  // POST /equipment/ai-import — parse AC equipment models from file
  app.post("/make-server-1df47c03/equipment/ai-import", async (c) => {
    try {
      if (!OPENAI_KEY()) return c.json({ error: "OpenAI API ключ не настроен (kapelan_openai_api_key)" }, 500);

      const contentType = c.req.header("content-type") ?? "";
      if (!contentType.includes("multipart/form-data")) return c.json({ error: "Ожидается multipart/form-data" }, 400);

      const formData = await c.req.formData();
      const file = formData.get("file") as File | null;
      if (!file) return c.json({ error: "Файл не передан (поле 'file')" }, 400);

      console.log(`Equipment AI Import: "${file.name}" (${file.size} bytes)`);
      const textContent = await readFileContent(file);
      if (!textContent.trim()) return c.json({ error: "Файл пустой или не содержит текста" }, 400);

      const items = await parseEquipmentWithAI(textContent, file.name);
      console.log(`Equipment AI Import: got ${items.length} models`);
      return c.json({ items, count: items.length, fileName: file.name });
    } catch (e: any) {
      console.log("Equipment AI Import error:", e.message);
      return c.json({ error: e.message }, 500);
    }
  });
}