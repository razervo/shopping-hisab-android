export function applyManualShoppingOrder(items = [], orderedIds = []) {
  const positions = new Map(orderedIds.map((id, index) => [String(id), index]));
  return [...items].sort((a, b) => {
    const pa = positions.has(String(a.id)) ? positions.get(String(a.id)) : Number.MAX_SAFE_INTEGER;
    const pb = positions.has(String(b.id)) ? positions.get(String(b.id)) : Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
}

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
  const cleaned = String(transcript || "")
    .replace(/^\s*(add|please add|i need|we need|i want|we want|buy|shopping list)\s+/i, "")
    .replace(/\s+(?:and|then)\s+/gi, ",");
  const unitPattern = "(kg|kgs|kilo|kilogram|g|gm|gms|gram|grams|l|ltr|litre|liter|ml|pcs|piece|pieces|pkt|packet|pack|dozen|box)";
  const normalizeUnit = (value) => {
    const key = String(value || "").toLowerCase();
    if (/^(kg|kgs|kilo|kilogram)$/.test(key)) return "kg";
    if (/^(g|gm|gms|gram|grams)$/.test(key)) return "g";
    if (/^(l|ltr|litre|liter)$/.test(key)) return "L";
    if (/^ml$/.test(key)) return "ml";
    if (/^(piece|pieces|pcs)$/.test(key)) return "pcs";
    if (/^(pkt|packet|pack)$/.test(key)) return "pkt";
    return key === "dozen" ? "dozen" : "box";
  };
  return cleaned.split(/[,;\n]+/).map((raw) => {
    const item = raw.trim().replace(/^[\s-]+|[.!?]+$/g, "");
    if (!item) return null;
    const reverse = item.match(new RegExp("^\\d+(?:\\.\\d+)?\\s*" + unitPattern + "\\s+(.+)$", "i"));
    if (reverse) {
      const prefix = item.match(new RegExp("^(\\d+(?:\\.\\d+)?)\\s*" + unitPattern, "i"));
      return { name: reverse[1].trim(), quantity: Number(prefix[1]), unit: normalizeUnit(prefix[2]) };
    }
    const suffix = item.match(new RegExp("^(.*?)\\s+(\\d+(?:\\.\\d+)?)\\s*" + unitPattern + "$", "i"));
    return { name: suffix ? suffix[1].trim() : item, quantity: suffix ? Number(suffix[2]) : 1, unit: suffix ? normalizeUnit(suffix[3]) : "pcs" };
  }).filter((item) => item && item.name);
}