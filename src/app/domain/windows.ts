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
