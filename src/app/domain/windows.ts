export type WindowConstructionType =
  | "window"
  | "balcony_block"
  | "balcony_glazing"
  | "door"
  | "mosquito_net"
  | "balcony_finish";

export type WindowOpeningMode = "fixed" | "turn" | "tilt_turn" | "tilt" | "door" | "sliding";

export interface WindowSegment {
  id: string;
  kind: "fixed" | "sash" | "door" | "sliding";
  opening: WindowOpeningMode;
  widthRatio: number;
  handleSide?: "left" | "right";
}

export interface WindowConstruct {
  id: string;
  title: string;
  roomName?: string;
  locationLabel?: string;
  constructionType: WindowConstructionType;
  widthMm: number;
  heightMm: number;
  quantity: number;
  profileSystem: string;
  glassUnit: string;
  hardwareType: string;
  colorInside: string;
  colorOutside: string;
  lamination: "none" | "inside" | "outside" | "both";
  sillDepthMm?: number;
  dripCapDepthMm?: number;
  mosquitoNet?: boolean;
  slopes?: "none" | "pvc" | "plaster" | "sandwich";
  tinting?: string;
  notes?: string;
  segments: WindowSegment[];
}

export interface WindowOfferLine {
  line_type: "equipment" | "consumable" | "assembly" | "service" | "delivery" | "discount";
  name: string;
  qty: number;
  unit: string;
  price: number;
  window_construct_id?: string;
  planned_cost?: number;
  warehouse_item_id?: string;
}

export interface WindowBomRequirement {
  key: string;
  window_construct_id: string;
  name: string;
  category: "profile" | "glass" | "hardware" | "sill" | "drip_cap" | "mosquito_net" | "slopes" | "consumable" | "labor";
  qty: number;
  unit: string;
  planned_buy_price: number;
  planned_sell_price: number;
  source: "warehouse" | "supplier" | "mixed" | "manual";
}

export interface WindowOrderEconomics {
  revenue: number;
  materialCost: number;
  laborCost: number;
  supplierCost: number;
  overheadCost: number;
  grossProfit: number;
  grossMarginPct: number;
  requirements: WindowBomRequirement[];
}

export const PROFILE_SYSTEMS = [
  { id: "brusbox-60-sp24", label: "Brusbox 60-3 СП24", baseM2: 135 },
  { id: "brusbox-60-sp32", label: "Brusbox 60-3 СП32", baseM2: 150 },
  { id: "brusbox-70b-sp32", label: "Brusbox 70-5 B СП32", baseM2: 175 },
  { id: "brusbox-70a-sp40", label: "Brusbox 70-6 A СП40", baseM2: 215 },
  { id: "rehau-blitz-60-sp32", label: "Rehau Blitz 60 СП32", baseM2: 205 },
  { id: "rehau-grazio-70-sp40", label: "Rehau Grazio 70 СП40", baseM2: 255 },
];

export const GLASS_UNITS = ["СП24", "СП32", "СП40"];
export const HARDWARE_TYPES = ["Futuruss", "Roto", "Maco", "Forwin"];

const WORK_RATES = {
  installationWindow: 48,
  installationBalcony: 72,
  slopesPvc: 12,
  slopesOther: 16,
};

const MATERIAL_COST = {
  profilePerM: 9.5,
  glassPerM2: 38,
  hardwareFixed: 28,
  sillPerM: 13,
  dripCapPerM: 8,
  mosquitoNet: 20,
  foamPerConstruct: 9,
  anchorsPerConstruct: 5,
};

export function defaultWindowConstruct(idx = 1): WindowConstruct {
  return {
    id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: `Конструкция ${idx}`,
    roomName: "",
    locationLabel: "",
    constructionType: "window",
    widthMm: 1400,
    heightMm: 1300,
    quantity: 1,
    profileSystem: PROFILE_SYSTEMS[1].label,
    glassUnit: "СП32",
    hardwareType: "Futuruss",
    colorInside: "Белый",
    colorOutside: "Белый",
    lamination: "none",
    sillDepthMm: 250,
    dripCapDepthMm: 150,
    mosquitoNet: false,
    slopes: "none",
    tinting: "",
    notes: "",
    segments: [
      { id: "s1", kind: "fixed", opening: "fixed", widthRatio: 1 },
      { id: "s2", kind: "sash", opening: "tilt_turn", widthRatio: 1, handleSide: "right" },
    ],
  };
}

