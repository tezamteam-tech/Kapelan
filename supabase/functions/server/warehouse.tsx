// This file is NOT standalone — it exports a function that registers routes on `app`
// Usage in index.tsx: import { registerWarehouseRoutes } from "./warehouse.tsx"; registerWarehouseRoutes(app, kv);

import * as kv from "./kv_store.tsx";

export interface WarehouseItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: number;
  sku: string;
  supplier?: string;
  notes?: string;
  imageUrl?: string;
  itemType?: 'consumable' | 'assembly' | 'equipment';
  assemblyComponents?: { warehouseId: string; name: string; qty: number; unit: string }[];
  acSpecs?: {
    btu?: number;
    kw?: number;
    areaMin?: number;
    areaMax?: number;
    tier?: 'economy' | 'standard' | 'premium';
    equipmentId?: string;
    refrigerant?: string;
    warranty?: number;
    features?: string[];
    equipmentType?: 'split_ac' | 'fan_coil' | 'chiller' | 'vrv';
  };
  updatedAt: string;
  createdAt: string;
}

export interface StockMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: 'in' | 'out' | 'adjustment';
  qty: number;
  stockBefore: number;
  stockAfter: number;
  reason: string;
  referenceId?: string;
  note?: string;
  createdAt: string;
}

export interface PurchaseOrder {
  id: string;
  itemId: string;
  itemName: string;
  itemUnit: string;
  qtyOrdered: number;
  qtyReceived: number;
  pricePerUnit: number;
  totalCost: number;
  supplier: string;
  status: 'pending' | 'ordered' | 'received' | 'cancelled';
  reason: 'low_stock' | 'manual';
  note?: string;
  createdAt: string;
  updatedAt: string;
}

const now = () => new Date().toISOString();

const AC_IMG   = 'https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?w=600';
const PIPE_IMG = 'https://images.unsplash.com/photo-1640624910770-af6f133451ac?w=400';
const CABLE_IMG= 'https://images.unsplash.com/photo-1663559147223-6b0d012a4d0a?w=400';
const BRKT_IMG = 'https://images.unsplash.com/photo-1713662653109-5e372136d4bd?w=400';
const GAS_IMG  = 'https://images.unsplash.com/photo-1632339009787-0626abedd0c9?w=400';

