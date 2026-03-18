// ─── SERVICE REMINDERS MODULE ─────────────────────────────────────────────────
// After installation (lead → "done"): auto-create reminder for +1 year
// Telegram notifications via kapelan_telegram_bot_token
import * as kv from "./kv_store.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ServiceReminder {
  id: string;
  leadId: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string | null;
  clientTgChatId?: string | null;   // if client has personal TG chat
  installationDate: string;          // ISO — when lead → "done"
  reminderDate: string;              // installationDate + 1 year
  status: "pending" | "notified" | "scheduled" | "done" | "cancelled";
  notificationsSent: number;
  lastNotifiedAt?: string | null;
  nextNotifyAt?: string | null;      // when to auto-notify again (e.g. +7 days before due)
  acModel?: string | null;
  address?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderNotification {
  id: string;
  reminderId: string;
  clientName: string;
  channel: "telegram_admin" | "telegram_client";
  chatId: string;
  message: string;
  success: boolean;
  error?: string;
  sentAt: string;
}

// ─── TG helper (uses kapelan_telegram_bot_token) ──────────────────────────────
async function getAdminChatId(): Promise<string | null> {
  return await kv.get("config:tgAdminChatId");
}

async function sendTgMessage(
  chatId: string,
  text: string,
  botToken?: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = botToken ?? Deno.env.get("kapelan_telegram_bot_token") ?? Deno.env.get("tg_bot_biznes_mova");
  if (!token) return { ok: false, error: "Bot token not configured (kapelan_telegram_bot_token)" };
  if (!chatId) return { ok: false, error: "Chat ID is empty" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description ?? "Unknown TG error" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── Notification message builder ─────────────────────────────────────────────
function buildAdminNotificationText(r: ServiceReminder, daysUntil: number): string {
  const installDate = new Date(r.installationDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  const remindDate  = new Date(r.reminderDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  const urgencyEmoji = daysUntil < 0 ? "🔴" : daysUntil === 0 ? "🟠" : daysUntil <= 7 ? "🟡" : "🔔";
  const urgencyText  = daysUntil < 0
    ? `⚠️ Просрочено на ${Math.abs(daysUntil)} дн.`
    : daysUntil === 0 ? "⚡ Сегодня!"
    : `📅 Через ${daysUntil} дн.`;

  return [
    `${urgencyEmoji} <b>Напоминание о ТО кондиционера</b>`,
    ``,
    `👤 Клиент: <b>${r.clientName}</b>`,
    `📞 Телефон: <b>${r.clientPhone}</b>`,
    r.clientEmail ? `📧 Email: ${r.clientEmail}` : "",
    r.address ? `📍 Адрес: ${r.address}` : "",
    r.acModel ? `❄️ Модель: ${r.acModel}` : "",
    ``,
    `📅 Дата монтажа: <b>${installDate}</b>`,
    `🔔 Дата ТО: <b>${remindDate}</b>`,
    `⏱ ${urgencyText}`,
    ``,
    `📋 Позвоните клиенту и предложите техническое обслуживание кондиционера.`,
    r.notes ? `💬 Примечание: ${r.notes}` : "",
    ``,
    `🕐 ${new Date().toLocaleString("ru-RU")}`,
    `🆔 ID напоминания: <code>${r.id.slice(-8)}</code>`,
  ].filter(s => s !== "").join("\n");
}

function buildClientNotificationText(r: ServiceReminder): string {
  const installDate = new Date(r.installationDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  return [
    `❄️ <b>Напоминание о техническом обслуживании</b>`,
    ``,
    `Здравствуйте, ${r.clientName}!`,
    ``,
    `Прошёл 1 год с момента установки вашего кондиционера (${installDate}).`,
    r.acModel ? `Модель: <b>${r.acModel}</b>` : "",
    ``,
    `Мы рекомендуем провести техническое обслуживание:`,
    `• Чистка фильтров и теплообменника`,
    `• Проверка уровня фреона`,
    `• Диагностика всех систем`,
    ``,
    `📞 Позвоните нам для записи: <b>${r.clientPhone}</b>`,
    ``,
    `С уважением,`,
    `<b>Ваша компания климатического оборудования</b> ❄️`,
  ].filter(s => s !== "").join("\n");
}

// ─── KV helpers ───────────────────────────────────────────────────────────────
async function getAllReminders(): Promise<ServiceReminder[]> {
  try {
    const all = await kv.getByPrefix("reminder:");
    return (all as string[]).map(r => JSON.parse(r)).filter(Boolean)
      .sort((a: ServiceReminder, b: ServiceReminder) =>
        new Date(a.reminderDate).getTime() - new Date(b.reminderDate).getTime());
  } catch (e) { console.error("getAllReminders:", e); return []; }
}

async function getReminder(id: string): Promise<ServiceReminder | null> {
  const raw = await kv.get(`reminder:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveReminder(r: ServiceReminder): Promise<void> {
  r.updatedAt = new Date().toISOString();
  await kv.set(`reminder:${r.id}`, JSON.stringify(r));
  // Index by lead
  await kv.set(`reminder_by_lead:${r.leadId}`, r.id);
}

async function logNotification(n: ReminderNotification): Promise<void> {
  await kv.set(`reminder_notif:${n.id}`, JSON.stringify(n));
  const idxRaw = await kv.get(`reminder_notif_idx:${n.reminderId}`);
  const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
  idx.unshift(n.id);
  await kv.set(`reminder_notif_idx:${n.reminderId}`, JSON.stringify(idx.slice(0, 50)));
}

// ─── Core: auto-create after installation ────────────────────────────────────
export async function createServiceReminderForLead(
  leadId: string,
  clientId: string,
  clientName: string,
  clientPhone: string,
  clientEmail?: string | null,
  acModel?: string | null,
  address?: string | null,
): Promise<ServiceReminder> {
  // Check if reminder already exists for this lead
  const existingId = await kv.get(`reminder_by_lead:${leadId}`);
  if (existingId) {
    const existing = await getReminder(existingId);
    if (existing) {
      console.log(`Reminder already exists for lead ${leadId}: ${existingId}`);
      return existing;
    }
  }

  const now = new Date();
  const reminderDate = new Date(now);
  reminderDate.setFullYear(reminderDate.getFullYear() + 1);

  // nextNotifyAt = reminderDate - 7 days (early warning)
  const nextNotifyAt = new Date(reminderDate);
  nextNotifyAt.setDate(nextNotifyAt.getDate() - 7);

  const id = `rem_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;
  const reminder: ServiceReminder = {
    id,
    leadId,
    clientId,
    clientName,
    clientPhone,
    clientEmail: clientEmail ?? null,
    clientTgChatId: null,
    installationDate: now.toISOString(),
    reminderDate: reminderDate.toISOString(),
    status: "pending",
    notificationsSent: 0,
    lastNotifiedAt: null,
    nextNotifyAt: nextNotifyAt.toISOString(),
    acModel: acModel ?? null,
    address: address ?? null,
    notes: "",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await saveReminder(reminder);
  console.log(`ServiceReminder created: ${id} for lead ${leadId}, due: ${reminderDate.toISOString().slice(0, 10)}`);
  return reminder;
}

// ─── Core: send notification for a reminder ──────────────────────────────────
async function sendReminderNotification(
  reminder: ServiceReminder,
  force = false,
): Promise<{ sent: number; errors: string[] }> {
  const now = new Date();
  const dueDate = new Date(reminder.reminderDate);
  const daysUntil = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  let sent = 0;
  const errors: string[] = [];

  // 1) Admin notification (always send)
  const adminChatId = await getAdminChatId();
  if (adminChatId) {
    const text = buildAdminNotificationText(reminder, daysUntil);
    const res = await sendTgMessage(adminChatId, text);
    const notif: ReminderNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      reminderId: reminder.id,
      clientName: reminder.clientName,
      channel: "telegram_admin",
      chatId: adminChatId,
      message: text,
      success: res.ok,
      error: res.error,
      sentAt: new Date().toISOString(),
    };
    await logNotification(notif);
    if (res.ok) { sent++; console.log(`Admin TG sent for reminder ${reminder.id}`); }
    else { errors.push(`Admin TG: ${res.error}`); console.error(`Admin TG failed:`, res.error); }
  } else {
    errors.push("Admin chat ID not configured");
  }

  // 2) Client notification (if client has TG chat ID)
  if (reminder.clientTgChatId) {
    const text = buildClientNotificationText(reminder);
    const res = await sendTgMessage(reminder.clientTgChatId, text);
    const notif: ReminderNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      reminderId: reminder.id,
      clientName: reminder.clientName,
      channel: "telegram_client",
      chatId: reminder.clientTgChatId,
      message: text,
      success: res.ok,
      error: res.error,
      sentAt: new Date().toISOString(),
    };
    await logNotification(notif);
    if (res.ok) { sent++; }
    else { errors.push(`Client TG: ${res.error}`); }
  }

  // Update reminder state
  reminder.notificationsSent = (reminder.notificationsSent || 0) + sent;
  reminder.lastNotifiedAt = new Date().toISOString();
  if (sent > 0) {
    reminder.status = "notified";
    // Schedule next notify in 7 days if still before due date
    if (daysUntil > 7) {
      const next = new Date();
      next.setDate(next.getDate() + 7);
      reminder.nextNotifyAt = next.toISOString();
    } else {
      reminder.nextNotifyAt = null;
    }
  }
  await saveReminder(reminder);

  return { sent, errors };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
export function registerRemindersRoutes(app: any): void {
  const P = "/make-server-1df47c03";

  // GET all reminders
  app.get(`${P}/reminders`, async (c: any) => {
    try {
      const reminders = await getAllReminders();
      const now = new Date();
      const stats = {
        total: reminders.length,
        pending:   reminders.filter(r => r.status === "pending").length,
        notified:  reminders.filter(r => r.status === "notified").length,
        overdue:   reminders.filter(r => r.status !== "done" && r.status !== "cancelled" && new Date(r.reminderDate) < now).length,
        upcoming7: reminders.filter(r => {
          if (r.status === "done" || r.status === "cancelled") return false;
          const d = new Date(r.reminderDate);
          const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
          return diff >= 0 && diff <= 7;
        }).length,
        done: reminders.filter(r => r.status === "done").length,
      };
      return c.json({ reminders, stats });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch reminders: ${error.message}` }, 500);
    }
  });

  // GET reminders due (overdue + upcoming 7 days)
  app.get(`${P}/reminders/due`, async (c: any) => {
    try {
      const all = await getAllReminders();
      const now = new Date();
      const due = all.filter(r => {
        if (r.status === "done" || r.status === "cancelled") return false;
        const d = new Date(r.reminderDate);
        const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        return diff <= 7; // overdue OR within 7 days
      });
      return c.json({ reminders: due, count: due.length });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch due reminders: ${error.message}` }, 500);
    }
  });

  // GET single reminder
  app.get(`${P}/reminders/:id`, async (c: any) => {
    try {
      const r = await getReminder(c.req.param("id"));
      if (!r) return c.json({ error: "Not found" }, 404);
      // Load notification history
      const idxRaw = await kv.get(`reminder_notif_idx:${r.id}`);
      const notifIds: string[] = idxRaw ? JSON.parse(idxRaw) : [];
      const notifications = (await Promise.all(notifIds.map((id: string) => kv.get(`reminder_notif:${id}`))))
        .filter(Boolean).map((x: any) => JSON.parse(x));
      return c.json({ reminder: r, notifications });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // GET reminder by lead
  app.get(`${P}/reminders/lead/:leadId`, async (c: any) => {
    try {
      const existingId = await kv.get(`reminder_by_lead:${c.req.param("leadId")}`);
      if (!existingId) return c.json({ reminder: null });
      const r = await getReminder(existingId);
      return c.json({ reminder: r });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // POST create reminder manually
  app.post(`${P}/reminders`, async (c: any) => {
    try {
      const body = await c.req.json();
      const {
        leadId = `manual_${Date.now()}`,
        clientId = "",
        clientName, clientPhone, clientEmail,
        clientTgChatId,
        installationDate,
        reminderDate,
        acModel, address, notes,
      } = body;
      if (!clientName || !clientPhone) return c.json({ error: "clientName and clientPhone required" }, 400);

      const instDate = installationDate ? new Date(installationDate) : new Date();
      const remDate  = reminderDate ? new Date(reminderDate) : (() => {
        const d = new Date(instDate); d.setFullYear(d.getFullYear() + 1); return d;
      })();
      const nextNotify = new Date(remDate);
      nextNotify.setDate(nextNotify.getDate() - 7);

      const id = `rem_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;
      const reminder: ServiceReminder = {
        id, leadId, clientId, clientName, clientPhone,
        clientEmail: clientEmail ?? null,
        clientTgChatId: clientTgChatId ?? null,
        installationDate: instDate.toISOString(),
        reminderDate: remDate.toISOString(),
        status: "pending",
        notificationsSent: 0,
        lastNotifiedAt: null,
        nextNotifyAt: nextNotify.toISOString(),
        acModel: acModel ?? null,
        address: address ?? null,
        notes: notes ?? "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveReminder(reminder);
      return c.json({ reminder });
    } catch (error: any) {
      return c.json({ error: `Failed to create reminder: ${error.message}` }, 500);
    }
  });

  // PATCH update reminder
  app.patch(`${P}/reminders/:id`, async (c: any) => {
    try {
      const r = await getReminder(c.req.param("id"));
      if (!r) return c.json({ error: "Not found" }, 404);
      const body = await c.req.json();
      const allowed = ["status", "reminderDate", "clientTgChatId", "acModel", "address", "notes", "nextNotifyAt"];
      for (const k of allowed) { if (body[k] !== undefined) (r as any)[k] = body[k]; }
      await saveReminder(r);
      return c.json({ reminder: r });
    } catch (error: any) {
      return c.json({ error: `Failed to update: ${error.message}` }, 500);
    }
  });

  // DELETE reminder
  app.delete(`${P}/reminders/:id`, async (c: any) => {
    try {
      await kv.del(`reminder:${c.req.param("id")}`);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: `Failed to delete: ${error.message}` }, 500);
    }
  });

  // POST send notification for specific reminder
  app.post(`${P}/reminders/:id/notify`, async (c: any) => {
    try {
      const r = await getReminder(c.req.param("id"));
      if (!r) return c.json({ error: "Not found" }, 404);
      if (r.status === "done" || r.status === "cancelled") {
        return c.json({ error: "Reminder is closed" }, 400);
      }
      const result = await sendReminderNotification(r, true);
      return c.json({ ...result, reminder: await getReminder(r.id) });
    } catch (error: any) {
      console.error("notify error:", error);
      return c.json({ error: `Failed to send notification: ${error.message}` }, 500);
    }
  });

  // POST check-and-notify: scan all due reminders and send TG (call manually or schedule)
  app.post(`${P}/reminders/check-and-notify`, async (c: any) => {
    try {
      const all = await getAllReminders();
      const now = new Date();
      const results: { id: string; clientName: string; sent: number; errors: string[] }[] = [];
      let totalSent = 0;

      for (const r of all) {
        if (r.status === "done" || r.status === "cancelled") continue;

        // Check if nextNotifyAt has passed, or reminderDate has passed
        const isNextNotifyDue = r.nextNotifyAt && new Date(r.nextNotifyAt) <= now;
        const isReminderDue   = new Date(r.reminderDate) <= now;
        const isDue = isNextNotifyDue || isReminderDue;

        if (!isDue) continue;

        const result = await sendReminderNotification(r);
        results.push({ id: r.id, clientName: r.clientName, ...result });
        totalSent += result.sent;
      }

      console.log(`check-and-notify: checked ${all.length} reminders, ${results.length} notified, ${totalSent} messages sent`);
      return c.json({ checked: all.length, notified: results.length, totalSent, results });
    } catch (error: any) {
      console.error("check-and-notify error:", error);
      return c.json({ error: `Failed to check reminders: ${error.message}` }, 500);
    }
  });

  // POST test TG with kapelan_telegram_bot_token
  app.post(`${P}/reminders/test-tg`, async (c: any) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const adminChatId = body.chatId || await getAdminChatId();
      if (!adminChatId) return c.json({ error: "Chat ID not configured" }, 400);
      const token = Deno.env.get("kapelan_telegram_bot_token") ?? Deno.env.get("tg_bot_biznes_mova");
      if (!token) return c.json({ error: "kapelan_telegram_bot_token not configured" }, 400);
      const res = await sendTgMessage(
        adminChatId,
        `✅ <b>Тест: Система напоминаний</b>\n\n🔔 Подключение к Telegram боту работает!\n❄️ Система ТО кондиционеров готова к работе.\n\n🕐 ${new Date().toLocaleString("ru-RU")}`,
      );
      if (res.ok) return c.json({ success: true, chatId: adminChatId });
      return c.json({ error: res.error }, 500);
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // GET TG bot info (for setup verification)
  app.get(`${P}/reminders/bot-info`, async (c: any) => {
    try {
      const token = Deno.env.get("kapelan_telegram_bot_token") ?? Deno.env.get("tg_bot_biznes_mova");
      if (!token) return c.json({ configured: false, error: "kapelan_telegram_bot_token not set" });
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await res.json();
      const adminChatId = await getAdminChatId();
      return c.json({
        configured: data.ok,
        bot: data.ok ? data.result : null,
        adminChatId,
        tokenEnv: "kapelan_telegram_bot_token",
      });
    } catch (error: any) {
      return c.json({ configured: false, error: error.message });
    }
  });
}