import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import {
  Send, Bot, User, CheckCircle2, Loader2, Sparkles,
  ClipboardPaste, MessageCircle, AlertCircle,
  Zap, ClipboardCheck, Package,
  ListChecks, Plus, Trash2, ChevronRight, ArrowUpRight,
  MessageSquare, Clock, UserCheck, Warehouse, FileText,
  XCircle, CheckSquare
} from "lucide-react";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { useCurrency } from "./CurrencyContext";
import { getJson } from "../lib/apiClient";

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ActionItem {
  type: "ac_selected" | "consumables_checked" | "order_created" | "lead_created" | "installer_assigned";
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
  actionsCount: number;
  completed: boolean;
  messageCount: number;
}
interface Installer {
  id: string;
  name: string;
  phone: string;
  level: string;
  status: "available" | "busy";
  certYear: number;
}

// ─── Workflow steps config ─────────────────────────────────────────────────────
const WORKFLOW_STEPS = [
  { key: "ac_selected",         icon: <Warehouse className="size-3.5" />,      label: "Подбор со склада",  color: "blue" },
  { key: "consumables_checked", icon: <Package className="size-3.5" />,         label: "Комплектующие",     color: "amber" },
  { key: "order_created",       icon: <ClipboardCheck className="size-3.5" />,  label: "Ордер монтажа",    color: "teal" },
  { key: "installer_assigned",  icon: <UserCheck className="size-3.5" />,       label: "Монтажник",         color: "violet" },
];

const STEP_COLORS: Record<string, string> = {
  blue:   "bg-blue-100 text-blue-700 border-blue-300 ring-blue-100",
  amber:  "bg-amber-100 text-amber-700 border-amber-300 ring-amber-100",
  teal:   "bg-teal-100 text-teal-700 border-teal-300 ring-teal-100",
  violet: "bg-violet-100 text-violet-700 border-violet-300 ring-violet-100",
};

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
  return `${Math.floor(h / 24)} д назад`;
}

