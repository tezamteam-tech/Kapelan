import { useMemo, useState } from "react";
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Factory,
  FileText,
  MessageSquare,
  PackageCheck,
  Ruler,
  Send,
  WalletCards,
} from "lucide-react";
import {
  GLASS_UNITS,
  HARDWARE_TYPES,
  PROFILE_SYSTEMS,
  calculateWindowOfferLines,
  defaultWindowConstruct,
  describeWindowConstruct,
  normalizeWindowConstruct,
  renderWindowSvg,
  type WindowConstruct,
} from "../domain/windows";
import { useCurrency } from "./CurrencyContext";

const PIPELINE = [
  { title: "Заявка", text: "Источник, контакт, объект, тип изделия", icon: <MessageSquare size={18} /> },
  { title: "Замер", text: "Проемы, размеры, фото, ограничения монтажа", icon: <Ruler size={18} /> },
  { title: "КП", text: "Схема, профиль, стеклопакет, маржа, скидка", icon: <ClipboardList size={18} /> },
  { title: "Договор", text: "Спецификация, график оплат, подпись", icon: <FileText size={18} /> },
  { title: "Закупка", text: "Материалы, фурнитура, подоконники, отливы", icon: <PackageCheck size={18} /> },
  { title: "Производство", text: "Статусы изделий, готовность, рекламации", icon: <Factory size={18} /> },
  { title: "Монтаж", text: "Бригада, дата, чек-лист, фото, акт", icon: <CalendarDays size={18} /> },
  { title: "Оплаты", text: "Аванс, доплата, задолженность, прибыль", icon: <WalletCards size={18} /> },
];

const PLAYBOOK = [
  "Сначала фиксируем конструкцию и размеры, потом считаем цену. Это снижает ошибки в КП.",
  "Каждое изделие должно иметь схему, профиль, стеклопакет, фурнитуру и список доборов.",
  "КП должно показывать клиенту не только цену, но и понятную визуальную схему окна или балкона.",
  "После утверждения КП система должна замораживать версию спецификации и вести историю правок.",
  "Склад и закупки должны работать от BOM: профиль, стекло, фурнитура, подоконники, отливы, откосы, расходники.",
];

function money(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}

export function WindowBusinessAssistant() {
  const { currency } = useCurrency();
  const [construct, setConstruct] = useState<WindowConstruct>(() => defaultWindowConstruct(1));
  const normalized = normalizeWindowConstruct(construct);
  const lines = useMemo(() => calculateWindowOfferLines([normalized]), [normalized]);
  const total = lines.reduce((sum, line) => sum + line.qty * line.price, 0);

  function update(patch: Partial<WindowConstruct>) {
    setConstruct((prev) => normalizeWindowConstruct({ ...prev, ...patch }));
  }

  const assistantDraft = [
    `КП: ${describeWindowConstruct(normalized)}.`,
    `Ориентировочная сумма: ${money(total)} ${currency}.`,
    "Следующий шаг: проверить замер, зафиксировать комплектацию и сформировать документ со схемой.",
  ].join(" ");

  return (
    <div className="h-full overflow-auto bg-slate-50">
      <div className="mx-auto max-w-7xl p-4 lg:p-6 space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
              <Bot size={14} /> Оконный AI-центр
            </div>
            <h1 className="mt-3 text-2xl font-black text-slate-900">Продажи, замер и КП для оконного бизнеса</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Рабочий экран для менеджера: быстро собрать конструкцию, увидеть схему, получить состав КП и не потерять следующий шаг.
            </p>
          </div>
          <button
            onClick={() => navigator.clipboard?.writeText(assistantDraft)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
          >
            <Send size={16} /> Скопировать черновик КП
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          {PIPELINE.map((step) => (
            <div key={step.title} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">{step.icon}</div>
              <p className="text-sm font-black text-slate-900">{step.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{step.text}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-base font-black text-slate-900">Быстрый расчет изделия</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">Ширина, мм</span>
                <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" type="number" value={normalized.widthMm} onChange={(e) => update({ widthMm: Number(e.target.value) })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">Высота, мм</span>
                <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" type="number" value={normalized.heightMm} onChange={(e) => update({ heightMm: Number(e.target.value) })} />
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-xs font-bold text-slate-500">Профиль</span>
                <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={normalized.profileSystem} onChange={(e) => update({ profileSystem: e.target.value })}>
                  {PROFILE_SYSTEMS.map((p) => <option key={p.id}>{p.label}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">Стеклопакет</span>
                <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={normalized.glassUnit} onChange={(e) => update({ glassUnit: e.target.value })}>
                  {GLASS_UNITS.map((g) => <option key={g}>{g}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">Фурнитура</span>
                <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={normalized.hardwareType} onChange={(e) => update({ hardwareType: e.target.value })}>
                  {HARDWARE_TYPES.map((h) => <option key={h}>{h}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">Количество</span>
                <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" type="number" min={1} value={normalized.quantity} onChange={(e) => update({ quantity: Number(e.target.value) })} />
              </label>
              <label className="flex items-center gap-2 pt-6 text-sm font-bold text-slate-700">
                <input type="checkbox" checked={!!normalized.mosquitoNet} onChange={(e) => update({ mosquitoNet: e.target.checked })} />
                Москитка
              </label>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
              <div>
                <h2 className="text-base font-black text-slate-900">Схема</h2>
                <div
                  className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white p-3"
                  dangerouslySetInnerHTML={{ __html: renderWindowSvg(normalized, { width: 390, height: 230 }) }}
                />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900">Состав КП</h2>
                <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {lines.map((line, idx) => (
                    <div key={`${line.name}-${idx}`} className="grid grid-cols-[1fr_auto] gap-3 p-3 text-sm">
                      <div>
                        <p className="font-bold text-slate-800">{line.name}</p>
                        <p className="text-xs text-slate-500">{line.qty} {line.unit} x {money(line.price)} {currency}</p>
                      </div>
                      <p className="font-black text-slate-900">{money(line.qty * line.price)} {currency}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-lg bg-slate-900 p-4 text-white">
                  <p className="text-xs font-bold uppercase text-slate-300">Итого ориентировочно</p>
                  <p className="mt-1 text-2xl font-black">{money(total)} {currency}</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-base font-black text-slate-900">Что берем из лучших оконных систем</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-5">
            {PLAYBOOK.map((item) => (
              <div key={item} className="rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
                <CheckCircle2 size={16} className="mb-2 text-emerald-600" />
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
