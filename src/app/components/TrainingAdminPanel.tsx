import React, { useState, useEffect, useCallback } from "react";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import {
  Plus, Trash2, Edit3, ChevronDown, ChevronUp, Check, X, Save,
  BarChart3, BookOpen, GraduationCap, AlertTriangle, Users,
  Clock, Target, Award, ArrowLeft, RefreshCw, Eye, ToggleLeft,
  ToggleRight, ChevronRight, Loader2, Search, Filter
} from "lucide-react";

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
interface InstallerSummary {
  name: string;
  results: TestResult[];
  totalTests: number;
  passedTests: number;
  avgPct: number;
  passRate: number;
  level: string;
  weakCategories: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CAT_OPTS = [
  { value: "installation", label: "🔩 Монтаж" },
  { value: "electrical",   label: "⚡ Электрика" },
  { value: "refrigerant",  label: "❄️ Хладагенты" },
  { value: "safety",       label: "🦺 Безопасность" },
  { value: "ventilation",  label: "🌬️ Вентиляция" },
  { value: "service",      label: "🔧 ТО" },
  { value: "general",      label: "📚 Общий" },
];
const CAT_MAP: Record<string, string> = Object.fromEntries(CAT_OPTS.map(o => [o.value, o.label]));

const DIFF_OPTS = [
  { value: "beginner",     label: "Начальный",   color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  { value: "intermediate", label: "Средний",     color: "text-amber-600 bg-amber-50 border-amber-200" },
  { value: "advanced",     label: "Продвинутый", color: "text-red-600 bg-red-50 border-red-200" },
];
const DIFF_MAP: Record<string, { label: string; color: string }> = Object.fromEntries(DIFF_OPTS.map(o => [o.value, { label: o.label, color: o.color }]));

const Q_DIFF_OPTS = [
  { value: "easy",   label: "Лёгкий",   color: "text-emerald-600 bg-emerald-50" },
  { value: "medium", label: "Средний",  color: "text-amber-600 bg-amber-50" },
  { value: "hard",   label: "Сложный",  color: "text-red-600 bg-red-50" },
];

const LEVEL_CFG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  trainee:       { label: "Стажер",         icon: "🌱", color: "text-slate-600",   bg: "bg-slate-100" },
  installer:     { label: "Монтажник",       icon: "🔧", color: "text-blue-700",    bg: "bg-blue-100" },
  specialist:    { label: "Специалист",      icon: "⚡", color: "text-emerald-700", bg: "bg-emerald-100" },
  master:        { label: "Мастер",          icon: "🏅", color: "text-amber-700",   bg: "bg-amber-100" },
  senior_master: { label: "Старший мастер",  icon: "👑", color: "text-violet-700",  bg: "bg-violet-100" },
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtDur = (s: number) =>
  s < 60 ? `${s} сек` : `${Math.floor(s / 60)} мин ${s % 60} сек`;

function uid() { return `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

// ─── Input helpers ────────────────────────────────────────────────────────────
const INP = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 transition";
const LBL = "text-xs font-bold text-slate-500 block mb-1.5";

// ─── Tab type ─────────────────────────────────────────────────────────────────
type AdminTab = "tests" | "analytics" | "cert";

// ══════════════════════════════════════════════════════════════════════════════
// MAIN ADMIN PANEL
// ══════════════════════════════════════════════════════════════════════════════
interface TrainingAdminPanelProps {
  onBack: () => void;
  showToast: (msg: string) => void;
}

export function TrainingAdminPanel({ onBack, showToast }: TrainingAdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>("tests");
  const [tests, setTests] = useState<TestMeta[]>([]);
  const [loadingTests, setLoadingTests] = useState(true);
  const [editingTest, setEditingTest] = useState<TestFull | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  const loadTests = useCallback(async () => {
    setLoadingTests(true);
    try {
      const res = await fetch(`${API}/training/tests?active=false`, { headers: AH });
      const data = await res.json();
      if (data.tests) setTests(data.tests.sort((a: TestMeta, b: TestMeta) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ));
    } catch (e) { console.error("Load tests:", e); }
    finally { setLoadingTests(false); }
  }, []);

  useEffect(() => { loadTests(); }, [loadTests]);

  async function openTestEditor(testId: string) {
    try {
      const res = await fetch(`${API}/training/tests/${testId}`, { headers: AH });
      const data = await res.json();
      if (data.test) { setEditingTest(data.test); setCreatingNew(false); }
    } catch (e) { showToast("Ошибка загрузки теста"); }
  }

  function openNewTest() {
    setEditingTest({
      id: "", title: "", description: "", category: "installation", difficulty: "beginner",
      questionsCount: 0, passingScore: 70, timeLimit: 20,
      isAnnualCertification: false, active: true,
      createdAt: new Date().toISOString(), authorName: "Администратор",
      questions: [],
    });
    setCreatingNew(true);
  }

  async function toggleActive(test: TestMeta) {
    try {
      await fetch(`${API}/training/tests/${test.id}`, {
        method: "PUT", headers: JH,
        body: JSON.stringify({ active: !test.active }),
      });
      showToast(test.active ? "Тест деактивирован" : "Тест активирован ✅");
      loadTests();
    } catch { showToast("Ошибка"); }
  }

  async function deleteTest(id: string, title: string) {
    if (!confirm(`Удалить тест «${title}»?`)) return;
    try {
      await fetch(`${API}/training/tests/${id}`, { method: "DELETE", headers: AH });
      showToast("🗑️ Тест удалён");
      loadTests();
    } catch { showToast("Ошибка удаления"); }
  }

  // If test editor is open — show it
  if (editingTest) {
    return (
      <TestEditor
        test={editingTest}
        isNew={creatingNew}
        onClose={() => { setEditingTest(null); loadTests(); }}
        showToast={showToast}
      />
    );
  }

  const TABS: { key: AdminTab; label: string; icon: React.ReactNode }[] = [
    { key: "tests",     label: "Тесты",     icon: <BookOpen size={14} /> },
    { key: "analytics", label: "Монтажники", icon: <Users size={14} /> },
    { key: "cert",      label: "Аттестация", icon: <Award size={14} /> },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 to-indigo-900 text-white px-6 pt-6 pb-0 flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors">
            <ArrowLeft size={16} /> Назад
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-black">⚙️ Управление обучением</h1>
            <p className="text-slate-400 text-xs">Создание и редактирование тестов · Аналитика монтажников</p>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold transition-all border-b-2 ${
                tab === t.key
                  ? "border-indigo-400 text-white bg-white/5"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "tests" && (
          <TestsTab
            tests={tests}
            loading={loadingTests}
            onCreateNew={openNewTest}
            onEdit={openTestEditor}
            onToggle={toggleActive}
            onDelete={deleteTest}
            onRefresh={loadTests}
          />
        )}
        {tab === "analytics" && <AnalyticsTab showToast={showToast} />}
        {tab === "cert" && <CertTab />}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TESTS TAB
// ══════════════════════════════════════════════════════════════════════════════
function TestsTab({ tests, loading, onCreateNew, onEdit, onToggle, onDelete, onRefresh }: {
  tests: TestMeta[];
  loading: boolean;
  onCreateNew: () => void;
  onEdit: (id: string) => void;
  onToggle: (t: TestMeta) => void;
  onDelete: (id: string, title: string) => void;
  onRefresh: () => void;
}) {
  const active = tests.filter(t => t.active).length;

  return (
    <div className="p-5 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-sm font-bold text-slate-700">{tests.length} тестов · {active} активных</p>
        </div>
        <button onClick={onRefresh} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all">
          <RefreshCw size={16} />
        </button>
        <button onClick={onCreateNew}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-sm shadow-indigo-200 active:scale-95">
          <Plus size={16} /> Новый тест
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-indigo-400" size={28} />
        </div>
      ) : tests.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <BookOpen size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="font-semibold text-slate-600">Тестов пока нет</p>
          <p className="text-sm mt-1">Нажмите «Новый тест» чтобы создать первый</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tests.map(t => {
            const diff = DIFF_MAP[t.difficulty] ?? DIFF_MAP.beginner;
            return (
              <div key={t.id}
                className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all hover:shadow-md ${
                  !t.active ? "opacity-60 border-slate-200" :
                  t.isAnnualCertification ? "border-amber-200" : "border-slate-200"
                }`}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${
                      t.isAnnualCertification ? "bg-amber-50" : "bg-indigo-50"
                    }`}>
                      {t.isAnnualCertification ? "📋" : CAT_MAP[t.category]?.split(" ")[0] ?? "📝"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-bold text-slate-800 text-sm">{t.title}</p>
                        {t.isAnnualCertification && (
                          <span className="text-[9px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 font-bold">
                            ЕЖЕГОДНАЯ
                          </span>
                        )}
                        {!t.active && (
                          <span className="text-[9px] bg-slate-100 text-slate-500 border border-slate-200 rounded-full px-2 py-0.5 font-bold">
                            НЕАКТИВНЫЙ
                          </span>
                        )}
                      </div>
                      {t.description && (
                        <p className="text-xs text-slate-400 line-clamp-1 mb-1.5">{t.description}</p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${diff.color}`}>{diff.label}</span>
                        <span className="text-[10px] text-slate-400">{CAT_MAP[t.category] ?? t.category}</span>
                        <span className="text-[10px] text-slate-400">•</span>
                        <span className="text-[10px] text-slate-400">{t.questionsCount} вопросов</span>
                        <span className="text-[10px] text-slate-400">•</span>
                        <span className="text-[10px] text-slate-400">≥{t.passingScore}% для сдачи</span>
                        {t.timeLimit > 0 && (
                          <>
                            <span className="text-[10px] text-slate-400">•</span>
                            <span className="text-[10px] text-slate-400">⏱ {t.timeLimit} мин</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Actions */}
                <div className="border-t border-slate-100 flex divide-x divide-slate-100">
                  <button onClick={() => onEdit(t.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 transition-colors active:scale-95">
                    <Edit3 size={13} /> Редактировать
                  </button>
                  <button onClick={() => onToggle(t)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold transition-colors active:scale-95 ${
                      t.active ? "text-amber-600 hover:bg-amber-50" : "text-emerald-600 hover:bg-emerald-50"
                    }`}>
                    {t.active ? <><ToggleRight size={13} /> Деактивировать</> : <><ToggleLeft size={13} /> Активировать</>}
                  </button>
                  <button onClick={() => onDelete(t.id, t.title)}
                    className="px-4 py-2.5 text-xs text-red-500 font-bold hover:bg-red-50 transition-colors active:scale-95">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST EDITOR
// ══════════════════════════════════════════════════════════════════════════════
function TestEditor({ test: initialTest, isNew, onClose, showToast }: {
  test: TestFull;
  isNew: boolean;
  onClose: () => void;
  showToast: (msg: string) => void;
}) {
  const [form, setForm] = useState<TestFull>({ ...initialTest });
  const [saving, setSaving] = useState(false);
  const [editingQ, setEditingQ] = useState<Question | null>(null);
  const [editingQIdx, setEditingQIdx] = useState<number | null>(null);
  const [tab, setTab] = useState<"info" | "questions">("info");
  const [expandedQ, setExpandedQ] = useState<string | null>(null);

  const f = (k: keyof TestFull) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  async function save() {
    if (!form.title.trim()) { showToast("Введите название теста"); return; }
    if (form.questions.length === 0) { showToast("Добавьте хотя бы один вопрос"); return; }
    setSaving(true);
    try {
      const method = isNew ? "POST" : "PUT";
      const url = isNew ? `${API}/training/tests` : `${API}/training/tests/${form.id}`;
      const res = await fetch(url, { method, headers: JH, body: JSON.stringify(form) });
      const data = await res.json();
      if (data.test || data.id) {
        showToast(isNew ? "✅ Тест создан!" : "✅ Тест сохранён!");
        onClose();
      } else {
        showToast(`Ошибка: ${data.error ?? "неизвестная"}`);
      }
    } catch (e: any) {
      showToast(`Ошибка: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  function openNewQuestion() {
    setEditingQ({
      id: uid(), text: "", type: "single", options: ["", "", "", ""],
      correctAnswers: [], explanation: "", category: form.category ?? "installation",
      difficulty: "easy", points: 1,
    });
    setEditingQIdx(null);
  }

  function openEditQuestion(q: Question, idx: number) {
    setEditingQ({ ...q });
    setEditingQIdx(idx);
  }

  function saveQuestion(q: Question) {
    setForm(p => {
      const qs = [...p.questions];
      if (editingQIdx !== null) { qs[editingQIdx] = q; }
      else { qs.push(q); }
      return { ...p, questions: qs };
    });
    setEditingQ(null);
    setEditingQIdx(null);
  }

  function deleteQuestion(idx: number) {
    setForm(p => ({ ...p, questions: p.questions.filter((_, i) => i !== idx) }));
  }

  function moveQuestion(idx: number, dir: -1 | 1) {
    setForm(p => {
      const qs = [...p.questions];
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= qs.length) return p;
      [qs[idx], qs[newIdx]] = [qs[newIdx], qs[idx]];
      return { ...p, questions: qs };
    });
  }

  if (editingQ) {
    return (
      <QuestionEditor
        question={editingQ}
        defaultCategory={form.category}
        onSave={saveQuestion}
        onCancel={() => { setEditingQ(null); setEditingQIdx(null); }}
      />
    );
  }

  const totalPts = form.questions.reduce((s, q) => s + q.points, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-900 to-violet-900 text-white px-5 pt-5 pb-0 flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onClose}
            className="flex items-center gap-1.5 text-indigo-300 hover:text-white text-sm transition-colors">
            <ArrowLeft size={16} /> Назад
          </button>
          <div className="flex-1">
            <h2 className="font-black text-lg">{isNew ? "Новый тест" : "Редактирование теста"}</h2>
            <p className="text-indigo-300 text-xs">{form.questions.length} вопросов · {totalPts} баллов</p>
          </div>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 bg-white text-indigo-800 px-4 py-2 rounded-xl text-sm font-black hover:bg-indigo-50 transition-all active:scale-95 disabled:opacity-60 shadow">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
        {/* Sub-tabs */}
        <div className="flex">
          {[
            { key: "info",      label: "⚙️ Настройки" },
            { key: "questions", label: `❓ Вопросы (${form.questions.length})` },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key as any)}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
                tab === t.key ? "border-white text-white" : "border-transparent text-indigo-400 hover:text-indigo-200"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {/* ── INFO TAB ─────────────────────────────────────────────────────── */}
        {tab === "info" && (
          <div className="space-y-4 max-w-2xl">
            <div>
              <label className={LBL}>Название теста *</label>
              <input value={form.title} onChange={f("title")} placeholder="Базовый курс монтажника…" className={INP} />
            </div>
            <div>
              <label className={LBL}>Описание</label>
              <textarea value={form.description} onChange={f("description") as any}
                placeholder="Краткое описание теста и его цели…"
                rows={3} className={INP + " resize-none"} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LBL}>Категория</label>
                <select value={form.category} onChange={f("category")} className={INP}>
                  {CAT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>Сложность</label>
                <select value={form.difficulty} onChange={f("difficulty")} className={INP}>
                  {DIFF_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>Проходной балл (%)</label>
                <input type="number" min={1} max={100} value={form.passingScore}
                  onChange={e => setForm(p => ({ ...p, passingScore: +e.target.value }))}
                  className={INP} />
              </div>
              <div>
                <label className={LBL}>Лимит времени (мин, 0 = без лимита)</label>
                <input type="number" min={0} value={form.timeLimit}
                  onChange={e => setForm(p => ({ ...p, timeLimit: +e.target.value }))}
                  className={INP} />
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="font-bold text-slate-800 text-sm">Ежегодная аттестация</p>
                  <p className="text-xs text-slate-400 mt-0.5">Тест будет отображаться в матрице аттестации</p>
                </div>
                <button
                  onClick={() => setForm(p => ({
                    ...p,
                    isAnnualCertification: !p.isAnnualCertification,
                    certYear: !p.isAnnualCertification ? new Date().getFullYear() : undefined,
                  }))}
                  className={`w-12 h-6 rounded-full transition-all ${
                    form.isAnnualCertification ? "bg-amber-500" : "bg-slate-200"
                  } relative`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                    form.isAnnualCertification ? "left-6" : "left-0.5"
                  }`} />
                </button>
              </div>
              {form.isAnnualCertification && (
                <div className="mt-3">
                  <label className={LBL}>Год аттестации</label>
                  <input type="number" value={form.certYear ?? new Date().getFullYear()}
                    onChange={e => setForm(p => ({ ...p, certYear: +e.target.value }))}
                    className={INP} min={2020} max={2040} />
                </div>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="font-bold text-slate-800 text-sm">Тест активен</p>
                  <p className="text-xs text-slate-400 mt-0.5">Неактивные тесты недоступны монтажникам</p>
                </div>
                <button
                  onClick={() => setForm(p => ({ ...p, active: !p.active }))}
                  className={`w-12 h-6 rounded-full transition-all ${
                    form.active ? "bg-indigo-500" : "bg-slate-200"
                  } relative`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                    form.active ? "left-6" : "left-0.5"
                  }`} />
                </button>
              </div>
            </div>
            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 text-xs text-indigo-700">
              <p className="font-bold mb-1">После настройки перейдите на вкладку «Вопросы»</p>
              <p>Добавьте вопросы теста. Без вопросов тест сохранить не получится.</p>
            </div>
          </div>
        )}

        {/* ── QUESTIONS TAB ─────────────────────────────────────────────────── */}
        {tab === "questions" && (
          <div className="space-y-3 max-w-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-700">{form.questions.length} вопросов · {totalPts} баллов</p>
                <p className="text-xs text-slate-400">Нажмите на вопрос для редактирования</p>
              </div>
              <button onClick={openNewQuestion}
                className="flex items-center gap-2 bg-indigo-600 text-white px-3 py-2 rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all active:scale-95">
                <Plus size={13} /> Добавить вопрос
              </button>
            </div>

            {form.questions.length === 0 && (
              <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-2xl">
                <p className="text-4xl mb-3">❓</p>
                <p className="font-semibold text-slate-600">Вопросов пока нет</p>
                <p className="text-sm text-slate-400 mt-1">Нажмите «Добавить вопрос» чтобы начать</p>
              </div>
            )}

            {form.questions.map((q, idx) => {
              const isExp = expandedQ === q.id;
              const qDiff = Q_DIFF_OPTS.find(d => d.value === q.difficulty) ?? Q_DIFF_OPTS[0];
              return (
                <div key={q.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="flex items-start gap-3 p-4">
                    {/* Number */}
                    <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 font-black text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">{q.text || "—"}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${qDiff.color}`}>{qDiff.label}</span>
                        <span className="text-[10px] text-slate-400">{q.type === "single" ? "1 ответ" : "Несколько ответов"}</span>
                        <span className="text-[10px] text-slate-400">•</span>
                        <span className="text-[10px] text-slate-400">{q.points} б.</span>
                        <span className="text-[10px] text-slate-400">•</span>
                        <span className="text-[10px] text-slate-400">{q.options.filter(Boolean).length} вар.</span>
                      </div>
                    </div>
                    {/* Controls */}
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => moveQuestion(idx, -1)} disabled={idx === 0}
                        className="p-1.5 text-slate-300 hover:text-slate-600 disabled:opacity-30 rounded-lg hover:bg-slate-100 transition-all">
                        <ChevronUp size={14} />
                      </button>
                      <button onClick={() => moveQuestion(idx, 1)} disabled={idx === form.questions.length - 1}
                        className="p-1.5 text-slate-300 hover:text-slate-600 disabled:opacity-30 rounded-lg hover:bg-slate-100 transition-all">
                        <ChevronDown size={14} />
                      </button>
                      <button onClick={() => openEditQuestion(q, idx)}
                        className="p-1.5 text-indigo-500 hover:text-indigo-700 rounded-lg hover:bg-indigo-50 transition-all">
                        <Edit3 size={14} />
                      </button>
                      <button onClick={() => setExpandedQ(isExp ? null : q.id)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-all">
                        <Eye size={14} />
                      </button>
                      <button onClick={() => deleteQuestion(idx)}
                        className="p-1.5 text-red-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-all">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {/* Expanded preview */}
                  {isExp && (
                    <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/80">
                      <p className="text-xs font-bold text-slate-400 mb-2">Варианты ответов:</p>
                      {q.options.map((opt, oi) => (
                        <div key={oi} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg mb-1 text-xs ${
                          q.correctAnswers.includes(oi)
                            ? "bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200"
                            : "text-slate-500"
                        }`}>
                          <span>{q.correctAnswers.includes(oi) ? "✅" : "○"}</span>
                          {opt || "—"}
                        </div>
                      ))}
                      {q.explanation && (
                        <p className="text-xs text-slate-500 bg-amber-50 rounded-xl px-3 py-2 mt-2">
                          💡 {q.explanation}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {form.questions.length > 0 && (
              <button onClick={openNewQuestion}
                className="w-full border-2 border-dashed border-indigo-200 text-indigo-500 rounded-2xl py-3.5 text-sm font-bold hover:border-indigo-400 hover:bg-indigo-50 transition-all active:scale-95 flex items-center justify-center gap-2">
                <Plus size={15} /> Добавить ещё вопрос
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// QUESTION EDITOR
// ══════════════════════════════════════════════════════════════════════════════
function QuestionEditor({ question: initQ, defaultCategory, onSave, onCancel }: {
  question: Question;
  defaultCategory: string;
  onSave: (q: Question) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState<Question>({ ...initQ });
  const [error, setError] = useState("");

  function setField<K extends keyof Question>(k: K, v: Question[K]) {
    setQ(p => ({ ...p, [k]: v }));
  }

  function setOption(idx: number, val: string) {
    setQ(p => {
      const opts = [...p.options];
      opts[idx] = val;
      return { ...p, options: opts };
    });
  }

  function addOption() {
    if (q.options.length >= 8) return;
    setQ(p => ({ ...p, options: [...p.options, ""] }));
  }

  function removeOption(idx: number) {
    if (q.options.length <= 2) return;
    setQ(p => ({
      ...p,
      options: p.options.filter((_, i) => i !== idx),
      correctAnswers: p.correctAnswers.filter(a => a !== idx).map(a => a > idx ? a - 1 : a),
    }));
  }

  function toggleCorrect(idx: number) {
    setQ(p => {
      if (p.type === "single") {
        return { ...p, correctAnswers: [idx] };
      }
      const ca = p.correctAnswers.includes(idx)
        ? p.correctAnswers.filter(a => a !== idx)
        : [...p.correctAnswers, idx];
      return { ...p, correctAnswers: ca };
    });
  }

  function trySubmit() {
    if (!q.text.trim()) { setError("Введите текст вопроса"); return; }
    if (q.options.filter(o => o.trim()).length < 2) { setError("Добавьте минимум 2 варианта ответа"); return; }
    if (q.correctAnswers.length === 0) { setError("Отметьте хотя бы один правильный ответ"); return; }
    setError("");
    onSave({ ...q, options: q.options.filter(o => o.trim() || q.correctAnswers.includes(q.options.indexOf(o))) });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-violet-900 to-indigo-900 text-white px-5 pt-5 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={onCancel}
            className="flex items-center gap-1.5 text-violet-300 hover:text-white text-sm transition-colors">
            <ArrowLeft size={16} /> Назад
          </button>
          <h2 className="font-black text-lg flex-1">Редактор вопроса</h2>
          <button onClick={trySubmit}
            className="flex items-center gap-2 bg-white text-violet-800 px-4 py-2 rounded-xl text-sm font-black hover:bg-violet-50 active:scale-95 shadow">
            <Check size={14} /> Сохранить
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4 max-w-2xl">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700 font-semibold flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {/* Question text */}
        <div>
          <label className={LBL}>Текст вопроса *</label>
          <textarea value={q.text} onChange={e => setField("text", e.target.value)}
            placeholder="Введите вопрос…" rows={3}
            className={INP + " resize-none"} autoFocus />
        </div>

        {/* Type */}
        <div>
          <label className={LBL}>Тип вопроса</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: "single",   l: "Один ответ",        d: "Только один вариант правильный" },
              { v: "multiple", l: "Несколько ответов",  d: "Несколько правильных вариантов" },
            ].map(({ v, l, d }) => (
              <button key={v} type="button" onClick={() => { setField("type", v as any); setField("correctAnswers", []); }}
                className={`text-left px-3 py-2.5 rounded-xl border-2 transition-all ${
                  q.type === v
                    ? "border-indigo-500 bg-indigo-50 text-indigo-800"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                }`}>
                <p className="text-sm font-bold">{l}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{d}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Options */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={LBL + " mb-0"}>Варианты ответов *</label>
            <span className="text-[10px] text-slate-400">
              {q.type === "single" ? "Нажмите ○ для выбора правильного" : "Нажмите ○ для выбора (можно несколько)"}
            </span>
          </div>
          <div className="space-y-2">
            {q.options.map((opt, idx) => {
              const isCorr = q.correctAnswers.includes(idx);
              return (
                <div key={idx} className={`flex items-center gap-2 p-2 rounded-xl border-2 transition-all ${
                  isCorr ? "border-emerald-400 bg-emerald-50" : "border-slate-100 bg-white"
                }`}>
                  <button type="button" onClick={() => toggleCorrect(idx)}
                    className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                      isCorr ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 hover:border-emerald-400"
                    }`}>
                    {isCorr && <Check size={13} />}
                  </button>
                  <input
                    value={opt}
                    onChange={e => setOption(idx, e.target.value)}
                    placeholder={`Вариант ${idx + 1}…`}
                    className="flex-1 bg-transparent text-sm outline-none text-slate-800 placeholder-slate-300"
                  />
                  {q.options.length > 2 && (
                    <button type="button" onClick={() => removeOption(idx)}
                      className="p-1 text-slate-300 hover:text-red-500 rounded-lg transition-all">
                      <X size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {q.options.length < 8 && (
            <button type="button" onClick={addOption}
              className="mt-2 w-full border border-dashed border-slate-300 text-slate-400 text-xs font-semibold py-2 rounded-xl hover:border-indigo-400 hover:text-indigo-500 transition-all">
              + Добавить вариант
            </button>
          )}
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={LBL}>Категория</label>
            <select value={q.category} onChange={e => setField("category", e.target.value)} className={INP}>
              {CAT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={LBL}>Сложность</label>
            <select value={q.difficulty} onChange={e => setField("difficulty", e.target.value as any)} className={INP}>
              {Q_DIFF_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={LBL}>Баллов</label>
            <input type="number" min={1} max={10} value={q.points}
              onChange={e => setField("points", +e.target.value)} className={INP} />
          </div>
        </div>

        {/* Explanation */}
        <div>
          <label className={LBL}>Пояснение (показывается после ответа)</label>
          <textarea value={q.explanation || ""} onChange={e => setField("explanation", e.target.value)}
            placeholder="Объясните правильный ответ монтажнику…" rows={2}
            className={INP + " resize-none"} />
        </div>

        <button onClick={trySubmit}
          className="w-full bg-indigo-600 text-white rounded-2xl py-3.5 font-black text-sm hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-2">
          <Check size={16} /> Сохранить вопрос
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ANALYTICS TAB — per-installer breakdown
// ══════════════════════════════════════════════════════════════════════════════
function AnalyticsTab({ showToast }: { showToast: (msg: string) => void }) {
  const [allResults, setAllResults] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedInstaller, setSelectedInstaller] = useState<InstallerSummary | null>(null);
  const [selectedResult, setSelectedResult] = useState<TestResult | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [testFilter, setTestFilter] = useState("all");
  const [allTests, setAllTests] = useState<TestMeta[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, tRes] = await Promise.all([
        fetch(`${API}/training/results`, { headers: AH }),
        fetch(`${API}/training/tests?active=false`, { headers: AH }),
      ]);
      const rData = await rRes.json();
      const tData = await tRes.json();
      if (rData.results) setAllResults(rData.results);
      if (tData.tests) setAllTests(tData.tests);
    } catch (e) { console.error("Load analytics:", e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadResultDetail(resultId: string) {
    setLoadingDetail(true);
    try {
      const res = await fetch(`${API}/training/results/${resultId}`, { headers: AH });
      const data = await res.json();
      if (data.result) setSelectedResult(data.result);
    } catch (e) { showToast("Ошибка загрузки результата"); }
    finally { setLoadingDetail(false); }
  }

  // Group results by installer
  const installerMap = new Map<string, TestResult[]>();
  for (const r of allResults) {
    if (!installerMap.has(r.installerName)) installerMap.set(r.installerName, []);
    installerMap.get(r.installerName)!.push(r);
  }

  function buildSummary(name: string, results: TestResult[]): InstallerSummary {
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const avg = total > 0 ? Math.round(results.reduce((s, r) => s + r.percentage, 0) / total) : 0;
    // Category scores
    const catMap: Record<string, number[]> = {};
    for (const r of results) {
      if (!catMap[r.testCategory]) catMap[r.testCategory] = [];
      catMap[r.testCategory].push(r.percentage);
    }
    const catAvg: Record<string, number> = {};
    for (const [c, ps] of Object.entries(catMap))
      catAvg[c] = Math.round(ps.reduce((a, b) => a + b, 0) / ps.length);
    const weakCats = Object.entries(catAvg).filter(([, p]) => p < 70).map(([c]) => c);
    const level = avg >= 95 ? "senior_master" : avg >= 85 ? "master" : avg >= 70 ? "specialist" : avg >= 50 ? "installer" : "trainee";
    return { name, results, totalTests: total, passedTests: passed, avgPct: avg, passRate: total > 0 ? Math.round(passed / total * 100) : 0, level, weakCategories: weakCats };
  }

  const summaries: InstallerSummary[] = Array.from(installerMap.entries())
    .map(([name, res]) => buildSummary(name, res))
    .sort((a, b) => b.avgPct - a.avgPct);

  const filtered = summaries.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

  // ── Detail: selected result breakdown ──
  if (selectedResult) {
    const test = allTests.find(t => t.id === selectedResult.testId);
    return <ResultDetailView result={selectedResult} testTitle={selectedResult.testTitle}
      onBack={() => setSelectedResult(null)} />;
  }

  // ── Detail: selected installer ──
  if (selectedInstaller) {
    const filteredRes = testFilter === "all"
      ? selectedInstaller.results
      : selectedInstaller.results.filter(r => r.testId === testFilter);

    const catScores: Record<string, number[]> = {};
    for (const r of selectedInstaller.results) {
      if (!catScores[r.testCategory]) catScores[r.testCategory] = [];
      catScores[r.testCategory].push(r.percentage);
    }
    const catAvg: Record<string, number> = {};
    for (const [c, ps] of Object.entries(catScores))
      catAvg[c] = Math.round(ps.reduce((a, b) => a + b, 0) / ps.length);

    const lvl = LEVEL_CFG[selectedInstaller.level] ?? LEVEL_CFG.trainee;

    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white px-5 pt-5 pb-4 flex-shrink-0">
          <button onClick={() => setSelectedInstaller(null)}
            className="flex items-center gap-1.5 text-indigo-300 hover:text-white text-sm mb-3 transition-colors">
            <ArrowLeft size={16} /> Все монтажники
          </button>
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl ${lvl.bg} flex items-center justify-center text-2xl`}>
              {lvl.icon}
            </div>
            <div className="flex-1">
              <p className="font-black text-xl">{selectedInstaller.name}</p>
              <p className={`text-sm font-bold ${lvl.color.replace("text-", "text-")} text-white/80`}>
                {lvl.label} · {selectedInstaller.avgPct}% ср. балл
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {[
              { l: "Тестов",  v: selectedInstaller.totalTests },
              { l: "Сдано",   v: selectedInstaller.passedTests },
              { l: "Успех",   v: `${selectedInstaller.passRate}%` },
            ].map(s => (
              <div key={s.l} className="bg-white/10 rounded-xl p-2 text-center">
                <p className="font-black">{s.v}</p>
                <p className="text-[10px] text-indigo-300">{s.l}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Weak categories */}
          {selectedInstaller.weakCategories.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <p className="text-sm font-bold text-red-700 flex items-center gap-2 mb-2">
                <AlertTriangle size={14} /> Слабые места — нужно доработать
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedInstaller.weakCategories.map(c => (
                  <span key={c} className="text-xs bg-red-100 text-red-700 border border-red-200 px-2.5 py-1 rounded-full font-bold">
                    {CAT_MAP[c] ?? c} · {catAvg[c]}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Category scores */}
          {Object.keys(catAvg).length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Результаты по категориям</p>
              <div className="space-y-3">
                {Object.entries(catAvg).sort(([, a], [, b]) => a - b).map(([cat, pct]) => (
                  <div key={cat}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-semibold text-slate-700">{CAT_MAP[cat] ?? cat}</span>
                      <span className={`font-black ${pct >= 70 ? "text-emerald-600" : "text-red-500"}`}>{pct}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all ${pct >= 70 ? "bg-emerald-500" : "bg-red-400"}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Test filter */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setTestFilter("all")}
              className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                testFilter === "all" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200"
              }`}>
              Все тесты
            </button>
            {[...new Set(selectedInstaller.results.map(r => r.testId))].map(tid => {
              const t = allTests.find(t => t.id === tid);
              return (
                <button key={tid} onClick={() => setTestFilter(tid)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                    testFilter === tid ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200"
                  }`}>
                  {t?.title ?? tid}
                </button>
              );
            })}
          </div>

          {/* Results list */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              История попыток ({filteredRes.length})
            </p>
            {filteredRes.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">Нет результатов</div>
            ) : (
              filteredRes
                .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
                .map(r => (
                  <button key={r.id}
                    onClick={() => loadResultDetail(r.id)}
                    disabled={loadingDetail}
                    className="w-full bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3 hover:shadow-md hover:border-indigo-200 transition-all active:scale-99 text-left">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 ${
                      r.passed ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"
                    }`}>
                      {r.percentage}%
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{r.testTitle}</p>
                      <p className="text-xs text-slate-400">{fmtDate(r.completedAt)} · {fmtDur(r.durationSeconds)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-black ${r.passed ? "text-emerald-600" : "text-red-500"}`}>
                        {r.passed ? "✅ Сдано" : "❌ Провал"}
                      </p>
                      <p className="text-xs text-slate-400">{r.score}/{r.maxScore} б.</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
                  </button>
                ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Installer list ──
  return (
    <div className="p-5 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск монтажника…"
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <button onClick={load} className="p-2.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all">
          <RefreshCw size={16} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-indigo-400" size={28} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Users size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="font-semibold text-slate-600">
            {search ? "Монтажник не найден" : "Результатов пока нет"}
          </p>
          <p className="text-sm mt-1">
            {search ? "Попробуйте изменить запрос" : "Монтажники должны пройти хотя бы один тест"}
          </p>
        </div>
      ) : (
        <>
          {/* Overall stats */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: "👷", label: "Монтажников", val: filtered.length },
              { icon: "✅", label: "Сдали >70%", val: filtered.filter(s => s.avgPct >= 70).length },
              { icon: "⚠️", label: "Нужна работа", val: filtered.filter(s => s.weakCategories.length > 0).length },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 text-center">
                <p className="text-xl mb-0.5">{s.icon}</p>
                <p className="font-black text-slate-800">{s.val}</p>
                <p className="text-[10px] text-slate-400">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            {filtered.map((s, i) => {
              const lvl = LEVEL_CFG[s.level] ?? LEVEL_CFG.trainee;
              return (
                <button key={s.name}
                  onClick={() => setSelectedInstaller(s)}
                  className="w-full bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-4 hover:shadow-md hover:border-indigo-200 transition-all active:scale-99 text-left">
                  {/* Rank */}
                  <div className="w-7 text-center flex-shrink-0">
                    {i === 0 ? <span className="text-lg">🥇</span> : i === 1 ? <span className="text-lg">🥈</span> : i === 2 ? <span className="text-lg">🥉</span> :
                      <span className="text-xs font-black text-slate-400">#{i + 1}</span>}
                  </div>
                  {/* Level badge */}
                  <div className={`w-10 h-10 rounded-xl ${lvl.bg} flex items-center justify-center text-xl flex-shrink-0`}>
                    {lvl.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-800 truncate">{s.name}</p>
                      {s.weakCategories.length > 0 && (
                        <span className="flex-shrink-0 w-4 h-4 bg-red-100 rounded-full flex items-center justify-center">
                          <AlertTriangle size={9} className="text-red-500" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">{lvl.label} · {s.totalTests} тестов · {s.passRate}% сдано</p>
                    {/* Mini progress */}
                    <div className="w-full bg-slate-100 rounded-full h-1 mt-1.5">
                      <div className={`h-1 rounded-full ${s.avgPct >= 70 ? "bg-emerald-500" : "bg-amber-400"}`}
                        style={{ width: `${s.avgPct}%` }} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-lg font-black ${s.avgPct >= 70 ? "text-emerald-600" : "text-amber-500"}`}>
                      {s.avgPct}%
                    </p>
                  </div>
                  <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// RESULT DETAIL — full question breakdown with question texts
// ══════════════════════════════════════════════════════════════════════════════
function ResultDetailView({ result: r, testTitle, onBack }: {
  result: TestResult;
  testTitle: string;
  onBack: () => void;
}) {
  const [testFull, setTestFull] = useState<TestFull | null>(null);
  const [loadingTest, setLoadingTest] = useState(false);

  useEffect(() => {
    if (!r.testId) return;
    setLoadingTest(true);
    fetch(`${API}/training/tests/${r.testId}`, { headers: AH })
      .then(res => res.json())
      .then(data => { if (data.test) setTestFull(data.test); })
      .catch(() => {})
      .finally(() => setLoadingTest(false));
  }, [r.testId]);

  const qResults = r.questionResults ?? [];
  const correct = qResults.filter(q => q.correct).length;
  const incorrect = qResults.filter(q => !q.correct).length;

  // Build lookup: questionId -> Question
  const qMap = new Map<string, Question>();
  if (testFull?.questions) {
    for (const q of testFull.questions) qMap.set(q.id, q);
  }

  return (
    <div className="flex flex-col h-full">
      <div className={`text-white px-5 pt-5 pb-4 flex-shrink-0 ${
        r.passed ? "bg-gradient-to-br from-emerald-800 to-teal-800" : "bg-gradient-to-br from-red-800 to-orange-800"
      }`}>
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm mb-3 transition-colors">
          <ArrowLeft size={16} /> Назад к монтажнику
        </button>
        <p className="font-black text-xl">{r.installerName}</p>
        <p className="text-white/70 text-sm mb-3">{testTitle}</p>
        <div className="grid grid-cols-4 gap-2">
          {[
            { l: "Результат", v: `${r.percentage}%` },
            { l: "Верно",     v: correct },
            { l: "Ошибок",    v: incorrect },
            { l: "Время",     v: fmtDur(r.durationSeconds) },
          ].map(s => (
            <div key={s.l} className="bg-white/15 rounded-xl p-2 text-center">
              <p className="font-black text-sm">{s.v}</p>
              <p className="text-[10px] text-white/60">{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {/* Summary */}
        <div className={`rounded-2xl p-3.5 flex items-center gap-3 ${
          r.passed ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"
        }`}>
          <span className="text-2xl">{r.passed ? "✅" : "❌"}</span>
          <div className="flex-1">
            <p className={`font-black text-sm ${r.passed ? "text-emerald-800" : "text-red-800"}`}>
              {r.passed ? "Тест сдан" : "Тест не сдан"}
            </p>
            <p className={`text-xs ${r.passed ? "text-emerald-600" : "text-red-600"}`}>
              {r.score} из {r.maxScore} баллов · {fmtDate(r.completedAt)}
            </p>
          </div>
          {!r.passed && incorrect > 0 && (
            <div className="bg-red-100 rounded-xl px-2.5 py-1.5 text-center">
              <p className="text-sm font-black text-red-700">{incorrect}</p>
              <p className="text-[10px] text-red-500">ошибок</p>
            </div>
          )}
        </div>

        {loadingTest && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 size={12} className="animate-spin" /> Загрузка вопросов теста…
          </div>
        )}

        {qResults.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <BookOpen size={32} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm">Детальная разбивка по вопросам недоступна</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
              Разбор по вопросам ({qResults.length})
            </p>

            {/* Incorrect questions first */}
            {incorrect > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-3">
                <p className="text-xs font-bold text-red-700 mb-1 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> Ошибки — {incorrect} вопросов
                </p>
                <p className="text-[11px] text-red-600">
                  Монтажнику нужно проработать эти темы
                </p>
              </div>
            )}

            {qResults.map((qr, i) => {
              const fullQ = qMap.get(qr.questionId);
              const qDiff = fullQ ? Q_DIFF_OPTS.find(d => d.value === fullQ.difficulty) ?? Q_DIFF_OPTS[0] : null;
              return (
                <div key={qr.questionId}
                  className={`bg-white rounded-2xl border-2 shadow-sm overflow-hidden ${
                    qr.correct ? "border-emerald-200" : "border-red-300"
                  }`}>
                  {/* Question header */}
                  <div className={`flex items-center gap-2.5 px-4 py-2.5 ${
                    qr.correct ? "bg-emerald-50" : "bg-red-50"
                  }`}>
                    <span className="text-base">{qr.correct ? "✅" : "❌"}</span>
                    <div className="flex-1">
                      <p className="text-xs font-bold text-slate-600">Вопрос {i + 1}</p>
                      {fullQ && (
                        <div className="flex gap-1.5 mt-0.5">
                          <span className="text-[10px] text-slate-400">{CAT_MAP[fullQ.category] ?? fullQ.category}</span>
                          {qDiff && (
                            <span className={`text-[10px] font-bold px-1.5 rounded ${qDiff.color}`}>{qDiff.label}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className={`text-sm font-black ${qr.correct ? "text-emerald-700" : "text-red-600"}`}>
                      {qr.pointsEarned}/{qr.maxPoints} б.
                    </span>
                  </div>

                  <div className="px-4 py-3 space-y-2.5">
                    {/* Question text */}
                    {fullQ ? (
                      <p className="text-sm font-semibold text-slate-800 leading-snug">{fullQ.text}</p>
                    ) : (
                      <p className="text-xs text-slate-400 italic">ID: {qr.questionId}</p>
                    )}

                    {/* Answer options */}
                    <div className="space-y-1.5">
                      {qr.selectedAnswers.length === 0 && (
                        <p className="text-xs text-slate-400 italic bg-slate-50 rounded-xl px-3 py-2">
                          ⚠️ Ответ не дан (пропущен)
                        </p>
                      )}
                      {fullQ ? (
                        /* Show all options with highlighting */
                        fullQ.options.map((opt, oi) => {
                          const isCorr = qr.correctAnswers.includes(oi);
                          const isSel  = qr.selectedAnswers.includes(oi);
                          if (!isCorr && !isSel) return null; // skip irrelevant options
                          return (
                            <div key={oi} className={`flex items-start gap-2 px-3 py-2 rounded-xl text-xs font-semibold ${
                              isCorr && isSel  ? "bg-emerald-50 text-emerald-800 border border-emerald-200" :
                              isCorr && !isSel ? "bg-emerald-50 text-emerald-600 border border-emerald-200 border-dashed" :
                              !isCorr && isSel ? "bg-red-50 text-red-700 border border-red-200" : ""
                            }`}>
                              <span className="flex-shrink-0 mt-0.5">
                                {isCorr && isSel ? "✅" : isCorr && !isSel ? "☑️" : "❌"}
                              </span>
                              <span className="flex-1">{opt}</span>
                              <span className="flex-shrink-0 text-[10px] font-bold opacity-70">
                                {isCorr && isSel ? "правильно ✓" : isCorr && !isSel ? "правильный (не выбран)" : "ошибка ✗"}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        /* Fallback: show indices */
                        <>
                          {qr.correctAnswers.map(ci => {
                            const wasSel = qr.selectedAnswers.includes(ci);
                            return (
                              <div key={`c-${ci}`}
                                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                                <Check size={11} className="flex-shrink-0" />
                                <span>Вариант #{ci + 1} (правильный)</span>
                                {wasSel && <span className="ml-auto text-[10px] font-bold">← выбран ✓</span>}
                              </div>
                            );
                          })}
                          {qr.selectedAnswers.filter(si => !qr.correctAnswers.includes(si)).map(si => (
                            <div key={`w-${si}`}
                              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-red-50 text-red-600 border border-red-200 text-xs font-semibold">
                              <X size={11} className="flex-shrink-0" />
                              <span>Вариант #{si + 1} (неверный выбор)</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>

                    {/* Explanation */}
                    {fullQ?.explanation && !qr.correct && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        <p className="text-xs text-amber-700 font-semibold">💡 Пояснение</p>
                        <p className="text-xs text-amber-600 mt-0.5 leading-relaxed">{fullQ.explanation}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CERT TAB — certification matrix
// ══════════════════════════════════════════════════════════════════════════════
function CertTab() {
  const CERT_YEAR = new Date().getFullYear();
  const [matrix, setMatrix] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/training/certification/${CERT_YEAR}`, { headers: AH });
        const data = await res.json();
        if (data.installers) setMatrix(data.installers);
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, []);

  const passed  = matrix.filter(e => e.certification.status === "passed").length;
  const pending = matrix.filter(e => e.certification.status === "pending").length;
  const failed  = matrix.filter(e => e.certification.status === "failed").length;

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-bold text-slate-800 text-lg">📋 Аттестация {CERT_YEAR}</p>
          <p className="text-xs text-slate-400">Ежегодная проверка квалификации монтажников</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-center">
          <p className="text-2xl font-black text-emerald-600">{passed}</p>
          <p className="text-xs text-emerald-600">✅ Прошли</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-center">
          <p className="text-2xl font-black text-amber-500">{pending}</p>
          <p className="text-xs text-amber-600">⏳ Ожидают</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-center">
          <p className="text-2xl font-black text-red-500">{failed}</p>
          <p className="text-xs text-red-600">❌ Не сдали</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-indigo-400" size={28} /></div>
      ) : matrix.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Award size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="font-semibold text-slate-600">Данных пока нет</p>
          <p className="text-sm mt-1">Монтажники должны пройти ежегодный тест аттестации</p>
        </div>
      ) : (
        <div className="space-y-2">
          {matrix.map((e, i) => {
            const lvl = LEVEL_CFG[e.level] ?? LEVEL_CFG.trainee;
            const status = e.certification.status;
            return (
              <div key={e.installerName}
                className={`bg-white rounded-2xl border shadow-sm px-4 py-3.5 flex items-center gap-3 ${
                  status === "passed" ? "border-emerald-200" :
                  status === "failed" ? "border-red-200" : "border-amber-200"
                }`}>
                <span className="text-slate-400 text-xs font-black w-6 flex-shrink-0">#{i + 1}</span>
                <div className={`w-9 h-9 rounded-xl ${lvl.bg} flex items-center justify-center text-lg flex-shrink-0`}>
                  {lvl.icon}
                </div>
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
  );
}
