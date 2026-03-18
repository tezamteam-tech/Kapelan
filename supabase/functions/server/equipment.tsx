// ─── EQUIPMENT CATALOG MODULE ─────────────────────────────────────────────────
// Manages AC splits, chillers, fan coils and their installation parameters + BOM
import * as kv from "./kv_store.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EquipmentType = "split_ac" | "chiller" | "fan_coil" | "vrv";

export interface BomEntry {
  warehouseId: string;
  name: string;
  unit: string;
  qtyFixed: number;      // always added
  qtyPerMeter: number;   // added per meter of trace/pipe length
  notes?: string;
}

export interface InstallParams {
  refrigerant: string;          // R32 | R410A | R407C | water | —
  liquidPipeOd?: string;        // 1/4" | 3/8" | 1/2"
  gasPipeOd?: string;           // 3/8" | 1/2" | 5/8"
  waterPipeOd?: string;         // 3/4" | 1" | 1.25" | 1.5"
  maxPipeLength: number;        // max refrigerant/water pipe length, m
  minPipeLength: number;        // min required pipe length, m
  maxHeightDiff: number;        // max height difference indoor↔outdoor, m
  refrigerantCharge: number;    // additional charge per meter over min, g/m (0 for water-cooled)
  startingCharge: number;       // factory charge, kg
  powerSupply: string;          // "220V/1F" | "380V/3F"
  currentA: number;             // max current, A
  drainType: "gravity" | "pump" | "both";
  toolsRequired: string[];      // list of required tools/equipment
  certRequired: boolean;        // requires refrigerant certification
}

