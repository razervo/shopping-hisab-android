import { todayISO } from "@/lib/format";

export const UNIT_OPTIONS = ["pcs", "kg", "g", "L", "ml", "pkt", "dozen", "box"];

export const UNIT_LABELS = {
  pcs: "Piece (pcs)",
  kg: "Kilogram (kg)",
  g: "Gram (g)",
  L: "Litre (L)",
  ml: "Millilitre (ml)",
  pkt: "Packet (pkt)",
  dozen: "Dozen",
  box: "Box",
};

// Common quantities offered in the Qty dropdown, per unit.
export function qtyOptions(unit) {
  const u = String(unit || "").toLowerCase();
  if (u === "g" || u === "ml") return [100, 250, 500, 750, 1000];
  if (u === "kg" || u === "l") return [0.25, 0.5, 1, 1.5, 2, 5];
  if (u === "dozen") return [1, 2, 3];
  return [1, 2, 3, 4, 6, 10, 12];
}

export function normalizeShoppingUnit(value) {
  const key = String(value || "").trim().toLowerCase().replace(/\\s+/g, "");
  const aliases = {
    gm: "g", gms: "g", gram: "g", grams: "g",
    kilo: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg",
    litre: "L", liter: "L", litres: "L", liters: "L", ltr: "L",
    millilitre: "ml", milliliter: "ml", millilitres: "ml", milliliters: "ml",
    packet: "pkt", packets: "pkt", pack: "pkt", packs: "pkt",
    piece: "pcs", pieces: "pcs", pc: "pcs",
  };
  return aliases[key] || (key === "l" ? "L" : key);
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function amountOf(item) {
  return round2((Number(item?.qty) || 0) * (Number(item?.price) || 0));
}

export function totalOf(items) {
  return round2((items || []).reduce((sum, item) => sum + amountOf(item), 0));
}

export function cleanItems(items) {
  return (items || [])
    .filter((i) => String(i.name || "").trim() !== "" || Number(i.amount) > 0)
    .map((i) => ({
      name: String(i.name || "").trim() || "Item",
      qty: Number(i.qty) || 0,
      unit: normalizeShoppingUnit(i.unit || ""),
      price: round2(i.price),
      ...(Number(i.estimatedPrice ?? i.estimated_price) > 0
        ? { estimated_price: round2(i.estimatedPrice ?? i.estimated_price) }
        : {}),
      amount: amountOf(i) || round2(i.amount),
      ...(i.productType ? { product_type: i.productType } : {}),
      ...(i.brand ? { brand: String(i.brand).trim() } : {}),
      ...(i.packSize ? { pack_size: String(i.packSize).trim() } : {}),
      ...(Array.isArray(i.receiptRefs) && i.receiptRefs.length ? { receipt_refs: i.receiptRefs } : {}),
    }));
}

export function emptyItem() {
  return { id: Math.random().toString(36).slice(2), name: "", qty: 1, unit: "pcs", price: "", estimatedPrice: "", amount: "" };
}

export function toFormItems(items) {
  return (items || []).map((i, idx) => ({
    id: i.id || `i${idx}-${Math.random().toString(36).slice(2, 6)}`,
    name: i.name || "",
    qty: i.qty ?? 1,
    unit: normalizeShoppingUnit(i.unit || "pcs"),
    price: i.price ?? "",
    estimatedPrice: i.estimated_price ?? i.estimatedPrice ?? "",
    amount: i.amount ?? "",
    productType: i.product_type ?? i.productType ?? "unsure",
    brand: i.brand ?? "",
    packSize: i.pack_size ?? i.packSize ?? "",
    receiptRefs: i.receipt_refs ?? i.receiptRefs ?? [],
  }));
}

export function buildPayload({ shopName, date, notes, items, source, billFileUri, receipts = [], reconciliationStatus = "not_required" }) {
  const cleaned = cleanItems(items);
  return {
    shop_name: String(shopName || "").trim(),
    date: date || todayISO(),
    notes: String(notes || "").trim(),
    items: cleaned,
    item_count: cleaned.length,
    total: round2(cleaned.reduce((s, i) => s + (Number(i.amount) || 0), 0)),
    source: source || "manual",
    ...(billFileUri ? { bill_file_uri: billFileUri } : {}),
    receipts,
    reconciliation_status: reconciliationStatus,
  };
}