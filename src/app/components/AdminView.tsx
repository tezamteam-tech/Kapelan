import React, { useState, useEffect, useCallback } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { MaterialsPanel, MaterialsJson, TemplateEditor } from "./MaterialsPanel";
import { OfferGeneratorView, OffersList } from "./OfferGeneratorView";
import { AssignInstallerModal } from "./InstallerAssignment";

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AUTH_HEADERS = { Authorization: `Bearer ${publicAnonKey}` };
const JSON_HEADERS = { ...AUTH_HEADERS, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
type LeadStatus = "new" | "measurement" | "offer" | "deal" | "done";
type AdminTab = "leads" | "measurements" | "offers" | "settings";

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
  signature?: string;
  materials_json?: MaterialsJson | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<LeadStatus, { label: string; bg: string; text: string; dot: string }> = {
  new:         { label: "Новый",     bg: "bg-blue-100",   text: "text-blue-700",   dot: "bg-blue-500" },
  measurement: { label: "Замер",     bg: "bg-amber-100",  text: "text-amber-700",  dot: "bg-amber-500" },
  offer:       { label: "КП",        bg: "bg-purple-100", text: "text-purple-700", dot: "bg-purple-500" },
  deal:        { label: "Сделка",    bg: "bg-green-100",  text: "text-green-700",  dot: "bg-green-500" },
  done:        { label: "Выполнено", bg: "bg-slate-100",  text: "text-slate-500",  dot: "bg-slate-400" },
};

const ALL_STATUSES: LeadStatus[] = ["new", "measurement", "offer", "deal", "done"];

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status as LeadStatus] ?? STATUS_CFG.new;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center bg-slate-100 text-slate-600 text-xs px-2.5 py-1 rounded-full font-medium">
      {children}
    </span>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-semibold border transition-all active:scale-95 ${
        active
          ? "bg-slate-800 text-white border-slate-800"
          : "bg-white text-slate-500 border-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2 bg-slate-50 px-4 py-2.5 border-b border-slate-100">
      <span>{icon}</span>
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">{title}</h3>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
      <span className="text-4xl animate-spin">⏳</span>
      <p className="text-sm">Загрузка...</p>
    </div>
  );
}

function EmptyState({ icon = "📭", text }: { icon?: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
      <span className="text-4xl">{icon}</span>
      <p className="text-sm">{text}</p>
    </div>
  );
}