export interface EquipmentModel {
  id: string;
  type: EquipmentType;
  brand: string;
  model: string;
  powerKw: number;
  btu?: number;
  areaMin?: number;
  areaMax?: number;
  imageUrl: string;
  installParams: InstallParams;
  bom: BomEntry[];
  installerNotes: string;
  price: number;
  warranty: number;
  warehouseItemId?: string;   // linked warehouse stock item if tracked as inventory
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── STD BOMs ─────────────────────────────────────────────────────────────────

const SPLIT_AC_BOM: BomEntry[] = [
  { warehouseId: "wh_pipe_14",    name: 'Медная труба 1/4" (жидкостная)',    unit: "м",     qtyFixed: 2, qtyPerMeter: 1, notes: "Жидкостная линия" },
  { warehouseId: "wh_pipe_38",    name: 'Медная труба 3/8" (газовая)',       unit: "м",     qtyFixed: 2, qtyPerMeter: 1, notes: "Газовая линия" },
  { warehouseId: "wh_insul_14",   name: 'Теплоизоляция 9мм',                unit: "м",     qtyFixed: 2, qtyPerMeter: 1 },
  { warehouseId: "wh_insul_38",   name: 'Теплоизоляция 13мм',               unit: "м",     qtyFixed: 2, qtyPerMeter: 1 },
  { warehouseId: "wh_drain_pipe", name: "Дренажная труба ø16мм",            unit: "м",     qtyFixed: 2, qtyPerMeter: 1 },
  { warehouseId: "wh_cable",      name: "Кабель питания 3×1.5мм²",          unit: "м",     qtyFixed: 3, qtyPerMeter: 1 },
  { warehouseId: "wh_cable_duct", name: "Кабельный канал 60×40",            unit: "м",     qtyFixed: 1, qtyPerMeter: 1 },
  { warehouseId: "wh_brackets",   name: "Кронштейны наружного блока",       unit: "компл", qtyFixed: 1, qtyPerMeter: 0 },
  { warehouseId: "wh_dowels",     name: "Дюбель-шуруп 6×60",               unit: "шт",    qtyFixed: 12, qtyPerMeter: 0 },
  { warehouseId: "wh_clamps",     name: "Хомуты для крепления труб",        unit: "шт",    qtyFixed: 4, qtyPerMeter: 2 },
  { warehouseId: "wh_freon",      name: "Фреон R32 (дозаправка)",           unit: "кг",    qtyFixed: 1, qtyPerMeter: 0, notes: "Буфер, расход зависит от длины трассы" },
  { warehouseId: "wh_sealant",    name: "Герметик силиконовый",             unit: "шт",    qtyFixed: 1, qtyPerMeter: 0 },
  { warehouseId: "wh_gland",      name: "Сальники кабельного ввода",        unit: "шт",    qtyFixed: 2, qtyPerMeter: 0 },
  { warehouseId: "wh_tape",       name: "Самовулканизирующаяся лента",      unit: "м",     qtyFixed: 2, qtyPerMeter: 0 },
];

const SPLIT_AC_BOM_LARGE: BomEntry[] = [
  { warehouseId: "wh_pipe_14",    name: 'Медная труба 1/4" (жидкостная)',    unit: "м",     qtyFixed: 2, qtyPerMeter: 1 },
  { warehouseId: "wh_pipe_12",    name: 'Медная труба 1/2" (газовая)',       unit: "м",     qtyFixed: 2, qtyPerMeter: 1, notes: "Для 24000 BTU газовая линия 1/2\"" },
  { warehouseId: "wh_insul_14",   name: 'Теплоизоляция 9мм',                unit: "м",     qtyFixed: 2, qtyPerMeter: 1 },
  { warehouseId: "wh_insul_38",   name: 'Теплоизоляция 13мм',               unit: "м",     qtyFixed: 2, qtyPerMeter: 1 },
  { warehouseId: "wh_drain_pipe", name: "Дренажная труба ø16мм",            unit: "м",     qtyFixed: 2, qtyPerMeter: 1 },
  { warehouseId: "wh_cable_25",   name: "Кабель питания 3×2.5мм²",          unit: "м",     qtyFixed: 3, qtyPerMeter: 1, notes: "Для 18-24k BTU используется 2.5мм²" },
  { warehouseId: "wh_cable_duct", name: "Кабельный канал 60×40",            unit: "м",     qtyFixed: 1, qtyPerMeter: 1 },
  { warehouseId: "wh_brackets",   name: "Кронштейны наружного блока",       unit: "компл", qtyFixed: 1, qtyPerMeter: 0 },
  { warehouseId: "wh_dowels",     name: "Дюбель-шуруп 6×60",               unit: "шт",    qtyFixed: 12, qtyPerMeter: 0 },
  { warehouseId: "wh_clamps",     name: "Хомуты для крепления труб",        unit: "шт",    qtyFixed: 4, qtyPerMeter: 2 },
  { warehouseId: "wh_freon",      name: "Фреон R32",                        unit: "кг",    qtyFixed: 1, qtyPerMeter: 0 },
  { warehouseId: "wh_sealant",    name: "Герметик силиконовый",             unit: "шт",    qtyFixed: 1, qtyPerMeter: 0 },
  { warehouseId: "wh_gland",      name: "Сальники кабельного ввода",        unit: "шт",    qtyFixed: 2, qtyPerMeter: 0 },
  { warehouseId: "wh_tape",       name: "Самовулканизирующаяся лента",      unit: "м",     qtyFixed: 2, qtyPerMeter: 0 },
];

const CHILLER_BOM: BomEntry[] = [
  { warehouseId: "wh_ppr_pipe_32", name: "Труба ППР 32мм (магистраль)",      unit: "м",     qtyFixed: 4,  qtyPerMeter: 1, notes: "Подающий+обратный контур" },
  { warehouseId: "wh_ppr_pipe_20", name: "Труба ППР 20мм (разводка)",        unit: "м",     qtyFixed: 4,  qtyPerMeter: 2 },
  { warehouseId: "wh_insul_19",    name: 'Теплоизоляция 19мм (чил.вода)',    unit: "м",     qtyFixed: 8,  qtyPerMeter: 2, notes: "Обязательна для предотвращения конденсата" },
  { warehouseId: "wh_ball_valve",  name: "Шаровой кран 3/4\"",               unit: "шт",    qtyFixed: 4,  qtyPerMeter: 0, notes: "На подаче и обратке каждого фанкойла" },
  { warehouseId: "wh_flex_conn",   name: "Гибкая подводка 3/4\" (пара)",     unit: "компл", qtyFixed: 2,  qtyPerMeter: 0 },
  { warehouseId: "wh_cable_25",    name: "Кабель питания 3×2.5мм²",          unit: "м",     qtyFixed: 5,  qtyPerMeter: 1 },
  { warehouseId: "wh_cable_duct",  name: "Кабельный канал 60×40",            unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  { warehouseId: "wh_dowels",      name: "Дюбель-шуруп 6×60",               unit: "шт",    qtyFixed: 20, qtyPerMeter: 0 },
  { warehouseId: "wh_clamps",      name: "Хомуты для крепления труб",        unit: "шт",    qtyFixed: 10, qtyPerMeter: 3 },
  { warehouseId: "wh_sealant",     name: "Герметик силиконовый",             unit: "шт",    qtyFixed: 2,  qtyPerMeter: 0 },
];

const FAN_COIL_BOM: BomEntry[] = [
  { warehouseId: "wh_ppr_pipe_20", name: "Труба ППР 20мм (подключение)",     unit: "м",     qtyFixed: 4,  qtyPerMeter: 1 },
  { warehouseId: "wh_insul_19",    name: 'Теплоизоляция 19мм (чил.вода)',    unit: "м",     qtyFixed: 4,  qtyPerMeter: 1 },
  { warehouseId: "wh_ball_valve",  name: "Шаровой кран 3/4\"",               unit: "шт",    qtyFixed: 2,  qtyPerMeter: 0, notes: "На подаче и обратке" },
  { warehouseId: "wh_flex_conn",   name: "Гибкая подводка 3/4\" (пара)",     unit: "компл", qtyFixed: 1,  qtyPerMeter: 0 },
  { warehouseId: "wh_motor_valve", name: "Моторизированный клапан 2-ход.",   unit: "шт",    qtyFixed: 1,  qtyPerMeter: 0 },
  { warehouseId: "wh_drain_pipe",  name: "Дренажная труба ø16мм",           unit: "м",     qtyFixed: 3,  qtyPerMeter: 0.5 },
  { warehouseId: "wh_cable",       name: "Кабель питания 3×1.5мм²",          unit: "м",     qtyFixed: 3,  qtyPerMeter: 1 },
  { warehouseId: "wh_cable_duct",  name: "Кабельный канал 60×40",            unit: "м",     qtyFixed: 2,  qtyPerMeter: 1 },
  { warehouseId: "wh_dowels",      name: "Дюбель-шуруп 6×60",               unit: "шт",    qtyFixed: 8,  qtyPerMeter: 0 },
  { warehouseId: "wh_sealant",     name: "Герметик силиконовый",             unit: "шт",    qtyFixed: 1,  qtyPerMeter: 0 },
];

// ─── Default Catalog ──────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

const DEFAULT_EQUIPMENT: EquipmentModel[] = [
  // ── SPLIT AC — Economy ───────────────────────────────────────────────────────
  {
    id: "eq_split_eco_07", type: "split_ac", brand: "Cooper&Hunter", model: "CH-S07FTXF2-NG Wi-Fi",
    powerKw: 2.1, btu: 7000, areaMin: 15, areaMax: 22,
    imageUrl: "https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?w=600",
    price: 15900, warranty: 3, active: true,
    installParams: {
      refrigerant: "R32", liquidPipeOd: '1/4"', gasPipeOd: '3/8"',
      maxPipeLength: 15, minPipeLength: 3, maxHeightDiff: 10,
      refrigerantCharge: 8, startingCharge: 0.62,
      powerSupply: "220V/1F", currentA: 6,
      drainType: "gravity",
      toolsRequired: ["Труборез", "Вальцовка", "Манометрная станция R32", "Вакуумный насос"],
      certRequired: false,
    },
    bom: SPLIT_AC_BOM,
    installerNotes: "Минимальный нахлёст бирж труб 2 см. Проверить клеммы управляющего кабеля 3-жильного.",
    createdAt: now(), updatedAt: now(),
  },
  {
    id: "eq_split_eco_09", type: "split_ac", brand: "Midea", model: "MSAFAU-09HRDN1",
    powerKw: 2.6, btu: 9000, areaMin: 22, areaMax: 30,
    imageUrl: "https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?w=600",
    price: 18500, warranty: 3, active: true,
    installParams: {
      refrigerant: "R32", liquidPipeOd: '1/4"', gasPipeOd: '3/8"',
      maxPipeLength: 20, minPipeLength: 3, maxHeightDiff: 12,
      refrigerantCharge: 8, startingCharge: 0.78,
      powerSupply: "220V/1F", currentA: 7,
      drainType: "gravity",
      toolsRequired: ["Труборез", "Вальцовка", "Манометрная станция R32", "Вакуумный насос"],
      certRequired: false,
    },
    bom: SPLIT_AC_BOM,
    installerNotes: "Заводская закладка фреона: 0.78 кг. Дозаправка: 8 г на каждый метр сверх 3 м.",
    createdAt: now(), updatedAt: now(),
  },
  {
    id: "eq_split_eco_12", type: "split_ac", brand: "Midea", model: "MSAFAU-12HRDN1",
    powerKw: 3.5, btu: 12000, areaMin: 30, areaMax: 40,
    imageUrl: "https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?w=600",
    price: 22000, warranty: 3, active: true,
    installParams: {
      refrigerant: "R32", liquidPipeOd: '1/4"', gasPipeOd: '3/8"',
      maxPipeLength: 20, minPipeLength: 3, maxHeightDiff: 12,
      refrigerantCharge: 8, startingCharge: 0.95,
      powerSupply: "220V/1F", currentA: 9,
      drainType: "gravity",
      toolsRequired: ["Труборез", "Вальцовка", "Манометрная станция R32", "Вакуумный насос"],
      certRequired: false,
    },
    bom: SPLIT_AC_BOM,
    installerNotes: "Кабель питания 3×1.5мм², автомат 16А. Внешний блок не менее 50 см от стен с двух сторон.",
    createdAt: now(), updatedAt: now(),
  },
  // ── SPLIT AC — Standard ─────────────────────────────────────────────────────
  {
    id: "eq_split_std_09", type: "split_ac", brand: "Samsung", model: "AR09TXHQASINUA WindFree",
    powerKw: 2.6, btu: 9000, areaMin: 22, areaMax: 30,
    imageUrl: "https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?w=600",
    price: 27000, warranty: 5, active: true,
    installParams: {
      refrigerant: "R32", liquidPipeOd: '1/4"', gasPipeOd: '3/8"',
      maxPipeLength: 25, minPipeLength: 3, maxHeightDiff: 15,
      refrigerantCharge: 8, startingCharge: 0.75,
      powerSupply: "220V/1F", currentA: 8,
      drainType: "gravity",
      toolsRequired: ["Труборез", "Вальцовка", "Манометрная станция R32", "Вакуумный насос", "Wi-Fi тест приложение Samsung"],
      certRequired: false,
    },
    bom: SPLIT_AC_BOM,
    installerNotes: "Режим WindFree — не закрывать жалюзи при первом запуске. Настройка Wi-Fi через SmartThings.",
    createdAt: now(), updatedAt: now(),
  },
  {
    id: "eq_split_std_12", type: "split_ac", brand: "Samsung", model: "AR12TXHQASINUA WindFree",
    powerKw: 3.5, btu: 12000, areaMin: 30, areaMax: 42,
    imageUrl: "https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?w=600",
    price: 31000, warranty: 5, active: true,
    installParams: {
      refrigerant: "R32", liquidPipeOd: '1/4"', gasPipeOd: '3/8"',
      maxPipeLength: 25, minPipeLength: 3, maxHeightDiff: 15,
      refrigerantCharge: 8, startingCharge: 0.95,
      powerSupply: "220V/1F", currentA: 10,
      drainType: "gravity",
      toolsRequired: ["Труборез", "Вальцовка", "Манометрная станция R32", "Вакуумный насос"],
      certRequired: false,
    },
    bom: SPLIT_AC_BOM,
    installerNotes: "Кабель 3×1.5мм², автомат 16А. Дозаправка: 8 г/м сверх 3 м.",
    createdAt: now(), updatedAt: now(),
  },
  {
    id: "eq_split_std_18", type: "split_ac", brand: "LG", model: "S18ET.NSKSUA Dual Inverter",
    powerKw: 5.0, btu: 18000, areaMin: 42, areaMax: 58,
    imageUrl: "https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?w=600",
    price: 43000, warranty: 5, active: true,
    installParams: {
      refrigerant: "R32", liquidPipeOd: '1/4"', gasPipeOd: '1/2"',
      maxPipeLength: 30, minPipeLength: 5, maxHeightDiff: 20,
      refrigerantCharge: 10, startingCharge: 1.1,
      powerSupply: "220V/1F", currentA: 14,
      drainType: "gravity",
      toolsRequired: ["Труборез", "Вальцовка ø1/2\"", "Манометрная станция R32", "Вакуумный насос"],
      certRequired: false,
    },
    bom: SPLIT_AC_BOM_LARGE,
    installerNotes: "Газовая линия — трубка 1/2\". Кабель питания 3×2.5мм², автомат 20А. Дозаправка: 10 г/м сверх 5 м.",
    createdAt: now(), updatedAt: now(),
  },
  {
    id: "eq_split_std_24", type: "split_ac", brand: "LG", model: "S24ET.NSKSUA Dual Inverter",
    powerKw: 7.0, btu: 24000, areaMin: 58, areaMax: 78,
    imageUrl: "https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?w=600",
    price: 57000, warranty: 5, active: true,
    installParams: {
      refrigerant: "R32", liquidPipeOd: '3/8"', gasPipeOd: '5/8"',
      maxPipeLength: 30, minPipeLength: 5, maxHeightDiff: 20,
      refrigerantCharge: 12, startingCharge: 1.4,
      powerSupply: "220V/1F", currentA: 18,
      drainType: "gravity",
      toolsRequired: ["Труборез", "Вальцовка ø5/8\"", "Манометрная станция R32", "Вакуумный насос"],
      certRequired: false,
    },
    bom: SPLIT_AC_BOM_LARGE,
    installerNotes: "Крупный внешний блок — требуется усиленный кронштейн. Автомат 25А. Газовая трасса 5/8\".",
    createdAt: now(), updatedAt: now(),
  },
  // ── SPLIT AC — Premium ──────────────────────────────────────────────────────
  {
    id: "eq_split_prm_12", type: "split_ac", brand: "Daikin", model: "FTXB35C/RXB35C Eco",
    powerKw: 3.4, btu: 12000, areaMin: 30, areaMax: 42,
    imageUrl: "https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?w=600",
    price: 54000, warranty: 7, active: true,
    installParams: {
      refrigerant: "R32", liquidPipeOd: '1/4"', gasPipeOd: '3/8"',
      maxPipeLength: 20, minPipeLength: 3, maxHeightDiff: 10,
      refrigerantCharge: 8, startingCharge: 0.88,
      powerSupply: "220V/1F", currentA: 10,
      drainType: "gravity",
      toolsRequired: ["Труборез", "Вальцовка Daikin", "Манометрная станция R32", "Вакуумный насос", "Азотная продувка"],
      certRequired: false,
    },
    bom: SPLIT_AC_BOM,
    installerNotes: "ВАЖНО: Daikin требует азотной продувки трассы перед зарядкой. Обязательно проверить герметичность 24 ч давлением азота 40 бар.",
    createdAt: now(), updatedAt: now(),
  },
  {
    id: "eq_split_prm_18", type: "split_ac", brand: "Mitsubishi Electric", model: "MSZ-LN50VG/MUZ-LN50VG",
    powerKw: 5.0, btu: 18000, areaMin: 42, areaMax: 58,
    imageUrl: "https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?w=600",
    price: 82000, warranty: 7, active: true,
    installParams: {
      refrigerant: "R32", liquidPipeOd: '1/4"', gasPipeOd: '1/2"',
      maxPipeLength: 25, minPipeLength: 5, maxHeightDiff: 15,
      refrigerantCharge: 10, startingCharge: 1.05,
      powerSupply: "220V/1F", currentA: 14,
      drainType: "gravity",
      toolsRequired: ["Труборез", "Вальцовка ø1/2\"", "Манометрная станция R32", "Вакуумный насос", "Азотная продувка"],
      certRequired: false,
    },
    bom: SPLIT_AC_BOM_LARGE,
    installerNotes: "Дизайнерский корпус — аккуратно снимать панели, не давить на пластик. Кабель управления 4-жильный. Газовая трасса 1/2\".",
    createdAt: now(), updatedAt: now(),
  },
  // ── CHILLER ─────────────────────────────────────────────────────────────────
  {
    id: "eq_chiller_30", type: "chiller", brand: "AERMEC", model: "NRL 030 (30 кВт)",
    powerKw: 30, btu: undefined, areaMin: 200, areaMax: 500,
    imageUrl: "https://images.unsplash.com/photo-1681259245495-7baf845f42dd?w=600",
    price: 380000, warranty: 5, active: true,
    installParams: {
      refrigerant: "R410A", waterPipeOd: '1.25"',
      maxPipeLength: 100, minPipeLength: 0, maxHeightDiff: 15,
      refrigerantCharge: 0, startingCharge: 4.2,
      powerSupply: "380V/3F", currentA: 55,
      drainType: "gravity",
      toolsRequired: ["Трубогиб ППР", "Паяльник ППР", "Манометрная станция R410A", "Мультиметр 3-ф", "Опрессовщик"],
      certRequired: true,
    },
    bom: CHILLER_BOM,
    installerNotes: "ОБЯЗАТЕЛЬНО: буферная ёмкость 50-100л, циркуляционный насос Grundfos, расширительный бак 18л, предохранительный клапан 3 бар. Опрессовка системы 6 бар на 24 ч. Фреон только сервисный инженер с допуском.",
    createdAt: now(), updatedAt: now(),
  },
  {
    id: "eq_chiller_60", type: "chiller", brand: "AERMEC", model: "NRL 060 (60 кВт)",
    powerKw: 60, btu: undefined, areaMin: 500, areaMax: 1200,
    imageUrl: "https://images.unsplash.com/photo-1681259245495-7baf845f42dd?w=600",
    price: 680000, warranty: 5, active: true,
    installParams: {
      refrigerant: "R410A", waterPipeOd: '2"',
      maxPipeLength: 150, minPipeLength: 0, maxHeightDiff: 20,
      refrigerantCharge: 0, startingCharge: 8.5,
      powerSupply: "380V/3F", currentA: 110,
      drainType: "gravity",
      toolsRequired: ["Трубогиб ППР", "Паяльник ППР", "Манометрная станция R410A", "Мультиметр 3-ф", "Опрессовщик"],
      certRequired: true,
    },
    bom: CHILLER_BOM,
    installerNotes: "Требуется 2 монтажника + бригадир. Труба магистральная 2\". Буферная ёмкость 200л. Автоматика — частотный привод насоса.",
    createdAt: now(), updatedAt: now(),
  },
  // ── FAN COIL ────────────────────────────────────────────────────────────────
  {
    id: "eq_fancoil_cassette_12", type: "fan_coil", brand: "Daikin", model: "FFQ35B (кассетный 12000 BTU)",
    powerKw: 3.5, btu: 12000, areaMin: 25, areaMax: 50,
    imageUrl: "https://images.unsplash.com/photo-1647202179310-bab5817b7c89?w=600",
    price: 28000, warranty: 5, active: true,
    installParams: {
      refrigerant: "water", waterPipeOd: '3/4"',
      maxPipeLength: 50, minPipeLength: 0, maxHeightDiff: 0,
      refrigerantCharge: 0, startingCharge: 0,
      powerSupply: "220V/1F", currentA: 2,
      drainType: "pump",
      toolsRequired: ["Паяльник ППР", "Уровень", "Перфоратор", "Опрессовщик"],
      certRequired: false,
    },
    bom: FAN_COIL_BOM,
    installerNotes: "Кассетный — монтируется в подвесной потолок. Минимальный зазор от потолка 250мм. Встроенный дренажный насос. Моторизированный клапан — обязателен для управления от чиллера.",
    createdAt: now(), updatedAt: now(),
  },
  {
    id: "eq_fancoil_floor_09", type: "fan_coil", brand: "Royal Clima", model: "RCFC-FKR-09 (напольный)",
    powerKw: 2.6, btu: 9000, areaMin: 18, areaMax: 35,
    imageUrl: "https://images.unsplash.com/photo-1647202179310-bab5817b7c89?w=600",
    price: 18000, warranty: 3, active: true,
    installParams: {
      refrigerant: "water", waterPipeOd: '3/4"',
      maxPipeLength: 50, minPipeLength: 0, maxHeightDiff: 0,
      refrigerantCharge: 0, startingCharge: 0,
      powerSupply: "220V/1F", currentA: 1.5,
      drainType: "gravity",
      toolsRequired: ["Паяльник ППР", "Уровень", "Гаечный ключ"],
      certRequired: false,
    },
    bom: FAN_COIL_BOM,
    installerNotes: "Напольный фанкойл — уклон дренажной трубы минимум 3 мм/м. Гравитационный дренаж. Подключение 3/4\" труба.",
    createdAt: now(), updatedAt: now(),
  },
];

// ─── KV helpers ───────────────────────────────────────────────────────────────

async function getAllEquipment(): Promise<EquipmentModel[]> {
  const vals = await kv.getByPrefix("kapelan_equip:") as string[];
  if (vals.length > 0) {
    return vals.map(v => { try { return JSON.parse(v); } catch { return null; } })
      .filter(Boolean)
      .sort((a: EquipmentModel, b: EquipmentModel) => a.type.localeCompare(b.type) || a.brand.localeCompare(b.brand));
  }
  // Seed defaults
  for (const eq of DEFAULT_EQUIPMENT) {
    await kv.set(`kapelan_equip:${eq.id}`, JSON.stringify(eq));
  }
  return DEFAULT_EQUIPMENT;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export function registerEquipmentRoutes(app: any): void {
  const P = "/make-server-1df47c03";

  // GET all equipment
  app.get(`${P}/equipment`, async (c: any) => {
    try {
      const equipment = await getAllEquipment();
      return c.json({ equipment });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // GET equipment by type
  app.get(`${P}/equipment/type/:type`, async (c: any) => {
    try {
      const all = await getAllEquipment();
      const filtered = all.filter(e => e.type === c.req.param("type") && e.active !== false);
      return c.json({ equipment: filtered });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // GET single equipment model
  app.get(`${P}/equipment/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_equip:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Модель не найдена" }, 404);
      return c.json({ equipment: JSON.parse(raw) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // POST create/update equipment model
  app.post(`${P}/equipment`, async (c: any) => {
    try {
      const body = await c.req.json();
      const id = body.id || `eq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const existing = body.id ? await kv.get(`kapelan_equip:${body.id}`) : null;
      const prev: EquipmentModel | null = existing ? JSON.parse(existing) : null;
      const eq: EquipmentModel = {
        ...(prev || {}),
        ...body,
        id,
        createdAt: prev?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        active: body.active !== undefined ? body.active : true,
      };
      await kv.set(`kapelan_equip:${id}`, JSON.stringify(eq));
      return c.json({ equipment: eq });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // PATCH update BOM
  app.patch(`${P}/equipment/:id/bom`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_equip:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Модель не найдена" }, 404);
      const eq: EquipmentModel = JSON.parse(raw);
      const { bom } = await c.req.json();
      eq.bom = bom;
      eq.updatedAt = new Date().toISOString();
      await kv.set(`kapelan_equip:${eq.id}`, JSON.stringify(eq));
      return c.json({ equipment: eq });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // PATCH update install params
  app.patch(`${P}/equipment/:id/params`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_equip:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Модель не найдена" }, 404);
      const eq: EquipmentModel = JSON.parse(raw);
      const { installParams } = await c.req.json();
      eq.installParams = { ...eq.installParams, ...installParams };
      eq.updatedAt = new Date().toISOString();
      await kv.set(`kapelan_equip:${eq.id}`, JSON.stringify(eq));
      return c.json({ equipment: eq });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // DELETE equipment model
  app.delete(`${P}/equipment/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_equip:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Не найдено" }, 404);
      const eq: EquipmentModel = JSON.parse(raw);
      eq.active = false;
      eq.updatedAt = new Date().toISOString();
      await kv.set(`kapelan_equip:${eq.id}`, JSON.stringify(eq));
      return c.json({ success: true });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });
}