export function normalizeWindowConstruct(raw: Partial<WindowConstruct>, idx = 1): WindowConstruct {
  const d = defaultWindowConstruct(idx);
  const next = { ...d, ...raw };
  next.widthMm = Math.max(100, Number(next.widthMm) || d.widthMm);
  next.heightMm = Math.max(100, Number(next.heightMm) || d.heightMm);
  next.quantity = Math.max(1, Math.ceil(Number(next.quantity) || 1));
  next.segments = Array.isArray(next.segments) && next.segments.length ? next.segments : d.segments;
  return next;
}

export function windowAreaM2(w: Pick<WindowConstruct, "widthMm" | "heightMm">) {
  return Math.round(((Number(w.widthMm) || 0) * (Number(w.heightMm) || 0)) / 10000) / 100;
}

function profileBaseM2(profileSystem: string) {
  return PROFILE_SYSTEMS.find((p) => p.label === profileSystem || p.id === profileSystem)?.baseM2 ?? 165;
}

function openingLabel(mode: WindowOpeningMode) {
  const map: Record<WindowOpeningMode, string> = {
    fixed: "глухая",
    turn: "поворотная",
    tilt_turn: "поворотно-откидная",
    tilt: "откидная",
    door: "дверь",
    sliding: "раздвижная",
  };
  return map[mode] ?? mode;
}

export function describeWindowConstruct(w: WindowConstruct) {
  const segments = w.segments.map((s) => openingLabel(s.opening)).join(", ");
  const room = [w.roomName, w.locationLabel].filter(Boolean).join(" / ");
  return [
    w.title || "Конструкция",
    room ? `(${room})` : "",
    `${w.widthMm}x${w.heightMm} мм`,
    w.profileSystem,
    w.glassUnit,
    w.hardwareType,
    segments,
  ].filter(Boolean).join(" · ");
}

export function calculateWindowOfferLines(constructs: WindowConstruct[]): WindowOfferLine[] {
  const lines: WindowOfferLine[] = [];
  for (const raw of constructs) {
    const w = normalizeWindowConstruct(raw);
    const area = windowAreaM2(w);
    const sashCount = w.segments.filter((s) => s.kind !== "fixed" && s.opening !== "fixed").length;
    const base = Math.round(area * profileBaseM2(w.profileSystem));
    const glassAdd = w.glassUnit === "СП40" ? area * 32 : w.glassUnit === "СП32" ? area * 18 : 0;
    const hardwareAdd = sashCount * (w.hardwareType === "Roto" ? 95 : w.hardwareType === "Maco" ? 65 : 45);
    const laminationPct = w.lamination === "both" ? 0.24 : w.lamination === "inside" || w.lamination === "outside" ? 0.12 : 0;
    const productPrice = Math.round((base + glassAdd + hardwareAdd) * (1 + laminationPct));

    lines.push({
      line_type: "assembly",
      name: `Изделие: ${describeWindowConstruct(w)}`,
      qty: w.quantity,
      unit: "шт",
      price: productPrice,
      window_construct_id: w.id,
    });

    if (w.sillDepthMm) {
      lines.push({
        line_type: "consumable",
        name: `Подоконник ${w.sillDepthMm} мм для ${w.title}`,
        qty: Math.max(1, Math.ceil((w.widthMm / 1000) * w.quantity)),
        unit: "м.п.",
        price: 28,
        window_construct_id: w.id,
      });
    }
    if (w.dripCapDepthMm) {
      lines.push({
        line_type: "consumable",
        name: `Отлив ${w.dripCapDepthMm} мм для ${w.title}`,
        qty: Math.max(1, Math.ceil((w.widthMm / 1000) * w.quantity)),
        unit: "м.п.",
        price: 18,
        window_construct_id: w.id,
      });
    }
    if (w.mosquitoNet) {
      lines.push({
        line_type: "consumable",
        name: `Москитная сетка для ${w.title}`,
        qty: w.quantity,
        unit: "шт",
        price: 45,
        window_construct_id: w.id,
      });
    }
    if (w.slopes && w.slopes !== "none") {
      const perimeter = ((w.widthMm + w.heightMm * 2) / 1000) * w.quantity;
      lines.push({
        line_type: "service",
        name: `Монтаж откосов (${w.slopes}) для ${w.title}`,
        qty: Math.round(perimeter * 10) / 10,
        unit: "м.п.",
        price: w.slopes === "pvc" ? 22 : 28,
        window_construct_id: w.id,
      });
    }

    lines.push({
      line_type: "service",
      name: `Монтаж изделия ${w.title}`,
      qty: w.quantity,
      unit: "шт",
      price: w.constructionType === "balcony_glazing" ? 130 : 85,
      window_construct_id: w.id,
    });
  }
  return lines;
}

