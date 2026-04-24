import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRole } from "../RoleContext";
import { API_BASE, AH, getJson } from "../../lib/apiClient";
import { Loader2, Save, User, Phone, Camera, CheckCircle2, LogOut } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useNavigate } from "react-router";

type LeadStatus = "new" | "measurement" | "offer" | "deal" | "done";
type Lead = { id: string; clientId: string; status: LeadStatus; createdAt: string; updatedAt: string };

const LS_AVATAR = "kapelan_user_avatar";
const LS_PHONE = "kapelan_user_phone";

function safeGet(key: string, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function ProfilePage() {
  const { userName, setUserName, role } = useRole();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [avatar, setAvatar] = useState(() => safeGet(LS_AVATAR, ""));
  const [name, setName] = useState(() => userName);
  const [phone, setPhone] = useState(() => safeGet(LS_PHONE, ""));

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [kpiLoading, setKpiLoading] = useState(false);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 2500);
  }, []);

  // keep local draft in sync if role switcher changes name externally
  useEffect(() => setName(userName), [userName]);

  const loadKpi = useCallback(async () => {
    setKpiLoading(true);
    try {
      const data = await getJson<{ leads?: Lead[] }>(`${API_BASE}/leads`, { ttlMs: 30_000 });
      setLeads(data.leads ?? []);
    } catch {
      // KPI is optional; stay silent
    } finally {
      setKpiLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKpi();
  }, [loadKpi]);

  const kpi = useMemo(() => {
    const total = leads.length;
    const by = (s: LeadStatus) => leads.filter((l) => l.status === s).length;
    const newCount = by("new");
    const inWork = by("measurement") + by("offer") + by("deal");
    const done = by("done");
    return { total, newCount, inWork, done };
  }, [leads]);

  const dirty = name.trim() !== userName || phone !== safeGet(LS_PHONE, "") || avatar !== safeGet(LS_AVATAR, "");

  async function onPickAvatar(file: File) {
    // store as dataURL for now (MVP)
    const reader = new FileReader();
    reader.onloadend = () => {
      const url = String(reader.result || "");
      setAvatar(url);
      showToast("Фото обновлено");
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const n = name.trim() || userName;
      setUserName(n);
      safeSet(LS_PHONE, phone.trim());
      safeSet(LS_AVATAR, avatar);
      showToast("Профиль сохранён");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    try {
      await supabase?.auth.signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-black text-slate-900">Профиль</p>
          <p className="text-xs text-slate-400 mt-0.5">Личные данные и KPI</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void signOut()}
            className="px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            <LogOut size={16} />
            Выйти
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
              dirty ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500 cursor-not-allowed"
            }`}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Сохранить
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: profile card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <button
                onClick={() => fileRef.current?.click()}
                className="w-16 h-16 rounded-2xl overflow-hidden bg-gradient-to-br from-blue-500 to-cyan-500 text-white flex items-center justify-center font-black text-xl"
                title="Изменить фото"
              >
                {avatar ? (
                  <img src={avatar} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  (userName.charAt(0) || "U").toUpperCase()
                )}
              </button>
              <div className="absolute -bottom-2 -right-2 bg-white border border-slate-200 rounded-xl p-1.5 text-slate-600 shadow-sm">
                <Camera size={14} />
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickAvatar(f);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-900 truncate">{userName}</p>
              <p className="text-xs text-slate-400 mt-0.5">Роль: {role}</p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <User size={12} /> ФИО
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 ring-blue-300"
                placeholder="Иванов Иван Иванович"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Phone size={12} /> Телефон
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 ring-blue-300"
                placeholder="+375 XX XXX-XX-XX"
              />
            </label>
          </div>
        </div>

        {/* Middle: KPI */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold text-slate-900">KPI / Задачи</p>
              <p className="text-xs text-slate-400 mt-0.5">Сводка по заявкам (leads)</p>
            </div>
            <button
              onClick={() => loadKpi()}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Обновить
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCell label="Всего" value={kpiLoading ? "…" : String(kpi.total)} tone="slate" />
            <KpiCell label="Новые" value={kpiLoading ? "…" : String(kpi.newCount)} tone="blue" />
            <KpiCell label="В работе" value={kpiLoading ? "…" : String(kpi.inWork)} tone="amber" />
            <KpiCell label="Выполнено" value={kpiLoading ? "…" : String(kpi.done)} tone="emerald" />
          </div>

          <div className="mt-4 text-xs text-slate-400">
            Сейчас KPI считается по статусам: <span className="font-semibold">new/measurement/offer/deal/done</span>.
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl shadow-xl text-white text-sm font-semibold whitespace-nowrap transition-all">
          <div className={`${toast.ok ? "bg-emerald-600" : "bg-red-600"} px-4 py-3 rounded-2xl flex items-center gap-2`}>
            <CheckCircle2 size={16} /> {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCell({ label, value, tone }: { label: string; value: string; tone: "slate" | "blue" | "amber" | "emerald" }) {
  const tones: Record<typeof tone, string> = {
    slate: "bg-slate-50 border-slate-200 text-slate-800",
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
  };
  return (
    <div className={`rounded-2xl border p-3 ${tones[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-xl font-black mt-1">{value}</p>
    </div>
  );
}

