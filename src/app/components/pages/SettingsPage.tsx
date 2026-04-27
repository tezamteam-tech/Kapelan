import { useEffect, useState } from "react";
import { projectId, publicAnonKey } from "../../../../utils/supabase/info";
import { Save, Send, CheckCircle, AlertCircle, Coins, Globe, Check } from "lucide-react";
import { useCurrency, type CurrencyConfig } from "../CurrencyContext";
import { getJson } from "../../lib/apiClient";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const HEADERS = { Authorization: `Bearer ${publicAnonKey}`, "Content-Type": "application/json" };

export function SettingsPage() {
  const [tgChatId, setTgChatId] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [vatEnabledByDefault, setVatEnabledByDefault] = useState(false);
  const [vatPercent, setVatPercent] = useState(20);

  const { currency, setCurrency, fmtShort, CURRENCIES } = useCurrency();

  const loadConfig = async () => {
    try {
      const data = await getJson<any>(`${API}/config`, { ttlMs: 10 * 60_000, staleTtlMs: 60 * 60_000, swr: true });
      if (data.tgAdminChatId) setTgChatId(String(data.tgAdminChatId));
      const cc = data?.company?.currency as CurrencyConfig | undefined;
      if (cc?.name) {
        const next = CURRENCIES.find((x) => x.name === cc.name) ?? cc;
        if (next?.name && next?.symbol) setCurrency(next);
      }
      const vat = data?.company?.vat;
      if (vat && typeof vat === "object") {
        if (typeof vat.enabledByDefault === "boolean") setVatEnabledByDefault(vat.enabledByDefault);
        if (typeof vat.percent === "number") setVatPercent(vat.percent);
      }
    } catch {}
  };

  useEffect(() => { loadConfig(); }, []);

  const saveConfig = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API}/config`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          tgAdminChatId: tgChatId,
          company: {
            currency,
            vat: { enabledByDefault: vatEnabledByDefault, percent: Number(vatPercent) || 0 },
          },
        }),
      });
      const data = await res.json();
      setMsg(data.success ? { text: "Настройки сохранены", ok: true } : { text: data.error || "Ошибка", ok: false });
    } catch (err: any) {
      setMsg({ text: err.message, ok: false });
    } finally {
      setSaving(false);
    }
  };

  const testTg = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch(`${API}/tg-test`, { method: "POST", headers: HEADERS, body: JSON.stringify({}) });
      const data = await res.json();
      setMsg(data.success ? { text: "Тестовое сообщение отправлено!", ok: true } : { text: data.error || "Ошибка", ok: false });
    } catch (err: any) {
      setMsg({ text: err.message, ok: false });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Настройки</h2>
        <p className="text-sm text-slate-500 mt-0.5">Конфигурация системы</p>
      </div>

      {/* ── Currency ──────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <Coins size={18} className="text-amber-500" /> Валюта компании
        </h3>
        <p className="text-sm text-slate-500">
          Выберите рабочую валюту. Все цены, КП и ордера будут отображаться в выбранной валюте.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {CURRENCIES.map(c => {
            const isActive = c.name === currency.name;
            return (
              <button key={c.name} onClick={() => setCurrency(c)}
                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all font-semibold ${
                  isActive
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 hover:border-slate-300 bg-white text-slate-600"
                }`}>
                <div className="flex items-center gap-1.5">
                  <span className="text-2xl font-black">{c.symbol}</span>
                  {isActive && <Check size={14} className="text-blue-600" />}
                </div>
                <div className="text-center">
                  <p className="font-bold text-sm">{c.name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {c.position === "prefix" ? `${c.symbol}1 000` : `1 000 ${c.symbol}`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600">
          <p className="font-semibold text-slate-700 mb-1">Предпросмотр:</p>
          <div className="flex flex-wrap gap-4 text-slate-800">
            <span>Стоимость монтажа: <strong className="text-teal-700">{fmtShort(250)}</strong></span>
            <span>Кондиционер: <strong className="text-teal-700">{fmtShort(1890)}</strong></span>
            <span>Итого КП: <strong className="text-teal-700">{fmtShort(2450)}</strong></span>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 flex items-start gap-2">
          <Globe size={13} className="flex-shrink-0 mt-0.5" />
          Валюта хранится в конфигурации компании и синхронизируется для всех пользователей.
        </div>
      </div>

      {/* ── VAT ──────────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <span className="text-xl">🧾</span> НДС (опционально)
        </h3>
        <p className="text-sm text-slate-500">
          Для РБ можно показывать в документах переключатель «с учётом НДС». Процент настраивается здесь.
        </p>
        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 select-none">
          <input
            type="checkbox"
            checked={vatEnabledByDefault}
            onChange={(e) => setVatEnabledByDefault(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300"
          />
          Включать НДС по умолчанию в документах
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Процент НДС</label>
            <input
              type="number"
              value={vatPercent}
              onChange={(e) => setVatPercent(Number(e.target.value))}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="20"
              min={0}
              step={0.01}
            />
          </div>
          <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-700 mb-1">Пример:</p>
            <div className="text-slate-800">
              1 000 → НДС {vatPercent}% = <strong className="text-teal-700">{fmtShort((1000 * (Number(vatPercent) || 0)) / 100)}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* ── Telegram ──────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <span className="text-xl">📱</span> Telegram уведомления
        </h3>
        <p className="text-sm text-slate-500">
          Укажите Chat ID администратора для получения уведомлений о новых заявках, замерах и других событиях.
        </p>
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">Telegram Chat ID</label>
          <input
            value={tgChatId}
            onChange={e => setTgChatId(e.target.value)}
            placeholder="Например: 123456789"
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={saveConfig}
            disabled={saving}
            className="flex items-center gap-2 bg-blue-600 text-white rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Save size={16} />
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
          <button
            onClick={testTg}
            disabled={testing}
            className="flex items-center gap-2 bg-slate-100 text-slate-700 rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-slate-200 disabled:opacity-50 transition-colors"
          >
            <Send size={16} />
            {testing ? "Отправка..." : "Тест"}
          </button>
        </div>

        {msg && (
          <div className={`flex items-center gap-2 text-sm rounded-xl px-4 py-3 ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {msg.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {msg.text}
          </div>
        )}
      </div>

      {/* ── Workflow info ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <span className="text-xl">🔄</span> Процесс работы с клиентом
        </h3>
        <div className="space-y-3">
          {[
            { step: "1", icon: "📋", title: "Заявка поступает", desc: "Менеджер создаёт заявку в разделе «Заявки» или через AI-чат" },
            { step: "2", icon: "📐", title: "Ордер на замер", desc: "Создаётся ордер на выезд → монтажник едет, делает замеры, вносит метраж трассы и расходники" },
            { step: "3", icon: "📄", title: "КП для клиента", desc: "На основе замеров менеджер формирует финальное коммерческое предложение с ценой" },
            { step: "4", icon: "📅", title: "Назначение монтажа", desc: "Клиент соглашается → планируется дата → создаётся ордер на монтаж" },
            { step: "5", icon: "🏗️", title: "Ордер на монтаж", desc: "Монтажники получают задание с адресом и списком материалов со склада" },
            { step: "6", icon: "✅", title: "Завершение", desc: "Монтаж выполнен → система создаёт напоминание о ТО через год" },
          ].map(({ step, icon, title, desc }) => (
            <div key={step} className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-black flex items-center justify-center flex-shrink-0">
                {step}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{icon} {title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── System info ──────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-3">
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <span className="text-xl">ℹ️</span> Информация о системе
        </h3>
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between py-2 border-b border-slate-50">
            <span className="text-slate-500">Версия</span>
            <span className="font-semibold text-slate-800">2.1.0</span>
          </div>
          <div className="flex justify-between py-2 border-b border-slate-50">
            <span className="text-slate-500">Project ID</span>
            <span className="font-mono text-xs text-slate-600">{projectId}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-slate-50">
            <span className="text-slate-500">Валюта</span>
            <span className="font-semibold text-slate-800">{currency.name} ({currency.symbol})</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-slate-500">Модули</span>
            <span className="text-slate-800 font-semibold text-right text-xs">
              AI Chat, CRM, Замеры, Склад, Закупки, ТО, Вентиляция, Обучение
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
