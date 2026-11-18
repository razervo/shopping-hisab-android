export function inr(amount, opts = {}) {
  const n = Number(amount) || 0;
  const rounded = Math.round(n * 100) / 100;
  return `₹${rounded.toLocaleString("en-IN", {
    minimumFractionDigits: opts.decimals ? 2 : rounded % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function todayISO() {
  const d = new Date();
  return toISO(d);
}

export function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// YYYY-MM-DD -> DD/MM/YYYY
export function ddmmyyyy(iso) {
  if (!iso) return "";
  const parts = String(iso).slice(0, 10).split("-");
  if (parts.length !== 3) return String(iso);
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

export function prettyDate(iso) {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ddmmyyyy(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function monthStartISO(date = new Date()) {
  return toISO(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toISO(d);
}

export function formatQty(qty, unit) {
  const q = Number(qty) || 0;
  const n = q % 1 === 0 ? String(q) : String(q);
  return unit ? `${n} ${unit}` : n;
}