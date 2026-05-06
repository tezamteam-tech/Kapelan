import { useState, useRef, useCallback } from "react";
import {
  X, Upload, Download, Sparkles, FileText, FileSpreadsheet,
  CheckCircle2, AlertCircle, Loader2, ChevronRight, ChevronLeft,
  Wind, Check, Edit3, RefreshCw, Info, File, Thermometer,
  Layers, Gauge, DollarSign, Zap, AreaChart
} from "lucide-react";
import { useCurrency } from "./CurrencyContext";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { RightSideCard } from "./ui/RightSideCard";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH  = { Authorization: `Bearer ${publicAnonKey}` };
const JH  = { ...AH, "Content-Type": "application/json" };

async function fetchWith404Fallback(path: string, init: RequestInit, altPath: string): Promise<Response> {
  const res = await fetch(`${API}${path}`, init);
  if (res.status !== 404) return res;
  const normalizedAlt = String(altPath || "")
    .replace(/^\/make-server-1df47c03\b/i, "")
    .trim();
  if (!normalizedAlt || normalizedAlt === path) return res;
  return await fetch(`${API}${normalizedAlt}`, init);
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface ParsedEquipment {
  _idx: number;
  _selected: boolean;
  _status: "new" | "saving" | "saved" | "error";
  _error?: string;
  id: string;
  type: string;
  brand: string;
  model: string;
  btu: number;
  powerKw: number;
  areaMin: number;
  areaMax: number;
  price: number;
  warranty: number;
  source?: "warehouse" | "supplier" | "unknown";
  stockQty?: number;
  availability?: "in_stock_warehouse" | "in_stock_supplier" | "order_only";
  installerNotes: string;
  installParams: {
    refrigerant: string;
    liquidPipeOd: string;
    gasPipeOd: string;
    maxPipeLength: number;
    maxHeightDiff: number;
    powerSupply: string;
    currentA: number;
  };
  bom: any[];
  active: boolean;
  imageUrl: string;
  createdAt: string;
  updatedAt: string;
}

const EQ_TYPE_CFG: Record<string, { label: string; color: string; bg: string }> = {
  split_ac:  { label: "Сплит-система",  color: "text-blue-700",   bg: "bg-blue-100" },
  chiller:   { label: "Чиллер",         color: "text-cyan-700",   bg: "bg-cyan-100" },
  fan_coil:  { label: "Фанкойл",        color: "text-violet-700", bg: "bg-violet-100" },
  vrv:       { label: "VRV/VRF",        color: "text-teal-700",   bg: "bg-teal-100" },
};
const EQ_TYPES = Object.keys(EQ_TYPE_CFG);

// ─── Equipment template CSV ───────────────────────────────────────────────────
const TEMPLATE_CSV = `Бренд,Артикул/Модель,Тип,BTU,кВт,Площадь мин м2,Площадь макс м2,Цена BYN,Гарантия лет,Хладагент,Труба жидкостная,Труба газовая,Длина трассы макс м,Перепад высот макс м,Автомат А,Питание,Примечание монтажнику
Dantex,RK-09S5AT2/RK-09S5AT2E,split_ac,9000,2.6,20,25,1890,4,R32,1/4",3/8",15,10,10,220V/1F,Инверторный. Серия ADVANCE PRO PLUS 2.
Dantex,RK-12S5AT2/RK-12S5AT2E,split_ac,12000,3.5,30,35,1995,4,R32,1/4",3/8",15,10,10,220V/1F,Инверторный. Серия ADVANCE PRO PLUS 2.
Dantex,RK-18S5AT2/RK-18S5AT2E,split_ac,18000,5.3,45,55,2730,4,R32,1/4",1/2",25,25,16,220V/1F,Инверторный. Серия ADVANCE PRO PLUS 2.
Dantex,RK-24S5AT2/RK-24S5AT2E,split_ac,24000,7.0,60,70,3850,4,R32,1/4",5/8",25,25,16,220V/1F,Инверторный. Серия ADVANCE PRO PLUS 2.
Dantex,RK-36S3/RK-36S3E,split_ac,36000,10.5,90,100,5200,4,R410A,3/8",5/8",30,25,20,380V/3F,Серия SPACE 3. Трёхфазное питание.
`;

function downloadTemplate() {
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "equipment_template.csv"; a.click();
  URL.revokeObjectURL(url);
}

const STEPS = ["Источник", "Загрузка", "AI-анализ", "Предпросмотр", "Готово"] as const;
const fmt = (n: number) => n.toLocaleString("ru-RU");

interface Props {
  onClose: () => void;
  onImported: (count: number) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
export function AiEquipmentImportModal({ onClose, onImported }: Props) {
  const { fmtShort } = useCurrency();
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [file, setFile]   = useState<File | null>(null);
  const [drag, setDrag]   = useState(false);
  const [error, setError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [items, setItems] = useState<ParsedEquipment[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [autoEnrich, setAutoEnrich] = useState(true);
  const [enriching, setEnriching] = useState<{ running: boolean; done: number; total: number } | null>(null);
  const [parseProgress, setParseProgress] = useState<{ done: number; total: number } | null>(null);
  const [parseWarning, setParseWarning] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedCount = items.filter(i => i._selected).length;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  function acceptFile(f: File) {
    const name = f.name.toLowerCase();
    const ok = name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls")
             || name.endsWith(".pdf") || name.endsWith(".txt")
             || name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp");
    if (!ok) { setError("Поддерживаются: CSV, XLSX, XLS, PDF, TXT, PNG, JPG, WEBP"); return; }
    if (f.size > 10 * 1024 * 1024) { setError("Файл больше 10 МБ"); return; }
    setError(""); setFile(f); setStep(1);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) acceptFile(f);
  }

  async function runParse() {
    if (!file) return;
    setStep(2); setParsing(true); setError(""); setParseWarning("");
    try {
      async function fetchJsonWithRetry(url: string, init: RequestInit, maxAttempts = 5): Promise<{ res: Response; data: any }> {
        let lastErr: any = null;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const res = await fetch(url, init);
            const data = await res.json().catch(() => ({}));
            if (res.ok && !data?.error) return { res, data };
            const msg = String(data?.error ?? `HTTP ${res.status}`);
            const retriable = res.status >= 500 || msg.toLowerCase().includes("service unavailable");
            if (!retriable || attempt === maxAttempts - 1) throw new Error(msg);
            await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
          } catch (e: any) {
            lastErr = e;
            const m = String(e?.message ?? "");
            const retriable =
              m.toLowerCase().includes("failed to fetch") ||
              m.toLowerCase().includes("network") ||
              m.toLowerCase().includes("io_suspended") ||
              m.toLowerCase().includes("service unavailable");
            if (!retriable || attempt === maxAttempts - 1) throw e;
            await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
          }
        }
        throw lastErr ?? new Error("network error");
      }

      // Warm up edge function to reduce cold-start latency before starting a chunked job.
      await fetch(`${API}/health`, { method: "GET", headers: AH }).catch(() => null);
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await fetchJsonWithRetry(`${API}/equipment/ai-import`, { method: "POST", headers: AH, body: fd }, 5);

      // Chunked job flow for big files
      if (data.chunked && data.jobId) {
        const jobId = String(data.jobId);
        let totalChunks = Number(data.totalChunks ?? 0) || 0;
        setParseProgress({ done: 0, total: totalChunks });
        let done = 0;
        let finalItems: any[] = [];
        const stepWarnings: string[] = [];
        const start = Date.now();
        const MAX_PARSE_MS = 30 * 60 * 1000; // allow long imports; backend has per-step timeouts + fallbacks
        for (let guard = 0; guard < 2000; guard++) {
          const { data: stepData } = await fetchJsonWithRetry(
            `${API}/equipment/ai-import/step`,
            { method: "POST", headers: JH, body: JSON.stringify({ jobId }) },
            5,
          );
          done = Number(stepData.doneChunks ?? done) || done;
          const tc = Number(stepData.totalChunks ?? totalChunks) || totalChunks;
          if (tc > totalChunks) totalChunks = tc;
          setParseProgress({ done, total: totalChunks });
          const w = String(stepData.chunkWarning ?? "").trim();
          if (w) stepWarnings.push(w);
          if (Array.isArray(stepData.warnings)) {
            for (const x of stepData.warnings) {
              const s = String(x ?? "").trim();
              if (s) stepWarnings.push(s);
            }
          }
          if (stepData.done) {
            finalItems = stepData.items ?? [];
            break;
          }
          if (Date.now() - start > MAX_PARSE_MS) {
            const uniq = Array.from(new Set(stepWarnings));
            throw new Error(`Импорт занимает слишком много времени. Попробуйте ещё раз (обработка идёт чанками).\n\n${uniq.slice(0, 3).join("\n")}`);
          }
          await new Promise(r => setTimeout(r, 350));
        }
        const uniq = Array.from(new Set(stepWarnings));
        setParseWarning(uniq.slice(0, 4).join("\n"));
        const parsed: ParsedEquipment[] = (finalItems ?? []).map((item: any, idx: number) => ({
          ...item,
          _idx: idx,
          _selected: true,
          _status: "new" as const,
        }));
        if (!parsed.length) {
          const hint = uniq.length ? `\n\n${uniq.slice(0, 2).join("\n")}` : "";
          throw new Error(`AI не нашёл моделей. Проверьте содержимое файла.${hint}`);
        }
        setItems(parsed);
        setParseProgress(null);
        setStep(3);
      } else {
        const parsed: ParsedEquipment[] = (data.items ?? []).map((item: any, idx: number) => ({
          ...item,
          _idx: idx,
          _selected: true,
          _status: "new" as const,
        }));
        if (!parsed.length) throw new Error("AI не нашёл моделей. Проверьте содержимое файла.");
        setItems(parsed);
        setStep(3);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.toLowerCase().includes("io_suspended") || msg.toLowerCase().includes("failed to fetch")) {
        setError("Сеть временно недоступна (браузер/вкладка приостановила запрос). Повторите импорт — запросы теперь идут с автоповторами.");
      } else {
        setError(msg || "Ошибка запуска импорта");
      }
      setStep(1);
    } finally {
      setParsing(false);
    }
  }

  async function runImport() {
    const toImport = items.filter(i => i._selected && i._status === "new");
    if (!toImport.length) return;
    setImporting(true);
    setProgress({ done: 0, total: toImport.length });

    const BATCH = 25;
    let done = 0;
    const batches: ParsedEquipment[][] = [];
    for (let i = 0; i < toImport.length; i += BATCH) batches.push(toImport.slice(i, i + BATCH));
    const savedIds: string[] = [];

    async function postBulk(payload: any, attempt = 0): Promise<any> {
      try {
        const res = await fetch(`${API}/equipment/bulk`, { method: "POST", headers: JH, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        return data;
      } catch (e: any) {
        const msg = String(e?.message ?? "");
        const retriable = msg.includes("503") || msg.toLowerCase().includes("service unavailable") || msg.toLowerCase().includes("failed to fetch");
        if (retriable && attempt < 4) {
          await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
          return await postBulk(payload, attempt + 1);
        }
        throw e;
      }
    }

    for (const batch of batches) {
      // mark as saving
      setItems(prev => prev.map(i => batch.some(b => b._idx === i._idx) ? { ...i, _status: "saving" as const } : i));
      try {
        const bodies = batch.map(item => {
          const { _idx, _selected, _status, _error, source, stockQty, availability, ...body } = item as any;
          return body;
        });
        const data = await postBulk({ items: bodies });
        const saved: any[] = Array.isArray(data.saved) ? data.saved : [];
        for (const s of saved) {
          const id = String(s?.id ?? "").trim();
          if (id) savedIds.push(id);
        }
        // Update statuses best-effort by matching brand+model+type
        setItems(prev => prev.map(i => {
          const isIn = batch.some(b => b._idx === i._idx);
          if (!isIn) return i;
          const hit = saved.find(s => String(s.brand ?? "") === String((i as any).brand ?? "") && String(s.model ?? "") === String((i as any).model ?? "") && String(s.type ?? "") === String((i as any).type ?? ""));
          return hit ? { ...i, _status: "saved" as const } : { ...i, _status: "error" as const, _error: "Не удалось сохранить (bulk)" };
        }));
      } catch (e: any) {
        setItems(prev => prev.map(i => batch.some(b => b._idx === i._idx) ? { ...i, _status: "error" as const, _error: String(e?.message ?? "bulk failed") } : i));
      }
      done += batch.length;
      setProgress({ done, total: toImport.length });
      await new Promise(r => setTimeout(r, 150));
    }
    setImporting(false);

    // Optional bulk enrichment right after import (best-effort)
    if (autoEnrich && savedIds.length) {
      setEnriching({ running: true, done: 0, total: savedIds.length });
      try {
        const B2 = 10; // server limit
        for (let i = 0; i < savedIds.length; i += B2) {
          const batch = savedIds.slice(i, i + B2);
          const res = await fetchWith404Fallback(`/equipment/enrich`, {
            method: "POST",
            headers: JH,
            body: JSON.stringify({ items: batch.map((id) => ({ equipmentId: id })) }),
          }, `/make-server-1df47c03/equipment/enrich`);
          if (res.status === 404) throw new Error("Autofill API не найден (404). Нужно задеплоить Supabase Edge Function make-server-1df47c03.");
          const d = await res.json().catch(() => ({}));
          if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
          setEnriching(prev => prev ? { ...prev, done: Math.min(prev.total, prev.done + batch.length) } : prev);
          await new Promise(r => setTimeout(r, 250));
        }
      } catch (e: any) {
        const msg = String(e?.message ?? "AI enrichment failed");
        if (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("network")) {
          setParseWarning("Нет подключения к интернету/серверу. Автозаполнение после импорта пропущено.");
        } else {
          setParseWarning(msg);
        }
      } finally {
        setEnriching(prev => prev ? { ...prev, running: false } : prev);
      }
    }

    onImported(items.filter(i => i._status === "saved").length + done);
    setStep(4);
  }

  function update(idx: number, field: string, value: any) {
    setItems(prev => prev.map(i => i._idx === idx ? { ...i, [field]: value } : i));
  }
  function updateParam(idx: number, field: string, value: any) {
    setItems(prev => prev.map(i => i._idx === idx
      ? { ...i, installParams: { ...i.installParams, [field]: value } } : i));
  }
  function toggleAll(val: boolean) {
    setItems(prev => prev.map(i => ({ ...i, _selected: val })));
  }

  return (
    <RightSideCard
      open={true}
      onClose={onClose}
      showHeader={false}
      defaultWidth={640}
      minWidth={640}
      maxWidth={940}
      overlayClassName="backdrop-blur-sm"
    >
      <div className="w-full h-full flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-600 to-teal-600">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <Wind size={18} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-white text-base">AI-импорт каталога оборудования</h2>
              <p className="text-blue-100 text-xs">Загрузите прайс-лист кондиционеров — AI распознает все модели</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/20 text-white/70 hover:text-white transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Steps */}
        <div className="flex px-6 py-3 bg-slate-50 border-b border-slate-100 gap-1">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div className={`flex items-center gap-1.5 ${i <= step ? "text-blue-700" : "text-slate-300"}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black transition-all ${
                  i < step ? "bg-blue-600 text-white" :
                  i === step ? "bg-blue-100 text-blue-700 ring-2 ring-blue-400" :
                  "bg-slate-200 text-slate-400"
                }`}>
                  {i < step ? <Check size={10} /> : i + 1}
                </div>
                <span className="text-[10px] font-semibold whitespace-nowrap hidden sm:block">{s}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 rounded-full transition-all ${i < step ? "bg-blue-400" : "bg-slate-200"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* ═══ STEP 0 ═══ */}
          {step === 0 && (
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-500 text-center mb-4">
                Загрузите прайс-лист или каталог кондиционеров в любом формате
              </p>

              {/* Template */}
              <div onClick={downloadTemplate}
                className="border-2 border-dashed border-blue-200 rounded-2xl p-5 bg-blue-50 hover:bg-blue-100 transition-all cursor-pointer group">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 group-hover:bg-blue-200 flex items-center justify-center flex-shrink-0 transition-all">
                    <Download size={22} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="font-bold text-blue-800 text-sm">Скачать шаблон CSV для оборудования</p>
                    <p className="text-xs text-blue-600 mt-1">Готовый шаблон с колонками для кондиционеров — заполните по образцу из вашего прайса.</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {["Бренд", "Модель/Артикул", "BTU", "Цена BYN", "Хладагент", "Трубы", "Длина трассы"].map(c => (
                        <span key={c} className="bg-white text-blue-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-blue-200">{c}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Upload */}
              <div
                className={`border-2 border-dashed rounded-2xl p-5 transition-all cursor-pointer ${
                  drag ? "border-teal-400 bg-teal-50" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                }`}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.pdf,.txt" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) acceptFile(f); }} />
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${drag ? "bg-teal-100" : "bg-slate-100"}`}>
                    <Upload size={22} className={drag ? "text-teal-600" : "text-slate-500"} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-700 text-sm">Загрузить прайс кондиционеров</p>
                    <p className="text-xs text-slate-500 mt-1">Перетащите файл или нажмите для выбора. Поддерживаются любые форматы — даже произвольный прайс-лист.</p>
                    <div className="flex gap-2 mt-2.5">
                      {[
                        { ext: "CSV", color: "bg-green-100 text-green-700" },
                        { ext: "XLSX", color: "bg-emerald-100 text-emerald-700" },
                        { ext: "PDF", color: "bg-red-100 text-red-700" },
                        { ext: "TXT", color: "bg-slate-100 text-slate-600" },
                      ].map(f => (
                        <span key={f.ext} className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${f.color}`}>{f.ext}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}

              <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3">
                <Info size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-700">
                  <strong>AI понимает:</strong> таблицы с сериями моделей, артикулы, BTU из названия (RK-09, 12000 BTU), трубы (1/4", 3/8"), цены в BYN/руб. Картинки для моделей можно добавить вручную после импорта.
                </p>
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 px-1">
                <input
                  type="checkbox"
                  checked={autoEnrich}
                  onChange={(e) => setAutoEnrich(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-teal-600"
                />
                Автозаполнять карточки после импорта (фото, PDF, расходники)
              </label>
            </div>
          )}

          {/* ═══ STEP 1 ═══ */}
          {step === 1 && file && (
            <div className="p-6 flex flex-col items-center gap-6 py-10">
              <div className="w-20 h-20 rounded-3xl bg-blue-50 flex items-center justify-center">
                <FileSpreadsheet size={36} className="text-blue-500" />
              </div>
              <div className="text-center">
                <p className="font-bold text-slate-800 text-base">{file.name}</p>
                <p className="text-sm text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} КБ</p>
              </div>
              {error && (
                <div className="w-full flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}
              <div className="w-full max-w-sm space-y-3">
                <button onClick={runParse}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-teal-600 text-white font-bold py-3 rounded-2xl hover:opacity-90 active:scale-98 transition-all shadow-lg shadow-blue-200">
                  <Sparkles size={16} /> Распознать модели с AI
                </button>
                <button onClick={() => { setFile(null); setStep(0); setError(""); }}
                  className="w-full flex items-center justify-center gap-2 bg-slate-100 text-slate-600 font-semibold py-2.5 rounded-2xl hover:bg-slate-200 transition-all text-sm">
                  <ChevronLeft size={14} /> Выбрать другой файл
                </button>
              </div>
            </div>
          )}

          {/* ═══ STEP 2: Processing ═══ */}
          {step === 2 && (
            <div className="p-6 flex flex-col items-center gap-6 py-12">
              <div className="relative">
                <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-blue-100 to-teal-100 flex items-center justify-center">
                  <Wind size={40} className="text-blue-500 animate-pulse" />
                </div>
                <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center">
                  <Loader2 size={14} className="text-white animate-spin" />
                </div>
              </div>
              <div className="text-center space-y-1">
                <p className="font-bold text-slate-800 text-lg">AI анализирует каталог…</p>
                <p className="text-sm text-slate-400">
                  {parseProgress
                    ? `Обработка файла: ${parseProgress.done} / ${parseProgress.total} частей`
                    : "AI распознаёт модели, BTU, технические параметры и цены"}
                </p>
              </div>
              <div className="flex gap-6 text-center">
                {["Читаем таблицу", "Разбиваем серии", "Парсим цены"].map((s, i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center ${i < 2 ? "bg-blue-100" : "bg-slate-100"}`}>
                      {i < 2 ? <Check size={12} className="text-blue-600" /> : <Loader2 size={12} className="text-slate-400 animate-spin" />}
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium">{s}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ STEP 3: Preview ═══ */}
          {step === 3 && (
            <div className="flex flex-col">
              {/* Toolbar */}
              <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-4 py-2.5 flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="sel-all-eq"
                    checked={selectedCount === items.length}
                    onChange={e => toggleAll(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-blue-600" />
                  <label htmlFor="sel-all-eq" className="text-xs font-semibold text-slate-600 cursor-pointer">Выбрать все</label>
                </div>
                <span className="text-[11px] text-slate-400">Выбрано {selectedCount} из {items.length}</span>
                <div className="ml-auto">
                  <button onClick={() => { setStep(1); setItems([]); setError(""); setParseWarning(""); }}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-all">
                    <RefreshCw size={11} /> Перезагрузить
                  </button>
                </div>
              </div>

              <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center gap-2">
                <Sparkles size={12} className="text-blue-500 flex-shrink-0" />
                <p className="text-[11px] text-blue-700">
                  AI распознал <strong>{items.length} моделей</strong> из <strong>{file?.name}</strong>. Проверьте и при необходимости скорректируйте данные. Цены и параметры можно изменить.
                </p>
              </div>
              {parseWarning.trim() && (
                <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 flex items-start gap-2">
                  <Info size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-800 whitespace-pre-wrap">
                    <strong>Часть чанков обработалась с предупреждениями</strong> (импорт продолжился). Детали:{" "}
                    {parseWarning}
                  </p>
                </div>
              )}

              {/* Cards */}
              <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3 pb-8">
                {items.map(item => {
                  const cfg = EQ_TYPE_CFG[item.type] ?? EQ_TYPE_CFG.split_ac;
                  const isEditing = editIdx === item._idx;
                  return (
                    <div key={item._idx}
                      className={`rounded-2xl border overflow-hidden transition-all ${
                        !item._selected ? "opacity-40 border-slate-200 bg-slate-50" :
                        item._status === "saved" ? "border-green-300 bg-green-50" :
                        item._status === "error" ? "border-red-300 bg-red-50" :
                        "border-slate-200 bg-white"
                      }`}>
                      {/* Card header */}
                      <div className="flex items-start gap-3 p-3 border-b border-slate-100">
                        <input type="checkbox" checked={item._selected}
                          onChange={e => update(item._idx, "_selected", e.target.checked)}
                          className="w-3.5 h-3.5 rounded accent-blue-600 mt-1 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <div className="flex gap-2">
                              <input value={item.brand} onChange={e => update(item._idx, "brand", e.target.value)}
                                placeholder="Бренд"
                                className="w-20 text-xs border border-blue-300 rounded px-1.5 py-0.5 outline-none" />
                              <input value={item.model} onChange={e => update(item._idx, "model", e.target.value)}
                                placeholder="Модель/Артикул"
                                className="flex-1 text-xs border border-blue-300 rounded px-1.5 py-0.5 outline-none" />
                            </div>
                          ) : (
                            <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{item.brand}</p>
                              <p className="font-bold text-slate-800 text-sm leading-tight truncate">{item.model}</p>
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <select value={item.type} onChange={e => update(item._idx, "type", e.target.value)}
                              className={`text-[9px] font-bold px-2 py-0.5 rounded-full border-0 outline-none cursor-pointer ${cfg.bg} ${cfg.color}`}>
                              {EQ_TYPES.map(t => <option key={t} value={t}>{EQ_TYPE_CFG[t].label}</option>)}
                            </select>
                            {item._status === "saved" && <CheckCircle2 size={13} className="text-green-500" />}
                            {item._status === "error" && (
                              <span title={item._error} className="inline-flex">
                                <AlertCircle size={13} className="text-red-400" />
                              </span>
                            )}
                          </div>
                        </div>
                        <button onClick={() => setEditIdx(isEditing ? null : item._idx)}
                          className={`p-1.5 rounded-lg transition-all flex-shrink-0 ${isEditing ? "bg-blue-100 text-blue-600" : "hover:bg-slate-100 text-slate-400 hover:text-blue-600"}`}>
                          <Edit3 size={12} />
                        </button>
                      </div>

                      {/* Specs grid */}
                      <div className="grid grid-cols-3 gap-0 divide-x divide-slate-100 border-b border-slate-100">
                        {/* BTU/кВт */}
                        <div className="p-2 text-center">
                          <p className="text-[9px] text-slate-400 font-semibold flex items-center justify-center gap-0.5">
                            <Zap size={8} /> BTU / кВт
                          </p>
                          {isEditing ? (
                            <input type="number" value={item.btu} onChange={e => update(item._idx, "btu", Number(e.target.value))}
                              className="w-full text-center text-xs font-bold text-blue-700 border-b border-blue-300 outline-none bg-transparent" />
                          ) : (
                            <p className="text-xs font-black text-blue-700">{Number(item.btu || 0).toLocaleString("ru-RU")}</p>
                          )}
                          <p className="text-[9px] text-slate-400">{Number(item.powerKw || 0)} кВт</p>
                        </div>

                        {/* Area */}
                        <div className="p-2 text-center">
                          <p className="text-[9px] text-slate-400 font-semibold flex items-center justify-center gap-0.5">
                            <AreaChart size={8} /> Площадь
                          </p>
                          <p className="text-xs font-black text-slate-700">{Number(item.areaMin || 0)}–{Number(item.areaMax || 0)}</p>
                          <p className="text-[9px] text-slate-400">м²</p>
                        </div>

                        {/* Price */}
                        <div className="p-2 text-center">
                          <p className="text-[9px] text-slate-400 font-semibold flex items-center justify-center gap-0.5">
                            <DollarSign size={8} /> Цена BYN
                          </p>
                          {isEditing ? (
                            <input type="number" value={item.price} step="0.01" onChange={e => update(item._idx, "price", Number(e.target.value))}
                              className="w-full text-center text-xs font-bold text-teal-700 border-b border-teal-300 outline-none bg-transparent" />
                          ) : (
                            <p className="text-xs font-black text-teal-700">
                              {item.price > 0 ? fmtShort(item.price) : <span className="text-orange-400">Не указана</span>}
                            </p>
                          )}
                          <p className="text-[9px] text-slate-400">{item.warranty} лет гарантии</p>
                        </div>
                      </div>

                      {/* Install params row */}
                      <div className="px-3 py-2 flex flex-wrap gap-1.5">
                        <span className="bg-slate-100 text-slate-600 text-[9px] font-semibold px-1.5 py-0.5 rounded-full">
                          {item.installParams.refrigerant}
                        </span>
                        <span className="bg-slate-100 text-slate-600 text-[9px] font-semibold px-1.5 py-0.5 rounded-full">
                          ж:{item.installParams.liquidPipeOd}
                        </span>
                        <span className="bg-slate-100 text-slate-600 text-[9px] font-semibold px-1.5 py-0.5 rounded-full">
                          г:{item.installParams.gasPipeOd}
                        </span>
                        <span className="bg-slate-100 text-slate-600 text-[9px] font-semibold px-1.5 py-0.5 rounded-full">
                          ↔{item.installParams.maxPipeLength}м
                        </span>
                        <span className="bg-slate-100 text-slate-600 text-[9px] font-semibold px-1.5 py-0.5 rounded-full">
                          ↕{item.installParams.maxHeightDiff}м
                        </span>
                        <span className="bg-slate-100 text-slate-600 text-[9px] font-semibold px-1.5 py-0.5 rounded-full">
                          {item.installParams.powerSupply} / {item.installParams.currentA}А
                        </span>
                      </div>

                      {/* Editable price row (always visible, prominent) */}
                      {!isEditing && item.price === 0 && (
                        <div className="px-3 pb-2">
                          <label className="text-[10px] text-orange-600 font-semibold block mb-1">Укажите цену BYN:</label>
                          <input type="number" min={0} step="1" placeholder="0.00"
                            onChange={e => update(item._idx, "price", Number(e.target.value))}
                            className="w-full border border-orange-300 rounded-lg px-2 py-1 text-sm font-bold text-teal-700 outline-none focus:ring-1 ring-orange-400 bg-orange-50" />
                        </div>
                      )}

                      {/* Notes */}
                      {item.installerNotes && (
                        <div className="px-3 pb-2">
                          <p className="text-[9px] text-slate-400 italic truncate">{item.installerNotes}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══ STEP 4: Done ═══ */}
          {step === 4 && (
            <div className="p-6 flex flex-col items-center gap-6 py-12">
              <div className="w-24 h-24 rounded-3xl bg-green-50 flex items-center justify-center">
                <CheckCircle2 size={44} className="text-green-500" />
              </div>
              <div className="text-center space-y-2">
                <p className="font-bold text-slate-800 text-xl">Импорт завершён!</p>
                <p className="text-slate-500 text-sm">
                  Добавлено <strong className="text-green-600">{items.filter(i => i._status === "saved").length}</strong> моделей оборудования
                </p>
                {items.filter(i => i._status === "error").length > 0 && (
                  <p className="text-orange-500 text-xs">{items.filter(i => i._status === "error").length} моделей не удалось добавить</p>
                )}
                {enriching && (
                  <p className="text-xs text-teal-700 mt-2">
                    AI-автозаполнение: {enriching.running ? "в процессе" : "готово"} {enriching.done} / {enriching.total}
                  </p>
                )}
                <p className="text-xs text-slate-400 mt-2">Если что-то не нашлось — откройте модель и нажмите “Спросить AI”.</p>
              </div>
              <button onClick={onClose}
                className="flex items-center gap-2 bg-blue-600 text-white font-bold px-6 py-3 rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200">
                <Check size={16} /> Закрыть и обновить каталог
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 3 && !importing && (
          <div className="border-t border-slate-100 px-6 py-4 bg-slate-50 flex items-center justify-between gap-4">
            <p className="text-xs text-slate-400">{selectedCount} моделей к импорту</p>
            <button onClick={runImport} disabled={selectedCount === 0}
              className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-teal-600 text-white font-bold px-5 py-2.5 rounded-xl hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-blue-200 disabled:opacity-40 disabled:cursor-not-allowed">
              <Wind size={15} /> Импортировать {selectedCount} моделей <ChevronRight size={14} />
            </button>
          </div>
        )}

        {importing && (
          <div className="border-t border-slate-100 px-6 py-4 bg-blue-50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-blue-700">Сохранение в каталог…</p>
              <p className="text-xs text-blue-500">{progress.done} / {progress.total}</p>
            </div>
            <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-teal-500 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
    </RightSideCard>
  );
}