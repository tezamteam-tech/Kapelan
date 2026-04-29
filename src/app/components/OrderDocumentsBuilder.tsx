import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, RefreshCw, Search, Download, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { API_BASE, AH, JH, getJson, invalidateUrlPrefix } from "../lib/apiClient";
import { RightSideCard } from "./ui/RightSideCard";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCurrency } from "./CurrencyContext";

const API = API_BASE;

type OrderStatus =
  | "new"
  | "qualification"
  | "survey_scheduled"
  | "survey_done"
  | "offer_prepared"
  | "offer_sent"
  | "offer_approved"
  | "awaiting_supply"
  | "ready_to_schedule"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "closed"
  | "cancelled";

interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  type: string;
  client_name?: string;
  client_phone?: string;
  object_address?: string;
  client_legal_name?: string;
  client_tax_id?: string;
  client_email?: string;
  client_doc_basis?: string;
  offer?: { version: number; status: string; lines: any[] };
  created_at: string;
  updated_at: string;
}

const inputCls =
  "w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

async function downloadFile(url: string, filename: string) {
  const res = await fetch(url, { headers: AH });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt ? `${txt}`.slice(0, 240) : `Не удалось сформировать документ (${res.status})`);
  }
  const blob = await res.blob();
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(u);
}

export function OrderDocumentsBuilder() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const loadOrders = useCallback(async (opts?: { force?: boolean }) => {
    setLoading(true);
    try {
      const data = await getJson<{ orders?: Order[] }>(`${API}/orders`, { ttlMs: 30_000, force: opts?.force });
      setOrders(data.orders ?? []);
      if (!selectedId && (data.orders?.[0]?.id ?? "")) setSelectedId(data.orders?.[0]?.id ?? "");
    } catch (e: any) {
      showToast(e?.message || "Ошибка загрузки ордеров", false);
    } finally {
      setLoading(false);
    }
  }, [selectedId, showToast]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const selected = useMemo(() => orders.find((o) => o.id === selectedId) ?? null, [orders, selectedId]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return orders;
    return orders.filter((o) => {
      const blob = `${o.number} ${o.client_name ?? ""} ${o.client_phone ?? ""} ${o.object_address ?? ""}`.toLowerCase();
      return blob.includes(qq);
    });
  }, [orders, q]);

  // Editable details (kept inside Order)
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [address, setAddress] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState("");
  const [basis, setBasis] = useState("");

  useEffect(() => {
    setClientName(selected?.client_name ?? "");
    setClientPhone(selected?.client_phone ?? "");
    setAddress(selected?.object_address ?? "");
    setLegalName(selected?.client_legal_name ?? "");
    setTaxId(selected?.client_tax_id ?? "");
    setEmail(selected?.client_email ?? "");
    setBasis(selected?.client_doc_basis ?? "");
  }, [
    selected?.id,
    selected?.client_name,
    selected?.client_phone,
    selected?.object_address,
    selected?.client_legal_name,
    selected?.client_tax_id,
    selected?.client_email,
    selected?.client_doc_basis,
  ]);

  const dirty =
    !!selected &&
    (clientName !== (selected.client_name ?? "") ||
      clientPhone !== (selected.client_phone ?? "") ||
      address !== (selected.object_address ?? "") ||
      legalName !== (selected.client_legal_name ?? "") ||
      taxId !== (selected.client_tax_id ?? "") ||
      email !== (selected.client_email ?? "") ||
      basis !== (selected.client_doc_basis ?? ""));

  async function saveOrderDetails() {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/orders/${selected.id}`, {
        method: "PATCH",
        headers: JH,
        body: JSON.stringify({
          client_name: clientName.trim(),
          client_phone: clientPhone.trim(),
          object_address: address.trim(),
          client_legal_name: legalName.trim() || undefined,
          client_tax_id: taxId.trim() || undefined,
          client_email: email.trim() || undefined,
          client_doc_basis: basis.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
      invalidateUrlPrefix(`${API}/orders`);
      showToast("Данные ордера сохранены");
    } catch (e: any) {
      showToast(e?.message || "Ошибка сохранения", false);
    } finally {
      setSaving(false);
    }
  }

  async function makeOfferPdf() {
    if (!selected) return;
    await downloadFile(`${API}/orders/${selected.id}/offer/pdf`, `offer_${selected.number}.pdf`);
    showToast("КП сформировано");
  }

  async function makeActPdf() {
    if (!selected) return;
    await downloadFile(`${API}/orders/${selected.id}/act/pdf`, `act_${selected.number}.pdf`);
    showToast("Акт сформирован");
  }

  // --- Builder state (constructor) ---
  const [docType, setDocType] = useState<"offer" | "contract" | "act">("offer");
  const [format, setFormat] = useState<"pdf" | "doc">("pdf");
  const [docTitle, setDocTitle] = useState("");
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [docNotes, setDocNotes] = useState("");
  const [docNotesHtml, setDocNotesHtml] = useState("");
  const [rendering, setRendering] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>("");

  const [docBodyHtml, setDocBodyHtml] = useState("");
  const templateKey = useCallback((t: "offer" | "contract" | "act") => `docTemplate.v1.${t}`, []);

  const loadUserTemplate = useCallback((t: "offer" | "contract" | "act") => {
    try {
      return localStorage.getItem(templateKey(t)) || "";
    } catch {
      return "";
    }
  }, [templateKey]);

  const saveUserTemplate = useCallback((t: "offer" | "contract" | "act", html: string) => {
    try {
      localStorage.setItem(templateKey(t), html);
      return true;
    } catch {
      return false;
    }
  }, [templateKey]);

  const clearUserTemplate = useCallback((t: "offer" | "contract" | "act") => {
    try {
      localStorage.removeItem(templateKey(t));
      return true;
    } catch {
      return false;
    }
  }, [templateKey]);

  type CompanyProfile = {
    name: string;
    city: string;
    address: string;
    taxId: string;
    iban: string;
    bank: string;
    bic: string;
    phone: string;
    email: string;
  };

  const [company, setCompany] = useState<CompanyProfile>(() => {
    try {
      const raw = localStorage.getItem("companyProfile.v1");
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return {
      name: "ООО “Эвериз Сервис”",
      city: "г. Минск",
      address: "ул. Орловская, 40, пом. 25б, 220030",
      taxId: "УНП 192812488",
      iban: "BY29 MTBK 3012 0001 0933 0013 0402",
      bank: "в ЗАО «МТБанк»",
      bic: "MTBKBY22",
      phone: "+375 29 333 66 77",
      email: "",
    };
  });

  useEffect(() => {
    try {
      localStorage.setItem("companyProfile.v1", JSON.stringify(company));
    } catch {
      // ignore
    }
  }, [company]);

  type DocItem = { name: string; qty: number; unit: string; price: number; imageUrl?: string; warehouse_item_id?: string };
  type WorkStage = { title: string; amount: number };
  const [items, setItems] = useState<DocItem[]>([]);
  const [stages, setStages] = useState<WorkStage[]>([]);
  const [equipMap, setEquipMap] = useState<Record<string, any>>({});
  const { currency, fmt, fmtShort } = useCurrency();
  const [addOpen, setAddOpen] = useState(false);
  const [addQ, setAddQ] = useState("");
  const [addSource, setAddSource] = useState<"equipment" | "stock">("equipment");
  const [addSelectedId, setAddSelectedId] = useState<string>("");
  const [autoBom, setAutoBom] = useState(true);
  const saveOfferTimer = useRef<any>(null);
  const [vatEnabled, setVatEnabled] = useState<boolean>(false);
  const [vatPercent, setVatPercent] = useState<number>(20);
  const [includeImages, setIncludeImages] = useState<boolean>(() => {
    try {
      return localStorage.getItem("doc.includeImages.v1") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("doc.includeImages.v1", includeImages ? "1" : "0");
    } catch {
      // ignore
    }
  }, [includeImages]);

  const [warehouseMap, setWarehouseMap] = useState<Record<string, any>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getJson<any>(`${API}/config`, { ttlMs: 60_000, staleTtlMs: 10 * 60_000, swr: true });
        if (!alive) return;
        const vat = data?.company?.vat;
        if (vat && typeof vat === "object") {
          if (typeof vat.enabledByDefault === "boolean") setVatEnabled(vat.enabledByDefault);
          if (typeof vat.percent === "number") setVatPercent(vat.percent);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getJson<{ items?: any[] }>(`${API}/warehouse`, { ttlMs: 2 * 60_000, staleTtlMs: 10 * 60_000, swr: true });
        if (!alive) return;
        const m: Record<string, any> = {};
        for (const it of (data.items ?? [])) {
          if (!it?.id) continue;
          m[String(it.id)] = it;
        }
        setWarehouseMap(m);
      } catch {
        if (!alive) return;
        setWarehouseMap({});
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getJson<{ equipment?: any[] }>(`${API}/equipment`, { ttlMs: 2 * 60_000, staleTtlMs: 10 * 60_000, swr: true });
        if (!alive) return;
        const m: Record<string, any> = {};
        for (const e of (data.equipment ?? [])) {
          if (!e?.id) continue;
          m[String(e.id)] = e;
        }
        setEquipMap(m);
      } catch {
        if (!alive) return;
        setEquipMap({});
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const baseItems: DocItem[] = (selected.offer?.lines ?? [])
      .filter((l: any) => (l?.line_type ?? "") !== "discount")
      .map((l: any) => ({
        name: String(l?.name ?? ""),
        qty: Number(l?.qty ?? 0),
        unit: String(l?.unit ?? ""),
        price: Number(l?.price ?? 0),
        warehouse_item_id: l?.warehouse_item_id ? String(l.warehouse_item_id) : undefined,
        imageUrl: l?.warehouse_item_id ? String(warehouseMap?.[String(l.warehouse_item_id)]?.imageUrl ?? "") : undefined,
      }))
      .filter((i: any) => i.name);
    setItems(baseItems.length ? baseItems : [{ name: "", qty: 1, unit: "шт", price: 0 }]);
    setStages([]);
    setDocNotes("");
    setDocNotesHtml("");
    setDocBodyHtml("");
    setDocType("offer");
    setFormat("pdf");
    setDocTitle("");
    setDocDate(new Date().toISOString().slice(0, 10));
  }, [selected?.id, warehouseMap]);

  function inferLineTypeFromWarehouseItem(it: any): any {
    const t = String(it?.itemType ?? "").trim();
    if (t === "equipment" || t === "assembly" || t === "consumable") return t;
    return "consumable";
  }

  function traceLenForBom(order: any) {
    const v = (typeof order?.trace_length_m === "number" ? order.trace_length_m : undefined) ??
      (typeof order?.survey?.trace_length_m === "number" ? order.survey.trace_length_m : undefined) ??
      4;
    return Math.max(0, Number(v) || 0);
  }

  async function ensureOfferExists(orderId: string) {
    const o = orders.find((x) => x.id === orderId) as any;
    if (o?.offer) return o.offer;
    const offer = { version: 1, status: "draft", currency: currency.name, lines: [] as any[] };
    const res = await fetch(`${API}/orders/${orderId}`, { method: "PATCH", headers: JH, body: JSON.stringify({ offer, status: "offer_prepared" }) });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    setOrders((prev) => prev.map((x) => (x.id === data.order.id ? data.order : x)));
    return data.order.offer;
  }

  async function saveOfferLinesToOrder(orderId: string, nextLines: any[]) {
    const o = orders.find((x) => x.id === orderId) as any;
    const offer = { ...(o?.offer ?? { version: 1, status: "draft", currency: currency.name, lines: [] }), currency: (o?.offer?.currency ?? currency.name), lines: nextLines };
    const res = await fetch(`${API}/orders/${orderId}`, { method: "PATCH", headers: JH, body: JSON.stringify({ offer, status: "offer_prepared" }) });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    setOrders((prev) => prev.map((x) => (x.id === data.order.id ? data.order : x)));
    invalidateUrlPrefix(`${API}/orders`);
    return data.order;
  }

  function findEquipmentModelForWarehouseItemId(wid: string): any | null {
    if (!wid) return null;
    // 1) exact match by equipment.warehouseItemId
    const byLink = Object.values(equipMap).find((e: any) => String(e?.warehouseItemId ?? "") === String(wid));
    if (byLink) return byLink;
    // 2) try from warehouse item acSpecs.equipmentId
    const wh = warehouseMap?.[String(wid)];
    const eqId = String(wh?.acSpecs?.equipmentId ?? "").trim();
    if (eqId && equipMap[eqId]) return equipMap[eqId];
    return null;
  }

  function buildBomOfferLines(eq: any, order: any): any[] {
    const bom = Array.isArray(eq?.bom) ? eq.bom : [];
    const trace = traceLenForBom(order);
    const out: any[] = [];
    for (const b of bom) {
      const wid = String(b?.warehouseId ?? "").trim();
      const qty = Math.ceil(Number(b?.qtyFixed ?? 0) + Number(b?.qtyPerMeter ?? 0) * trace);
      if (qty <= 0) continue;
      const wh = wid ? warehouseMap?.[wid] : null;
      out.push({
        line_type: "consumable",
        warehouse_item_id: wid || undefined,
        name: String(wh?.name ?? b?.name ?? "").trim(),
        qty,
        unit: String(wh?.unit ?? b?.unit ?? "шт"),
        price: Number(wh?.price ?? 0),
      });
    }
    return out.filter((l) => l.name);
  }

  async function ensureWarehouseItemForEquipment(eq: any): Promise<string> {
    // Prefer existing link
    const existing = String(eq?.warehouseItemId ?? "").trim();
    if (existing) return existing;

    // Create a hidden warehouse item (itemType=equipment) so order_core confirm can derive BOM.
    const name = `${String(eq?.brand ?? "").trim()} ${String(eq?.model ?? "").trim()}`.trim() || String(eq?.id ?? "Оборудование");
    const body = {
      name,
      category: "Оборудование",
      unit: "шт",
      sku: `EQ-${String(eq?.id ?? "").slice(0, 24)}`,
      stock: 0,
      minStock: 0,
      price: Number(eq?.price ?? 0),
      itemType: "equipment",
      // keep a backlink so later we can match
      acSpecs: { equipmentId: String(eq?.id ?? "") },
    };
    const res = await fetch(`${API}/warehouse`, { method: "POST", headers: JH, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
    const wid = String(d?.item?.id ?? "");
    if (!wid) throw new Error("Не удалось создать складскую позицию для оборудования");

    // Persist link back into equipment catalog to avoid duplicates
    try {
      await fetch(`${API}/equipment`, {
        method: "POST",
        headers: JH,
        body: JSON.stringify({ ...eq, warehouseItemId: wid }),
      }).catch(() => null);
    } catch {
      // ignore
    }
    // Update local map
    setEquipMap((p) => ({ ...p, [String(eq.id)]: { ...(p[String(eq.id)] ?? eq), warehouseItemId: wid } }));
    return wid;
  }

  async function patchOrderEquipmentWarehouseId(orderId: string, wid: string) {
    const res = await fetch(`${API}/orders/${orderId}`, { method: "PATCH", headers: JH, body: JSON.stringify({ equipment_warehouse_id: wid }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    setOrders((prev) => prev.map((o) => (o.id === data.order.id ? data.order : o)));
    return data.order;
  }

  async function addWarehouseItemToOffer() {
    if (!selected) return;
    const wid = String(addSelectedId || "").trim();
    if (!wid) return;
    const wh = warehouseMap?.[wid];
    if (!wh) {
      showToast("Позиция склада не найдена", false);
      return;
    }
    try {
      await ensureOfferExists(selected.id);
      const currentOrder = orders.find((o) => o.id === selected.id) as any;
      const curLines = Array.isArray(currentOrder?.offer?.lines) ? [...currentOrder.offer.lines] : [];

      const lineType = inferLineTypeFromWarehouseItem(wh);
      const newLine: any = {
        line_type: lineType,
        warehouse_item_id: wid,
        name: String(wh.name ?? ""),
        qty: 1,
        unit: String(wh.unit ?? "шт"),
        price: Number(wh.price ?? 0),
      };

      // Merge if same warehouse_item_id exists
      const idx = curLines.findIndex((l: any) => String(l?.warehouse_item_id ?? "") === wid && String(l?.line_type ?? "") === String(lineType));
      if (idx >= 0) curLines[idx] = { ...curLines[idx], qty: Number(curLines[idx].qty ?? 0) + 1 };
      else curLines.push(newLine);

      // Auto-add BOM for equipment
      if (autoBom && lineType === "equipment") {
        const eq = findEquipmentModelForWarehouseItemId(wid);
        if (eq) {
          const bomLines = buildBomOfferLines(eq, currentOrder);
          for (const bl of bomLines) {
            const bwid = String(bl?.warehouse_item_id ?? "").trim();
            if (bwid) {
              const j = curLines.findIndex((l: any) => String(l?.warehouse_item_id ?? "") === bwid && String(l?.line_type ?? "") !== "equipment");
              if (j >= 0) curLines[j] = { ...curLines[j], qty: Number(curLines[j].qty ?? 0) + Number(bl.qty ?? 0) };
              else curLines.push(bl);
            } else {
              curLines.push(bl);
            }
          }
        }
      }

      const saved = await saveOfferLinesToOrder(selected.id, curLines);
      // refresh local doc items from offer (source of truth)
      const baseItems: DocItem[] = (saved.offer?.lines ?? [])
        .filter((l: any) => (l?.line_type ?? "") !== "discount")
        .map((l: any) => ({
          name: String(l?.name ?? ""),
          qty: Number(l?.qty ?? 0),
          unit: String(l?.unit ?? ""),
          price: Number(l?.price ?? 0),
          warehouse_item_id: l?.warehouse_item_id ? String(l.warehouse_item_id) : undefined,
          imageUrl: l?.warehouse_item_id ? String(warehouseMap?.[String(l.warehouse_item_id)]?.imageUrl ?? "") : undefined,
        }))
        .filter((i: any) => i.name);
      setItems(baseItems.length ? baseItems : [{ name: "", qty: 1, unit: "шт", price: 0 }]);
      setAddOpen(false);
      setAddSelectedId("");
      setAddQ("");
      showToast("Позиция добавлена в ордер и КП");
    } catch (e: any) {
      showToast(e?.message || "Не удалось добавить позицию", false);
    }
  }

  async function addEquipmentModelToOffer() {
    if (!selected) return;
    const eqId = String(addSelectedId || "").trim();
    if (!eqId) return;
    const eq = equipMap?.[eqId];
    if (!eq) {
      showToast("Модель оборудования не найдена", false);
      return;
    }

    try {
      await ensureOfferExists(selected.id);
      const currentOrder = orders.find((o) => o.id === selected.id) as any;
      const curLines = Array.isArray(currentOrder?.offer?.lines) ? [...currentOrder.offer.lines] : [];

      const wid = await ensureWarehouseItemForEquipment(eq);
      await patchOrderEquipmentWarehouseId(selected.id, wid);

      const eqName = `${String(eq?.brand ?? "").trim()} ${String(eq?.model ?? "").trim()}`.trim() || String(eqId);
      const eqLine: any = {
        line_type: "equipment",
        warehouse_item_id: wid,
        name: eqName,
        qty: 1,
        unit: "шт",
        price: Number(eq?.price ?? 0),
      };
      const idx = curLines.findIndex((l: any) => String(l?.line_type ?? "") === "equipment" && String(l?.warehouse_item_id ?? "") === wid);
      if (idx >= 0) curLines[idx] = { ...curLines[idx], qty: Number(curLines[idx].qty ?? 0) + 1 };
      else curLines.push(eqLine);

      if (autoBom) {
        const bomLines = buildBomOfferLines(eq, currentOrder);
        for (const bl of bomLines) {
          const bwid = String(bl?.warehouse_item_id ?? "").trim();
          if (bwid) {
            const j = curLines.findIndex((l: any) => String(l?.warehouse_item_id ?? "") === bwid && String(l?.line_type ?? "") !== "equipment");
            if (j >= 0) curLines[j] = { ...curLines[j], qty: Number(curLines[j].qty ?? 0) + Number(bl.qty ?? 0) };
            else curLines.push(bl);
          } else {
            curLines.push(bl);
          }
        }
      }

      const saved = await saveOfferLinesToOrder(selected.id, curLines);
      const baseItems: DocItem[] = (saved.offer?.lines ?? [])
        .filter((l: any) => (l?.line_type ?? "") !== "discount")
        .map((l: any) => ({
          name: String(l?.name ?? ""),
          qty: Number(l?.qty ?? 0),
          unit: String(l?.unit ?? ""),
          price: Number(l?.price ?? 0),
          warehouse_item_id: l?.warehouse_item_id ? String(l.warehouse_item_id) : undefined,
          imageUrl: l?.warehouse_item_id ? String(warehouseMap?.[String(l.warehouse_item_id)]?.imageUrl ?? "") : undefined,
        }))
        .filter((i: any) => i.name);
      setItems(baseItems.length ? baseItems : [{ name: "", qty: 1, unit: "шт", price: 0 }]);
      setAddOpen(false);
      setAddSelectedId("");
      setAddQ("");
      showToast("Оборудование добавлено в ордер и КП");
    } catch (e: any) {
      showToast(e?.message || "Не удалось добавить оборудование", false);
    }
  }

  function scheduleOfferAutosave(nextItems: DocItem[]) {
    if (!selected) return;
    if (saveOfferTimer.current) clearTimeout(saveOfferTimer.current);
    saveOfferTimer.current = setTimeout(async () => {
      try {
        await ensureOfferExists(selected.id);
        const currentOrder = orders.find((o) => o.id === selected.id) as any;
        const prevLines = Array.isArray(currentOrder?.offer?.lines) ? currentOrder.offer.lines : [];

        // Keep only non-discount lines and map by position index for now.
        // (MVP rule: positions in documents reflect offer lines order)
        const base = prevLines.filter((l: any) => (l?.line_type ?? "") !== "discount");
        const nextLines = base.map((l: any, idx: number) => {
          const it = nextItems[idx];
          if (!it) return l;
          return {
            ...l,
            name: String(it.name ?? ""),
            qty: Number(it.qty ?? 0),
            unit: String(it.unit ?? ""),
            price: Number(it.price ?? 0),
            warehouse_item_id: it.warehouse_item_id ? String(it.warehouse_item_id) : l.warehouse_item_id,
          };
        });
        // If user added extra lines manually in UI table
        if (nextItems.length > base.length) {
          for (let i = base.length; i < nextItems.length; i++) {
            const it = nextItems[i];
            if (!it?.name?.trim()) continue;
            nextLines.push({
              line_type: "consumable",
              warehouse_item_id: it.warehouse_item_id ? String(it.warehouse_item_id) : undefined,
              name: String(it.name ?? ""),
              qty: Number(it.qty ?? 0),
              unit: String(it.unit ?? "шт"),
              price: Number(it.price ?? 0),
            });
          }
        }
        await saveOfferLinesToOrder(selected.id, nextLines);
      } catch {
        // silent; user still can download
      }
    }, 600);
  }

  const getDefaultTemplate = useCallback((t: "offer" | "contract" | "act", isLegal: boolean) => {
    if (t === "offer") {
      return `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
  <div>
    <h1 style="margin:0;font-size:18px;letter-spacing:0.2px;">КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</h1>
    <div style="margin-top:6px;font-size:12px;color:#475569;">№ {{ORDER_NUMBER}} · от {{DOC_DATE}}</div>
  </div>
  <div style="text-align:right;">{{COMPANY_BLOCK}}</div>
</div>
{{CLIENT_BLOCK}}
<p style="margin-top:12px;font-size:12px;">Настоящим предлагаем выполнить поставку оборудования и/или оказание услуг по монтажу кондиционеров на условиях ниже.</p>
{{ITEMS_TABLE}}
{{WORK_STAGES}}
{{TOTALS}}
<h3 style="margin-top:16px;">Условия</h3>
<ul>
  <li>Гарантия на работы: 5 лет.</li>
  <li>Условия оплаты: предоплата за оборудование/материалы 100%, аванс на работы 50%.</li>
  <li>Сроки поставки/выполнения работ: по согласованию.</li>
</ul>
<p style="font-size:12px;color:#475569;"><b>Тип клиента:</b> ${isLegal ? "Юридическое лицо" : "Физическое лицо"}</p>
<div style="margin-top:22px;font-size:12px;">Исполнитель: ____________________</div>
{{NOTES}}`;
    }
    if (t === "contract") {
      return `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
  <div>
    <h1 style="margin:0;font-size:18px;letter-spacing:0.2px;">ДОГОВОР НА ВЫПОЛНЕНИЕ РАБОТ</h1>
    <div style="margin-top:6px;font-size:12px;color:#475569;">№ {{ORDER_NUMBER}} · от {{DOC_DATE}}</div>
  </div>
  <div style="text-align:right;">{{COMPANY_BLOCK}}</div>
</div>
{{CLIENT_BLOCK}}
<h3 style="margin-top:16px;">1. Предмет договора</h3>
<p style="font-size:12px;line-height:1.5;">Исполнитель обязуется выполнить работы по монтажу/обслуживанию оборудования на объекте Заказчика, а Заказчик обязуется принять и оплатить работы.</p>
<h3 style="margin-top:14px;">2. Стоимость и порядок оплаты</h3>
<p style="font-size:12px;line-height:1.5;">Стоимость работ и материалов определяется согласно спецификации/сметы (ниже) и может уточняться по факту осмотра/замера. Оплата: предоплата за оборудование/материалы 100%, аванс на работы 50% (можно изменить).</p>
<h3 style="margin-top:14px;">3. Сроки выполнения</h3>
<p style="font-size:12px;line-height:1.5;">Сроки поставки и выполнения работ согласуются сторонами дополнительно и зависят от наличия оборудования и условий на объекте.</p>
<h3 style="margin-top:14px;">4. Гарантии</h3>
<p style="font-size:12px;line-height:1.5;">Гарантия на выполненные работы: 5 лет при соблюдении правил эксплуатации и регламентов обслуживания. Гарантия на оборудование — согласно гарантийным обязательствам производителя.</p>
<h3 style="margin-top:14px;">5. Спецификация</h3>
{{ITEMS_TABLE}}
{{WORK_STAGES}}
{{TOTALS}}
<h3 style="margin-top:14px;">6. Заключительные положения</h3>
<p style="font-size:12px;line-height:1.5;">Стороны подтверждают согласие с условиями договора. Споры решаются путём переговоров, а при недостижении соглашения — в порядке, установленном законодательством.</p>
<div style="margin-top:22px;font-size:12px;display:flex;justify-content:space-between;gap:12px;">
  <div style="flex:1;border-top:1px solid #e5e7eb;padding-top:10px;">Исполнитель: ____________________</div>
  <div style="flex:1;border-top:1px solid #e5e7eb;padding-top:10px;">Заказчик: ____________________</div>
</div>
{{NOTES}}`;
    }
    return `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
  <div>
    <h1 style="margin:0;font-size:18px;letter-spacing:0.2px;">АКТ ВЫПОЛНЕННЫХ РАБОТ</h1>
    <div style="margin-top:6px;font-size:12px;color:#475569;">№ {{ORDER_NUMBER}} · от {{DOC_DATE}}</div>
  </div>
  <div style="text-align:right;">{{COMPANY_BLOCK}}</div>
</div>
{{CLIENT_BLOCK}}
<p style="margin-top:12px;font-size:12px;">Настоящим подтверждаем выполнение работ по ордеру.</p>
{{ITEMS_TABLE}}
{{WORK_STAGES}}
{{TOTALS}}
<p style="font-size:12px;line-height:1.5;margin-top:12px;">Работы выполнены в полном объёме. Претензий по качеству и объёму работ не имею.</p>
<div style="margin-top:22px;font-size:12px;display:flex;justify-content:space-between;gap:12px;">
  <div style="flex:1;border-top:1px solid #e5e7eb;padding-top:10px;">Исполнитель: ____________________</div>
  <div style="flex:1;border-top:1px solid #e5e7eb;padding-top:10px;">Заказчик: ____________________</div>
</div>
{{NOTES}}`;
  }, []);

  const userTemplateExists = useMemo(() => {
    const raw = loadUserTemplate(docType);
    return Boolean(raw.trim());
  }, [docType, loadUserTemplate]);

  useEffect(() => {
    if (!selected) return;
    const isLegal = Boolean((selected.client_legal_name ?? "").trim());
    const user = loadUserTemplate(docType);
    const next = user.trim() ? user : getDefaultTemplate(docType, isLegal);
    setDocBodyHtml(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, selected?.id]);

  const totalItems = useMemo(() => items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0), [items]);
  const totalStages = useMemo(() => stages.reduce((s, st) => s + (Number(st.amount) || 0), 0), [stages]);
  const total = useMemo(() => Math.round((totalItems + totalStages) * 100) / 100, [totalItems, totalStages]);

  const notesEditor = useEditor({
    extensions: [StarterKit],
    content: docNotesHtml || "",
    onUpdate: ({ editor }) => {
      setDocNotesHtml(editor.getHTML());
      setDocNotes(editor.getText());
    },
    editorProps: {
      attributes: {
        class:
          "focus:outline-none min-h-[120px] bg-white rounded-xl border border-slate-200 px-3 py-2 text-sm",
      },
    },
  });

  useEffect(() => {
    if (!notesEditor) return;
    const current = notesEditor.getHTML();
    const next = docNotesHtml || "";
    if (current !== next) notesEditor.commands.setContent(next);
  }, [notesEditor, docNotesHtml, selected?.id]);

  const bodyEditor = useEditor({
    extensions: [StarterKit],
    content: docBodyHtml || "",
    onUpdate: ({ editor }) => {
      setDocBodyHtml(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "focus:outline-none min-h-[240px] bg-white rounded-xl border border-slate-200 px-3 py-2 text-sm",
      },
    },
  });

  useEffect(() => {
    if (!bodyEditor) return;
    const current = bodyEditor.getHTML();
    const next = docBodyHtml || "";
    if (current !== next) bodyEditor.commands.setContent(next);
  }, [bodyEditor, docBodyHtml, selected?.id]);

  const insertIntoBody = useCallback((text: string) => {
    bodyEditor?.chain().focus().insertContent(text).run();
  }, [bodyEditor]);

  const escapeHtml = useCallback((s: string) => {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }, []);

  useEffect(() => {
    if (!selected) return;
    const isLegal = Boolean((selected.client_legal_name ?? "").trim());
    const title =
      docTitle.trim() ||
      (docType === "act"
        ? "АКТ ВЫПОЛНЕННЫХ РАБОТ"
        : docType === "contract"
          ? "ДОГОВОР НА ВЫПОЛНЕНИЕ РАБОТ"
          : "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ");
    const dateStr = docDate ? new Date(docDate).toLocaleDateString("ru-RU") : new Date().toLocaleDateString("ru-RU");

    const rows = items
      .filter((i) => i.name.trim())
      .map((i, idx) => {
        const rowTotal = (Number(i.price) || 0) * (Number(i.qty) || 0);
        const img = (includeImages ? String(i.imageUrl ?? "").trim() : "");
        return `<tr>
  <td style="border:1px solid #e5e7eb;padding:6px;">${idx + 1}</td>
  ${includeImages ? `<td style="border:1px solid #e5e7eb;padding:6px;">
    ${img ? `<img src="${escapeHtml(img)}" style="width:64px;height:48px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;" />` : `<span style="color:#94a3b8;font-size:11px;">—</span>`}
  </td>` : ""}
  <td style="border:1px solid #e5e7eb;padding:6px;">${escapeHtml(i.name)}</td>
  <td style="border:1px solid #e5e7eb;padding:6px;text-align:right;">${Number(i.qty) || 0}</td>
  <td style="border:1px solid #e5e7eb;padding:6px;">${escapeHtml(i.unit)}</td>
  <td style="border:1px solid #e5e7eb;padding:6px;text-align:right;">${Number(i.price) || 0}</td>
  <td style="border:1px solid #e5e7eb;padding:6px;text-align:right;">${Math.round(rowTotal * 100) / 100}</td>
</tr>`;
      })
      .join("");

    const stagesHtml = stages.filter((s) => s.title.trim()).length
      ? `<h3 style="margin:16px 0 8px 0;font-size:13px;">Этапы работ</h3>
<table style="width:100%;border-collapse:collapse;font-size:12px;">
<thead><tr>
  <th style="border:1px solid #e5e7eb;padding:6px;text-align:left;">Этап</th>
  <th style="border:1px solid #e5e7eb;padding:6px;text-align:right;">Сумма</th>
</tr></thead>
<tbody>
${stages
  .filter((s) => s.title.trim())
  .map((s) => `<tr><td style="border:1px solid #e5e7eb;padding:6px;">${escapeHtml(s.title)}</td><td style="border:1px solid #e5e7eb;padding:6px;text-align:right;">${Math.round((Number(s.amount) || 0) * 100) / 100}</td></tr>`)
  .join("")}
</tbody></table>`
      : "";

    const notesBlock = docNotesHtml
      ? `<div style="margin-top:16px;"><h3 style="margin:0 0 6px 0;font-size:13px;">Комментарий</h3><div style="font-size:12px;line-height:1.45;">${docNotesHtml}</div></div>`
      : (docNotes.trim()
        ? `<div style="margin-top:16px;"><h3 style="margin:0 0 6px 0;font-size:13px;">Комментарий</h3><div style="font-size:12px;line-height:1.45;white-space:pre-wrap;">${escapeHtml(docNotes.trim())}</div></div>`
        : "");

    const itemsTable = `
<h3 style="margin:18px 0 8px 0;font-size:13px;">${docType === "act" ? "Перечень работ/позиций" : "Состав предложения"}</h3>
<table style="width:100%;border-collapse:collapse;font-size:12px;">
  <thead>
    <tr>
      <th style="border:1px solid #e5e7eb;padding:6px;text-align:left;width:36px;">№</th>
      ${includeImages ? `<th style="border:1px solid #e5e7eb;padding:6px;text-align:left;width:72px;">Фото</th>` : ""}
      <th style="border:1px solid #e5e7eb;padding:6px;text-align:left;">Позиция</th>
      <th style="border:1px solid #e5e7eb;padding:6px;text-align:right;width:60px;">Кол-во</th>
      <th style="border:1px solid #e5e7eb;padding:6px;text-align:left;width:60px;">Ед.</th>
      <th style="border:1px solid #e5e7eb;padding:6px;text-align:right;width:80px;">Цена</th>
      <th style="border:1px solid #e5e7eb;padding:6px;text-align:right;width:90px;">Сумма</th>
    </tr>
  </thead>
  <tbody>
    ${rows || `<tr><td colspan="${includeImages ? 7 : 6}" style="border:1px solid #e5e7eb;padding:10px;color:#64748b;">— (нет позиций)</td></tr>`}
  </tbody>
</table>`;

    const totalsBlock = `
<div style="margin-top:14px;display:flex;justify-content:flex-end;">
  <div style="min-width:260px;border:1px solid #e5e7eb;border-radius:10px;padding:10px;background:#f8fafc;">
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
      <span style="color:#64748b;">Позиции</span><b>${fmt(Math.round(totalItems * 100) / 100, 2)}</b>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
      <span style="color:#64748b;">Этапы</span><b>${fmt(Math.round(totalStages * 100) / 100, 2)}</b>
    </div>
    ${vatEnabled ? `<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
      <span style="color:#64748b;">НДС ${Math.max(0, Number(vatPercent) || 0)}%</span><b>${fmt(Math.round(((total * (Math.max(0, Number(vatPercent) || 0))) / 100) * 100) / 100, 2)}</b>
    </div>` : ""}
    <div style="display:flex;justify-content:space-between;font-size:13px;">
      <span style="color:#0f172a;"><b>Итого${vatEnabled ? " с НДС" : ""}</b></span><span style="color:#0f172a;"><b>${fmt(Math.round((total + (vatEnabled ? (total * (Math.max(0, Number(vatPercent) || 0))) / 100 : 0)) * 100) / 100, 2)}</b></span>
    </div>
  </div>
</div>`;

    const clientBlock = `
<div style="margin-top:16px;font-size:12px;color:#334155;">
  <div><b>Клиент:</b> ${escapeHtml(selected.client_name || "—")}</div>
  <div><b>Телефон:</b> ${escapeHtml(selected.client_phone || "—")}</div>
  <div><b>Адрес объекта:</b> ${escapeHtml(selected.object_address || "—")}</div>
  ${selected.client_legal_name ? `<div><b>Юр. лицо:</b> ${escapeHtml(selected.client_legal_name)}</div>` : ""}
  ${selected.client_tax_id ? `<div><b>ИНН/ЕГРПОУ:</b> ${escapeHtml(selected.client_tax_id)}</div>` : ""}
  ${selected.client_email ? `<div><b>Email:</b> ${escapeHtml(selected.client_email)}</div>` : ""}
  ${selected.client_doc_basis ? `<div><b>Основание:</b> ${escapeHtml(selected.client_doc_basis)}</div>` : ""}
</div>`;

    const companyBlock = `
<div style="font-size:11px;color:#334155;">
  <div style="font-weight:700;">${escapeHtml(company.name || "Исполнитель")}</div>
  <div>${escapeHtml(company.city || "")}${company.address ? `, ${escapeHtml(company.address)}` : ""}</div>
  ${company.taxId ? `<div>${escapeHtml(company.taxId)}</div>` : ""}
  ${company.iban ? `<div>${escapeHtml(company.iban)}</div>` : ""}
  ${company.bank ? `<div>${escapeHtml(company.bank)}${company.bic ? `, БИК ${escapeHtml(company.bic)}` : ""}</div>` : (company.bic ? `<div>БИК ${escapeHtml(company.bic)}</div>` : "")}
  ${company.phone ? `<div>Тел.: ${escapeHtml(company.phone)}</div>` : ""}
  ${company.email ? `<div>Email: ${escapeHtml(company.email)}</div>` : ""}
</div>`;

    const bodySrc = docBodyHtml || "";

    const bodyRendered = bodySrc
      .replaceAll("{{ORDER_NUMBER}}", escapeHtml(selected.number))
      .replaceAll("{{DOC_DATE}}", escapeHtml(dateStr))
      .replaceAll("{{CLIENT_BLOCK}}", clientBlock)
      .replaceAll("{{COMPANY_BLOCK}}", companyBlock)
      .replaceAll("{{ITEMS_TABLE}}", itemsTable)
      .replaceAll("{{WORK_STAGES}}", stagesHtml || "")
      .replaceAll("{{TOTALS}}", totalsBlock)
      .replaceAll("{{NOTES}}", notesBlock || "");

    const html = `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
<div style="max-width:794px;margin:0 auto;padding:32px;">
  ${bodyRendered}
</div>
</body></html>`;

    setPreviewHtml(html);
  }, [selected?.id, docType, docTitle, docDate, items, stages, docNotes, docNotesHtml, docBodyHtml, company, escapeHtml, totalItems, totalStages, total, includeImages, fmt, currency, vatEnabled, vatPercent]);

  async function renderAndDownload() {
    if (!selected) return;
    setRendering(true);
    try {
      const title =
        docTitle.trim() ||
        (docType === "act"
          ? "АКТ ВЫПОЛНЕННЫХ РАБОТ"
          : docType === "contract"
            ? "ДОГОВОР НА ВЫПОЛНЕНИЕ РАБОТ"
            : "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ");
      const date = docDate ? new Date(docDate).toLocaleDateString("ru-RU") : new Date().toLocaleDateString("ru-RU");
      const payload = {
        docType,
        format,
        includeImages,
        title,
        date,
        items: items
          .filter((i) => i.name.trim())
          .map((i) => ({
            ...i,
            qty: Number(i.qty) || 0,
            price: Number(i.price) || 0,
            imageUrl: i.imageUrl ? String(i.imageUrl) : undefined,
          })),
        workStages: stages.filter((s) => s.title.trim()).map((s) => ({ ...s, amount: Number(s.amount) || 0 })),
        notes: docNotes.trim(),
        notesHtml: docNotesHtml || "",
        bodyHtml: docBodyHtml || "",
        company,
      };
      const res = await fetch(`${API}/orders/${selected.id}/documents/render`, {
        method: "POST",
        headers: JH,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt ? txt.slice(0, 240) : `Ошибка генерации (${res.status})`);
      }
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u;
      a.download = `${docType}_${selected.number}.${format === "pdf" ? "pdf" : "doc"}`;
      a.click();
      URL.revokeObjectURL(u);
      showToast("Документ сформирован");
    } catch (e: any) {
      showToast(e?.message || "Ошибка генерации", false);
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {addOpen && (
        <RightSideCard
          open={true}
          onClose={() => setAddOpen(false)}
          showHeader={false}
          defaultWidth={640}
          minWidth={640}
          maxWidth={940}
          overlayClassName="bg-black/30"
        >
          <div className="w-full h-full flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-slate-900">Добавить позицию</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Добавленная позиция попадёт в <b>ордер</b> и в <b>КП</b>. Для оборудования можно автоматически добавить комплектующие (BOM).
                </p>
              </div>
              <button
                className="px-3 py-2 rounded-xl border border-slate-200 text-slate-700 bg-slate-50 hover:bg-slate-100 text-xs font-semibold"
                onClick={() => setAddOpen(false)}
              >
                Закрыть
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                {([
                  { key: "equipment", label: "Оборудование" },
                  { key: "stock", label: "Склад" },
                ] as const).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => { setAddSource(t.key as any); setAddSelectedId(""); }}
                    className={[
                      "flex-1 py-2 rounded-lg text-xs font-bold transition-all",
                      addSource === t.key ? "bg-white shadow text-slate-800" : "text-slate-500 hover:text-slate-700",
                    ].join(" ")}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-col md:flex-row gap-2">
                <input
                  value={addQ}
                  onChange={(e) => setAddQ(e.target.value)}
                  className={inputCls}
                  placeholder={addSource === "equipment" ? "Поиск по оборудованию… (бренд / модель / тип)" : "Поиск по складу… (название / категория / sku)"}
                />
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 select-none px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                  <input type="checkbox" checked={autoBom} onChange={(e) => setAutoBom(e.target.checked)} className="w-4 h-4 rounded border-slate-300" />
                  Авто-комплектующие (BOM)
                </label>
              </div>

              <div className="max-h-[340px] overflow-auto border border-slate-200 rounded-2xl">
                {(() => {
                  const qq = addQ.trim().toLowerCase();
                  const list = (addSource === "equipment"
                    ? Object.values(equipMap)
                        .filter((e: any) => e && e.id && e.active !== false)
                        .filter((e: any) => {
                          if (!qq) return true;
                          const blob = `${e.type ?? ""} ${e.brand ?? ""} ${e.model ?? ""} ${e.btu ?? ""} ${e.powerKw ?? ""}`.toLowerCase();
                          return blob.includes(qq);
                        })
                        .slice(0, 80)
                    : Object.values(warehouseMap)
                        .filter((it: any) => it && it.id)
                        .filter((it: any) => {
                          // "Склад" в продуктовой логике = расходники/комплекты, без оборудования
                          if (String(it.itemType ?? "consumable") === "equipment") return false;
                          if (!qq) return true;
                          const blob = `${it.name ?? ""} ${it.category ?? ""} ${it.sku ?? ""}`.toLowerCase();
                          return blob.includes(qq);
                        })
                        .slice(0, 80)) as any[];
                  if (list.length === 0) {
                    return <div className="p-4 text-sm text-slate-400">Ничего не найдено.</div>;
                  }
                  return (
                    <div className="divide-y divide-slate-100">
                      {list.map((it: any) => {
                        const active = String(addSelectedId) === String(it.id);
                        const t = addSource === "equipment" ? String(it.type ?? "equipment") : String(it.itemType ?? "consumable");
                        const stock = addSource === "equipment" ? undefined : Number(it.stock ?? 0);
                        return (
                          <button
                            key={it.id}
                            className={[
                              "w-full text-left px-4 py-3 flex items-start justify-between gap-3",
                              active ? "bg-blue-50" : "bg-white hover:bg-slate-50",
                            ].join(" ")}
                            onClick={() => setAddSelectedId(String(it.id))}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-800 truncate">
                                {addSource === "equipment" ? `${it.brand ?? ""} ${it.model ?? ""}`.trim() : it.name}
                              </p>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {addSource === "equipment"
                                  ? `${t}${it.btu ? ` · ${it.btu} BTU` : ""}${it.powerKw ? ` · ${it.powerKw} kW` : ""}`
                                  : `${t} · ${it.unit} · ${it.category || "—"} ${it.sku ? `· sku: ${it.sku}` : ""}`}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-sm font-black text-slate-800">{Number(it.price ?? 0)}</p>
                              {addSource === "stock" ? (
                                <p className={["text-[11px] font-semibold", (stock ?? 0) > 0 ? "text-emerald-700" : "text-slate-400"].join(" ")}>
                                  остаток: {stock}
                                </p>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setAddOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50"
                >
                  Отмена
                </button>
                <button
                  onClick={() => void (addSource === "equipment" ? addEquipmentModelToOffer() : addWarehouseItemToOffer())}
                  disabled={!addSelectedId}
                  className={[
                    "px-4 py-2 rounded-xl text-sm font-semibold",
                    addSelectedId ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-200 text-slate-500 cursor-not-allowed",
                  ].join(" ")}
                >
                  Добавить в ордер и КП
                </button>
              </div>
            </div>
          </div>
        </RightSideCard>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="size-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center">
            <FileText size={18} />
          </div>
          <div>
            <p className="text-lg font-black text-slate-900">Документы (конструктор)</p>
            <p className="text-[12px] text-slate-500">Сначала выбираем ордер, потом формируем документы внутри него.</p>
          </div>
        </div>
        <button
          onClick={() => loadOrders({ force: true })}
          disabled={loading}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Обновить
        </button>
      </div>

      <div className="mt-5 space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500">Ордер (фильтр)</p>
          <div className="mt-2 flex flex-col lg:flex-row gap-2">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex-1">
              <Search size={14} className="text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} className="bg-transparent flex-1 outline-none text-sm" placeholder="Поиск ордера…" />
            </div>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full lg:w-[520px] bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
            >
              {filtered.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.number} · {(o.client_name || "Клиент")}{o.object_address ? ` · ${o.object_address}` : ""}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">{filtered.length} ордеров</p>
        </div>

        {!selected ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 text-slate-400 text-sm">Выберите ордер сверху.</div>
        ) : (
          <>
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-800">Ордeр: {selected.number}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Документы формируются из данных этого ордера. Если уточняем данные — уточняем тут же, внутри ордера.
                    </p>
                  </div>
                  <button
                    disabled={!dirty || saving}
                    onClick={saveOrderDetails}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                      dirty ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500 cursor-not-allowed"
                    }`}
                  >
                    {saving ? "Сохранение..." : "Сохранить данные"}
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Клиент</span>
                    <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={`${inputCls} mt-1`} />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Телефон</span>
                    <input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className={`${inputCls} mt-1`} />
                  </label>
                </div>
                <div className="mt-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Адрес объекта</span>
                    <input value={address} onChange={(e) => setAddress(e.target.value)} className={`${inputCls} mt-1`} />
                  </label>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Юр.лицо / ФИО (для документов)</span>
                    <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={`${inputCls} mt-1`} placeholder="—" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">ИНН / ЕГРПОУ</span>
                    <input value={taxId} onChange={(e) => setTaxId(e.target.value)} className={`${inputCls} mt-1`} placeholder="—" />
                  </label>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Email</span>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mt-1`} placeholder="—" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Основание (договор/счет)</span>
                    <input value={basis} onChange={(e) => setBasis(e.target.value)} className={`${inputCls} mt-1`} placeholder="—" />
                  </label>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-800">Конструктор документов</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Выберите документ и сформируйте его для выбранного ордера.</p>
                  </div>
                  <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-full">
                    {docType === "offer" ? "КП" : docType === "contract" ? "Договор" : "Акт"} · {format.toUpperCase()}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Тип документа</span>
                    <select value={docType} onChange={(e) => setDocType(e.target.value as any)} className={`${inputCls} mt-1`}>
                      <option value="offer">Коммерческое предложение (КП)</option>
                      <option value="contract">Договор (шаблон)</option>
                      <option value="act">Акт выполненных работ</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Формат</span>
                    <select value={format} onChange={(e) => setFormat(e.target.value as any)} className={`${inputCls} mt-1`}>
                      <option value="pdf">PDF</option>
                      <option value="doc">DOC</option>
                    </select>
                  </label>
                </div>

                <div className="mt-3">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 select-none">
                    <input
                      type="checkbox"
                      checked={includeImages}
                      onChange={(e) => setIncludeImages(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300"
                    />
                    Включать фото оборудования в таблицу КП/акта
                  </label>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Фото берутся из карточек склада (поле <b>imageUrl</b>). Если фото нет — в таблице будет “—”.
                  </p>
                </div>

                <div className="mt-4 bg-slate-50 border border-slate-200 rounded-2xl p-3">
                  <p className="text-xs font-bold text-slate-700">Реквизиты компании (исполнитель)</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Сохраняются автоматически (локально в браузере).</p>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input value={company.name} onChange={(e) => setCompany((p) => ({ ...p, name: e.target.value }))} className={inputCls} placeholder="Название" />
                    <input value={company.city} onChange={(e) => setCompany((p) => ({ ...p, city: e.target.value }))} className={inputCls} placeholder="Город" />
                    <input value={company.address} onChange={(e) => setCompany((p) => ({ ...p, address: e.target.value }))} className={inputCls} placeholder="Адрес" />
                    <input value={company.taxId} onChange={(e) => setCompany((p) => ({ ...p, taxId: e.target.value }))} className={inputCls} placeholder="УНП/ИНН" />
                    <input value={company.iban} onChange={(e) => setCompany((p) => ({ ...p, iban: e.target.value }))} className={inputCls} placeholder="IBAN" />
                    <input value={company.bank} onChange={(e) => setCompany((p) => ({ ...p, bank: e.target.value }))} className={inputCls} placeholder="Банк" />
                    <input value={company.bic} onChange={(e) => setCompany((p) => ({ ...p, bic: e.target.value }))} className={inputCls} placeholder="БИК" />
                    <input value={company.phone} onChange={(e) => setCompany((p) => ({ ...p, phone: e.target.value }))} className={inputCls} placeholder="Телефон" />
                    <input value={company.email} onChange={(e) => setCompany((p) => ({ ...p, email: e.target.value }))} className={inputCls} placeholder="Email" />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Заголовок (опц.)</span>
                    <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} className={`${inputCls} mt-1`} placeholder="Оставьте пустым для стандартного" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-500">Дата</span>
                    <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className={`${inputCls} mt-1`} />
                  </label>
                </div>

                <div className="mt-3">
                  <p className="text-xs font-semibold text-slate-500">Позиции (можно редактировать)</p>
                  <div className="mt-2 space-y-2">
                    {items.map((it, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2">
                        <input
                          value={it.name}
                          onChange={(e) => {
                            const next = items.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x));
                            setItems(next);
                            scheduleOfferAutosave(next);
                          }}
                          className={`col-span-12 md:col-span-6 ${inputCls}`}
                          placeholder="Наименование"
                        />
                        <input
                          type="number"
                          value={it.qty}
                          onChange={(e) => {
                            const next = items.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) } : x));
                            setItems(next);
                            scheduleOfferAutosave(next);
                          }}
                          className={`col-span-4 md:col-span-2 ${inputCls}`}
                          placeholder="qty"
                        />
                        <input
                          value={it.unit}
                          onChange={(e) => {
                            const next = items.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x));
                            setItems(next);
                            scheduleOfferAutosave(next);
                          }}
                          className={`col-span-4 md:col-span-2 ${inputCls}`}
                          placeholder="ед."
                        />
                        <input
                          type="number"
                          value={it.price}
                          onChange={(e) => {
                            const next = items.map((x, i) => (i === idx ? { ...x, price: Number(e.target.value) } : x));
                            setItems(next);
                            scheduleOfferAutosave(next);
                          }}
                          className={`col-span-4 md:col-span-2 ${inputCls}`}
                          placeholder="цена"
                        />
                        <button
                          onClick={() => {
                            const next = items.filter((_, i) => i !== idx);
                            setItems(next.length ? next : [{ name: "", qty: 1, unit: "шт", price: 0 }]);
                            scheduleOfferAutosave(next.length ? next : [{ name: "", qty: 1, unit: "шт", price: 0 }]);
                          }}
                          className="col-span-12 md:col-span-12 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 hover:bg-red-100 flex items-center gap-2 justify-center"
                        >
                          <Trash2 size={14} /> Удалить строку
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setAddOpen(true)}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <Plus size={14} /> Добавить позицию
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-xs font-semibold text-slate-500">Этапы работ (опц.)</p>
                  <div className="mt-2 space-y-2">
                    {stages.map((st, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2">
                        <input
                          value={st.title}
                          onChange={(e) => setStages((p) => p.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))}
                          className={`col-span-12 md:col-span-8 ${inputCls}`}
                          placeholder="Например: Монтаж внутреннего блока"
                        />
                        <input
                          type="number"
                          value={st.amount}
                          onChange={(e) => setStages((p) => p.map((x, i) => (i === idx ? { ...x, amount: Number(e.target.value) } : x)))}
                          className={`col-span-12 md:col-span-4 ${inputCls}`}
                          placeholder="сумма"
                        />
                        <button
                          onClick={() => setStages((p) => p.filter((_, i) => i !== idx))}
                          className="col-span-12 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 hover:bg-red-100 flex items-center gap-2 justify-center"
                        >
                          <Trash2 size={14} /> Удалить этап
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setStages((p) => [...p, { title: "", amount: 0 }])}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <Plus size={14} /> Добавить этап
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="text-sm font-extrabold text-slate-800 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                    Итого{vatEnabled ? " с НДС" : ""}: {fmtShort(total + (vatEnabled ? (total * (Math.max(0, Number(vatPercent) || 0))) / 100 : 0))}
                    <div className="text-[11px] text-slate-500 font-semibold mt-0.5">
                      позиции: {fmtShort(Math.round(totalItems * 100) / 100)} · этапы: {fmtShort(Math.round(totalStages * 100) / 100)}
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[11px] font-semibold text-slate-600">
                      <label className="inline-flex items-center gap-2 select-none">
                        <input
                          type="checkbox"
                          checked={vatEnabled}
                          onChange={(e) => setVatEnabled(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-300"
                        />
                        С учётом НДС {Math.max(0, Number(vatPercent) || 0)}%
                      </label>
                    </div>
                  </div>
                  <button
                    disabled={rendering}
                    onClick={renderAndDownload}
                    className={`rounded-2xl px-4 py-3 font-extrabold text-white flex items-center justify-center gap-2 ${
                      rendering ? "bg-slate-300 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    {rendering ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
                    {rendering ? "Формирование…" : "Сформировать и скачать"}
                  </button>
                </div>

                <div className="mt-3">
                  <p className="text-xs font-semibold text-slate-500">Комментарий (редактор)</p>
                  <div className="mt-2 bg-slate-50 border border-slate-200 rounded-2xl p-2">
                    <div className="flex flex-wrap gap-2 mb-2">
                      <button
                        type="button"
                        onClick={() => notesEditor?.chain().focus().toggleBold().run()}
                        className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50"
                      >
                        B
                      </button>
                      <button
                        type="button"
                        onClick={() => notesEditor?.chain().focus().toggleItalic().run()}
                        className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50 italic"
                      >
                        I
                      </button>
                      <button
                        type="button"
                        onClick={() => notesEditor?.chain().focus().toggleBulletList().run()}
                        className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50"
                      >
                        • Список
                      </button>
                      <button
                        type="button"
                        onClick={() => notesEditor?.chain().focus().toggleHeading({ level: 3 }).run()}
                        className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50"
                      >
                        H3
                      </button>
                    </div>
                    <EditorContent editor={notesEditor} />
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-xs font-semibold text-slate-500">Тело документа (шаблон + редактор)</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Пишите текст прямо здесь. Можно вставлять маркеры: <b>{"{{ITEMS_TABLE}}"}</b>, <b>{"{{WORK_STAGES}}"}</b>, <b>{"{{TOTALS}}"}</b>, <b>{"{{CLIENT_BLOCK}}"}</b>.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!selected) return;
                        const isLegal = Boolean((selected.client_legal_name ?? "").trim());
                        const ok = window.confirm("Сбросить тело документа на стандартный шаблон? Текущий текст будет заменён.");
                        if (!ok) return;
                        setDocBodyHtml(getDefaultTemplate(docType, isLegal));
                        showToast("Шаблон сброшен на стандартный");
                      }}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Сбросить на стандартный
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const ok = window.confirm("Сохранить текущий текст как ваш шаблон для этого типа документа?");
                        if (!ok) return;
                        const okSave = saveUserTemplate(docType, docBodyHtml || "");
                        showToast(okSave ? "Шаблон сохранён" : "Не удалось сохранить шаблон", okSave);
                      }}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Сохранить как мой шаблон
                    </button>
                    <button
                      type="button"
                      disabled={!userTemplateExists}
                      onClick={() => {
                        const raw = loadUserTemplate(docType);
                        if (!raw.trim()) return;
                        const ok = window.confirm("Применить сохранённый шаблон? Текущий текст будет заменён.");
                        if (!ok) return;
                        setDocBodyHtml(raw);
                        showToast("Применён сохранённый шаблон");
                      }}
                      className={`px-3 py-2 rounded-xl border text-xs font-semibold ${
                        userTemplateExists ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                      }`}
                    >
                      Применить мой шаблон
                    </button>
                    <button
                      type="button"
                      disabled={!userTemplateExists}
                      onClick={() => {
                        const ok = window.confirm("Удалить сохранённый шаблон для этого типа документа?");
                        if (!ok) return;
                        const okDel = clearUserTemplate(docType);
                        showToast(okDel ? "Сохранённый шаблон удалён" : "Не удалось удалить шаблон", okDel);
                      }}
                      className={`px-3 py-2 rounded-xl border text-xs font-semibold ${
                        userTemplateExists ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100" : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                      }`}
                    >
                      Удалить мой шаблон
                    </button>
                  </div>
                  <div className="mt-2 bg-slate-50 border border-slate-200 rounded-2xl p-2">
                    <div className="flex flex-wrap gap-2 mb-2">
                      <button type="button" onClick={() => bodyEditor?.chain().focus().toggleBold().run()} className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50">B</button>
                      <button type="button" onClick={() => bodyEditor?.chain().focus().toggleItalic().run()} className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50 italic">I</button>
                      <button type="button" onClick={() => bodyEditor?.chain().focus().toggleBulletList().run()} className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50">• Список</button>
                      <button type="button" onClick={() => bodyEditor?.chain().focus().toggleHeading({ level: 3 }).run()} className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50">H3</button>
                      <span className="w-px bg-slate-200 mx-1" />
                      <button type="button" onClick={() => insertIntoBody("{{COMPANY_BLOCK}}")} className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50">+ Реквизиты</button>
                      <button type="button" onClick={() => insertIntoBody("{{CLIENT_BLOCK}}")} className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50">+ Клиент</button>
                      <button type="button" onClick={() => insertIntoBody("{{ITEMS_TABLE}}")} className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50">+ Таблица</button>
                      <button type="button" onClick={() => insertIntoBody("{{TOTALS}}")} className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50">+ Итоги</button>
                      <button type="button" onClick={() => insertIntoBody("{{NOTES}}")} className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50">+ Комментарий</button>
                      <button type="button" onClick={() => insertIntoBody("<p style='margin-top:22px;border-top:1px solid #e5e7eb;padding-top:10px;'>Исполнитель: ____________________</p><p style='border-top:1px solid #e5e7eb;padding-top:10px;'>Заказчик: ____________________</p>")} className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold hover:bg-slate-50">+ Подписи</button>
                    </div>
                    <EditorContent editor={bodyEditor} />
                  </div>
                </div>

                <div className="mt-3 text-[11px] text-slate-400">
                  Быстрые кнопки ниже оставил для отладки (старые GET эндпоинты). Основной сценарий — через конструктор.
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => makeOfferPdf().catch((e: any) => showToast(e?.message || "Ошибка", false))}
                    className="px-3 py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 text-xs font-semibold hover:bg-blue-100"
                  >
                    Быстро: КП PDF (GET)
                  </button>
                  <button
                    onClick={() => makeActPdf().catch((e: any) => showToast(e?.message || "Ошибка", false))}
                    className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-xs font-semibold hover:bg-slate-100"
                  >
                    Быстро: Акт PDF (GET)
                  </button>
                </div>
              </div>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-800">Предпросмотр</span>
                  <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                    {docType === "offer" ? "КП" : "Акт"}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">обновляется автоматически</span>
              </div>
              <div className="bg-slate-100 p-3 overflow-auto">
                <div className="mx-auto w-[794px] bg-white shadow rounded-xl overflow-hidden">
                  <iframe
                    title="doc-preview"
                    className="w-full h-[980px] bg-white"
                    sandbox="allow-same-origin"
                    srcDoc={previewHtml || "<div style='padding:24px;font-family:Arial'>Нет предпросмотра</div>"}
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-2">
                  Это живой HTML‑предпросмотр. Скачивание PDF/DOC — кнопкой «Сформировать и скачать».
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-5 right-5 z-[100]`}>
          <div className={`px-4 py-3 rounded-2xl shadow-lg border text-sm font-semibold flex items-center gap-2 ${
            toast.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
          }`}>
            <CheckCircle2 size={16} /> {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}