export function buildWindowBomRequirements(constructs: WindowConstruct[]): WindowBomRequirement[] {
  const requirements: WindowBomRequirement[] = [];
  for (const raw of constructs) {
    const w = normalizeWindowConstruct(raw);
    const area = windowAreaM2(w) * w.quantity;
    const widthM = (w.widthMm / 1000) * w.quantity;
    const heightM = (w.heightMm / 1000) * w.quantity;
    const perimeterM = Math.round((widthM * 2 + heightM * 2) * 10) / 10;
    const sashCount = w.segments.filter((s) => s.kind !== "fixed" && s.opening !== "fixed").length * w.quantity;

    requirements.push({
      key: `${w.id}:profile`,
      window_construct_id: w.id,
      name: `Профиль ${w.profileSystem}`,
      category: "profile",
      qty: perimeterM,
      unit: "м.п.",
      planned_buy_price: MATERIAL_COST.profilePerM,
      planned_sell_price: Math.round(MATERIAL_COST.profilePerM * 1.55),
      source: "supplier",
    });
    requirements.push({
      key: `${w.id}:glass`,
      window_construct_id: w.id,
      name: `Стеклопакет ${w.glassUnit}`,
      category: "glass",
      qty: Math.round(area * 10) / 10,
      unit: "м2",
      planned_buy_price: MATERIAL_COST.glassPerM2,
      planned_sell_price: Math.round(MATERIAL_COST.glassPerM2 * 1.45),
      source: "supplier",
    });
    if (sashCount > 0) {
      requirements.push({
        key: `${w.id}:hardware`,
        window_construct_id: w.id,
        name: `Фурнитура ${w.hardwareType}`,
        category: "hardware",
        qty: sashCount,
        unit: "компл.",
        planned_buy_price: MATERIAL_COST.hardwareFixed,
        planned_sell_price: Math.round(MATERIAL_COST.hardwareFixed * 1.8),
        source: "supplier",
      });
    }
    if (w.sillDepthMm) {
      requirements.push({
        key: `${w.id}:sill`,
        window_construct_id: w.id,
        name: `Подоконник ${w.sillDepthMm} мм`,
        category: "sill",
        qty: Math.max(1, Math.ceil(widthM)),
        unit: "м.п.",
        planned_buy_price: MATERIAL_COST.sillPerM,
        planned_sell_price: 28,
        source: "mixed",
      });
    }
    if (w.dripCapDepthMm) {
      requirements.push({
        key: `${w.id}:drip`,
        window_construct_id: w.id,
        name: `Отлив ${w.dripCapDepthMm} мм`,
        category: "drip_cap",
        qty: Math.max(1, Math.ceil(widthM)),
        unit: "м.п.",
        planned_buy_price: MATERIAL_COST.dripCapPerM,
        planned_sell_price: 18,
        source: "mixed",
      });
    }
    if (w.mosquitoNet) {
      requirements.push({
        key: `${w.id}:mosquito`,
        window_construct_id: w.id,
        name: "Москитная сетка",
        category: "mosquito_net",
        qty: w.quantity,
        unit: "шт",
        planned_buy_price: MATERIAL_COST.mosquitoNet,
        planned_sell_price: 45,
        source: "supplier",
      });
    }
    requirements.push({
      key: `${w.id}:foam`,
      window_construct_id: w.id,
      name: "Пена, крепеж, герметики",
      category: "consumable",
      qty: w.quantity,
      unit: "компл.",
      planned_buy_price: MATERIAL_COST.foamPerConstruct + MATERIAL_COST.anchorsPerConstruct,
      planned_sell_price: 32,
      source: "warehouse",
    });
    requirements.push({
      key: `${w.id}:labor`,
      window_construct_id: w.id,
      name: `Работы по монтажу ${w.title}`,
      category: "labor",
      qty: w.quantity,
      unit: "шт",
      planned_buy_price: w.constructionType === "balcony_glazing" ? WORK_RATES.installationBalcony : WORK_RATES.installationWindow,
      planned_sell_price: w.constructionType === "balcony_glazing" ? 130 : 85,
      source: "manual",
    });
  }
  return requirements;
}

