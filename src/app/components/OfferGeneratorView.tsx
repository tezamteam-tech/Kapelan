import React, { useState, useEffect, useCallback } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { DocumentsPanel } from "./DocumentsPanel";

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

// ─── Types ─────────────────────────────────────────────────────────────────────
type OfferStatus = "draft" | "sent" | "accepted" | "rejected";

interface AcModel {
  id: string; brand: string; model: string;
  btu: number; kw: number; area: number;
  tier: "economy" | "standard" | "premium";
  features: string[]; price: number; warranty: number;
}

interface OfferVariant {
  tier: "economy" | "standard" | "premium";
  label: string;
  ac: AcModel;
  acCount: number; acTotal: number;
  materialsTotal: number; workCost: number;
  subtotal: number; discount: number; total: number;
  isRecommended: boolean; notes: string; features: string[];
}

interface Offer {
  id: string; leadId: string; clientId: string;
  variants: OfferVariant[];
  status: OfferStatus;
  validDays: number; notes: string;
  createdAt: string; updatedAt: string;
}

interface Lead {
  id: string; clientId: string; status: string;
  requirements_json: {
    area?: number; roomType?: string; roomsCount?: number;
    preferences?: string[]; budget?: number; additionalNotes?: string;
  };
  createdAt: string;
}

interface Client { id: string; name: string; phone: string; email?: string | null; }

