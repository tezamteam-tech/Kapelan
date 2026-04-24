import React, { useState, useEffect, useCallback, useRef } from "react";
import { projectId, publicAnonKey } from "../../../utils/supabase/info";
import {
  FileText, Plus, Trash2, Download, ChevronDown, ChevronUp,
  Building2, User, Settings, Clock, CheckCircle2, Loader2, X, AlertCircle
} from "lucide-react";
import { getJson } from "../lib/apiClient";

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
const AH = { Authorization: `Bearer ${publicAnonKey}` };
const JH = { ...AH, "Content-Type": "application/json" };

// ─── Types ────────────────────────────────────────────────────────────────────
interface CompanyEveris {
  name: string; unp: string; dirFull: string; dirShort: string;
  legalAddr: string; postalAddr: string; account: string; bank: string;
  bik: string; email: string; phone: string;
}
interface MatItem { name: string; unit: string; qty: number; price: number; vat: number; }
interface DocPackage {
  id: string; contractType: "invoice" | "full"; contractNumber: string;
  contractDate: string; clientName: string; clientType: string;
  grandTotal: number; contractUrl?: string; specUrl?: string; createdAt: string;
}

const DEFAULT_COMPANY: CompanyEveris = {
  name: 'ООО «Эвериз Сервис»', unp: '192812488',
  dirFull: 'Бурак Борис Михайлович', dirShort: 'Б.М. Бурак',
  legalAddr: '220053, г. Минск, ул. Орловская, д. 40а, пом. 6',
  postalAddr: '220125, г. Минск, ул. Ложинская, д. 4, пом. 36',
  account: 'BY29 MTBK 3012 0001 0933 0013 0402',
  bank: 'ЗАО «МТБанк»', bik: 'MTBKBY22',
  email: 'info@everis.by', phone: '+375 44 573 22 22',
};

const DEFAULT_MATERIALS: MatItem[] = [
  { name: 'Труба медная 6,35×0,76 (1/4\') мм', unit: 'м.п.', qty: 5, price: 8.28, vat: 20 },
  { name: 'Труба медная 12,7×0,81 (1/2\') мм', unit: 'м.п.', qty: 5, price: 18.60, vat: 20 },
  { name: 'Теплоизоляция K-flex 6×6 ST', unit: 'м.п.', qty: 6, price: 1.00, vat: 20 },
  { name: 'Теплоизоляция K-flex 6×12 ST', unit: 'м.п.', qty: 6, price: 1.25, vat: 20 },
  { name: 'Шланг дренажный d16мм', unit: 'м.п.', qty: 3, price: 1.87, vat: 20 },
  { name: 'Провод ПВС 4×1,5 (ГОСТ 7399-97)', unit: 'м.п.', qty: 6, price: 2.85, vat: 20 },
  { name: 'Кабель ВВГ-Пнг(А)-LS 3×1,5', unit: 'м.п.', qty: 10, price: 2.57, vat: 20 },
  { name: 'Кронштейн КС 450×500', unit: 'компл', qty: 1, price: 39.50, vat: 20 },
  { name: 'Комплект крепежа №1', unit: 'компл', qty: 1, price: 37.50, vat: 20 },
];

