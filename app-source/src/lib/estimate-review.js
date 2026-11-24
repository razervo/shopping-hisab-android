const LIQUID_ITEM_RE = /\b(milk|oil|juice|water|soda|shampoo|detergent|liquid)\b/i;
const WEIGHT_ITEM_RE = /\b(rice|sugar|flour|atta|dal|lentil|potato|onion|tomato|wheat|salt|spice|masala)\b/i;
const PACKED_ITEM_RE = /\b(pack|packet|pouch|bottle|carton|tin|jar|sachet|box|bag)\b/i;
const MASS_UNITS = new Set(["g", "gram", "grams", "kg", "kilogram", "kilograms"]);
const VOLUME_UNITS = new Set(["ml", "milliliter", "milliliters", "l", "liter", "litre", "liters", "litres"]);

export function reviewEstimateItems(items = []) {
  const warnings = [];
  const normalizedNames = new Map();
  for (const item of items) {
    const normalized = normalizedName(item?.product_name);
    if (normalized) normalizedNames.set(normalized, [...(normalizedNames.get(normalized) || []), item]);
  }
  for (const item of items) {
    const itemName = String(item?.product_name || "Unnamed item").trim() || "Unnamed item";
    const id = item?.id;
    const quantity = Number(item?.planned_quantity);
    const unit = String(item?.unit || "pcs").trim().toLowerCase();
    const packSize = String(item?.pack_size || "").trim();
    const add = (message) => warnings.push({ itemId: id, itemName, message });
    if (!Number.isFinite(quantity) || quantity <= 0) add("Quantity is zero or invalid. Check the planned amount.");
    else if (quantity > 1000) add("Quantity is unusually large. Check the number and unit.");
    if (LIQUID_ITEM_RE.test(itemName) && MASS_UNITS.has(unit)) add("This is usually measured by volume (ml/L). Check the unit.");
    if (WEIGHT_ITEM_RE.test(itemName) && VOLUME_UNITS.has(unit)) add("This is usually measured by weight (g/kg). Check the unit.");
    if (PACKED_ITEM_RE.test(itemName) && !packSize) add("Packaged item detected, but pack size is missing. Add a pack size if price depends on it.");
    const duplicates = normalizedNames.get(normalizedName(itemName)) || [];
    if (duplicates.length > 1 && duplicates.some((candidate) => candidate?.id !== id)) {
      add("Another list item has the same name. Check whether these should be merged or kept separate.");
    }
  }
  return warnings;
}

function normalizedName(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
