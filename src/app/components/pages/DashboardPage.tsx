import { useState, useEffect, useCallback } from "react";
import { projectId, publicAnonKey } from "../../../../utils/supabase/info";
import { useNavigate } from "react-router";
import {
  TrendingUp, Users, ClipboardList, Package, DollarSign,
  Wrench, RefreshCw, ArrowRight, Clock
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const HEADERS = { Authorization: `Bearer ${publicAnonKey}` };

type LeadStatus = "new" | "measurement" | "offer" | "deal" | "done";

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "Новые", measurement: "Замер", offer: "КП", deal: "Сделка", done: "Выполнено"
};
const STATUS_COLORS: Record<LeadStatus, string> = {
  new: "#3b82f6", measurement: "#f59e0b", offer: "#8b5cf6", deal: "#22c55e", done: "#64748b"
};

export function DashboardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [leadsRes] = await Promise.all([
        fetch(`${API}/leads`, { headers: HEADERS }),
      ]);
      const leadsData = await leadsRes.json();
      if (leadsData.leads) setLeads(leadsData.leads);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Computed stats
  const statusCounts = leads.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pieData = (["new", "measurement", "offer", "deal", "done"] as LeadStatus[]).map(s => ({
    name: STATUS_LABELS[s],
    value: statusCounts[s] || 0,
    color: STATUS_COLORS[s],
  })).filter(d => d.value > 0);

  const recentLeads = leads.slice(0, 5);

  // Monthly chart
  const monthlyData: Record<string, number> = {};
  leads.forEach(l => {
    const m = new Date(l.createdAt).toLocaleDateString("ru-RU", { month: "short", year: "2-digit" });
    monthlyData[m] = (monthlyData[m] || 0) + 1;
  });
  const barData = Object.entries(monthlyData).map(([name, count]) => ({ name, count })).slice(-6);

  const totalRevenue = leads
    .filter(l => l.status === "done" || l.status === "deal")
    .reduce((sum, l) => sum + (l.requirements_json?.budget || 0), 0);

  const statCards = [
    { label: "Всего заявок", value: leads.length, icon: <ClipboardList size={22} />, color: "from-blue-500 to-blue-600", onClick: () => navigate("/orders") },
    { label: "Новые", value: statusCounts["new"] || 0, icon: <Clock size={22} />, color: "from-amber-500 to-orange-500", onClick: () => navigate("/orders") },
    { label: "В работе", value: (statusCounts["measurement"] || 0) + (statusCounts["offer"] || 0) + (statusCounts["deal"] || 0), icon: <Wrench size={22} />, color: "from-purple-500 to-indigo-600", onClick: () => navigate("/orders") },
    { label: "Выполнено", value: statusCounts["done"] || 0, icon: <TrendingUp size={22} />, color: "from-emerald-500 to-green-600", onClick: () => navigate("/orders") },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Панель управления</h2>
          <p className="text-sm text-slate-500 mt-0.5">Обзор ключевых показателей системы</p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-blue-600 bg-white border border-slate-200 rounded-xl px-4 py-2 transition-all hover:shadow-sm"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Обновить
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, i) => (
          <button
            key={i}
            onClick={card.onClick}
            className="bg-white rounded-2xl p-5 border border-slate-100 hover:shadow-lg transition-all text-left group"
          >
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center text-white mb-3`}>
              {card.icon}
            </div>
            <p className="text-2xl font-bold text-slate-800">{card.value}</p>
            <p className="text-sm text-slate-500 mt-0.5">{card.label}</p>
          </button>
        ))}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Bar chart */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h3 className="text-base font-bold text-slate-800 mb-4">Заявки по месяцам</h3>
          {barData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Заявки" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-400 text-sm">Нет данных</div>
          )}
        </div>

        {/* Pie chart */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h3 className="text-base font-bold text-slate-800 mb-4">Статусы воронки</h3>
          {pieData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="60%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {pieData.map((entry) => (
                      <Cell key={`cell-${entry.name}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {pieData.map((d) => (
                  <div key={`legend-${d.name}`} className="flex items-center gap-2 text-sm">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-slate-600">{d.name}</span>
                    <span className="font-bold text-slate-800">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-400 text-sm">Нет данных</div>
          )}
        </div>
      </div>

      {/* Recent leads */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-800">Последние заявки</h3>
          <button onClick={() => navigate("/leads")} className="text-sm text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
            Все заявки <ArrowRight size={14} />
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {recentLeads.length === 0 ? (
            <p className="py-8 text-center text-slate-400 text-sm">Заявок пока нет</p>
          ) : (
            recentLeads.map(lead => {
              const st = lead.status as LeadStatus;
              return (
                <div key={lead.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {lead.requirements_json?.roomType || "Заявка"} — {lead.requirements_json?.area || "?"} м²
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(lead.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <span
                    className="text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                    style={{ backgroundColor: STATUS_COLORS[st] + "20", color: STATUS_COLORS[st] }}
                  >
                    {STATUS_LABELS[st]}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}