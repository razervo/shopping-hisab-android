const STORAGE_KEY = "shopping-hisab-estimate-price-memory-v1";

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizePack(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(kg|g|gram|grams|l|lt|liter|litre|ml|milliliter|millilitre)$/i);
  if (!match) return normalize(raw);
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "kg") return String(amount * 1000) + "g";
  if (unit === "gram" || unit === "grams") return String(amount) + "g";
  if (unit === "l" || unit === "lt" || unit === "liter" || unit === "litre") return String(amount * 1000) + "ml";
  if (unit === "milliliter" || unit === "millilitre") return String(amount) + "ml";
  return String(amount) + unit;
}

export function estimatePriceMemoryKey(item = {}) {
  const name = normalize(item.product_name || item.name);
  const brand = normalize(item.brand);
  const pack = normalizePack(item.pack_size);
  const unit = normalize(item.unit || "pcs");
  if (!name || !unit) return null;
  return [name, brand, pack, unit].join("|");
}

export function readEstimatePriceMemory(storage) {
  try {
    const safeStorage = storage ?? globalThis.localStorage;
    const raw = safeStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberEstimatePrices(items = [], prices = {}, storage) {
  try {
    const safeStorage = storage ?? globalThis.localStorage;
    const memory = readEstimatePriceMemory(safeStorage);
    for (const item of items) {
      const key = estimatePriceMemoryKey(item);
      const value = prices[item.id];
      const price = Number(value);
      if (key && value != null && String(value).trim() !== "" && Number.isFinite(price) && price >= 0) {
        memory[key] = { price, saved_at: new Date().toISOString() };
      }
    }
    safeStorage?.setItem(STORAGE_KEY, JSON.stringify(memory));
    return true;
  } catch {
    return false;
  }
}

export function findRememberedEstimatePrices(items = [], storage) {
  const memory = readEstimatePriceMemory(storage);
  const results = {};
  for (const item of items) {
    const key = estimatePriceMemoryKey(item);
    const saved = key ? memory[key] : null;
    if (saved && Number.isFinite(Number(saved.price)) && Number(saved.price) >= 0) results[item.id] = String(saved.price);
  }
  return results;
}