function Toast({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  return (
    <div
      className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-white text-sm font-semibold whitespace-nowrap transition-all ${
        msg.ok ? "bg-green-600" : "bg-red-600"
      }`}
    >
      {msg.text}
    </div>
  );
}

// ─── PhotoGrid ────────────────────────────────────────────────────────────────
function PhotoGrid({ photos, cols = 3, maxVisible = 9 }: { photos: string[]; cols?: number; maxVisible?: number }) {
  if (!photos?.length) return null;
  const visible = photos.slice(0, maxVisible);
  const rest = photos.length - maxVisible;
  return (
    <div className={`grid gap-1.5 mt-2`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {visible.map((url, i) => (
        <a key={i} href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={`Фото ${i + 1}`}
            className="w-full aspect-square object-cover rounded-xl hover:opacity-80 transition-opacity"
          />
        </a>
      ))}
      {rest > 0 && (
        <div className="w-full aspect-square rounded-xl bg-slate-100 flex items-center justify-center text-xs text-slate-500 font-semibold">
          +{rest}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function AdminView() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Record<string, Client>>({});
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [measurementByLead, setMeasurementByLead] = useState<Record<string, Measurement>>({});
  const [activeTab, setActiveTab] = useState<AdminTab>("leads");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Offer generator screen
  const [offerLeadId, setOfferLeadId] = useState<string | null>(null);
  // Installer assignment modal
  const [assignLeadId, setAssignLeadId] = useState<string | null>(null);

  // Settings
  const [tgChatId, setTgChatId] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingTg, setTestingTg] = useState(false);
  const [configMsg, setConfigMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const showToast = useCallback((text: string, ok = true) => {
    setToastMsg({ text, ok });
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [leadsRes, measRes, configRes] = await Promise.all([
        fetch(`${API_BASE}/leads`, { headers: AUTH_HEADERS }),
        fetch(`${API_BASE}/measurements`, { headers: AUTH_HEADERS }),
        fetch(`${API_BASE}/config`, { headers: AUTH_HEADERS }),
      ]);

      const leadsData = await leadsRes.json();
      const measData = await measRes.json();
      const configData = await configRes.json();

      if (leadsData.leads) {
        setLeads(leadsData.leads);
        const ids = [...new Set<string>(leadsData.leads.map((l: Lead) => l.clientId))];
        await Promise.all(ids.map(fetchClient));
      }

      if (measData.measurements) {
        setMeasurements(measData.measurements);
        const byLead: Record<string, Measurement> = {};
        measData.measurements.forEach((m: Measurement) => { byLead[m.leadId] = m; });
        setMeasurementByLead(byLead);
      }

      if (configData.tgAdminChatId) setTgChatId(String(configData.tgAdminChatId));
    } catch (err) {
      console.error("AdminView fetchData error:", err);
      showToast("Ошибка загрузки данных", false);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function fetchClient(clientId: string) {
    try {
      const res = await fetch(`${API_BASE}/client/${clientId}`, { headers: AUTH_HEADERS });
      const data = await res.json();
      if (data.client) setClients(prev => ({ ...prev, [clientId]: data.client }));
    } catch { /* silent */ }
  }

  async function updateStatus(leadId: string, status: LeadStatus) {
    setChangingStatus(leadId);
    try {
      const res = await fetch(`${API_BASE}/update-lead-status`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ leadId, status }),
      });
      const data = await res.json();
      if (data.success) {
        setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
        showToast("Статус обновлён ✅");
      } else {
        showToast(data.error || "Ошибка обновления", false);
      }
    } catch (err: any) {
      showToast(`Ошибка: ${err.message}`, false);
    } finally {
      setChangingStatus(null);
    }
  }

  async function saveConfig() {
    setSavingConfig(true);
    setConfigMsg(null);
    try {
      const res = await fetch(`${API_BASE}/config`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ tgAdminChatId: tgChatId }),
      });
      const data = await res.json();
      setConfigMsg(data.success
        ? { text: "✅ Настройки сохранены", ok: true }
        : { text: data.error || "Ошибка сохранения", ok: false }
      );
    } catch (err: any) {
      setConfigMsg({ text: `Ошибка: ${err.message}`, ok: false });
    } finally {
      setSavingConfig(false);
    }
  }

  async function testTg() {
    setTestingTg(true);
    setConfigMsg(null);
    try {
      const res = await fetch(`${API_BASE}/tg-test`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setConfigMsg(data.success
        ? { text: "✅ Тестовое сообщение отправлено!", ok: true }
        : { text: data.error || "Ошибка отправки", ok: false }
      );
    } catch (err: any) {
      setConfigMsg({ text: `Ошибка: ${err.message}`, ok: false });
    } finally {
      setTestingTg(false);
    }
  }

  // ─── Computed ───────────────────────────────────────────────────────────────
  const statusCounts = leads.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const filteredLeads = statusFilter === "all"
    ? leads
    : leads.filter(l => l.status === statusFilter);

  const TABS: { key: AdminTab; icon: string; label: string }[] = [
    { key: "leads",        icon: "📋", label: "Заявки" },
    { key: "measurements", icon: "📏", label: "Замеры" },
    { key: "offers",       icon: "📄", label: "КП" },
    { key: "settings",     icon: "⚙️",  label: "Настройки" },
  ];

  // ─── Offer screen ─────────────────────────────────────────────────────────
  if (offerLeadId) {
    const lead = leads.find(l => l.id === offerLeadId);
    const client = lead ? clients[lead.clientId] : null;
    const meas = lead ? measurementByLead[lead.id] : null;
    if (lead) {
      return (
        <OfferGeneratorView
          lead={lead}
          client={client}
          measurement={meas ? {
            id: meas.id,
            traceLength: meas.traceLength,
            workCost: meas.workCost,
            materials_json: meas.materials_json as any,
          } : null}
          onBack={() => setOfferLeadId(null)}
        />
      );
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-slate-100">

      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-4 pt-4 pb-4 shadow-xl flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold">🏢 Администратор</h1>
            <p className="text-slate-400 text-sm mt-0.5">CRM — кондиционеры</p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="bg-slate-600/60 rounded-xl p-2.5 active:scale-90 transition-transform"
          >
            <span className={`text-lg block ${loading ? "animate-spin" : ""}`}>🔄</span>
          </button>
        </div>

        {/* Stats row */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            { label: "Всего",               count: leads.length,                       color: "bg-slate-600" },
            { label: STATUS_CFG.new.label,  count: statusCounts.new || 0,              color: "bg-blue-600" },
            { label: STATUS_CFG.measurement.label, count: statusCounts.measurement || 0, color: "bg-amber-500" },
            { label: STATUS_CFG.offer.label, count: statusCounts.offer || 0,           color: "bg-purple-600" },
            { label: STATUS_CFG.deal.label,  count: statusCounts.deal || 0,            color: "bg-green-600" },
            { label: STATUS_CFG.done.label,  count: statusCounts.done || 0,            color: "bg-slate-500" },
          ].map(s => (
            <div key={s.label} className={`${s.color} rounded-xl px-3 py-2 flex-shrink-0 text-center min-w-[54px]`}>
              <p className="text-white font-bold text-lg leading-none">{s.count}</p>
              <p className="text-white/70 text-[10px] mt-0.5 leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 flex flex-shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-3 text-[11px] font-semibold flex flex-col items-center gap-0.5 transition-colors ${
              activeTab === tab.key
                ? "text-slate-800 border-b-2 border-slate-800"
                : "text-slate-400"
            }`}
          >
            <span className="text-base">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* ══ ЗАЯВКИ ══════════════════════════════════════════════════════════ */}
        {activeTab === "leads" && (
          <div>
            {/* Status filter */}
            <div className="px-4 pt-3 pb-2 flex gap-2 overflow-x-auto">
              <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
                Все ({leads.length})
              </FilterChip>
              {ALL_STATUSES.map(s => (
                <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                  {STATUS_CFG[s].label} ({statusCounts[s] || 0})
                </FilterChip>
              ))}
            </div>

            <div className="px-4 pb-8 space-y-3">
              {loading ? <LoadingState /> : filteredLeads.length === 0 ? (
                <EmptyState text="Заявки не найдены" />
              ) : (
                filteredLeads.map(lead => {
                  const client = clients[lead.clientId];
                  const meas = measurementByLead[lead.id];
                  const req = lead.requirements_json || {};
                  const isExp = expandedId === lead.id;

                  return (
                    <div
                      key={lead.id}
                      className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
                    >
                      {/* Card header (tappable) */}
                      <button
                        onClick={() => setExpandedId(isExp ? null : lead.id)}
                        className="w-full p-4 text-left active:bg-slate-50"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 truncate text-base">
                              {client?.name || <span className="text-slate-300 italic text-sm">Загрузка...</span>}
                            </p>
                            <p className="text-sm text-slate-500 mt-0.5">{client?.phone || ""}</p>
                          </div>
                          <StatusBadge status={lead.status} />
                        </div>

                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {req.area && <Chip>📐 {req.area} м²</Chip>}
                          {req.roomType && <Chip>🏠 {req.roomType}</Chip>}
                          {req.roomsCount && <Chip>🚪 {req.roomsCount} комн.</Chip>}
                          {req.budget && <Chip>💰 {req.budget.toLocaleString()} ₴</Chip>}
                          {meas
                            ? <Chip>📏 {meas.traceLength} м · {meas.workCost.toLocaleString()} ₴</Chip>
                            : <Chip>⏳ Замер не выполнен</Chip>
                          }
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-400">
                            {new Date(lead.createdAt).toLocaleDateString("ru-RU", {
                              day: "2-digit", month: "2-digit", year: "2-digit"
                            })}
                          </span>
                          <span className="text-xs text-slate-400">
                            {isExp ? "▲ Свернуть" : "▼ Подробнее"}
                          </span>
                        </div>
                      </button>

                      {/* Expanded content */}
                      {isExp && (
                        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-4">
                          {/* Requirements */}
                          {(req.area || req.roomType || req.additionalNotes || req.preferences?.length) && (
                            <div>
                              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                                Требования клиента
                              </p>
                              <div className="space-y-1 text-sm text-slate-700">
                                {req.area && <p>📐 Площадь: <b>{req.area} м²</b></p>}
                                {req.roomType && <p>🏠 Тип: <b>{req.roomType}</b></p>}
                                {req.roomsCount && <p>🚪 Комнат: <b>{req.roomsCount}</b></p>}
                                {req.budget && <p>💰 Бюджет: <b>{req.budget.toLocaleString()} ₴</b></p>}
                                {req.preferences?.length > 0 && (
                                  <p>✨ Пожелания: <b>{req.preferences.join(", ")}</b></p>
                                )}
                                {req.additionalNotes && <p>📝 Заметки: <b>{req.additionalNotes}</b></p>}
                              </div>
                            </div>
                          )}

                          {/* Measurement data */}
                          {meas && (
                            <div>
                              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                                Данные замера
                              </p>
                              <div className="space-y-1 text-sm text-slate-700">
                                <p>📏 Трасса: <b>{meas.traceLength} м</b></p>
                                <p>🔌 Кабель: <b>{meas.cable}</b></p>
                                <p>💧 Дренаж: <b>{meas.drainage}</b></p>
                                <p>💰 Стоимость работ: <b>{meas.workCost.toLocaleString()} ₴</b></p>
                                {meas.notes && <p>📝 Примечания: <b>{meas.notes}</b></p>}
                              </div>
                              <div className="flex gap-3 mt-2">
                                {meas.photos?.length > 0 && (
                                  <span className="text-blue-600 text-xs font-semibold">📸 {meas.photos.length} фото</span>
                                )}
                                {meas.signature && (
                                  <span className="text-green-600 text-xs font-semibold">✍️ Подпись есть</span>
                                )}
                              </div>
                              <PhotoGrid photos={meas.photos} cols={4} maxVisible={8} />
                              {meas.signature && (
                                <div className="mt-3">
                                  <p className="text-xs text-slate-400 mb-1">Подпись клиента:</p>
                                  <img
                                    src={meas.signature}
                                    alt="Подпись"
                                    className="h-16 border border-slate-200 rounded-xl bg-white p-1.5"
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          {/* Create offer button */}
                          <button
                            onClick={() => setOfferLeadId(lead.id)}
                            className="w-full bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-xl py-3 text-sm font-bold active:scale-95 transition-transform shadow-md shadow-indigo-100 flex items-center justify-center gap-2"
                          >
                            <span>📄</span>
                            {meas ? "Создать / открыть КП" : "Создать КП (без замера)"}
                          </button>

                          {/* Assign installer button */}
                          <button
                            onClick={() => setAssignLeadId(lead.id)}
                            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl py-3 text-sm font-bold active:scale-95 transition-transform shadow-md shadow-orange-100 flex items-center justify-center gap-2"
                          >
                            <span>👷</span>
                            {(lead as any).assignedInstallerName
                              ? `Монтажник: ${(lead as any).assignedInstallerName} (изменить)`
                              : "Назначить монтажника"}
                          </button>

                          {/* Status update */}
                          <div>
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                              Изменить статус
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {ALL_STATUSES.map(s => {
                                const active = lead.status === s;
                                const c = STATUS_CFG[s];
                                return (
                                  <button
                                    key={s}
                                    onClick={() => !active && updateStatus(lead.id, s)}
                                    disabled={active || changingStatus === lead.id}
                                    className={`text-xs px-3 py-1.5 rounded-full font-semibold border transition-all active:scale-95 ${
                                      active
                                        ? `${c.bg} ${c.text} border-transparent`
                                        : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                                    } disabled:opacity-60`}
                                  >
                                    {changingStatus === lead.id && !active ? "..." : c.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ══ ЗАМЕРЫ ══════════════════════════════════════════════════════════ */}
        {activeTab === "measurements" && (
          <div className="px-4 py-4 pb-8 space-y-3">
            {loading ? <LoadingState /> : measurements.length === 0 ? (
              <EmptyState icon="📏" text="Замеры не найдены" />
            ) : (
              measurements.map(meas => {
                const lead = leads.find(l => l.id === meas.leadId);
                const client = lead ? clients[lead.clientId] : undefined;
                const isExp = expandedId === meas.id;
                const dt = new Date(meas.updatedAt).toLocaleString("ru-RU", {
                  day: "2-digit", month: "2-digit", year: "2-digit",
                  hour: "2-digit", minute: "2-digit"
                });

                return (
                  <div
                    key={meas.id}
                    className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedId(isExp ? null : meas.id)}
                      className="w-full p-4 text-left active:bg-slate-50"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 truncate">
                            {client?.name || "Клиент..."}
                          </p>
                          <p className="text-sm text-slate-500">{client?.phone || ""}</p>
                        </div>
                        {lead && <StatusBadge status={lead.status} />}
                      </div>

                      <div className="flex flex-wrap gap-1.5 mb-2">
                        <Chip>📏 {meas.traceLength} м</Chip>
                        <Chip>🔌 {meas.cable}</Chip>
                        <Chip>💧 {meas.drainage}</Chip>
                        <Chip>💰 {meas.workCost.toLocaleString()} ₴</Chip>
                        {meas.photos?.length > 0 && <Chip>📸 {meas.photos.length}</Chip>}
                        {meas.signature && <Chip>✍️</Chip>}
                        {meas.materials_json && <Chip>📦 {meas.materials_json.totalMaterials.toLocaleString()} ₴</Chip>}
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-400">{dt}</span>
                        <span className="text-xs text-slate-400">{isExp ? "▲" : "▼"}</span>
                      </div>
                    </button>

                    {isExp && (
                      <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
                        <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-sm text-slate-700">
                          <p>📏 Трасса: <b>{meas.traceLength} м</b></p>
                          <p>🔌 Кабель: <b>{meas.cable}</b></p>
                          <p>💧 Дренаж: <b>{meas.drainage}</b></p>
                          <p>💰 Стоимость: <b>{meas.workCost.toLocaleString()} ₴</b></p>
                        </div>
                        {meas.notes && (
                          <p className="text-sm text-slate-700">📝 <b>{meas.notes}</b></p>
                        )}
                        {meas.photos?.length > 0 && (
                          <>
                            <p className="text-xs text-slate-400 font-semibold">Фотографии:</p>
                            <PhotoGrid photos={meas.photos} cols={3} />
                          </>
                        )}
                        {meas.signature && (
                          <div>
                            <p className="text-xs text-slate-400 font-semibold mb-1.5">Подпись клиента:</p>
                            <img
                              src={meas.signature}
                              alt="Подпись"
                              className="h-20 border border-slate-200 rounded-xl bg-white p-2"
                            />
                          </div>
                        )}

                        {/* Materials panel */}
                        {meas.materials_json && (
                          <MaterialsPanel
                            materials={meas.materials_json}
                            measurementId={meas.id}
                            compact={false}
                          />
                        )}
                        {lead && (
                          <button
                            onClick={() => setOfferLeadId(lead.id)}
                            className="w-full bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-bold active:scale-95 flex items-center justify-center gap-1.5"
                          >
                            📄 Открыть КП
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ══ КП ══════════════════════════════════════════════════════════════ */}
        {activeTab === "offers" && (
          <OffersList
            leads={leads}
            clients={clients}
            onOpenOffer={(leadId) => setOfferLeadId(leadId)}
          />
        )}

        {/* ══ НАСТРОЙКИ ═══════════════════════════════════════════════════════ */}
        {activeTab === "settings" && (
          <div className="px-4 py-4 space-y-4 pb-8">

            {/* Material Template Editor */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <SectionHeader icon="📦" title="Шаблон материалов" />
              <div className="p-4">
                <p className="text-xs text-slate-500 mb-4">
                  Настройте список материалов и формулы расчёта. При сохранении замера система автоматически рассчитает количество.
                </p>
                <TemplateEditor />
              </div>
            </div>

            {/* Telegram */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <SectionHeader icon="📨" title="Telegram-уведомления" />
              <div className="p-4 space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm text-blue-800 space-y-2">
                  <p className="font-bold">Как настроить уведомления:</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs text-blue-700">
                    <li>Откройте Telegram, найдите <span className="font-mono bg-blue-100 px-1 rounded">@userinfobot</span></li>
                    <li>Нажмите <b>Start</b> — бот покажет ваш числовой ID</li>
                    <li>Вставьте ID в поле ниже и нажмите «Сохранить»</li>
                    <li>Нажмите «Тест» для проверки соединения</li>
                  </ol>
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-1.5">
                    Chat ID администратора
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={tgChatId}
                    onChange={e => setTgChatId(e.target.value)}
                    placeholder="123456789"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>

                {configMsg && (
                  <div
                    className={`rounded-xl px-4 py-3 text-sm font-medium ${
                      configMsg.ok
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-red-50 text-red-700 border border-red-200"
                    }`}
                  >
                    {configMsg.text}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={saveConfig}
                    disabled={savingConfig || !tgChatId.trim()}
                    className="flex-1 bg-slate-800 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-50 active:scale-95 transition-transform"
                  >
                    {savingConfig ? "Сохранение..." : "💾 Сохранить"}
                  </button>
                  <button
                    onClick={testTg}
                    disabled={testingTg || !tgChatId.trim()}
                    className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-50 active:scale-95 transition-transform"
                  >
                    {testingTg ? "Отправка..." : "📤 Тест"}
                  </button>
                </div>
              </div>
            </div>

            {/* App info */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <SectionHeader icon="ℹ️" title="О системе" />
              <div className="p-4 space-y-2 text-sm text-slate-600">
                <p>🏢 CRM для компании по установке кондиционеров</p>
                <p>🤖 AI-менеджер на базе <span className="font-semibold">GPT-4o-mini</span></p>
                <p>📊 Воронка: Новый → Замер → КП → Сделка → Выполнено</p>
                <p>🔧 Замеры монтажника с фото и подписью клиента</p>
                <p>📦 Автоматический расчёт материалов по шаблону</p>
                <p>📄 Генератор КП с 3 вариантами (Эконом/Стандарт/Премиум)</p>
                <p>☁️ Supabase KV Store + Storage</p>
                <p className="text-xs text-slate-400 pt-1">
                  {new Date().toLocaleDateString("ru-RU", { year: "numeric", month: "long" })}
                </p>
              </div>
            </div>

          </div>
        )}
      </div>

      <Toast msg={toastMsg} />

      {/* Installer assignment modal */}
      {assignLeadId && (() => {
        const lead = leads.find(l => l.id === assignLeadId);
        const client = lead ? clients[lead.clientId] : null;
        return (
          <AssignInstallerModal
            leadId={assignLeadId}
            clientName={client?.name || "—"}
            onAssigned={() => {
              showToast("Монтажник назначен ✅");
              fetchData();
            }}
            onClose={() => setAssignLeadId(null)}
          />
        );
      })()}
    </div>
  );
}