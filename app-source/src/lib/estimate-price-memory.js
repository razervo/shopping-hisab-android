const STORAGE_KEY = "shopping-hisab-estimate-price-memory-v1";

export function estimatePriceMemoryKey(item = {}) {
  const normalize = (value) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const name = normalize(item.product_name || item.name);
  const brand = normalize(item.brand);
  const pack = normalize(item.pack_size);
  const unit = normalize(item.unit || "pcs");
  if (!name || !pack || !unit) return null;
  return [name, brand, pack, unit].join("|");
}

export function readEstimatePriceMemory(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberEstimatePrices(items = [], prices = {}, storage = globalThis.localStorage) {
  try {
    const memory = readEstimatePriceMemory(storage);
    for (const item of items) {
      const key = estimatePriceMemoryKey(item);
      const value = prices[item.id];
      const price = Number(value);
      if (key && value != null && String(value).trim() !== "" && Number.isFinite(price) && price >= 0) {
        memory[key] = { price, saved_at: new Date().toISOString() };
      }
    }
    storage?.setItem(STORAGE_KEY, JSON.stringify(memory));
    return true;
  } catch {
    return false;
  }
}

export function findRememberedEstimatePrices(items = [], storage = globalThis.localStorage) {
  const memory = readEstimatePriceMemory(storage);
  const results = {};
  for (const item of items) {
    const key = estimatePriceMemoryKey(item);
    const saved = key ? memory[key] : null;
    if (saved && Number.isFinite(Number(saved.price)) && Number(saved.price) >= 0) results[item.id] = String(saved.price);
  }
  return results;
}
