import { useState, useRef, useCallback, useEffect } from "react";
import {
  X, Upload, Download, Sparkles, FileText, FileSpreadsheet,
  CheckCircle2, AlertCircle, Loader2, ChevronRight, ChevronLeft,
  Package, Check, Edit3, Trash2, RefreshCw, Info, File
} from "lucide-react";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { RightSideCard } from "./ui/RightSideCard";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH  = { Authorization: `Bearer ${publicAnonKey}` };
const JH  = { ...AH, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
interface ParsedItem {
  _idx: number;
  _selected: boolean;
  _status: "new" | "saving" | "saved" | "error";
  _error?: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: number;
  sku: string;
  supplier: string;
  notes: string;
  itemType: "consumable" | "assembly" | "equipment";
  availability?: "in_stock_warehouse" | "order_only";
}

const CATEGORIES = ["Трубопровод", "Дренаж", "Электрика", "Крепёж", "Расходники", "Фурнитура", "Оборудование", "Прочее"];
const UNITS = ["м", "шт", "кг", "компл", "рул", "уп", "л"];

// ─── Template CSV ─────────────────────────────────────────────────────────────
const TEMPLATE_CSV = `Название,Категория,Ед.изм.,Количество,Мин.остаток,Цена (BYN),Артикул,Поставщик,Примечание
Труба медная 6.35 мм (1/4"),Трубопровод,м,100,20,8.50,PIPE-14,МедьОпт,Жидкостная линия
Труба медная 9.53 мм (3/8"),Трубопровод,м,80,15,12.00,PIPE-38,МедьОпт,Газовая линия
Кабель ПВС 3x1.5 мм,Электрика,м,200,30,2.80,CABLE-15,,Питание кондиционера
Дренажный шланг 16 мм,Дренаж,м,150,25,1.20,DRAIN-16,,Отвод конденсата
Кронштейн монтажный 500 мм,Крепёж,шт,40,10,4.50,BRKT-500,,Для наружного блока
Фреон R32 10 кг,Расходники,кг,50,5,85.00,GAS-R32,,Хладагент
`;

function downloadTemplate() {
  const BOM = "\uFEFF"; // UTF-8 BOM for Excel compatibility
  const blob = new Blob([BOM + TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "warehouse_template.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ─── Category badge ───────────────────────────────────────────────────────────
const CAT_COLOR: Record<string, string> = {
  "Трубопровод": "bg-blue-100 text-blue-700",
  "Дренаж":      "bg-cyan-100 text-cyan-700",
  "Электрика":   "bg-amber-100 text-amber-700",
  "Крепёж":      "bg-slate-100 text-slate-600",
  "Расходники":  "bg-orange-100 text-orange-700",
  "Фурнитура":   "bg-violet-100 text-violet-700",
  "Оборудование":"bg-teal-100 text-teal-700",
  "Прочее":      "bg-gray-100 text-gray-600",
};

// ─── Step indicators ──────────────────────────────────────────────────────────
const STEPS = ["Источник", "Загрузка", "AI-анализ", "Предпросмотр", "Готово"] as const;

interface Props {
  onClose: () => void;
  onImported: (count: number) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
export function AiImportModal({ onClose, onImported }: Props) {
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [file, setFile]   = useState<File | null>(null);
  const [drag, setDrag]   = useState(false);
  const [error, setError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedCount = parsedItems.filter(i => i._selected).length;
  const savedCount    = parsedItems.filter(i => i._status === "saved").length;

  // ── File handling ──────────────────────────────────────────────────────────
  function acceptFile(f: File) {
    const name = f.name.toLowerCase();
    const ok = name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls")
             || name.endsWith(".pdf") || name.endsWith(".txt")
             || name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp");
    if (!ok) { setError("Поддерживаются: CSV, XLSX, XLS, PDF, TXT, PNG, JPG, WEBP"); return; }
    if (f.size > 10 * 1024 * 1024) { setError("Файл больше 10 МБ"); return; }
    setError("");
    setFile(f);
    setStep(1);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) acceptFile(f);
  }

  // ── AI parse ───────────────────────────────────────────────────────────────
  async function runParse() {
    if (!file) return;
    setStep(2); setParsing(true); setError("");
    try {
      async function fetchJsonWithRetry(url: string, init: RequestInit, maxAttempts = 5): Promise<any> {
        let lastErr: any = null;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const res = await fetch(url, init);
            const data = await res.json().catch(() => ({}));
            if (res.ok && !data?.error) return data;
            const retriable = res.status >= 500;
            if (!retriable || attempt === maxAttempts - 1) throw new Error(String(data?.error ?? `HTTP ${res.status}`));
            await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
          } catch (e: any) {
            lastErr = e;
            const m = String(e?.message ?? "").toLowerCase();
            const retriable = m.includes("failed to fetch") || m.includes("network") || m.includes("io_suspended");
            if (!retriable || attempt === maxAttempts - 1) throw e;
            await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
          }
        }
        throw lastErr ?? new Error("network error");
      }

      const fd = new FormData();
      fd.append("file", file);
      const data = await fetchJsonWithRetry(`${API}/warehouse/ai-import`, { method: "POST", headers: AH, body: fd }, 5);
      if (data.chunked && data.jobId) {
        const jobId = String(data.jobId);
        let finalItems: any[] = [];
        let total = Number(data.totalChunks ?? 0) || 0;
        const started = Date.now();
        for (let guard = 0; guard < 2000; guard++) {
          const stepData = await fetchJsonWithRetry(
            `${API}/warehouse/ai-import/step`,
            { method: "POST", headers: JH, body: JSON.stringify({ jobId }) },
            5,
          );
          total = Number(stepData.totalChunks ?? total) || total;
          if (stepData.done) {
            finalItems = stepData.items ?? [];
            break;
          }
          if (Date.now() - started > 30 * 60 * 1000) throw new Error("Импорт склада занимает слишком много времени. Попробуйте ещё раз.");
          await new Promise(r => setTimeout(r, 350));
        }
        const items: ParsedItem[] = (finalItems ?? []).map((item: any, idx: number) => ({
          ...item,
          _idx: idx,
          _selected: true,
          _status: "new" as const,
        }));
        if (!items.length) throw new Error("AI не нашёл позиций. Проверьте содержимое файла.");
        setParsedItems(items);
        setStep(3);
      } else {
        const items: ParsedItem[] = (data.items ?? []).map((item: any, idx: number) => ({
          ...item,
          _idx: idx,
          _selected: true,
          _status: "new" as const,
        }));
        if (!items.length) throw new Error("AI не нашёл позиций. Проверьте содержимое файла.");
        setParsedItems(items);
        setStep(3);
      }
    } catch (e: any) {
      setError(e.message);
      setStep(1);
    } finally {
      setParsing(false);
    }
  }

  // ── Import ─────────────────────────────────────────────────────────────────
  async function runImport() {
    const toImport = parsedItems.filter(i => i._selected && i._status === "new");
    if (!toImport.length) return;
    setImporting(true);
    setImportProgress({ done: 0, total: toImport.length });

    let done = 0;
    for (const item of toImport) {
      try {
        const { _idx, _selected, _status, _error, ...body } = item;
        // If AI marked item as "order_only" - keep stock=0 and annotate notes for clarity.
        if ((body as any).availability === "order_only") {
          body.stock = 0;
          body.notes = String(body.notes ?? "").includes("Под заказ")
            ? body.notes
            : `${String(body.notes ?? "").trim()}${body.notes ? "\n" : ""}Под заказ`.trim();
        }
        delete (body as any).availability;
        const res = await fetch(`${API}/warehouse`, { method: "POST", headers: JH, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setParsedItems(prev => prev.map(i => i._idx === _idx ? { ...i, _status: "saved" } : i));
      } catch (e: any) {
        setParsedItems(prev => prev.map(i => i._idx === item._idx ? { ...i, _status: "error", _error: e.message } : i));
      }
      done++;
      setImportProgress({ done, total: toImport.length });
      await new Promise(r => setTimeout(r, 80)); // small delay for UX
    }

    setImporting(false);
    const finalSaved = parsedItems.filter(i => i._status === "saved").length + done;
    onImported(finalSaved);
    setStep(4);
  }

  // ── Inline edit helpers ────────────────────────────────────────────────────
  function updateItem(idx: number, field: keyof ParsedItem, value: any) {
    setParsedItems(prev => prev.map(i => i._idx === idx ? { ...i, [field]: value } : i));
  }

  function toggleAll(val: boolean) {
    setParsedItems(prev => prev.map(i => ({ ...i, _selected: val })));
  }

  const pct = importProgress.total > 0 ? Math.round((importProgress.done / importProgress.total) * 100) : 0;

  // ── Render ─────────────────────────────────────────────────────────────────
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

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-violet-600 to-indigo-600">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-white text-base">Наполнить склад с AI</h2>
              <p className="text-violet-200 text-xs">Загрузите каталог — AI распознает все позиции</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/20 text-white/70 hover:text-white transition-all">
            <X size={18} />
          </button>
        </div>

        {/* ── Step indicator ── */}
        <div className="flex px-6 py-3 bg-slate-50 border-b border-slate-100 gap-1">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div className={`flex items-center gap-1.5 ${i <= step ? "text-violet-700" : "text-slate-300"}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black transition-all ${
                  i < step ? "bg-violet-600 text-white" :
                  i === step ? "bg-violet-100 text-violet-700 ring-2 ring-violet-400" :
                  "bg-slate-200 text-slate-400"
                }`}>
                  {i < step ? <Check size={10} /> : i + 1}
                </div>
                <span className="text-[10px] font-semibold whitespace-nowrap hidden sm:block">{s}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 rounded-full transition-all ${i < step ? "bg-violet-400" : "bg-slate-200"}`} />
              )}
            </div>
          ))}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto">

          {/* ═══ STEP 0: Choose source ══════════════════════════════════════ */}
          {step === 0 && (
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-500 text-center mb-6">
                Выберите способ загрузки каталога
              </p>

              {/* Template download */}
              <div className="border-2 border-dashed border-violet-200 rounded-2xl p-5 bg-violet-50 hover:bg-violet-100 transition-all cursor-pointer group"
                onClick={downloadTemplate}>
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-violet-100 group-hover:bg-violet-200 flex items-center justify-center flex-shrink-0 transition-all">
                    <Download size={22} className="text-violet-600" />
                  </div>
                  <div>
                    <p className="font-bold text-violet-800 text-sm">Скачать шаблон CSV</p>
                    <p className="text-xs text-violet-600 mt-1">Готовый шаблон с правильными колонками — заполните и загрузите обратно. Минимальный процент ошибок.</p>
                    <div className="flex gap-2 mt-2">
                      {["Название", "Категория", "Цена", "Кол-во", "Артикул"].map(col => (
                        <span key={col} className="bg-white text-violet-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-violet-200">{col}</span>
                      ))}
                      <span className="text-[9px] text-violet-400">и др.</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Upload */}
              <div
                className={`border-2 border-dashed rounded-2xl p-5 transition-all cursor-pointer ${
                  drag ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                }`}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.pdf,.txt"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) acceptFile(f); }}
                />
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${drag ? "bg-indigo-100" : "bg-slate-100"}`}>
                    <Upload size={22} className={drag ? "text-indigo-600" : "text-slate-500"} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-700 text-sm">Загрузить свой каталог</p>
                    <p className="text-xs text-slate-500 mt-1">Перетащите файл или нажмите для выбора. AI распознает данные автоматически.</p>
                    <div className="flex gap-2 mt-2.5">
                      {[
                        { ext: "CSV", icon: <FileText size={10} />, color: "bg-green-100 text-green-700" },
                        { ext: "XLSX", icon: <FileSpreadsheet size={10} />, color: "bg-emerald-100 text-emerald-700" },
                        { ext: "PDF", icon: <File size={10} />, color: "bg-red-100 text-red-700" },
                        { ext: "TXT", icon: <FileText size={10} />, color: "bg-slate-100 text-slate-600" },
                      ].map(f => (
                        <span key={f.ext} className={`flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full ${f.color}`}>
                          {f.icon} {f.ext}
                        </span>
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

              <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl p-3">
                <Info size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-blue-600">
                  <strong>Совет:</strong> Для лучшего результата используйте шаблон. Но AI справится и с произвольным прайс-листом — даже если там нет чётких колонок. Часть полей может остаться незаполненной, их можно отредактировать в предпросмотре.
                </p>
              </div>
            </div>
          )}

          {/* ═══ STEP 1: File selected ═══════════════════════════════════════ */}
          {step === 1 && file && (
            <div className="p-6 flex flex-col items-center gap-6">
              <div className="w-20 h-20 rounded-3xl bg-indigo-50 flex items-center justify-center">
                <FileText size={36} className="text-indigo-500" />
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
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-bold py-3 rounded-2xl hover:opacity-90 active:scale-98 transition-all shadow-lg shadow-violet-200">
                  <Sparkles size={16} /> Анализировать с AI
                </button>
                <button onClick={() => { setFile(null); setStep(0); setError(""); }}
                  className="w-full flex items-center justify-center gap-2 bg-slate-100 text-slate-600 font-semibold py-2.5 rounded-2xl hover:bg-slate-200 transition-all text-sm">
                  <ChevronLeft size={14} /> Выбрать другой файл
                </button>
              </div>
            </div>
          )}

          {/* ═══ STEP 2: AI Processing ══════════════════════════════════════ */}
          {step === 2 && (
            <div className="p-6 flex flex-col items-center gap-6 py-12">
              <div className="relative">
                <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center">
                  <Sparkles size={40} className="text-violet-500 animate-pulse" />
                </div>
                <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center">
                  <Loader2 size={14} className="text-white animate-spin" />
                </div>
              </div>
              <div className="text-center space-y-1">
                <p className="font-bold text-slate-800 text-lg">AI анализирует файл…</p>
                <p className="text-sm text-slate-400">GPT-4o распознаёт позиции, категории и характеристики</p>
              </div>
              <div className="flex gap-6 text-center">
                {[
                  { label: "Читаем файл", done: true },
                  { label: "Парсим структуру", done: true },
                  { label: "Классифицируем", done: false },
                ].map((s, i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center ${s.done ? "bg-violet-100" : "bg-slate-100"}`}>
                      {s.done ? <Check size={12} className="text-violet-600" /> : <Loader2 size={12} className="text-slate-400 animate-spin" />}
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ STEP 3: Preview ════════════════════════════════════════════ */}
          {step === 3 && (
            <div className="flex flex-col">
              {/* Preview toolbar */}
              <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-4 py-2.5 flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="sel-all"
                    checked={selectedCount === parsedItems.length}
                    onChange={e => toggleAll(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-violet-600" />
                  <label htmlFor="sel-all" className="text-xs font-semibold text-slate-600 cursor-pointer">
                    Выбрать все
                  </label>
                </div>
                <span className="text-[11px] text-slate-400">
                  Выбрано {selectedCount} из {parsedItems.length}
                </span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => { setStep(1); setParsedItems([]); setError(""); }}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-all">
                    <RefreshCw size={11} /> Перезагрузить
                  </button>
                </div>
              </div>

              {/* AI info */}
              <div className="bg-violet-50 border-b border-violet-100 px-4 py-2 flex items-center gap-2">
                <Sparkles size={12} className="text-violet-500 flex-shrink-0" />
                <p className="text-[11px] text-violet-700">
                  AI распознал <strong>{parsedItems.length} позиций</strong> из <strong>{file?.name}</strong>. Проверьте данные перед импортом — при необходимости отредактируйте или снимите галочку.
                </p>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="w-8 p-2"></th>
                      <th className="p-2 text-left font-semibold text-slate-500 min-w-[180px]">Название</th>
                      <th className="p-2 text-left font-semibold text-slate-500 w-[110px]">Категория</th>
                      <th className="p-2 text-center font-semibold text-slate-500 w-16">Ед.</th>
                      <th className="p-2 text-center font-semibold text-slate-500 w-16">Кол-во</th>
                      <th className="p-2 text-center font-semibold text-slate-500 w-16">Мин.</th>
                      <th className="p-2 text-center font-semibold text-slate-500 w-20">Цена</th>
                      <th className="p-2 text-left font-semibold text-slate-500 w-20">Артикул</th>
                      <th className="p-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedItems.map(item => (
                      <tr key={item._idx}
                        className={`border-b border-slate-50 transition-all ${
                          !item._selected ? "opacity-40" :
                          item._status === "saved" ? "bg-green-50" :
                          item._status === "error" ? "bg-red-50" : "hover:bg-slate-50"
                        }`}>
                        {/* Checkbox */}
                        <td className="p-2 text-center">
                          {item._status === "saved" ? (
                            <CheckCircle2 size={14} className="text-green-500 mx-auto" />
                          ) : item._status === "error" ? (
                            <AlertCircle size={14} className="text-red-400 mx-auto" />
                          ) : (
                            <input type="checkbox" checked={item._selected}
                              onChange={e => updateItem(item._idx, "_selected", e.target.checked)}
                              className="w-3.5 h-3.5 rounded accent-violet-600" />
                          )}
                        </td>

                        {/* Name */}
                        <td className="p-2">
                          {editIdx === item._idx ? (
                            <input
                              autoFocus
                              value={item.name}
                              onChange={e => updateItem(item._idx, "name", e.target.value)}
                              onBlur={() => setEditIdx(null)}
                              className="w-full border border-violet-300 rounded-lg px-2 py-0.5 text-xs outline-none focus:ring-1 ring-violet-400"
                            />
                          ) : (
                            <span className="font-medium text-slate-800 line-clamp-2">{item.name}</span>
                          )}
                          {item._error && <p className="text-[9px] text-red-500 mt-0.5">{item._error}</p>}
                        </td>

                        {/* Category */}
                        <td className="p-2">
                          <select value={item.category}
                            onChange={e => updateItem(item._idx, "category", e.target.value)}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-0 outline-none cursor-pointer ${CAT_COLOR[item.category] ?? "bg-gray-100 text-gray-600"}`}>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>

                        {/* Unit */}
                        <td className="p-2 text-center">
                          <select value={item.unit}
                            onChange={e => updateItem(item._idx, "unit", e.target.value)}
                            className="bg-transparent text-xs text-slate-600 outline-none cursor-pointer text-center">
                            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>

                        {/* Stock */}
                        <td className="p-2 text-center">
                          <input type="number" min={0} value={item.stock}
                            onChange={e => updateItem(item._idx, "stock", Number(e.target.value))}
                            className="w-12 text-center bg-transparent text-xs text-slate-700 outline-none border-b border-transparent hover:border-slate-300 focus:border-violet-400 transition-all" />
                        </td>

                        {/* MinStock */}
                        <td className="p-2 text-center">
                          <input type="number" min={0} value={item.minStock}
                            onChange={e => updateItem(item._idx, "minStock", Number(e.target.value))}
                            className="w-12 text-center bg-transparent text-xs text-slate-500 outline-none border-b border-transparent hover:border-slate-300 focus:border-violet-400 transition-all" />
                        </td>

                        {/* Price */}
                        <td className="p-2 text-center">
                          <input type="number" min={0} step="0.01" value={item.price}
                            onChange={e => updateItem(item._idx, "price", Number(e.target.value))}
                            className="w-16 text-center bg-transparent text-xs font-semibold text-teal-700 outline-none border-b border-transparent hover:border-slate-300 focus:border-violet-400 transition-all" />
                        </td>

                        {/* SKU */}
                        <td className="p-2">
                          <span className="text-[10px] text-slate-400 font-mono">{item.sku}</span>
                        </td>

                        {/* Edit */}
                        <td className="p-2">
                          <button onClick={() => setEditIdx(editIdx === item._idx ? null : item._idx)}
                            className="p-1 hover:bg-slate-100 rounded-lg transition-all text-slate-400 hover:text-violet-600">
                            <Edit3 size={11} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ STEP 4: Done ═══════════════════════════════════════════════ */}
          {step === 4 && (
            <div className="p-6 flex flex-col items-center gap-6 py-12">
              <div className="w-24 h-24 rounded-3xl bg-green-50 flex items-center justify-center">
                <CheckCircle2 size={44} className="text-green-500" />
              </div>
              <div className="text-center space-y-2">
                <p className="font-bold text-slate-800 text-xl">Импорт завершён!</p>
                <p className="text-slate-500 text-sm">
                  Добавлено <strong className="text-green-600">{parsedItems.filter(i => i._status === "saved").length}</strong> позиций на склад
                </p>
                {parsedItems.filter(i => i._status === "error").length > 0 && (
                  <p className="text-orange-500 text-xs">
                    {parsedItems.filter(i => i._status === "error").length} позиций не удалось добавить
                  </p>
                )}
              </div>
              <button onClick={onClose}
                className="flex items-center gap-2 bg-green-600 text-white font-bold px-6 py-3 rounded-2xl hover:bg-green-700 transition-all shadow-lg shadow-green-200">
                <Check size={16} /> Закрыть и обновить склад
              </button>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {(step === 3 && !importing) && (
          <div className="border-t border-slate-100 px-6 py-4 bg-slate-50 flex items-center justify-between gap-4">
            <p className="text-xs text-slate-400">
              {selectedCount} позиций к импорту · {parsedItems.length - selectedCount} пропускается
            </p>
            <button
              onClick={runImport}
              disabled={selectedCount === 0}
              className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-bold px-5 py-2.5 rounded-xl hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-violet-200 disabled:opacity-40 disabled:cursor-not-allowed">
              <Package size={15} /> Импортировать {selectedCount} позиций <ChevronRight size={14} />
            </button>
          </div>
        )}

        {/* Import progress bar */}
        {importing && (
          <div className="border-t border-slate-100 px-6 py-4 bg-violet-50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-violet-700">Сохранение на склад…</p>
              <p className="text-xs text-violet-500">{importProgress.done} / {importProgress.total}</p>
            </div>
            <div className="h-2 bg-violet-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </RightSideCard>
  );
}
