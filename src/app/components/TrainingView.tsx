import React, { useState, useEffect, useCallback, useRef } from "react";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import { useRole } from "./RoleContext";
import { TrainingAdminPanel } from "./TrainingAdminPanel";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;

const AH  = { Authorization: `Bearer ${publicAnonKey}` };
const JH  = { ...AH, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
interface Question {
  id: string; text: string; type: "single" | "multiple";
  options: string[]; correctAnswers: number[];
  explanation?: string; category: string;
  difficulty: "easy" | "medium" | "hard"; points: number;
}
interface TestMeta {
  id: string; title: string; description: string;
  category: string; difficulty: string; questionsCount: number;
  passingScore: number; timeLimit: number;
  isAnnualCertification: boolean; certYear?: number;
  active: boolean; createdAt: string; authorName?: string;
}
interface TestFull extends TestMeta { questions: Question[]; }
interface QuestionResult {
  questionId: string; correct: boolean;
  selectedAnswers: number[]; correctAnswers: number[];
  pointsEarned: number; maxPoints: number;
}
interface TestResult {
  id: string; testId: string; testTitle: string; testCategory: string;
  isAnnualCertification: boolean; certYear?: number;
  installerName: string; percentage: number; score: number; maxScore: number;
  passed: boolean; level: string; completedAt: string; durationSeconds: number;
  questionResults?: QuestionResult[];
  answers?: Record<string, number[]>;
}
type InstallerLevel = "trainee" | "installer" | "specialist" | "master" | "senior_master";
interface InstallerStats {
  installerName: string; level: InstallerLevel; levelLabel: string; levelScore: number;
  totalTests: number; passedTests: number; passRate: number;
  annualCertification: { year: number; status: "passed"|"failed"|"pending"; percentage?: number; completedAt?: string };
  recentResults: { resultId: string; testTitle: string; percentage: number; passed: boolean; completedAt: string }[];
  categoryScores: Record<string, number>;
}
interface LeaderboardEntry { installerName: string; level: InstallerLevel; levelLabel: string; levelScore: number; totalTests: number; passRate: number; }
interface CertEntry { installerName: string; level: InstallerLevel; levelLabel: string; levelScore: number; certification: any; totalTests: number; }

type View = "home" | "test_intro" | "test_run" | "result" | "history" | "leaderboard" | "cert_matrix" | "admin";

// ─── Constants ────────────────────────────────────────────────────────────────
const LEVEL_CFG: Record<string, { label: string; color: string; bg: string; border: string; icon: string; min: number }> = {
  trainee:       { label: "Стажер",         color: "text-slate-600",   bg: "bg-slate-50",    border: "border-slate-200", icon: "🌱", min: 0  },
  installer:     { label: "Монтажник",       color: "text-blue-700",    bg: "bg-blue-50",     border: "border-blue-200",  icon: "🔧", min: 50 },
  specialist:    { label: "Специалист",    color: "text-emerald-700", bg: "bg-emerald-50",  border: "border-emerald-200",icon:"⚡", min: 70 },
  master:        { label: "Мастер",         color: "text-amber-700",   bg: "bg-amber-50",    border: "border-amber-200", icon: "🏅", min: 85 },
  senior_master: { label: "Старший мастер", color: "text-violet-700",  bg: "bg-violet-50",   border: "border-violet-200",icon:"👑", min: 95 },
};
const CAT_LABELS: Record<string, string> = {
  installation: "🔩 Монтаж", electrical: "⚡ Электрика", refrigerant: "❄️ Хладагенты",
  safety: "🦺 Безопасность", ventilation: "🌬️ Вентиляция", service: "🔧 ТО", general: "📚 Общий",
};
const DIFF_CFG: Record<string, { label: string; color: string }> = {
  beginner:     { label: "Начальный",   color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  intermediate: { label: "Средний",     color: "text-amber-600 bg-amber-50 border-amber-200" },
  advanced:     { label: "Продвинутый", color: "text-red-600 bg-red-50 border-red-200" },
};
const CERT_YEAR = new Date().getFullYear();

const fmtDate = (s: string) => new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtDur  = (s: number) => s < 60 ? `${s} сек` : `${Math.floor(s/60)} мин ${s%60} сек`;

// ─── PDF helpers ──────────────────────────────────────────────────────────────
function openPrintWindow(html: string) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) { alert("Разрешите открытие всплывающих окон в браузере"); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

function exportCertMatrixPDF(matrix: CertEntry[], year: number) {
  const passed  = matrix.filter((e: CertEntry) => e.certification.status === "passed").length;
  const pending = matrix.filter((e: CertEntry) => e.certification.status === "pending").length;
  const failed  = matrix.filter((e: CertEntry) => e.certification.status === "failed").length;

  const rows = matrix.map((e: CertEntry, i: number) => {
    const lvl = LEVEL_CFG[e.level] ?? LEVEL_CFG.trainee;
    const st  = e.certification.status;
    const statusStr = st === "passed" ? `✓ Пройдена (${e.certification.percentage}%)` :
                      st === "failed" ? `✗ Не пройдена (${e.certification.percentage}%)` : "⏳ Ожидает";
    const statusClass = st === "passed" ? "passed" : st === "failed" ? "failed" : "pending";
    const dateStr = e.certification.completedAt
      ? new Date(e.certification.completedAt).toLocaleDateString("ru-RU") : "—";
    return `<tr>
      <td>${i + 1}</td>
      <td><b>${e.installerName}</b></td>
      <td>${lvl.label}</td>
      <td>${e.levelScore}%</td>
      <td><span class="${statusClass}">${statusStr}</span></td>
      <td>${dateStr}</td>
      <td>${e.totalTests}</td>
    </tr>`;
  }).join("");

  const nowStr = new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" } as any);

  openPrintWindow(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
<title>Аттестация монтажников ${year}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;padding:32px;color:#1e293b;font-size:13px}
h1{font-size:22px;font-weight:800;margin-bottom:4px;color:#0f172a}
.org{font-size:11px;color:#94a3b8;margin-bottom:6px;letter-spacing:.05em;text-transform:uppercase}
.subtitle{color:#64748b;font-size:11px;margin-bottom:24px}
.stats{display:flex;gap:12px;margin-bottom:24px}
.stat{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}
.stat-val{font-size:26px;font-weight:800;display:block}
.stat-lbl{font-size:10px;color:#64748b}
.stat.green{border-color:#86efac;background:#f0fdf4}.stat.green .stat-val{color:#16a34a}
.stat.amber{border-color:#fcd34d;background:#fffbeb}.stat.amber .stat-val{color:#d97706}
.stat.red{border-color:#fca5a5;background:#fef2f2}.stat.red .stat-val{color:#dc2626}
table{width:100%;border-collapse:collapse}
thead th{background:#1e293b;color:white;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
tbody td{padding:9px 14px;border-bottom:1px solid #f1f5f9}
tbody tr:nth-child(even) td{background:#f8fafc}
.passed{color:#16a34a;font-weight:700}
.failed{color:#dc2626;font-weight:700}
.pending{color:#d97706;font-weight:700}
.sig-block{margin-top:40px;display:flex;gap:60px}
.sig{flex:1}
.sig-line{border-top:1px solid #475569;margin-top:48px;padding-top:4px;font-size:10px;color:#64748b}
.footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;color:#94a3b8;font-size:10px}
@media print{body{padding:16px}}
</style></head><body>
<p class="org">Система обучения и аттестации монтажников · CRM «Каплан»</p>
<h1>Аттестация монтажников ${year}</h1>
<p class="subtitle">Ежегодная проверка квалификации · Сформировано: ${nowStr}</p>
<div class="stats">
  <div class="stat green"><span class="stat-val">${passed}</span><span class="stat-lbl">Прошли аттестацию</span></div>
  <div class="stat amber"><span class="stat-val">${pending}</span><span class="stat-lbl">Ожидают прохождения</span></div>
  <div class="stat red"><span class="stat-val">${failed}</span><span class="stat-lbl">Не прошли</span></div>
</div>
<table>
  <thead><tr><th>#</th><th>Монтажник</th><th>Уровень</th><th>Средний балл</th><th>Статус аттестации</th><th>Дата</th><th>Тестов</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="sig-block">
  <div class="sig"><div class="sig-line">Руководитель / подпись</div></div>
  <div class="sig"><div class="sig-line">Ответственный за обучение / подпись</div></div>
</div>
<div class="footer">
  <span>CRM «Каплан» · Система обучения монтажников</span>
  <span>Сформировано: ${nowStr}</span>
</div>
</body></html>`);
}

function exportCertificatePDF(result: TestResult, installerName: string) {
  const lvl = LEVEL_CFG[result.level] ?? LEVEL_CFG.trainee;
  const dateStr = new Date(result.completedAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" } as any);
  const certYear = result.certYear ?? new Date().getFullYear();

  openPrintWindow(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
<title>Сертификат — ${installerName}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Georgia,serif;background:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:40px}
.cert{max-width:680px;width:100%;margin:0 auto;border:3px solid #1e293b;border-radius:16px;padding:48px 56px;text-align:center;position:relative}
.cert::before{content:'';position:absolute;inset:8px;border:1px solid #94a3b8;border-radius:10px;pointer-events:none}
.org{font-size:11px;text-transform:uppercase;letter-spacing:.15em;color:#64748b;margin-bottom:20px;font-family:Arial,sans-serif}
h1{font-size:30px;font-weight:800;font-family:Arial,sans-serif;margin-bottom:8px;color:#0f172a;letter-spacing:.05em}
.subtitle{font-size:13px;color:#475569;margin-bottom:36px;font-family:Arial,sans-serif}
.intro{font-size:13px;color:#64748b;margin-bottom:14px;font-family:Arial,sans-serif}
.name{font-size:34px;font-weight:700;color:#1d4ed8;border-bottom:2px solid #1d4ed8;display:inline-block;padding-bottom:4px;margin-bottom:28px}
.body-text{font-size:14px;line-height:1.8;color:#334155;margin-bottom:28px;font-family:Arial,sans-serif}
.score-block{display:inline-flex;gap:36px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px 40px;margin-bottom:20px}
.score-item{text-align:center}
.score-val{font-size:30px;font-weight:800;font-family:Arial,sans-serif;display:block;color:#16a34a}
.score-lbl{font-size:11px;color:#64748b;font-family:Arial,sans-serif}
.level{display:inline-block;background:#1e293b;color:#fff;border-radius:20px;padding:6px 20px;font-size:13px;font-weight:700;font-family:Arial,sans-serif;margin:12px 0 24px}
.date{font-size:12px;color:#94a3b8;margin-bottom:40px;font-family:Arial,sans-serif}
.sigs{display:flex;gap:60px;justify-content:center}
.sig{text-align:center}
.sig-line{width:160px;border-top:1px solid #475569;margin:44px auto 4px}
.sig-lbl{font-size:11px;color:#64748b;font-family:Arial,sans-serif}
@media print{body{padding:0;min-height:auto}.cert{border-radius:0}}
</style></head><body>
<div class="cert">
  <p class="org">Компания по установке кондиционеров · CRM «Каплан»</p>
  <h1>СЕРТИФИКАТ</h1>
  <p class="subtitle">Ежегодная аттестация монтажников · ${certYear}</p>
  <p class="intro">Настоящим удостоверяется, что</p>
  <p class="name">${installerName}</p>
  <p class="body-text">успешно прошёл ежегодную аттестацию монтажников<br>и подтвердил квалификационный уровень<br>согласно требованиям компании.</p>
  <div class="score-block">
    <div class="score-item"><span class="score-val">${result.percentage}%</span><span class="score-lbl">Результат</span></div>
    <div class="score-item"><span class="score-val">${result.score}/${result.maxScore}</span><span class="score-lbl">Баллов</span></div>
  </div>
  <div><span class="level">${lvl.icon} Уровень: ${lvl.label}</span></div>
  <p class="date">Дата прохождения: ${dateStr}</p>
  <div class="sigs">
    <div class="sig"><div class="sig-line"></div><p class="sig-lbl">Руководитель</p></div>
    <div class="sig"><div class="sig-line"></div><p class="sig-lbl">Ответственный за обучение</p></div>
  </div>
</div>
</body></html>`);
}

// ─── Toast hook ───────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState<string|null>(null);
  const show = useCallback((t: string) => { setToast(t); setTimeout(() => setToast(null), 3200); }, []);
  return { toast, show };
}

// ─── Main component ───────────────────────────────────────────────────────────
export function TrainingView() {
  const { role, userName } = useRole();
  const [view, setView]             = useState<View>(role === "admin" ? "admin" : "home");
  const [installerName, setInstallerName] = useState(role === "installer" ? userName : "");
  const [tests, setTests]           = useState<TestMeta[]>([]);
  const [selectedTest, setSelectedTest]   = useState<TestFull | null>(null);
  const [currentResult, setCurrentResult] = useState<TestResult | null>(null);
  const [stats, setStats]           = useState<InstallerStats | null>(null);
  const [history, setHistory]       = useState<TestResult[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [certMatrix, setCertMatrix]   = useState<CertEntry[]>([]);
  const [loading, setLoading]       = useState(false);
  const { toast, show: showToast }  = useToast();

  // ── Load tests ──────────────────────────────────────────────────────────────
  const loadTests = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API}/training/tests`, { headers: AH });
      const data = await res.json();
      if (data.tests) setTests(data.tests);
    } catch { showToast("Ошибка загрузки тестов"); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { loadTests(); }, [loadTests]);

  // ── Load stats & history ────────────────────────────────────────────────────
  const loadStats = useCallback(async (name: string) => {
    if (!name) return;
    try {
      const [sRes, hRes] = await Promise.all([
        fetch(`${API}/training/stats/${encodeURIComponent(name)}?year=${CERT_YEAR}`, { headers: AH }),
        fetch(`${API}/training/results?installerName=${encodeURIComponent(name)}`, { headers: AH }),
      ]);
      const sData = await sRes.json();
      const hData = await hRes.json();
      if (sData.stats) setStats(sData.stats);
      if (hData.results) setHistory(hData.results);
    } catch { /* silent */ }
  }, []);

  const loadLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(`${API}/training/leaderboard`, { headers: AH });
      const data = await res.json();
      if (data.leaderboard) setLeaderboard(data.leaderboard);
    } catch { /* silent */ }
  }, []);

  const loadCertMatrix = useCallback(async () => {
    try {
      const res = await fetch(`${API}/training/certification/${CERT_YEAR}`, { headers: AH });
      const data = await res.json();
      if (data.installers) setCertMatrix(data.installers);
    } catch { /* silent */ }
  }, []);

  // ── Start test ──────────────────────────────────────────────────────────────
  async function openTestIntro(meta: TestMeta) {
    try {
      setLoading(true);
      const res = await fetch(`${API}/training/tests/${meta.id}`, { headers: AH });
      const data = await res.json();
      if (data.test) { setSelectedTest(data.test); setView("test_intro"); }
    } catch { showToast("Ошибка загрузки теста"); }
    finally { setLoading(false); }
  }

  function handleTestComplete(result: TestResult) {
    setCurrentResult(result);
    loadStats(installerName);
    setView("result");
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">

      {/* ── HOME ─────────────────────────────────────────────────────────── */}
      {view === "home" && (
        <HomeView
          installerName={installerName}
          setInstallerName={setInstallerName}
          tests={tests}
          stats={stats}
          loading={loading}
          onLoadStats={loadStats}
          onOpenTest={openTestIntro}
          onGoHistory={() => { loadStats(installerName); setView("history"); }}
          onGoLeaderboard={() => { loadLeaderboard(); setView("leaderboard"); }}
          onGoCertMatrix={() => { loadCertMatrix(); setView("cert_matrix"); }}
          onGoAdmin={() => setView("admin")}
        />
      )}

      {/* ── TEST INTRO ───────────────────────────────────────────────────── */}
      {view === "test_intro" && selectedTest && (
        <TestIntroView
          test={selectedTest}
          installerName={installerName}
          onStart={() => setView("test_run")}
          onBack={() => setView("home")}
        />
      )}

      {/* ── TEST RUN ─────────────────────────────────────────────────────── */}
      {view === "test_run" && selectedTest && (
        <TestRunView
          test={selectedTest}
          installerName={installerName}
          onComplete={handleTestComplete}
          onCancel={() => setView("home")}
        />
      )}

      {/* ── RESULT ───────────────────────────────────────────────────────── */}
      {view === "result" && currentResult && (
        <ResultView
          result={currentResult}
          test={selectedTest!}
          installerName={installerName}
          onRetry={() => setView("test_run")}
          onHome={() => setView("home")}
          onHistory={() => { loadStats(installerName); setView("history"); }}
        />
      )}

      {/* ── HISTORY ──────────────────────────────────────────────────────── */}
      {view === "history" && (
        <HistoryView
          installerName={installerName}
          stats={stats}
          history={history}
          tests={tests}
          onBack={() => setView("home")}
          onOpenTest={openTestIntro}
        />
      )}

      {/* ── LEADERBOARD ──────────────────────────────────────────────────── */}
      {view === "leaderboard" && (
        <LeaderboardView
          leaderboard={leaderboard}
          currentInstaller={installerName}
          onBack={() => setView("home")}
        />
      )}

      {/* ── CERT MATRIX ──────────────────────────────────────────────────── */}
      {view === "cert_matrix" && (
        <CertMatrixView
          matrix={certMatrix}
          year={CERT_YEAR}
          onBack={() => setView("home")}
        />
      )}

      {/* ── ADMIN ────────────────────────────────────────────────────────── */}
      {view === "admin" && role === "admin" && (
        <TrainingAdminPanel
          onBack={() => { loadTests(); setView("home"); }}
          showToast={showToast}
        />
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-indigo-700 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-semibold max-w-xs text-center pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HOME VIEW
// ══════════════════════════════════════════════════════════════════════════════
function HomeView({ installerName, setInstallerName, tests, stats, loading, onLoadStats, onOpenTest, onGoHistory, onGoLeaderboard, onGoCertMatrix, onGoAdmin }: any) {
  const { role, userName } = useRole();
  const isAdmin = role === "admin";
  const [nameInput, setNameInput] = useState(installerName || (role === "installer" ? userName : ""));
  const annualTest = tests.find((t: TestMeta) => t.isAnnualCertification && t.certYear === CERT_YEAR);
  const certStatus = stats?.annualCertification?.status;

  // Auto-fill for installer role
  useEffect(() => {
    if (role === "installer" && userName && !installerName) {
      setInstallerName(userName);
      onLoadStats(userName);
    }
  }, [role, userName]);

  function confirm() {
    const n = nameInput.trim();
    if (!n) return;
    setInstallerName(n);
    onLoadStats(n);
  }

  const lvl = stats ? LEVEL_CFG[stats.level] ?? LEVEL_CFG.trainee : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-900 via-indigo-800 to-violet-800 text-white px-4 pt-8 pb-5 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-black tracking-tight">📚 Обучение монтажников</h1>
            <p className="text-indigo-300 text-sm mt-0.5">Тесты · Аттестация · Уровень</p>
          </div>
          {isAdmin && (
            <button onClick={onGoAdmin} className="bg-indigo-700/50 hover:bg-indigo-700 rounded-xl px-3 py-1.5 text-xs font-bold text-indigo-200 transition-all flex items-center gap-1.5">
              ⚙️ Управление
            </button>
          )}
        </div>

        {/* Name input */}
        <div className="flex gap-2">
          <input
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && confirm()}
            placeholder="Введите ваше имя…"
            className="flex-1 bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-white placeholder-indigo-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-white/40"
          />
          <button onClick={confirm}
            className="bg-white text-indigo-800 rounded-xl px-4 py-2.5 text-sm font-black active:scale-95">
            ✓
          </button>
        </div>

        {/* Level badge */}
        {stats && lvl && (
          <div className="mt-3 bg-white/10 border border-white/20 rounded-2xl p-3 flex items-center gap-3">
            <span className="text-3xl">{lvl.icon}</span>
            <div className="flex-1">
              <p className="font-black text-white">{installerName}</p>
              <p className="text-indigo-200 text-sm">{lvl.label} · {stats.levelScore}%</p>
            </div>
            <div className="text-right">
              <p className="text-white font-black text-lg">{stats.totalTests}</p>
              <p className="text-indigo-300 text-xs">тестов</p>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pt-4 pb-8 space-y-4">
        {/* Annual cert banner */}
        {installerName && annualTest && (
          <div className={`rounded-2xl p-4 border ${
            certStatus === "passed" ? "bg-emerald-50 border-emerald-200" :
            certStatus === "failed" ? "bg-red-50 border-red-200" :
            "bg-amber-50 border-amber-300"
          }`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{certStatus === "passed" ? "✅" : certStatus === "failed" ? "❌" : "⚠️"}</span>
              <div className="flex-1 min-w-0">
                <p className={`font-black text-sm ${certStatus === "passed" ? "text-emerald-800" : certStatus === "failed" ? "text-red-800" : "text-amber-800"}`}>
                  Ежегодная аттестация {CERT_YEAR}
                </p>
                <p className={`text-xs mt-0.5 ${certStatus === "passed" ? "text-emerald-600" : certStatus === "failed" ? "text-red-600" : "text-amber-700"}`}>
                  {certStatus === "passed" ? `✓ Пройдена · ${stats?.annualCertification.percentage}%` :
                   certStatus === "failed" ? `✗ Не пройдена · ${stats?.annualCertification.percentage}%` :
                   "Ещё не проходили — пройдите обязательно"}
                </p>
              </div>
              {certStatus !== "passed" && (
                <button onClick={() => onOpenTest(annualTest)}
                  className="bg-amber-600 text-white text-xs font-black px-3 py-2 rounded-xl active:scale-90">
                  Пройти
                </button>
              )}
            </div>
          </div>
        )}

        {/* Quick nav */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Моя статистика", icon: "📊", action: onGoHistory, disabled: !installerName },
            { label: "Рейтинг",        icon: "🏆", action: onGoLeaderboard, disabled: false },
            { label: "Аттестация",     icon: "📋", action: onGoCertMatrix, disabled: false },
          ].map(n => (
            <button key={n.label} onClick={n.action} disabled={n.disabled}
              className={`rounded-2xl border p-3 flex flex-col items-center gap-1.5 active:scale-95 transition-all ${
                n.disabled ? "bg-slate-50 border-slate-100 opacity-40" : "bg-white border-slate-100 shadow-sm"
              }`}>
              <span className="text-2xl">{n.icon}</span>
              <p className="text-[10px] font-bold text-slate-600 leading-tight text-center">{n.label}</p>
            </button>
          ))}
        </div>

        {/* Test list */}
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Доступные тесты</p>
          {loading ? (
            <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : tests.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">Нет тестов</div>
          ) : (
            <div className="space-y-2">
              {tests.map((t: TestMeta) => <TestCard key={t.id} test={t} onStart={() => onOpenTest(t)} disabled={!installerName} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Test card ─────────────────────────────────────────────────────────────────
function TestCard({ test: t, onStart, disabled }: { test: TestMeta; onStart: () => void; disabled: boolean }) {
  const diff = DIFF_CFG[t.difficulty] ?? DIFF_CFG.beginner;
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden ${t.isAnnualCertification ? "border-amber-200 bg-amber-50/30" : ""}`}>
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-lg flex-shrink-0">
            {t.isAnnualCertification ? "📋" : CAT_LABELS[t.category]?.split(" ")[0] ?? "📚"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <p className="font-bold text-slate-800 text-sm leading-tight">{t.title}</p>
              {t.isAnnualCertification && <span className="text-[9px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 font-bold">ЕЖЕГОДНАЯ</span>}
            </div>
            <p className="text-xs text-slate-400 line-clamp-1">{t.description}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${diff.color}`}>{diff.label}</span>
              <span className="text-[10px] text-slate-400">{t.questionsCount} вопросов</span>
              <span className="text-[10px] text-slate-400">≥ {t.passingScore}% для сдачи</span>
              {t.timeLimit > 0 && <span className="text-[10px] text-slate-400">⏱ {t.timeLimit} мин</span>}
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-slate-50 px-4 py-2">
        <button onClick={onStart} disabled={disabled}
          className={`w-full py-2 text-sm font-black rounded-xl transition-all active:scale-95 ${
            disabled ? "bg-slate-100 text-slate-400" : "bg-indigo-600 text-white shadow-sm shadow-indigo-200"
          }`}>
          {disabled ? "Введите имя для начала" : "▶ Начать тест"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST INTRO
// ══════════════════════════════════════════════════════════════════════════════
function TestIntroView({ test: t, installerName, onStart, onBack }: any) {
  const diff = DIFF_CFG[t.difficulty] ?? DIFF_CFG.beginner;
  const totalPts = t.questions.reduce((s: number, q: Question) => s + q.points, 0);
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="bg-gradient-to-br from-indigo-900 to-violet-800 text-white px-4 pt-8 pb-6 flex-shrink-0">
        <button onClick={onBack} className="text-indigo-300 text-sm mb-4 flex items-center gap-1">← Назад</button>
        <div className="w-16 h-16 rounded-3xl bg-white/15 border border-white/20 flex items-center justify-center text-3xl mb-3">
          {t.isAnnualCertification ? "📋" : "📝"}
        </div>
        <h1 className="text-xl font-black">{t.title}</h1>
        <p className="text-indigo-300 text-sm mt-1">{t.description}</p>
      </div>

      <div className="px-4 py-5 space-y-4 flex-1">
        {/* Info grid */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: "❓", label: "Вопросов", val: String(t.questionsCount) },
            { icon: "✅", label: "Проходной балл", val: `${t.passingScore}%` },
            { icon: "⏱", label: "Время", val: t.timeLimit > 0 ? `${t.timeLimit} мин` : "Без лимита" },
            { icon: "⭐", label: "Всего баллов", val: String(totalPts) },
          ].map(r => (
            <div key={r.label} className="bg-white rounded-2xl border border-slate-100 p-3 text-center shadow-sm">
              <p className="text-xl mb-0.5">{r.icon}</p>
              <p className="font-black text-slate-800">{r.val}</p>
              <p className="text-xs text-slate-400">{r.label}</p>
            </div>
          ))}
        </div>

        {/* Difficulty */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-slate-600">Уровень сложности</p>
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full border ${diff.color}`}>{diff.label}</span>
          </div>
          <div className="flex items-center justify-between mt-3">
            <p className="text-sm font-bold text-slate-600">Категория</p>
            <p className="text-sm font-semibold text-slate-800">{CAT_LABELS[t.category] ?? t.category}</p>
          </div>
          {t.isAnnualCertification && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <p className="text-xs font-bold text-amber-700">📋 Ежегодная аттестация {t.certYear}</p>
              <p className="text-xs text-amber-600 mt-0.5">Обязательна для всех монтажников. Результат сохраняется в базе.</p>
            </div>
          )}
        </div>

        {/* Rules */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
          <p className="text-xs font-bold text-indigo-700 mb-2 uppercase tracking-widest">Правила</p>
          <ul className="space-y-1.5">
            {[
              "На каждый вопрос есть один или несколько правильных ответов",
              "Переход вперёд/назад разрешён",
              "Результат сохраняется после завершения",
              t.timeLimit > 0 ? `Лимит времени: ${t.timeLimit} минут` : "Время не ограничено — не торопитесь",
            ].map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-indigo-700">
                <span className="mt-0.5 flex-shrink-0">•</span>{r}
              </li>
            ))}
          </ul>
        </div>

        <div className="pb-2">
          <p className="text-xs text-slate-400 text-center mb-3">Монтажник: <b className="text-slate-700">{installerName}</b></p>
          <button onClick={onStart}
            className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-2xl py-4 font-black text-base active:scale-95 shadow-lg shadow-indigo-200">
            🚀 Начать тест
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST RUN
// ══════════════════════════════════════════════════════════════════════════════
function TestRunView({ test, installerName, onComplete, onCancel }: {
  test: TestFull; installerName: string; onComplete: (r: TestResult) => void; onCancel: () => void;
}) {
  const [current, setCurrent]     = useState(0);
  const [answers, setAnswers]     = useState<Record<string, number[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [timeLeft, setTimeLeft]   = useState(test.timeLimit > 0 ? test.timeLimit * 60 : 0);
  const [showConfirm, setShowConfirm] = useState(false);
  const startedAt = useRef(new Date().toISOString());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer
  useEffect(() => {
    if (test.timeLimit <= 0) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timerRef.current!); submit(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, []);

  const q = test.questions[current];
  const sel = answers[q.id] ?? [];
  const answered = Object.keys(answers).length;
  const progress = Math.round((current + 1) / test.questions.length * 100);

  function toggleOption(idx: number) {
    setAnswers(prev => {
      const cur = prev[q.id] ?? [];
      let next: number[];
      if (q.type === "single") {
        next = [idx];
      } else {
        next = cur.includes(idx) ? cur.filter(i => i !== idx) : [...cur, idx];
      }
      return { ...prev, [q.id]: next };
    });
  }

  async function submit() {
    if (submitting) return;
    clearInterval(timerRef.current!);
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/training/results`, {
        method: "POST", headers: JH,
        body: JSON.stringify({ testId: test.id, installerName, answers, startedAt: startedAt.current }),
      });
      const data = await res.json();
      if (data.result) onComplete(data.result);
    } catch {
      setSubmitting(false);
    }
  }

  const timerColor = timeLeft > 120 ? "text-emerald-400" : timeLeft > 60 ? "text-amber-400" : "text-red-400";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="bg-indigo-900 text-white px-4 pt-8 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => setShowConfirm(true)} className="text-indigo-300 text-sm">✕ Выйти</button>
          <p className="text-sm font-bold">{current + 1} / {test.questions.length}</p>
          {test.timeLimit > 0 ? (
            <p className={`text-sm font-black tabular-nums ${timerColor}`}>
              ⏱ {String(Math.floor(timeLeft/60)).padStart(2,"0")}:{String(timeLeft%60).padStart(2,"0")}
            </p>
          ) : <div className="w-16" />}
        </div>
        {/* Progress */}
        <div className="w-full bg-indigo-800 rounded-full h-1.5">
          <div className="h-1.5 rounded-full bg-gradient-to-r from-indigo-400 to-violet-400 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between text-xs text-indigo-400 mt-1">
          <span>Ответили: {answered}</span>
          <span>{test.questions.filter((_,i) => answers[test.questions[i].id]?.length > 0).length} / {test.questions.length}</span>
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Question header */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              q.difficulty === "easy" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
              q.difficulty === "medium" ? "bg-amber-50 text-amber-700 border-amber-200" :
              "bg-red-50 text-red-700 border-red-200"
            }`}>{q.difficulty === "easy" ? "Лёгкое" : q.difficulty === "medium" ? "Среднее" : "Сложное"}</span>
            <span className="text-[10px] text-slate-400">{q.points} {q.points === 1 ? "балл" : "балла"}</span>
            <span className="text-[10px] text-slate-400">{q.type === "single" ? "Один ответ" : "Несколько ответов"}</span>
          </div>
          <p className="text-base font-bold text-slate-800 leading-relaxed">{q.text}</p>
        </div>

        {/* Options */}
        <div className="space-y-2 mb-6">
          {q.options.map((opt, i) => {
            const isSelected = sel.includes(i);
            return (
              <button key={i} onClick={() => toggleOption(i)}
                className={`w-full text-left rounded-2xl border-2 px-4 py-3.5 transition-all active:scale-[0.98] ${
                  isSelected
                    ? "bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-200"
                    : "bg-white border-slate-200 text-slate-800"
                }`}>
                <div className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-xs font-black mt-0.5 ${
                    isSelected ? "bg-white border-white text-indigo-600" : "border-slate-300 text-slate-400"
                  }`}>
                    {q.type === "single" ? (isSelected ? "●" : "○") : (isSelected ? "✓" : String.fromCharCode(65 + i))}
                  </div>
                  <p className={`text-sm font-medium leading-relaxed ${isSelected ? "text-white" : "text-slate-700"}`}>{opt}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Quick nav dots */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {test.questions.map((_, i) => (
            <button key={i} onClick={() => setCurrent(i)}
              className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                i === current ? "bg-indigo-600 text-white" :
                answers[test.questions[i].id]?.length > 0 ? "bg-emerald-100 text-emerald-700 border border-emerald-200" :
                "bg-slate-100 text-slate-400"
              }`}>{i + 1}</button>
          ))}
        </div>
      </div>

      {/* Nav buttons */}
      <div className="flex-shrink-0 bg-white border-t border-slate-100 px-4 py-3 flex gap-3">
        <button onClick={() => setCurrent(c => Math.max(0, c-1))} disabled={current === 0}
          className="flex-1 bg-slate-100 text-slate-700 rounded-xl py-3 font-bold text-sm disabled:opacity-40 active:scale-95">
          ← Назад
        </button>
        {current < test.questions.length - 1 ? (
          <button onClick={() => setCurrent(c => Math.min(test.questions.length - 1, c + 1))}
            className="flex-1 bg-indigo-600 text-white rounded-xl py-3 font-bold text-sm active:scale-95">
            Далее →
          </button>
        ) : (
          <button onClick={() => setShowConfirm(true)} disabled={submitting}
            className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl py-3 font-black text-sm active:scale-95 disabled:opacity-60">
            {submitting ? "⏳ Сохранение…" : "✅ Завершить тест"}

          </button>
        )}
      </div>

      {/* Confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowConfirm(false)} />
          <div className="relative w-full bg-white rounded-t-3xl p-6 pb-10">
            {answered < test.questions.length ? (
              <>
                <p className="text-lg font-black text-slate-800 mb-1">Завершить тест?</p>
                <p className="text-sm text-amber-600 mb-5">⚠️ Ответили на {answered} из {test.questions.length} вопросов. Пропущенные вопросы засчитаются как неверные.</p>
              </>
            ) : (
              <>
                <p className="text-lg font-black text-slate-800 mb-1">Завершить тест?</p>
                <p className="text-sm text-slate-500 mb-5">Ответили на все {test.questions.length} вопросов. Готовы сдать?</p>
              </>
            )}
            <div className="space-y-2">
              <button onClick={() => { setShowConfirm(false); submit(); }}
                className="w-full bg-indigo-600 text-white rounded-2xl py-4 font-black active:scale-95">
                ✅ Да, завершить
              </button>
              <button onClick={() => setShowConfirm(false)}
                className="w-full bg-slate-100 text-slate-700 rounded-2xl py-3.5 font-bold active:scale-95">
                Продолжить тест
              </button>
              <button onClick={onCancel}
                className="w-full text-red-500 py-3 font-semibold text-sm active:scale-95">
                Выйти без сохранения
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// RESULT VIEW
// ══════════════════════════════════════════════════════════════════════════════
function ResultView({ result: r, test, installerName, onRetry, onHome, onHistory }: any) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailResult, setDetailResult] = useState<TestResult | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function loadDetail() {
    if (detailResult) { setDetailOpen(true); return; }
    setLoadingDetail(true);
    try {
      const res = await fetch(`${API}/training/results/${r.id}`, { headers: AH });
      const data = await res.json();
      if (data.result) { setDetailResult(data.result); setDetailOpen(true); }
    } catch { /* silent */ }
    finally { setLoadingDetail(false); }
  }

  const passed = r.passed;
  const lvl = LEVEL_CFG[r.level] ?? LEVEL_CFG.trainee;

  const questions: Question[] = test?.questions ?? [];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Score header */}
      <div className={`text-white px-4 pt-4 pb-8 flex-shrink-0 flex flex-col items-center text-center ${
        passed ? "bg-gradient-to-br from-emerald-700 to-teal-700" : "bg-gradient-to-br from-red-700 to-orange-700"
      }`}>
        <div className="relative mb-4">
          <ScoreRing pct={r.percentage} passed={passed} />
        </div>
        <p className="text-3xl font-black">{r.percentage}%</p>
        <p className="text-white/70 text-sm mt-1">{r.score} из {r.maxScore} баллов</p>
        <div className={`mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full border ${
          passed ? "bg-emerald-600/50 border-emerald-400" : "bg-red-600/50 border-red-400"
        }`}>
          <span className="text-lg">{passed ? "✅" : "❌"}</span>
          <p className="font-black">{passed ? "ТЕСТ ПРОЙДЕН!" : "ТЕСТ НЕ ПРОЙДЕН"}</p>
        </div>
        {!passed && <p className="text-white/60 text-xs mt-2">Необходимо {r.percentage < (test?.passingScore ?? 70) ? `≥ ${test?.passingScore ?? 70}%` : ""} · попробуйте ещё раз</p>}
      </div>

      <div className="px-4 py-4 space-y-3">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 text-center">
            <p className="text-xl mb-0.5">{lvl.icon}</p>
            <p className={`font-black text-sm ${lvl.color}`}>{lvl.label}</p>
            <p className="text-xs text-slate-400">Ваш уровень</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 text-center">
            <p className="text-xl mb-0.5">⏱</p>
            <p className="font-black text-sm text-slate-800">{fmtDur(r.durationSeconds)}</p>
            <p className="text-xs text-slate-400">Затрачено</p>
          </div>
        </div>

        {/* Annual cert card */}
        {r.isAnnualCertification && passed && (
          <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🎖️</span>
              <div className="flex-1 min-w-0">
                <p className="font-black text-amber-800">Аттестация {r.certYear} пройдена!</p>
                <p className="text-xs text-amber-600 mt-0.5">{installerName} · {r.percentage}% · {fmtDate(r.completedAt)}</p>
              </div>
              <button
                onClick={() => exportCertificatePDF(r, installerName)}
                className="flex-shrink-0 bg-amber-600 text-white text-xs font-black px-3 py-2 rounded-xl active:scale-90 flex items-center gap-1"
              >
                📄 Сертификат
              </button>
            </div>
          </div>
        )}

        {/* Detail button */}
        <button onClick={loadDetail} disabled={loadingDetail}
          className="w-full bg-slate-100 text-slate-700 rounded-2xl py-3.5 font-bold text-sm active:scale-95 flex items-center justify-center gap-2">
          {loadingDetail ? "⏳ Загрузка…" : "🔍 Детальный разбор ответов"}
        </button>

        {/* Actions */}
        <div className="space-y-2 pb-4">
          <button onClick={onHistory}
            className="w-full bg-indigo-600 text-white rounded-2xl py-3.5 font-black active:scale-95">
            📊 Моя статистика
          </button>
          <div className="flex gap-2">
            <button onClick={onRetry} className="flex-1 bg-slate-100 text-slate-700 rounded-xl py-3 font-bold text-sm active:scale-95">🔄 Повторить</button>
            <button onClick={onHome} className="flex-1 bg-slate-100 text-slate-700 rounded-xl py-3 font-bold text-sm active:scale-95">🏠 Главная</button>
          </div>
        </div>
      </div>

      {/* Detail modal */}
      {detailOpen && detailResult && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-50">
          <div className="bg-indigo-900 text-white px-4 pt-8 pb-4 flex-shrink-0 flex items-center gap-3">
            <button onClick={() => setDetailOpen(false)} className="text-indigo-300 text-sm">← Назад</button>
            <p className="font-black flex-1">Разбор ответов</p>
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${passed ? "bg-emerald-700 text-emerald-200" : "bg-red-700 text-red-200"}`}>
              {r.percentage}%
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 pb-8 space-y-3">
            {questions.map((q, i) => {
              const qr = detailResult.questionResults?.find(x => x.questionId === q.id);
              if (!qr) return null;
              return (
                <div key={q.id} className={`bg-white rounded-2xl border-2 shadow-sm overflow-hidden ${qr.correct ? "border-emerald-200" : "border-red-200"}`}>
                  <div className={`px-3 py-2 flex items-center gap-2 ${qr.correct ? "bg-emerald-50" : "bg-red-50"}`}>
                    <span className="text-sm">{qr.correct ? "✅" : "❌"}</span>
                    <p className="text-xs font-bold text-slate-600">Вопрос {i + 1} · {qr.pointsEarned}/{qr.maxPoints} б.</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-sm font-semibold text-slate-800 mb-2 leading-snug">{q.text}</p>
                    {q.options.map((opt, oi) => {
                      const isCorr = qr.correctAnswers.includes(oi);
                      const isSel  = qr.selectedAnswers.includes(oi);
                      return (
                        <div key={oi} className={`flex items-start gap-2 px-3 py-2 rounded-xl mb-1 text-xs ${
                          isCorr && isSel  ? "bg-emerald-50 text-emerald-800 font-semibold" :
                          isCorr && !isSel ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                          !isCorr && isSel ? "bg-red-50 text-red-700 font-semibold" :
                          "text-slate-500"
                        }`}>
                          <span className="flex-shrink-0 mt-0.5">
                            {isCorr && isSel ? "✅" : isCorr && !isSel ? "☑️" : !isCorr && isSel ? "❌" : "○"}
                          </span>
                          {opt}
                        </div>
                      );
                    })}
                    {q.explanation && (
                      <p className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2 leading-relaxed">
                        💡 {q.explanation}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Score ring ─────────────────────────────────────────────────────────────────
function ScoreRing({ pct, passed }: { pct: number; passed: boolean }) {
  const r = 44, c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <svg width="120" height="120" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="10" />
      <circle cx="55" cy="55" r={r} fill="none" stroke={passed ? "#34d399" : "#f87171"} strokeWidth="10"
        strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
        transform="rotate(-90 55 55)" style={{ transition: "stroke-dasharray 0.8s ease" }} />
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HISTORY VIEW
// ══════════════════════════════════════════════════════════════════════════════
function HistoryView({ installerName, stats, history, tests, onBack, onOpenTest }: any) {
  const lvl = stats ? LEVEL_CFG[stats.level] ?? LEVEL_CFG.trainee : null;
  const LEVELS_ORDER: string[] = ["trainee", "installer", "specialist", "master", "senior_master"];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="bg-gradient-to-br from-indigo-900 to-violet-800 text-white px-4 pt-8 pb-5 flex-shrink-0">
        <button onClick={onBack} className="text-indigo-300 text-sm mb-3 flex items-center gap-1">← Назад</button>
        <h1 className="text-xl font-black">📊 Статистика</h1>
        <p className="text-indigo-300 text-sm">{installerName}</p>

        {stats && lvl && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { l: "Уровень",  v: lvl.icon + " " + lvl.label },
              { l: "Тестов",  v: stats.totalTests },
              { l: "Сдано",   v: `${stats.passRate}%` },
            ].map(s => (
              <div key={s.l} className="bg-white/10 rounded-xl p-2.5 text-center">
                <p className="font-black text-sm">{s.v}</p>
                <p className="text-indigo-300 text-[10px]">{s.l}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-4 pb-8 space-y-4">
        {/* Level progress */}
        {stats && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Путь к следующему уровню</p>
            <div className="flex items-center justify-between mb-2">
              {LEVELS_ORDER.map((l, i) => {
                const cfg = LEVEL_CFG[l];
                const isCur = l === stats.level;
                const isPast = LEVELS_ORDER.indexOf(l) <= LEVELS_ORDER.indexOf(stats.level);
                return (
                  <div key={l} className="flex flex-col items-center gap-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 ${
                      isCur ? "bg-indigo-600 border-indigo-600 scale-110" :
                      isPast ? "bg-emerald-100 border-emerald-400" : "bg-slate-100 border-slate-200"
                    }`}>
                      {cfg.icon}
                    </div>
                    <p className={`text-[9px] text-center leading-tight ${isCur ? "font-black text-indigo-700" : "text-slate-400"}`}>
                      {cfg.min}%
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 mt-1">
              <div className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
                style={{ width: `${Math.min(100, stats.levelScore)}%` }} />
            </div>
            <p className="text-xs text-slate-500 mt-1.5 text-right">Текущий средний балл: <b>{stats.levelScore}%</b></p>
          </div>
        )}

        {/* Annual cert */}
        {stats && (
          <div className={`rounded-2xl border p-4 ${
            stats.annualCertification.status === "passed" ? "bg-emerald-50 border-emerald-200" :
            stats.annualCertification.status === "failed" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"
          }`}>
            <p className="text-xs font-bold uppercase tracking-widest mb-1 text-slate-500">Ежегодная аттестация {stats.annualCertification.year}</p>
            <div className="flex items-center gap-3">
              <span className="text-2xl">
                {stats.annualCertification.status === "passed" ? "🎖️" : stats.annualCertification.status === "failed" ? "❌" : "⏳"}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`font-black text-sm ${
                  stats.annualCertification.status === "passed" ? "text-emerald-800" :
                  stats.annualCertification.status === "failed" ? "text-red-800" : "text-amber-800"
                }`}>
                  {stats.annualCertification.status === "passed" ? `Пройдена · ${stats.annualCertification.percentage}%` :
                   stats.annualCertification.status === "failed" ? `Не пройдена · ${stats.annualCertification.percentage}%` :
                   "Ещё не пройдена"}
                </p>
                {stats.annualCertification.completedAt && <p className="text-xs text-slate-500">{fmtDate(stats.annualCertification.completedAt)}</p>}
              </div>
              {stats.annualCertification.status === "passed" && (
                <button
                  onClick={() => exportCertificatePDF(
                    {
                      level: stats.level,
                      percentage: stats.annualCertification.percentage ?? 0,
                      score: 0,
                      maxScore: 0,
                      completedAt: stats.annualCertification.completedAt ?? new Date().toISOString(),
                      certYear: stats.annualCertification.year,
                      isAnnualCertification: true,
                    } as TestResult,
                    installerName
                  )}
                  className="flex-shrink-0 bg-emerald-600 text-white text-xs font-black px-3 py-2 rounded-xl active:scale-90"
                >
                  📄 PDF
                </button>
              )}
            </div>
          </div>
        )}

        {/* Category scores */}
        {stats && Object.keys(stats.categoryScores).length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Результаты по категориям</p>
            <div className="space-y-2.5">
              {Object.entries(stats.categoryScores).map(([cat, pct]) => (
                <div key={cat}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-700">{CAT_LABELS[cat] ?? cat}</span>
                    <span className={`font-black ${Number(pct) >= 70 ? "text-emerald-600" : "text-red-500"}`}>{Number(pct)}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${Number(pct) >= 70 ? "bg-emerald-500" : "bg-red-400"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* History list */}
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">История тестов ({history.length})</p>
          {history.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">Тесты ещё не проходили</div>
          ) : (
            <div className="space-y-2">
              {history.map((h: TestResult) => (
                <div key={h.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${
                    h.passed ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"
                  }`}>{h.percentage}%</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{h.testTitle}</p>
                    <p className="text-xs text-slate-400">{fmtDate(h.completedAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs font-black ${h.passed ? "text-emerald-600" : "text-red-500"}`}>{h.passed ? "✓ Сдано" : "✗ Провалено"}</p>
                    <p className="text-[10px] text-slate-400">{fmtDur(h.durationSeconds)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recommended */}
        {stats && tests.length > 0 && (() => {
          const weakCats = Object.entries(stats.categoryScores).filter(([, p]) => Number(p) < 70).map(([c]) => c);
          const recs = tests.filter((t: TestMeta) => weakCats.includes(t.category) && !t.isAnnualCertification);
          if (!recs.length) return null;
          return (
            <div>
              <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">⚠️ Рекомендуется повторить</p>
              {recs.map((t: TestMeta) => (
                <button key={t.id} onClick={() => onOpenTest(t)}
                  className="w-full bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3 mb-2 active:scale-95">
                  <span className="text-xl">{CAT_LABELS[t.category]?.split(" ")[0] ?? "📚"}</span>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-bold text-amber-800">{t.title}</p>
                    <p className="text-xs text-amber-600">Ваш результат: {stats.categoryScores[t.category]}%</p>

                  </div>
                  <span className="text-amber-600 font-bold">→</span>
                </button>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LEADERBOARD
// ══════════════════════════════════════════════════════════════════════════════
function LeaderboardView({ leaderboard, currentInstaller, onBack }: any) {
  const MEDALS = ["🥇", "🥈", "🥉"];
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="bg-gradient-to-br from-amber-700 to-orange-700 text-white px-4 pt-8 pb-5 flex-shrink-0">
        <button onClick={onBack} className="text-amber-300 text-sm mb-3 flex items-center gap-1">← Назад</button>
        <h1 className="text-xl font-black">🏆 Рейтинг монтажников</h1>
        <p className="text-amber-300 text-sm">{leaderboard.length} участников</p>
      </div>
      <div className="px-4 py-4 pb-8">
        {leaderboard.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p className="text-4xl mb-3">🏆</p>
            <p className="font-semibold">Результатов пока нет</p>
            <p className="text-sm mt-1">Пройдите хотя бы один тест</p>
          </div>
        ) : (
          <div className="space-y-2">
            {leaderboard.map((e: LeaderboardEntry, i: number) => {
              const lvl = LEVEL_CFG[e.level] ?? LEVEL_CFG.trainee;
              const isMe = e.installerName === currentInstaller;
              return (
                <div key={e.installerName} className={`rounded-2xl border px-4 py-3 flex items-center gap-3 ${
                  isMe ? "bg-indigo-50 border-indigo-200 shadow-md" :
                  i < 3 ? "bg-white border-amber-100 shadow-sm" : "bg-white border-slate-100 shadow-sm"
                }`}>
                  <div className="w-8 text-center flex-shrink-0">
                    {i < 3 ? <span className="text-xl">{MEDALS[i]}</span> : <span className="text-sm font-black text-slate-400">#{i+1}</span>}
                  </div>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0">{lvl.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold truncate ${isMe ? "text-indigo-700" : "text-slate-800"}`}>
                      {e.installerName}{isMe ? " (Вы)" : ""}
                    </p>
                    <p className="text-xs text-slate-400">{lvl.label} · {e.totalTests} тестов · {e.passRate}% сдано</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-lg font-black ${isMe ? "text-indigo-700" : "text-slate-800"}`}>{e.levelScore}%</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CERTIFICATION MATRIX
// ══════════════════════════════════════════════════════════════════════════════
function CertMatrixView({ matrix, year, onBack }: any) {
  const passed = matrix.filter((e: CertEntry) => e.certification.status === "passed").length;
  const pending = matrix.filter((e: CertEntry) => e.certification.status === "pending").length;
  const failed  = matrix.filter((e: CertEntry) => e.certification.status === "failed").length;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="bg-gradient-to-br from-slate-800 to-slate-700 text-white px-4 pt-8 pb-5 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <button onClick={onBack} className="text-slate-400 text-sm flex items-center gap-1">← Назад</button>
          {matrix.length > 0 && (
            <button
              onClick={() => exportCertMatrixPDF(matrix, year)}
              className="bg-white/15 hover:bg-white/25 text-white text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 active:scale-95 transition-all"
            >
              📄 PDF
            </button>
          )}
        </div>
        <h1 className="text-xl font-black">📋 Аттестация {year}</h1>
        <p className="text-slate-400 text-sm">Ежегодная проверка квалификации</p>

        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="bg-emerald-800/40 border border-emerald-700/40 rounded-xl p-2.5 text-center">
            <p className="text-xl font-black text-emerald-400">{passed}</p>
            <p className="text-emerald-300 text-[10px]">✅ Прошли</p>
          </div>
          <div className="bg-amber-800/40 border border-amber-700/40 rounded-xl p-2.5 text-center">
            <p className="text-xl font-black text-amber-400">{pending}</p>
            <p className="text-amber-300 text-[10px]">⏳ Ожидают</p>
          </div>
          <div className="bg-red-800/40 border border-red-700/40 rounded-xl p-2.5 text-center">
            <p className="text-xl font-black text-red-400">{failed}</p>
            <p className="text-red-300 text-[10px]">❌ Не сдали</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 pb-8">
        {matrix.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="font-semibold">Данных пока нет</p>
            <p className="text-sm mt-1">Монтажники должны пройти тесты</p>
          </div>
        ) : (
          <div className="space-y-2">
            {matrix.map((e: CertEntry, i: number) => {
              const lvl = LEVEL_CFG[e.level] ?? LEVEL_CFG.trainee;
              const status = e.certification.status;
              return (
                <div key={e.installerName} className={`bg-white rounded-2xl border shadow-sm px-4 py-3 flex items-center gap-3 ${
                  status === "passed" ? "border-emerald-200" :
                  status === "failed" ? "border-red-200" : "border-amber-200"
                }`}>
                  <div className="w-7 text-center flex-shrink-0">
                    <span className="text-sm font-black text-slate-400">#{i+1}</span>
                  </div>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0">{lvl.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{e.installerName}</p>
                    <p className="text-xs text-slate-400">{lvl.label} · ср. {e.levelScore}%</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {status === "passed" ? (
                      <>
                        <p className="text-sm font-black text-emerald-600">✅ {e.certification.percentage}%</p>
                        <p className="text-[10px] text-slate-400">{e.certification.completedAt ? fmtDate(e.certification.completedAt) : ""}</p>
                      </>
                    ) : status === "failed" ? (
                      <>
                        <p className="text-sm font-black text-red-500">❌ {e.certification.percentage}%</p>
                        <p className="text-[10px] text-slate-400">Не сдал</p>
                      </>
                    ) : (
                      <p className="text-sm font-black text-amber-500">⏳ Ожидает</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN VIEW
// ══════════════════════════════════════════════════════════════════════════════
function AdminView({ tests, onBack, onRefresh, showToast }: any) {
  const [tab, setTab] = useState<"tests"|"results">("tests");
  const [allResults, setAllResults] = useState<TestResult[]>([]);
  const [loadingRes, setLoadingRes] = useState(false);
  const [toggling, setToggling] = useState<string|null>(null);

  async function loadAllResults() {
    setLoadingRes(true);
    try {
      const res = await fetch(`${API}/training/results`, { headers: AH });
      const data = await res.json();
      if (data.results) setAllResults(data.results);
    } catch { /* silent */ }
    finally { setLoadingRes(false); }
  }

  useEffect(() => { if (tab === "results") loadAllResults(); }, [tab]);

  async function toggleActive(test: TestMeta) {
    setToggling(test.id);
    try {
      await fetch(`${API}/training/tests/${test.id}`, {
        method: "PUT", headers: JH,
        body: JSON.stringify({ active: !test.active }),
      });
      onRefresh();
      showToast(`Тест ${!test.active ? "активирован" : "деактивирован"}`);
    } catch { /* silent */ }
    finally { setToggling(null); }
  }

  async function deleteTest(id: string) {
    try {
      await fetch(`${API}/training/tests/${id}`, { method: "DELETE", headers: AH });
      onRefresh();
      showToast("🗑️ Тест удалён");
    } catch { /* silent */ }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white px-4 pt-8 pb-4 flex-shrink-0">
        <button onClick={onBack} className="text-slate-400 text-sm mb-3 flex items-center gap-1">← Назад</button>
        <h1 className="text-xl font-black">⚙️ Панель управления обучением</h1>
        {/* Tabs */}
        <div className="flex gap-2 mt-3">
          {[
            { key: "tests", label: "📝 Тесты" },
            { key: "results", label: "📊 Все результаты" },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key as any)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${
                tab === t.key ? "bg-white text-slate-800" : "bg-white/10 text-slate-300"
              }`}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-8 space-y-3">
        {/* TESTS tab */}
        {tab === "tests" && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <p className="text-xs text-amber-700 font-semibold">📌 {tests.length} тестов в системе · {tests.filter((t:TestMeta)=>t.active).length} активных</p>
            </div>
            {tests.map((t: TestMeta) => (
              <div key={t.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${!t.active ? "opacity-60" : ""}`}>
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-sm font-bold text-slate-800">{t.title}</p>
                        {t.isAnnualCertification && <span className="text-[9px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 font-bold">ЕЖЕГОДНАЯ</span>}
                        {!t.active && <span className="text-[9px] bg-slate-100 text-slate-500 border border-slate-200 rounded-full px-1.5 py-0.5 font-bold">НЕАКТИВНЫЙ</span>}
                      </div>
                      <p className="text-xs text-slate-400">{t.questionsCount} вопр. · ≥{t.passingScore}% · {CAT_LABELS[t.category] ?? t.category}</p>
                    </div>
                  </div>
                </div>
                <div className="border-t border-slate-50 flex">
                  <button onClick={() => toggleActive(t)} disabled={toggling === t.id}
                    className={`flex-1 py-2.5 text-xs font-bold active:scale-95 ${t.active ? "text-amber-600" : "text-emerald-600"}`}>
                    {toggling === t.id ? "⏳" : t.active ? "⏸ Деактивировать" : "▶ Активировать"}
                  </button>
                  <div className="w-px bg-slate-100" />
                  <button onClick={() => deleteTest(t.id)}
                    className="px-4 py-2.5 text-xs text-red-500 font-bold active:scale-95">
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* RESULTS tab */}
        {tab === "results" && (
          <>
            {loadingRes ? (
              <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : allResults.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">Результатов пока нет</div>
            ) : (
              <>
                <div className="bg-slate-100 rounded-xl px-3 py-2">
                  <p className="text-xs font-bold text-slate-500">Всего записей: {allResults.length}</p>
                </div>
                {allResults.map((r: TestResult) => (
                  <div key={r.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 ${
                      r.passed ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"
                    }`}>{r.percentage}%</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{r.installerName}</p>
                      <p className="text-xs text-slate-400 truncate">{r.testTitle}</p>
                      <p className="text-[10px] text-slate-300">{fmtDate(r.completedAt)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-xs font-black ${r.passed ? "text-emerald-600" : "text-red-500"}`}>{r.passed ? "✓" : "✗"}</p>
                      <p className="text-[10px] text-slate-400">{fmtDur(r.durationSeconds)}</p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
