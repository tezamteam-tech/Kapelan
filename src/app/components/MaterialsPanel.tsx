import React, { useState } from "react";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { useCurrency } from "./CurrencyContext";

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AUTH_HEADERS = { Authorization: `Bearer ${publicAnonKey}` };
const JSON_HEADERS = { ...AUTH_HEADERS, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
export interface MaterialItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  pricePerUnit: number;
  total: number;
  note?: string;
}

export interface MaterialsJson {
  templateId: string;
  templateName: string;
  items: MaterialItem[];
  totalMaterials: number;
  workCost: number;
  grandTotal: number;
  generatedAt: string;
}

// Category icon map
const CATEGORY_ICONS: Record<string, string> = {
  "Трубопровод": "🔩",
  "Дренаж":      "💧",
  "Электрика":   "⚡",
  "Крепёж":      "🔧",
  "Расходники":  "🧴",
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  materials: MaterialsJson;
  measurementId?: string;
  compact?: boolean;
  onRecalculated?: (updated: MaterialsJson) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function MaterialsPanel({ materials, measurementId, compact = false, onRecalculated }: Props) {
  const { fmtShort } = useCurrency();
  const [expanded, setExpanded] = useState(!compact);
  const [recalculating, setRecalculating] = useState(false);
  const [localMaterials, setLocalMaterials] = useState<MaterialsJson>(materials);

  // Group items by category
  const byCategory = localMaterials.items.reduce<Record<string, MaterialItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const categories = Object.keys(byCategory);

  async function handleRecalculate() {
    if (!measurementId) return;
    setRecalculating(true);
    try {
      const res = await fetch(`${API_BASE}/measurements/${measurementId}/recalculate`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.materials_json) {
        setLocalMaterials(data.materials_json);
        onRecalculated?.(data.materials_json);
      } else {
        console.error("Recalculate error:", data.error);
      }
    } catch (err) {
      console.error("Recalculate exception:", err);
    } finally {
      setRecalculating(false);
    }
  }

  const fmt = fmtShort;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100 active:opacity-80"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">📦</span>
          <div className="text-left">
            <p className="text-xs font-bold text-emerald-800 uppercase tracking-widest">Материалы</p>
            <p className="text-[10px] text-emerald-600 mt-0.5">{localMaterials.templateName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-slate-500">Итого</p>
            <p className="text-sm font-bold text-emerald-700">{fmtShort(localMaterials.grandTotal)}</p>
          </div>
          <span className="text-slate-400 text-sm">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="divide-y divide-slate-50">
          {/* Summary cards */}
          <div className="grid grid-cols-3 divide-x divide-slate-100 bg-slate-50/60">
            <SummaryCard label="Материалы" value={localMaterials.totalMaterials} color="text-slate-700" />
            <SummaryCard label="Работа" value={localMaterials.workCost} color="text-blue-700" />
            <SummaryCard label="Всего" value={localMaterials.grandTotal} color="text-emerald-700" bold />
          </div>

          {/* Items by category */}
          {categories.map(cat => (
            <CategoryBlock
              key={cat}
              icon={CATEGORY_ICONS[cat] ?? "📋"}
              title={cat}
              items={byCategory[cat]}
              fmt={fmt}
            />
          ))}

          {/* Footer */}
          <div className="px-4 py-3 bg-slate-50 flex items-center justify-between">
            <p className="text-[10px] text-slate-400">
              Рассчитано: {new Date(localMaterials.generatedAt).toLocaleString("ru-RU", {
                day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
              })}
            </p>
            {measurementId && (
              <button
                onClick={handleRecalculate}
                disabled={recalculating}
                className="text-xs text-emerald-600 font-semibold flex items-center gap-1 active:opacity-70 disabled:opacity-50"
              >
                <span className={recalculating ? "animate-spin" : ""}>🔄</span>
                {recalculating ? "Пересчёт..." : "Пересчитать"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function SummaryCard({ label, value, color, bold }: {
  label: string; value: number; color: string; bold?: boolean;
}) {
  return (
    <div className="px-3 py-2.5 text-center">
      <p className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-sm mt-0.5 ${color} ${bold ? "font-bold" : "font-semibold"}`}>
        {value.toLocaleString("ru-RU")}
      </p>
    </div>
  );
}

function CategoryBlock({ icon, title, items, fmt }: {
  icon: string; title: string; items: MaterialItem[]; fmt: (n: number) => string;
}) {
  const catTotal = items.reduce((s, i) => s + i.total, 0);

  return (
    <div>
      {/* Category header */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-50">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{icon}</span>
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{title}</span>
        </div>
        <span className="text-xs text-slate-400 font-semibold">{fmt(catTotal)}</span>
      </div>

      {/* Items */}
      {items.map((item, idx) => (
        <div
          key={item.id}
          className={`flex items-start gap-3 px-4 py-2.5 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-800 font-medium leading-tight">{item.name}</p>
            {item.note && (
              <p className="text-[10px] text-slate-400 mt-0.5">— {item.note}</p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-semibold text-slate-700">
              <span className="text-slate-400 font-normal">{item.qty} {item.unit}</span>
              <span className="text-slate-300 mx-1">×</span>
              {fmt(item.pricePerUnit)}
            </p>
            <p className="text-xs font-bold text-emerald-700">{fmt(item.total)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}


// ─── Template Editor (for AdminView) ─────────────────────────────────────────
export interface TemplateItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  pricePerUnit: number;
  enabled: boolean;
  formulaType: string;
  reserve: number;
  fixedQty?: number;
  pieceStep?: number;
  pieceExtra?: number;
  freonBase?: number;
  freonPerMeter?: number;
}

export interface MaterialTemplate {
  id: string;
  name: string;
  items: TemplateItem[];
  updatedAt: string;
}

const FORMULA_LABELS: Record<string, string> = {
  linear:            "Линейная (× трасса)",
  pieces:            "Штучная (÷ шаг)",
  fixed:             "Фиксированная",
  freon:             "Фреон (база + м)",
  conditional_pump:  "Только при насосе",
  skip_if_no_drain:  "Только при дренаже",
};

const CATEGORY_OPTIONS = ["Трубопровод", "Дренаж", "Электрика", "Крепёж", "Расходники"];

interface TemplateEditorProps {
  onSaved?: () => void;
}

export function TemplateEditor({ onSaved }: TemplateEditorProps) {
  const [template, setTemplate] = useState<MaterialTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);

  React.useEffect(() => { loadTemplate(); }, []);

  async function loadTemplate() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/material-templates/default`, { headers: AUTH_HEADERS });
      const data = await res.json();
      if (data.template) setTemplate(data.template);
    } catch (err) {
      console.error("Load template error:", err);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!template) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/material-templates/default`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(template),
      });
      const data = await res.json();
      if (data.template) {
        setTemplate(data.template);
        setMsg({ text: "✅ Шаблон сохранён", ok: true });
        onSaved?.();
      } else {
        setMsg({ text: data.error || "Ошибка сохранения", ok: false });
      }
    } catch (err: any) {
      setMsg({ text: `Ошибка: ${err.message}`, ok: false });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 4000);
    }
  }

  function updateItem(id: string, patch: Partial<TemplateItem>) {
    setTemplate(t => t ? {
      ...t,
      items: t.items.map(item => item.id === id ? { ...item, ...patch } : item),
    } : t);
  }

  function addItem() {
    const newItem: TemplateItem = {
      id: `item_${Date.now()}`,
      name: "Новый материал",
      category: "Расходники",
      unit: "шт",
      pricePerUnit: 0,
      enabled: true,
      formulaType: "fixed",
      reserve: 0,
      fixedQty: 1,
    };
    setTemplate(t => t ? { ...t, items: [...t.items, newItem] } : t);
    setEditingItem(newItem.id);
  }

  function removeItem(id: string) {
    setTemplate(t => t ? { ...t, items: t.items.filter(i => i.id !== id) } : t);
  }

  function reset() {
    // Delete saved, will reload default on next fetch
    if (confirm("Сбросить шаблон к заводским настройкам?")) {
      fetch(`${API_BASE}/material-templates/default`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reset: true, items: [] }),
      }).then(() => loadTemplate());
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8 text-slate-400">
        <span className="animate-spin text-3xl">⏳</span>
      </div>
    );
  }

  if (!template) return null;

  const byCategory = template.items.reduce<Record<string, TemplateItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Template name */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">
          Название шаблона
        </label>
        <input
          type="text"
          value={template.name}
          onChange={e => setTemplate(t => t ? { ...t, name: e.target.value } : t)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {/* Items by category */}
      {CATEGORY_OPTIONS.map(cat => {
        const catItems = byCategory[cat] || [];
        return (
          <div key={cat} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
              <span>{CATEGORY_ICONS[cat] ?? "📋"}</span>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{cat}</span>
              <span className="ml-auto text-xs text-slate-400">{catItems.length} позиций</span>
            </div>
            <div className="divide-y divide-slate-50">
              {catItems.map(item => (
                <TemplateItemRow
                  key={item.id}
                  item={item}
                  isEditing={editingItem === item.id}
                  onToggleEdit={() => setEditingItem(editingItem === item.id ? null : item.id)}
                  onChange={patch => updateItem(item.id, patch)}
                  onRemove={() => removeItem(item.id)}
                />
              ))}
              {catItems.length === 0 && (
                <p className="text-xs text-slate-400 px-4 py-3 italic">Нет позиций</p>
              )}
            </div>
          </div>
        );
      })}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={addItem}
          className="flex-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl py-3 text-sm font-bold active:scale-95 transition-transform"
        >
          + Добавить позицию
        </button>
      </div>

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium text-center ${
          msg.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {msg.text}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 bg-emerald-600 text-white rounded-xl py-3.5 text-sm font-bold shadow-md disabled:opacity-60 active:scale-95 transition-transform"
        >
          {saving ? "Сохранение..." : "💾 Сохранить шаблон"}
        </button>
        <button
          onClick={reset}
          className="bg-slate-100 text-slate-500 rounded-xl px-4 py-3.5 text-sm font-semibold active:scale-95"
        >
          ↺
        </button>
      </div>

      <p className="text-[10px] text-slate-400 text-center">
        Обновлено: {new Date(template.updatedAt).toLocaleString("ru-RU")}
      </p>
    </div>
  );
}

// ─── Template Item Row ────────────────────────────────────────────────────────
function TemplateItemRow({ item, isEditing, onToggleEdit, onChange, onRemove }: {
  item: TemplateItem;
  isEditing: boolean;
  onToggleEdit: () => void;
  onChange: (patch: Partial<TemplateItem>) => void;
  onRemove: () => void;
}) {
  return (
    <div className={`${!item.enabled ? "opacity-50" : ""}`}>
      {/* Collapsed row */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        {/* Enable toggle */}
        <button
          onClick={() => onChange({ enabled: !item.enabled })}
          className={`w-8 h-5 rounded-full flex-shrink-0 transition-colors ${
            item.enabled ? "bg-emerald-500" : "bg-slate-200"
          }`}
        >
          <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5 ${
            item.enabled ? "translate-x-3" : "translate-x-0"
          }`} />
        </button>

        {/* Name & formula badge */}
        <div className="flex-1 min-w-0" onClick={onToggleEdit}>
          <p className="text-sm text-slate-800 font-medium truncate">{item.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
              {FORMULA_LABELS[item.formulaType] ?? item.formulaType}
            </span>
            <span className="text-[10px] text-slate-400">
              {item.pricePerUnit.toLocaleString("ru-RU")}/{item.unit}
            </span>
          </div>
        </div>

        {/* Edit / delete */}
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={onToggleEdit}
            className="text-sm text-blue-500 px-2 py-1 rounded-lg hover:bg-blue-50 active:opacity-70"
          >
            {isEditing ? "✓" : "✏️"}
          </button>
          <button
            onClick={onRemove}
            className="text-sm text-red-400 px-2 py-1 rounded-lg hover:bg-red-50 active:opacity-70"
          >
            ×
          </button>
        </div>
      </div>

      {/* Expanded edit form */}
      {isEditing && (
        <div className="bg-slate-50 border-t border-slate-100 px-4 py-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <EditField label="Название">
              <input
                type="text"
                value={item.name}
                onChange={e => onChange({ name: e.target.value })}
                className="w-full text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </EditField>
            <EditField label="Категория">
              <select
                value={item.category}
                onChange={e => onChange({ category: e.target.value })}
                className="w-full text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                {CATEGORY_OPTIONS.map(c => <option key={c}>{c}</option>)}
              </select>
            </EditField>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <EditField label="Цена/ед">
              <input
                type="number"
                value={item.pricePerUnit}
                onChange={e => onChange({ pricePerUnit: parseFloat(e.target.value) || 0 })}
                className="w-full text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </EditField>
            <EditField label="Единица">
              <input
                type="text"
                value={item.unit}
                onChange={e => onChange({ unit: e.target.value })}
                className="w-full text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </EditField>
            <EditField label="Запас %">
              <input
                type="number"
                value={Math.round((item.reserve || 0) * 100)}
                onChange={e => onChange({ reserve: (parseFloat(e.target.value) || 0) / 100 })}
                className="w-full text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </EditField>
          </div>

          <EditField label="Формула расчёта">
            <select
              value={item.formulaType}
              onChange={e => onChange({ formulaType: e.target.value })}
              className="w-full text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              {Object.entries(FORMULA_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </EditField>

          {/* Extra fields based on formula type */}
          {(item.formulaType === "fixed" || item.formulaType === "conditional_pump") && (
            <EditField label="Кол-во (шт)">
              <input
                type="number"
                value={item.fixedQty ?? 1}
                onChange={e => onChange({ fixedQty: parseFloat(e.target.value) || 1 })}
                className="w-full text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </EditField>
          )}

          {item.formulaType === "pieces" && (
            <div className="grid grid-cols-2 gap-2">
              <EditField label="Шаг (м/шт)">
                <input
                  type="number"
                  step="0.1"
                  value={item.pieceStep ?? 0.5}
                  onChange={e => onChange({ pieceStep: parseFloat(e.target.value) || 0.5 })}
                  className="w-full text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none"
                />
              </EditField>
              <EditField label="Добавить (шт)">
                <input
                  type="number"
                  value={item.pieceExtra ?? 0}
                  onChange={e => onChange({ pieceExtra: parseInt(e.target.value) || 0 })}
                  className="w-full text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none"
                />
              </EditField>
            </div>
          )}

          {item.formulaType === "freon" && (
            <div className="grid grid-cols-2 gap-2">
              <EditField label="База (кг)">
                <input
                  type="number"
                  step="0.05"
                  value={item.freonBase ?? 0.3}
                  onChange={e => onChange({ freonBase: parseFloat(e.target.value) || 0 })}
                  className="w-full text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none"
                />
              </EditField>
              <EditField label="Доп. (кг/м)">
                <input
                  type="number"
                  step="0.005"
                  value={item.freonPerMeter ?? 0.025}
                  onChange={e => onChange({ freonPerMeter: parseFloat(e.target.value) || 0 })}
                  className="w-full text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none"
                />
              </EditField>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">{label}</label>
      {children}
    </div>
  );
}