export function sortShoppingListItems(items = [], sortMode = "category") {
  const copy = [...items];
  if (sortMode === "name") return copy.sort((a, b) => String(a.product_name || "").localeCompare(String(b.product_name || ""), undefined, { sensitivity: "base" }));
  if (sortMode === "remaining") return copy.sort((a, b) => Number(b.remaining_quantity ?? b.planned_quantity ?? 0) - Number(a.remaining_quantity ?? a.planned_quantity ?? 0));
  if (sortMode === "planned") return copy.sort((a, b) => Number(b.planned_quantity || 0) - Number(a.planned_quantity || 0));
  return copy;
}

export function findDuplicateShoppingNames(existingItems = [], incomingNames = []) {
  const normalize = (name) => String(name || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
  const existing = new Set(existingItems.filter((item) => item?.item_status !== "cancelled").map((item) => normalize(item?.product_name)).filter(Boolean));
  const seenIncoming = new Set();
  const duplicates = [];
  for (const name of incomingNames) {
    const key = normalize(name);
    if (!key) continue;
    if (existing.has(key) || seenIncoming.has(key)) duplicates.push(String(name).trim());
    seenIncoming.add(key);
  }
  return [...new Set(duplicates)];
}

export function parseVoiceShoppingItems(transcript) {
  return String(transcript || "")
    .replace(/^\s*(add|please add|i need|we need|buy)\s+/i, "")
    .split(/[,;\n]+|\s+and\s+/i)
    .map((name) => name.trim().replace(/[.!?]+$/, ""))
    .filter(Boolean);
}

const CATEGORY_RULES = [
  ["Produce", /\b(apple|banana|orange|mango|tomato(?:es)?|potato(?:es)?|onions?|garlic|ginger|spinach|cabbage|carrot|cucumber|lemon|chilli|pepper|vegetables?|fruits?|okra|brinjal|cauliflower|broccoli|peas|beans)\b/i],
  ["Dairy & Eggs", /\b(milk|curd|yogurt|paneer|cheese|butter|ghee|cream|egg|eggs)\b/i],
  ["Bakery", /\b(bread|bun|cake|biscuit|cookie|rusk|toast|bakery|pav)\b/i],
  ["Meat & Seafood", /\b(chicken|fish|mutton|beef|pork|meat|prawn|shrimp|crab)\b/i],
  ["Beverages", /\b(tea|coffee|juice|water|soft drink|soda|cola|drink|milkshake)\b/i],
  ["Personal Care", /\b(soap|shampoo|toothpaste|toothbrush|sanitary|cream|lotion|deodorant|hair oil|face wash)\b/i],
  ["Household", /\b(detergent|washing powder|dishwash|cleaner|tissue|toilet paper|broom|mop|bucket|sponge|garbage bag|candle|battery)\b/i],
  ["Pantry", /\b(rice|dal|lentil|flour|atta|sugar|salt|oil|masala|spice|noodle|pasta|pulse|cereal|cornflakes|snack|chips|biscuits|pickle|sauce)\b/i],
];
export const SHOPPING_CATEGORIES = ["Produce", "Dairy & Eggs", "Bakery", "Meat & Seafood", "Beverages", "Personal Care", "Household", "Pantry", "Other"];

export function inferShoppingCategory(name) {
  const text = String(name || "").trim();
  if (!text) return "Other";
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(text)) return category;
  }
  return "Other";
}

export function resolveShoppingCategory(item, overrides = {}) {
  const override = overrides?.[item?.id];
  return SHOPPING_CATEGORIES.includes(override) ? override : inferShoppingCategory(item?.product_name);
}

export function groupShoppingItems(items = [], overrides = {}) {
  const groups = new Map();
  for (const item of items) {
    const category = resolveShoppingCategory(item, overrides);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => SHOPPING_CATEGORIES.indexOf(a) - SHOPPING_CATEGORIES.indexOf(b));
}

export function filterShoppingListItems(items = [], search = "", filter = "all") {
  const normalizedSearch = String(search || "").trim().toLowerCase();
  return items.filter((item) => {
    const nameMatches = !normalizedSearch || String(item?.product_name || "").toLowerCase().includes(normalizedSearch);
    const remaining = item?.item_status !== "cancelled" && Number(item?.remaining_quantity ?? item?.planned_quantity) > 0;
    const purchased = item?.item_status !== "cancelled" && !remaining;
    const filterMatches = filter === "all" || (filter === "remaining" && remaining) || (filter === "purchased" && purchased);
    return nameMatches && filterMatches;
  });
}