interface Measurement {
  id: string; traceLength: number; workCost: number;
  materials_json?: { totalMaterials: number; grandTotal: number } | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const TIER_CFG = {
  economy:  { label: "Эконом",    emoji: "💚", bg: "bg-emerald-50",  border: "border-emerald-200", badge: "bg-emerald-100 text-emerald-800", head: "from-emerald-600 to-emerald-500",  ring: "ring-emerald-400" },
  standard: { label: "Стандарт",  emoji: "💙", bg: "bg-blue-50",     border: "border-blue-300",    badge: "bg-blue-100 text-blue-800",       head: "from-blue-700 to-blue-500",        ring: "ring-blue-500" },
  premium:  { label: "Премиум",   emoji: "💜", bg: "bg-violet-50",   border: "border-violet-200",  badge: "bg-violet-100 text-violet-800",   head: "from-violet-700 to-violet-500",    ring: "ring-violet-400" },
};

const STATUS_CFG: Record<OfferStatus, { label: string; bg: string; text: string; dot: string }> = {
  draft:    { label: "Черновик",  bg: "bg-slate-100",  text: "text-slate-600",  dot: "bg-slate-400" },
  sent:     { label: "Отправлен", bg: "bg-blue-100",   text: "text-blue-700",   dot: "bg-blue-500" },
  accepted: { label: "Принят",    bg: "bg-green-100",  text: "text-green-700",  dot: "bg-green-500" },
  rejected: { label: "Отклонён",  bg: "bg-red-100",    text: "text-red-700",    dot: "bg-red-400" },
};

const FEATURE_ICONS: Record<string, string> = {
  "Инвертор": "♻️", "Wi-Fi управление": "📱", "Тихий режим": "🔇",
  "Очистка воздуха": "🌿", "Обогрев до -25°C": "🔥",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString("ru-RU");

function StatusBadge({ status }: { status: OfferStatus }) {
  const c = STATUS_CFG[status];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

// ─── Main export: list + generator ─────────────────────────────────────────────
interface OfferGeneratorProps {
  lead: Lead;
  client: Client | null;
  measurement: Measurement | null;
  onBack: () => void;
}

export function OfferGeneratorView({ lead, client, measurement, onBack }: OfferGeneratorProps) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [generating, setGenerating] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  const [discountPct, setDiscountPct] = useState(0);
  const [validDays, setValidDays] = useState(14);
  const [offerNotes, setOfferNotes] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const showToast = useCallback((text: string, ok = true) => {
    setToastMsg({ text, ok });
    setTimeout(() => setToastMsg(null), 3000);
  }, []);

  const loadOffers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/offers/lead/${lead.id}`, { headers: AH });
      const data = await res.json();
      if (data.offers) {
        setOffers(data.offers);
        if (data.offers.length > 0 && !selectedOffer) setSelectedOffer(data.offers[0]);
      }
    } catch (err) { console.error("Load offers error:", err); }
  }, [lead.id]);

  useEffect(() => { loadOffers(); }, [loadOffers]);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/offers/generate`, {
        method: "POST",
        headers: JH,
        body: JSON.stringify({ leadId: lead.id, discountPct, validDays, notes: offerNotes }),
      });
      const data = await res.json();
      if (data.offer) {
        setOffers(prev => [data.offer, ...prev]);
        setSelectedOffer(data.offer);
        setShowSettings(false);
        showToast("КП сгенерировано ✅");
      } else {
        showToast(data.error || "Ошибка генерации", false);
      }
    } catch (err: any) {
      showToast(`Ошибка: ${err.message}`, false);
    } finally {
      setGenerating(false);
    }
  }

  async function updateStatus(offerId: string, status: OfferStatus) {
    setUpdatingStatus(true);
    try {
      const res = await fetch(`${API_BASE}/offers/${offerId}`, {
        method: "PATCH",
        headers: JH,
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data.offer) {
        setOffers(prev => prev.map(o => o.id === offerId ? data.offer : o));
        setSelectedOffer(data.offer);
        showToast("Статус обновлён ✅");
      }
    } catch (err: any) {
      showToast(`Ошибка: ${err.message}`, false);
    } finally {
      setUpdatingStatus(false);
    }
  }

  const req = lead.requirements_json || {};

  return (
    <div className="flex flex-col h-full bg-slate-100 overflow-hidden">
      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-indigo-800 to-indigo-600 text-white px-4 pt-4 pb-4 flex-shrink-0 shadow-xl">
        <button onClick={onBack} className="flex items-center gap-1.5 text-indigo-200 mb-3 text-sm active:opacity-70">
          ← Назад к заявкам
        </button>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold truncate">📄 Коммерческое предложение</h1>
            <p className="text-indigo-200 text-sm mt-0.5">{client?.name || "—"} · {client?.phone || ""}</p>
          </div>
          <span className="text-xs bg-indigo-700/60 px-2.5 py-1 rounded-full text-indigo-100 flex-shrink-0">
            {offers.length} КП
          </span>
        </div>

        {/* Requirements summary */}
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {req.area && <Tag>📐 {req.area} м²</Tag>}
          {req.roomsCount && <Tag>🚪 {req.roomsCount} комн.</Tag>}
          {req.roomType && <Tag>🏠 {req.roomType}</Tag>}
          {req.budget && <Tag>💰 до {fmt(req.budget)} ₴</Tag>}
          {measurement && <Tag>📏 трасса {measurement.traceLength} м</Tag>}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">

        {/* Measurement summary */}
        {measurement && (
          <div className="mx-4 mt-4 bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Данные замера</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <MiniStat label="Трасса" value={`${measurement.traceLength} м`} />
              <MiniStat label="Работа" value={`${fmt(measurement.workCost)} ₴`} />
              <MiniStat label="Материалы" value={`${fmt(measurement.materials_json?.totalMaterials ?? 0)} ₴`} />
            </div>
          </div>
        )}

        {/* Generate button / settings */}
        <div className="mx-4 mt-4">
          {showSettings ? (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-4">
              <p className="text-sm font-bold text-slate-700">Параметры генерации</p>

              <div>
                <label className="text-xs text-slate-500 font-semibold block mb-1">Скидка: {discountPct}%</label>
                <input type="range" min={0} max={30} step={1} value={discountPct}
                  onChange={e => setDiscountPct(+e.target.value)}
                  className="w-full accent-indigo-600" />
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>0%</span><span>15%</span><span>30%</span>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 font-semibold block mb-1">Срок действия: {validDays} дней</label>
                <div className="flex gap-2">
                  {[7, 14, 21, 30].map(d => (
                    <button key={d} onClick={() => setValidDays(d)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                        validDays === d ? "bg-indigo-600 text-white border-indigo-600" : "bg-slate-50 text-slate-600 border-slate-200"
                      }`}>{d}д</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 font-semibold block mb-1">Примечание к КП</label>
                <textarea value={offerNotes} onChange={e => setOfferNotes(e.target.value)}
                  placeholder="Дополнительные условия, сроки монтажа..."
                  rows={2}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>

              <div className="flex gap-2">
                <button onClick={() => setShowSettings(false)}
                  className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-3 text-sm font-semibold active:scale-95">
                  Отмена
                </button>
                <button onClick={generate} disabled={generating}
                  className="flex-1 bg-gradient-to-r from-indigo-700 to-indigo-500 text-white rounded-xl py-3 text-sm font-bold shadow-md disabled:opacity-60 active:scale-95 transition-transform">
                  {generating ? "⏳ Генерация..." : "✨ Создать КП"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={generate} disabled={generating}
                className="flex-1 bg-gradient-to-r from-indigo-700 to-indigo-500 text-white rounded-xl py-3.5 text-sm font-bold shadow-lg shadow-indigo-200 disabled:opacity-60 active:scale-95 transition-transform flex items-center justify-center gap-2">
                {generating
                  ? <><span className="animate-spin">⏳</span> Подбираем варианты...</>
                  : <><span>✨</span> {offers.length > 0 ? "Перегенерировать КП" : "Создать КП"}</>}
              </button>
              <button onClick={() => setShowSettings(true)}
                className="bg-white border border-slate-200 text-slate-600 rounded-xl px-4 py-3.5 text-sm font-semibold active:scale-95 shadow-sm">
                ⚙️
              </button>
            </div>
          )}
        </div>

        {/* Offers list (if multiple) */}
        {offers.length > 1 && (
          <div className="mx-4 mt-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">История КП</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {offers.map((o, i) => (
                <button key={o.id}
                  onClick={() => setSelectedOffer(o)}
                  className={`flex-shrink-0 text-xs px-3 py-2 rounded-xl border font-semibold transition-all ${
                    selectedOffer?.id === o.id
                      ? "bg-slate-800 text-white border-slate-800"
                      : "bg-white text-slate-500 border-slate-200"
                  }`}>
                  КП #{offers.length - i}
                  <span className="ml-1.5 opacity-70">{STATUS_CFG[o.status].label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Selected offer */}
        {selectedOffer && (
          <OfferDetail
            offer={selectedOffer}
            offerNum={offers.length - offers.findIndex(o => o.id === selectedOffer.id)}
            onStatusChange={(s) => updateStatus(selectedOffer.id, s)}
            updatingStatus={updatingStatus}
          />
        )}

        {/* Documents panel — always shown when offers exist */}
        {offers.length > 0 && (
          <div className="mx-4 mt-2">
            <DocumentsPanel leadId={lead.id} offers={offers} />
          </div>
        )}

        {!selectedOffer && !generating && offers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
            <span className="text-5xl">📄</span>
            <p className="text-sm font-medium">КП ещё не создано</p>
            <p className="text-xs text-slate-300 text-center px-8">
              Нажмите «Создать КП» — система автоматически подберёт 3 варианта
            </p>
          </div>
        )}

        <div className="h-8" />
      </div>

      {/* Toast */}
      {toastMsg && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-white text-sm font-semibold whitespace-nowrap ${
          toastMsg.ok ? "bg-green-600" : "bg-red-600"
        }`}>
          {toastMsg.text}
        </div>
      )}
    </div>
  );
}

// ─── Offer Detail ───────────────────────────────────────────────────────────
function OfferDetail({
  offer, offerNum, onStatusChange, updatingStatus,
}: {
  offer: Offer;
  offerNum: number;
  onStatusChange: (s: OfferStatus) => void;
  updatingStatus: boolean;
}) {
  const [expandedTier, setExpandedTier] = useState<string | null>("standard");
  const validUntil = new Date(offer.createdAt);
  validUntil.setDate(validUntil.getDate() + offer.validDays);

  return (
    <div className="mx-4 mt-4 space-y-3">
      {/* Offer header card */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <p className="text-sm font-bold text-slate-800">КП #{offerNum}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {new Date(offer.createdAt).toLocaleDateString("ru-RU")} · действует до {validUntil.toLocaleDateString("ru-RU")}
            </p>
          </div>
          <StatusBadge status={offer.status} />
        </div>

        {/* Price comparison bar */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {offer.variants.map(v => {
            const cfg = TIER_CFG[v.tier];
            return (
              <button key={v.tier}
                onClick={() => setExpandedTier(expandedTier === v.tier ? null : v.tier)}
                className={`relative rounded-xl p-2.5 text-center border-2 transition-all ${
                  expandedTier === v.tier ? `${cfg.border} ${cfg.bg}` : "border-transparent bg-slate-50"
                }`}>
                {v.isRecommended && (
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                    ✓ Рекоменд.
                  </div>
                )}
                <p className="text-[10px] font-bold text-slate-500 mt-1">{v.label}</p>
                <p className="text-sm font-bold text-slate-800 mt-0.5">{fmt(v.total)} ₴</p>
              </button>
            );
          })}
        </div>

        {/* Status actions */}
        <div className="border-t border-slate-100 pt-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Статус КП</p>
          <div className="flex gap-2 flex-wrap">
            {(["draft", "sent", "accepted", "rejected"] as OfferStatus[]).map(s => {
              const c = STATUS_CFG[s];
              const active = offer.status === s;
              return (
                <button key={s}
                  onClick={() => !active && onStatusChange(s)}
                  disabled={active || updatingStatus}
                  className={`text-xs px-3 py-1.5 rounded-full font-semibold border transition-all active:scale-95 disabled:opacity-60 ${
                    active ? `${c.bg} ${c.text} border-transparent` : "bg-white text-slate-500 border-slate-200"
                  }`}>
                  {updatingStatus && !active ? "..." : c.label}
                </button>
              );
            })}
          </div>
        </div>

        {offer.notes && (
          <div className="mt-3 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-xs text-amber-700">
            📝 {offer.notes}
          </div>
        )}
      </div>

      {/* Variant cards */}
      {offer.variants.map(v => (
        <VariantCard
          key={v.tier}
          variant={v}
          isExpanded={expandedTier === v.tier}
          onToggle={() => setExpandedTier(expandedTier === v.tier ? null : v.tier)}
        />
      ))}
    </div>
  );
}

// ─── Variant Card ─────────────────────────────────────────────────────────────
function VariantCard({ variant: v, isExpanded, onToggle }: {
  variant: OfferVariant;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const cfg = TIER_CFG[v.tier];

  return (
    <div className={`bg-white rounded-2xl border-2 overflow-hidden shadow-sm transition-all ${
      isExpanded ? cfg.border : "border-slate-100"
    }`}>
      {/* Card header (gradient) */}
      <button onClick={onToggle}
        className={`w-full bg-gradient-to-r ${cfg.head} text-white px-4 py-3 flex items-center justify-between active:opacity-90`}>
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{cfg.emoji}</span>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <p className="font-bold text-base">{v.label}</p>
              {v.isRecommended && (
                <span className="bg-white/25 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">
                  ★ Рекоменд.
                </span>
              )}
            </div>
            <p className="text-white/80 text-xs">{v.ac.brand} {v.ac.model}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black">{fmt(v.total)} ₴</p>
          {v.discount > 0 && (
            <p className="text-white/70 text-xs line-through">{fmt(v.subtotal)} ₴</p>
          )}
        </div>
      </button>

      {/* AC Specs bar */}
      <div className={`flex divide-x divide-slate-100 ${cfg.bg}`}>
        <SpecCell icon="❄️" label="BTU" value={`${(v.ac.btu / 1000).toFixed(0)}k`} />
        <SpecCell icon="⚡" label="кВт" value={`${v.ac.kw}`} />
        <SpecCell icon="📐" label="м²" value={`до ${v.ac.area}`} />
        <SpecCell icon="🛡" label="Гарантия" value={`${v.ac.warranty} лет`} />
      </div>

      {/* Features row */}
      {v.features.length > 0 && (
        <div className="px-4 py-2.5 flex flex-wrap gap-1.5 border-b border-slate-100">
          {v.features.map(f => (
            <span key={f} className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${cfg.badge}`}>
              {FEATURE_ICONS[f] ?? "•"} {f}
            </span>
          ))}
        </div>
      )}

      {/* Expanded: price breakdown */}
      {isExpanded && (
        <div className="px-4 py-3 space-y-3">
          {/* AC model detail */}
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Кондиционер</p>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-bold text-slate-800">{v.ac.brand} {v.ac.model}</p>
                <p className="text-xs text-slate-500">{v.acCount} шт × {fmt(v.ac.price)} ₴</p>
              </div>
              <p className="text-base font-black text-slate-800">{fmt(v.acTotal)} ₴</p>
            </div>
          </div>

          {/* Price breakdown table */}
          <div className="space-y-1.5">
            <PriceLine label={`🔩 Материалы`} value={v.materialsTotal} />
            <PriceLine label={`🔧 Монтаж`} value={v.workCost} />
            {v.discount > 0 && <PriceLine label={`🎁 Скидка`} value={-v.discount} isDiscount />}
            <div className="border-t border-slate-200 pt-2 mt-2">
              <div className="flex justify-between items-center">
                <p className="text-sm font-black text-slate-800">ИТОГО</p>
                <p className="text-xl font-black text-slate-900">{fmt(v.total)} ₴</p>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className={`rounded-xl px-3 py-2.5 border ${cfg.border} ${cfg.bg}`}>
            <p className="text-xs text-slate-600">{v.notes}</p>
          </div>
        </div>
      )}

      {/* Collapsed summary */}
      {!isExpanded && (
        <div className="px-4 py-2.5 flex items-center justify-between">
          <div className="flex gap-3 text-xs text-slate-500">
            <span>🔩 {fmt(v.materialsTotal)} ₴</span>
            <span>🔧 {fmt(v.workCost)} ₴</span>
          </div>
          <span className="text-xs text-slate-400">▼ Подробнее</span>
        </div>
      )}
    </div>
  );
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="bg-indigo-700/40 text-indigo-100 text-xs px-2.5 py-1 rounded-full">{children}</span>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400 font-medium">{label}</p>
      <p className="text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}

function SpecCell({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex-1 text-center py-2">
      <p className="text-base leading-none">{icon}</p>
      <p className="text-[9px] text-slate-400 mt-0.5">{label}</p>
      <p className="text-xs font-bold text-slate-700">{value}</p>
    </div>
  );
}

function PriceLine({ label, value, isDiscount }: { label: string; value: number; isDiscount?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-sm font-semibold ${isDiscount ? "text-green-600" : "text-slate-700"}`}>
        {isDiscount && value < 0 ? "−" : ""}{fmt(Math.abs(value))} ₴
      </p>
    </div>
  );
}


// ─── Offers List (for AdminView КП tab) ───────────────────────────────────────
interface OffersListProps {
  leads: { id: string; clientId: string; status: string; requirements_json: any; createdAt: string }[];
  clients: Record<string, Client>;
  onOpenOffer: (leadId: string) => void;
}

export function OffersList({ leads, clients, onOpenOffer }: OffersListProps) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/offers`, { headers: AH })
      .then(r => r.json())
      .then(d => { if (d.offers) setOffers(d.offers); })
      .catch(e => console.error("Load offers error:", e))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
        <span className="text-4xl animate-spin">⏳</span>
        <p className="text-sm">Загрузка...</p>
      </div>
    );
  }

  if (offers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
        <span className="text-5xl">📄</span>
        <p className="text-sm font-medium">КП ещё нет</p>
        <p className="text-xs text-slate-300 text-center px-8">
          Перейдите в заявку со статусом «Замер» и нажмите «Создать КП»
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 pb-8 space-y-3">
      {offers.map(offer => {
        const lead = leads.find(l => l.id === offer.leadId);
        const client = lead ? clients[lead.clientId] : undefined;
        const best = offer.variants.find(v => v.isRecommended) ?? offer.variants[0];
        const dt = new Date(offer.createdAt).toLocaleDateString("ru-RU", {
          day: "2-digit", month: "2-digit", year: "2-digit",
        });

        return (
          <button key={offer.id}
            onClick={() => onOpenOffer(offer.leadId)}
            className="w-full bg-white rounded-2xl border border-slate-100 shadow-sm p-4 text-left active:scale-[0.99] hover:shadow-md transition-all">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <p className="font-bold text-slate-800 truncate">{client?.name ?? "Клиент..."}</p>
                <p className="text-xs text-slate-500">{client?.phone ?? ""}</p>
              </div>
              <StatusBadge status={offer.status} />
            </div>

            <div className="flex gap-3 mb-2">
              {offer.variants.map(v => (
                <div key={v.tier} className={`flex-1 rounded-xl py-1.5 text-center ${TIER_CFG[v.tier].bg}`}>
                  <p className="text-[10px] text-slate-500">{v.label}</p>
                  <p className="text-xs font-bold text-slate-800">{fmt(v.total)} ₴</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">{dt} · {offer.validDays} дней</span>
              <span className="text-xs text-indigo-600 font-semibold">Открыть →</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}