const FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;
const MASS = { g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000 };
const VOLUME = { ml: 1, milliliter: 1, milliliters: 1, l: 1000, litre: 1000, liter: 1000, litres: 1000, liters: 1000 };
const COUNT = { pcs: 1, pc: 1, piece: 1, pieces: 1, unit: 1, units: 1, pack: 1, packs: 1 };
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const normUnit = (u) => String(u ?? "").toLowerCase().trim();
function parsePackSize(text) {
  const match = String(text ?? "").toLowerCase().match(/(\d+(?:\.\d+)?)\s*(kg|kilograms?|g|grams?|l|litres?|liters?|ml|milliliters?|pcs?|pieces?|units?)/);
  if (!match) return null;
  const amount = Number(match[1]), unit = normUnit(match[2]), factor = MASS[unit] ?? VOLUME[unit] ?? COUNT[unit];
  const dimension = MASS[unit] !== undefined ? "mass" : VOLUME[unit] !== undefined ? "volume" : "count";
  if (!Number.isFinite(amount) || amount <= 0 || !factor) return null;
  return { baseAmount: amount * factor, dimension };
}
function itemPack(item) { return parsePackSize(item?.pack_size || item?.quantity_text || item?.product_name || ""); }
function tokens(s) { return norm(s).split(" ").filter((x) => x.length > 1); }
function isNameCompatible(actual, offer) {
  const a = tokens(actual?.product_name || actual?.name), b = tokens(offer?.product_name || offer?.title);
  if (!a.length || !b.length) return false;
  const overlap = a.filter((t) => b.includes(t)).length;
  return overlap >= Math.max(1, Math.min(a.length, b.length) - 1) && overlap / Math.max(a.length, b.length) >= 0.75;
}
function compareOffer(actual, offer, now = Date.now()) {
  const fail = (reason) => ({ status: "unverified", reason, offer });
  if (!offer || offer.verified !== true) return fail("Offer is not marked as verified.");
  if (!offer.source_url || !/^https?:\/\//i.test(String(offer.source_url))) return fail("Offer source link is missing.");
  if (!Number.isFinite(Number(offer.price_paise)) || Number(offer.price_paise) <= 0) return fail("Price is invalid.");
  const checked = Date.parse(offer.checked_at || "");
  if (!Number.isFinite(checked) || checked > now || now - checked > FRESHNESS_MS) return fail("Price check is missing, in the future, or older than 7 days.");
  if (norm(actual?.brand) !== norm(offer.brand)) return fail("Brand does not match exactly.");
  if (!isNameCompatible(actual, offer)) return fail("Product name or variant is not a sufficiently close match.");
  const aPack = itemPack(actual), oPack = itemPack(offer);
  if (!aPack || !oPack || aPack.dimension !== oPack.dimension) return fail("Pack size or unit cannot be compared safely.");
  if (Math.abs(aPack.baseAmount - oPack.baseAmount) > Math.max(0.0001, aPack.baseAmount * 0.005)) return fail("Pack size differs; no pack-size conversion comparison is shown.");
  const quantity = Math.max(1, Number(actual?.quantity ?? actual?.planned_quantity ?? 1));
  const actualPrice = Number(actual?.actual_price_paise ?? actual?.paid_price_paise);
  if (!Number.isFinite(actualPrice) || actualPrice <= 0) return fail("Actual purchase price is missing.");
  const actualLine = actualPrice * quantity, offerLine = Number(offer.price_paise) * quantity;
  return { status: "comparable", quantity, actual_line_paise: actualLine, offer_line_paise: offerLine, difference_paise: actualLine - offerLine, cheaper: offerLine < actualLine, source_url: offer.source_url, checked_at: offer.checked_at, offer_price_paise: Number(offer.price_paise) };
}
export function compareShoppingBasket(actualItems = [], offersByItem = {}, now = Date.now()) {
  const rows = actualItems.map((actual) => {
    const candidates = Array.isArray(offersByItem?.[actual?.id]) ? offersByItem[actual.id] : [];
    const comparisons = candidates.map((offer) => compareOffer(actual, offer, now)).filter((r) => r.status === "comparable");
    const best = comparisons.sort((a, b) => a.offer_line_paise - b.offer_line_paise)[0] || null;
    return { item_id: actual?.id ?? null, product_name: actual?.product_name || actual?.name || "Unnamed item", status: best ? "comparable" : "no_comparable_result", comparison: best, rejected_candidates: candidates.length - comparisons.length };
  });
  const comparable = rows.filter((r) => r.comparison);
  const actualTotal = comparable.reduce((sum, r) => sum + r.comparison.actual_line_paise, 0), onlineTotal = comparable.reduce((sum, r) => sum + r.comparison.offer_line_paise, 0);
  return { rows, comparable_count: comparable.length, no_match_count: rows.length - comparable.length, comparable_actual_total_paise: actualTotal, comparable_online_total_paise: onlineTotal, potential_difference_paise: actualTotal - onlineTotal, note: "Only verified, fresh, exact-brand and same-pack offers are included. This is a partial basket when some items have no comparable result." };
}
export function retailerSearchLinks(productName) {
  const query = encodeURIComponent(String(productName ?? "").trim());
  if (!query) return [];
  return [{ retailer: "Google Shopping", url: `https://www.google.com/search?tbm=shop&q=${query}` }, { retailer: "BigBasket", url: `https://www.bigbasket.com/ps/?q=${query}` }, { retailer: "Amazon India", url: `https://www.amazon.in/s?k=${query}` }];
}