const TIER_CFG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  economy:  { label: "Эконом",    bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  standard: { label: "Стандарт",  bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200" },
  premium:  { label: "Премиум",   bg: "bg-violet-50",  text: "text-violet-700",  border: "border-violet-200" },
};

// ─── Action Cards ──────────────────────────────────────────────────────────────
function AcWarehouseCard({ data }: { data: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const { fmtShort } = useCurrency();
  const models = Array.isArray(data) ? data : [];
  if (!models.length) return null;
  const first = models[0];
  const cfg = TIER_CFG[first.acSpecs?.tier || first.tier] || TIER_CFG.standard;
  const normalize = (m: any) => ({
    id: m.id,
    name: m.name,
    btu: m.acSpecs?.btu ?? m.btu,
    kw: m.acSpecs?.kw ?? m.kw,
    areaMin: m.acSpecs?.areaMin ?? m.areaMin,
    areaMax: m.acSpecs?.areaMax ?? m.areaMax,
    tier: m.acSpecs?.tier ?? m.tier,
    price: m.price,
    stock: m.stock,
    features: m.acSpecs?.features ?? m.features ?? [],
    warranty: m.acSpecs?.warranty ?? m.warranty,
    equipmentType: m.acSpecs?.equipmentType ?? "split_ac",
  });
  const items = models.map(normalize);
  const show = expanded ? items : items.slice(0, 1);
  const typeLabel: Record<string, string> = { split_ac: "Сплит-система", fan_coil: "Фанкойл", chiller: "Чиллер", vrv: "VRV" };
  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-3 mt-1`}>
      <div className="flex items-center gap-2 mb-2">
        <Warehouse className={`size-4 ${cfg.text}`} />
        <span className="text-xs font-bold text-slate-700">Из реального склада ({items.length} поз.)</span>
        <span className="ml-auto text-[9px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded-full border border-green-200">✓ В наличии</span>
      </div>
      {show.map((m, i) => (
        <div key={m.id} className={`rounded-lg p-2.5 bg-white border mb-1.5 ${i === 0 ? "border-blue-300 shadow-sm" : "border-slate-200"}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap gap-1 mb-1">
                {i === 0 && <span className="text-[9px] bg-amber-400 text-white font-bold px-1.5 py-0.5 rounded-full">✓ Лучший выбор</span>}
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cfg.text} ${cfg.bg}`}>{TIER_CFG[m.tier]?.label}</span>
                <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{typeLabel[m.equipmentType] || m.equipmentType}</span>
              </div>
              <p className="text-xs font-bold text-slate-800 leading-snug">{m.name}</p>
              {m.btu && <p className="text-[10px] text-slate-500">{m.btu} BTU · {m.kw} кВт · {m.areaMin}–{m.areaMax} м² · гар. {m.warranty} л.</p>}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-black text-slate-800">{m.price > 0 ? fmtShort(m.price) : "—"}</p>
              <p className="text-[10px] text-green-600 font-bold">остаток: {m.stock} шт</p>
            </div>
          </div>
          {m.features?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {m.features.slice(0, 3).map((f: string) => (
                <span key={f} className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{f}</span>
              ))}
            </div>
          )}
        </div>
      ))}
      {items.length > 1 && (
        <button onClick={() => setExpanded(v => !v)} className={`text-xs ${cfg.text} font-semibold flex items-center gap-1`}>
          {expanded ? "Скрыть" : `Ещё ${items.length - 1} вариант(а)`}
          <ChevronRight className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
      )}
    </div>
  );
}

function ConsumablesCard({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const { fmtShort } = useCurrency();
  const { items = [], allInStock, traceLength, acName } = data;
  const shortage = items.filter((i: any) => !i.inStock);
  const totalCost = items.reduce((s: number, i: any) => s + (i.price * i.qty), 0);
  return (
    <div className={`rounded-xl border p-3 mt-1 ${allInStock ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Package className={`size-4 ${allInStock ? "text-green-600" : "text-amber-600"}`} />
          <span className="text-xs font-bold text-slate-700 truncate max-w-[160px]">{acName || "Комплектующие"} · {traceLength}м</span>
        </div>
        {allInStock
          ? <span className="text-[10px] bg-green-100 text-green-700 border border-green-300 font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">✅ Всё есть</span>
          : <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-300 font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">⚠️ Не хватает {shortage.length}</span>
        }
      </div>
      <div className="space-y-1">
        {(expanded ? items : items.slice(0, 5)).map((item: any) => (
          <div key={item.id} className="flex items-center justify-between text-[11px]">
            <span className={`flex-1 truncate mr-2 ${!item.inStock ? "text-red-700 font-semibold" : "text-slate-600"}`}>
              {!item.inStock ? "⚠️ " : "✓ "}{item.name}
            </span>
            <span className="text-slate-500 flex-shrink-0 text-right">
              {item.qty} {item.unit}
              <span className={`ml-1 ${!item.inStock ? "text-red-500" : "text-green-600"}`}>(ест: {item.stock})</span>
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
        <span className="text-xs font-bold text-slate-700">~{fmtShort(totalCost)}</span>
      </div>
    </div>
  );
}

function OrderCreatedCard({ data, onNavigate, onGeneratePdf, onAssignInstaller }: {
  data: any; onNavigate: (p: string) => void;
  onGeneratePdf: (orderId: string) => void;
  onAssignInstaller: (orderId: string) => void;
}) {
  const { order } = data;
  return (
    <div className="rounded-xl border-2 border-teal-300 bg-teal-50 p-3 mt-1">
      <div className="flex items-center gap-2 mb-2">
        <div className="size-6 rounded-full bg-teal-500 flex items-center justify-center">
          <CheckCircle2 className="size-4 text-white" />
        </div>
        <span className="text-sm font-bold text-teal-800">Ордер монтажа создан!</span>
      </div>
      <div className="bg-white rounded-lg p-2.5 border border-teal-200 space-y-1 text-xs mb-2">
        <div className="flex justify-between"><span className="text-slate-500">Ордер</span><span className="font-bold">{order?.number || (order?.id || "").slice(-8)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Клиент</span><span className="font-bold">{order?.client_name}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Телефон</span><span>{order?.client_phone}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Оборудование</span><span className="font-bold text-right max-w-[160px] truncate">{order?.offer?.lines?.find((l:any)=>l.line_type==="equipment")?.name || "—"}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Площадь / Трасса</span><span>{order?.room_area_m2 || "—"} м² · {order?.trace_length_m || 4}м</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Статус</span><span className="text-amber-600 font-bold">{order?.status || "new"}</span></div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <button onClick={() => onNavigate(`/orders?open=${order?.id || ""}`)}
          className="flex flex-col items-center justify-center gap-1 bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg text-[10px] font-bold transition-colors">
          <ArrowUpRight className="size-3" />Открыть
        </button>
        <button onClick={() => onGeneratePdf(order?.id)}
          className="flex flex-col items-center justify-center gap-1 bg-slate-700 hover:bg-slate-800 text-white py-2 rounded-lg text-[10px] font-bold transition-colors">
          <FileText className="size-3" />Документ
        </button>
        <button onClick={() => onAssignInstaller(order?.id)}
          className="flex flex-col items-center justify-center gap-1 bg-violet-600 hover:bg-violet-700 text-white py-2 rounded-lg text-[10px] font-bold transition-colors">
          <UserCheck className="size-3" />Монтажник
        </button>
      </div>
    </div>
  );
}

function InstallerAssignedCard({ data }: { data: any }) {
  const { installer } = data;
  const levelLabel: Record<string, string> = {
    trainee: "Стажёр", installer: "Монтажник", specialist: "Специалист",
    master: "Мастер", senior_master: "Ст. мастер"
  };
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 mt-1">
      <div className="flex items-center gap-2 mb-2">
        <UserCheck className="size-4 text-violet-600" />
        <span className="text-xs font-bold text-violet-800">Монтажник назначен!</span>
      </div>
      <div className="bg-white rounded-lg p-2.5 border border-violet-200 space-y-1 text-xs">
        <div className="flex justify-between"><span className="text-slate-500">Монтажник</span><span className="font-bold">{installer?.name}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Уровень</span><span>{levelLabel[installer?.level] || installer?.level}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Телефон</span><span>{installer?.phone}</span></div>
        {data.scheduledDate && <div className="flex justify-between"><span className="text-slate-500">Дата</span><span className="font-bold text-teal-600">{data.scheduledDate}</span></div>}
      </div>
    </div>
  );
}

function LeadCreatedCard({ data }: { data: any }) {
  const { client } = data;
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 mt-1">
      <div className="flex items-center gap-2 mb-1.5">
        <CheckCircle2 className="size-4 text-blue-600" />
        <span className="text-xs font-bold text-blue-800">Заявка создана в CRM</span>
      </div>
      <p className="text-xs font-bold text-slate-800">{client?.name}</p>
      <p className="text-xs text-slate-500">{client?.phone}</p>
    </div>
  );
}

function ActionCard({ action, onNavigate, onGeneratePdf, onAssignInstaller }: {
  action: ActionItem;
  onNavigate: (p: string) => void;
  onGeneratePdf: (id: string) => void;
  onAssignInstaller: (id: string) => void;
}) {
  if (action.type === "ac_selected") return <AcWarehouseCard data={action.data} />;
  if (action.type === "consumables_checked") return <ConsumablesCard data={action.data} />;
  if (action.type === "order_created") return <OrderCreatedCard data={action.data} onNavigate={onNavigate} onGeneratePdf={onGeneratePdf} onAssignInstaller={onAssignInstaller} />;
  if (action.type === "installer_assigned") return <InstallerAssignedCard data={action.data} />;
  if (action.type === "lead_created") return <LeadCreatedCard data={action.data} />;
  return null;
}

// ─── Installer Assignment Modal ─────────────────────────────────────────────────
function InstallerModal({ orderId, onClose, onDone }: { orderId: string; onClose: () => void; onDone: () => void }) {
  const [installers, setInstallers] = useState<Installer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getJson<any>(`${API_BASE}/installers`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true }).then(d => {
      setInstallers(d.installers || []);
      const avail = (d.installers || []).find((i: Installer) => i.status === "available");
      if (avail) setSelected(avail.id);
    }).finally(() => setLoading(false));
  }, []);

  const assign = async () => {
    const inst = installers.find(i => i.id === selected);
    if (!inst) return;
    setSaving(true);
    try {
      const execution = { status: "scheduled", scheduled_at: date || "", assigned_installer_id: inst.id, assigned_installer_name: inst.name };
      await fetch(`${API_BASE}/orders/${orderId}`, {
        method: "PATCH",
        headers: JH,
        body: JSON.stringify({ execution, status: "scheduled" }),
      });
      onDone();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const levelLabel: Record<string, string> = {
    trainee: "Стажёр", installer: "Монтажник", specialist: "Специалист",
    master: "Мастер", senior_master: "Ст. мастер"
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <UserCheck className="size-4 text-violet-600" />Назначить монтажника
            </CardTitle>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <XCircle className="size-5" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-slate-400" /></div>
          ) : (
            <>
              <div>
                <label className="text-xs text-slate-500 font-medium block mb-1.5">Монтажник</label>
                <div className="space-y-1.5 max-h-52 overflow-auto">
                  {installers.map(inst => (
                    <button key={inst.id} onClick={() => inst.status === "available" && setSelected(inst.id)}
                      className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl border transition-all text-left ${
                        selected === inst.id ? "border-violet-400 bg-violet-50" :
                        inst.status === "busy" ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed" :
                        "border-slate-200 hover:border-violet-300 hover:bg-violet-50/50"
                      }`}>
                      <div className={`size-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                        inst.status === "available" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                      }`}>
                        {inst.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{inst.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {levelLabel[inst.level] || inst.level} · {inst.status === "available" ? "Доступен" : "Занят"}
                        </p>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-1.5">
                        <span className="text-[9px] text-slate-400">Серт. {inst.certYear}</span>
                        {selected === inst.id && <CheckSquare className="size-4 text-violet-600" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 font-medium block mb-1.5">Дата монтажа (необязательно)</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
              </div>
              <Button onClick={assign} disabled={!selected || saving} className="w-full bg-violet-600 hover:bg-violet-700 py-5">
                {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : <UserCheck className="size-4 mr-2" />}
                Назначить монтажника
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Workflow Progress Panel ────────────────────────────────────────────────────
function WorkflowPanel({ actions, onNavigate, onGeneratePdf, onAssignInstaller }: {
  actions: ActionItem[];
  onNavigate: (p: string) => void;
  onGeneratePdf: (id: string) => void;
  onAssignInstaller: (id: string) => void;
}) {
  const completedTypes = new Set(actions.map(a => a.type));
  const orderAction = [...actions].reverse().find(a => a.type === "order_created");

  return (
    <Card className="w-72 flex-shrink-0 flex flex-col min-h-0 hidden xl:flex">
      <CardHeader className="border-b flex-shrink-0 py-3">
        <CardTitle className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <ListChecks className="size-3.5 text-blue-600" />Прогресс работы
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-3">
        {/* Workflow steps */}
        <div className="space-y-1.5 mb-3">
          {WORKFLOW_STEPS.map((step, i) => {
            const done = completedTypes.has(step.key as any);
            const cc = STEP_COLORS[step.color];
            return (
              <div key={step.key} className={`flex items-center gap-2.5 rounded-xl p-2 border transition-all ${done ? `${cc} ring-1` : "bg-slate-50 border-slate-200 opacity-50"}`}>
                <div className={`size-6 rounded-lg flex items-center justify-center flex-shrink-0 ${done ? "" : "bg-slate-200"}`}>
                  {done ? step.icon : <span className="text-[10px] font-bold text-slate-400">{i + 1}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold leading-tight truncate">{step.label}</p>
                </div>
                {done ? <CheckCircle2 className="size-3.5 text-green-500 flex-shrink-0" /> : <div className="size-3.5 rounded-full border-2 border-slate-300 flex-shrink-0" />}
              </div>
            );
          })}
        </div>

        {/* Actions from AI */}
        {actions.length === 0 ? (
          <div className="text-center py-4">
            <Zap className="size-8 text-slate-200 mx-auto mb-2" />
            <p className="text-[11px] text-slate-400 leading-relaxed max-w-[180px] mx-auto">
              AI выполнит шаги автоматически. Сообщите площадь и пожелания клиента.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {actions.slice(-4).map((action, i) => {
              const step = WORKFLOW_STEPS.find(s => s.key === action.type);
              const cc = step ? STEP_COLORS[step.color] : "bg-slate-100 text-slate-600 border-slate-200";
              return (
                <div key={i} className={`flex items-center gap-2 rounded-xl p-2 border ${cc}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold leading-tight truncate">{action.title}</p>
                  </div>
                  <CheckCircle2 className="size-3 text-green-500 flex-shrink-0" />
                </div>
              );
            })}
          </div>
        )}

        {/* Quick actions */}
        {orderAction && (
          <div className="mt-3 pt-3 border-t space-y-1.5">
            <button onClick={() => onNavigate(`/orders?open=${orderAction.data?.order?.id || ""}`)}
              className="w-full flex items-center justify-center gap-2 bg-teal-600 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-teal-700 transition-colors">
              <ClipboardCheck className="size-3.5" />Перейти к ордеру
            </button>
            <button onClick={() => onGeneratePdf(orderAction.data?.order?.id)}
              className="w-full flex items-center justify-center gap-2 bg-slate-700 text-white py-2 rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors">
              <FileText className="size-3.5" />Сформировать документ
            </button>
            <button onClick={() => onAssignInstaller(orderAction.data?.order?.id)}
              className="w-full flex items-center justify-center gap-2 bg-violet-100 text-violet-700 py-2 rounded-xl text-xs font-semibold hover:bg-violet-200 transition-colors border border-violet-200">
              <UserCheck className="size-3.5" />Назначить монтажника
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main export ──────��────────────────────────────────────────────────────────
type ChatMode = "dialog" | "paste";

export function SalesManagerChat() {
  const { fmtShort, currency } = useCurrency();
  const [mode, setMode] = useState<ChatMode>("dialog");
  return (
    <div className="w-full max-w-[1400px] mx-auto flex flex-col gap-3 h-full">
      <div className="flex gap-2 bg-white rounded-xl border border-slate-200 p-1.5 shadow-sm flex-shrink-0">
        <button onClick={() => setMode("dialog")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${mode === "dialog" ? "bg-blue-600 text-white shadow" : "text-slate-500 hover:bg-slate-50"}`}>
          <MessageCircle size={15} />AI Диалог
        </button>
        <button onClick={() => setMode("paste")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${mode === "paste" ? "bg-violet-600 text-white shadow" : "text-slate-500 hover:bg-slate-50"}`}>
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

  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // hasActiveChat = false → экран приветствия, true → открытый чат
  const [hasActiveChat, setHasActiveChat] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [allActions, setAllActions] = useState<ActionItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [installerModalOrderId, setInstallerModalOrderId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; };
  useEffect(scrollToBottom, [messages]);

  function genSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await getJson<any>(`${API_BASE}/chat-sessions`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true });
      setSessions(data.sessions || []);
    } catch (e) { console.error(e); }
    finally { setSessionsLoading(false); }
  }, []);

  useEffect(() => { loadSessions(); }, []);

  async function sendGreeting(sid: string) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST", headers: JH,
        body: JSON.stringify({
          sessionId: sid,
          message: "Привет! Кратко расскажи что умеешь и как подбираешь кондиционеры со склада.",
          history: []
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const content = cleanMessage(data.message || "");
        if (content) setMessages([{ role: "assistant", content, actions: [] }]);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function startNewSession() {
    const sid = genSessionId();
    setSessionId(sid);
    setMessages([]);
    setAllActions([]);
    setInput("");
    setHasActiveChat(true);
    sendGreeting(sid);
  }

  async function openSession(sid: string) {
    if (sid === sessionId && hasActiveChat) return;
    setLoading(true);
    setMessages([]);
    setAllActions([]);
    setInput("");
    setHasActiveChat(true);
    try {
      const data = await getJson<any>(`${API_BASE}/chat-session/${sid}`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true });
      const hist: Message[] = (data.history || [])
        .filter((m: any) => m.role === "user" || m.role === "assistant")
        .map((m: any) => ({ role: m.role, content: m.content, actions: [] }));
      setMessages(hist);
      setAllActions(data.actions || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setSessionId(sid); }
  }

  async function deleteSession(sid: string, e: React.MouseEvent) {
    e.stopPropagation();
    setDeletingId(sid);
    try {
      await fetch(`${API_BASE}/chat-session/${sid}`, { method: "DELETE", headers: AH });
      setSessions(prev => prev.filter(s => s.id !== sid));
      if (sid === sessionId) {
        setHasActiveChat(false);
        setSessionId("");
        setMessages([]);
        setAllActions([]);
      }
    } catch (e) { console.error(e); }
    finally { setDeletingId(null); }
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim(); setInput(""); setLoading(true);
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
        setMessages([...updated, { role: "assistant", content, actions: acts }]);
        if (acts.length) {
          const newAllActions = [...allActions, ...acts];
          setAllActions(newAllActions);
          await fetch(`${API_BASE}/chat-session-actions/${sessionId}`, {
            method: "POST", headers: JH, body: JSON.stringify({ actions: newAllActions }),
          });
        }
        loadSessions();
      } else {
        setMessages([...updated, { role: "assistant", content: "Ошибка. Попробуйте ещё раз.", actions: [] }]);
      }
    } catch (e) {
      console.error(e);
      setMessages([...updated, { role: "assistant", content: "Ошибка соединения.", actions: [] }]);
    } finally { setLoading(false); }
  }

  const handleGeneratePdf = async (orderId: string) => {
    if (!orderId) return;
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/act/pdf`, { headers: AH });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `act_${orderId.slice(-8)}.pdf`; a.click();
        URL.revokeObjectURL(url);
      } else { navigate("/orders"); }
    } catch { navigate("/orders"); }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const quickPrompts = [
    { label: "Квартира 45 м², эконом-сегмент",  value: "Клиент: Елена, +375291234567. Квартира 45 м², бюджет 1200 Br" },
    { label: "Офис 70 м², средний сегмент",      value: "Офис 70 м², нужен кондиционер среднего сегмента" },
    { label: "Фанкойл для комнаты 35 м²",        value: "Подбери фанкойл для комнаты 35 м² (есть чиллер)" },
  ];

  return (
    <div className="flex gap-3 flex-1 min-h-0">
      {installerModalOrderId && (
        <InstallerModal
          orderId={installerModalOrderId}
          onClose={() => setInstallerModalOrderId(null)}
          onDone={() => { setInstallerModalOrderId(null); loadSessions(); }}
        />
      )}

      {/* Sessions Sidebar */}
      <Card className="w-60 flex-shrink-0 flex flex-col min-h-0 hidden lg:flex">
        <CardHeader className="border-b flex-shrink-0 py-3 px-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <MessageSquare className="size-3.5 text-blue-500" />Диалоги
            </CardTitle>
            <button onClick={startNewSession}
              className="size-7 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-colors"
              title="Новый диалог">
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
              <button key={sess.id} onClick={() => openSession(sess.id)}
                className={`w-full text-left rounded-xl p-2.5 transition-all group relative ${
                  sess.id === sessionId && hasActiveChat
                    ? "bg-blue-50 border border-blue-200"
                    : "hover:bg-slate-50 border border-transparent"
                }`}>
                <div className="flex items-start justify-between gap-1 mb-1">
                  <p className={`text-[11px] font-bold leading-tight line-clamp-2 flex-1 ${
                    sess.id === sessionId && hasActiveChat ? "text-blue-800" : "text-slate-700"
                  }`}>
                    {sess.title}
                  </p>
                  <button onClick={(e) => deleteSession(sess.id, e)}
                    className="opacity-0 group-hover:opacity-100 size-5 rounded-md hover:bg-red-100 flex items-center justify-center flex-shrink-0 transition-all">
                    {deletingId === sess.id
                      ? <Loader2 className="size-3 animate-spin text-red-400" />
                      : <Trash2 className="size-3 text-red-400" />}
                  </button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <div className="flex items-center gap-0.5 text-[9px] text-slate-400">
                    <Clock className="size-2.5" />{timeAgo(sess.updatedAt)}
                  </div>
                  {sess.actionsCount > 0 && (
                    <span className="text-[9px] bg-blue-100 text-blue-600 font-bold px-1 py-0.5 rounded-full">{sess.actionsCount} действий</span>
                  )}
                  {sess.completed && <span className="text-[9px] bg-teal-100 text-teal-600 font-bold px-1 py-0.5 rounded-full">✓</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Chat area */}
      <Card className="flex-1 flex flex-col min-h-0">
        {!hasActiveChat ? (
          /* ── Экран приветствия ── */
          <CardContent className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-6">
            <div className="size-20 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg">
              <Bot className="size-10 text-white" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-slate-800">AI Sales Manager</h2>
              <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
                Подбирает кондиционеры со склада, комплектует расходники, создаёт ордер монтажа и назначает монтажника
              </p>
            </div>

            <button
              onClick={startNewSession}
              className="flex items-center gap-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white px-8 py-3.5 rounded-2xl text-sm font-bold shadow-md transition-all">
              <Plus className="size-5" />Новый диалог
            </button>

            {sessions.length > 0 && (
              <div className="w-full max-w-sm space-y-1.5">
                <p className="text-[11px] text-slate-400 font-medium mb-2">— или откройте существующий диалог —</p>
                {sessions.slice(0, 4).map(sess => (
                  <button key={sess.id} onClick={() => openSession(sess.id)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all text-left group">
                    <MessageSquare className="size-4 text-slate-300 group-hover:text-blue-500 flex-shrink-0 transition-colors" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">{sess.title}</p>
                      <p className="text-[10px] text-slate-400">
                        {timeAgo(sess.updatedAt)}
                        {sess.actionsCount > 0 ? ` · ${sess.actionsCount} действий` : ""}
                      </p>
                    </div>
                    {sess.completed && (
                      <span className="text-[9px] bg-teal-100 text-teal-600 font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        ) : (
          /* ── Активный чат ── */
          <>
            <CardHeader className="border-b flex-shrink-0 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="size-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-sm">
                    <Bot className="size-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">AI Sales Manager</CardTitle>
                    <CardDescription className="text-xs">Подбор со склада · Комплектация · Ордер · Монтажник</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs text-slate-500 hidden sm:inline">Активен</span>
                  <button onClick={startNewSession}
                    className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 rounded-lg transition-colors">
                    <Plus className="size-3.5" />Новый
                  </button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex-1 flex flex-col p-0 min-h-0">
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && !loading && (
                  <div className="flex flex-col items-center justify-center h-full text-center py-8 gap-4">
                    <div className="size-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                      <Warehouse className="size-7 text-blue-400" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-700 mb-1">Подбираю только из наличного склада</p>
                      <p className="text-sm text-slate-500">Сообщите площадь и пожелания клиента</p>
                    </div>
                    <div className="flex flex-col gap-2 w-full max-w-sm">
                      {quickPrompts.map(q => (
                        <button key={q.value} onClick={() => setInput(q.value)}
                          className="text-xs bg-slate-50 hover:bg-blue-50 hover:text-blue-700 border border-slate-200 hover:border-blue-200 text-slate-600 px-3 py-2 rounded-xl transition-colors text-left">
                          {q.label}
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
                            <ActionCard key={i} action={action} onNavigate={navigate}
                              onGeneratePdf={handleGeneratePdf}
                              onAssignInstaller={setInstallerModalOrderId} />
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
                    placeholder="Клиент, площадь, пожелания… AI подберёт со склада и скомплектует ордер"
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
          </>
        )}
      </Card>

      {/* Workflow Panel — только когда чат открыт */}
      {hasActiveChat && (
        <WorkflowPanel
          actions={allActions}
          onNavigate={navigate}
          onGeneratePdf={handleGeneratePdf}
          onAssignInstaller={setInstallerModalOrderId}
        />
      )}
    </div>
  );
}

// ─── Paste Mode ───────────────────────────────────────────────────────────────
function PasteMode() {
  const { currency } = useCurrency();
  const [conversation, setConversation] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editArea, setEditArea] = useState("");
  const [editBudget, setEditBudget] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const syncFromParsed = (p: any) => {
    setEditName(p.client?.name || "");
    setEditPhone(p.client?.phone || "");
    setEditArea(p.requirements?.area?.toString() || "");
    setEditBudget(p.requirements?.budget?.toString() || "");
    setEditNotes(p.requirements?.additionalNotes || "");
  };

  const handleParse = async () => {
    if (conversation.trim().length < 10) { setError("Вставьте переписку (минимум 10 символов)"); return; }
    setParsing(true); setError(null); setParsed(null); setCreated(null);
    try {
      const res = await fetch(`${API_BASE}/parse-conversation`, {
        method: "POST", headers: JH, body: JSON.stringify({ conversation })
      });
      const data = await res.json();
      if (data.parsed) { setParsed(data.parsed); syncFromParsed(data.parsed); }
      else setError(data.error || "Не удалось разобрать переписку");
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
          clientData: { name: editName || "Клиент", phone: editPhone || "" },
          requirements: {
            area: editArea ? Number(editArea) : parsed.requirements?.area,
            roomType: parsed.requirements?.roomType,
            budget: editBudget ? Number(editBudget) : parsed.requirements?.budget,
            additionalNotes: editNotes || parsed.requirements?.additionalNotes
          },
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
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1"
                onClick={() => { setCreated(null); setParsed(null); setConversation(""); }}>
                Новая переписка
              </Button>
              <Button className="flex-1 bg-teal-600 hover:bg-teal-700"
                onClick={() => window.location.href = "/orders"}>
                <ClipboardCheck className="size-4 mr-1" />Ордера
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
              <CardDescription>AI автоматически извлечёт данные клиента и параметры</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col p-4 min-h-0 gap-3">
          <textarea
            value={conversation} onChange={e => setConversation(e.target.value)}
            placeholder={`Вставьте переписку...\n\nПример:\n— Добрый день! Интересуют кондиционеры.\n— Квартира, 45 кв.м. Бюджет до 35000.\n— Меня зовут Елена, +380991234567`}
            className="flex-1 min-h-[200px] w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400 font-mono"
          />
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              <AlertCircle className="size-4 flex-shrink-0" />{error}
            </div>
          )}
          <Button onClick={handleParse} disabled={parsing || !conversation.trim()}
            className="bg-violet-600 hover:bg-violet-700 text-white py-6 text-sm font-bold">
            {parsing
              ? <><Loader2 className="size-4 animate-spin mr-2" />AI анализирует...</>
              : <><Sparkles className="size-4 mr-2" />Анализировать переписку</>}
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
                  <p className="text-sm font-bold text-slate-800">Результат анализа</p>
                </div>
                <p className="text-sm text-slate-600">{parsed.summary}</p>
              </CardContent>
            </Card>
            <Card className="flex-1 overflow-auto">
              <CardHeader className="border-b py-3">
                <CardTitle className="text-sm">Данные клиента</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <Field label="Имя" value={editName} onChange={setEditName} />
                <Field label="Телефон" value={editPhone} onChange={setEditPhone} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Площадь, м²" value={editArea} onChange={setEditArea} type="number" />
                  <Field label={`Бюджет, ${currency.symbol}`} value={editBudget} onChange={setEditBudget} type="number" />
                </div>
                <Field label="Дополнительно" value={editNotes} onChange={setEditNotes} multiline />
                <Button onClick={handleCreateLead} disabled={creating}
                  className="w-full bg-green-600 hover:bg-green-700 text-white py-5 font-bold">
                  {creating
                    ? <><Loader2 className="size-4 animate-spin mr-2" />Создание...</>
                    : <><CheckCircle2 className="size-4 mr-2" />Создать заявку</>}
                </Button>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="flex-1 flex items-center justify-center">
            <CardContent className="text-center space-y-3 py-12">
              <ClipboardPaste className="size-10 text-slate-200 mx-auto" />
              <p className="text-sm font-medium text-slate-500">Вставьте переписку слева</p>
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