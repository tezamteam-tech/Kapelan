import React, { useState, useEffect, useRef, useCallback } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { SignatureCanvas, SignatureCanvasHandle } from "./SignatureCanvas";
import { MaterialsPanel, MaterialsJson } from "./MaterialsPanel";

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AUTH_HEADERS = { Authorization: `Bearer ${publicAnonKey}` };
const JSON_HEADERS = { ...AUTH_HEADERS, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
type LeadStatus = "new" | "measurement" | "offer" | "deal" | "done";
type FilterTab = "measurement" | "new" | "all";

interface Lead {
  id: string;
  clientId: string;
  status: LeadStatus;
  requirements_json: {
    area?: number;
    roomType?: string;
    roomsCount?: number;
    preferences?: string[];
    budget?: number;
    additionalNotes?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
}

interface Measurement {
  id: string;
  leadId: string;
  traceLength: number;
  cable: string;
  drainage: string;
  workCost: number;
  notes: string;
  photos: string[];
  signature?: string | null;
  materials_json?: MaterialsJson | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CABLE_OPTIONS = [
  "3×1.5 мм² (стандарт)",
  "3×2.5 мм² (усиленный)",
  "4×1.5 мм²",
  "4×2.5 мм²",
  "5×1.5 мм²",
  "Другой",
];

const DRAINAGE_OPTIONS = [
  { value: "Самотёчный", icon: "🔽", desc: "Гравитационный отвод" },
  { value: "Принудительный (с насосом)", icon: "⚡", desc: "Дренажный насос" },
  { value: "Без дренажа", icon: "🚫", desc: "Не требуется" },
];

const STATUS_CONFIG: Record<LeadStatus, { label: string; bg: string; text: string; dot: string }> = {
  new:         { label: "Новый",     bg: "bg-blue-100",   text: "text-blue-700",   dot: "bg-blue-400" },
  measurement: { label: "Замер",     bg: "bg-amber-100",  text: "text-amber-700",  dot: "bg-amber-400" },
  offer:       { label: "КП",        bg: "bg-purple-100", text: "text-purple-700", dot: "bg-purple-400" },
  deal:        { label: "Сделка",    bg: "bg-green-100",  text: "text-green-700",  dot: "bg-green-400" },
  done:        { label: "Выполнено", bg: "bg-slate-100",  text: "text-slate-500",  dot: "bg-slate-400" },
};

// ─── StatusBadge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as LeadStatus] ?? STATUS_CONFIG.new;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function InstallerView() {
  const [screen, setScreen] = useState<"list" | "form">("list");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Record<string, Client>>({});
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [existingMeasurement, setExistingMeasurement] = useState<Measurement | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("measurement");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [traceLength, setTraceLength] = useState("");
  const [cable, setCable] = useState(CABLE_OPTIONS[0]);
  const [drainage, setDrainage] = useState(DRAINAGE_OPTIONS[0].value);
  const [workCost, setWorkCost] = useState("");
  const [notes, setNotes] = useState("");
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [newPreviews, setNewPreviews] = useState<string[]>([]);
  const [savedPhotoUrls, setSavedPhotoUrls] = useState<string[]>([]);
  const [hasSignature, setHasSignature] = useState(false);
  const [existingSignatureUrl, setExistingSignatureUrl] = useState<string | undefined>(undefined);
  // Materials computed by server after save
  const [savedMaterials, setSavedMaterials] = useState<MaterialsJson | null>(null);

  const [toastMsg, setToastMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const signatureRef = useRef<SignatureCanvasHandle>(null);

  // ─ Toast helper ─
  const showToast = useCallback((text: string, ok = true) => {
    setToastMsg({ text, ok });
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  // ─ Fetch leads ─
  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/leads`, { headers: AUTH_HEADERS });
      const data = await res.json();
      if (data.leads) {
        setLeads(data.leads);
        const ids = [...new Set<string>(data.leads.map((l: Lead) => l.clientId))];
        ids.forEach(fetchClient);
      }
    } catch {
      showToast("Ошибка загрузки заявок", false);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  async function fetchClient(clientId: string) {
    try {
      const res = await fetch(`${API_BASE}/client/${clientId}`, { headers: AUTH_HEADERS });
      const data = await res.json();
      if (data.client) setClients(prev => ({ ...prev, [clientId]: data.client }));
    } catch { /* silent */ }
  }

  // ─ Open lead ─
  async function openLead(lead: Lead) {
    setSelectedLead(lead);
    setScreen("form");
    setError(null);
    setNewPhotos([]);
    setNewPreviews([]);
    setSavedPhotoUrls([]);
    setTraceLength("");
    setCable(CABLE_OPTIONS[0]);
    setDrainage(DRAINAGE_OPTIONS[0].value);
    setWorkCost("");
    setNotes("");
    setExistingMeasurement(null);
    setHasSignature(false);
    setExistingSignatureUrl(undefined);
    setSavedMaterials(null);

    try {
      const res = await fetch(`${API_BASE}/measurements/lead/${lead.id}`, { headers: AUTH_HEADERS });
      const data = await res.json();
      if (data.measurement) {
        const m: Measurement = data.measurement;
        setExistingMeasurement(m);
        setTraceLength(m.traceLength ? String(m.traceLength) : "");
        setCable(m.cable || CABLE_OPTIONS[0]);
        setDrainage(m.drainage || DRAINAGE_OPTIONS[0].value);
        setWorkCost(m.workCost ? String(m.workCost) : "");
        setNotes(m.notes || "");
        setSavedPhotoUrls(m.photos || []);
        setExistingSignatureUrl(m.signature ?? undefined);
        if (m.signature) setHasSignature(true);
        if (m.materials_json) setSavedMaterials(m.materials_json);
      }
    } catch { /* silent */ }
  }

  // ─ Photo handling ─
  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setNewPhotos(prev => [...prev, ...files]);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => setNewPreviews(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeNewPhoto(i: number) {
    setNewPhotos(prev => prev.filter((_, idx) => idx !== i));
    setNewPreviews(prev => prev.filter((_, idx) => idx !== i));
  }

  function removeSavedPhoto(i: number) {
    setSavedPhotoUrls(prev => prev.filter((_, idx) => idx !== i));
  }

  async function uploadFile(blob: Blob, name: string, leadId: string): Promise<string | null> {
    const fd = new FormData();
    fd.append("photo", new File([blob], name, { type: blob.type || "image/png" }));
    fd.append("leadId", leadId);
    try {
      const res = await fetch(`${API_BASE}/upload-photo`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: fd,
      });
      const data = await res.json();
      return data.url || null;
    } catch (err) {
      console.error("File upload exception:", err);
      return null;
    }
  }

  async function uploadPhotos(): Promise<string[]> {
    const urls = [...savedPhotoUrls];
    for (const photo of newPhotos) {
      const url = await uploadFile(photo, photo.name, selectedLead!.id);
      if (url) urls.push(url);
    }
    return urls;
  }

  async function uploadSignature(): Promise<string | null> {
    if (!signatureRef.current) return existingSignatureUrl || null;
    const hasNew = signatureRef.current.hasDrawing();
    if (!hasNew) return existingSignatureUrl || null;
    const blob = await signatureRef.current.toBlob();
    if (!blob) return existingSignatureUrl || null;
    return uploadFile(blob, `signature_${Date.now()}.png`, selectedLead!.id);
  }

  // ─ Save measurement ─
  async function handleSave() {
    if (!selectedLead) return;
    setSaving(true);
    setError(null);
    try {
      const [allPhotos, signatureUrl] = await Promise.all([
        uploadPhotos(),
        uploadSignature(),
      ]);

      const body = {
        leadId: selectedLead.id,
        traceLength: parseFloat(traceLength) || 0,
        cable,
        drainage,
        workCost: parseFloat(workCost) || 0,
        notes,
        photos: allPhotos,
        signature: signatureUrl,
      };

      const res = await fetch(`${API_BASE}/measurements`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.measurement) {
        const m: Measurement = data.measurement;
        setExistingMeasurement(m);
        setSavedPhotoUrls(m.photos || []);
        setExistingSignatureUrl(m.signature ?? undefined);
        setNewPhotos([]);
        setNewPreviews([]);
        // Show generated materials
        if (m.materials_json) setSavedMaterials(m.materials_json);
        showToast(existingMeasurement ? "Замер обновлён ✅" : "Замер сохранён ✅");

        // Promote lead to "measurement" if it was "new"
        if (selectedLead.status === "new") {
          await fetch(`${API_BASE}/update-lead-status`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ leadId: selectedLead.id, status: "measurement" }),
          });
          const updated = { ...selectedLead, status: "measurement" as LeadStatus };
          setSelectedLead(updated);
          setLeads(prev => prev.map(l => l.id === selectedLead.id ? updated : l));
        }
      } else {
        const msg = data.error || "Ошибка сохранения";
        setError(msg);
        showToast(msg, false);
      }
    } catch (err: any) {
      const msg = `Ошибка: ${err.message}`;
      setError(msg);
      showToast(msg, false);
    } finally {
      setSaving(false);
    }
  }

  // ─ Filtered leads ─
  const filteredLeads = leads.filter(l => {
    if (filterTab === "all") return true;
    if (filterTab === "measurement") return l.status === "measurement";
    if (filterTab === "new") return l.status === "new";
    return true;
  });

  // ════════════════════════════════════════════════════════════════════════════
  // FORM SCREEN
  // ════════════════════════════════════════════════════════════════════════════
  if (screen === "form" && selectedLead) {
    const client = clients[selectedLead.clientId];
    const req = selectedLead.requirements_json || {};
    const totalPhotos = savedPhotoUrls.length + newPreviews.length;

    return (
      <div className="flex flex-col h-full bg-slate-100 max-w-2xl mx-auto relative overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-800 to-blue-600 text-white px-4 pt-4 pb-5 shadow-xl flex-shrink-0">
          <button
            onClick={() => setScreen("list")}
            className="flex items-center gap-1.5 text-blue-200 mb-3 text-sm font-medium active:opacity-70"
          >
            <span className="text-base">←</span> Список заявок
          </button>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-bold truncate">{client?.name || "Клиент..."}</h1>
              <p className="text-blue-200 text-sm">{client?.phone || ""}</p>
            </div>
            <StatusBadge status={selectedLead.status} />
          </div>
          {(req.area || req.roomType || req.roomsCount) && (
            <div className="flex flex-wrap gap-2 mt-2.5">
              {req.area && <span className="bg-blue-700/50 text-blue-100 text-xs px-2.5 py-1 rounded-full">📐 {req.area} м²</span>}
              {req.roomType && <span className="bg-blue-700/50 text-blue-100 text-xs px-2.5 py-1 rounded-full">🏠 {req.roomType}</span>}
              {req.roomsCount && <span className="bg-blue-700/50 text-blue-100 text-xs px-2.5 py-1 rounded-full">🚪 {req.roomsCount} комн.</span>}
            </div>
          )}
          {existingMeasurement && (
            <p className="text-xs text-blue-300 mt-2 flex items-center gap-1">
              <span>✏️</span> Редактирование сохранённого замера
            </p>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto pb-32">
          <div className="p-4 space-y-4">

            {/* ─── Материалы (показываем сверху если уже есть) ─── */}
            {savedMaterials && (
              <MaterialsPanel
                materials={savedMaterials}
                measurementId={existingMeasurement?.id}
                compact={true}
                onRecalculated={setSavedMaterials}
              />
            )}

            {/* ─── Параметры монтажа ─── */}
            <Section icon="🔧" title="Параметры монтажа">
              <Field label="Длина трассы" unit="м">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  value={traceLength}
                  onChange={e => setTraceLength(e.target.value)}
                  placeholder="0.0"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xl font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </Field>

              <Field label="Кабеь питания">
                <div className="grid grid-cols-2 gap-2">
                  {CABLE_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      onClick={() => setCable(opt)}
                      className={`text-sm px-3 py-2.5 rounded-xl border font-medium transition-all text-left ${
                        cable === opt
                          ? "bg-blue-600 text-white border-blue-600 shadow-md"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:border-blue-300"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Тип дренажа">
                <div className="space-y-2">
                  {DRAINAGE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setDrainage(opt.value)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                        drainage === opt.value
                          ? "bg-blue-600 text-white border-blue-600 shadow-md"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:border-blue-300"
                      }`}
                    >
                      <span className="text-xl">{opt.icon}</span>
                      <div>
                        <p className={`text-sm font-semibold ${drainage === opt.value ? "text-white" : "text-slate-800"}`}>
                          {opt.value}
                        </p>
                        <p className={`text-xs ${drainage === opt.value ? "text-blue-100" : "text-slate-400"}`}>
                          {opt.desc}
                        </p>
                      </div>
                      {drainage === opt.value && <span className="ml-auto text-white text-lg">✓</span>}
                    </button>
                  ))}
                </div>
              </Field>
            </Section>

            {/* ─── Фото монтажа ─── */}
            <Section icon="📸" title={`Фото монтажа${totalPhotos ? ` (${totalPhotos})` : ""}`}>
              {savedPhotoUrls.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-2 font-medium">Сохранённые:</p>
                  <div className="grid grid-cols-3 gap-2">
                    {savedPhotoUrls.map((url, i) => (
                      <div key={i} className="relative aspect-square">
                        <img src={url} alt={`Фото ${i + 1}`} className="w-full h-full object-cover rounded-xl" />
                        <button
                          onClick={() => removeSavedPhoto(i)}
                          className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm shadow-md font-bold"
                        >×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {newPreviews.length > 0 && (
                <div>
                  <p className="text-xs text-blue-500 mb-2 font-medium">Новые (не сохранены):</p>
                  <div className="grid grid-cols-3 gap-2">
                    {newPreviews.map((preview, i) => (
                      <div key={i} className="relative aspect-square">
                        <img src={preview} alt={`Новое ${i + 1}`} className="w-full h-full object-cover rounded-xl ring-2 ring-blue-400 opacity-90" />
                        <button
                          onClick={() => removeNewPhoto(i)}
                          className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm shadow-md font-bold"
                        >×</button>
                        <div className="absolute bottom-1 right-1 bg-blue-500 rounded-full w-4 h-4 flex items-center justify-center">
                          <span className="text-white text-[8px] font-bold">NEW</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={handlePhotoSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-blue-300 rounded-2xl py-5 flex flex-col items-center gap-1.5 text-blue-500 hover:bg-blue-50 active:scale-95 transition-all"
              >
                <span className="text-3xl">📷</span>
                <span className="text-sm font-semibold">Добавить фото</span>
                <span className="text-xs text-slate-400">Камера или галерея</span>
              </button>
            </Section>

            {/* ─── Подпись клиента ─── */}
            <Section icon="✍️" title="Подпись клиента">
              <p className="text-xs text-slate-500">Клиент подтверждает принятие работ, расписываясь ниже</p>
              <SignatureCanvas
                ref={signatureRef}
                existingUrl={existingSignatureUrl}
                onDrawingChange={setHasSignature}
              />
            </Section>

            {/* ─── Стоимость работ ─── */}
            <Section icon="💰" title="Стоимость работ">
              <Field label="Сумма" unit="₴">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={workCost}
                  onChange={e => setWorkCost(e.target.value)}
                  placeholder="0"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-2xl font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </Field>
              <Field label="Примечания к монтажу">
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Опишите особенности монтажа, материалы, сложности..."
                  rows={3}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </Field>
            </Section>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm flex items-start gap-2">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {/* Materials preview hint (before first save) */}
            {!savedMaterials && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-start gap-3">
                <span className="text-2xl">📦</span>
                <div>
                  <p className="text-sm font-semibold text-emerald-800">Материалы рассчитаются автоматически</p>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    После сохранения замера система автоматически сформирует список материалов
                    с учётом длины трассы, типа дренажа и шаблона
                  </p>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Sticky save button */}
        <div className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-slate-200 p-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-gradient-to-r from-blue-700 to-blue-500 text-white rounded-2xl py-4 text-base font-bold shadow-lg shadow-blue-200 disabled:opacity-60 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <span className="animate-spin text-lg">⏳</span>
                <span>Сохранение и расчёт материалов...</span>
              </>
            ) : (
              <>
                <span className="text-lg">{existingMeasurement ? "💾" : "✅"}</span>
                <span>{existingMeasurement ? "Обновить замер" : "Сохранить замер"}</span>
              </>
            )}
          </button>
        </div>

        <Toast msg={toastMsg} />
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LIST SCREEN
  // ════════════════════════════════════════════════════════════════════════════
  const FILTER_TABS: { key: FilterTab; icon: string; label: string }[] = [
    { key: "measurement", icon: "📏", label: "Замер" },
    { key: "new",         icon: "🆕", label: "Новые" },
    { key: "all",         icon: "📂", label: "Все" },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-100">
      <div className="bg-gradient-to-r from-blue-800 to-blue-600 text-white px-4 pt-4 pb-4 shadow-xl flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold">Мои задания</h1>
            <p className="text-blue-200 text-sm mt-0.5">{filteredLeads.length} заявок</p>
          </div>
          <button
            onClick={fetchLeads}
            disabled={loading}
            className="bg-blue-700/60 rounded-xl p-2.5 active:scale-90 transition-transform"
          >
            <span className={`text-lg block ${loading ? "animate-spin" : ""}`}>🔄</span>
          </button>
        </div>
        <div className="flex gap-2">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilterTab(tab.key)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                filterTab === tab.key ? "bg-white text-blue-700 shadow" : "bg-blue-700/40 text-blue-100"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-3">
            <span className="text-4xl animate-spin">⏳</span>
            <p className="text-sm">Загрузка...</p>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-3">
            <span className="text-5xl">📭</span>
            <p className="text-sm font-medium">Заявок нет</p>
            <p className="text-xs text-slate-300">
              {filterTab === "measurement" ? "Нет заявок со статусом «Замер»" :
               filterTab === "new" ? "Нет новых заявок" : "Заявки отсутствуют"}
            </p>
          </div>
        ) : (
          filteredLeads.map(lead => {
            const client = clients[lead.clientId];
            const req = lead.requirements_json || {};
            const date = new Date(lead.createdAt).toLocaleDateString("ru-RU", {
              day: "2-digit", month: "2-digit", year: "2-digit",
            });
            return (
              <button
                key={lead.id}
                onClick={() => openLead(lead)}
                className="w-full bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-left active:scale-[0.99] hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 truncate text-base">
                      {client?.name ?? <span className="text-slate-300 italic text-sm">Загрузка...</span>}
                    </p>
                    <p className="text-sm text-slate-500 mt-0.5">{client?.phone ?? ""}</p>
                  </div>
                  <StatusBadge status={lead.status} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {req.area && <Chip>📐 {req.area} м²</Chip>}
                  {req.roomType && <Chip>🏠 {req.roomType}</Chip>}
                  {req.roomsCount && <Chip>🚪 {req.roomsCount} комн.</Chip>}
                  {req.budget && <Chip>💰 {req.budget.toLocaleString()} ₴</Chip>}
                  <Chip>📅 {date}</Chip>
                </div>
                <div className="flex items-center justify-end mt-3 text-blue-500 text-sm font-semibold">
                  Открыть замер →
                </div>
              </button>
            );
          })
        )}
        <div className="h-4" />
      </div>

      <Toast msg={toastMsg} />
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="flex items-center gap-2 bg-slate-50 px-4 py-2.5 border-b border-slate-100">
        <span>{icon}</span>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">{title}</h2>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, unit, children }: { label: string; unit?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm font-semibold text-slate-700">{label}</label>
        {unit && <span className="text-xs text-slate-400 font-mono">{unit}</span>}
      </div>
      {children}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-slate-100 text-slate-600 text-xs px-2.5 py-1 rounded-full font-medium">
      {children}
    </span>
  );
}

function Toast({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-white text-sm font-semibold whitespace-nowrap ${
      msg.ok ? "bg-green-600" : "bg-red-600"
    }`}>
      {msg.text}
    </div>
  );
}