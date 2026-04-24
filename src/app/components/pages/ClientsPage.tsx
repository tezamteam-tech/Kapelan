import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Users, Search, RefreshCw, Phone, ClipboardCheck, Loader2, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { API_BASE, AH, JH, getJson, invalidateUrlPrefix } from "../../lib/apiClient";

type LeadStatus = "new" | "measurement" | "offer" | "deal" | "done";

type Lead = {
  id: string;
  clientId: string;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
};

type Client = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  type?: "individual" | "company";
  legal_name?: string;
  tax_id?: string;
  address?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export function ClientsPage() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const selectedId = sp.get("id") || "";

  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Record<string, Client>>({});
  const [selected, setSelected] = useState<{ client: Client; leads: Lead[] } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  const [eType, setEType] = useState<Client["type"]>("individual");
  const [eName, setEName] = useState("");
  const [ePhone, setEPhone] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [eLegalName, setELegalName] = useState("");
  const [eTaxId, setETaxId] = useState("");
  const [eAddress, setEAddress] = useState("");
  const [eNotes, setENotes] = useState("");

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 2600);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cl, ld] = await Promise.all([
        getJson<{ clients?: Client[] }>(`${API_BASE}/clients`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true }),
        getJson<{ leads?: Lead[] }>(`${API_BASE}/leads`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true }),
      ]);
      const map: Record<string, Client> = {};
      for (const c of (cl.clients ?? [])) map[c.id] = c;
      setClients(map);
      const ls = (ld.leads ?? []) as Lead[];
      setLeads(ls);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const byClient = new Map<string, { leads: Lead[] }>();
    for (const l of leads) {
      const e = byClient.get(l.clientId) ?? { leads: [] };
      e.leads.push(l);
      byClient.set(l.clientId, e);
    }
    const list = [...byClient.entries()].map(([clientId, v]) => {
      const c = clients[clientId];
      const last = v.leads.reduce((mx, l) => Math.max(mx, new Date(l.updatedAt || l.createdAt).getTime()), 0);
      const counts = v.leads.reduce((acc, l) => {
        acc[l.status] = (acc[l.status] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      return {
        clientId,
        name: c?.name || "—",
        phone: c?.phone || "",
        leads: v.leads,
        lastTs: last,
        counts,
      };
    });

    const qq = q.trim().toLowerCase();
    const filtered = !qq ? list : list.filter((r) =>
      r.name.toLowerCase().includes(qq) || r.phone.includes(qq) || r.clientId.toLowerCase().includes(qq),
    );
    filtered.sort((a, b) => b.lastTs - a.lastTs);
    return filtered;
  }, [leads, clients, q]);

  const openClient = useCallback(async (id: string) => {
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      n.set("id", id);
      return n;
    });
    const client = clients[id] ?? null;
    const leadsForClient = rows.find((r) => r.clientId === id)?.leads ?? [];
    setSelected(client ? { client, leads: leadsForClient } : null);
  }, [clients, rows, setSp]);

  useEffect(() => {
    if (!selectedId) return;
    if (selected?.client.id === selectedId) return;
    void openClient(selectedId);
  }, [selectedId, selected, openClient]);

  const selectedClient = selected?.client ?? (selectedId ? clients[selectedId] : null);
  const selectedLeads = selected?.leads ?? (selectedId ? rows.find((r) => r.clientId === selectedId)?.leads ?? [] : []);

  useEffect(() => {
    if (!selectedClient) return;
    setEType(selectedClient.type ?? "individual");
    setEName(selectedClient.name ?? "");
    setEPhone(selectedClient.phone ?? "");
    setEEmail(String(selectedClient.email ?? ""));
    setELegalName(selectedClient.legal_name ?? "");
    setETaxId(selectedClient.tax_id ?? "");
    setEAddress(selectedClient.address ?? "");
    setENotes(selectedClient.notes ?? "");
  }, [selectedClient?.id]);

  const dirty = useMemo(() => {
    if (!selectedClient) return false;
    return (
      (eType ?? "individual") !== (selectedClient.type ?? "individual") ||
      eName.trim() !== (selectedClient.name ?? "") ||
      ePhone.trim() !== (selectedClient.phone ?? "") ||
      (eEmail.trim() || "") !== String(selectedClient.email ?? "") ||
      (eLegalName.trim() || "") !== String(selectedClient.legal_name ?? "") ||
      (eTaxId.trim() || "") !== String(selectedClient.tax_id ?? "") ||
      (eAddress.trim() || "") !== String(selectedClient.address ?? "") ||
      (eNotes.trim() || "") !== String(selectedClient.notes ?? "")
    );
  }, [eAddress, eEmail, eLegalName, eName, eNotes, ePhone, eTaxId, eType, selectedClient]);

  const saveClient = useCallback(async () => {
    if (!selectedClient) return;
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/client/${selectedClient.id}`, {
        method: "PATCH",
        headers: JH,
        body: JSON.stringify({
          type: eType ?? "individual",
          name: eName.trim(),
          phone: ePhone.trim(),
          email: eEmail.trim() ? eEmail.trim() : null,
          legal_name: eLegalName.trim(),
          tax_id: eTaxId.trim(),
          address: eAddress.trim(),
          notes: eNotes.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
      setClients((prev) => ({ ...prev, [d.client.id]: d.client }));
      setSelected((prev) => (prev ? { ...prev, client: d.client } : prev));
      invalidateUrlPrefix(`${API_BASE}/clients`);
      showToast("Карточка клиента сохранена");
    } catch (e: any) {
      showToast(e?.message || "Ошибка сохранения", false);
    } finally {
      setSaving(false);
    }
  }, [eAddress, eEmail, eLegalName, eName, eNotes, ePhone, eTaxId, eType, saving, selectedClient, showToast]);

  return (
    <div className="h-full bg-slate-50 overflow-hidden flex flex-col">
      <div className="bg-white border-b border-slate-200 px-4 sm:px-5 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Users size={16} /> Клиенты
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Список клиентов и их ордера/заявки</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold active:scale-95"
          >
            <Plus size={16} /> Добавить
          </button>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
            title="Обновить"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="px-4 py-2 bg-white border-b border-slate-100">
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <Search size={14} className="text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по клиенту/телефону/ID…"
            className="bg-transparent flex-1 text-sm text-slate-700 placeholder-slate-400 outline-none"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-3 p-3 sm:p-4 overflow-hidden">
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Клиенты · {rows.length}
            </p>
            {loading ? <Loader2 size={14} className="animate-spin text-slate-300" /> : null}
          </div>
          <div className="flex-1 overflow-auto">
            {rows.map((r) => {
              const active = r.clientId === selectedId;
              return (
                <button
                  key={r.clientId}
                  onClick={() => void openClient(r.clientId)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-all ${
                    active ? "bg-indigo-50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{r.name}</p>
                      <p className="text-xs text-slate-500 flex items-center gap-1">
                        <Phone size={12} className="text-slate-400" /> {r.phone || "—"}
                      </p>
                    </div>
                    <ChevronRight size={16} className={active ? "text-indigo-600" : "text-slate-300"} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(["new","measurement","offer","deal","done"] as LeadStatus[]).map((s) => {
                      const v = r.counts[s] ?? 0;
                      if (!v) return null;
                      return (
                        <span key={s} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {s}: {v}
                        </span>
                      );
                    })}
                  </div>
                </button>
              );
            })}
            {rows.length === 0 && !loading ? (
              <div className="p-10 text-center text-slate-400">
                <Users size={28} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm font-semibold">Клиентов пока нет</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Карточка клиента</p>
              <p className="text-base font-black text-slate-800 mt-1">{selectedClient?.name || "Выберите клиента"}</p>
              <p className="text-sm text-slate-500">{selectedClient?.phone || ""}</p>
            </div>
            {selectedClient ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/orders?clientId=${encodeURIComponent(selectedClient.id)}`)}
                  className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold active:scale-95"
                  title="Открыть ордера клиента"
                >
                  <ClipboardCheck size={16} /> Ордеры
                </button>
                <button
                  onClick={async () => {
                    if (deleting) return;
                    const ok = confirm(
                      `Удалить клиента "${selectedClient.name}"?\n\nВНИМАНИЕ: будет удалена вся связанная история (ордера/заявки/документы). Это действие необратимо.\n\nЕсли данных много — удаление может занять 10–30 секунд.`,
                    );
                    if (!ok) return;

                    setDeleting(true);
                    // instant UI feedback
                    showToast("Удаляем клиента…", true);
                    const prevClient = selectedClient;
                    setSelected(null);
                    setSp((prev) => {
                      const n = new URLSearchParams(prev);
                      n.delete("id");
                      return n;
                    });
                    setClients((prev) => {
                      const next = { ...prev };
                      delete next[prevClient.id];
                      return next;
                    });
                    setLeads((prev) => prev.filter((l) => l.clientId !== prevClient.id));

                    try {
                      const res = await fetch(`${API_BASE}/client/${prevClient.id}`, { method: "DELETE", headers: AH });
                      const d = await res.json().catch(() => ({}));
                      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
                      invalidateUrlPrefix(`${API_BASE}/clients`);
                      invalidateUrlPrefix(`${API_BASE}/leads`);
                      showToast("Клиент удалён");
                      void load();
                    } catch (e: any) {
                      showToast(e?.message || "Ошибка удаления", false);
                      void load(); // restore
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  disabled={deleting}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold active:scale-95 ${
                    deleting ? "bg-red-300 text-white cursor-not-allowed" : "bg-red-600 text-white"
                  }`}
                  title="Удалить клиента и связанные ордера"
                >
                  {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  {deleting ? "Удаление…" : "Удалить"}
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex-1 overflow-auto p-5">
            {!selectedClient ? (
              <div className="text-slate-400 text-sm">Выберите клиента слева, чтобы увидеть детали и связанные ордера/заявки.</div>
            ) : (
              <div className="space-y-4">
                <div className="border border-slate-200 rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Данные клиента</p>
                      <p className="text-[12px] text-slate-500 mt-1">
                        Эти данные используются в ордерах и документах.
                      </p>
                    </div>
                    <button
                      onClick={() => void saveClient()}
                      disabled={!dirty || saving}
                      className={`px-4 py-2 rounded-xl text-sm font-black ${
                        dirty ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-500 cursor-not-allowed"
                      }`}
                    >
                      {saving ? "Сохранение…" : "Сохранить"}
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-500">Тип</span>
                      <select value={eType ?? "individual"} onChange={(e) => setEType(e.target.value as any)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm">
                        <option value="individual">Физ. лицо</option>
                        <option value="company">Юр. лицо</option>
                      </select>
                    </label>
                    <div />
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-500">ФИО / Контакт</span>
                      <input value={eName} onChange={(e) => setEName(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-500">Телефон</span>
                      <input value={ePhone} onChange={(e) => setEPhone(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-500">Email</span>
                      <input value={eEmail} onChange={(e) => setEEmail(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" placeholder="—" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-500">Адрес (для документов/ордеров)</span>
                      <input value={eAddress} onChange={(e) => setEAddress(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" placeholder="—" />
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-xs font-semibold text-slate-500">Юр. название (для документов)</span>
                      <input value={eLegalName} onChange={(e) => setELegalName(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" placeholder={eType === "company" ? "ООО «…»" : "—"} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-500">УНП / ИНН</span>
                      <input value={eTaxId} onChange={(e) => setETaxId(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" placeholder="—" />
                    </label>
                    <div />
                    <label className="block md:col-span-2">
                      <span className="text-xs font-semibold text-slate-500">Примечания</span>
                      <textarea value={eNotes} onChange={(e) => setENotes(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm min-h-[90px]" placeholder="—" />
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {(["new","measurement","offer","deal","done"] as LeadStatus[]).map((s) => {
                    const v = selectedLeads.filter((l) => l.status === s).length;
                    return (
                      <div key={s} className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                        <p className="text-[10px] text-slate-500 font-bold uppercase">{s}</p>
                        <p className="text-xl font-black text-slate-800">{v}</p>
                      </div>
                    );
                  })}
                </div>

                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Ордера/заявки</p>
                  <div className="space-y-2">
                    {selectedLeads.map((l) => (
                      <div key={l.id} className="border border-slate-200 rounded-2xl p-3 flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-slate-800">Lead {l.id.slice(-6)}</p>
                          <p className="text-xs text-slate-500">status: {l.status}</p>
                        </div>
                        <button
                          onClick={() => navigate(`/orders?leadId=${encodeURIComponent(l.id)}`)}
                          className="text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl text-xs font-bold"
                        >
                          Открыть
                        </button>
                      </div>
                    ))}
                    {selectedLeads.length === 0 ? (
                      <div className="text-sm text-slate-400">Связанных заявок пока нет.</div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4">
          <div className="w-full sm:max-w-lg h-[92vh] sm:h-auto bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-800">Новый клиент</h3>
              <button onClick={() => setCreateOpen(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 sm:p-5 space-y-3 overflow-auto">
              <input className="w-full border border-slate-200 rounded-xl px-3 py-2" placeholder="Имя клиента"
                value={cName} onChange={(e) => setCName(e.target.value)} />
              <input className="w-full border border-slate-200 rounded-xl px-3 py-2" placeholder="Телефон"
                value={cPhone} onChange={(e) => setCPhone(e.target.value)} />
              <input className="w-full border border-slate-200 rounded-xl px-3 py-2" placeholder="Email (необязательно)"
                value={cEmail} onChange={(e) => setCEmail(e.target.value)} />
            </div>
            <div className="px-4 sm:px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button onClick={() => setCreateOpen(false)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold">
                Отмена
              </button>
              <button
                disabled={creating || !cName.trim() || !cPhone.trim()}
                onClick={async () => {
                  try {
                    setCreating(true);
                    const res = await fetch(`${API_BASE}/clients`, {
                      method: "POST",
                      headers: JH,
                      body: JSON.stringify({ name: cName, phone: cPhone, email: cEmail || null }),
                    });
                    const d = await res.json();
                    if (d.error) throw new Error(d.error);
                    setCreateOpen(false);
                    setCName(""); setCPhone(""); setCEmail("");
                    invalidateUrlPrefix(`${API_BASE}/clients`);
                    showToast("Клиент создан");
                    await load();
                  } catch (e: any) {
                    showToast(e?.message || "Ошибка создания", false);
                  } finally {
                    setCreating(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black disabled:opacity-60"
              >
                {creating ? "..." : "Создать"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl shadow-xl text-white text-sm font-semibold whitespace-nowrap transition-all">
          <div className={`${toast.ok ? "bg-emerald-600" : "bg-red-600"} px-4 py-3 rounded-2xl flex items-center gap-2`}>
            <span className="size-2 rounded-full bg-white/80" /> {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}

