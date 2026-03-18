import React, { useState, useRef, useEffect, useCallback, DragEvent } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
interface DuctSegment {
  id: string; type: "round" | "rectangular";
  diameter?: number; width?: number; height?: number;
  length: number;
  material: "galvanized" | "flexible" | "plastic" | "stainless" | "unknown";
  section: "supply" | "exhaust" | "recirculation" | "unknown";
  label?: string;
}
interface VentNode {
  id: string; type: string; quantity: number;
  diameter?: number; width?: number; height?: number; description?: string;
}
interface VentSystem { type: string; floors?: number; zones?: string[]; }
interface VentSummary {
  totalDuctLength: number; totalDuctArea: number;
  ductsByDiameter: Record<string, number>;
  ductsBySection: Record<string, number>; totalNodes: number;
}
interface VentMaterial { id: string; name: string; category: string; unit: string; qty: number; pricePerUnit: number; total: number; }
interface VentAnalysis {
  analysisId: string; sourceFileName: string; fileType: "image" | "pdf";
  analyzedAt: string; ducts: DuctSegment[]; nodes: VentNode[];
  system: VentSystem; summary: VentSummary; materials: VentMaterial[];
  totalMaterials: number; workCost: number; grandTotal: number;
  confidence: "high" | "medium" | "low"; confidenceReason?: string;
  notes?: string; rawAnalysis?: string; generatedAt: string;
}
interface ListItem {
  analysisId: string; sourceFileName: string; fileType: "image" | "pdf";
  analyzedAt: string; confidence: string; totalMaterials: number;
  grandTotal: number; ductsCount: number; nodesCount: number;
  summary: VentSummary;
}

type Step = "idle" | "uploading" | "analyzing" | "done" | "error";
type ResTab = "overview" | "ducts" | "nodes" | "estimate" | "json";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString("ru-RU");
const fmtDate = (s: string) => new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const SECTION_CFG: Record<string, { label: string; color: string }> = {
  supply:        { label: "Приток",        color: "text-blue-700 bg-blue-50 border-blue-200" },
  exhaust:       { label: "Вытяжка",       color: "text-red-700 bg-red-50 border-red-200" },
  recirculation: { label: "Рециркул.",     color: "text-violet-700 bg-violet-50 border-violet-200" },
  unknown:       { label: "Неизвестно",    color: "text-slate-600 bg-slate-50 border-slate-200" },
};
const MAT_CFG: Record<string, string> = {
  galvanized: "Оцинк. сталь", flexible: "Гибкий", plastic: "Пластик",
  stainless: "Нерж. сталь", unknown: "Неизвестно",
};
const NODE_TYPE_LABEL: Record<string, string> = {
  tee: "Тройник", elbow_90: "Отвод 90°", elbow_45: "Отвод 45°",
  reducer: "Переход", diffuser: "Диффузор", grille: "Решётка",
  damper: "Клапан", fan: "Вентилятор", filter: "Фильтр",
  flexible_insert: "Гибкая вставка", other: "Другое",
};
const SYS_TYPE_LABEL: Record<string, string> = {
  supply: "Приточная", exhaust: "Вытяжная", supply_exhaust: "Приточно-вытяжная",
  recirculation: "Рециркуляционная", unknown: "Неизвестная",
};
const CONF_CFG = {
  high:   { label: "Высокая",  cls: "bg-green-100 text-green-700 border-green-200",  dot: "bg-green-500" },
  medium: { label: "Средняя",  cls: "bg-amber-100 text-amber-700 border-amber-200",  dot: "bg-amber-500" },
  low:    { label: "Низкая",   cls: "bg-red-100 text-red-700 border-red-200",         dot: "bg-red-500" },
};

const ACCEPT = ".pdf,image/png,image/jpeg,image/webp,image/gif";

// ─── Progress steps ───────────────────────────────────────────────────────────
const STEPS = [
  { icon: "📤", label: "Загрузка файла" },
  { icon: "🤖", label: "AI анализ чертежа" },
  { icon: "📐", label: "Расчёт материалов" },
  { icon: "✅", label: "Готово!" },
];

