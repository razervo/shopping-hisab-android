import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";

const billSchema = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    shop_name: { type: "string" },
    date: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          qty: { type: "number" },
          unit: { type: "string" },
          price: { type: "number" },
          amount: { type: "number" },
        },
        required: ["name", "qty", "price", "amount"],
        additionalProperties: false,
      },
    },
    total: { type: "number" },
    notes: { type: "string" },
  },
  required: ["readable", "shop_name", "date", "items", "total", "notes"],
  additionalProperties: false,
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};

// Reads a shopping bill photo / PDF with a vision model and returns a draft the
// user reviews before anything is saved. Signed-in callers only.
export const readShoppingBill = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(
    z.object({
      fileUri: z.string().min(1).max(1500),
      purpose: z.enum(["shopping_list", "priced_list"]).optional().default("shopping_list"),
    }),
  )
  .handler(async ({ data, context }) => {
    const base44 = context.getBase44();

    let fileUrl = data.fileUri;
    try {
      const signed = await base44.integrations.Core.CreateFileSignedUrl({
        file_uri: data.fileUri,
        expires_in: 900,
      });
      if (signed?.signed_url) fileUrl = signed.signed_url;
    } catch {
      // fall back to the raw uri
    }

    const today = new Date().toISOString().slice(0, 10);
    const isPricedList = data.purpose === "priced_list";
    const prompt = isPricedList
      ? `You are reading a photo or PDF of an Indian shopping list completed at the shop with actual prices, or an itemized store bill.
Extract only information visible in the image. Today's date is ${today}; use a printed date if present, otherwise use ${today}.
Rules:
- shop_name: shop name if printed, otherwise "".
- date: date as YYYY-MM-DD; convert Indian day-first dates correctly.
- items: extract every listed item. name is the item name; qty is numeric quantity (default 1); unit is kg, g, L, ml, pcs, pkt, dozen, etc. price is the ACTUAL rate for exactly ONE unit. amount is the actual line total. If only a line total is written, derive price = amount / qty. If a per-unit rate is written but no line total is shown, calculate amount = qty x price. If no price is visible, set price=0 and amount=0. Never invent or estimate a missing actual price.
- total: printed bill total if visible, otherwise sum visible line amounts; use 0 if neither exists.
- notes: printed discount, tax or other note, otherwise "".
- readable: true when at least one item name can be read, even if some prices are missing. Return false only when no item names can be read.
Only return the JSON object.`
      : `You are reading a photo or PDF of an Indian shopping list BEFORE shopping. It may be handwritten or printed and may contain item names, quantities and units but NO prices.
Extract the planned shopping items exactly as visible. Today's date is ${today}; use a printed date if present, otherwise use ${today}.
Rules:
- shop_name: blank for a planned list unless clearly written.
- date: printed date as YYYY-MM-DD or ${today}; convert Indian day-first dates correctly.
- items: extract every planned item. name is item name; qty is numeric quantity (default 1); unit is kg, g, L, ml, pcs, pkt, dozen, etc. If no quantity is shown, use 1. price and amount must be 0 when no price is printed. Do NOT estimate or invent prices in this step.
- If an actual price is already written beside an item, extract it as price per one unit and calculate its line amount.
- total: sum only visible line amounts, or 0 when the list has no prices.
- notes: visible notes, otherwise "".
- readable: true when at least one item name can be read, even when the list has no prices. Return false only when no item names can be read.
Only return the JSON object.`;

    try {
      const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        file_urls: [fileUrl],
        response_json_schema: billSchema,
      });

      const parsed = typeof result === "string" ? JSON.parse(result) : result || {};
      const items = Array.isArray(parsed.items)
        ? parsed.items
            .filter((i) => i && (i.name || num(i.amount)))
            .map((i) => {
              const qty = num(i.qty) || 1;
              const amount = num(i.amount);
              const price = num(i.price) || (amount ? Math.round((amount / qty) * 100) / 100 : 0);
              return {
                name: String(i.name || "").slice(0, 120),
                qty,
                unit: String(i.unit || "").slice(0, 12),
                price,
                amount: amount || Math.round(qty * price * 100) / 100,
              };
            })
        : [];

      if (!parsed.readable || items.length === 0) {
        return {
          error:
            "We could not read any shopping items from this image. Try a clearer photo or enter the items manually.",
        };
      }

      const computed = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || "") ? parsed.date : today;

      return {
        draft: {
          shop_name: String(parsed.shop_name || "").slice(0, 120),
          date,
          notes: String(parsed.notes || "").slice(0, 500),
          items,
          total: num(parsed.total) || computed,
        },
      };
    } catch {
      return {
        error:
          "We could not read this file. Please try a clearer shopping-list or bill photo (JPG or PNG works best), or enter the items manually.",
      };
    }
  });