export function calculateWindowEconomics(constructs: WindowConstruct[], offerLines?: WindowOfferLine[]): WindowOrderEconomics {
  const lines = offerLines?.length ? offerLines : calculateWindowOfferLines(constructs);
  const requirements = buildWindowBomRequirements(constructs);
  const revenue = Math.round(lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.price) || 0), 0));
  const materialCost = Math.round(requirements.filter((r) => r.category !== "labor").reduce((sum, r) => sum + r.qty * r.planned_buy_price, 0));
  const laborCost = Math.round(requirements.filter((r) => r.category === "labor").reduce((sum, r) => sum + r.qty * r.planned_buy_price, 0));
  const supplierCost = Math.round(requirements.filter((r) => r.source === "supplier" || r.source === "mixed").reduce((sum, r) => sum + r.qty * r.planned_buy_price, 0));
  const overheadCost = Math.round(revenue * 0.04);
  const grossProfit = Math.round(revenue - materialCost - laborCost - overheadCost);
  const grossMarginPct = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;
  return { revenue, materialCost, laborCost, supplierCost, overheadCost, grossProfit, grossMarginPct, requirements };
}

export function windowMeasurementVisionPrompt() {
  return `Верни только JSON без markdown. Найди на фото оконные/дверные/балконные конструкции и верни массив WindowConstruct.
Схема объекта:
{
  "constructs": [{
    "title": "Окно 1",
    "roomName": "Кухня",
    "constructionType": "window|door|balcony_block|balcony_glazing|balcony_finish",
    "widthMm": 1400,
    "heightMm": 1300,
    "quantity": 1,
    "profileSystem": "если указано, иначе пусто",
    "glassUnit": "СП24|СП32|СП40 или пусто",
    "hardwareType": "если указано, иначе пусто",
    "lamination": "none|inside|outside|both",
    "sillDepthMm": 250,
    "dripCapDepthMm": 150,
    "mosquitoNet": false,
    "slopes": "none|pvc|plaster|sandwich",
    "segments": [{
      "kind": "fixed|sash|door|sliding",
      "opening": "fixed|turn|tilt_turn|tilt|door|sliding",
      "widthRatio": 1,
      "handleSide": "left|right"
    }],
    "notes": "сомнения, повреждения, особенности монтажа"
  }],
  "confidence": 0-100,
  "warnings": ["что нужно перепроверить замерщику"]
}`;
}

export function renderWindowSvg(w: WindowConstruct, opts?: { width?: number; height?: number }) {
  const width = opts?.width ?? 360;
  const height = opts?.height ?? 210;
  const pad = 24;
  const frameW = width - pad * 2;
  const frameH = height - pad * 2 - 18;
  const totalRatio = w.segments.reduce((s, x) => s + Math.max(0.2, Number(x.widthRatio) || 1), 0);
  let x = pad;
  const parts = w.segments.map((seg) => {
    const sw = frameW * (Math.max(0.2, Number(seg.widthRatio) || 1) / totalRatio);
    const cx = x;
    x += sw;
    const marker =
      seg.opening === "tilt_turn"
        ? `<path d="M ${cx + 8} ${pad + 8} L ${cx + sw - 8} ${pad + frameH / 2} L ${cx + 8} ${pad + frameH - 8}" fill="none" stroke="#2563eb" stroke-width="2"/>`
        : seg.opening === "turn" || seg.opening === "door"
          ? `<path d="M ${cx + 8} ${pad + 8} L ${cx + sw - 8} ${pad + frameH / 2} L ${cx + 8} ${pad + frameH - 8}" fill="none" stroke="#2563eb" stroke-width="2"/>`
          : seg.opening === "sliding"
            ? `<path d="M ${cx + 12} ${pad + frameH / 2} H ${cx + sw - 22} M ${cx + sw - 34} ${pad + frameH / 2 - 10} L ${cx + sw - 20} ${pad + frameH / 2} L ${cx + sw - 34} ${pad + frameH / 2 + 10}" fill="none" stroke="#2563eb" stroke-width="2"/>`
            : "";
    const handle = seg.kind !== "fixed" ? `<rect x="${seg.handleSide === "left" ? cx + 8 : cx + sw - 12}" y="${pad + frameH / 2 - 12}" width="4" height="24" rx="2" fill="#0f172a"/>` : "";
    return `<rect x="${cx}" y="${pad}" width="${sw}" height="${frameH}" fill="#eff6ff" stroke="#0f172a" stroke-width="2"/>${marker}${handle}`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${w.title}">
  <rect x="${pad}" y="${pad}" width="${frameW}" height="${frameH}" fill="none" stroke="#0f172a" stroke-width="4"/>
  ${parts}
  <text x="${width / 2}" y="${height - 18}" text-anchor="middle" font-family="Arial" font-size="13" fill="#0f172a">${w.widthMm} x ${w.heightMm} мм</text>
  <text x="10" y="${pad + frameH / 2}" text-anchor="middle" font-family="Arial" font-size="12" fill="#475569" transform="rotate(-90 10 ${pad + frameH / 2})">${w.heightMm} мм</text>
</svg>`;
}