const DEFAULT_WAREHOUSE: WarehouseItem[] = [
  // ── Медные трубы (фреоновая трасса) ─────────────────────────────────────────
  { id: 'wh_pipe_14', name: 'Труба медная 6,35x0,76 мм (1/4") жидкостная',    category: 'Трубопровод', unit: 'м',    stock: 100, minStock: 30, price: 8.28,  sku: 'PIPE-14',    supplier: 'МедьОпт', notes: 'Жидкостная линия для всех сплит-систем', itemType: 'consumable', imageUrl: PIPE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_pipe_38', name: 'Труба медная 9,53 мм (3/8") газовая',             category: 'Трубопровод', unit: 'м',    stock: 100, minStock: 30, price: 12.50, sku: 'PIPE-38',    supplier: 'МедьОпт', notes: 'Газовая линия для 9000-12000 BTU', itemType: 'consumable', imageUrl: PIPE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_pipe_12', name: 'Труба медная 12,7x0,81 мм (1/2") газовая',        category: 'Трубопровод', unit: 'м',    stock: 60,  minStock: 20, price: 18.60, sku: 'PIPE-12',    supplier: 'МедьОпт', notes: 'Газовая линия для 18000 BTU', itemType: 'consumable', imageUrl: PIPE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_pipe_58', name: 'Труба медная 15,9 мм (5/8") газовая',             category: 'Трубопровод', unit: 'м',    stock: 40,  minStock: 15, price: 25.00, sku: 'PIPE-58',    supplier: 'МедьОпт', notes: 'Газовая линия для 24000 BTU', itemType: 'consumable', imageUrl: PIPE_IMG, updatedAt: now(), createdAt: now() },
  // ── Теплоизоляция K-flex ─────────────────────────────────────────────────────
  { id: 'wh_insul_14', name: 'Теплоизоляция K-flex 6x06 ST (для 1/4")',        category: 'Трубопровод', unit: 'м',    stock: 120, minStock: 40, price: 1.00,  sku: 'KFLEX-606',  supplier: 'K-flex', notes: 'Для жидкостной трубы 6,35мм', itemType: 'consumable', imageUrl: PIPE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_insul_38', name: 'Теплоизоляция K-flex 6x12 ST (для 3/8"-1/2")',   category: 'Трубопровод', unit: 'м',    stock: 120, minStock: 40, price: 1.25,  sku: 'KFLEX-612',  supplier: 'K-flex', notes: 'Для газовой трубы 9-13мм', itemType: 'consumable', imageUrl: PIPE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_insul_19', name: 'Теплоизоляция K-flex 19мм (для 1/2"-5/8")',      category: 'Трубопровод', unit: 'м',    stock: 60,  minStock: 20, price: 2.20,  sku: 'KFLEX-19',   supplier: 'K-flex', notes: 'Для крупных трасс 18-24k BTU', itemType: 'consumable', imageUrl: PIPE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_tape',     name: 'Самовулканизирующаяся лента герметизирующая',     category: 'Трубопровод', unit: 'м',    stock: 50,  minStock: 15, price: 4.50,  sku: 'TAPE-SV',    supplier: '', notes: 'Для герметизации соединений трассы', itemType: 'consumable', imageUrl: PIPE_IMG, updatedAt: now(), createdAt: now() },
  // ── Дренаж ────────────────────────────────────────────────────────────────────
  { id: 'wh_drain_pipe',  name: 'Шланг дренажный гофрированный d16мм',            category: 'Дренаж', unit: 'м',    stock: 80,  minStock: 25, price: 1.87,  sku: 'DRAIN-16',   supplier: '', notes: 'Стандартный дренаж, без насоса', itemType: 'consumable', imageUrl: PIPE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_drain_vinyl', name: 'Шланг виниловый прозрачный D6x9мм (для насоса)', category: 'Дренаж', unit: 'м',    stock: 20,  minStock: 8,  price: 2.10,  sku: 'DRAIN-V69',  supplier: '', notes: 'Для дренажного насоса', itemType: 'consumable', imageUrl: PIPE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_drain_pump',  name: 'Насос дренажный конденсатный',                   category: 'Дренаж', unit: 'шт',   stock: 5,   minStock: 2,  price: 180.0, sku: 'PUMP-DRN',   supplier: 'КлиматТех', notes: 'Для помещений без гравитационного дренажа', itemType: 'consumable', imageUrl: PIPE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_ppr_pipe_20', name: 'Труба полипропиленовая PPR 20мм (дренаж в штробе)', category: 'Дренаж', unit: 'м', stock: 30, minStock: 10, price: 2.80,  sku: 'PPR-20',     supplier: 'АкваПайп', notes: 'Дренаж в штробе вместо гофры', itemType: 'consumable', imageUrl: PIPE_IMG, updatedAt: now(), createdAt: now() },
  // ── Электрика ─────────────────────────────────────────────────────────────────
  { id: 'wh_cable_pvs', name: 'Провод ПВС 4x1,5 ГОСТ 7399-97 (межблочный, 5x1,5мм)',  category: 'Электрика', unit: 'м',  stock: 150, minStock: 40, price: 2.85,  sku: 'PVS-4X15',  supplier: 'КабельМаркет', notes: 'Межблочный кабель для всех сплит-систем', itemType: 'consumable', imageUrl: CABLE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_cable',     name: 'Кабель ВВГ-Пнг(А)-LS 3x1,5 (питание, автомат 10А)',    category: 'Электрика', unit: 'м',  stock: 150, minStock: 40, price: 2.57,  sku: 'VVG-3X15',  supplier: 'КабельМаркет', notes: 'Питание 9000-12000 BTU, автомат 10А', itemType: 'consumable', imageUrl: CABLE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_cable_25',  name: 'Кабель ВВГ-Пнг(А)-LS 3x2,5 (питание, автомат 16А)',    category: 'Электрика', unit: 'м',  stock: 80,  minStock: 25, price: 4.20,  sku: 'VVG-3X25',  supplier: 'КабельМаркет', notes: 'Питание 18000-24000 BTU, автомат 16А', itemType: 'consumable', imageUrl: CABLE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_cable_duct', name: 'Короб кабельный пластиковый OPT 62 (55x37мм)',          category: 'Электрика', unit: 'м',  stock: 60,  minStock: 20, price: 7.50,  sku: 'OPT-62',    supplier: 'Teknaflux', notes: 'Для 9000-12000 BTU (кронштейн 450x390)', itemType: 'consumable', imageUrl: CABLE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_duct_75',   name: 'Короб кабельный пластиковый OPT 75',                    category: 'Электрика', unit: 'м',  stock: 40,  minStock: 12, price: 9.80,  sku: 'OPT-75',    supplier: 'Teknaflux', notes: 'Для 18000 BTU (кронштейн КС 450x500)', itemType: 'consumable', imageUrl: CABLE_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_duct_102',  name: 'Короб кабельный пластиковый OPT 102',                   category: 'Электрика', unit: 'м',  stock: 25,  minStock: 8,  price: 12.50, sku: 'OPT-102',   supplier: 'Teknaflux', notes: 'Для 24000 BTU (GALILEO SGL 100 XLL)', itemType: 'consumable', imageUrl: CABLE_IMG, updatedAt: now(), createdAt: now() },
  // ── Крепёж и кронштейны ───────────────────────────────────────────────────────
  { id: 'wh_brackets_small', name: 'Кронштейн настенный 450x390x2 мм (до 12k BTU, 10А)',     category: 'Крепёж', unit: 'компл', stock: 20, minStock: 6,  price: 20.00, sku: 'BRKT-390',   supplier: 'МонтажПро', notes: 'GALILEO SGL 100 EVO, автомат 10А', itemType: 'consumable', imageUrl: BRKT_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_brackets',       name: 'Кронштейн КС 450x500 мм (18k-24k BTU, 16А)',              category: 'Крепёж', unit: 'компл', stock: 15, minStock: 5,  price: 39.50, sku: 'BRKT-KS500', supplier: 'МонтажПро', notes: 'GALILEO SGL 140/XLL EVO, автомат 16А', itemType: 'consumable', imageUrl: BRKT_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_hardware_kit',   name: 'Комплект крепежа N1 (дюбели, болты, гайки)',              category: 'Крепёж', unit: 'компл', stock: 30, minStock: 10, price: 37.50, sku: 'HW-KIT-1',   supplier: '', notes: 'Стандартный комплект для монтажа наружного блока', itemType: 'consumable', imageUrl: BRKT_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_flange',         name: 'Финишный фланец RFE O62 до O100 мм универсальный',       category: 'Крепёж', unit: 'шт',   stock: 40, minStock: 15, price: 5.42,  sku: 'FLANGE-RFE', supplier: 'Teknaflux', notes: 'Подходит ко всем моделям кондиционеров', itemType: 'consumable', imageUrl: BRKT_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_flange_ra',      name: 'Финишный фланец с фиксатором дренажа RA O62-O74мм',     category: 'Крепёж', unit: 'шт',   stock: 20, minStock: 8,  price: 6.50,  sku: 'FLANGE-RA',  supplier: 'Teknaflux', notes: 'Для ввода в стену с фиксацией дренажа', itemType: 'consumable', imageUrl: BRKT_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_dowels',         name: 'Дюбель-шуруп 6x60 мм',                                   category: 'Крепёж', unit: 'шт',   stock: 400, minStock: 100, price: 0.18, sku: 'DWL-6X60',   supplier: '', notes: '', itemType: 'consumable', imageUrl: BRKT_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_clamps',         name: 'Хомуты для крепления трубопровода',                       category: 'Крепёж', unit: 'шт',   stock: 200, minStock: 60,  price: 0.35, sku: 'CLMP-STD',   supplier: '', notes: '', itemType: 'consumable', imageUrl: BRKT_IMG, updatedAt: now(), createdAt: now() },
  // ── Расходники ────────────────────────────────────────────────────────────────
  { id: 'wh_freon',     name: 'Фреон R32 (баллон 10 кг)',             category: 'Расходники', unit: 'кг',    stock: 20,  minStock: 6,  price: 38.00, sku: 'R32-KG',    supplier: 'ГазСнаб', notes: 'GWP=675, основной хладагент для всех новых моделей', itemType: 'consumable', imageUrl: GAS_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_freon_410', name: 'Фреон R410A (баллон 11,3 кг)',         category: 'Расходники', unit: 'кг',    stock: 10,  minStock: 4,  price: 32.00, sku: 'R410A-KG',  supplier: 'ГазСнаб', notes: 'GWP=2088, для старых моделей', itemType: 'consumable', imageUrl: GAS_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_sealant',   name: 'Герметик силиконовый нейтральный',     category: 'Расходники', unit: 'шт',    stock: 15,  minStock: 5,  price: 5.90,  sku: 'SEAL-SIL',  supplier: '', notes: '', itemType: 'consumable', imageUrl: GAS_IMG, updatedAt: now(), createdAt: now() },
  { id: 'wh_gland',     name: 'Сальники кабельного ввода (комплект)', category: 'Расходники', unit: 'компл', stock: 40,  minStock: 12, price: 1.80,  sku: 'GLAND-STD', supplier: '', notes: '', itemType: 'consumable', imageUrl: GAS_IMG, updatedAt: now(), createdAt: now() },
  // ── Кондиционеры — Dantex ─────────────────────────────────────────────────────
  { id: 'wh_ac_dantex_corso_09', name: 'Dantex CORSO INVERTER RK-09SDMI/RK-09SDMIE (9000 BTU)',  category: 'Кондиционеры', unit: 'шт', stock: 3, minStock: 1, price: 1680, sku: 'DX-CORSO-09', supplier: 'Dantex BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 9000, kw: 2.6, areaMin: 20, areaMax: 28, tier: 'economy', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_dantex_corso_12', name: 'Dantex CORSO INVERTER RK-12SDMI/RK-12SDMIE (12000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 3, minStock: 1, price: 1750, sku: 'DX-CORSO-12', supplier: 'Dantex BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, tier: 'economy', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_dantex_corso_18', name: 'Dantex CORSO INVERTER RK-18SDMI/RK-18SDMIE (18000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 2, minStock: 1, price: 2730, sku: 'DX-CORSO-18', supplier: 'Dantex BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, tier: 'economy', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 30м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_dantex_corso_24', name: 'Dantex CORSO INVERTER RK-24SDMI/RK-24SDMIE (24000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 3675, sku: 'DX-CORSO-24', supplier: 'Dantex BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 24000, kw: 7.0, areaMin: 55, areaMax: 75, tier: 'economy', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 50м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_dantex_adv2_09', name: 'Dantex ADVANCE PRO PLUS 2 INV RK-09SAT2I/RK-09SAT2IE (9000 BTU)',  category: 'Кондиционеры', unit: 'шт', stock: 4, minStock: 2, price: 1890, sku: 'DX-ADV2-09', supplier: 'Dantex BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 9000, kw: 2.6, areaMin: 20, areaMax: 28, tier: 'standard', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_dantex_adv2_12', name: 'Dantex ADVANCE PRO PLUS 2 INV RK-12SAT2I/RK-12SAT2IE (12000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 4, minStock: 2, price: 1995, sku: 'DX-ADV2-12', supplier: 'Dantex BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, tier: 'standard', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_dantex_adv2_18', name: 'Dantex ADVANCE PRO PLUS 2 INV RK-18SAT2I/RK-18SAT2IE (18000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 2, minStock: 1, price: 3290, sku: 'DX-ADV2-18', supplier: 'Dantex BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, tier: 'standard', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_dantex_adv2_24', name: 'Dantex ADVANCE PRO PLUS 2 INV RK-24SAT2I/RK-24SAT2IE (24000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 3850, sku: 'DX-ADV2-24', supplier: 'Dantex BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 24000, kw: 7.0, areaMin: 55, areaMax: 75, tier: 'standard', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  // ── Кондиционеры — Midea ─────────────────────────────────────────────────────
  { id: 'wh_ac_midea_par_09',    name: 'Midea PARAMOUNT ON/OFF MSAG1-09HRN1-I/O (9000 BTU)',    category: 'Кондиционеры', unit: 'шт', stock: 3, minStock: 1, price: 1537, sku: 'MID-PAR-09',  supplier: 'Midea BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 9000, kw: 2.6, areaMin: 20, areaMax: 28, tier: 'economy', refrigerant: 'R32', warranty: 4, features: ['Wi-Fi (опция)', 'Питание внутреннего блока', 'Трасса до 20м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_midea_par_12',    name: 'Midea PARAMOUNT ON/OFF MSAG1-12HRN1-I/O (12000 BTU)',   category: 'Кондиционеры', unit: 'шт', stock: 2, minStock: 1, price: 1950, sku: 'MID-PAR-12',  supplier: 'Midea BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, tier: 'economy', refrigerant: 'R32', warranty: 4, features: ['Wi-Fi (опция)', 'Питание внутреннего блока', 'Трасса до 20м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_midea_parInv_09', name: 'Midea PARAMOUNT INVERTER MSAG1-09N8C2S-I/O (9000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 3, minStock: 1, price: 2174, sku: 'MID-PARI-09', supplier: 'Midea BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 9000, kw: 2.6, areaMin: 20, areaMax: 28, tier: 'standard', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_midea_parInv_18', name: 'Midea PARAMOUNT INVERTER MSAG1-18N8D0-I/O (18000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 2, minStock: 1, price: 4092, sku: 'MID-PARI-18', supplier: 'Midea BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, tier: 'standard', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 30м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_midea_parInv_24', name: 'Midea PARAMOUNT INVERTER MSAG1-24N8D0-I/O (24000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 5234, sku: 'MID-PARI-24', supplier: 'Midea BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 24000, kw: 7.0, areaMin: 55, areaMax: 75, tier: 'standard', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 50м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  // ── Кондиционеры — Hisense ────────────────────────────────────────────────────
  { id: 'wh_ac_his_era_09',  name: 'Hisense ERA Classic A AS-09HR4RLRKC01 (9000 BTU)',      category: 'Кондиционеры', unit: 'шт', stock: 3, minStock: 1, price: 1220, sku: 'HIS-ERA-09',  supplier: 'Hisense BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 9000, kw: 2.6, areaMin: 20, areaMax: 28, tier: 'economy', refrigerant: 'R32', warranty: 4, features: ['Wi-Fi (опция)', 'Питание внутреннего блока', 'Трасса до 15м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_his_era_12',  name: 'Hisense ERA Classic A AS-12HR4RLRKC01 (12000 BTU)',     category: 'Кондиционеры', unit: 'шт', stock: 3, minStock: 1, price: 1560, sku: 'HIS-ERA-12',  supplier: 'Hisense BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, tier: 'economy', refrigerant: 'R32', warranty: 4, features: ['Wi-Fi (опция)', 'Питание внутреннего блока', 'Трасса до 15м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_his_era_18',  name: 'Hisense ERA Classic A AS-18HR4RMSKC00 (18000 BTU)',     category: 'Кондиционеры', unit: 'шт', stock: 2, minStock: 1, price: 2580, sku: 'HIS-ERA-18',  supplier: 'Hisense BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, tier: 'economy', refrigerant: 'R32', warranty: 4, features: ['Wi-Fi (опция)', 'Питание внутреннего блока', 'Трасса до 20м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_his_city_09', name: 'Hisense CITY DC Inverter AS-09UW4RYRCA05G (9000 BTU)',  category: 'Кондиционеры', unit: 'шт', stock: 2, minStock: 1, price: 2481, sku: 'HIS-CITY-09', supplier: 'Hisense BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 9000, kw: 2.6, areaMin: 20, areaMax: 28, tier: 'standard', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi', 'Питание внутреннего блока', 'Трасса до 15м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_his_city_18', name: 'Hisense CITY DC Inverter AS-18UW4RMSCA01G (18000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 4807, sku: 'HIS-CITY-18', supplier: 'Hisense BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, tier: 'standard', refrigerant: 'R32', warranty: 4, features: ['Инвертор', 'Wi-Fi', 'Питание внутреннего блока', 'Трасса до 20м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  // ── Кондиционеры — Samsung ────────────────────────────────────────────────────
  { id: 'wh_ac_sam_wf_09', name: 'Samsung Wind-Free Mass Geo AR09BSFAMWKNER (9000 BTU)',  category: 'Кондиционеры', unit: 'шт', stock: 2, minStock: 1, price: 3980, sku: 'SAM-WF-09', supplier: 'Samsung BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 9000, kw: 2.6, areaMin: 20, areaMax: 28, tier: 'premium', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi', 'Wind-Free технология', 'Питание наружного блока', 'Трасса до 20м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_sam_wf_12', name: 'Samsung Wind-Free Mass Geo AR12BSFAMWKNER (12000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 2, minStock: 1, price: 4210, sku: 'SAM-WF-12', supplier: 'Samsung BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, tier: 'premium', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi', 'Wind-Free технология', 'Питание наружного блока', 'Трасса до 20м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_sam_wf_18', name: 'Samsung Wind-Free Mass Geo AR18BSFAMWKNER (18000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 5760, sku: 'SAM-WF-18', supplier: 'Samsung BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, tier: 'premium', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi', 'Wind-Free технология', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_sam_wf_24', name: 'Samsung Wind-Free Mass Geo AR24BSFAMWKNER (24000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 6560, sku: 'SAM-WF-24', supplier: 'Samsung BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 24000, kw: 7.0, areaMin: 55, areaMax: 75, tier: 'premium', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi', 'Wind-Free технология', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  // ── Кондиционеры — MHI (Mitsubishi Heavy Industries) ──────────────────────────
  { id: 'wh_ac_mhi_20', name: 'MHI Premium SRK20ZS-W / SRC20ZS-W (aprx 9000 BTU)',   category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 5180, sku: 'MHI-SRK20', supplier: 'MHI BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 9000, kw: 2.6, areaMin: 20, areaMax: 28, tier: 'premium', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_mhi_25', name: 'MHI Premium SRK25ZS-W / SRC25ZS-W2 (aprx 12000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 5830, sku: 'MHI-SRK25', supplier: 'MHI BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, tier: 'premium', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_mhi_35', name: 'MHI Premium SRK35ZS-W / SRC35ZS-W2 (aprx 18000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 6650, sku: 'MHI-SRK35', supplier: 'MHI BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, tier: 'premium', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_mhi_50', name: 'MHI Premium SRK50ZS-W / SRC50ZS-W (aprx 24000 BTU)',  category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 9210, sku: 'MHI-SRK50', supplier: 'MHI BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 24000, kw: 7.0, areaMin: 55, areaMax: 75, tier: 'premium', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 30м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  // ── Кондиционеры — Toshiba ────────────────────────────────────────────────────
  { id: 'wh_ac_tosh_haori_10', name: 'Toshiba HAORI RAS-B10N4KVRG-E / RAS-10J2AVSG-E1 (10000 BTU)',        category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 6480, sku: 'TOSH-HAORI-10', supplier: 'Toshiba BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 10000, kw: 2.9, areaMin: 22, areaMax: 32, tier: 'premium', refrigerant: 'R32', warranty: 3, features: ['Инвертор', 'Wi-Fi (опция)', 'Дизайн HAORI', 'Питание наружного блока', 'Трасса до 20м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_tosh_sho_07',  name: 'Toshiba SHORAI EDGE RAS-B07G3KVSG-EE / RAS-07J2AVSG-E1 (7000 BTU)',  category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 5100, sku: 'TOSH-SHO-07',  supplier: 'Toshiba BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 7000, kw: 2.0, areaMin: 15, areaMax: 22, tier: 'premium', refrigerant: 'R32', warranty: 3, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 20м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_tosh_sho_10',  name: 'Toshiba SHORAI EDGE RAS-B10G3KVSG-E / RAS-10J2AVSG-E1 (10000 BTU)',  category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 5450, sku: 'TOSH-SHO-10',  supplier: 'Toshiba BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 10000, kw: 2.9, areaMin: 22, areaMax: 32, tier: 'premium', refrigerant: 'R32', warranty: 3, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 20м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_tosh_sho_13',  name: 'Toshiba SHORAI EDGE RAS-B13G3KVSG-EE / RAS-13J2AVSG-E1 (13000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 6050, sku: 'TOSH-SHO-13',  supplier: 'Toshiba BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 13000, kw: 3.8, areaMin: 30, areaMax: 42, tier: 'premium', refrigerant: 'R32', warranty: 3, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 20м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  // ── Кондиционеры — Electrolux ─────────────────────────────────────────────────
  { id: 'wh_ac_elx_ava_09', name: 'Electrolux AVALANCHE Super DC EACS/I-09HAV/N8_22Y (9000 BTU)',       category: 'Кондиционеры', unit: 'шт', stock: 2, minStock: 1, price: 2795, sku: 'ELX-AVA-09', supplier: 'Electrolux BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 9000, kw: 2.6, areaMin: 20, areaMax: 28, tier: 'standard', refrigerant: 'R32', warranty: 3, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 15м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_elx_ava_18', name: 'Electrolux AVALANCHE Super DC EACS/I-18HAV/N8_22Y (18000 BTU)',      category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 4860, sku: 'ELX-AVA-18', supplier: 'Electrolux BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, tier: 'standard', refrigerant: 'R32', warranty: 3, features: ['Инвертор', 'Wi-Fi (опция)', 'Питание наружного блока', 'Трасса до 15м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_elx_sml_12', name: 'Electrolux Smartline DC EACS/I-12HSM/N8 (12000 BTU)',                category: 'Кондиционеры', unit: 'шт', stock: 2, minStock: 1, price: 2490, sku: 'ELX-SML-12', supplier: 'Electrolux BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, tier: 'standard', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_elx_ent_09', name: 'Electrolux ENTERPRISE BLACK DC EACS/I-09HEN-BLACK/N8_24Y (9000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 3870, sku: 'ELX-ENT-09', supplier: 'Electrolux BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 9000, kw: 2.6, areaMin: 20, areaMax: 28, tier: 'premium', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Черный корпус', 'Питание наружного блока', 'Трасса до 15м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_elx_ent_18', name: 'Electrolux ENTERPRISE BLACK DC EACS/I-18HEN-BLACK/N8_24Y (18000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 5400, sku: 'ELX-ENT-18', supplier: 'Electrolux BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, tier: 'premium', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Черный корпус', 'Питание наружного блока', 'Трасса до 15м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  // ── Кондиционеры — Gree ───────────────────────────────────────────────────────
  { id: 'wh_ac_gree_lyra_09', name: 'Gree LYRA INVERTER R32 GWH09ACC-K6DNA1F white (9000 BTU)',  category: 'Кондиционеры', unit: 'шт', stock: 2, minStock: 1, price: 2914, sku: 'GRE-LYR-09', supplier: 'Gree BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 9000, kw: 2.6, areaMin: 20, areaMax: 28, tier: 'standard', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi', 'Питание наружного блока', 'Трасса до 15м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_gree_lyra_12', name: 'Gree LYRA INVERTER R32 GWH12ACC-K6DNA1F white (12000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 2, minStock: 1, price: 3036, sku: 'GRE-LYR-12', supplier: 'Gree BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 12000, kw: 3.5, areaMin: 28, areaMax: 40, tier: 'standard', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi', 'Питание наружного блока', 'Трасса до 20м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_gree_lyra_18', name: 'Gree LYRA INVERTER R32 GWH18ACD-K6DNA1I white (18000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 4701, sku: 'GRE-LYR-18', supplier: 'Gree BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, tier: 'standard', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_gree_airy_09', name: 'Gree AIRY INVERTER R32 GWH09AVCXB-K6DNA1B white (9000 BTU)',  category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 3386, sku: 'GRE-AIR-09', supplier: 'Gree BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 9000, kw: 2.6, areaMin: 20, areaMax: 28, tier: 'premium', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi', 'Питание наружного блока', 'Трасса до 15м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
  { id: 'wh_ac_gree_airy_18', name: 'Gree AIRY INVERTER R32 GWH18AVDXE-K6DNA1A white (18000 BTU)', category: 'Кондиционеры', unit: 'шт', stock: 1, minStock: 1, price: 5209, sku: 'GRE-AIR-18', supplier: 'Gree BY', itemType: 'equipment', imageUrl: AC_IMG, acSpecs: { btu: 18000, kw: 5.0, areaMin: 40, areaMax: 55, tier: 'premium', refrigerant: 'R32', warranty: 5, features: ['Инвертор', 'Wi-Fi', 'Питание наружного блока', 'Трасса до 25м'], equipmentType: 'split_ac' }, updatedAt: now(), createdAt: now() },
];

// ── KV helpers ────────────────────────────────────────────────────────────────
export async function getAllWarehouseItems(): Promise<WarehouseItem[]> {
  try {
    const all = await kv.getByPrefix('wh_item:');
    if (all.length > 0) {
      const items = (all as string[]).map(r => JSON.parse(r)).filter(Boolean);
      // Patch: seed any missing default items (e.g. new AC equipment added to DEFAULT_WAREHOUSE)
      const existingIds = new Set(items.map((i: WarehouseItem) => i.id));
      const missing = DEFAULT_WAREHOUSE.filter(d => !existingIds.has(d.id));
      if (missing.length > 0) {
        await Promise.all(missing.map(m => kv.set(`wh_item:${m.id}`, JSON.stringify(m))));
        items.push(...missing);
      }
      return items.sort((a: WarehouseItem, b: WarehouseItem) =>
        a.category.localeCompare(b.category, 'ru') || a.name.localeCompare(b.name, 'ru'));
    }
    for (const item of DEFAULT_WAREHOUSE) {
      await kv.set(`wh_item:${item.id}`, JSON.stringify(item));
    }
    return DEFAULT_WAREHOUSE;
  } catch (e) { console.error('getAllWarehouseItems:', e); return []; }
}

export async function getWarehouseItem(id: string): Promise<WarehouseItem | null> {
  const raw = await kv.get(`wh_item:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveWarehouseItem(item: WarehouseItem): Promise<void> {
  item.updatedAt = new Date().toISOString();
  await kv.set(`wh_item:${item.id}`, JSON.stringify(item));
}

export async function addMovement(mov: Omit<StockMovement, 'id' | 'createdAt'>): Promise<StockMovement> {
  const full: StockMovement = {
    ...mov,
    id: `mov_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  await kv.set(`wh_mov:${full.id}`, JSON.stringify(full));
  const idx = await kv.get(`wh_mov_idx:${mov.itemId}`);
  const list: string[] = idx ? JSON.parse(idx) : [];
  list.unshift(full.id);
  await kv.set(`wh_mov_idx:${mov.itemId}`, JSON.stringify(list.slice(0, 200)));
  const gRaw = await kv.get('wh_mov_global');
  const gList: string[] = gRaw ? JSON.parse(gRaw) : [];
  gList.unshift(full.id);
  await kv.set('wh_mov_global', JSON.stringify(gList.slice(0, 500)));
  return full;
}

export async function checkAndCreatePurchaseOrder(item: WarehouseItem): Promise<PurchaseOrder | null> {
  if (item.stock >= item.minStock) return null;
  const existing = await kv.get(`wh_pending_po:${item.id}`);
  if (existing) return null;
  const deficit = item.minStock - item.stock;
  const qtyNeeded = Math.ceil(deficit * 1.5);
  const po: PurchaseOrder = {
    id: `po_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
    itemId: item.id, itemName: item.name, itemUnit: item.unit,
    qtyOrdered: qtyNeeded, qtyReceived: 0,
    pricePerUnit: item.price, totalCost: qtyNeeded * item.price,
    supplier: item.supplier || '—',
    status: 'pending', reason: 'low_stock',
    note: `Автозаявка: остаток ${item.stock} ${item.unit} < мин. ${item.minStock} ${item.unit}`,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await kv.set(`wh_po:${po.id}`, JSON.stringify(po));
  await kv.set(`wh_pending_po:${item.id}`, po.id);
  const idx = await kv.get('wh_po_index');
  const list: string[] = idx ? JSON.parse(idx) : [];
  list.unshift(po.id);
  await kv.set('wh_po_index', JSON.stringify(list));
  console.log(`Auto-PO: ${po.id} for "${item.name}", qty: ${qtyNeeded}`);
  return po;
}

// ── Route registration ───────────────────────────────────────────────────────
export function registerWarehouseRoutes(app: any): void {
  const P = '/make-server-1df47c03';

  // GET all items
  app.get(`${P}/warehouse`, async (c: any) => {
    try {
      const items = await getAllWarehouseItems();
      const lowStockCount = items.filter(i => i.stock < i.minStock).length;
      const totalValue = items.reduce((s, i) => s + i.stock * i.price, 0);
      return c.json({ items, lowStockCount, totalValue });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch warehouse: ${error.message}` }, 500);
    }
  });

  // POST reseed warehouse from DEFAULT_WAREHOUSE (admin only)
  app.post(`${P}/warehouse/reseed`, async (c: any) => {
    try {
      let count = 0;
      for (const item of DEFAULT_WAREHOUSE) {
        await kv.set(`wh_item:${item.id}`, JSON.stringify({ ...item, updatedAt: new Date().toISOString() }));
        count++;
      }
      console.log(`[warehouse/reseed] reseeded ${count} items from DEFAULT_WAREHOUSE`);
      return c.json({ success: true, count, message: `Склад переинициализирован: ${count} позиций из каталога` });
    } catch (error: any) {
      return c.json({ error: `Reseed failed: ${error.message}` }, 500);
    }
  });

  // POST create item
  app.post(`${P}/warehouse`, async (c: any) => {
    try {
      const body = await c.req.json();
      const id = `wh_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;
      const item: WarehouseItem = {
        id, name: body.name || 'Новая позиция', category: body.category || 'Прочее',
        unit: body.unit || 'шт', stock: Number(body.stock ?? 0),
        minStock: Number(body.minStock ?? 0), price: Number(body.price ?? 0),
        sku: body.sku || '', supplier: body.supplier || '', notes: body.notes || '',
        imageUrl: body.imageUrl || '',
        itemType: body.itemType || 'consumable',
        assemblyComponents: body.assemblyComponents || [],
        updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      };
      await saveWarehouseItem(item);
      const po = await checkAndCreatePurchaseOrder(item);
      return c.json({ item, purchaseOrder: po });
    } catch (error: any) {
      return c.json({ error: `Failed to create item: ${error.message}` }, 500);
    }
  });

  // PATCH update item
  app.patch(`${P}/warehouse/:id`, async (c: any) => {
    try {
      const item = await getWarehouseItem(c.req.param('id'));
      if (!item) return c.json({ error: 'Item not found' }, 404);
      const body = await c.req.json();
      const allowed = ['name','category','unit','minStock','price','sku','supplier','notes','imageUrl','itemType','assemblyComponents'];
      for (const key of allowed) { if (body[key] !== undefined) (item as any)[key] = body[key]; }
      await saveWarehouseItem(item);
      const po = await checkAndCreatePurchaseOrder(item);
      return c.json({ item, purchaseOrder: po });
    } catch (error: any) {
      return c.json({ error: `Failed to update item: ${error.message}` }, 500);
    }
  });

  // DELETE item
  app.delete(`${P}/warehouse/:id`, async (c: any) => {
    try {
      await kv.del(`wh_item:${c.req.param('id')}`);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: `Failed to delete: ${error.message}` }, 500);
    }
  });

  // POST stock-in
  app.post(`${P}/warehouse/:id/stock-in`, async (c: any) => {
    try {
      const item = await getWarehouseItem(c.req.param('id'));
      if (!item) return c.json({ error: 'Item not found' }, 404);
      const { qty, reason = 'purchase', note, referenceId, poId } = await c.req.json();
      const qtyNum = Number(qty);
      if (!qtyNum || qtyNum <= 0) return c.json({ error: 'qty must be positive' }, 400);
      const stockBefore = item.stock;
      item.stock += qtyNum;
      await saveWarehouseItem(item);
      const mov = await addMovement({ itemId: item.id, itemName: item.name, type: 'in', qty: qtyNum, stockBefore, stockAfter: item.stock, reason, referenceId, note });
      let updatedPo: PurchaseOrder | null = null;
      if (poId) {
        const poRaw = await kv.get(`wh_po:${poId}`);
        if (poRaw) {
          const po: PurchaseOrder = JSON.parse(poRaw);
          po.qtyReceived = (po.qtyReceived || 0) + qtyNum;
          po.status = po.qtyReceived >= po.qtyOrdered ? 'received' : 'ordered';
          po.updatedAt = new Date().toISOString();
          await kv.set(`wh_po:${poId}`, JSON.stringify(po));
          if (po.status === 'received') await kv.del(`wh_pending_po:${item.id}`);
          updatedPo = po;
        }
      }
      return c.json({ item, movement: mov, purchaseOrder: updatedPo });
    } catch (error: any) {
      return c.json({ error: `Failed to stock-in: ${error.message}` }, 500);
    }
  });

  // POST stock-out
  app.post(`${P}/warehouse/:id/stock-out`, async (c: any) => {
    try {
      const item = await getWarehouseItem(c.req.param('id'));
      if (!item) return c.json({ error: 'Item not found' }, 404);
      const { qty, reason = 'installation', note, referenceId } = await c.req.json();
      const qtyNum = Number(qty);
      if (!qtyNum || qtyNum <= 0) return c.json({ error: 'qty must be positive' }, 400);
      if (item.stock < qtyNum) return c.json({ error: `Недостаточно: есть ${item.stock} ${item.unit}, нужно ${qtyNum}` }, 400);
      const stockBefore = item.stock;
      item.stock -= qtyNum;
      await saveWarehouseItem(item);
      const mov = await addMovement({ itemId: item.id, itemName: item.name, type: 'out', qty: qtyNum, stockBefore, stockAfter: item.stock, reason, referenceId, note });
      const po = await checkAndCreatePurchaseOrder(item);
      return c.json({ item, movement: mov, purchaseOrder: po, lowStockAlert: po !== null });
    } catch (error: any) {
      return c.json({ error: `Failed to stock-out: ${error.message}` }, 500);
    }
  });

  // POST bulk write-off from installation
  app.post(`${P}/warehouse/writeoff-installation`, async (c: any) => {
    try {
      const { leadId, installationId, items: writeItems } = await c.req.json();
      if (!Array.isArray(writeItems) || writeItems.length === 0) {
        return c.json({ error: 'items array required' }, 400);
      }
      const results: any[] = [];
      const errors: string[] = [];
      const newPOs: PurchaseOrder[] = [];
      const allItems = await getAllWarehouseItems();
      for (const wi of writeItems) {
        const qty = Number(wi.qty);
        if (!qty || qty <= 0) continue;
        let item: WarehouseItem | null = null;
        if (wi.itemId) item = await getWarehouseItem(wi.itemId);
        else if (wi.sku) item = allItems.find(i => i.sku === wi.sku) ?? null;
        else if (wi.name) item = allItems.find(i => i.name.toLowerCase().includes(wi.name.toLowerCase())) ?? null;
        if (!item) { errors.push(`Не найдено: ${wi.itemId ?? wi.sku ?? wi.name}`); continue; }
        if (item.stock < qty) { errors.push(`Мало "${item.name}": есть ${item.stock}, нужно ${qty}`); continue; }
        const stockBefore = item.stock;
        item.stock -= qty;
        await saveWarehouseItem(item);
        const mov = await addMovement({ itemId: item.id, itemName: item.name, type: 'out', qty, stockBefore, stockAfter: item.stock, reason: 'installation', referenceId: leadId ?? installationId, note: `Списание по монтажу${leadId ? ' #' + leadId.slice(-6) : ''}` });
        const po = await checkAndCreatePurchaseOrder(item);
        if (po) newPOs.push(po);
        results.push({ item, movement: mov, purchaseOrder: po });
      }
      return c.json({ results, errors, newPurchaseOrders: newPOs, lowStockAlerts: newPOs.length });
    } catch (error: any) {
      return c.json({ error: `Failed to write off: ${error.message}` }, 500);
    }
  });

  // GET movements for item
  app.get(`${P}/warehouse/:id/movements`, async (c: any) => {
    try {
      const idxRaw = await kv.get(`wh_mov_idx:${c.req.param('id')}`);
      if (!idxRaw) return c.json({ movements: [] });
      const ids: string[] = JSON.parse(idxRaw);
      const movs = (await Promise.all(ids.slice(0, 50).map((mid: string) => kv.get(`wh_mov:${mid}`))))
        .filter(Boolean).map((r: any) => JSON.parse(r));
      return c.json({ movements: movs });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch movements: ${error.message}` }, 500);
    }
  });

  // GET all recent movements
  app.get(`${P}/warehouse-movements`, async (c: any) => {
    try {
      const gRaw = await kv.get('wh_mov_global');
      if (!gRaw) return c.json({ movements: [] });
      const ids: string[] = JSON.parse(gRaw);
      const movs = (await Promise.all(ids.slice(0, 100).map((mid: string) => kv.get(`wh_mov:${mid}`))))
        .filter(Boolean).map((r: any) => JSON.parse(r));
      return c.json({ movements: movs });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch movements: ${error.message}` }, 500);
    }
  });

  // GET all POs
  app.get(`${P}/purchase-orders`, async (c: any) => {
    try {
      const idxRaw = await kv.get('wh_po_index');
      if (!idxRaw) return c.json({ orders: [] });
      const ids: string[] = JSON.parse(idxRaw);
      const orders = (await Promise.all(ids.map((id: string) => kv.get(`wh_po:${id}`))))
        .filter(Boolean).map((r: any) => JSON.parse(r))
        .sort((a: PurchaseOrder, b: PurchaseOrder) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return c.json({ orders });
    } catch (error: any) {
      return c.json({ error: `Failed to fetch POs: ${error.message}` }, 500);
    }
  });

  // POST create manual PO
  app.post(`${P}/purchase-orders`, async (c: any) => {
    try {
      const { itemId, qtyOrdered, pricePerUnit, supplier, note } = await c.req.json();
      if (!itemId || !qtyOrdered) return c.json({ error: 'itemId and qtyOrdered required' }, 400);
      const item = await getWarehouseItem(itemId);
      if (!item) return c.json({ error: 'Item not found' }, 404);
      const qty = Number(qtyOrdered); const ppu = Number(pricePerUnit ?? item.price);
      const po: PurchaseOrder = {
        id: `po_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
        itemId: item.id, itemName: item.name, itemUnit: item.unit,
        qtyOrdered: qty, qtyReceived: 0, pricePerUnit: ppu, totalCost: qty * ppu,
        supplier: supplier || item.supplier || '—', status: 'pending', reason: 'manual',
        note: note || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await kv.set(`wh_po:${po.id}`, JSON.stringify(po));
      const idxRaw = await kv.get('wh_po_index');
      const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
      idx.unshift(po.id);
      await kv.set('wh_po_index', JSON.stringify(idx));
      return c.json({ order: po });
    } catch (error: any) {
      return c.json({ error: `Failed to create PO: ${error.message}` }, 500);
    }
  });

  // PATCH update PO status
  app.patch(`${P}/purchase-orders/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`wh_po:${c.req.param('id')}`);
      if (!raw) return c.json({ error: 'PO not found' }, 404);
      const po: PurchaseOrder = JSON.parse(raw);
      const body = await c.req.json();
      const allowed = ['status','qtyOrdered','qtyReceived','supplier','note','pricePerUnit'];
      for (const key of allowed) { if (body[key] !== undefined) (po as any)[key] = body[key]; }
      po.totalCost = po.qtyOrdered * po.pricePerUnit;
      po.updatedAt = new Date().toISOString();
      await kv.set(`wh_po:${c.req.param('id')}`, JSON.stringify(po));
      if (po.status === 'received' || po.status === 'cancelled') {
        await kv.del(`wh_pending_po:${po.itemId}`);
      }
      return c.json({ order: po });
    } catch (error: any) {
      return c.json({ error: `Failed to update PO: ${error.message}` }, 500);
    }
  });
}
