// Manages AC installation orders: catalog with BOM, order lifecycle,
// AI room analysis, warehouse consumable issuance.
import * as kv from "./kv_store.tsx";
import { getWarehouseItem, saveWarehouseItem, addMovement } from "./warehouse.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BomEntry {
  warehouseId: string;
  name: string;
  unit: string;
  qtyFixed: number;     // always added regardless of trace length
  qtyPerMeter: number;  // added per meter of copper trace
}

export interface AcModel {
  id: string;
  brand: string;
  model: string;
  btu: number;
  kw: number;
  areaMin: number;
  areaMax: number;
  refrigerant: string;
  tier: "economy" | "standard" | "premium";
  features: string[];
  price: number;
  warranty: number;
  bom: BomEntry[];
}

export type OrderStatus = "draft" | "confirmed" | "assigned" | "in_progress" | "paused" | "completed" | "cancelled";

export interface OrderConsumable {
  warehouseId: string;
  name: string;
  unit: string;
  qtyRequired: number;
  qtyIssued: number;
  stockSnapshot: number; // stock at order creation time
}

export interface InstallOrder {
  id: string;
  // Client
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  leadId?: string;
  // Room
  roomArea: number;
  roomType: string;
  traceLength: number;
  // AC
  acModelId: string;
  acBrand: string;
  acModelName: string;
  acBtu: number;
  acKw: number;
  acPrice: number;
  acCount: number;
  // Consumables
  consumables: OrderConsumable[];
  consumablesIssued: boolean;
  // Assignment
  installerName: string;
  scheduledDate: string;
  // AI analysis (optional)
  aiAnalysis?: {
    area: number;
    roomType: string;
    recommendedBtu: number;
    traceLength: number;
    notes: string;
    imageDescription: string;
  };
  // Meta
  status: OrderStatus;
  notes: string;
  source: "ai" | "manual";
  createdAt: string;
  updatedAt: string;
}

// ─── BOM variants — по типу трассы из таблицы кондиционеров ──────────────────
// qty = Math.ceil(qtyFixed + qtyPerMeter * traceLength)