const fmtAmt = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = () => {
  const d = new Date();
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

// ─── Main Component ───────────────────────────────────────────────────────────
export function ContractPackageView() {
  const [tab, setTab] = useState<"new" | "history" | "company">("new");
  const [company, setCompany] = useState<CompanyEveris>(DEFAULT_COMPANY);
  const [packages, setPackages] = useState<DocPackage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [toast, setToast] = useState<{msg:string; ok:boolean}|null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({msg, ok}); setTimeout(() => setToast(null), 4500);
  };

  const loadCompany = useCallback(async () => {
    try {
      const d = await getJson<any>(`${API_BASE}/company-everis`, { ttlMs: 10 * 60_000, staleTtlMs: 60 * 60_000, swr: true });
      if (d.company) setCompany(d.company);
    } catch (e) { console.error("loadCompany:", e); }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const d = await getJson<any>(`${API_BASE}/documents/packages`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true });
      setPackages(d.packages || []);
    } catch (e) { console.error("loadHistory:", e); }
    finally { setLoadingHistory(false); }
  }, []);

  useEffect(() => { loadCompany(); }, []);
  useEffect(() => { if (tab === "history") loadHistory(); }, [tab]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Документы для клиента</h2>
          <p className="text-sm text-slate-500 mt-0.5">Формирование договоров и спецификаций по шаблонам Эвериз Сервис</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {([
          { key: "new",     label: "Новый пакет",  icon: <Plus size={14} /> },
          { key: "history", label: "История",      icon: <Clock size={14} /> },
          { key: "company", label: "Реквизиты",    icon: <Settings size={14} /> },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === t.key ? "bg-white shadow text-slate-800" : "text-slate-500 hover:text-slate-700"
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === "new"     && <NewPackageForm company={company} onDone={() => { setTab("history"); loadHistory(); showToast("Пакет документов успешно сформирован 📄"); }} />}
      {tab === "history" && <HistoryTab packages={packages} loading={loadingHistory} onRefresh={loadHistory} />}
      {tab === "company" && <CompanyTab company={company} onChange={setCompany} onSave={async (c) => {
        const r = await fetch(`${API_BASE}/company-everis`, { method: "POST", headers: JH, body: JSON.stringify(c) });
        if (r.ok) showToast("Реквизиты сохранены ✅"); else showToast("Ошибка сохранения", false);
      }} />}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-white text-sm font-semibold flex items-center gap-2 ${toast.ok ? "bg-green-600" : "bg-red-600"}`}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}{toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── New Package Form ─────────────────────────────────────────────────────────
function NewPackageForm({ company, onDone }: { company: CompanyEveris; onDone: () => void }) {
  // Contract meta
  const [contractType, setContractType] = useState<"invoice" | "full">("invoice");
  const [contractNumber, setContractNumber] = useState(`${new Date().getMonth()+1}/${String(new Date().getDate()).padStart(2,"0")}`);
  const [contractDate, setContractDate] = useState(fmtDate());
  const [city, setCity] = useState("Минск");
  const [withVat, setWithVat] = useState(false);

  // Individual client
  const [indName, setIndName] = useState("");
  const [indAddress, setIndAddress] = useState("");
  const [indIdCard, setIndIdCard] = useState("");
  const [indPhone, setIndPhone] = useState("");
  const [indEmail, setIndEmail] = useState("");

  // Organization client
  const [orgName, setOrgName] = useState("");
  const [orgUnp, setOrgUnp] = useState("");
  const [orgDirFull, setOrgDirFull] = useState("");
  const [orgDirBasis, setOrgDirBasis] = useState("Устава");
  const [orgLegalAddr, setOrgLegalAddr] = useState("");
  const [orgPostalAddr, setOrgPostalAddr] = useState("");
  const [orgAccount, setOrgAccount] = useState("");
  const [orgBank, setOrgBank] = useState("");
  const [orgBik, setOrgBik] = useState("");
  const [orgEmail, setOrgEmail] = useState("");

  // Object (full contract)
  const [objectDesc, setObjectDesc] = useState("");
  const [objectAddr, setObjectAddr] = useState("");

  // Equipment
  const [acModel, setAcModel] = useState("");
  const [acUnit, setAcUnit] = useState("комплект");
  const [acQty, setAcQty] = useState(1);
  const [acPrice, setAcPrice] = useState(0);
  const [acVat, setAcVat] = useState(20);

  // Materials
  const [materials, setMaterials] = useState<MatItem[]>(DEFAULT_MATERIALS);
  const [showMaterials, setShowMaterials] = useState(false);

  // Works
  const [worksDesc, setWorksDesc] = useState("Монтажные работы");
  const [worksUnit, setWorksUnit] = useState("комплект");
  const [worksQty, setWorksQty] = useState(1);
  const [worksPrice, setWorksPrice] = useState(0);
  const [worksVat, setWorksVat] = useState(20);

  // Payment
  const [advanceAmt, setAdvanceAmt] = useState(0);
  const [stage1Amt, setStage1Amt] = useState(0);
  const [stage2Amt, setStage2Amt] = useState(0);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  // Computed totals
  const acTotal = acPrice * acQty;
  const matTotal = materials.reduce((s, m) => s + m.price * m.qty, 0);
  const worksTotal = worksPrice * worksQty;
  const grandTotal = acTotal + matTotal + worksTotal;

  // Auto-fill advance = equipment + materials
  useEffect(() => {
    setAdvanceAmt(+(acTotal + matTotal).toFixed(2));
  }, [acTotal, matTotal]);

  // Auto-fill stage2 = works - stage1
  useEffect(() => {
    setStage2Amt(+(worksTotal - stage1Amt).toFixed(2));
  }, [worksTotal, stage1Amt]);

  const addMaterial = () => setMaterials(p => [...p, { name: "", unit: "м.п.", qty: 1, price: 0, vat: 20 }]);
  const removeMaterial = (i: number) => setMaterials(p => p.filter((_, j) => j !== i));
  const updateMaterial = (i: number, f: Partial<MatItem>) => setMaterials(p => p.map((m, j) => j === i ? { ...m, ...f } : m));

  const generate = async () => {
    if (!contractNumber.trim()) { setError("Укажите номер договора"); return; }
    if (!acModel.trim()) { setError("Укажите модель кондиционера"); return; }
    const clientName = contractType === "invoice" ? indName : orgName;
    if (!clientName.trim()) { setError("Укажите данные заказчика"); return; }
    setError(""); setGenerating(true);
    try {
      const payload = {
        contractType, contractNumber: contractNumber.trim(), contractDate, city,
        co: company,
        clientType: contractType === "invoice" ? "individual" : "org",
        ind: { name: indName, address: indAddress, idCard: indIdCard, phone: indPhone, email: indEmail },
        org: { name: orgName, unp: orgUnp, dirFull: orgDirFull, dirShort: orgDirFull, dirBasis: orgDirBasis, legalAddr: orgLegalAddr, postalAddr: orgPostalAddr, account: orgAccount, bank: orgBank, bik: orgBik, email: orgEmail },
        objectDesc, objectAddr,
        acModel: acModel.trim(), acUnit, acQty, acPrice, acVat,
        materials, worksDesc, worksUnit, worksQty, worksPrice, worksVat,
        withVat, advanceAmt, stage1Amt, stage2Amt,
      };
      const r = await fetch(`${API_BASE}/documents/generate-package`, { method: "POST", headers: JH, body: JSON.stringify(payload) });
      const data = await r.json();
      if (data.package) { onDone(); }
      else { setError(data.error || "Ошибка генерации"); }
    } catch (e: any) {
      console.error("generate-package:", e);
      setError(`Ошибка соединения: ${e.message}`);
    } finally { setGenerating(false); }
  };

  const SectionTitle = ({ n, title }: { n: string; title: string }) => (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-7 h-7 rounded-lg bg-blue-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0">{n}</div>
      <h3 className="font-bold text-slate-800">{title}</h3>
    </div>
  );

  const Field = ({ label, children, span2 = false }: { label: string; children: React.ReactNode; span2?: boolean }) => (
    <div className={span2 ? "col-span-2" : ""}>
      <label className="block text-xs font-semibold text-slate-500 mb-1.5">{label}</label>
      {children}
    </div>
  );

  const inp = "w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white";
  const numInp = `${inp} text-right`;

  return (
    <div className="space-y-4">
      {/* Step 1: Contract type */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <SectionTitle n="1" title="Тип документа" />
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: "invoice", label: "Договор-счёт", sub: "для физических лиц", icon: <User size={20} /> },
            { key: "full",    label: "Договор монтажа", sub: "для юридических лиц", icon: <Building2 size={20} /> },
          ].map(t => (
            <button key={t.key} onClick={() => setContractType(t.key as "invoice" | "full")}
              className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                contractType === t.key
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}>
              <div className={`flex-shrink-0 ${contractType === t.key ? "text-blue-600" : "text-slate-400"}`}>{t.icon}</div>
              <div>
                <p className={`text-sm font-bold ${contractType === t.key ? "text-blue-800" : "text-slate-700"}`}>{t.label}</p>
                <p className="text-xs text-slate-500">{t.sub}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <Field label="Номер договора">
            <input className={inp} value={contractNumber} onChange={e => setContractNumber(e.target.value)} placeholder="17/03" />
          </Field>
          <Field label="Дата">
            <input className={inp} value={contractDate} onChange={e => setContractDate(e.target.value)} placeholder="17 марта 2025" />
          </Field>
          <Field label="Город">
            <input className={inp} value={city} onChange={e => setCity(e.target.value)} placeholder="Минск" />
          </Field>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => setWithVat(!withVat)}
            className={`w-10 h-5 rounded-full transition-all relative ${withVat ? "bg-blue-600" : "bg-slate-300"}`}>
            <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-all ${withVat ? "left-5" : "left-0.5"}`} />
          </button>
          <span className="text-sm text-slate-600">С НДС (20%) {withVat ? "— Плательщик НДС" : "— УСН без НДС"}</span>
        </div>
      </div>

      {/* Step 2: Client */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <SectionTitle n="2" title={contractType === "invoice" ? "Заказчик (физическое лицо)" : "Заказчик (юридическое лицо)"} />

        {contractType === "invoice" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Фамилия Имя Отчество" span2><input className={inp} value={indName} onChange={e => setIndName(e.target.value)} placeholder="Черепанов Александр Николаевич" /></Field>
            <Field label="Адрес регистрации" span2><input className={inp} value={indAddress} onChange={e => setIndAddress(e.target.value)} placeholder="г. Минск, ул. М.Горецкого, д. 25, кв. 58" /></Field>
            <Field label="ID-карта"><input className={inp} value={indIdCard} onChange={e => setIndIdCard(e.target.value)} placeholder="BY0752894, выдана 26.07.2022г., код 709" /></Field>
            <Field label="Телефон"><input className={inp} value={indPhone} onChange={e => setIndPhone(e.target.value)} placeholder="+375 29 688 39 29" /></Field>
            <Field label="E-mail" span2><input className={inp} value={indEmail} onChange={e => setIndEmail(e.target.value)} placeholder="client@gmail.com" /></Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Название организации" span2><input className={inp} value={orgName} onChange={e => setOrgName(e.target.value)} placeholder='ООО «Амизбел»' /></Field>
            <Field label="УНП"><input className={inp} value={orgUnp} onChange={e => setOrgUnp(e.target.value)} placeholder="691833071" /></Field>
            <Field label="ФИО директора"><input className={inp} value={orgDirFull} onChange={e => setOrgDirFull(e.target.value)} placeholder="Дубкова Светлана Александровна" /></Field>
            <Field label="Директор действует на основании"><input className={inp} value={orgDirBasis} onChange={e => setOrgDirBasis(e.target.value)} placeholder="Устава" /></Field>
            <Field label="Юридический адрес" span2><input className={inp} value={orgLegalAddr} onChange={e => setOrgLegalAddr(e.target.value)} placeholder="223043, Минская область, Минский район..." /></Field>
            <Field label="Почтовый адрес" span2><input className={inp} value={orgPostalAddr} onChange={e => setOrgPostalAddr(e.target.value)} placeholder="(если отличается от юридического)" /></Field>
            <Field label="Расчётный счёт"><input className={inp} value={orgAccount} onChange={e => setOrgAccount(e.target.value)} placeholder="BY02BLNB30120000111100000933" /></Field>
            <Field label="БИК"><input className={inp} value={orgBik} onChange={e => setOrgBik(e.target.value)} placeholder="BLNBBY2X" /></Field>
            <Field label="Банк" span2><input className={inp} value={orgBank} onChange={e => setOrgBank(e.target.value)} placeholder='ОАО «БНБ-Банк»' /></Field>
            <Field label="E-mail" span2><input className={inp} value={orgEmail} onChange={e => setOrgEmail(e.target.value)} placeholder="client@company.by" /></Field>
          </div>
        )}

        {contractType === "full" && (
          <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-100">
            <p className="col-span-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Объект монтажа</p>
            <Field label="Описание объекта"><input className={inp} value={objectDesc} onChange={e => setObjectDesc(e.target.value)} placeholder='ресторан «Поедем-поедим»' /></Field>
            <Field label="Адрес объекта"><input className={inp} value={objectAddr} onChange={e => setObjectAddr(e.target.value)} placeholder="Минская область, Минский район..." /></Field>
          </div>
        )}
      </div>

      {/* Step 3: Equipment */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <SectionTitle n="3" title="Оборудование (сплит-система)" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Модель кондиционера" span2>
            <input className={inp} value={acModel} onChange={e => setAcModel(e.target.value)} placeholder="Lessar LS-HE09KDE2/LU-HE09KDE2" />
          </Field>
          <Field label="Единица">
            <input className={inp} value={acUnit} onChange={e => setAcUnit(e.target.value)} placeholder="комплект" />
          </Field>
          <Field label="Количество">
            <input className={numInp} type="number" min={1} value={acQty} onChange={e => setAcQty(+e.target.value)} />
          </Field>
          <Field label={`Цена ${withVat ? "без НДС" : ""}, BYN`}>
            <input className={numInp} type="number" step="0.01" min={0} value={acPrice || ""} onChange={e => setAcPrice(+e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Ставка НДС, %">
            <input className={numInp} type="number" min={0} max={20} value={acVat} onChange={e => setAcVat(+e.target.value)} disabled={!withVat} />
          </Field>
        </div>
        <div className="mt-3 bg-slate-50 rounded-xl p-3 text-sm text-slate-600">
          Сумма оборудования: <span className="font-bold text-slate-800">{fmtAmt(acTotal)} BYN</span>
          {withVat && <span className="ml-3 text-slate-400">+ НДС {fmtAmt(acTotal * acVat / 100)} = {fmtAmt(acTotal * (1 + acVat / 100))} BYN</span>}
        </div>
      </div>

      {/* Step 4: Materials */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-blue-600 text-white text-xs font-black flex items-center justify-center">4</div>
            <h3 className="font-bold text-slate-800">Материалы</h3>
            <span className="text-xs bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full">{materials.length} позиций · {fmtAmt(matTotal)} BYN</span>
          </div>
          <button onClick={() => setShowMaterials(!showMaterials)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors">
            {showMaterials ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showMaterials ? "Свернуть" : "Развернуть"}
          </button>
        </div>

        {showMaterials && (
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-1 text-[10px] font-bold text-slate-400 uppercase px-1">
              <div className="col-span-5">Наименование</div><div className="col-span-1">Ед.</div>
              <div className="col-span-2 text-right">Кол-во</div><div className="col-span-2 text-right">Цена</div>
              <div className="col-span-1 text-right">НДС%</div><div className="col-span-1" />
            </div>
            {materials.map((m, i) => (
              <div key={i} className="grid grid-cols-12 gap-1 items-center">
                <input className={`${inp} col-span-5 text-xs`} value={m.name} onChange={e => updateMaterial(i, { name: e.target.value })} placeholder="Наименование" />
                <input className={`${inp} col-span-1 text-xs`} value={m.unit} onChange={e => updateMaterial(i, { unit: e.target.value })} />
                <input className={`${numInp} col-span-2 text-xs`} type="number" step="0.01" value={m.qty} onChange={e => updateMaterial(i, { qty: +e.target.value })} />
                <input className={`${numInp} col-span-2 text-xs`} type="number" step="0.01" value={m.price} onChange={e => updateMaterial(i, { price: +e.target.value })} />
                <input className={`${numInp} col-span-1 text-xs`} type="number" value={m.vat} onChange={e => updateMaterial(i, { vat: +e.target.value })} disabled={!withVat} />
                <button onClick={() => removeMaterial(i)} className="col-span-1 flex items-center justify-center text-slate-300 hover:text-red-400 transition-colors">
                  <X size={14} />
                </button>
              </div>
            ))}
            <button onClick={addMaterial}
              className="w-full border-2 border-dashed border-slate-200 hover:border-blue-300 text-slate-400 hover:text-blue-600 rounded-xl py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all">
              <Plus size={13} />Добавить позицию
            </button>
          </div>
        )}
      </div>

      {/* Step 5: Works */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <SectionTitle n="5" title="Монтажные работы" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Описание работ" span2>
            <input className={inp} value={worksDesc} onChange={e => setWorksDesc(e.target.value)} placeholder="Монтажные работы" />
          </Field>
          <Field label="Единица">
            <input className={inp} value={worksUnit} onChange={e => setWorksUnit(e.target.value)} placeholder="комплект" />
          </Field>
          <Field label="Количество">
            <input className={numInp} type="number" min={1} value={worksQty} onChange={e => setWorksQty(+e.target.value)} />
          </Field>
          <Field label={`Стоимость работ ${withVat ? "без НДС" : ""}, BYN`}>
            <input className={numInp} type="number" step="0.01" min={0} value={worksPrice || ""} onChange={e => setWorksPrice(+e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Ставка НДС, %">
            <input className={numInp} type="number" min={0} value={worksVat} onChange={e => setWorksVat(+e.target.value)} disabled={!withVat} />
          </Field>
        </div>
      </div>

      {/* Step 6: Payment (only for invoice type) */}
      {contractType === "invoice" && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <SectionTitle n="6" title="Условия оплаты" />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Аванс (оборудование + материалы), BYN">
              <input className={numInp} type="number" step="0.01" value={advanceAmt || ""} onChange={e => setAdvanceAmt(+e.target.value)} placeholder="0.00" />
              <p className="text-[10px] text-slate-400 mt-0.5">Авто: {fmtAmt(acTotal + matTotal)}</p>
            </Field>
            <Field label="1-й этап работ (после инж. коммуникаций), BYN">
              <input className={numInp} type="number" step="0.01" value={stage1Amt || ""} onChange={e => setStage1Amt(+e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="2-й этап работ (после монтажа), BYN">
              <input className={numInp} type="number" step="0.01" value={stage2Amt || ""} onChange={e => setStage2Amt(+e.target.value)} placeholder="0.00" />
            </Field>
          </div>
        </div>
      )}

      {/* Totals summary */}
      <div className="bg-slate-800 rounded-2xl p-5 text-white">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Итог по договору</p>
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Оборудование", val: acTotal },
            { label: "Материалы", val: matTotal },
            { label: "Работы", val: worksTotal },
            { label: "ИТОГО", val: grandTotal, big: true },
          ].map(row => (
            <div key={row.label} className={`rounded-xl p-3 text-center ${row.big ? "bg-blue-600" : "bg-slate-700"}`}>
              <p className={`text-[10px] font-medium mb-1 ${row.big ? "text-blue-200" : "text-slate-400"}`}>{row.label}</p>
              <p className={`font-black ${row.big ? "text-lg text-white" : "text-sm text-white"}`}>{fmtAmt(row.val)}</p>
              <p className={`text-[9px] ${row.big ? "text-blue-200" : "text-slate-500"}`}>BYN</p>
            </div>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2 text-sm text-red-700">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {/* Generate */}
      <button onClick={generate} disabled={generating}
        className="w-full bg-gradient-to-r from-blue-700 to-blue-500 text-white rounded-2xl py-4 text-sm font-bold shadow-lg shadow-blue-200 disabled:opacity-60 active:scale-[0.99] transition-all flex items-center justify-center gap-2">
        {generating
          ? <><Loader2 className="animate-spin" size={18} />Генерация PDF и сохранение…</>
          : <><FileText size={18} />Сформировать пакет документов</>
        }
      </button>
      <p className="text-xs text-center text-slate-400">
        {contractType === "invoice" ? "📄 Договор-счёт" : "📋 Договор монтажа + 📊 Спецификация (Приложение №1)"}
        {" · "} PDF будет сохранён на 30 дней
      </p>
    </div>
  );
}

// ─── History Tab ─────────────────────────────────────────────────────────────
function HistoryTab({ packages, loading, onRefresh }: { packages: DocPackage[]; loading: boolean; onRefresh: () => void }) {
  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="animate-spin text-slate-300" size={32} />
    </div>
  );
  if (packages.length === 0) return (
    <div className="bg-white rounded-2xl border border-dashed border-slate-200 py-16 text-center">
      <FileText className="text-slate-200 mx-auto mb-3" size={48} />
      <p className="text-slate-500 font-semibold">История пуста</p>
      <p className="text-sm text-slate-400 mt-1">Сформируйте первый пакет документов</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-semibold text-slate-500">{packages.length} пакет(ов)</p>
        <button onClick={onRefresh} className="text-xs text-blue-600 font-semibold hover:underline">Обновить</button>
      </div>
      {packages.map(pkg => <PackageCard key={pkg.id} pkg={pkg} />)}
    </div>
  );
}

function PackageCard({ pkg }: { pkg: DocPackage }) {
  const [expanded, setExpanded] = useState(false);
  const typeLabel = pkg.contractType === "invoice" ? "Договор-счёт" : "Договор монтажа";
  const typeColor = pkg.contractType === "invoice" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700";
  const clientIcon = pkg.clientType === "individual" ? <User size={14} /> : <Building2 size={14} />;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-slate-50">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
          <FileText className="text-blue-500" size={18} />
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-slate-800">№ {pkg.contractNumber}</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeColor}`}>{typeLabel}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
            {clientIcon}<span className="truncate">{pkg.clientName}</span>
            <span>·</span><span>{pkg.contractDate}</span>
            <span>·</span><span className="font-semibold text-slate-700">{fmtAmt(pkg.grandTotal)} BYN</span>
          </div>
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {pkg.contractUrl && (
              <a href={pkg.contractUrl} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 bg-blue-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-blue-700 transition-colors">
                <Download size={15} />
                {pkg.contractType === "invoice" ? "Договор-счёт" : "Договор монтажа"}
              </a>
            )}
            {pkg.specUrl && (
              <a href={pkg.specUrl} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 bg-teal-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-teal-700 transition-colors">
                <Download size={15} />Спецификация (Прил. №1)
              </a>
            )}
          </div>
          <p className="text-[10px] text-slate-400 text-center">
            📅 Создан {new Date(pkg.createdAt).toLocaleString("ru-RU", { day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit" })}
            {" · "}Ссылки действительны 30 дней
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Company Tab ─────────────────────────────────────────────────────────────
function CompanyTab({ company, onChange, onSave }: { company: CompanyEveris; onChange: (c: CompanyEveris) => void; onSave: (c: CompanyEveris) => void }) {
  const [saving, setSaving] = useState(false);
  const upd = (f: Partial<CompanyEveris>) => onChange({ ...company, ...f });
  const inp = "w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

  const save = async () => { setSaving(true); await onSave(company); setSaving(false); };

  const Field = ({ label, k, span2 = false }: { label: string; k: keyof CompanyEveris; span2?: boolean }) => (
    <div className={span2 ? "col-span-2" : ""}>
      <label className="block text-xs font-semibold text-slate-500 mb-1.5">{label}</label>
      <input className={inp} value={company[k]} onChange={e => upd({ [k]: e.target.value } as any)} />
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-800">Реквизиты Исполнителя (компании)</h3>
        <span className="text-xs text-slate-400">Подставляются во все документы</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Название компании" k="name" span2 />
        <Field label="УНП" k="unp" />
        <Field label="Телефон" k="phone" />
        <Field label="ФИО директора (полностью)" k="dirFull" span2 />
        <Field label="Инициалы директора (Б.М. Бурак)" k="dirShort" />
        <Field label="E-mail" k="email" />
        <Field label="Юридический адрес" k="legalAddr" span2 />
        <Field label="Почтовый адрес" k="postalAddr" span2 />
        <Field label="Расчётный счёт" k="account" span2 />
        <Field label="Банк" k="bank" />
        <Field label="БИК" k="bik" />
      </div>
      <button onClick={save} disabled={saving}
        className="w-full bg-slate-800 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-700 transition-colors">
        {saving ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
        {saving ? "Сохранение…" : "Сохранить реквизиты"}
      </button>
    </div>
  );
}
