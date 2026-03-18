import { useState } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import { Save, Send, CheckCircle, AlertCircle } from "lucide-react";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const HEADERS = { Authorization: `Bearer ${publicAnonKey}`, "Content-Type": "application/json" };

export function SettingsPage() {
  const [tgChatId, setTgChatId] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const loadConfig = async () => {
    try {
      const res = await fetch(`${API}/config`, { headers: { Authorization: `Bearer ${publicAnonKey}` } });
      const data = await res.json();
      if (data.tgAdminChatId) setTgChatId(String(data.tgAdminChatId));
    } catch {}
  };

  useState(() => { loadConfig(); });

  const saveConfig = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API}/config`, { method: "POST", headers: HEADERS, body: JSON.stringify({ tgAdminChatId: tgChatId }) });
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

      {/* Telegram */}
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

      {/* System info */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-3">
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <span className="text-xl">ℹ️</span> Информация о системе
        </h3>
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between py-2 border-b border-slate-50">
            <span className="text-slate-500">Версия</span>
            <span className="font-semibold text-slate-800">2.0.0</span>
          </div>
          <div className="flex justify-between py-2 border-b border-slate-50">
            <span className="text-slate-500">Project ID</span>
            <span className="font-mono text-xs text-slate-600">{projectId}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-slate-500">Модули</span>
            <span className="text-slate-800 font-semibold">AI Chat, CRM, Склад, Закупки, ТО, Вентиляция, Обучение</span>
          </div>
        </div>
      </div>
    </div>
  );
}