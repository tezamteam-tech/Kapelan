import React, { useState, useEffect, useCallback } from "react";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import {
  UserPlus, Phone, MessageCircle, Wrench, Loader2,
  Check, Calendar, Clock, Send, Trash2, Edit2, X, Plus, Camera
} from "lucide-react";
import { AvatarUpload } from "./ui/ImageUpload";
import { getJson } from "../lib/apiClient";

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

export interface Installer {
  id: string;
  name: string;
  phone: string;
  tgChatId: string | null;
  specialization: string;
  notes: string;
  active: boolean;
  photoUrl?: string;
  teamId?: string | null;
  teamName?: string | null;
  isTeamLead?: boolean;
  createdAt: string;
}

interface Assignment {
  id: string;
  leadId: string;
  installerId: string;
  installerName: string;
  clientName: string;
  clientPhone: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  notes: string;
  status: string;
  createdAt: string;
}

// ─── Installer Assignment Modal (used from AdminView lead detail) ─────────────
interface AssignInstallerProps {
  leadId: string;
  clientName: string;
  onAssigned: () => void;
  onClose: () => void;
}

export function AssignInstallerModal({ leadId, clientName, onAssigned, onClose }: AssignInstallerProps) {
  const [installers, setInstallers] = useState<Installer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [notes, setNotes] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Assignment | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [instData, assignData] = await Promise.all([
          getJson<any>(`${API_BASE}/installers`, { ttlMs: 5 * 60_000, staleTtlMs: 30 * 60_000, swr: true }),
          getJson<any>(`${API_BASE}/assignment/lead/${leadId}`, { ttlMs: 30_000, staleTtlMs: 10 * 60_000, swr: true }),
        ]);
        if (instData.installers) setInstallers(instData.installers);
        if (assignData.assignment) {
          setExisting(assignData.assignment);
          setSelectedId(assignData.assignment.installerId);
          setScheduledDate(assignData.assignment.scheduledDate || "");
          setScheduledTime(assignData.assignment.scheduledTime || "");
          setNotes(assignData.assignment.notes || "");
        }
      } catch (err) {
        console.error("Load installers error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [leadId]);

  const handleAssign = async () => {
    if (!selectedId) { setError("Выберите монтажника"); return; }
    setAssigning(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/assign-installer`, {
        method: "POST",
        headers: JH,
        body: JSON.stringify({ leadId, installerId: selectedId, scheduledDate, scheduledTime, notes }),
      });
      const data = await res.json();
      if (data.success) {
        onAssigned();
        onClose();
      } else {
        setError(data.error || "Ошибка назначения");
      }
    } catch (err: any) {
      setError(`Ошибка: ${err.message}`);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Wrench className="size-5 text-blue-600" />
              Назначить монтажника
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">Клиент: {clientName}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="size-5 text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {existing && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700">
              ✅ Уже назначен: <strong>{existing.installerName}</strong>
              {existing.scheduledDate && <> · 📅 {existing.scheduledDate}</>}
              {existing.scheduledTime && <> {existing.scheduledTime}</>}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-slate-400" />
            </div>
          ) : installers.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <UserPlus className="size-10 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-medium">Монтажников ещё нет</p>
              <p className="text-xs mt-1">Добавьте монтажников на странице "Пользователи"</p>
            </div>
          ) : (
            <>
              {/* Installer list */}
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Выберите монтажника</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {installers.map(inst => (
                    <button
                      key={inst.id}
                      onClick={() => setSelectedId(inst.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                        selectedId === inst.id
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-100 hover:border-slate-200 bg-white"
                      }`}
                    >
                      {/* Avatar with photo */}
                      <div className="size-10 rounded-full overflow-hidden flex-shrink-0">
                        {inst.photoUrl ? (
                          <img src={inst.photoUrl} alt={inst.name} className="w-full h-full object-cover"
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <div className={`w-full h-full flex items-center justify-center ${
                            selectedId === inst.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                          }`}>
                            {selectedId === inst.id ? <Check className="size-5" /> : <span className="font-black text-base">{inst.name.charAt(0)}</span>}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 truncate">{inst.name}</p>
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                          <span className="flex items-center gap-1"><Phone className="size-3" />{inst.phone}</span>
                          {inst.tgChatId && (
                            <span className="flex items-center gap-1 text-blue-500">
                              <MessageCircle className="size-3" /> TG
                            </span>
                          )}
                        </div>
                      </div>
                      {inst.specialization && inst.specialization !== "general" && (
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                          {inst.specialization}
                        </span>
                      )}
                      {selectedId === inst.id && (
                        <Check className="size-4 text-blue-600 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">
                    <Calendar className="size-3 inline mr-1" />Дата
                  </label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">
                    <Clock className="size-3 inline mr-1" />Время
                  </label>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Комментарий для монтажника</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Доп. информация, подъезд, этаж, домофон..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-3 text-sm font-semibold hover:bg-slate-200 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleAssign}
              disabled={assigning || !selectedId || installers.length === 0}
              className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-50 hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
            >
              {assigning ? (
                <><Loader2 className="size-4 animate-spin" /> Назначение...</>
              ) : (
                <><Send className="size-4" /> Назначить</>
              )}
            </button>
          </div>

          {/* TG info */}
          {selectedId && installers.find(i => i.id === selectedId)?.tgChatId && (
            <p className="text-xs text-center text-blue-500">
              📨 Монтажник получит Telegram-уведомление с деталями заказа
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Installers Management (for UsersPage) ────────────────────────────────────
export function InstallersManager() {
  const [installers, setInstallers] = useState<Installer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    tgChatId: "",
    specialization: "general",
    notes: "",
    photoUrl: "",
    teamName: "",
    isTeamLead: false,
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const showToast = (text: string, ok = true) => { setToast({ text, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    try {
      const data = await getJson<any>(`${API_BASE}/installers`, { ttlMs: 5 * 60_000, staleTtlMs: 30 * 60_000, swr: true });
      if (data.installers) setInstallers(data.installers);
    } catch (err) {
      console.error("Load installers error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const teams = React.useMemo(() => {
    const map = new Map<string, { teamId: string; teamName: string; leadName?: string }>();
    for (const inst of installers) {
      const tid = String(inst.teamId || "").trim();
      const tname = String(inst.teamName || "").trim();
      if (!tid || !tname) continue;
      if (!map.has(tid)) map.set(tid, { teamId: tid, teamName: tname });
      if (inst.isTeamLead) map.get(tid)!.leadName = inst.name;
    }
    return Array.from(map.values()).sort((a, b) => a.teamName.localeCompare(b.teamName, "ru"));
  }, [installers]);

  const slugify = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9а-яё\-]+/gi, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

  const resetForm = () => {
    setForm({ name: "", phone: "", tgChatId: "", specialization: "general", notes: "", photoUrl: "", teamName: "", isTeamLead: false });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.phone.trim()) return;
    setSaving(true);
    try {
      const teamName = form.teamName.trim();
      const teamId = teamName ? slugify(teamName) : null;
      const body: any = {
        name: form.name,
        phone: form.phone,
        tgChatId: form.tgChatId || null,
        specialization: form.specialization,
        notes: form.notes,
        photoUrl: form.photoUrl || null,
        teamName: teamName || null,
        teamId,
        isTeamLead: !!form.isTeamLead,
      };
      if (editingId) body.id = editingId;
      const res = await fetch(`${API_BASE}/installers`, { method: "POST", headers: JH, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.installer) {
        // Enforce single team lead per team (best-effort)
        if (body.isTeamLead && body.teamId) {
          const others = installers.filter(i => i.id !== data.installer.id && (i.teamId || null) === body.teamId && i.isTeamLead);
          await Promise.all(
            others.map(i =>
              fetch(`${API_BASE}/installers/${i.id}`, {
                method: "PATCH",
                headers: JH,
                body: JSON.stringify({ isTeamLead: false }),
              }).catch(() => null)
            )
          );
        }
        showToast(editingId ? "Обновлено ✅" : "Монтажник добавлен ✅");
        resetForm();
        load();
      }
    } catch (err: any) {
      showToast(`Ошибка: ${err.message}`, false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить монтажника?")) return;
    try {
      await fetch(`${API_BASE}/installers/${id}`, { method: "DELETE", headers: AH });
      showToast("Удалено");
      load();
    } catch (err: any) {
      showToast(`Ошибка: ${err.message}`, false);
    }
  };

  const startEdit = (inst: Installer) => {
    setForm({
      name: inst.name,
      phone: inst.phone,
      tgChatId: inst.tgChatId || "",
      specialization: inst.specialization,
      notes: inst.notes,
      photoUrl: inst.photoUrl || "",
      teamName: inst.teamName || "",
      isTeamLead: !!inst.isTeamLead,
    });
    setEditingId(inst.id);
    setShowForm(true);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">👷 Монтажники</h2>
          <p className="text-sm text-slate-500">{installers.length} зарегистрировано</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          <Plus className="size-4" /> Добавить
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <p className="font-bold text-slate-800">{editingId ? "Редактировать монтажника" : "Новый монтажник"}</p>
            <button onClick={resetForm} className="text-slate-400 hover:text-slate-600"><X className="size-5" /></button>
          </div>

          {/* Photo upload centered */}
          <div className="flex justify-center">
            <AvatarUpload
              value={form.photoUrl}
              onChange={url => setForm(f => ({ ...f, photoUrl: url }))}
              folder="staff"
              name={form.name}
              size="lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Имя *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="Александр Петренко" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Телефон *</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="+380991234567" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Telegram Chat ID</label>
              <input value={form.tgChatId} onChange={e => setForm(f => ({ ...f, tgChatId: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="123456789" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Специализация</label>
              <select value={form.specialization} onChange={e => setForm(f => ({ ...f, specialization: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="general">Общая</option>
                <option value="split">Сплит-системы</option>
                <option value="multi">Мульти-сплит</option>
                <option value="ventilation">Вентиляция</option>
                <option value="industrial">Промышленное</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Заметки</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Опыт, район обслуживания..." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Бригада</label>
              <input
                list="installer-teams"
                value={form.teamName}
                onChange={e => setForm(f => ({ ...f, teamName: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="Напр. Бригада 1"
              />
              <datalist id="installer-teams">
                {teams.map(t => (
                  <option key={t.teamId} value={t.teamName} />
                ))}
              </datalist>
              {form.teamName.trim() && (
                <p className="text-[11px] text-slate-400 mt-1">ID: {slugify(form.teamName)}</p>
              )}
            </div>
            <div className="flex items-end">
              <label className="w-full flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                <span className="text-sm text-slate-700 font-semibold">Старший</span>
                <input
                  type="checkbox"
                  checked={form.isTeamLead}
                  onChange={e => setForm(f => ({ ...f, isTeamLead: e.target.checked }))}
                  className="size-4"
                />
              </label>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={resetForm} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-200">
              Отмена
            </button>
            <button onClick={handleSave} disabled={saving || !form.name.trim() || !form.phone.trim()}
              className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50 hover:bg-blue-700 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {editingId ? "Обновить" : "Добавить"}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-slate-400" />
        </div>
      ) : installers.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Wrench className="size-10 mx-auto mb-2 text-slate-300" />
          <p className="text-sm font-medium">Монтажников ещё нет</p>
          <p className="text-xs mt-1">Нажмите "Добавить" чтобы зарегистрировать монтажника</p>
        </div>
      ) : (
        <div className="space-y-2">
          {installers.map(inst => (
            <div key={inst.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4 hover:shadow-sm transition-shadow">
              {/* Avatar */}
              <div className="size-12 rounded-full overflow-hidden flex-shrink-0 shadow-sm">
                {inst.photoUrl ? (
                  <img src={inst.photoUrl} alt={inst.name} className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-black text-lg">
                    {inst.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 truncate">{inst.name}</p>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                  <span className="flex items-center gap-1"><Phone className="size-3" />{inst.phone}</span>
                  {inst.tgChatId && (
                    <span className="flex items-center gap-1 text-blue-500"><MessageCircle className="size-3" /> TG подключён</span>
                  )}
                  {inst.specialization !== "general" && (
                    <span className="bg-slate-100 px-2 py-0.5 rounded-full">{inst.specialization}</span>
                  )}
                  {inst.teamName && (
                    <span className={`px-2 py-0.5 rounded-full ${inst.isTeamLead ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
                      {inst.isTeamLead ? "★ " : ""}{inst.teamName}
                    </span>
                  )}
                </div>
                {inst.notes && <p className="text-xs text-slate-400 mt-1 truncate">{inst.notes}</p>}
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <button onClick={() => startEdit(inst)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                  <Edit2 className="size-4" />
                </button>
                <button onClick={() => handleDelete(inst.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-white text-sm font-semibold ${toast.ok ? "bg-green-600" : "bg-red-600"}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}