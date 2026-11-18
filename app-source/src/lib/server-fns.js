import { base44 } from "@/api/base44Client";

async function invokeShoppingAI(action, args = {}) {
  const payload = args?.data ?? args ?? {};
  const response = await base44.functions.invoke("shopping-ai", { action, ...payload });
  return response?.data ?? response;
}

export const readShoppingBill = (args) => invokeShoppingAI("readShoppingBill", args);
export const suggestMarketRate = (args) => invokeShoppingAI("suggestMarketRate", args);
export const estimateMarketRates = (args) => invokeShoppingAI("estimateMarketRates", args);