const RATE_UNIT_NAMES = {
  g: "gram",
  kg: "kilogram",
  L: "litre",
  ml: "millilitre",
  pcs: "piece",
  pkt: "packet",
  dozen: "dozen",
  box: "box",
};

const rateSchema = {
  type: "object",
  properties: {
    item: { type: "string" },
    rate: { type: "number" },
    min: { type: "number" },
    max: { type: "number" },
    note: { type: "string" },
  },
  required: ["item", "rate", "min", "max", "note"],
  additionalProperties: false,
};

// Suggests the current Indian retail rate for ONE unit of an item, used as a
// hint in the entry form. Signed-in callers only.
export const suggestMarketRate = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ name: z.string().min(1).max(80), unit: z.string().min(1).max(12) }))
  .handler(async ({ data, context }) => {
    const base44 = context.getBase44();
    const unitName = RATE_UNIT_NAMES[data.unit] || data.unit;
    const today = new Date().toISOString().slice(0, 10);
    const preferredMarket = String(context.user?.preferred_market || "").trim();
    const locationHint = preferredMarket
      ? `Prioritize retail prices for this local market: ${preferredMarket}. If local prices are unavailable, use a cautious nearby-region estimate and say so in the note.`
      : "Use typical Indian city retail prices because no preferred local market is set.";
    const prompt = `Today is ${today}. Estimate the current typical retail price for one ${unitName} (${data.unit}) of "${data.name}", as bought at a kirana store or supermarket.
${locationHint}
Rules:
- rate: Indian Rupees for exactly ONE ${unitName}, the middle of the usual retail range.
- If the item is normally sold in another pack size, convert the price to one ${unitName}.
- min and max: the usual low and high retail price for one ${unitName}.
- note: one short line, at most 12 words, indicating this is an approximate local/current reference.
- item: the item name cleaned up.
Only return the JSON object.`;

    try {
      const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        model: "gemini_3_flash",
        response_json_schema: rateSchema,
      });

      const parsed = typeof result === "string" ? JSON.parse(result) : result || {};
      const rate = num(parsed.rate) || num(parsed.min);
      if (!rate) {
        return { error: "No market rate found for this item. Enter the rate yourself." };
      }

      return {
        suggestion: {
          item: String(parsed.item || data.name).slice(0, 80),
          unit: data.unit,
          rate,
          min: num(parsed.min) || rate,
          max: num(parsed.max) || rate,
          note: String(parsed.note || "").slice(0, 160),
        },
      };
    } catch {
      return { error: "Could not fetch a market rate right now. Enter the rate yourself." };
    }
  });

const rateListSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          unit: { type: "string" },
          rate: { type: "number" },
        },
        required: ["name", "unit", "rate"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

// Rough market prices for a whole shopping list, in ONE call, so a list can be
// given an estimated total before the real shop prices are known.
// Signed-in callers only.
export const estimateMarketRates = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(
    z.object({
      items: z
        .array(z.object({ name: z.string().min(1).max(80), unit: z.string().max(12) }))
        .min(1)
        .max(15),
    }),
  )
  .handler(async ({ data, context }) => {
    const base44 = context.getBase44();
    const today = new Date().toISOString().slice(0, 10);
    const preferredMarket = String(context.user?.preferred_market || "").trim();
    const locationHint = preferredMarket
      ? `Prioritize retail prices for this local market: ${preferredMarket}. If local prices are unavailable, use a cautious nearby-region estimate.`
      : "Use typical Indian city retail prices because no preferred local market is set.";
    const lines = data.items
      .map((i, idx) => `${idx + 1}. ${i.name} | unit: ${RATE_UNIT_NAMES[i.unit] || i.unit || "piece"}`)
      .join("\n");

    const prompt = `Today is ${today}. Estimate the current typical retail price for each grocery item below, as bought at a kirana store or supermarket.
${locationHint}
Items (number | item name | unit):
${lines}
Rules:
- Return exactly one entry per item, in the same order as above, repeating the name and unit.
- rate: Indian Rupees for exactly ONE of that unit. If the item is normally sold in another pack size, convert the price to one unit.
- Use realistic Indian city retail prices. Never return 0 or an empty rate.
Only return the JSON object.`;

    try {
      const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        model: "gemini_3_flash",
        response_json_schema: rateListSchema,
      });

      const parsed = typeof result === "string" ? JSON.parse(result) : result || {};
      const rates = (Array.isArray(parsed.items) ? parsed.items : [])
        .map((r, index) => ({ index, rate: num(r?.rate) }))
        .filter((r) => r.rate > 0);

      if (!rates.length) {
        return { error: "Could not estimate market prices right now. Enter the prices yourself." };
      }
      return { rates };
    } catch {
      return { error: "Could not estimate market prices right now. Enter the prices yourself." };
    }
  });