// BOM для 7000-12000 BTU (труба 1/4" + 3/8", кабель 3x1,5, кронштейн 450x390, автомат 10А)
const BOM_09: BomEntry[] = [
  { warehouseId: "wh_pipe_14",        name: "Труба медная 6,35x0,76 мм (1/4\") жидкостная", unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_pipe_38",        name: "Труба медная 9,53 мм (3/8\") газовая",          unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_insul_14",       name: "Теплоизоляция K-flex 6x06 ST",                  unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_insul_38",       name: "Теплоизоляция K-flex 6x12 ST",                  unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_drain_pipe",     name: "Шланг дренажный гофрированный d16мм",           unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_cable_pvs",      name: "Провод ПВС 4x1,5 (межблочный, 5x1,5мм)",       unit: "м",     qtyFixed: 3,   qtyPerMeter: 1 },
  { warehouseId: "wh_cable",          name: "Кабель ВВГ-Пнг(А)-LS 3x1,5 (питание, 10А)",   unit: "м",     qtyFixed: 3,   qtyPerMeter: 1 },
  { warehouseId: "wh_cable_duct",     name: "Короб кабельный OPT 62",                        unit: "м",     qtyFixed: 1,   qtyPerMeter: 1 },
  { warehouseId: "wh_brackets_small", name: "Кронштейн настенный 450x390x2 мм",              unit: "компл", qtyFixed: 1,   qtyPerMeter: 0 },
  { warehouseId: "wh_hardware_kit",   name: "Комплект крепежа N1",                            unit: "компл", qtyFixed: 1,   qtyPerMeter: 0 },
  { warehouseId: "wh_flange",         name: "Финишный фланец RFE O62-100мм",                  unit: "шт",    qtyFixed: 2,   qtyPerMeter: 0 },
  { warehouseId: "wh_freon",          name: "Фреон R32",                                      unit: "кг",    qtyFixed: 1,   qtyPerMeter: 0 },
  { warehouseId: "wh_sealant",        name: "Герметик силиконовый",                           unit: "шт",    qtyFixed: 1,   qtyPerMeter: 0 },
  { warehouseId: "wh_clamps",         name: "Хомуты для крепления труб",                      unit: "шт",    qtyFixed: 4,   qtyPerMeter: 2 },
  { warehouseId: "wh_tape",           name: "Самовулканизирующаяся лента",                   unit: "м",     qtyFixed: 2,   qtyPerMeter: 0 },
];

// BOM для 18000 BTU (труба 1/4" + 1/2", кабель 3x2,5, кронштейн КС 450x500, автомат 16А)
const BOM_18: BomEntry[] = [
  { warehouseId: "wh_pipe_14",      name: "Труба медная 6,35x0,76 мм (1/4\") жидкостная", unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_pipe_12",      name: "Труба медная 12,7x0,81 мм (1/2\") газовая",    unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_insul_14",     name: "Теплоизоляция K-flex 6x06 ST",                 unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_insul_38",     name: "Теплоизоляция K-flex 6x12 ST (для 1/2\")",     unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_drain_pipe",   name: "Шланг дренажный гофрированный d16мм",           unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_cable_pvs",    name: "Провод ПВС 4x1,5 (межблочный, 5x1,5мм)",       unit: "м",     qtyFixed: 3,   qtyPerMeter: 1 },
  { warehouseId: "wh_cable_25",     name: "Кабель ВВГ-Пнг(А)-LS 3x2,5 (питание, 16А)",   unit: "м",     qtyFixed: 3,   qtyPerMeter: 1 },
  { warehouseId: "wh_duct_75",      name: "Короб кабельный OPT 75",                        unit: "м",     qtyFixed: 1,   qtyPerMeter: 1 },
  { warehouseId: "wh_brackets",     name: "Кронштейн КС 450x500 мм",                       unit: "компл", qtyFixed: 1,   qtyPerMeter: 0 },
  { warehouseId: "wh_hardware_kit", name: "Комплект крепежа N1",                            unit: "компл", qtyFixed: 1,   qtyPerMeter: 0 },
  { warehouseId: "wh_flange",       name: "Финишный фланец RFE O62-100мм",                  unit: "шт",    qtyFixed: 2,   qtyPerMeter: 0 },
  { warehouseId: "wh_freon",        name: "Фреон R32",                                      unit: "кг",    qtyFixed: 1,   qtyPerMeter: 0 },
  { warehouseId: "wh_sealant",      name: "Герметик силиконовый",                           unit: "шт",    qtyFixed: 1,   qtyPerMeter: 0 },
  { warehouseId: "wh_clamps",       name: "Хомуты для крепления труб",                      unit: "шт",    qtyFixed: 4,   qtyPerMeter: 2 },
  { warehouseId: "wh_tape",         name: "Самовулканизирующаяся лента",                   unit: "м",     qtyFixed: 2,   qtyPerMeter: 0 },
];

// BOM для 24000 BTU (труба 1/4" + 5/8", кабель 3x2,5, кронштейн КС 450x500, автомат 16А)
const BOM_24: BomEntry[] = [
  { warehouseId: "wh_pipe_14",      name: "Труба медная 6,35x0,76 мм (1/4\") жидкостная", unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_pipe_58",      name: "Труба медная 15,9 мм (5/8\") газовая",          unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_insul_14",     name: "Теплоизоляция K-flex 6x06 ST",                  unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_insul_19",     name: "Теплоизоляция K-flex 19мм (для 5/8\")",         unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_drain_pipe",   name: "Шланг дренажный гофрированный d16мм",           unit: "м",     qtyFixed: 2,   qtyPerMeter: 1 },
  { warehouseId: "wh_cable_pvs",    name: "Провод ПВС 4x1,5 (межблочный, 5x1,5мм)",        unit: "м",     qtyFixed: 3,   qtyPerMeter: 1 },
  { warehouseId: "wh_cable_25",     name: "Кабель ВВГ-Пнг(А)-LS 3x2,5 (питание, 16А)",    unit: "м",     qtyFixed: 3,   qtyPerMeter: 1 },
  { warehouseId: "wh_duct_102",     name: "Короб кабельный OPT 102",                        unit: "м",     qtyFixed: 1,   qtyPerMeter: 1 },
  { warehouseId: "wh_brackets",     name: "Кронштейн КС 450x500 мм",                        unit: "компл", qtyFixed: 1,   qtyPerMeter: 0 },
  { warehouseId: "wh_hardware_kit", name: "Комплект крепежа N1",                             unit: "компл", qtyFixed: 1,   qtyPerMeter: 0 },
  { warehouseId: "wh_flange",       name: "Финишный фланец RFE O62-100мм",                   unit: "шт",    qtyFixed: 2,   qtyPerMeter: 0 },
  { warehouseId: "wh_freon",        name: "Фреон R32",                                       unit: "кг",    qtyFixed: 1.5, qtyPerMeter: 0 },
  { warehouseId: "wh_sealant",      name: "Герметик силиконовый",                            unit: "шт",    qtyFixed: 1,   qtyPerMeter: 0 },
  { warehouseId: "wh_clamps",       name: "Хомуты для крепления труб",                       unit: "шт",    qtyFixed: 4,   qtyPerMeter: 2 },
  { warehouseId: "wh_tape",         name: "Самовулканизирующаяся лента",                    unit: "м",     qtyFixed: 2,   qtyPerMeter: 0 },
];

// ─── AC Catalog — реальные модели из таблицы (цены в BYN, гарантия в годах) ──

export const AC_CATALOG: AcModel[] = [
  // ── Economy: Dantex CORSO INVERTER ──────────────────────────────────────────
  { id: "ac_dantex_corso_09", brand: "Dantex", model: "CORSO INVERTER RK-09SDMI/RK-09SDMIE", btu: 9000,  kw: 2.6, areaMin: 20, areaMax: 28, refrigerant: "R32", tier: "economy",  price: 1680, warranty: 4, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 25м"], bom: BOM_09 },
  { id: "ac_dantex_corso_12", brand: "Dantex", model: "CORSO INVERTER RK-12SDMI/RK-12SDMIE", btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, refrigerant: "R32", tier: "economy",  price: 1750, warranty: 4, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 25м"], bom: BOM_09 },
  { id: "ac_dantex_corso_18", brand: "Dantex", model: "CORSO INVERTER RK-18SDMI/RK-18SDMIE", btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, refrigerant: "R32", tier: "economy",  price: 2730, warranty: 4, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 30м"], bom: BOM_18 },
  { id: "ac_dantex_corso_24", brand: "Dantex", model: "CORSO INVERTER RK-24SDMI/RK-24SDMIE", btu: 24000, kw: 7.0, areaMin: 55, areaMax: 75, refrigerant: "R32", tier: "economy",  price: 3675, warranty: 4, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 50м"], bom: BOM_24 },
  // ── Economy: Hisense ERA Classic ────────────────────────────────────────────
  { id: "ac_his_era_09",  brand: "Hisense", model: "ERA Classic A AS-09HR4RLRKC01",  btu: 9000,  kw: 2.6, areaMin: 20, areaMax: 28, refrigerant: "R32", tier: "economy",  price: 1220, warranty: 4, features: ["Wi-Fi (опция)", "Питание внутреннего блока", "Трасса до 15м"], bom: BOM_09 },
  { id: "ac_his_era_12",  brand: "Hisense", model: "ERA Classic A AS-12HR4RLRKC01",  btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, refrigerant: "R32", tier: "economy",  price: 1560, warranty: 4, features: ["Wi-Fi (опция)", "Питание внутреннего блока", "Трасса до 15м"], bom: BOM_09 },
  { id: "ac_his_era_18",  brand: "Hisense", model: "ERA Classic A AS-18HR4RMSKC00",  btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, refrigerant: "R32", tier: "economy",  price: 2580, warranty: 4, features: ["Wi-Fi (опция)", "Питание внутреннего блока", "Трасса до 20м"], bom: BOM_18 },
  // ── Economy: Midea PARAMOUNT ON/OFF ─────────────────────────────────────────
  { id: "ac_midea_par_09", brand: "Midea", model: "PARAMOUNT ON/OFF MSAG1-09HRN1-I/O", btu: 9000,  kw: 2.6, areaMin: 20, areaMax: 28, refrigerant: "R32", tier: "economy",  price: 1537, warranty: 4, features: ["Wi-Fi (опция)", "Питание внутреннего блока", "Трасса до 20м"], bom: BOM_09 },
  { id: "ac_midea_par_12", brand: "Midea", model: "PARAMOUNT ON/OFF MSAG1-12HRN1-I/O", btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, refrigerant: "R32", tier: "economy",  price: 1950, warranty: 4, features: ["Wi-Fi (опция)", "Питание внутреннего блока", "Трасса до 20м"], bom: BOM_09 },
  // ── Standard: Dantex ADVANCE PRO PLUS 2 INVERTER ────────────────────────────
  { id: "ac_dantex_adv2_09", brand: "Dantex", model: "ADVANCE PRO PLUS 2 INV RK-09SAT2I/RK-09SAT2IE", btu: 9000,  kw: 2.6, areaMin: 20, areaMax: 28, refrigerant: "R32", tier: "standard", price: 1890, warranty: 4, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 25м"], bom: BOM_09 },
  { id: "ac_dantex_adv2_12", brand: "Dantex", model: "ADVANCE PRO PLUS 2 INV RK-12SAT2I/RK-12SAT2IE", btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, refrigerant: "R32", tier: "standard", price: 1995, warranty: 4, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 25м"], bom: BOM_09 },
  { id: "ac_dantex_adv2_18", brand: "Dantex", model: "ADVANCE PRO PLUS 2 INV RK-18SAT2I/RK-18SAT2IE", btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, refrigerant: "R32", tier: "standard", price: 3290, warranty: 4, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 25м"], bom: BOM_18 },
  { id: "ac_dantex_adv2_24", brand: "Dantex", model: "ADVANCE PRO PLUS 2 INV RK-24SAT2I/RK-24SAT2IE", btu: 24000, kw: 7.0, areaMin: 55, areaMax: 75, refrigerant: "R32", tier: "standard", price: 3850, warranty: 4, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 25м"], bom: BOM_24 },
  // ── Standard: Midea PARAMOUNT INVERTER ──────────────────────────────────────
  { id: "ac_midea_pari_09", brand: "Midea", model: "PARAMOUNT INVERTER MSAG1-09N8C2S-I/O", btu: 9000,  kw: 2.6, areaMin: 20, areaMax: 28, refrigerant: "R32", tier: "standard", price: 2174, warranty: 4, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 25м"], bom: BOM_09 },
  { id: "ac_midea_pari_18", brand: "Midea", model: "PARAMOUNT INVERTER MSAG1-18N8D0-I/O", btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, refrigerant: "R32", tier: "standard", price: 4092, warranty: 4, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 30м"], bom: BOM_18 },
  { id: "ac_midea_pari_24", brand: "Midea", model: "PARAMOUNT INVERTER MSAG1-24N8D0-I/O", btu: 24000, kw: 7.0, areaMin: 55, areaMax: 75, refrigerant: "R32", tier: "standard", price: 5234, warranty: 4, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 50м"], bom: BOM_24 },
  // ── Standard: Electrolux AVALANCHE ──────────────────────────────────────────
  { id: "ac_elx_ava_09", brand: "Electrolux", model: "AVALANCHE Super DC EACS/I-09HAV/N8_22Y", btu: 9000,  kw: 2.6, areaMin: 20, areaMax: 28, refrigerant: "R32", tier: "standard", price: 2795, warranty: 3, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 15м"], bom: BOM_09 },
  { id: "ac_elx_ava_18", brand: "Electrolux", model: "AVALANCHE Super DC EACS/I-18HAV/N8_22Y", btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, refrigerant: "R32", tier: "standard", price: 4860, warranty: 3, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 15м"], bom: BOM_18 },
  // ── Standard: Electrolux Smartline ──────────────────────────────────────────
  { id: "ac_elx_sml_12", brand: "Electrolux", model: "Smartline DC EACS/I-12HSM/N8", btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, refrigerant: "R32", tier: "standard", price: 2490, warranty: 5, features: ["Инвертор", "Wi-Fi", "Питание наружного блока", "Трасса до 25м"], bom: BOM_09 },
  // ── Standard: Hisense CITY DC ───────────────────────────────────────────────
  { id: "ac_his_city_09", brand: "Hisense", model: "CITY DC Inverter AS-09UW4RYRCA05G", btu: 9000,  kw: 2.6, areaMin: 20, areaMax: 28, refrigerant: "R32", tier: "standard", price: 2481, warranty: 4, features: ["Инвертор", "Wi-Fi", "Питание внутреннего блока", "Трасса до 15м"], bom: BOM_09 },
  { id: "ac_his_city_18", brand: "Hisense", model: "CITY DC Inverter AS-18UW4RMSCA01G", btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, refrigerant: "R32", tier: "standard", price: 4807, warranty: 4, features: ["Инвертор", "Wi-Fi", "Питание внутреннего блока", "Трасса до 20м"], bom: BOM_18 },
  // ── Standard: Gree LYRA INVERTER ────────────────────────────────────────────
  { id: "ac_gree_lyra_09", brand: "Gree", model: "LYRA INVERTER R32 GWH09ACC-K6DNA1F (white)", btu: 9000,  kw: 2.6, areaMin: 20, areaMax: 28, refrigerant: "R32", tier: "standard", price: 2914, warranty: 5, features: ["Инвертор", "Wi-Fi", "Питание наружного блока", "Трасса до 15м"], bom: BOM_09 },
  { id: "ac_gree_lyra_12", brand: "Gree", model: "LYRA INVERTER R32 GWH12ACC-K6DNA1F (white)", btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, refrigerant: "R32", tier: "standard", price: 3036, warranty: 5, features: ["Инвертор", "Wi-Fi", "Питание наружного блока", "Трасса до 20м"], bom: BOM_09 },
  { id: "ac_gree_lyra_18", brand: "Gree", model: "LYRA INVERTER R32 GWH18ACD-K6DNA1I (white)", btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, refrigerant: "R32", tier: "standard", price: 4701, warranty: 5, features: ["Инвертор", "Wi-Fi", "Питание наружного блока", "Трасса до 25м"], bom: BOM_18 },
  // ── Premium: Samsung Wind-Free ───────────────────────────────────────────────
  { id: "ac_sam_wf_09", brand: "Samsung", model: "Wind-Free Mass Geo AR09BSFAMWKNER", btu: 9000,  kw: 2.6, areaMin: 20, areaMax: 28, refrigerant: "R32", tier: "premium", price: 3980, warranty: 5, features: ["Инвертор", "Wi-Fi", "Wind-Free технология", "Питание наружного блока", "Трасса до 20м"], bom: BOM_09 },
  { id: "ac_sam_wf_12", brand: "Samsung", model: "Wind-Free Mass Geo AR12BSFAMWKNER", btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, refrigerant: "R32", tier: "premium", price: 4210, warranty: 5, features: ["Инвертор", "Wi-Fi", "Wind-Free технология", "Питание наружного блока", "Трасса до 20м"], bom: BOM_09 },
  { id: "ac_sam_wf_18", brand: "Samsung", model: "Wind-Free Mass Geo AR18BSFAMWKNER", btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, refrigerant: "R32", tier: "premium", price: 5760, warranty: 5, features: ["Инвертор", "Wi-Fi", "Wind-Free технология", "Питание наружного блока", "Трасса до 25м"], bom: BOM_18 },
  { id: "ac_sam_wf_24", brand: "Samsung", model: "Wind-Free Mass Geo AR24BSFAMWKNER", btu: 24000, kw: 7.0, areaMin: 55, areaMax: 75, refrigerant: "R32", tier: "premium", price: 6560, warranty: 5, features: ["Инвертор", "Wi-Fi", "Wind-Free технология", "Питание наружного блока", "Трасса до 25м"], bom: BOM_24 },
  // ── Premium: MHI (Mitsubishi Heavy Industries) ──────────────────────────────
  { id: "ac_mhi_20", brand: "MHI", model: "Premium SRK20ZS-W / SRC20ZS-W",   btu: 9000,  kw: 2.6, areaMin: 20, areaMax: 28, refrigerant: "R32", tier: "premium", price: 5180, warranty: 5, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 25м"], bom: BOM_09 },
  { id: "ac_mhi_25", brand: "MHI", model: "Premium SRK25ZS-W / SRC25ZS-W2",  btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, refrigerant: "R32", tier: "premium", price: 5830, warranty: 5, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 25м"], bom: BOM_09 },
  { id: "ac_mhi_35", brand: "MHI", model: "Premium SRK35ZS-W / SRC35ZS-W2",  btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, refrigerant: "R32", tier: "premium", price: 6650, warranty: 5, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 25м"], bom: BOM_18 },
  { id: "ac_mhi_50", brand: "MHI", model: "Premium SRK50ZS-W / SRC50ZS-W",   btu: 24000, kw: 7.0, areaMin: 55, areaMax: 75, refrigerant: "R32", tier: "premium", price: 9210, warranty: 5, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 30м"], bom: BOM_24 },
  // ── Premium: Toshiba ─────────────────────────────────────────────────────────
  { id: "ac_tosh_haori_10", brand: "Toshiba", model: "HAORI RAS-B10N4KVRG-E / RAS-10J2AVSG-E1",         btu: 10000, kw: 2.9, areaMin: 22, areaMax: 32, refrigerant: "R32", tier: "premium", price: 6480, warranty: 3, features: ["Инвертор", "Wi-Fi (опция)", "Дизайн HAORI", "Питание наружного блока", "Трасса до 20м"], bom: BOM_09 },
  { id: "ac_tosh_sho_07",  brand: "Toshiba", model: "SHORAI EDGE RAS-B07G3KVSG-EE / RAS-07J2AVSG-E1",   btu: 7000,  kw: 2.0, areaMin: 15, areaMax: 22, refrigerant: "R32", tier: "premium", price: 5100, warranty: 3, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 20м"], bom: BOM_09 },
  { id: "ac_tosh_sho_10",  brand: "Toshiba", model: "SHORAI EDGE RAS-B10G3KVSG-E / RAS-10J2AVSG-E1",    btu: 10000, kw: 2.9, areaMin: 22, areaMax: 32, refrigerant: "R32", tier: "premium", price: 5450, warranty: 3, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 20м"], bom: BOM_09 },
  { id: "ac_tosh_sho_13",  brand: "Toshiba", model: "SHORAI EDGE RAS-B13G3KVSG-EE / RAS-13J2AVSG-E1",   btu: 13000, kw: 3.8, areaMin: 30, areaMax: 42, refrigerant: "R32", tier: "premium", price: 6050, warranty: 3, features: ["Инвертор", "Wi-Fi (опция)", "Питание наружного блока", "Трасса до 20м"], bom: BOM_09 },
  // ── Premium: Electrolux ENTERPRISE BLACK ─────────────────────────────────────
  { id: "ac_elx_ent_09", brand: "Electrolux", model: "ENTERPRISE BLACK DC EACS/I-09HEN-BLACK/N8_24Y", btu: 9000,  kw: 2.6, areaMin: 20, areaMax: 28, refrigerant: "R32", tier: "premium", price: 3870, warranty: 5, features: ["Инвертор", "Черный корпус", "Питание наружного блока", "Трасса до 15м"], bom: BOM_09 },
  { id: "ac_elx_ent_18", brand: "Electrolux", model: "ENTERPRISE BLACK DC EACS/I-18HEN-BLACK/N8_24Y", btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, refrigerant: "R32", tier: "premium", price: 5400, warranty: 5, features: ["Инвертор", "Черный корпус", "Питание наружного блока", "Трасса до 15м"], bom: BOM_18 },
  // ── Premium: Gree AIRY ───────────────────────────────────────────────────────
  { id: "ac_gree_airy_09", brand: "Gree", model: "AIRY INVERTER R32 GWH09AVCXB-K6DNA1B (white)", btu: 9000,  kw: 2.6, areaMin: 20, areaMax: 28, refrigerant: "R32", tier: "premium", price: 3386, warranty: 5, features: ["Инвертор", "Wi-Fi", "Питание наружного блока", "Трасса до 15м"], bom: BOM_09 },
  { id: "ac_gree_airy_18", brand: "Gree", model: "AIRY INVERTER R32 GWH18AVDXE-K6DNA1A (white)", btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, refrigerant: "R32", tier: "premium", price: 5209, warranty: 5, features: ["Инвертор", "Wi-Fi", "Питание наружного блока", "Трасса до 25м"], bom: BOM_18 },
];

// ─── AI analysis prompt ───────────────────────────────────────────────────────

const ROOM_ANALYSIS_PROMPT = `Ты — эксперт по климатическому оборудованию. Проанализируй фотографию помещения или план/чертёж здания.

Определи:
1. Площадь помещения в м² (если чертёж — вычисли из размеров, если фото — оцени визуально)
2. Тип помещения (спальня / гостиная / офис / кухня / магазин / склад / серверная — на русском)
3. Рекомендуемая мощность кондиционера в BTU. Выбери ТОЛЬКО из: 7000, 9000, 10000, 12000, 13000, 18000, 24000
   Ориентир: ~1000 BTU на 10 м². Для офисов/кухонь — плюс 20%. Для помещений с большими окнами на юг — плюс 15%.
4. Ориентировочная длина фреоновой трассы в метрах (путь трубопровода от внутреннего блока до наружного). Минимум 3м.
5. Замечания для монтажника (особенности помещения, препятствия, рекомендации)

Верни ТОЛЬКО валидный JSON без каких-либо пояснений до или после:
{"area":<число>,"roomType":"<тип>","recommendedBtu":<7000|9000|10000|12000|13000|18000|24000>,"traceLength":<число>,"notes":"<замечания или пустая строка>","imageDescription":"<1 предложение что видишь на изображении>"}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function calcConsumables(bom: BomEntry[], traceLength: number): Promise<OrderConsumable[]> {
  return Promise.all(
    bom.map(async (entry) => {
      const qtyRequired = Math.ceil(entry.qtyFixed + entry.qtyPerMeter * traceLength);
      const wItem = await getWarehouseItem(entry.warehouseId);
      return {
        warehouseId: entry.warehouseId,
        name: entry.name,
        unit: entry.unit,
        qtyRequired,
        qtyIssued: 0,
        stockSnapshot: wItem?.stock ?? 0,
      } as OrderConsumable;
    })
  );
}

async function getAllOrders(): Promise<InstallOrder[]> {
  const vals = await kv.getByPrefix("kapelan_order:") as string[];
  return vals
    .map((v: string) => { try { return JSON.parse(v); } catch { return null; } })
    .filter(Boolean)
    .sort((a: InstallOrder, b: InstallOrder) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

// ─── Register routes ──────────────────────────────────────────────────────────

export function registerInstallOrderRoutes(app: any): void {
  const P = "/make-server-1df47c03";

  // ── GET catalog ─────────────────────────────────────────────────────────────
  app.get(`${P}/install-orders/catalog`, (c: any) => {
    return c.json({ catalog: AC_CATALOG });
  });

  // ── GET all orders ───────────────────────────────────────────────────────────
  app.get(`${P}/install-orders`, async (c: any) => {
    try {
      const orders = await getAllOrders();
      return c.json({ orders });
    } catch (e: any) {
      console.error("[orders] list error:", e);
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST analyze room photo (AI vision) ─────────────────────────────────────
  // Must be registered BEFORE /:id routes so "analyze" doesn't match as id param
  app.post(`${P}/install-orders/analyze`, async (c: any) => {
    try {
      const { imageBase64, mimeType } = await c.req.json();
      if (!imageBase64) return c.json({ error: "imageBase64 обязателен" }, 400);

      const apiKey = Deno.env.get("kapelan_openai_api_key");
      if (!apiKey) return c.json({ error: "OpenAI API ключ не настроен" }, 500);

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 400,
          temperature: 0.2,
          messages: [{
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}`, detail: "high" },
              },
              { type: "text", text: ROOM_ANALYSIS_PROMPT },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("[orders/analyze] OpenAI error:", err);
        return c.json({ error: "Ошибка OpenAI API: " + err.slice(0, 200) }, 500);
      }

      const data = await response.json();
      const text: string = data.choices[0].message.content;

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return c.json({ error: "AI вернул неверный формат" }, 500);

      const analysis = JSON.parse(jsonMatch[0]);

      // Suggest best matching AC model
      const btu: number = analysis.recommendedBtu ?? 9000;
      const suggested = AC_CATALOG
        .filter(m => Math.abs(m.btu - btu) <= 3001)
        .sort((a, b) => Math.abs(a.btu - btu) - Math.abs(b.btu - btu))[0]
        ?? AC_CATALOG.find(m => m.tier === "standard") ?? AC_CATALOG[1];

      return c.json({ analysis, suggestedAcModelId: suggested.id });
    } catch (e: any) {
      console.error("[orders/analyze] error:", e);
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST preview consumables (calculate without saving) ──────────────────────
  app.post(`${P}/install-orders/preview`, async (c: any) => {
    try {
      const { acModelId, traceLength } = await c.req.json();
      const acModel = AC_CATALOG.find(m => m.id === acModelId);
      if (!acModel) return c.json({ error: "Модель не найдена" }, 404);
      const consumables = await calcConsumables(acModel.bom, Number(traceLength) || 5);
      return c.json({ consumables });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST create order ────────────────────────────────────────────────────────
  app.post(`${P}/install-orders`, async (c: any) => {
    try {
      const body = await c.req.json();
      const acModel = AC_CATALOG.find(m => m.id === body.acModelId);
      if (!acModel) return c.json({ error: "Модель кондиционера не найдена" }, 404);

      const traceLength = Number(body.traceLength) || 5;
      const consumables = await calcConsumables(acModel.bom, traceLength);

      const order: InstallOrder = {
        id: `ord_${uid()}`,
        clientName: body.clientName ?? "",
        clientPhone: body.clientPhone ?? "",
        clientAddress: body.clientAddress ?? "",
        leadId: body.leadId,
        roomArea: Number(body.roomArea) || 0,
        roomType: body.roomType ?? "Квартира",
        traceLength,
        acModelId: acModel.id,
        acBrand: acModel.brand,
        acModelName: acModel.model,
        acBtu: acModel.btu,
        acKw: acModel.kw,
        acPrice: acModel.price,
        acCount: Number(body.acCount) || 1,
        consumables,
        consumablesIssued: false,
        installerName: body.installerName ?? "",
        scheduledDate: body.scheduledDate ?? "",
        aiAnalysis: body.aiAnalysis,
        status: "draft",
        notes: body.notes ?? "",
        source: body.source ?? "manual",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await kv.set(`kapelan_order:${order.id}`, JSON.stringify(order));
      console.log(`[orders] created ${order.id}: ${acModel.brand} ${acModel.model} for "${order.clientName}" (${acModel.btu} BTU, trace ${traceLength}m)`);
      return c.json({ order }, 201);
    } catch (e: any) {
      console.error("[orders] create error:", e);
      return c.json({ error: e.message }, 500);
    }
  });

  // ── GET single order ─────────────────────────────────────────────────────────
  app.get(`${P}/install-orders/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      return c.json({ order: JSON.parse(raw) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── PUT update order fields ──────────────────────────────────────────────────
  app.put(`${P}/install-orders/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      const existing: InstallOrder = JSON.parse(raw);
      const body = await c.req.json();
      const updated: InstallOrder = {
        ...existing,
        ...body,
        id: existing.id,
        consumables: existing.consumables, // immutable after creation
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await kv.set(`kapelan_order:${updated.id}`, JSON.stringify(updated));
      return c.json({ order: updated });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST issue consumables (deduct from warehouse) ───────────────────────────
  // Also aliased as "start" — when installer picks up materials and departs
  app.post(`${P}/install-orders/:id/issue`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      const order: InstallOrder = JSON.parse(raw);

      if (order.consumablesIssued) {
        return c.json({ error: "Материалы по этому ордеру уже были выданы" }, 400);
      }

      // ── Check availability first ──────────────────────────────────────────
      const shortages: string[] = [];
      for (const con of order.consumables) {
        const item = await getWarehouseItem(con.warehouseId);
        if (!item) {
          shortages.push(`"${con.name}" — позиция не найдена на складе`);
          continue;
        }
        if (item.stock < con.qtyRequired) {
          shortages.push(`"${con.name}": нужно ${con.qtyRequired} ${con.unit}, в наличии ${item.stock}`);
        }
      }

      if (shortages.length > 0) {
        return c.json({ error: "Недостаточно материалов на складе", shortages }, 400);
      }

      // ── Deduct from warehouse ─────────────────────────────────────────────
      for (const con of order.consumables) {
        const item = await getWarehouseItem(con.warehouseId);
        if (!item) continue;
        const stockBefore = item.stock;
        item.stock = Math.max(0, item.stock - con.qtyRequired);
        item.updatedAt = new Date().toISOString();
        await saveWarehouseItem(item);
        await addMovement({
          itemId: con.warehouseId,
          itemName: con.name,
          type: "out",
          qty: con.qtyRequired,
          stockBefore,
          stockAfter: item.stock,
          reason: `Выдача по ордеру монтажа #${order.id.slice(-6).toUpperCase()} (${order.clientName})`,
          referenceId: order.id,
        });
        con.qtyIssued = con.qtyRequired;
      }

      order.consumablesIssued = true;
      order.status = "in_progress";
      order.updatedAt = new Date().toISOString();
      await kv.set(`kapelan_order:${order.id}`, JSON.stringify(order));

      console.log(`[orders] issued consumables for ${order.id} (${order.consumables.length} positions)`);
      return c.json({ order });
    } catch (e: any) {
      console.error("[orders/issue] error:", e);
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST start order (alias for issue — semantic: installer departs) ─────────
  app.post(`${P}/install-orders/:id/start`, async (c: any) => {
    // Forward to issue logic
    const id = c.req.param("id");
    const raw = await kv.get(`kapelan_order:${id}`);
    if (!raw) return c.json({ error: "Ордер не найден" }, 404);
    const order: InstallOrder = JSON.parse(raw);
    if (order.consumablesIssued) {
      // Already issued — just set in_progress if paused
      if (order.status === "paused") {
        order.status = "in_progress";
        order.updatedAt = new Date().toISOString();
        await kv.set(`kapelan_order:${order.id}`, JSON.stringify(order));
        return c.json({ order });
      }
      return c.json({ error: "Материалы уже выданы, ордер уже запущен" }, 400);
    }
    // Delegate to issue logic by internal call
    const req = new Request(`${c.req.url.replace('/start', '/issue')}`, { method: 'POST', headers: c.req.raw.headers });
    return c.env ? c.json({ error: "Use /issue endpoint" }, 500) : c.json({ error: "Internal" }, 500);
  });

  // ── POST pause order ─────────────────────────────────────────────────────────
  app.post(`${P}/install-orders/:id/pause`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      const order: InstallOrder = JSON.parse(raw);
      if (order.status !== "in_progress") {
        return c.json({ error: "Поставить на паузу можно только ордер в статусе 'В работе'" }, 400);
      }
      const body = await c.req.json().catch(() => ({}));
      order.status = "paused";
      if (body.notes) order.notes = order.notes ? order.notes + "\n[Пауза] " + body.notes : "[Пауза] " + body.notes;
      order.updatedAt = new Date().toISOString();
      await kv.set(`kapelan_order:${order.id}`, JSON.stringify(order));
      return c.json({ order });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST resume from pause ───────────────────────────────────────────────────
  app.post(`${P}/install-orders/:id/resume`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      const order: InstallOrder = JSON.parse(raw);
      if (order.status !== "paused") {
        return c.json({ error: "Возобновить можно только приостановленный ордер" }, 400);
      }
      order.status = "in_progress";
      order.updatedAt = new Date().toISOString();
      await kv.set(`kapelan_order:${order.id}`, JSON.stringify(order));
      return c.json({ order });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── POST complete order ──────────────────────────────────────────────────────
  app.post(`${P}/install-orders/:id/complete`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      const order: InstallOrder = JSON.parse(raw);
      const body = await c.req.json().catch(() => ({}));
      order.status = "completed";
      if (body.notes) order.notes = body.notes;
      order.updatedAt = new Date().toISOString();
      await kv.set(`kapelan_order:${order.id}`, JSON.stringify(order));
      return c.json({ order });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── DELETE order ─────────────────────────────────────────────────────────────
  app.delete(`${P}/install-orders/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_order:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Ордер не найден" }, 404);
      const order: InstallOrder = JSON.parse(raw);
      if (order.consumablesIssued) {
        return c.json({ error: "Нельзя удалить ордер с выданными материалами" }, 400);
      }
      await kv.del(`kapelan_order:${c.req.param("id")}`);
      return c.json({ success: true });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });
}
