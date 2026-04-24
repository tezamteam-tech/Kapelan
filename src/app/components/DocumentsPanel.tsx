import React, { useState, useEffect, useCallback } from "react";
import { useCurrency } from "./CurrencyContext";
import { API_BASE, AH, JH, getJson, invalidateUrlPrefix } from "../lib/apiClient";

const API = API_BASE;

// ─── Types ────────────────────────────────────────────────────────────────────
interface DocumentRecord {
  id: string; leadId: string; offerId: string;
  contractNumber: string; contractDate: string; selectedTier: string;
  advancePct: number; totalAmount: number; advanceAmount: number; balanceAmount: number;
  contractUrl: string; specUrl: string; createdAt: string;
}

interface CompanyConfig {
  companyName: string; companyCode: string; companyDirector: string;
  companyPhone: string; city: string;
}

interface OfferVariant {
  tier: "economy" | "standard" | "premium";
  label: string; total: number; acTotal: number;
  materialsTotal: number; workCost: number;
  ac: { brand: string; model: string };
}

interface Offer {
  id: string; variants: OfferVariant[]; status: string; createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TIER_CFG = {
  economy:  { emoji: "💚", label: "Эконом",   color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  standard: { emoji: "💙", label: "Стандарт", color: "text-blue-700",    bg: "bg-blue-50",    border: "border-blue-200" },
  premium:  { emoji: "💜", label: "Премиум",  color: "text-violet-700",  bg: "bg-violet-50",  border: "border-violet-200" },
};

const fmt = (n: number) => n.toLocaleString("ru-RU");

// ─── Main Component ───────────────────────────────────────────────────────────
interface Props {
  leadId: string;
  offers: Offer[];
}

export function DocumentsPanel({ leadId, offers }: Props) {
  const { fmtShort, currency } = useCurrency();
  const fmt = fmtShort;
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Form state
  const [selectedOfferId, setSelectedOfferId] = useState<string>(offers[0]?.id ?? "");
  const [selectedTier, setSelectedTier] = useState<"economy" | "standard" | "premium">("standard");
  const [advancePct, setAdvancePct] = useState(50);
  const [contractNumber, setContractNumber] = useState("");
  const [docNotes, setDocNotes] = useState("");

  // Company config state
  const [company, setCompany] = useState<CompanyConfig>({
    companyName: 'ООО "КЛИМАТ СЕРВИС"', companyCode: "12345678",
    companyDirector: "Иванов И.И.", companyPhone: "+7 (999) 000-00-00", city: "Москва",
  });
  const [savingCompany, setSavingCompany] = useState(false);

  const showToast = useCallback((text: string, ok = true) => {
    setToastMsg({ text, ok });
    setTimeout(() => setToastMsg(null), 4000);
  }, []);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getJson<{ documents?: DocumentRecord[] }>(`${API}/documents/lead/${leadId}`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true });
      if (data.documents) setDocuments(data.documents);
    } catch (err) { console.error("Fetch documents error:", err); }
    finally { setLoading(false); }
  }, [leadId]);

  const fetchCompany = useCallback(async () => {
    try {
      const data = await getJson<{ config?: CompanyConfig }>(`${API}/company-config`, { ttlMs: 10 * 60_000, staleTtlMs: 60 * 60_000, swr: true });
      if (data.config) setCompany(data.config);
    } catch (err) { console.error("Fetch company error:", err); }
  }, []);

  useEffect(() => {
    fetchDocuments();
    fetchCompany();
  }, [fetchDocuments, fetchCompany]);

  // Sync selectedOfferId when offers change
  useEffect(() => {
    if (offers.length > 0 && !selectedOfferId) setSelectedOfferId(offers[0].id);
  }, [offers, selectedOfferId]);

  async function generate() {
    if (!selectedOfferId) { showToast("Выберите КП", false); return; }
    setGenerating(true);
    try {
      const res = await fetch(`${API}/documents/generate`, {
        method: "POST",
        headers: JH,
        body: JSON.stringify({
          leadId, offerId: selectedOfferId,
          selectedTier, advancePct, contractNumber: contractNumber || undefined,
          notes: docNotes, ...company,
          currencySymbol: currency.symbol,
        }),
      });
      const data = await res.json();
      if (data.document) {
        setDocuments(prev => [data.document, ...prev]);
        invalidateUrlPrefix(`${API}/documents/lead/${leadId}`);
        setShowForm(false);
        showToast("📄 Документы сформированы и сохранены!");
      } else {
        showToast(data.error || "Ошибка генерации", false);
      }
    } catch (err: any) {
      showToast(`Ошибка: ${err.message}`, false);
    } finally { setGenerating(false); }
  }

  async function saveCompany() {
    setSavingCompany(true);
    try {
      const res = await fetch(`${API}/company-config`, { method: "POST", headers: JH, body: JSON.stringify(company) });
      const data = await res.json();
      if (data.success) {
        invalidateUrlPrefix(`${API}/company-config`);
        setShowCompanyForm(false);
        showToast("Реквизиты сохранены ✅");
      }
      else showToast(data.error || "Ошибка", false);
    } catch (err: any) { showToast(`Ошибка: ${err.message}`, false); }
    finally { setSavingCompany(false); }
  }

  // Selected offer
  const selectedOffer = offers.find(o => o.id === selectedOfferId);
  const selectedVariant = selectedOffer?.variants.find(v => v.tier === selectedTier);

  return (
    <div className="mt-4 space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-lg">📝</span>
          <p className="text-sm font-bold text-slate-700">Договор и Спецификация</p>
          {documents.length > 0 && (
            <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">{documents.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowCompanyForm(f => !f); setShowForm(false); }}
            className="text-xs text-slate-500 bg-slate-100 px-2.5 py-1.5 rounded-xl font-semibold active:scale-95"
          >
            ⚙️ Реквизиты
          </button>
          <button
            onClick={() => { setShowForm(f => !f); setShowCompanyForm(false); }}
            className="text-xs text-indigo-700 bg-indigo-100 px-3 py-1.5 rounded-xl font-bold active:scale-95"
          >
            {showForm ? "Отмена" : "+ Сформировать"}
          </button>
        </div>
      </div>

      {/* Company config form */}
      {showCompanyForm && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Реквизиты компании</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              ["Название компании", "companyName"],
              ["ИНН/ОГРН", "companyCode"],
              ["Директор", "companyDirector"],
              ["Телефон", "companyPhone"],
              ["Город", "city"],
            ] as [string, keyof CompanyConfig][]).map(([label, key]) => (
              <div key={key} className={key === "companyName" || key === "companyDirector" ? "col-span-2" : ""}>
                <label className="text-[10px] text-slate-400 font-semibold uppercase block mb-1">{label}</label>
                <input
                  type="text"
                  value={company[key]}
                  onChange={e => setCompany(p => ({ ...p, [key]: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            ))}
          </div>
          <button
            onClick={saveCompany}
            disabled={savingCompany}
            className="w-full bg-slate-800 text-white rounded-xl py-2.5 text-sm font-bold active:scale-95 disabled:opacity-60"
          >
            {savingCompany ? "Сохранение..." : "💾 Сохранить реквизиты"}
          </button>
        </div>
      )}

      {/* Generation form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Параметры документов</p>

          {/* Select KP */}
          {offers.length > 1 && (
            <div>
              <label className="text-xs text-slate-500 font-semibold block mb-1.5">Коммерческое предложение</label>
              <div className="space-y-1.5">
                {offers.map((o, i) => (
                  <button
                    key={o.id}
                    onClick={() => setSelectedOfferId(o.id)}
                    className={`w-full text-left px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                      selectedOfferId === o.id ? "bg-indigo-600 text-white border-indigo-600" : "bg-slate-50 text-slate-600 border-slate-200"
                    }`}
                  >
                    КП #{offers.length - i} — {new Date(o.createdAt).toLocaleDateString("ru-RU")}
                    <span className={`ml-2 opacity-70`}>{o.status}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Select tier */}
          {selectedOffer && (
            <div>
              <label className="text-xs text-slate-500 font-semibold block mb-1.5">Вариант КП</label>
              <div className="grid grid-cols-3 gap-2">
                {selectedOffer.variants.map(v => {
                  const cfg = TIER_CFG[v.tier];
                  const active = selectedTier === v.tier;
                  return (
                    <button
                      key={v.tier}
                      onClick={() => setSelectedTier(v.tier)}
                      className={`rounded-xl border-2 p-2.5 text-center transition-all ${
                        active ? `${cfg.bg} ${cfg.border} ring-2 ring-offset-1 ring-indigo-400` : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <p className="text-lg">{cfg.emoji}</p>
                      <p className={`text-[10px] font-bold mt-0.5 ${active ? cfg.color : "text-slate-500"}`}>{v.label}</p>
                      <p className={`text-xs font-black mt-0.5 ${active ? cfg.color : "text-slate-700"}`}>{fmt(v.total)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Advance % */}
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-xs text-slate-500 font-semibold">Аванс: {advancePct}%</label>
              {selectedVariant && (
                <span className="text-xs font-bold text-indigo-700">
                  {fmt(Math.round(selectedVariant.total * advancePct / 100))}
                </span>
              )}
            </div>
            <input type="range" min={10} max={100} step={5} value={advancePct}
              onChange={e => setAdvancePct(+e.target.value)}
              className="w-full accent-indigo-600" />
            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
              {[10, 30, 50, 70, 100].map(p => <span key={p}>{p}%</span>)}
            </div>
          </div>

          {/* Price summary */}
          {selectedVariant && (
            <div className="bg-slate-50 rounded-xl p-3 space-y-1.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Сводка оплаты</p>
              <div className="flex justify-between text-xs text-slate-600">
                <span>💻 Оборудование</span><span className="font-semibold">{fmt(selectedVariant.acTotal)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-600">
                <span>🔩 Материалы</span><span className="font-semibold">{fmt(selectedVariant.materialsTotal)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-600">
                <span>🔧 Работы</span><span className="font-semibold">{fmt(selectedVariant.workCost)}</span>
              </div>
              <div className="border-t border-slate-200 pt-1.5 flex justify-between text-sm font-bold text-slate-800">
                <span>Итого</span><span>{fmt(selectedVariant.total)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-emerald-700">
                <span>Аванс ({advancePct}%)</span>
                <span>{fmt(Math.round(selectedVariant.total * advancePct / 100))}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-blue-700">
                <span>Остаток</span>
                <span>{fmt(selectedVariant.total - Math.round(selectedVariant.total * advancePct / 100))}</span>
              </div>
            </div>
          )}

          {/* Contract number (optional) */}
          <div>
            <label className="text-xs text-slate-500 font-semibold block mb-1.5">№ Договора (оставьте пустым для авто)</label>
            <input type="text" value={contractNumber} onChange={e => setContractNumber(e.target.value)}
              placeholder={`${new Date().getFullYear()}-XXXX`}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-slate-500 font-semibold block mb-1.5">Примечания к документам</label>
            <textarea value={docNotes} onChange={e => setDocNotes(e.target.value)}
              placeholder="Особые условия, сроки выполнения..."
              rows={2}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>

          {/* Generate button */}
          <button
            onClick={generate}
            disabled={generating || !selectedOfferId}
            className="w-full bg-gradient-to-r from-indigo-700 to-indigo-500 text-white rounded-2xl py-3.5 text-sm font-bold shadow-lg shadow-indigo-200 disabled:opacity-60 active:scale-95 transition-transform flex items-center justify-center gap-2"
          >
            {generating ? (
              <><span className="animate-spin text-base">⏳</span> Генерация PDF и сохранение...</>
            ) : (
              <><span className="text-base">📄</span> Сформировать Договор + Спецификацию</>
            )}
          </button>

          <p className="text-[10px] text-slate-400 text-center">
            PDF будет сохранён в Supabase Storage. Ссылка активна 30 дней.
          </p>
        </div>
      )}

      {/* Documents list */}
      {loading && documents.length === 0 && (
        <div className="flex justify-center py-6">
          <span className="animate-spin text-2xl text-slate-300">⏳</span>
        </div>
      )}

      {!loading && documents.length === 0 && !showForm && (
        <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-200 py-8 text-center">
          <p className="text-3xl mb-2">📄</p>
          <p className="text-sm text-slate-500 font-medium">Документы ещё не сформированы</p>
          <p className="text-xs text-slate-400 mt-1">Нажмите «Сформировать» чтобы создать договор и спецификацию</p>
        </div>
      )}

      {documents.map((doc, i) => (
        <DocumentCard key={doc.id} doc={doc} num={documents.length - i} />
      ))}

      {/* Toast */}
      {toastMsg && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-white text-sm font-semibold whitespace-nowrap max-w-xs text-center ${
          toastMsg.ok ? "bg-green-600" : "bg-red-600"
        }`}>
          {toastMsg.text}
        </div>
      )}
    </div>
  );
}

// ─── Document Card ────────────────────────────────────────────────────────────
function DocumentCard({ doc, num }: { doc: DocumentRecord; num: number }) {
  const { fmtShort } = useCurrency();
  const [expanded, setExpanded] = useState(num === 1);
  const tier = TIER_CFG[doc.selectedTier as keyof typeof TIER_CFG] ?? TIER_CFG.standard;

  const advance = Math.round(doc.totalAmount * doc.advancePct / 100);
  const balance = doc.totalAmount - advance;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 active:bg-slate-50"
      >
        {/* Icon */}
        <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">📄</span>
        </div>

        {/* Info */}
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-slate-800">Договор № {doc.contractNumber}</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tier.bg} ${tier.color}`}>
              {tier.emoji} {tier.label}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {doc.contractDate} · Аванс {doc.advancePct}% · {fmtShort(doc.totalAmount)}
          </p>
        </div>
        <span className="text-slate-300 text-sm flex-shrink-0">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
          {/* Amount grid */}
          <div className="grid grid-cols-3 gap-2">
            <AmountCell label="Итого" value={doc.totalAmount} color="text-slate-800" />
            <AmountCell label={`Аванс (${doc.advancePct}%)`} value={advance} color="text-emerald-700" />
            <AmountCell label="Остаток" value={balance} color="text-blue-700" />
          </div>

          {/* Download buttons */}
          <div className="grid grid-cols-2 gap-2">
            <a
              href={doc.contractUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 bg-indigo-600 text-white rounded-xl py-3 text-sm font-bold active:scale-95 transition-transform"
            >
              <span>📋</span> Договор
            </a>
            <a
              href={doc.specUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 bg-teal-600 text-white rounded-xl py-3 text-sm font-bold active:scale-95 transition-transform"
            >
              <span>📊</span> Спецификация
            </a>
          </div>

          {/* Meta */}
          <div className="text-[10px] text-slate-400 flex justify-between">
            <span>📅 {new Date(doc.createdAt).toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit" })}</span>
            <span>Хранится 30 дней</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AmountCell({ label, value, color }: { label: string; value: number; color: string }) {
  const { fmtShort } = useCurrency();
  return (
    <div className="bg-slate-50 rounded-xl p-2 text-center">
      <p className="text-[9px] text-slate-400 font-medium">{label}</p>
      <p className={`text-sm font-black mt-0.5 ${color}`}>{fmtShort(value)}</p>
    </div>
  );
}