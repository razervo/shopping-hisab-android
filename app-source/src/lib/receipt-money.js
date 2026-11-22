// Parse an amount read from a receipt while tolerating common Indian currency formatting.
export function parseReceiptMoney(value) {
  if (value == null || String(value).trim() === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;

  let normalized = String(value).trim();
  if (normalized.endsWith("/-")) normalized = normalized.slice(0, -2);
  normalized = normalized.toUpperCase()
    .replaceAll("INR", "")
    .replaceAll("RS.", "")
    .replaceAll("RS", "")
    .replaceAll("₹", "")
    .replaceAll(",", "")
    .replaceAll(" ", "")
    .replaceAll("\t", "")
    .replaceAll("\n", "")
    .replaceAll("\r", "");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
