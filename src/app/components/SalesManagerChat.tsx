import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Badge } from "./ui/badge";
import {
  Send, Bot, User, CheckCircle2, Loader2, Sparkles,
  ClipboardPaste, MessageCircle, AlertCircle,
  Zap, ThermometerSnowflake, ClipboardCheck, Package,
  ListChecks, Plus, Trash2, ChevronRight, ArrowUpRight,
  MessageSquare, Clock
} from "lucide-react";
import { projectId, publicAnonKey } from "/utils/supabase/info";

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ActionItem {
  type: "ac_selected" | "consumables_checked" | "order_created" | "lead_created";
  title: string;
  data: any;
}
interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: ActionItem[];
}
interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
  lastReply: string;
  actionsCount: number;
  completed: boolean;
  messageCount: number;
}

function cleanMessage(content: string): string {
  return content.replace(/```json[\s\S]*?```/g, "").replace(/```[\s\S]*?```/g, "").trim();
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  return `${d} д назад`;
}

// ─── Tier config ───────────────────────────────────────────────────────────────
const TIER_CFG: Record<string, { label: string; bg: string; text: string; border: string; badge: string }> = {
  economy:  { label: "Эконом",   bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", badge: "💚" },
  standard: { label: "Стандарт", bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    badge: "💙" },
  premium:  { label: "Премиум",  bg: "bg-violet-50",  text: "text-violet-700",  border: "border-violet-200",  badge: "💜" },
};

// ─── Action Cards ──────────────────────────────────────────────────────────────
function AcSelectedCard({ data }: { data: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const models = data || [];
  if (!models.length) return null;
  const cfg = TIER_CFG[models[0].tier] || TIER_CFG.standard;
  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-3 mt-1`}>
      <div className="flex items-center gap-2 mb-2">
        <ThermometerSnowflake className={`size-4 ${cfg.text}`} />
        <span className="text-xs font-bold text-slate-700">Подобрано из каталога</span>
      </div>
      {(expanded ? models : models.slice(0, 1)).map((ac: any, i: number) => (
        <div key={ac.id} className={`rounded-lg p-2.5 bg-white border mb-1.5 ${i === 0 ? "border-blue-300 shadow-sm" : "border-slate-200"}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap gap-1 mb-1">
                {i === 0 && <span className="text-[9px] bg-amber-400 text-white font-bold px-1.5 py-0.5 rounded-full">✓ Лучший выбор</span>}
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cfg.text} ${cfg.bg}`}>{TIER_CFG[ac.tier]?.label}</span>
              </div>
              <p className="text-xs font-bold text-slate-800">{ac.brand} {ac.model}</p>
              <p className="text-[10px] text-slate-500">{ac.btu} BTU · {ac.areaMin}–{ac.areaMax} м² · гар. {ac.warranty} л</p>
            </div>
            <p className="text-sm font-black text-slate-800 flex-shrink-0">{ac.price?.toLocaleString()} ₴</p>
          </div>
          {ac.features?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {ac.features.slice(0, 3).map((f: string) => (
                <span key={f} className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{f}</span>
              ))}
            </div>
          )}
        </div>
      ))}
      {models.length > 1 && (
        <button onClick={() => setExpanded(v => !v)} className={`text-xs ${cfg.text} font-semibold flex items-center gap-1`}>
          {expanded ? "Скрыть" : `Ещё ${models.length - 1} варианта`}
          <ChevronRight className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
      )}
    </div>
  );
}

function ConsumablesCard({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const { items = [], allInStock, traceLength, acBrand, acModel: acMod } = data;
  const shortage = items.filter((i: any) => !i.inStock);
  const totalCost = items.reduce((s: number, i: any) => s + (i.price * i.qty), 0);
  return (
    <div className={`rounded-xl border p-3 mt-1 ${allInStock ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Package className={`size-4 ${allInStock ? "text-green-600" : "text-amber-600"}`} />
          <span className="text-xs font-bold text-slate-700 truncate max-w-[170px]">{acBrand} {acMod} · трасса {traceLength}м</span>
        </div>
        {allInStock
          ? <span className="text-[10px] bg-green-100 text-green-700 border border-green-300 font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">✅ В наличии</span>
          : <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-300 font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">⚠️ Нет {shortage.length} поз.</span>
        }
      </div>
      <div className="space-y-1">
        {(expanded ? items : items.slice(0, 5)).map((item: any) => (
          <div key={item.id} className="flex items-center justify-between text-[11px]">
            <span className={`flex-1 truncate mr-2 ${!item.inStock ? "text-red-700 font-semibold" : "text-slate-600"}`}>
              {!item.inStock ? "⚠️ " : ""}{item.name}
            </span>
            <span className="text-slate-500 flex-shrink-0 text-right">
              {item.qty} {item.unit}
              <span className={`ml-1 ${!item.inStock ? "text-red-500" : "text-green-600"}`}>
                (есть: {item.stock})
              </span>
            </span>
          </div>
        ))}
      </div>
      {items.length > 5 && (
        <button onClick={() => setExpanded(v => !v)} className="mt-1.5 text-[11px] text-blue-600 font-semibold">
          {expanded ? "Скрыть" : `+ ещё ${items.length - 5} позиций`}
        </button>
      )}
      <div className="mt-2 pt-2 border-t border-slate-200 flex justify-between items-center">
        <span className="text-[10px] text-slate-500">{items.length} позиций</span>
        <span className="text-xs font-bold text-slate-700">~{totalCost.toLocaleString()} ₴</span>
      </div>
    </div>
  );
}

function OrderCreatedCard({ data, onNavigate }: { data: any; onNavigate: (p: string) => void }) {
  const { order } = data;
  return (
    <div className="rounded-xl border-2 border-teal-300 bg-teal-50 p-3 mt-1">
      <div className="flex items-center gap-2 mb-2">
        <div className="size-6 rounded-full bg-teal-500 flex items-center justify-center">
          <CheckCircle2 className="size-4 text-white" />
        </div>
        <span className="text-sm font-bold text-teal-800">Ордер монтажа создан!</span>
      </div>
      <div className="bg-white rounded-lg p-2.5 border border-teal-200 space-y-1 text-xs">
        <div className="flex justify-between"><span className="text-slate-500">Клиент</span><span className="font-bold">{order?.clientName}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Телефон</span><span>{order?.clientPhone}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Кондиционер</span><span className="font-bold">{order?.acBrand} {order?.acModelName}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Площадь</span><span>{order?.roomArea} м² · {order?.roomType}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Стоимость</span><span className="font-bold">{order?.acPrice?.toLocaleString()} ₴</span></div>
      </div>
      <button onClick={() => onNavigate("/install-orders")} className="mt-2 w-full flex items-center justify-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg text-xs font-bold transition-colors">
        <ArrowUpRight className="size-3.5" />Открыть ордер монтажа
      </button>
    </div>
  );
}

function LeadCreatedCard({ data }: { data: any }) {
  const { client, lead } = data;
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 mt-1">
      <div className="flex items-center gap-2 mb-1.5">
        <CheckCircle2 className="size-4 text-blue-600" />
        <span className="text-xs font-bold text-blue-800">Заявка создана в CRM</span>
      </div>
      <p className="text-xs font-bold text-slate-800">{client?.name}</p>
      <p className="text-xs text-slate-500">{client?.phone}</p>
      <p className="text-[10px] text-blue-400 font-mono mt-1">ID: {lead?.id?.substring(0, 28)}…</p>
    </div>
  );
}