// ─── Main component ───────────────────────────────────────────────────────────
export function VentilationAnalyzer() {
  const [step, setStep]             = useState<Step>("idle");
  const [progress, setProgress]     = useState(0); // 0-3
  const [analysis, setAnalysis]     = useState<VentAnalysis | null>(null);
  const [history, setHistory]       = useState<ListItem[]>([]);
  const [resTab, setResTab]         = useState<ResTab>("overview");
  const [dragOver, setDragOver]     = useState(false);
  const [preview, setPreview]       = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [editedMats, setEditedMats] = useState<VentMaterial[]>([]);
  const [workCost, setWorkCost]     = useState(0);
  const [saving, setSaving]         = useState(false);
  const [errorMsg, setErrorMsg]     = useState("");
  const [toast, setToast]           = useState<string | null>(null);
  const [jsonExpanded, setJsonExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); }, []);

  // Load history
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API}/ventilation/analyses`, { headers: AH });
      const data = await res.json();
      if (data.analyses) setHistory(data.analyses);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // File selection
  function pickFile(file: File) {
    setSelectedFile(file);
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreview(url);
    } else {
      setPreview(null);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  }

  // Upload & analyze
  async function analyze() {
    if (!selectedFile) return;
    setStep("uploading"); setProgress(0); setErrorMsg("");
    try {
      // Step 1: uploading
      const fd = new FormData();
      fd.append("file", selectedFile);
      await new Promise(r => setTimeout(r, 300));
      setProgress(1); setStep("analyzing");

      // Step 2: AI analyzing
      const res = await fetch(`${API}/ventilation/analyze`, {
        method: "POST",
        headers: AH,
        body: fd,
      });
      setProgress(2);
      await new Promise(r => setTimeout(r, 200));

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      // Step 3: processing
      setProgress(3);
      await new Promise(r => setTimeout(r, 300));

      setAnalysis(data.analysis);
      setEditedMats(data.analysis.materials ?? []);
      setWorkCost(data.analysis.workCost ?? 0);
      setStep("done");
      setResTab("overview");
      loadHistory();
    } catch (e: any) {
      setErrorMsg(e.message ?? "Неизвестная ошибка");
      setStep("error");
    }
  }

  async function loadAnalysis(id: string) {
    try {
      const res = await fetch(`${API}/ventilation/analyses/${id}`, { headers: AH });
      const data = await res.json();
      if (data.analysis) {
        setAnalysis(data.analysis);
        setEditedMats(data.analysis.materials ?? []);
        setWorkCost(data.analysis.workCost ?? 0);
        setStep("done");
        setResTab("overview");
      }
    } catch (e: any) { showToast("Ошибка загрузки: " + e.message); }
  }

  async function deleteAnalysis(id: string) {
    await fetch(`${API}/ventilation/analyses/${id}`, { method: "DELETE", headers: AH });
    if (analysis?.analysisId === id) { setAnalysis(null); setStep("idle"); }
    loadHistory();
    showToast("Анализ удалён");
  }

  async function savePrices() {
    if (!analysis) return;
    setSaving(true);
    const mats = editedMats.map(m => ({ ...m, total: Math.round(m.qty * m.pricePerUnit) }));
    try {
      const res = await fetch(`${API}/ventilation/analyses/${analysis.analysisId}`, {
        method: "PATCH", headers: JH,
        body: JSON.stringify({ materials: mats, workCost }),
      });
      const data = await res.json();
      if (data.analysis) {
        setAnalysis(data.analysis);
        setEditedMats(data.analysis.materials);
        showToast("💾 Смета сохранена!");
      } else showToast(data.error ?? "Ошибка сохранения");
    } catch (e: any) { showToast(e.message); }
    finally { setSaving(false); }
  }

  function copyJson() {
    if (!analysis) return;
    const { rawAnalysis: _, ...clean } = analysis;
    navigator.clipboard.writeText(JSON.stringify(clean, null, 2));
    showToast("📋 JSON скопировано!");
  }

  function reset() {
    setStep("idle"); setAnalysis(null); setSelectedFile(null);
    setPreview(null); setErrorMsg(""); setProgress(0);
  }

  const totalEstimate = editedMats.reduce((s, m) => s + Math.round(m.qty * m.pricePerUnit), 0) + workCost;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">

      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-cyan-900 via-teal-800 to-cyan-700 text-white px-4 pt-8 pb-4 flex-shrink-0 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-black tracking-tight">🌬️ AI Анализ Вентиляции</h1>
            <p className="text-cyan-300 text-sm mt-0.5">Загрузите PDF или фото чертежа</p>
          </div>
          {step === "done" && (
            <button onClick={reset} className="bg-teal-700/60 rounded-xl px-3 py-2 text-sm font-bold active:scale-90">
              + Новый
            </button>
          )}
        </div>
        {analysis && step === "done" && (
          <div className="grid grid-cols-3 gap-2 mt-2">
            {[
              { l: "Воздуховоды", v: `${analysis.summary.totalDuctLength.toFixed(1)} м` },
              { l: "Узлов",       v: String(analysis.summary.totalNodes) },
              { l: "Смета",       v: `${fmt(analysis.grandTotal)} ₴` },
            ].map(s => (
              <div key={s.l} className="bg-teal-800/50 rounded-xl px-2 py-2 text-center">
                <p className="text-white font-black text-sm leading-none">{s.v}</p>
                <p className="text-white/60 text-[10px] mt-0.5">{s.l}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">

        {/* ════ IDLE ════════════════════════════════════════════════════════ */}
        {(step === "idle" || step === "error") && (
          <div className="px-4 pt-4 pb-8 space-y-4">
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-3xl transition-all cursor-pointer overflow-hidden ${
                dragOver ? "border-teal-500 bg-teal-50 scale-[1.01]" : "border-slate-300 bg-white"
              }`}>
              <input ref={inputRef} type="file" accept={ACCEPT} className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); }} />

              {preview ? (
                <div className="relative">
                  <img src={preview} alt="preview" className="w-full max-h-48 object-contain bg-slate-50" />
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-4 py-3">
                    <p className="text-white text-sm font-bold truncate">{selectedFile?.name}</p>
                    <p className="text-white/70 text-xs">{((selectedFile?.size ?? 0) / 1024 / 1024).toFixed(2)} МБ</p>
                  </div>
                </div>
              ) : selectedFile ? (
                <div className="flex items-center gap-4 px-5 py-6">
                  <div className="w-14 h-14 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0">📄</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 truncate">{selectedFile.name}</p>
                    <p className="text-sm text-slate-400">PDF · {((selectedFile.size) / 1024 / 1024).toFixed(2)} МБ</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center py-10 px-6 text-center">
                  <div className="w-16 h-16 bg-gradient-to-br from-cyan-100 to-teal-100 rounded-3xl flex items-center justify-center text-3xl mb-3 shadow-sm">
                    📐
                  </div>
                  <p className="font-black text-slate-700 text-base">Загрузите чертёж вентиляции</p>
                  <p className="text-sm text-slate-400 mt-1">PDF или изображение (PNG, JPG, WEBP)</p>
                  <div className="flex items-center gap-3 mt-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1">📄 PDF</span>
                    <span className="flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1">🖼️ PNG/JPG</span>
                    <span className="flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1">⬆️ до 20 МБ</span>
                  </div>
                  <p className="text-xs text-teal-600 font-semibold mt-3">Нажмите или перетащите файл</p>
                </div>
              )}
            </div>

            {/* Error */}
            {step === "error" && (
              <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                <p className="text-sm font-bold text-red-700">⚠️ Ошибка анализа</p>
                <p className="text-xs text-red-600 mt-1">{errorMsg}</p>
              </div>
            )}

            {/* Analyze button */}
            {selectedFile && (
              <button onClick={analyze}
                className="w-full bg-gradient-to-r from-cyan-700 to-teal-600 text-white rounded-2xl py-4 font-black text-base active:scale-95 shadow-lg shadow-teal-200 flex items-center justify-center gap-3">
                <span className="text-2xl">🤖</span>
                <div className="text-left">
                  <p className="font-black">Анализировать чертёж</p>
                  <p className="text-cyan-200 text-xs font-normal">GPT-4o Vision · автоматический расчёт</p>
                </div>
              </button>
            )}

            {/* How it works */}
            {!selectedFile && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Что извлекает AI</p>
                <div className="space-y-2.5">
                  {[
                    { icon: "🌀", title: "Воздуховоды", desc: "Длины (м), диаметры/размеры (мм), материал, секция" },
                    { icon: "🔩", title: "Узлы и фасонные изделия", desc: "Тройники, отводы, переходы, диффузоры, клапаны — с количествами" },
                    { icon: "📊", title: "Сводная спецификация", desc: "Авто-расчёт сметы с рыночными ценами" },
                    { icon: "📋", title: "ventilation_materials_json", desc: "Структурированный JSON готовый к интеграции" },
                  ].map((s, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-sm flex-shrink-0">{s.icon}</div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                        <p className="text-xs text-slate-400">{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* History */}
            {history.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Предыдущие анализы</p>
                <div className="space-y-2">
                  {history.map(h => (
                    <HistoryCard key={h.analysisId} item={h}
                      onOpen={() => loadAnalysis(h.analysisId)}
                      onDelete={() => deleteAnalysis(h.analysisId)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ UPLOADING / ANALYZING ══════════════════════════════════════ */}
        {(step === "uploading" || step === "analyzing") && (
          <div className="flex flex-col items-center justify-center px-8 py-16 gap-6">
            {/* Animated icon */}
            <div className="relative">
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-cyan-100 to-teal-100 flex items-center justify-center text-5xl animate-pulse shadow-xl shadow-teal-100">
                {progress === 0 ? "📤" : progress === 1 ? "🤖" : progress === 2 ? "📐" : "✅"}
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-teal-600 rounded-xl flex items-center justify-center">
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
            {/* Steps */}
            <div className="w-full space-y-2.5">
              {STEPS.map((s, i) => (
                <div key={i} className={`flex items-center gap-3 rounded-2xl px-4 py-3 border transition-all ${
                  i < progress ? "bg-teal-50 border-teal-200"
                  : i === progress ? "bg-white border-teal-400 shadow-sm"
                  : "bg-slate-50 border-slate-100"
                }`}>
                  <span className={`text-xl ${i < progress ? "opacity-100" : i === progress ? "animate-pulse" : "opacity-30"}`}>
                    {i < progress ? "✅" : s.icon}
                  </span>
                  <p className={`text-sm font-semibold ${
                    i === progress ? "text-teal-800" : i < progress ? "text-teal-600" : "text-slate-300"
                  }`}>{s.label}</p>
                  {i === progress && (
                    <div className="ml-auto flex gap-1">
                      {[0, 1, 2].map(d => (
                        <div key={d} className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce"
                          style={{ animationDelay: `${d * 0.15}s` }} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-sm text-slate-400 text-center">
              {progress === 1 ? "GPT-4o анализирует чертёж…\nЭто может занять 15–30 секунд" : "Пожалуйста, подождите…"}
            </p>
          </div>
        )}

        {/* ════ RESULTS ════════════════════════════════════════════════════ */}
        {step === "done" && analysis && (
          <div>
            {/* Result tabs */}
            <div className="bg-white border-b border-slate-100 flex overflow-x-auto flex-shrink-0 sticky top-0 z-10">
              {([
                { key: "overview", icon: "📊", label: "Обзор" },
                { key: "ducts",    icon: "🌀", label: "Воздуховоды" },
                { key: "nodes",    icon: "🔩", label: "Узлы" },
                { key: "estimate", icon: "💰", label: "Смета" },
                { key: "json",     icon: "📋", label: "JSON" },
              ] as { key: ResTab; icon: string; label: string }[]).map(t => (
                <button key={t.key} onClick={() => setResTab(t.key)}
                  className={`flex-shrink-0 px-4 py-2.5 text-[11px] font-bold flex flex-col items-center gap-0.5 border-b-2 transition-colors ${
                    resTab === t.key ? "text-teal-700 border-teal-600" : "text-slate-400 border-transparent"
                  }`}>
                  <span className="text-sm">{t.icon}</span>{t.label}
                </button>
              ))}
            </div>

            <div className="px-4 py-4 pb-8">

              {/* ── OVERVIEW ──────────────────────────────────────────── */}
              {resTab === "overview" && (
                <div className="space-y-3">
                  {/* File info */}
                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 bg-teal-50 border border-teal-100 rounded-2xl flex items-center justify-center text-2xl">
                        {analysis.fileType === "pdf" ? "📄" : "🖼️"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800 truncate">{analysis.sourceFileName}</p>
                        <p className="text-xs text-slate-400">{fmtDate(analysis.analyzedAt)}</p>
                      </div>
                      <ConfidenceBadge level={analysis.confidence} />
                    </div>
                    {analysis.confidenceReason && (
                      <p className="text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2">{analysis.confidenceReason}</p>
                    )}
                  </div>

                  {/* System type */}
                  <div className="bg-gradient-to-r from-cyan-50 to-teal-50 border border-teal-100 rounded-2xl p-4">
                    <p className="text-xs font-bold text-teal-600 uppercase tracking-widest mb-2">Тип системы</p>
                    <p className="text-lg font-black text-teal-900">{SYS_TYPE_LABEL[analysis.system.type] ?? analysis.system.type}</p>
                    {analysis.system.floors && analysis.system.floors > 1 && (
                      <p className="text-sm text-teal-700 mt-0.5">🏢 Этажей: {analysis.system.floors}</p>
                    )}
                    {(analysis.system.zones ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {analysis.system.zones!.map((z, i) => (
                          <span key={i} className="text-xs bg-teal-100 text-teal-700 rounded-lg px-2 py-0.5 font-medium">{z}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Key metrics */}
                  <div className="grid grid-cols-2 gap-2">
                    <MetricCard icon="📏" label="Длина воздуховодов" value={`${analysis.summary.totalDuctLength.toFixed(1)} м`} />
                    <MetricCard icon="🔩" label="Узлов и фасонных" value={String(analysis.summary.totalNodes)} />
                    <MetricCard icon="🌀" label="Участков воздуховодов" value={String(analysis.ducts.length)} />
                    <MetricCard icon="💰" label="Смета материалов" value={`${fmt(analysis.totalMaterials)} ₴`} accent />
                  </div>

                  {/* By diameter */}
                  {Object.keys(analysis.summary.ductsByDiameter).length > 0 && (
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Распределение по диаметрам</p>
                      {Object.entries(analysis.summary.ductsByDiameter)
                        .sort(([, a], [, b]) => b - a)
                        .map(([diam, len]) => {
                          const total = analysis.summary.totalDuctLength || 1;
                          const pct = Math.round((len as number) / total * 100);
                          return (
                            <div key={diam} className="mb-2.5 last:mb-0">
                              <div className="flex justify-between text-xs mb-1">
                                <span className="font-semibold text-slate-700">Ø{diam} мм</span>
                                <span className="text-slate-500">{(len as number).toFixed(1)} м · {pct}%</span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-2">
                                <div className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-teal-500" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}

                  {/* By section */}
                  {Object.keys(analysis.summary.ductsBySection).length > 0 && (
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Приток / Вытяжка</p>
                      <div className="space-y-2">
                        {Object.entries(analysis.summary.ductsBySection).map(([sec, len]) => {
                          const cfg = SECTION_CFG[sec] ?? SECTION_CFG.unknown;
                          return (
                            <div key={sec} className={`flex items-center justify-between rounded-xl border px-3 py-2 ${cfg.color}`}>
                              <span className="text-sm font-semibold">{cfg.label}</span>
                              <span className="text-sm font-black">{(len as number).toFixed(1)} м</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {analysis.notes && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                      <p className="text-xs font-bold text-amber-700 mb-1">💬 Заметки AI</p>
                      <p className="text-xs text-amber-800">{analysis.notes}</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── DUCTS ─────────────────────────────────────────────── */}
              {resTab === "ducts" && (
                <div className="space-y-2">
                  <div className="bg-teal-50 border border-teal-100 rounded-xl px-3 py-2 flex items-center justify-between">
                    <p className="text-xs font-bold text-teal-700">Всего участков: {analysis.ducts.length}</p>
                    <p className="text-xs font-black text-teal-800">{analysis.summary.totalDuctLength.toFixed(1)} м общая длина</p>
                  </div>
                  {analysis.ducts.length === 0 ? (
                    <EmptyState icon="🌀" text="Воздуховодов не найдено" sub="Попробуйте лучшее качество изображения" />
                  ) : (
                    analysis.ducts.map((d, i) => <DuctCard key={d.id} duct={d} index={i + 1} />)
                  )}
                </div>
              )}

              {/* ── NODES ─────────────────────────────────────────────── */}
              {resTab === "nodes" && (
                <div className="space-y-2">
                  <div className="bg-teal-50 border border-teal-100 rounded-xl px-3 py-2">
                    <p className="text-xs font-bold text-teal-700">Узлов и фасонных изделий: {analysis.summary.totalNodes}</p>
                  </div>
                  {analysis.nodes.length === 0 ? (
                    <EmptyState icon="🔩" text="Узлов не найдено" sub="Возможно, чертёж без деталей" />
                  ) : (
                    analysis.nodes.map((n, i) => <NodeCard key={n.id} node={n} index={i + 1} />)
                  )}
                </div>
              )}

              {/* ── ESTIMATE ──────────────────────────────────────────── */}
              {resTab === "estimate" && (
                <div className="space-y-3">
                  {/* Totals */}
                  <div className="bg-gradient-to-r from-teal-700 to-cyan-700 rounded-2xl p-4 text-white">
                    <p className="text-teal-200 text-xs font-semibold mb-2">Общая смета</p>
                    <p className="text-3xl font-black">{fmt(totalEstimate)} ₴</p>
                    <div className="flex items-center gap-4 mt-2 text-sm">
                      <span className="text-teal-200">Материалы: <b className="text-white">{fmt(editedMats.reduce((s, m) => s + Math.round(m.qty * m.pricePerUnit), 0))} ₴</b></span>
                      <span className="text-teal-200">Монтаж: <b className="text-white">{fmt(workCost)} ₴</b></span>
                    </div>
                  </div>

                  {/* Work cost */}
                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                    <label className="text-xs font-bold text-slate-500 block mb-2">💼 Стоимость монтажа (₴)</label>
                    <input type="number" value={workCost} min={0}
                      onChange={e => setWorkCost(Number(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-base font-black focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>

                  {/* Materials by category */}
                  {(() => {
                    const cats = [...new Set(editedMats.map(m => m.category))];
                    return cats.map(cat => (
                      <div key={cat} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-100">
                          <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">{cat}</p>
                        </div>
                        {editedMats.filter(m => m.category === cat).map((m, i, arr) => (
                          <div key={m.id} className={`px-4 py-3 ${i < arr.length - 1 ? "border-b border-slate-50" : ""}`}>
                            <p className="text-xs font-semibold text-slate-800 mb-2 leading-tight">{m.name}</p>
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <p className="text-[10px] text-slate-400 mb-0.5">Кол-во ({m.unit})</p>
                                <input type="number" value={m.qty} step={0.1} min={0}
                                  onChange={e => {
                                    const qty = parseFloat(e.target.value) || 0;
                                    setEditedMats(prev => prev.map(x => x.id === m.id ? { ...x, qty } : x));
                                  }}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-center focus:outline-none focus:ring-1 focus:ring-teal-400" />
                              </div>
                              <div className="flex-1">
                                <p className="text-[10px] text-slate-400 mb-0.5">Цена (₴/{m.unit})</p>
                                <input type="number" value={m.pricePerUnit} min={0}
                                  onChange={e => {
                                    const pricePerUnit = parseFloat(e.target.value) || 0;
                                    setEditedMats(prev => prev.map(x => x.id === m.id ? { ...x, pricePerUnit } : x));
                                  }}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-center focus:outline-none focus:ring-1 focus:ring-teal-400" />
                              </div>
                              <div className="text-right min-w-[70px]">
                                <p className="text-[10px] text-slate-400 mb-0.5">Сумма</p>
                                <p className="text-sm font-black text-teal-700">{fmt(Math.round(m.qty * m.pricePerUnit))} ₴</p>
                              </div>
                            </div>
                          </div>
                        ))}
                        <div className="bg-slate-50 px-4 py-2 flex justify-between">
                          <p className="text-xs text-slate-500">Итог по разделу</p>
                          <p className="text-xs font-black text-slate-700">
                            {fmt(editedMats.filter(m => m.category === cat).reduce((s, m) => s + Math.round(m.qty * m.pricePerUnit), 0))} ₴
                          </p>
                        </div>
                      </div>
                    ));
                  })()}

                  <button onClick={savePrices} disabled={saving}
                    className="w-full bg-teal-600 text-white rounded-2xl py-4 font-black text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2 shadow-md shadow-teal-200">
                    {saving ? "⏳ Сохранение..." : "💾 Сохранить смету"}
                  </button>
                </div>
              )}

              {/* ── JSON ──────────────────────────────────────────────── */}
              {resTab === "json" && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button onClick={copyJson}
                      className="flex-1 bg-teal-600 text-white rounded-xl py-3 text-sm font-bold active:scale-95 flex items-center justify-center gap-2">
                      📋 Копировать JSON
                    </button>
                    <button onClick={() => setJsonExpanded(v => !v)}
                      className="bg-slate-100 text-slate-700 rounded-xl px-4 py-3 text-sm font-bold active:scale-95">
                      {jsonExpanded ? "🔼" : "🔽"}
                    </button>
                  </div>

                  {/* Structured summary for quick reference */}
                  <div className="bg-slate-900 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">ventilation_materials_json</span>
                      <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${
                        analysis.confidence === "high" ? "bg-green-900 text-green-400" :
                        analysis.confidence === "medium" ? "bg-amber-900 text-amber-400" : "bg-red-900 text-red-400"
                      }`}>{analysis.confidence}</span>
                    </div>
                    <pre className={`text-[10px] text-green-400 font-mono p-4 overflow-x-auto leading-relaxed ${jsonExpanded ? "" : "max-h-96 overflow-y-auto"}`}>
                      {JSON.stringify(
                        (() => { const { rawAnalysis: _, ...clean } = analysis; return clean; })(),
                        null, 2
                      )}
                    </pre>
                  </div>

                  {/* Raw AI response */}
                  {analysis.rawAnalysis && (
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-100">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Исходный ответ AI</p>
                      </div>
                      <pre className="text-[10px] text-slate-600 p-4 overflow-x-auto max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                        {analysis.rawAnalysis.slice(0, 3000)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        )}
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-teal-700 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-semibold max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const cfg = CONF_CFG[level];
  return (
    <span className={`flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
    </span>
  );
}

function MetricCard({ icon, label, value, accent }: { icon: string; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3.5 shadow-sm ${accent ? "bg-teal-50 border-teal-200" : "bg-white border-slate-100"}`}>
      <p className="text-xl mb-1">{icon}</p>
      <p className={`text-base font-black leading-tight ${accent ? "text-teal-800" : "text-slate-800"}`}>{value}</p>
      <p className={`text-xs mt-0.5 ${accent ? "text-teal-600" : "text-slate-400"}`}>{label}</p>
    </div>
  );
}

function DuctCard({ duct: d, index }: { duct: DuctSegment; index: number }) {
  const sec = SECTION_CFG[d.section] ?? SECTION_CFG.unknown;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-cyan-50 border border-cyan-100 flex items-center justify-center text-sm font-black text-cyan-700 flex-shrink-0">
          {index}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="text-sm font-bold text-slate-800">
              {d.type === "round"
                ? `Ø${d.diameter ?? "?"} мм`
                : `${d.width ?? "?"}×${d.height ?? "?"} мм`}
            </p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sec.color}`}>{sec.label}</span>
            <span className="text-[10px] text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
              {MAT_CFG[d.material] ?? d.material}
            </span>
          </div>
          {d.label && <p className="text-xs text-slate-500 truncate">{d.label}</p>}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-lg font-black text-slate-800">{d.length.toFixed(1)}</p>
          <p className="text-[10px] text-slate-400">метров</p>
        </div>
      </div>
    </div>
  );
}

function NodeCard({ node: n, index }: { node: VentNode; index: number }) {
  const label = NODE_TYPE_LABEL[n.type] ?? n.type;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center text-sm font-black text-violet-700 flex-shrink-0">
          {index}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800">{label}</p>
          {n.diameter && <p className="text-xs text-slate-400">Ø{n.diameter} мм</p>}
          {n.width && !n.diameter && <p className="text-xs text-slate-400">{n.width}×{n.height} мм</p>}
          {n.description && <p className="text-xs text-slate-500 truncate mt-0.5">{n.description}</p>}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-2xl font-black text-slate-800">{n.quantity}</p>
          <p className="text-[10px] text-slate-400">шт</p>
        </div>
      </div>
    </div>
  );
}

function HistoryCard({ item: h, onOpen, onDelete }: { item: ListItem; onOpen: () => void; onDelete: () => void }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const conf = CONF_CFG[h.confidence as "high" | "medium" | "low"] ?? CONF_CFG.medium;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <button onClick={onOpen} className="w-full px-4 py-3 text-left active:bg-slate-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-teal-50 border border-teal-100 rounded-xl flex items-center justify-center text-lg flex-shrink-0">
            {h.fileType === "pdf" ? "📄" : "🖼️"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">{h.sourceFileName}</p>
            <p className="text-xs text-slate-400">{fmtDate(h.analyzedAt)}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-black text-teal-700">{fmt(h.grandTotal)} ₴</p>
            <div className="flex items-center gap-1 justify-end mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />
              <span className="text-[10px] text-slate-400">{h.ductsCount} сек. · {h.nodesCount} узлов</span>
            </div>
          </div>
        </div>
      </button>
      <div className="border-t border-slate-50 flex">
        <button onClick={onOpen} className="flex-1 py-2 text-xs text-teal-700 font-bold active:bg-teal-50">📂 Открыть</button>
        <div className="w-px bg-slate-100" />
        {!confirmDel
          ? <button onClick={() => setConfirmDel(true)} className="px-4 py-2 text-xs text-slate-400 font-bold active:bg-slate-50">🗑️</button>
          : <button onClick={onDelete} className="px-4 py-2 text-xs text-red-600 font-bold active:bg-red-50">Удалить?</button>
        }
      </div>
    </div>
  );
}

function EmptyState({ icon, text, sub }: { icon: string; text: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center py-10 text-slate-400 gap-2">
      <span className="text-4xl">{icon}</span>
      <p className="text-sm font-semibold">{text}</p>
      {sub && <p className="text-xs text-center text-slate-300">{sub}</p>}
    </div>
  );
}