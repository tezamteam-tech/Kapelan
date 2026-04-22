import React, { useCallback, useEffect, useMemo, useState } from "react";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { FileText, Loader2, RefreshCw, Search, Download, CheckCircle2 } from "lucide-react";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

type OrderStatus =
  | "new"
  | "qualification"
  | "survey_scheduled"
  | "survey_done"
  | "offer_prepared"
  | "offer_sent"
  | "offer_approved"
  | "awaiting_supply"
  | "ready_to_schedule"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "closed"
  | "cancelled";

interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  type: string;
  client_name?: string;
  client_phone?: string;
  object_address?: string;
  client_legal_name?: string;
  client_tax_id?: string;
  client_email?: string;
  client_doc_basis?: string;
  offer?: { version: number; status: string; lines: any[] };
  created_at: string;
  updated_at: string;
}

const inputCls =
  "w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

async function downloadPdf(url: string, filename: string) {
  const res = await fetch(url, { headers: AH });
  if (!res.ok) throw new Error(`Не удалось сформировать документ (${res.status})`);
  const blob = await res.blob();
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(u);
}

export function OrderDocumentsBuilder() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/orders`, { headers: AH });
      const data = await res.json();
      setOrders(data.orders ?? []);
      if (!selectedId && (data.orders?.[0]?.id ?? "")) setSelectedId(data.orders[0].id);
    } catch (e: any) {
      showToast(e?.message || "Ошибка загрузки ордеров", false);
    } finally {
      setLoading(false);
    }
  }, [selectedId, showToast]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const selected = useMemo(() => orders.find((o) => o.id === selectedId) ?? null, [orders, selectedId]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return orders;
    return orders.filter((o) => {
      const blob = `${o.number} ${o.client_name ?? ""} ${o.client_phone ?? ""} ${o.object_address ?? ""}`.toLowerCase();
      return blob.includes(qq);
    });
  }, [orders, q]);

  // Editable details (kept inside Order)
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [address, setAddress] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState("");
  const [basis, setBasis] = useState("");

  useEffect(() => {
    setClientName(selected?.client_name ?? "");
    setClientPhone(selected?.client_phone ?? "");
    setAddress(selected?.object_address ?? "");
    setLegalName(selected?.client_legal_name ?? "");
    setTaxId(selected?.client_tax_id ?? "");
    setEmail(selected?.client_email ?? "");
    setBasis(selected?.client_doc_basis ?? "");
  }, [
    selected?.id,
    selected?.client_name,
    selected?.client_phone,
    selected?.object_address,
    selected?.client_legal_name,
    selected?.client_tax_id,
    selected?.client_email,
    selected?.client_doc_basis,
  ]);

  const dirty =
    !!selected &&
    (clientName !== (selected.client_name ?? "") ||
      clientPhone !== (selected.client_phone ?? "") ||
      address !== (selected.object_address ?? "") ||
      legalName !== (selected.client_legal_name ?? "") ||
      taxId !== (selected.client_tax_id ?? "") ||
      email !== (selected.client_email ?? "") ||
      basis !== (selected.client_doc_basis ?? ""));

  async function saveOrderDetails() {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/orders/${selected.id}`, {
        method: "PATCH",
        headers: JH,
        body: JSON.stringify({
          client_name: clientName.trim(),
          client_phone: clientPhone.trim(),
          object_address: address.trim(),
          client_legal_name: legalName.trim() || undefined,
          client_tax_id: taxId.trim() || undefined,
          client_email: email.trim() || undefined,
          client_doc_basis: basis.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      showToast("Данные ордера сохранены");
    } catch (e: any) {
      showToast(e?.message || "Ошибка сохранения", false);
    } finally {
      setSaving(false);
    }
  }

  async function makeOfferPdf() {
    if (!selected) return;
    await downloadPdf(`${API}/orders/${selected.id}/offer/pdf`, `offer_${selected.number}.pdf`);
    showToast("КП сформировано");
  }

  async function makeActPdf() {
    if (!selected) return;
    await downloadPdf(`${API}/orders/${selected.id}/act/pdf`, `act_${selected.number}.pdf`);
    showToast("Акт сформирован");
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="size-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center">
            <FileText size={18} />
          </div>
          <div>
            <p className="text-lg font-black text-slate-900">Документы (конструктор)</p>
            <p className="text-[12px] text-slate-500">Сначала выбираем ордер, потом формируем документы внутри него.</p>
          </div>
        </div>
        <button
          onClick={loadOrders}
          disabled={loading}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Обновить
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
        {/* Left: Orders */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-3 border-b border-slate-100">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <Search size={14} className="text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} className="bg-transparent flex-1 outline-none text-sm" placeholder="Поиск ордера…" />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{filtered.length} ордеров</p>
          </div>
          <div className="max-h-[640px] overflow-auto p-2 space-y-2">
            {loading && orders.length === 0 ? (
              <div className="flex justify-center py-12 text-slate-300">
                <Loader2 className="animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-10 text-sm text-slate-400">Нет ордеров</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setSelectedId(o.id)}
                  className={`w-full text-left rounded-2xl border p-3 transition-all ${
                    o.id === selectedId ? "border-blue-200 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <p className="text-sm font-extrabold text-slate-800 truncate">{o.number}</p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {(o.client_name || "Клиент") + (o.object_address ? ` · ${o.object_address}` : "")}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">{fmtDate(o.created_at)}</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: builder */}
        <div className="space-y-4">
          {!selected ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 text-slate-400 text-sm">Выберите ордер слева.</div>
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-800">Ордeр: {selected.number}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Документы формируются из данных этого ордера. Если уточняем данные — уточняем тут же, внутри ордера.
                    </p>
                  </div>
                  <button
                    disabled={!dirty || saving}
                    onClick={saveOrderDetails}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                      dirty ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500 cursor-not-allowed"
                    }`}
                  >
                    {saving ? "Сохранение..." : "Сохранить данные"}
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Клиент</span>
                    <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={`${inputCls} mt-1`} />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Телефон</span>
                    <input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className={`${inputCls} mt-1`} />
                  </label>
                </div>
                <div className="mt-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Адрес объекта</span>
                    <input value={address} onChange={(e) => setAddress(e.target.value)} className={`${inputCls} mt-1`} />
                  </label>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Юр.лицо / ФИО (для документов)</span>
                    <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={`${inputCls} mt-1`} placeholder="—" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">ИНН / ЕГРПОУ</span>
                    <input value={taxId} onChange={(e) => setTaxId(e.target.value)} className={`${inputCls} mt-1`} placeholder="—" />
                  </label>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Email</span>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mt-1`} placeholder="—" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Основание (договор/счет)</span>
                    <input value={basis} onChange={(e) => setBasis(e.target.value)} className={`${inputCls} mt-1`} placeholder="—" />
                  </label>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-800">Конструктор документов</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Выберите документ и сформируйте его для выбранного ордера.</p>
                  </div>
                  <span className="text-[11px] text-slate-400">PDF</span>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  <button
                    onClick={() => makeOfferPdf().catch((e: any) => showToast(e?.message || "Ошибка", false))}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 hover:bg-blue-100 transition-all"
                  >
                    <div className="min-w-0 text-left">
                      <p className="text-sm font-extrabold text-blue-900 truncate">Коммерческое предложение (КП)</p>
                      <p className="text-[11px] text-blue-700 truncate">Берётся из `order.offer.lines` + реквизиты клиента</p>
                    </div>
                    <Download className="size-4 text-blue-700 flex-shrink-0" />
                  </button>

                  <button
                    onClick={() => makeActPdf().catch((e: any) => showToast(e?.message || "Ошибка", false))}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 hover:bg-slate-100 transition-all"
                  >
                    <div className="min-w-0 text-left">
                      <p className="text-sm font-extrabold text-slate-900 truncate">Акт выполненных работ</p>
                      <p className="text-[11px] text-slate-600 truncate">Берётся из ордера + КП + исполнения</p>
                    </div>
                    <Download className="size-4 text-slate-700 flex-shrink-0" />
                  </button>
                </div>

                <div className="mt-3 text-[11px] text-slate-400">
                  Дальше сюда добавим: счет, договор, спецификацию, гарантийный талон, приложения и шаблоны под разные компании.
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-5 right-5 z-[100]`}>
          <div className={`px-4 py-3 rounded-2xl shadow-lg border text-sm font-semibold flex items-center gap-2 ${
            toast.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
          }`}>
            <CheckCircle2 size={16} /> {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}

