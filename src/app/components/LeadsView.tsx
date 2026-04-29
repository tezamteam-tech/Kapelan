import React, { useState, useEffect, useCallback } from "react";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { useCurrency } from "./CurrencyContext";
import { useNavigate } from "react-router";
import { copyToClipboard } from "../utils/clipboard";
import { getJson } from "../lib/apiClient";
import { RightSideCard } from "./ui/RightSideCard";
import {
  Plus, Search, RefreshCw, User, Phone, MapPin, Building2,
  ChevronDown, ChevronUp, ClipboardCheck, FileText, Loader2,
  X, Sparkles, Calendar, Banknote, Tag, MessageSquare,
  ArrowRight, CheckCircle2, AlertCircle,
} from "lucide-react";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
type LeadStatus = "new" | "measurement" | "offer" | "deal" | "done";

interface Lead {
  id: string;
  clientId: string;
  status: LeadStatus;
  source?: string;
  requirements_json: {
    area?: number; roomType?: string; roomsCount?: number;
    preferences?: string[]; budget?: number; additionalNotes?: string;
    address?: string | null; _acRecommendation?: any;
  };
  createdAt: string;
  updatedAt: string;
}
interface Client { id: string; name: string; phone: string; email?: string | null; }

// ─── Config ───────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<LeadStatus, { label: string; bg: string; text: string; dot: string; next?: LeadStatus }> = {
  new:         { label: "Новый",     bg: "bg-blue-100",   text: "text-blue-700",   dot: "bg-blue-500",   next: "measurement" },
  measurement: { label: "Замер",     bg: "bg-amber-100",  text: "text-amber-700",  dot: "bg-amber-500",  next: "offer" },
  offer:       { label: "КП",        bg: "bg-purple-100", text: "text-purple-700", dot: "bg-purple-500", next: "deal" },
  deal:        { label: "Сделка",    bg: "bg-green-100",  text: "text-green-700",  dot: "bg-green-500",  next: "done" },
  done:        { label: "Выполнено", bg: "bg-slate-100",  text: "text-slate-500",  dot: "bg-slate-400" },
};
const ALL_STATUSES: LeadStatus[] = ["new", "measurement", "offer", "deal", "done"];

const PREF_ICONS: Record<string, string> = {
  wifi: "📱", silent: "🔇", inverter: "♻️", filter: "🌿",
  white_color: "⬜", heating: "🔥",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Вручную", ai_chat: "AI Чат", conversation_paste: "Переписка",
};

