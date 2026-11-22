// Estimate totals are calculated in paise so client-supplied totals cannot override the server result.
export function calculateEstimateLineTotalPaise(quantity, unitPricePaise) {
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise < 0) return null;

  const totalPaise = Math.round(quantity * unitPricePaise);
  return Number.isSafeInteger(totalPaise) && totalPaise >= 0 ? totalPaise : null;
}
