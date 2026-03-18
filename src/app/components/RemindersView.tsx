import React, { useState, useEffect, useCallback } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH  = { Authorization: `Bearer ${publicAnonKey}` };
const JH  = { ...AH, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
interface ServiceReminder {
  id: string;
  leadId: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string | null;
  clientTgChatId?: string | null;
  installationDate: string;
  reminderDate: string;
  status: "pending" | "notified" | "scheduled" | "done" | "cancelled";
  notificationsSent: number;
  lastNotifiedAt?: string | null;
  nextNotifyAt?: string | null;
  acModel?: string | null;
  address?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface ReminderNotification {
  id: string; reminderId: string; clientName: string;
  channel: "telegram_admin" | "telegram_client";
  chatId: string; message: string; success: boolean;
  error?: string; sentAt: string;
}

interface Stats {
  total: number; pending: number; notified: number;
  overdue: number; upcoming7: number; done: number;
}

interface BotInfo {
  configured: boolean;
  bot?: { id: number; first_name: string; username: string };
  adminChatId?: string;
  error?: string;
  tokenEnv?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
type RTab = "upcoming" | "all" | "bot";
type StatusFilter = "all" | "pending" | "notified" | "overdue" | "done";

const STATUS_CFG: Record<ServiceReminder["status"], { label: string; bg: string; text: string; dot: string; icon: string }> = {
  pending:   { label: "Ожидает",      bg: "bg-blue-100",   text: "text-blue-700",   dot: "bg-blue-500",   icon: "🔔" },
  notified:  { label: "Уведомлено",   bg: "bg-indigo-100", text: "text-indigo-700", dot: "bg-indigo-500", icon: "📤" },
  scheduled: { label: "Запланировано", bg: "bg-amber-100",  text: "text-amber-700",  dot: "bg-amber-500",  icon: "📅" },
  done:      { label: "Выполнено",    bg: "bg-green-100",  text: "text-green-700",  dot: "bg-green-500",  icon: "✅" },
  cancelled: { label: "Отменено",     bg: "bg-slate-100",  text: "text-slate-500",  dot: "bg-slate-400",  icon: "🚫" },
};

const fmt = (s: string | null | undefined, opts?: Intl.DateTimeFormatOptions) =>
  s ? new Date(s).toLocaleDateString("ru-RU", opts ?? { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

function getDaysUntil(dateStr: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const due = new Date(dateStr); due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function urgencyLabel(days: number) {
  if (days < 0)  return { text: `Просрочено ${Math.abs(days)} дн.`, cls: "text-red-700 bg-red-50 border-red-200", dot: "bg-red-500" };
  if (days === 0) return { text: "Сегодня!",      cls: "text-orange-700 bg-orange-50 border-orange-200", dot: "bg-orange-500" };
  if (days <= 7)  return { text: `Через ${days} дн.`, cls: "text-amber-700 bg-amber-50 border-amber-200",  dot: "bg-amber-500" };
  if (days <= 30) return { text: `Через ${days} дн.`, cls: "text-blue-700 bg-blue-50 border-blue-200",    dot: "bg-blue-500" };
  return               { text: `Через ${days} дн.`, cls: "text-slate-600 bg-slate-50 border-slate-200",  dot: "bg-slate-400" };
}

// ─── RemindersView ────────────────────────────────────────────────────────────
export function RemindersView() {
  const [tab, setTab]           = useState<RTab>("upcoming");
  const [reminders, setReminders] = useState<ServiceReminder[]>([]);
  const [stats, setStats]       = useState<Stats | null>(null);
  const [botInfo, setBotInfo]   = useState<BotInfo | null>(null);
  const [loading, setLoading]   = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch]     = useState("");

  const [detailReminder, setDetailReminder] = useState<ServiceReminder | null>(null);
  const [detailNotifs, setDetailNotifs]     = useState<ReminderNotification[]>([]);
  const [showNewForm, setShowNewForm]       = useState(false);
  const [sendingId, setSendingId]           = useState<string | null>(null);
  const [checkingAll, setCheckingAll]       = useState(false);
  const [testingBot, setTestingBot]         = useState(false);
  const [toast, setToast]       = useState<{ text: string; ok: boolean } | null>(null);

  const showToast = useCallback((text: string, ok = true) => {
    setToast({ text, ok }); setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, bRes] = await Promise.all([
        fetch(`${API}/reminders`, { headers: AH }),
        fetch(`${API}/reminders/bot-info`, { headers: AH }),
      ]);
      const [rd, bd] = await Promise.all([rRes.json(), bRes.json()]);
      if (rd.reminders) { setReminders(rd.reminders); setStats(rd.stats); }
      if (bd !== undefined) setBotInfo(bd);
    } catch (e) { console.error("Reminders fetch:", e); showToast("Ошибка загрузки", false); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function sendNotification(id: string) {
    setSendingId(id);
    try {
      const res = await fetch(`${API}/reminders/${id}/notify`, { method: "POST", headers: JH, body: "{}" });
      const data = await res.json();
      if (data.error) { showToast(data.error, false); return; }
      setReminders(prev => prev.map(r => r.id === id ? data.reminder : r));
      showToast(data.sent > 0
        ? `📤 Отправлено ${data.sent} уведомлений!`
        : `⚠️ Не удалось отправить: ${data.errors?.join(", ")}`, data.sent > 0);
    } catch (e: any) { showToast(e.message, false); }
    finally { setSendingId(null); }
  }

  async function checkAndNotifyAll() {
    setCheckingAll(true);
    try {
      const res = await fetch(`${API}/reminders/check-and-notify`, { method: "POST", headers: JH, body: "{}" });
      const data = await res.json();
      if (data.error) { showToast(data.error, false); return; }
      showToast(`🤖 Проверено ${data.checked}, уведомлено ${data.notified}, отправлено ${data.totalSent} сообщений`);
      await fetchAll();
    } catch (e: any) { showToast(e.message, false); }
    finally { setCheckingAll(false); }
  }

  async function updateStatus(id: string, status: ServiceReminder["status"]) {
    const res = await fetch(`${API}/reminders/${id}`, { method: "PATCH", headers: JH, body: JSON.stringify({ status }) });
    const data = await res.json();
    if (data.reminder) {
      setReminders(prev => prev.map(r => r.id === id ? data.reminder : r));
      if (detailReminder?.id === id) setDetailReminder(data.reminder);
      showToast("Статус обновлён ✅");
    } else showToast(data.error, false);
  }

  async function deleteReminder(id: string) {
    await fetch(`${API}/reminders/${id}`, { method: "DELETE", headers: AH });
    setReminders(prev => prev.filter(r => r.id !== id));
    setDetailReminder(null);
    showToast("Напоминание удалено");
  }

  async function testBot() {
    setTestingBot(true);
    try {
      const res = await fetch(`${API}/reminders/test-tg`, { method: "POST", headers: JH, body: "{}" });
      const data = await res.json();
      showToast(data.success ? "✅ Тестовое сообщение отправлено!" : (data.error ?? "Ошибка"), !!data.success);
    } catch (e: any) { showToast(e.message, false); }
    finally { setTestingBot(false); }
  }

  async function openDetail(r: ServiceReminder) {
    setDetailReminder(r);
    const res = await fetch(`${API}/reminders/${r.id}`, { headers: AH });
    const data = await res.json();
    if (data.notifications) setDetailNotifs(data.notifications);
  }

  // ── Filtered list ──────────────────────────────────────────────────────────
  const now = new Date();
  const filtered = reminders.filter(r => {
    const days = getDaysUntil(r.reminderDate);
    const matchSearch = !search || r.clientName.toLowerCase().includes(search.toLowerCase()) || r.clientPhone.includes(search);
    const matchStatus = statusFilter === "all" ? true
      : statusFilter === "overdue" ? (days < 0 && r.status !== "done" && r.status !== "cancelled")
      : r.status === statusFilter;
    const matchTab = tab === "upcoming"
      ? (r.status !== "done" && r.status !== "cancelled" && days <= 365)
      : true;
    return matchSearch && matchStatus && matchTab;
  });

  // Split upcoming into groups
  const overdue   = filtered.filter(r => getDaysUntil(r.reminderDate) < 0 && r.status !== "done" && r.status !== "cancelled");
  const today7    = filtered.filter(r => { const d = getDaysUntil(r.reminderDate); return d >= 0 && d <= 7 && r.status !== "done" && r.status !== "cancelled"; });
  const later     = filtered.filter(r => { const d = getDaysUntil(r.reminderDate); return d > 7 && r.status !== "done" && r.status !== "cancelled"; });
  const completed = filtered.filter(r => r.status === "done" || r.status === "cancelled");

  const TABS: { key: RTab; icon: string; label: string; badge?: number }[] = [
    { key: "upcoming", icon: "🔔", label: "Активные", badge: (stats?.overdue ?? 0) + (stats?.upcoming7 ?? 0) || undefined },
    { key: "all",      icon: "📋", label: "Все",      badge: stats?.total || undefined },
    { key: "bot",      icon: "🤖", label: "Telegram" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-violet-900 to-violet-700 text-white px-4 pt-8 pb-4 flex-shrink-0 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold">🔔 Напоминания ТО</h1>
            <p className="text-violet-300 text-sm mt-0.5">Техническое обслуживание · +1 год после монтажа</p>
          </div>
          <button onClick={fetchAll} disabled={loading}
            className="bg-violet-700/60 rounded-xl p-2.5 active:scale-90">
            <span className={`text-lg block ${loading ? "animate-spin" : ""}`}>🔄</span>
          </button>
        </div>
        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { l: "Всего",       v: String(stats?.total    ?? 0), hot: false },
            { l: "Просрочено",  v: String(stats?.overdue  ?? 0), hot: (stats?.overdue ?? 0) > 0 },
            { l: "7 дней",      v: String(stats?.upcoming7 ?? 0), hot: (stats?.upcoming7 ?? 0) > 0 },
            { l: "Выполнено",   v: String(stats?.done      ?? 0), hot: false },
          ].map(s => (
            <div key={s.l} className={`rounded-xl px-2 py-2 text-center ${s.hot ? "bg-red-600/80" : "bg-violet-800/50"}`}>
              <p className="text-white font-black text-base leading-none">{s.v}</p>
              <p className="text-white/60 text-[10px] mt-0.5">{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="bg-white border-b border-slate-200 flex flex-shrink-0">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-3 text-[11px] font-semibold flex flex-col items-center gap-0.5 relative transition-colors ${
              tab === t.key ? "text-violet-800 border-b-2 border-violet-700" : "text-slate-400"
            }`}>
            <span className="text-base">{t.icon}</span>{t.label}
            {t.badge ? <span className="absolute top-1.5 right-3 bg-red-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">{t.badge > 9 ? "9+" : t.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">

        {/* ══ UPCOMING ══════════════════════════════════════════════════════ */}
        {(tab === "upcoming" || tab === "all") && (
          <div>
            {/* Actions bar */}
            <div className="px-4 pt-3 pb-2 space-y-2">
              <button
                onClick={checkAndNotifyAll}
                disabled={checkingAll}
                className="w-full bg-gradient-to-r from-violet-700 to-violet-500 text-white rounded-2xl py-3.5 font-bold text-sm active:scale-95 shadow-lg disabled:opacity-60 flex items-center justify-center gap-2.5">
                {checkingAll
                  ? <><span className="animate-spin text-lg">⏳</span> Проверяем и отправляем...</>
                  : <><span className="text-xl">🤖</span>
                    <div className="text-left">
                      <p className="font-black">Проверить и уведомить всех</p>
                      <p className="text-violet-200 text-xs font-normal">Авто-рассылка для просроченных и ближайших</p>
                    </div>
                  </>}
              </button>
              <div className="flex gap-2">
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="🔍 Поиск клиента или телефона..."
                  className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
                <button onClick={() => setShowNewForm(true)}
                  className="bg-violet-600 text-white rounded-xl px-4 font-bold text-lg active:scale-95">+</button>
              </div>
              {tab === "all" && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {(["all", "pending", "notified", "overdue", "done"] as StatusFilter[]).map(f => (
                    <button key={f} onClick={() => setStatusFilter(f)}
                      className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-semibold border transition-all ${
                        statusFilter === f ? "bg-violet-700 text-white border-violet-700" : "bg-white text-slate-500 border-slate-200"
                      }`}>
                      {f === "all" ? `Все` : f === "pending" ? "Ожидает" : f === "notified" ? "Уведомлено" : f === "overdue" ? "⚠️ Просрочено" : "✅ Выполнено"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Grouped by urgency (upcoming tab) */}
            {tab === "upcoming" ? (
              <div className="px-4 pb-8 space-y-4">
                {overdue.length > 0 && (
                  <Section icon="🔴" title={`Просрочено · ${overdue.length}`} accent="border-red-200">
                    {overdue.map(r => <ReminderCard key={r.id} reminder={r} onDetail={() => openDetail(r)} onSend={() => sendNotification(r.id)} sending={sendingId === r.id} />)}
                  </Section>
                )}
                {today7.length > 0 && (
                  <Section icon="🟡" title={`Ближайшие 7 дней · ${today7.length}`} accent="border-amber-200">
                    {today7.map(r => <ReminderCard key={r.id} reminder={r} onDetail={() => openDetail(r)} onSend={() => sendNotification(r.id)} sending={sendingId === r.id} />)}
                  </Section>
                )}
                {later.length > 0 && (
                  <Section icon="🔵" title={`Запланированные · ${later.length}`} accent="border-blue-100">
                    {later.map(r => <ReminderCard key={r.id} reminder={r} onDetail={() => openDetail(r)} onSend={() => sendNotification(r.id)} sending={sendingId === r.id} />)}
                  </Section>
                )}
                {overdue.length === 0 && today7.length === 0 && later.length === 0 && !loading && (
                  <EmptyState icon="✅" text="Активных напоминаний нет" sub="Новые появятся после завершения монтажа (статус «Выполнено»)" />
                )}
              </div>
            ) : (
              <div className="px-4 pb-8 space-y-2">
                {filtered.length === 0 && !loading
                  ? <EmptyState icon="🔔" text="Напоминаний нет" />
                  : filtered.map(r => <ReminderCard key={r.id} reminder={r} onDetail={() => openDetail(r)} onSend={() => sendNotification(r.id)} sending={sendingId === r.id} />)
                }
              </div>
            )}
          </div>
        )}

        {/* ══ BOT TAB ══════════════════════════════════════════════════════ */}
        {tab === "bot" && (
          <div className="px-4 pt-4 pb-8 space-y-4">

            {/* Bot status card */}
            <div className={`rounded-2xl border p-4 ${botInfo?.configured ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${botInfo?.configured ? "bg-green-100" : "bg-red-100"}`}>
                  {botInfo?.configured ? "🤖" : "⚠️"}
                </div>
                <div>
                  <p className={`font-bold text-sm ${botInfo?.configured ? "text-green-800" : "text-red-800"}`}>
                    {botInfo?.configured ? "Бот подключён ✅" : "Бот не настроен"}
                  </p>
                  {botInfo?.bot && <p className="text-xs text-green-700">@{botInfo.bot.username} · ID: {botInfo.bot.id}</p>}
                  {botInfo?.error && <p className="text-xs text-red-600">{botInfo.error}</p>}
                </div>
              </div>
              <div className="space-y-1.5 text-xs">
                <InfoRow label="Env var" value={botInfo?.tokenEnv ?? "kapelan_telegram_bot_token"} mono />
                <InfoRow label="Admin Chat ID" value={botInfo?.adminChatId ?? "Не настроено"} mono />
              </div>
            </div>

            {/* Test button */}
            <button onClick={testBot} disabled={testingBot}
              className="w-full bg-violet-600 text-white rounded-2xl py-4 font-bold text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2.5 shadow-md shadow-violet-200">
              {testingBot
                ? <><span className="animate-spin">⏳</span> Отправляем тест...</>
                : <><span className="text-xl">📤</span>
                  <div className="text-left">
                    <p className="font-black">Отправить тестовое сообщение</p>
                    <p className="text-violet-200 text-xs font-normal">Проверка подключения к Telegram</p>
                  </div>
                </>}
            </button>

            {/* How it works */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Как работает система</p>
              <div className="space-y-3">
                {[
                  { icon: "🔧", title: "Монтаж завершён", desc: 'Лид переходит в статус "Выполнено"' },
                  { icon: "🔔", title: "Напоминание создаётся", desc: "Автоматически: дата монтажа + 1 год" },
                  { icon: "📅", title: "За 7 дней до ТО", desc: "Запланированное уведомление в Telegram" },
                  { icon: "📤", title: "В день ТО", desc: "Критическое уведомление админу и клиенту" },
                  { icon: "✅", title: "ТО выполнено", desc: "Напоминание закрывается" },
                ].map((s, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center text-sm flex-shrink-0">{s.icon}</div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                      <p className="text-xs text-slate-400">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Message preview */}
            <div className="bg-slate-900 rounded-2xl p-4">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">Пример сообщения</p>
              <pre className="text-[11px] text-green-400 font-mono whitespace-pre-wrap leading-relaxed">{
`🔴 <b>Напоминание о ТО кондиционера</b>

👤 Клиент: <b>Иван Иванов</b>
📞 Телефон: <b>+7 (999) XXX-XX-XX</b>
📍 Адрес: ул. Пушкина 1, кв. 5
❄️ Модель: Mitsubishi MSZ-HR25VF (9kBTU)

📅 Дата монтажа: 17.03.2025
🔔 Дата ТО: 17.03.2026
⏱ Просрочено на 0 дн.

📋 Позвоните клиенту и предложите 
техническое обслуживание кондиционера.`}
              </pre>
            </div>

            {/* Check & notify */}
            <button onClick={checkAndNotifyAll} disabled={checkingAll}
              className="w-full bg-slate-800 text-white rounded-2xl py-3.5 font-bold text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
              {checkingAll ? "⏳ Проверяем..." : "🤖 Запустить авто-проверку напоминаний"}
            </button>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {detailReminder && (
        <ReminderDetailModal
          reminder={detailReminder}
          notifications={detailNotifs}
          sending={sendingId === detailReminder.id}
          onClose={() => { setDetailReminder(null); setDetailNotifs([]); }}
          onSend={() => sendNotification(detailReminder.id)}
          onStatusChange={s => updateStatus(detailReminder.id, s)}
          onDelete={() => deleteReminder(detailReminder.id)}
          onUpdate={async (patch) => {
            const res = await fetch(`${API}/reminders/${detailReminder.id}`, { method: "PATCH", headers: JH, body: JSON.stringify(patch) });
            const data = await res.json();
            if (data.reminder) { setReminders(prev => prev.map(r => r.id === detailReminder.id ? data.reminder : r)); setDetailReminder(data.reminder); showToast("Сохранено ✅"); }
            else showToast(data.error, false);
          }}
        />
      )}
      {showNewForm && (
        <NewReminderModal
          onClose={() => setShowNewForm(false)}
          onSave={async (body) => {
            const res = await fetch(`${API}/reminders`, { method: "POST", headers: JH, body: JSON.stringify(body) });
            const data = await res.json();
            if (data.reminder) { setReminders(prev => [...prev, data.reminder]); showToast("Напоминание создано ✅"); }
            else showToast(data.error, false);
            setShowNewForm(false);
          }}
        />
      )}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl shadow-xl text-white text-sm font-semibold max-w-xs text-center ${
          toast.ok ? "bg-violet-700" : "bg-red-600"
        }`}>{toast.text}</div>
      )}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ icon, title, accent, children }: { icon: string; title: string; accent: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={`flex items-center gap-2 mb-2 pb-1.5 border-b ${accent}`}>
        <span>{icon}</span>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{title}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ─── Reminder Card ────────────────────────────────────────────────────────────
function ReminderCard({ reminder: r, onDetail, onSend, sending }: {
  reminder: ServiceReminder;
  onDetail: () => void; onSend: () => void; sending: boolean;
}) {
  const days = getDaysUntil(r.reminderDate);
  const urg  = urgencyLabel(days);
  const st   = STATUS_CFG[r.status];
  const isDone = r.status === "done" || r.status === "cancelled";

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${!isDone && days < 0 ? "border-red-200" : !isDone && days <= 7 ? "border-amber-200" : "border-slate-100"}`}>
      <button onClick={onDetail} className="w-full px-4 pt-3 pb-2.5 text-left active:bg-slate-50">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center text-lg flex-shrink-0">
            {st.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <p className="text-sm font-bold text-slate-800">{r.clientName}</p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${urg.cls}`}>
                {urg.text}
              </span>
            </div>
            <p className="text-xs text-slate-400">{r.clientPhone}</p>
            {r.acModel && <p className="text-xs text-violet-600 font-medium mt-0.5 truncate">❄️ {r.acModel}</p>}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-black text-slate-800">{fmt(r.reminderDate)}</p>
            <p className="text-[10px] text-slate-400">монтаж: {fmt(r.installationDate)}</p>
          </div>
        </div>
        {/* Progress bar (days until) */}
        {!isDone && (
          <div className="mt-2 w-full bg-slate-100 rounded-full h-1">
            <div className={`h-1 rounded-full transition-all ${days < 0 ? "bg-red-500 w-full" : days <= 7 ? "bg-amber-400" : days <= 30 ? "bg-blue-400" : "bg-violet-300"}`}
              style={{ width: days < 0 ? "100%" : `${Math.max(5, 100 - Math.min(100, days / 3.65))}%` }} />
          </div>
        )}
        <div className="flex items-center justify-between mt-1.5">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`}/>{st.label}
          </span>
          {r.notificationsSent > 0 && (
            <span className="text-[10px] text-slate-400">📤 {r.notificationsSent} уведомлений</span>
          )}
        </div>
      </button>
      {!isDone && (
        <div className="border-t border-slate-100">
          <button onClick={onSend} disabled={sending}
            className="w-full py-2.5 text-xs font-bold text-violet-700 flex items-center justify-center gap-1.5 active:bg-violet-50 disabled:opacity-60">
            {sending ? <><span className="animate-spin">⏳</span> Отправляем...</> : <><span>📤</span> Отправить уведомление в Telegram</>}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────
function ReminderDetailModal({ reminder: r, notifications, sending, onClose, onSend, onStatusChange, onDelete, onUpdate }: {
  reminder: ServiceReminder; notifications: ReminderNotification[]; sending: boolean;
  onClose: () => void; onSend: () => void;
  onStatusChange: (s: ServiceReminder["status"]) => void;
  onDelete: () => void; onUpdate: (patch: any) => Promise<void>;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [editNotes, setEditNotes]   = useState(r.notes ?? "");
  const [editTgId, setEditTgId]     = useState(r.clientTgChatId ?? "");
  const [editAddr, setEditAddr]     = useState(r.address ?? "");
  const [saving, setSaving]         = useState(false);
  const days = getDaysUntil(r.reminderDate);
  const urg  = urgencyLabel(days);
  const st   = STATUS_CFG[r.status];
  const isDone = r.status === "done" || r.status === "cancelled";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-w-md mx-auto pb-8 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center text-2xl flex-shrink-0">
              {st.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-slate-800 text-lg leading-tight">{r.clientName}</p>
              <p className="text-sm text-slate-400">{r.clientPhone}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`}/>{st.label}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${urg.cls}`}>{urg.text}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Key dates */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[10px] text-slate-400 font-semibold">Дата монтажа</p>
              <p className="text-sm font-black text-slate-800 mt-0.5">{fmt(r.installationDate)}</p>
            </div>
            <div className={`rounded-xl p-3 border ${urg.cls}`}>
              <p className="text-[10px] font-semibold opacity-70">Дата ТО</p>
              <p className="text-sm font-black mt-0.5">{fmt(r.reminderDate)}</p>
            </div>
          </div>

          {/* Info */}
          <div className="bg-violet-50 rounded-2xl border border-violet-100 p-3 space-y-1.5">
            {r.acModel  && <InfoRow label="❄️ Модель"     value={r.acModel} />}
            {r.address  && <InfoRow label="📍 Адреса"     value={r.address} />}
            {r.clientEmail && <InfoRow label="📧 Email"   value={r.clientEmail} />}
            {r.lastNotifiedAt && <InfoRow label="📤 Посл. уведомление" value={new Date(r.lastNotifiedAt).toLocaleString("ru-RU")} />}
            <InfoRow label="📊 Уведомлений отправлено" value={String(r.notificationsSent)} />
            {r.nextNotifyAt && !isDone && <InfoRow label="⏭ Следующее" value={fmt(r.nextNotifyAt)} />}
          </div>

          {/* Edit fields */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Адрес клиента</label>
              <input value={editAddr} onChange={e => setEditAddr(e.target.value)} placeholder="ул. Пушкина 1, кв. 5"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Telegram Chat ID клиента (необяз.)</label>
              <input value={editTgId} onChange={e => setEditTgId(e.target.value)} placeholder="напр. 123456789"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400" />
              <p className="text-[10px] text-slate-400 mt-1">Если указано — клиент также получит уведомление лично</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Примечания</label>
              <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
            <button disabled={saving}
              onClick={async () => { setSaving(true); await onUpdate({ address: editAddr, clientTgChatId: editTgId || null, notes: editNotes }); setSaving(false); }}
              className="w-full bg-slate-100 text-slate-700 rounded-xl py-2.5 text-sm font-semibold active:scale-95 disabled:opacity-60">
              {saving ? "Сохранение..." : "💾 Сохранить изменения"}
            </button>
          </div>

          {/* Send notification */}
          {!isDone && (
            <button onClick={onSend} disabled={sending}
              className="w-full bg-violet-600 text-white rounded-2xl py-4 font-bold text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2 shadow-md shadow-violet-200">
              {sending ? <><span className="animate-spin">⏳</span> Отправляем...</> : <><span className="text-xl">📤</span> Отправить уведомление в Telegram</>}
            </button>
          )}

          {/* Status change */}
          {!isDone && (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onStatusChange("done")}
                className="bg-green-50 text-green-700 border border-green-200 rounded-xl py-2.5 text-xs font-bold active:scale-95">
                ✅ Отметить выполненным
              </button>
              <button onClick={() => onStatusChange("cancelled")}
                className="bg-slate-50 text-slate-500 border border-slate-200 rounded-xl py-2.5 text-xs font-bold active:scale-95">
                🚫 Отменить
              </button>
            </div>
          )}

          {/* Notification history */}
          {notifications.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">История уведомлений</p>
              <div className="space-y-1.5">
                {notifications.map(n => (
                  <div key={n.id} className={`flex items-center gap-2.5 rounded-xl px-3 py-2 border ${n.success ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"}`}>
                    <span className="text-base">{n.channel === "telegram_admin" ? "🤖" : "👤"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700">{n.channel === "telegram_admin" ? "Админ" : "Клиент"}</p>
                      <p className="text-[10px] text-slate-400">{new Date(n.sentAt).toLocaleString("ru-RU")}</p>
                      {n.error && <p className="text-[10px] text-red-600">{n.error}</p>}
                    </div>
                    <span className={`text-xs font-bold ${n.success ? "text-green-700" : "text-red-600"}`}>{n.success ? "✅" : "❌"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Delete */}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-3 text-sm font-semibold">Закрыть</button>
            {!confirmDel
              ? <button onClick={() => setConfirmDel(true)} className="bg-red-50 text-red-500 border border-red-100 rounded-xl px-4 py-3 text-sm font-semibold active:scale-95">🗑️</button>
              : <button onClick={onDelete} className="bg-red-600 text-white rounded-xl px-4 py-3 text-sm font-bold active:scale-95">Удалить?</button>
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── New Reminder Modal ───────────────────────────────────────────────────────
function NewReminderModal({ onClose, onSave }: {
  onClose: () => void; onSave: (body: any) => Promise<void>;
}) {
  const [form, setForm] = useState({
    clientName: "", clientPhone: "", clientEmail: "",
    clientTgChatId: "", acModel: "", address: "", notes: "",
    installationDate: new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const f = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }));

  const reminderDate = (() => {
    const d = new Date(form.installationDate);
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  })();

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-w-md mx-auto pb-8 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-slate-100">
          <p className="font-black text-slate-800 text-lg">🔔 Новое напоминание о ТО</p>
        </div>
        <div className="px-5 py-4 space-y-3.5">
          {[
            { label: "Имя клиента *", key: "clientName", placeholder: "Иван Иванов" },
            { label: "Телефон *", key: "clientPhone", placeholder: "+7 (999) XXX-XX-XX" },
            { label: "Email", key: "clientEmail", placeholder: "email@example.com" },
            { label: "Telegram Chat ID клиента", key: "clientTgChatId", placeholder: "123456789" },
            { label: "Модель кондиционера", key: "acModel", placeholder: "Mitsubishi MSZ-HR25VF" },
            { label: "Адрес", key: "address", placeholder: "ул. Пушкина 1, кв. 5" },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="text-xs font-semibold text-slate-500 block mb-1">{label}</label>
              <input value={(form as any)[key]} onChange={e => f(key)(e.target.value)} placeholder={placeholder}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
          ))}

          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">Дата монтажа</label>
            <input type="date" value={form.installationDate} onChange={e => f("installationDate")(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
          </div>

          <div className="bg-violet-50 border border-violet-100 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-violet-700 font-semibold">📅 Дата напоминания (ТО):</span>
            <span className="text-sm font-black text-violet-800">{reminderDate}</span>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">Примечания</label>
            <textarea value={form.notes} onChange={e => f("notes")(e.target.value)} rows={2}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" />
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-3 text-sm font-semibold">Отмена</button>
            <button
              onClick={async () => {
                if (!form.clientName || !form.clientPhone) return;
                setSaving(true);
                await onSave({ ...form, clientEmail: form.clientEmail || null, clientTgChatId: form.clientTgChatId || null });
                setSaving(false);
              }}
              disabled={saving || !form.clientName || !form.clientPhone}
              className="flex-1 bg-violet-600 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-60 active:scale-95">
              {saving ? "Создание..." : "➕ Создать напоминание"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className={`text-xs font-semibold text-slate-700 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function EmptyState({ icon, text, sub }: { icon: string; text: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center py-14 text-slate-400 gap-2 px-8">
      <span className="text-4xl">{icon}</span>
      <p className="text-sm font-semibold text-center">{text}</p>
      {sub && <p className="text-xs text-center text-slate-300">{sub}</p>}
    </div>
  );
}