// ─── Main Component ───────────────────────────────────────────────────────────
export function LeadsView() {
  const navigate = useNavigate();
  const { fmtShort } = useCurrency();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Record<string, Client>>({});
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getJson<any>(`${API}/leads`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true });
      if (data.leads) {
        setLeads(data.leads);
        const ids = [...new Set<string>(data.leads.map((l: Lead) => l.clientId))];
        await Promise.all(ids.map(fetchClient));
      }
    } catch { showToast("Ошибка загрузки", false); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  async function fetchClient(id: string) {
    try {
      if (clients[id]) return;
      const data = await getJson<any>(`${API}/client/${id}`, { ttlMs: 10 * 60_000, staleTtlMs: 60 * 60_000, swr: true });
      if (data.client) setClients(prev => ({ ...prev, [id]: data.client }));
    } catch {}
  }

  async function updateStatus(leadId: string, status: LeadStatus) {
    setChangingStatus(leadId);
    try {
      const res = await fetch(`${API}/update-lead-status`, {
        method: "POST", headers: JH, body: JSON.stringify({ leadId, status }),
      });
      const data = await res.json();
      if (data.success) {
        setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status, updatedAt: new Date().toISOString() } : l));
        showToast("Статус обновлён ✅");
      } else showToast(data.error || "Ошибка обновления", false);
    } catch (e: any) {
      showToast(`Ошибка: ${e.message}`, false);
    } finally { setChangingStatus(null); }
  }

  async function deleteLead(leadId: string) {
    if (!confirm("Удалить заявку?")) return;
    try {
      await fetch(`${API}/leads/${leadId}`, { method: "DELETE", headers: AH });
      setLeads(prev => prev.filter(l => l.id !== leadId));
      setExpandedId(null);
      showToast("🗑️ Заявка удалена");
    } catch {}
  }

  // Counts
  const counts = leads.reduce((acc, l) => { acc[l.status] = (acc[l.status] || 0) + 1; return acc; }, {} as Record<string, number>);

  // Filter + search
  const filtered = leads.filter(l => {
    const matchStatus = filterStatus === "all" || l.status === filterStatus;
    const client = clients[l.clientId];
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || (client?.name || "").toLowerCase().includes(q) ||
      (client?.phone || "").includes(q) || (l.requirements_json?.address || "").toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="bg-amber-50 border-b border-amber-200 px-5 py-2 text-[12px] text-amber-800">
        Этот раздел — <b>legacy</b>. Теперь клиент/заявка/замер/монтаж ведутся <b>только внутри ордера</b>.
        <button
          onClick={() => navigate("/orders?create=1")}
          className="ml-2 text-amber-900 font-bold underline underline-offset-2"
        >
          Создать ордер →
        </button>
      </div>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            <h1 className="text-base font-bold text-slate-800">Заявки</h1>
            <p className="text-xs text-slate-400 mt-0.5">Воронка продаж · {leads.length} заявок</p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadData} disabled={loading}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={() => navigate("/orders?create=1")}
              className="flex items-center gap-1.5 bg-slate-900 text-white text-sm font-semibold px-3 py-2 rounded-xl hover:bg-slate-800 active:scale-95 transition-all shadow-sm">
              <ClipboardCheck size={16} /> Создать ордер
            </button>
          </div>
        </div>

        {/* Pipeline stats */}
        <div className="flex gap-0 border-t border-slate-100 overflow-x-auto">
          {ALL_STATUSES.map(s => {
            const c = STATUS_CFG[s];
            const cnt = counts[s] || 0;
            return (
              <button key={s} onClick={() => setFilterStatus(filterStatus === s ? "all" : s)}
                className={`flex-1 min-w-[80px] py-2.5 px-2 text-center transition-all border-b-2 ${
                  filterStatus === s ? `border-current ${c.text}` : "border-transparent text-slate-500 hover:text-slate-700"
                }`}>
                <p className="font-black text-lg leading-none">{cnt}</p>
                <p className="text-[10px] font-semibold mt-0.5 truncate">{c.label}</p>
              </button>
            );
          })}
          <button onClick={() => setFilterStatus("all")}
            className={`flex-1 min-w-[70px] py-2.5 px-2 text-center transition-all border-b-2 ${
              filterStatus === "all" ? "border-slate-800 text-slate-800" : "border-transparent text-slate-400"
            }`}>
            <p className="font-black text-lg leading-none">{leads.length}</p>
            <p className="text-[10px] font-semibold mt-0.5">Все</p>
          </button>
        </div>
      </div>

      {/* ── Search ──────────────────────────────────────────────────────────── */}
      <div className="px-4 py-2 flex-shrink-0 bg-white border-b border-slate-100">
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <Search size={14} className="text-slate-400 flex-shrink-0" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Поиск по имени, телефону, адресу…"
            className="bg-transparent flex-1 text-sm text-slate-700 placeholder-slate-400 outline-none" />
        </div>
      </div>

      {/* ── Lead list ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading && leads.length === 0 ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-300" size={28} /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-slate-400 font-medium text-sm">
              {leads.length === 0 ? "Заявок пока нет" : "Ничего не найдено"}
            </p>
            {leads.length === 0 && (
              <button onClick={() => setCreateOpen(true)} className="mt-3 text-blue-600 text-sm font-semibold hover:underline">
                Создать ��ервую заявку →
              </button>
            )}
          </div>
        ) : (
          filtered.map(lead => {
            const client = clients[lead.clientId];
            const req = lead.requirements_json || {};
            const isExp = expandedId === lead.id;
            const cfg = STATUS_CFG[lead.status];
            return (
              <LeadCard
                key={lead.id}
                lead={lead} client={client} req={req} cfg={cfg} isExpanded={isExp}
                isChanging={changingStatus === lead.id}
                onToggle={() => setExpandedId(isExp ? null : lead.id)}
                onStatusChange={updateStatus}
                onDelete={deleteLead}
                onCreateOrder={() => navigate(`/orders?fromLead=${lead.id}`)}
                showToast={showToast}
              />
            );
          })
        )}
      </div>

      {/* Create Lead disabled: order-first */}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-sm font-semibold max-w-sm text-center pointer-events-none ${
          toast.ok ? "bg-slate-800 text-white" : "bg-red-600 text-white"
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEAD CARD
// ═══════════════════════════════════════════════════════════════════════════════
function LeadCard({ lead, client, req, cfg, isExpanded: isExp, isChanging, onToggle, onStatusChange, onDelete, onCreateOrder, showToast }: {
  lead: Lead; client?: Client; req: any; cfg: any; isExpanded: boolean; isChanging: boolean;
  onToggle: () => void; onStatusChange: (id: string, s: LeadStatus) => void;
  onDelete: (id: string) => void; onCreateOrder: () => void; showToast: (m: string, ok?: boolean) => void;
}) {
  const { fmtShort } = useCurrency();
  const fmtDate = (s: string) => new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Card header */}
      <button onClick={onToggle} className="w-full p-4 text-left hover:bg-slate-50 transition-colors">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-800 text-sm truncate">
              {client?.name || <span className="text-slate-300 italic">Загрузка...</span>}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">{client?.phone || ""}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${cfg.bg} ${cfg.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
            {isExp ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {req.area && <Chip>📐 {req.area} м²</Chip>}
          {req.roomType && <Chip>🏠 {req.roomType}</Chip>}
          {req.roomsCount && <Chip>🚪 {req.roomsCount} ком.</Chip>}
          {req.budget && <Chip>💰 {fmtShort(Number(req.budget))}</Chip>}
          {lead.source && <Chip>{SOURCE_LABELS[lead.source] || lead.source}</Chip>}
        </div>
      </button>

      {/* Expanded */}
      {isExp && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-4">
          {/* Client details */}
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
            {client?.phone && (
              <div className="flex items-center gap-1.5">
                <Phone size={11} className="text-slate-400" /> {client.phone}
              </div>
            )}
            {client?.email && (
              <div className="flex items-center gap-1.5">
                <MessageSquare size={11} className="text-slate-400" /> {client.email}
              </div>
            )}
            {req.address && (
              <div className="flex items-center gap-1.5 col-span-2">
                <MapPin size={11} className="text-slate-400" /> {req.address}
              </div>
            )}
          </div>

          {/* Requirements */}
          {(req.preferences?.length > 0 || req.additionalNotes) && (
            <div className="space-y-1.5">
              {req.preferences?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {req.preferences.map((p: string) => (
                    <span key={p} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full font-semibold">
                      {PREF_ICONS[p] || "•"} {p}
                    </span>
                  ))}
                </div>
              )}
              {req.additionalNotes && (
                <p className="text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2 leading-relaxed">
                  📝 {req.additionalNotes}
                </p>
              )}
            </div>
          )}

          {/* AI recommendation */}
          {req._acRecommendation && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2">
              <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wide mb-1">💡 AI рекомендация</p>
              <p className="text-xs text-violet-700">
                Тип: <b>{req._acRecommendation.preferredTier}</b> · {req._acRecommendation.minBtu} BTU
              </p>
              {req._acRecommendation.reason && (
                <p className="text-[10px] text-violet-500 mt-0.5 italic">{req._acRecommendation.reason}</p>
              )}
            </div>
          )}

          {/* Status pipeline */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Статус воронки</p>
            <div className="flex gap-1.5 flex-wrap">
              {ALL_STATUSES.map(s => {
                const sc = STATUS_CFG[s];
                const active = lead.status === s;
                return (
                  <button key={s} onClick={() => !active && onStatusChange(lead.id, s)}
                    disabled={active || isChanging}
                    className={`text-xs px-3 py-1.5 rounded-full font-semibold border transition-all active:scale-95 ${
                      active ? `${sc.bg} ${sc.text} border-transparent` : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                    } disabled:opacity-60`}>
                    {isChanging && !active ? "..." : sc.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button onClick={onCreateOrder}
              className="flex-1 flex items-center justify-center gap-2 bg-teal-600 text-white py-2.5 rounded-xl text-xs font-black active:scale-95 shadow-sm shadow-teal-100">
              <ClipboardCheck size={14} /> Создать ордер монтажа
            </button>
            <button
              onClick={() => {
                copyToClipboard(lead.id);
                showToast("ID скопирован");
              }}
              className="px-3 bg-slate-100 text-slate-500 rounded-xl text-xs font-semibold active:scale-95 hover:bg-slate-200">
              <FileText size={14} />
            </button>
            <button onClick={() => onDelete(lead.id)}
              className="px-3 bg-red-50 text-red-400 rounded-xl text-xs font-semibold active:scale-95 hover:bg-red-100">
              <X size={14} />
            </button>
          </div>

          <p className="text-[10px] text-slate-300 text-right">
            {fmtDate(lead.createdAt)} · ID: {lead.id.slice(-8)}
          </p>
        </div>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center bg-slate-100 text-slate-600 text-[10px] px-2 py-0.5 rounded-full font-semibold">
      {children}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE LEAD MODAL
// ═══════════════════════════════════════════════════════════════════════════════
const ROOM_TYPES = ["Квартира", "Спальня", "Гостиная", "Кухня", "Офис", "Магазин", "Склад", "Серверная", "Другое"];
const PREF_OPTIONS = [
  { key: "wifi", label: "Wi-Fi управление", icon: "📱" },
  { key: "silent", label: "Тихий режим", icon: "🔇" },
  { key: "inverter", label: "Инвертор", icon: "♻️" },
  { key: "filter", label: "Очистка воздуха", icon: "🌿" },
  { key: "heating", label: "Обогрев до -25°C", icon: "🔥" },
];

function CreateLeadModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (lead: Lead, client: Client) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    clientName: "", clientPhone: "", clientEmail: "",
    address: "", area: "", roomType: "Квартира", roomsCount: "",
    budget: "", additionalNotes: "",
  });
  const [prefs, setPrefs] = useState<string[]>([]);

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const togglePref = (k: string) =>
    setPrefs(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.clientName.trim() || !form.clientPhone.trim()) {
      setError("Имя и телефон обязательны"); return;
    }
    setSaving(true); setError("");
    try {
      const res = await fetch(`${API}/leads/create`, {
        method: "POST", headers: JH,
        body: JSON.stringify({
          clientName: form.clientName.trim(),
          clientPhone: form.clientPhone.trim(),
          clientEmail: form.clientEmail || null,
          area: form.area ? +form.area : null,
          roomType: form.roomType,
          roomsCount: form.roomsCount ? +form.roomsCount : null,
          budget: form.budget ? +form.budget : null,
          preferences: prefs,
          address: form.address || null,
          additionalNotes: form.additionalNotes || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Ошибка"); return; }
      onCreated(data.lead as Lead, data.client as Client);
    } catch (e: any) {
      setError(e.message);
    } finally { setSaving(false); }
  }

  return (
    <RightSideCard
      open={true}
      onClose={onClose}
      showHeader={false}
      defaultWidth={640}
      minWidth={640}
      maxWidth={940}
      overlayClassName="bg-black/50"
    >
      <div className="w-full h-full flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
          <h2 className="font-bold text-slate-800 text-base">Создать заявку вручную</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-all">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Client */}
          <section>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <User size={11} /> лиент
            </p>
            <div className="space-y-2">
              <FormRow label="Имя *" value={form.clientName} onChange={f("clientName")} placeholder="Иванов Иван Иванович" />
              <FormRow label="Телефон *" value={form.clientPhone} onChange={f("clientPhone")} placeholder="+380 XX XXX XX XX" />
              <FormRow label="Email" value={form.clientEmail} onChange={f("clientEmail")} placeholder="example@mail.com" />
              <FormRow label="Адрес объекта" value={form.address} onChange={f("address")} placeholder="г. Киев, ул. Крещатик, 1" />
            </div>
          </section>

          {/* Room */}
          <section>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Building2 size={11} /> Помещение
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Тип помещения</label>
                <select value={form.roomType} onChange={f("roomType") as any}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                  {ROOM_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <FormRow label="Площадь (м²)" value={form.area} onChange={f("area")} placeholder="45" type="number" />
              <FormRow label="Кол-во комнат" value={form.roomsCount} onChange={f("roomsCount")} placeholder="2" type="number" />
              <FormRow label="Бюджет" value={form.budget} onChange={f("budget")} placeholder="30000" type="number" />
            </div>
          </section>

          {/* Preferences */}
          <section>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Sparkles size={11} /> Пожелания клиента
            </p>
            <div className="flex flex-wrap gap-2">
              {PREF_OPTIONS.map(p => (
                <button key={p.key} type="button" onClick={() => togglePref(p.key)}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all active:scale-95 ${
                    prefs.includes(p.key)
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                  }`}>
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
          </section>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">Примечания</label>
            <textarea value={form.additionalNotes} onChange={f("additionalNotes")} rows={2} placeholder="Дополнительная информация..."
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <button type="submit" disabled={saving}
            className="w-full bg-blue-600 text-white py-3.5 rounded-2xl font-black text-sm active:scale-95 disabled:opacity-60 shadow-lg shadow-blue-100">
            {saving ? <Loader2 className="animate-spin mx-auto" size={18} /> : "✅ Создать заявку"}
          </button>
        </form>
      </div>
    </RightSideCard>
  );
}

function FormRow({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (e: any) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 block mb-1">{label}</label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder}
        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
    </div>
  );
}