function ActionCard({ action, onNavigate }: { action: ActionItem; onNavigate: (p: string) => void }) {
  if (action.type === "ac_selected") return <AcSelectedCard data={action.data} />;
  if (action.type === "consumables_checked") return <ConsumablesCard data={action.data} />;
  if (action.type === "order_created") return <OrderCreatedCard data={action.data} onNavigate={onNavigate} />;
  if (action.type === "lead_created") return <LeadCreatedCard data={action.data} />;
  return null;
}

// ─── Session actions summary row ───────────────────────────────────────────────
function ActionSummaryRow({ action }: { action: ActionItem }) {
  const cfg: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
    ac_selected:        { icon: <ThermometerSnowflake className="size-3" />, color: "text-blue-600",   bg: "bg-blue-100" },
    consumables_checked:{ icon: <Package className="size-3" />,              color: "text-green-600",  bg: "bg-green-100" },
    order_created:      { icon: <ClipboardCheck className="size-3" />,       color: "text-teal-600",   bg: "bg-teal-100" },
    lead_created:       { icon: <CheckCircle2 className="size-3" />,          color: "text-violet-600", bg: "bg-violet-100" },
  };
  const c = cfg[action.type] || cfg.lead_created;
  let sub = "";
  if (action.type === "ac_selected" && action.data?.[0])
    sub = `${action.data[0].brand} · ${action.data[0].price?.toLocaleString()} ₴`;
  else if (action.type === "consumables_checked")
    sub = `${action.data?.items?.length || 0} позиций · трасса ${action.data?.traceLength}м`;
  else if (action.type === "order_created")
    sub = `${action.data?.order?.clientName}`;
  else if (action.type === "lead_created")
    sub = action.data?.client?.name || "";
  return (
    <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-2">
      <div className={`size-5 rounded-lg ${c.bg} ${c.color} flex items-center justify-center flex-shrink-0`}>{c.icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold text-slate-700 leading-tight truncate">{action.title}</p>
        {sub && <p className="text-[10px] text-slate-500 truncate">{sub}</p>}
      </div>
      <CheckCircle2 className="size-3 text-green-500 flex-shrink-0" />
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────
type ChatMode = "dialog" | "paste";

export function SalesManagerChat() {
  const [mode, setMode] = useState<ChatMode>("dialog");
  return (
    <div className="w-full max-w-[1400px] mx-auto flex flex-col gap-3 h-full">
      <div className="flex gap-2 bg-white rounded-xl border border-slate-200 p-1.5 shadow-sm flex-shrink-0">
        <button
          onClick={() => setMode("dialog")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${mode === "dialog" ? "bg-blue-600 text-white shadow" : "text-slate-500 hover:bg-slate-50"}`}
        >
          <MessageCircle size={15} />AI Диалог
        </button>
        <button
          onClick={() => setMode("paste")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${mode === "paste" ? "bg-violet-600 text-white shadow" : "text-slate-500 hover:bg-slate-50"}`}
        >
          <ClipboardPaste size={15} />Вставить переписку
        </button>
      </div>
      {mode === "dialog" ? <DialogMode /> : <PasteMode />}
    </div>
  );
}

// ─── Dialog Mode ───────────────────────────────────────────────────────────────
function DialogMode() {
  const navigate = useNavigate();

  // Sessions list
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Active session
  const [sessionId, setSessionId] = useState<string>(() => newSessionId());
  const [messages, setMessages] = useState<Message[]>([]);
  const [allActions, setAllActions] = useState<ActionItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isNewSession, setIsNewSession] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; };
  useEffect(scrollToBottom, [messages]);

  function newSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Load sessions list
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chat-sessions`, { headers: AH });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (e) { console.error("loadSessions:", e); }
    finally { setSessionsLoading(false); }
  }, []);

  useEffect(() => { loadSessions(); }, []);

  // Send initial greeting for new sessions
  useEffect(() => {
    if (isNewSession) { sendGreeting(sessionId); }
  }, [sessionId]);

  async function sendGreeting(sid: string) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST", headers: JH,
        body: JSON.stringify({ sessionId: sid, message: "Привет! Коротко расскажи что умеешь.", history: [] }),
      });
      if (res.ok) {
        const data = await res.json();
        const content = cleanMessage(data.message || "");
        if (content) setMessages([{ role: "assistant", content, actions: [] }]);
      }
    } catch (e) { console.error("greeting:", e); }
    finally { setLoading(false); }
  }

  // Switch to an existing session
  async function openSession(sid: string) {
    if (sid === sessionId) return;
    setLoading(true);
    setMessages([]);
    setAllActions([]);
    setInput("");
    setIsNewSession(false);
    try {
      const res = await fetch(`${API_BASE}/chat-session/${sid}`, { headers: AH });
      if (res.ok) {
        const data = await res.json();
        const hist: Message[] = (data.history || [])
          .filter((m: any) => m.role === "user" || m.role === "assistant")
          .map((m: any) => ({ role: m.role, content: m.content, actions: [] }));
        setMessages(hist);
        setAllActions(data.actions || []);
      }
    } catch (e) { console.error("openSession:", e); }
    finally { setLoading(false); setSessionId(sid); }
  }

  // Create new session
  function createNewSession() {
    const sid = newSessionId();
    setSessionId(sid);
    setMessages([]);
    setAllActions([]);
    setInput("");
    setIsNewSession(true);
  }

  // Delete a session
  async function deleteSession(sid: string, e: React.MouseEvent) {
    e.stopPropagation();
    setDeletingId(sid);
    try {
      await fetch(`${API_BASE}/chat-session/${sid}`, { method: "DELETE", headers: AH });
      setSessions(prev => prev.filter(s => s.id !== sid));
      if (sid === sessionId) createNewSession();
    } catch (e) { console.error("deleteSession:", e); }
    finally { setDeletingId(null); }
  }

  // Send message
  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setLoading(true);
    const histForApi = messages.map(m => ({ role: m.role, content: m.content }));
    const updated: Message[] = [...messages, { role: "user", content: userMsg }];
    setMessages(updated);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST", headers: JH,
        body: JSON.stringify({ sessionId, message: userMsg, history: histForApi }),
      });
      if (res.ok) {
        const data = await res.json();
        const content = cleanMessage(data.message || "");
        const acts: ActionItem[] = data.actions || [];
        const newMessages: Message[] = [...updated, { role: "assistant", content, actions: acts }];
        setMessages(newMessages);
        if (acts.length) {
          const newAllActions = [...allActions, ...acts];
          setAllActions(newAllActions);
          // Persist actions for this session
          await fetch(`${API_BASE}/chat-session-actions/${sessionId}`, {
            method: "POST", headers: JH,
            body: JSON.stringify({ actions: newAllActions }),
          });
        }
        // Refresh sessions list to show updated metadata
        loadSessions();
        setIsNewSession(false);
      } else {
        setMessages([...updated, { role: "assistant", content: "Ошибка. Попробуйте ещё раз.", actions: [] }]);
      }
    } catch (e) {
      console.error("sendMessage:", e);
      setMessages([...updated, { role: "assistant", content: "Ошибка соединения.", actions: [] }]);
    } finally { setLoading(false); }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const latestOrderAction = [...allActions].reverse().find(a => a.type === "order_created");
  const quickActions = [
    "Подбери кондиционер для квартиры 45 кв.м",
    "Клиент: Иван, +380991234567, офис 60 м², нужен ордер",
    "Проверь расходники для ac_eco_12, трасса 5м",
  ];

  return (
    <div className="flex gap-3 flex-1 min-h-0">

      {/* ── Left: Sessions Sidebar ─────────────────────────────────────────── */}
      <Card className="w-64 flex-shrink-0 flex flex-col min-h-0 hidden lg:flex">
        <CardHeader className="border-b flex-shrink-0 py-3 px-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <MessageSquare className="size-3.5 text-blue-500" />Диалоги
            </CardTitle>
            <button
              onClick={createNewSession}
              className="size-7 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-colors"
              title="Новый диалог"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </CardHeader>

        <div className="flex-1 overflow-y-auto">
          {sessionsLoading && sessions.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-4 animate-spin text-slate-400" />
            </div>
          )}

          {sessions.length === 0 && !sessionsLoading && (
            <div className="p-4 text-center">
              <MessageSquare className="size-8 text-slate-200 mx-auto mb-2" />
              <p className="text-xs text-slate-400">Нет сохранённых диалогов</p>
            </div>
          )}

          <div className="p-2 space-y-1">
            {sessions.map(sess => (
              <button
                key={sess.id}
                onClick={() => openSession(sess.id)}
                className={`w-full text-left rounded-xl p-2.5 transition-all group relative ${
                  sess.id === sessionId
                    ? "bg-blue-50 border border-blue-200"
                    : "hover:bg-slate-50 border border-transparent"
                }`}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <p className={`text-[11px] font-bold leading-tight line-clamp-2 flex-1 ${sess.id === sessionId ? "text-blue-800" : "text-slate-700"}`}>
                    {sess.title}
                  </p>
                  <button
                    onClick={(e) => deleteSession(sess.id, e)}
                    className="opacity-0 group-hover:opacity-100 size-5 rounded-md hover:bg-red-100 flex items-center justify-center flex-shrink-0 transition-all"
                    title="Удалить"
                  >
                    {deletingId === sess.id ? <Loader2 className="size-3 animate-spin text-red-400" /> : <Trash2 className="size-3 text-red-400" />}
                  </button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <div className="flex items-center gap-0.5 text-[9px] text-slate-400">
                    <Clock className="size-2.5" />{timeAgo(sess.updatedAt)}
                  </div>
                  {sess.actionsCount > 0 && (
                    <span className="text-[9px] bg-blue-100 text-blue-600 font-bold px-1 py-0.5 rounded-full">
                      {sess.actionsCount} дейст.
                    </span>
                  )}
                  {sess.completed && (
                    <span className="text-[9px] bg-teal-100 text-teal-600 font-bold px-1 py-0.5 rounded-full">✓</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Center: Chat ───────────────────────────────────────────────────── */}
      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="border-b flex-shrink-0 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="size-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-sm">
                <Bot className="size-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-sm">AI Автоматизация монтажа</CardTitle>
                <CardDescription className="text-xs">Подбирает оборудование · Проверяет склад · Создаёт ордера</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-slate-500">Активен</span>
              </div>
              <button
                onClick={createNewSession}
                className="lg:hidden flex items-center gap-1.5 text-xs bg-blue-600 text-white px-2.5 py-1.5 rounded-lg"
              >
                <Plus className="size-3.5" />Новый
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col p-0 min-h-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Empty state */}
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-center py-8 gap-4">
                <div className="size-16 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                  <Zap className="size-8 text-blue-400" />
                </div>
                <div>
                  <p className="font-bold text-slate-700 mb-1">AI-агент готов к работе</p>
                  <p className="text-sm text-slate-500">Попросите подобрать кондиционер и создать ордер</p>
                </div>
                <div className="flex flex-col gap-2 w-full max-w-sm">
                  {quickActions.map(q => (
                    <button key={q} onClick={() => setInput(q)}
                      className="text-xs bg-slate-50 hover:bg-blue-50 hover:text-blue-700 border border-slate-200 hover:border-blue-200 text-slate-600 px-3 py-2 rounded-xl transition-colors text-left">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => {
              const content = msg.role === "assistant" ? cleanMessage(msg.content) : msg.content;
              if (msg.role === "assistant" && !content && !msg.actions?.length) return null;
              return (
                <div key={idx}>
                  <div className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.role === "assistant" && (
                      <div className="size-7 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
                        <Bot className="size-3.5 text-white" />
                      </div>
                    )}
                    {content && (
                      <div className={`rounded-2xl px-3.5 py-2.5 max-w-[78%] shadow-sm ${
                        msg.role === "user" ? "bg-blue-600 text-white" : "bg-white border border-slate-200 text-slate-800"
                      }`}>
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
                      </div>
                    )}
                    {msg.role === "user" && (
                      <div className="size-7 rounded-xl bg-slate-200 flex items-center justify-center flex-shrink-0 mt-1">
                        <User className="size-3.5 text-slate-600" />
                      </div>
                    )}
                  </div>
                  {msg.role === "assistant" && msg.actions && msg.actions.length > 0 && (
                    <div className="ml-10 space-y-2 mt-1">
                      {msg.actions.map((action, i) => (
                        <ActionCard key={i} action={action} onNavigate={navigate} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-2.5 justify-start">
                <div className="size-7 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
                  <Bot className="size-3.5 text-white" />
                </div>
                <div className="rounded-2xl px-4 py-3 bg-white border border-slate-200 shadow-sm">
                  <div className="flex gap-1.5 items-center">
                    <span className="text-xs text-slate-400 mr-1">AI работает</span>
                    {[0, 150, 300].map(d => (
                      <span key={d} className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t p-3 flex-shrink-0 bg-white">
            <div className="flex gap-2">
              <Input
                placeholder="Напишите задачу: «Квартира 45 м², нужен кондиционер и ордер»..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={loading}
                className="flex-1 rounded-xl border-slate-200 text-sm"
              />
              <Button onClick={sendMessage} disabled={loading || !input.trim()} size="icon"
                className="bg-blue-600 hover:bg-blue-700 rounded-xl h-10 w-10 flex-shrink-0">
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Right: Actions Panel ───────────────────────────────────────────── */}
      <Card className="w-72 flex-shrink-0 flex flex-col min-h-0 hidden xl:flex">
        <CardHeader className="border-b flex-shrink-0 py-3">
          <CardTitle className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <ListChecks className="size-3.5 text-blue-600" />Действия AI в этом диалоге
          </CardTitle>
          <CardDescription className="text-[11px]">{allActions.length === 0 ? "Нет выполненных действий" : `Выполнено: ${allActions.length} операций`}</CardDescription>
        </CardHeader>

        <CardContent className="flex-1 overflow-auto p-3 space-y-2">
          {allActions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-6">
              <div className="size-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                <Zap className="size-6 text-slate-300" />
              </div>
              <p className="text-xs font-medium text-slate-500 mb-1">Действий пока нет</p>
              <p className="text-[11px] text-slate-400 leading-relaxed max-w-[180px]">
                AI выполнит действия автоматически: подбор кондиционера, проверка склада, создание ордера
              </p>
            </div>
          ) : (
            <>
              {allActions.map((action, i) => <ActionSummaryRow key={i} action={action} />)}
              {latestOrderAction && (
                <div className="pt-2 border-t border-slate-100 space-y-1.5">
                  <button onClick={() => navigate("/install-orders")}
                    className="w-full flex items-center justify-center gap-2 bg-teal-600 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-teal-700 transition-colors">
                    <ClipboardCheck className="size-3.5" />Перейти к ордеру
                  </button>
                  <button onClick={() => navigate("/leads")}
                    className="w-full flex items-center justify-center gap-2 bg-slate-100 text-slate-600 py-2 rounded-xl text-xs font-semibold hover:bg-slate-200 transition-colors">
                    Воронка заявок
                  </button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Paste Mode ───────────────────────────────────────────────────────────────
function PasteMode() {
  const [conversation, setConversation] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editArea, setEditArea] = useState("");
  const [editBudget, setEditBudget] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const syncFromParsed = (p: any) => {
    setEditName(p.client?.name || "");
    setEditPhone(p.client?.phone || "");
    setEditEmail(p.client?.email || "");
    setEditArea(p.requirements?.area?.toString() || "");
    setEditBudget(p.requirements?.budget?.toString() || "");
    setEditNotes(p.requirements?.additionalNotes || "");
  };

  const handleParse = async () => {
    if (conversation.trim().length < 10) { setError("Вставьте переписку (минимум 10 символов)"); return; }
    setParsing(true); setError(null); setParsed(null); setCreated(null);
    try {
      const res = await fetch(`${API_BASE}/parse-conversation`, { method: "POST", headers: JH, body: JSON.stringify({ conversation }) });
      const data = await res.json();
      if (data.parsed) { setParsed(data.parsed); syncFromParsed(data.parsed); }
      else setError(data.error || "Не удалось распарсить переписку");
    } catch (e: any) { setError(`Ошибка: ${e.message}`); }
    finally { setParsing(false); }
  };

  const handleCreateLead = async () => {
    if (!parsed) return;
    setCreating(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/create-lead-from-conversation`, {
        method: "POST", headers: JH,
        body: JSON.stringify({
          clientData: { name: editName || parsed.client?.name || "Клиент", phone: editPhone || parsed.client?.phone || "", email: editEmail || null },
          requirements: { area: editArea ? Number(editArea) : parsed.requirements?.area, roomType: parsed.requirements?.roomType, budget: editBudget ? Number(editBudget) : parsed.requirements?.budget, additionalNotes: editNotes || parsed.requirements?.additionalNotes },
          acRecommendation: parsed.acRecommendation,
        }),
      });
      const data = await res.json();
      if (data.success) setCreated({ client: data.client, lead: data.lead });
      else setError(data.error || "Ошибка создания заявки");
    } catch (e: any) { setError(`Ошибка: ${e.message}`); }
    finally { setCreating(false); }
  };

  if (created) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Card className="max-w-lg w-full">
          <CardContent className="p-8 text-center space-y-4">
            <div className="size-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <CheckCircle2 className="size-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">Заявка создана!</h2>
            <p className="text-slate-500">Клиент <strong>{created.client.name}</strong> добавлен в систему.</p>
            <div className="bg-slate-50 rounded-xl p-4 text-left space-y-1 text-sm">
              <p>👤 <strong>{created.client.name}</strong></p>
              <p>📞 {created.client.phone || "—"}</p>
              {created.client.email && <p>📧 {created.client.email}</p>}
              <p className="text-xs text-slate-400 mt-2">ID: {created.lead.id}</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setCreated(null); setParsed(null); setConversation(""); }}>
                Новая переписка
              </Button>
              <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={() => window.location.href = "/install-orders"}>
                <ClipboardCheck className="size-4 mr-1" />Создать ордер
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardPaste className="size-6 text-violet-600" />
            <div>
              <CardTitle>Вставить переписку с клиентом</CardTitle>
              <CardDescription>AI автоматически извлечёт данные клиента, параметры и порекомендует оборудование</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col p-4 min-h-0 gap-3">
          <textarea
            value={conversation}
            onChange={e => setConversation(e.target.value)}
            placeholder={`Вставьте переписку...\n\nПример:\n— Добрый день! Нас интересуют кондиционеры.\n— Квартира, 45 кв.м. Бюджет до 35000.\n— Меня зовут Александр, +380991234567`}
            className="flex-1 min-h-[200px] w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400 font-mono"
          />
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              <AlertCircle className="size-4 flex-shrink-0" />{error}
            </div>
          )}
          <Button onClick={handleParse} disabled={parsing || !conversation.trim()} className="bg-violet-600 hover:bg-violet-700 text-white py-6 text-sm font-bold">
            {parsing ? <><Loader2 className="size-4 animate-spin mr-2" />AI анализирует...</> : <><Sparkles className="size-4 mr-2" />Анализировать переписку</>}
          </Button>
        </CardContent>
      </Card>

      <div className="w-96 flex-shrink-0 flex flex-col min-h-0 gap-3 hidden lg:flex">
        {parsed ? (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Zap className="size-4 text-violet-600" />
                  <p className="text-sm font-bold text-slate-800">AI Анализ переписки</p>
                </div>
                <p className="text-sm text-slate-600">{parsed.summary}</p>
                {parsed.acRecommendation && (
                  <div className="bg-blue-50 rounded-xl p-3 text-xs">
                    <div className="flex items-center gap-1.5 mb-1">
                      <ThermometerSnowflake className="size-3.5 text-blue-500" />
                      <span className="font-bold text-slate-700">Рекомендация AI</span>
                    </div>
                    <p className="text-slate-500">Мин. {parsed.acRecommendation.minBtu} BTU · {parsed.acRecommendation.reason}</p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="flex-1 overflow-auto">
              <CardHeader className="border-b py-3">
                <CardTitle className="text-sm">Данные клиента</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <Field label="Имя" value={editName} onChange={setEditName} />
                <Field label="Телефон" value={editPhone} onChange={setEditPhone} />
                <Field label="Email" value={editEmail} onChange={setEditEmail} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Площадь, м²" value={editArea} onChange={setEditArea} type="number" />
                  <Field label="Бюджет, ₴" value={editBudget} onChange={setEditBudget} type="number" />
                </div>
                {parsed.requirements?.preferences?.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Пожелания</p>
                    <div className="flex flex-wrap gap-1">
                      {parsed.requirements.preferences.map((p: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">{p}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <Field label="Дополнительно" value={editNotes} onChange={setEditNotes} multiline />
                <Button onClick={handleCreateLead} disabled={creating} className="w-full bg-green-600 hover:bg-green-700 text-white py-5 font-bold">
                  {creating ? <><Loader2 className="size-4 animate-spin mr-2" />Создание...</> : <><CheckCircle2 className="size-4 mr-2" />Создать заявку</>}
                </Button>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="flex-1 flex items-center justify-center">
            <CardContent className="text-center space-y-3 py-12">
              <ClipboardPaste className="size-10 text-slate-200 mx-auto" />
              <p className="text-sm font-medium text-slate-500">Вставьте переписку слева</p>
              <p className="text-xs text-slate-400 max-w-[180px] mx-auto">AI извлечёт данные клиента и порекомендует оборудование</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", multiline = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; multiline?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-slate-500 font-medium block mb-1">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
      )}
    </div>
  );
}
