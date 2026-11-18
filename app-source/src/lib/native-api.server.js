import { createNativeAuth } from "@/lib/native-auth.server";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const AI_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

async function requireUser(request, env) {
  const auth = createNativeAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;
  return { auth, user: session.user };
}

function parseItems(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    shop_name: row.shop_name || "",
    date: row.date,
    items: parseItems(row.items_json),
    total: Number(row.total) || 0,
    item_count: Number(row.item_count) || 0,
    notes: row.notes || "",
    source: row.source || "manual",
    bill_file_uri: row.bill_file_id ? `cf-file:${row.bill_file_id}` : row.legacy_bill_file_uri || "",
    created_date: row.created_at,
    updated_date: row.updated_at,
  };
}

function validateRecord(input) {
  const date = String(input?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Please provide a valid shopping date.");
  const items = Array.isArray(input?.items) ? input.items : [];
  if (items.length > 500) throw new Error("A shopping record cannot contain more than 500 items.");
  const cleaned = items.map((item) => ({
    name: String(item?.name || "").trim().slice(0, 120),
    qty: Math.max(0, Number(item?.qty) || 0),
    unit: String(item?.unit || "").trim().slice(0, 24),
    price: Math.max(0, Number(item?.price) || 0),
    ...(Number(item?.estimated_price ?? item?.estimatedPrice) > 0
      ? { estimated_price: Number(item.estimated_price ?? item.estimatedPrice) }
      : {}),
    amount: Math.max(0, Number(item?.amount) || 0),
  }));
  if (!cleaned.length) throw new Error("Add at least one item.");
  const total = Number(input?.total);
  if (!Number.isFinite(total) || total < 0 || total > 100000000) throw new Error("Please provide a valid total.");
  return {
    shop_name: String(input?.shop_name || "").trim().slice(0, 160),
    date,
    items_json: JSON.stringify(cleaned),
    total,
    item_count: cleaned.length,
    notes: String(input?.notes || "").trim().slice(0, 2000),
    source: input?.source === "bill" ? "bill" : "manual",
    bill_file_id: parseFileId(input?.bill_file_uri),
    legacy_bill_file_uri: parseFileId(input?.bill_file_uri) ? null : String(input?.bill_file_uri || "").slice(0, 1200) || null,
  };
}

function parseFileId(uri) {
  const match = /^cf-file:([a-f0-9-]{36})$/i.exec(String(uri || ""));
  return match?.[1] || null;
}

async function fetchRecord(db, userId, recordId) {
  const row = await db.prepare(
    "SELECT id, shop_name, date, items_json, total, item_count, notes, source, bill_file_id, legacy_bill_file_uri, created_at, updated_at FROM shopping_records WHERE user_id = ? AND id = ?",
  ).bind(userId, recordId).first();
  return mapRecord(row);
}

async function handleRecords(request, env, user, url) {
  const path = url.pathname.replace(/^\/api\/records/, "") || "/";
  const method = request.method;

  if (path === "/" && method === "GET") {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 500);
    const offset = Math.max(Number(url.searchParams.get("cursor")) || 0, 0);
    const shop = String(url.searchParams.get("shop") || "").trim().slice(0, 100);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const where = ["user_id = ?"];
    const values = [user.id];
    if (shop) {
      where.push("instr(lower(shop_name), lower(?)) > 0");
      values.push(shop);
    }
    if (from) { where.push("date >= ?"); values.push(from); }
    if (to) { where.push("date <= ?"); values.push(to); }

    const rows = await env.DB.prepare(
      `SELECT id, shop_name, date, items_json, total, item_count, notes, source, bill_file_id, legacy_bill_file_uri, created_at, updated_at
       FROM shopping_records WHERE ${where.join(" AND ")}
       ORDER BY date DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`,
    ).bind(...values, limit + 1, offset).all();
    const raw = rows.results || [];
    const hasMore = raw.length > limit;
    const items = raw.slice(0, limit).map(mapRecord);
    return json({ items, has_more: hasMore, next_cursor: hasMore ? String(offset + limit) : null });
  }

  if (path === "/aggregate" && method === "GET") {
    const row = await env.DB.prepare(
      "SELECT COALESCE(SUM(total), 0) AS sum_total, COALESCE(MAX(total), 0) AS max_total, COUNT(*) AS count FROM shopping_records WHERE user_id = ?",
    ).bind(user.id).first();
    return json({ rows: [row || { sum_total: 0, max_total: 0, count: 0 }] });
  }

  if (path === "/" && method === "POST") {
    let data;
    try { data = validateRecord(await request.json()); } catch (e) { return error(e.message); }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO shopping_records
       (id, user_id, shop_name, date, items_json, total, item_count, notes, source, bill_file_id, legacy_bill_file_uri, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, user.id, data.shop_name, data.date, data.items_json, data.total, data.item_count, data.notes, data.source, data.bill_file_id, data.legacy_bill_file_uri, now, now).run();
    return json(await fetchRecord(env.DB, user.id, id), 201);
  }

  const match = /^\/([a-f0-9-]{36})$/i.exec(path);
  if (!match) return error("Not found.", 404);
  const recordId = match[1];

  if (method === "GET") {
    const record = await fetchRecord(env.DB, user.id, recordId);
    return record ? json(record) : error("Record not found.", 404);
  }

  if (method === "PATCH" || method === "PUT") {
    let data;
    try { data = validateRecord(await request.json()); } catch (e) { return error(e.message); }
    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      `UPDATE shopping_records SET shop_name = ?, date = ?, items_json = ?, total = ?, item_count = ?,
       notes = ?, source = ?, bill_file_id = ?, legacy_bill_file_uri = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).bind(data.shop_name, data.date, data.items_json, data.total, data.item_count, data.notes, data.source, data.bill_file_id, data.legacy_bill_file_uri, now, recordId, user.id).run();
    if (!result.meta?.changes) return error("Record not found.", 404);
    return json(await fetchRecord(env.DB, user.id, recordId));
  }

  if (method === "DELETE") {
    const result = await env.DB.prepare(
      "DELETE FROM shopping_records WHERE id = ? AND user_id = ?",
    ).bind(recordId, user.id).run();
    return result.meta?.changes ? json({ success: true }) : error("Record not found.", 404);
  }

  return error("Method not allowed.", 405);
}

async function handleFiles(request, env, user, url) {
  if (!env.FILES) return error("Private file storage is not configured.", 503);

  if (url.pathname === "/api/files" && request.method === "POST") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return error("Choose a file to upload.");
    if (!file.size || file.size > MAX_FILE_BYTES) return error("Files must be between 1 byte and 10 MB.");
    const type = String(file.type || "application/octet-stream").toLowerCase();
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
    if (!allowed.has(type)) return error("Supported formats are JPG, PNG, WEBP and PDF.");
    const id = crypto.randomUUID();
    const key = `users/${user.id}/${id}`;
    await env.FILES.put(key, file.stream(), {
      httpMetadata: {
        contentType: type,
        contentDisposition: "inline",
      },
      customMetadata: { ownerId: user.id, originalName: String(file.name || "upload").slice(0, 180) },
    });
    await env.DB.prepare(
      "INSERT INTO uploaded_files (id, user_id, r2_key, original_name, content_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, user.id, key, String(file.name || "upload").slice(0, 180), type, file.size).run();
    return json({ file_uri: `cf-file:${id}`, file_id: id }, 201);
  }

  const match = /^\/api\/files\/([a-f0-9-]{36})\/(content|signed)$/i.exec(url.pathname);
  if (!match) return error("Not found.", 404);
  const [, id, action] = match;
  const file = await env.DB.prepare(
    "SELECT id, r2_key, original_name, content_type, size_bytes FROM uploaded_files WHERE id = ? AND user_id = ?",
  ).bind(id, user.id).first();
  if (!file) return error("File not found.", 404);

  if (action === "signed" && request.method === "GET") {
    // This is an authenticated same-origin URL, not a public or bearer URL.
    return json({ signed_url: `/api/files/${id}/content` });
  }

  if (action === "content" && request.method === "GET") {
    const object = await env.FILES.get(file.r2_key);
    if (!object) return error("File content is missing.", 404);
    const headers = new Headers({
      "Content-Type": file.content_type,
      "Content-Length": String(file.size_bytes),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return new Response(object.body, { headers });
  }
  return error("Method not allowed.", 405);
}

async function handleProfile(request, env, user) {
  if (request.method === "GET") {
    return json(user);
  }
  if (request.method !== "PATCH" && request.method !== "PUT") return error("Method not allowed.", 405);
  const input = await request.json();
  const displayName = String(input.display_name ?? input.displayName ?? user.displayName ?? user.name ?? "").trim().slice(0, 80);
  const phone = String(input.phone ?? user.phone ?? "").trim().slice(0, 24);
  const preferredMarket = String(input.preferred_market ?? input.preferredMarket ?? user.preferredMarket ?? "").trim().slice(0, 80);
  const profilePictureId = parseFileId(input.profile_picture_uri ?? input.profilePictureId);
  await env.DB.prepare(
    'UPDATE "user" SET name = ?, displayName = ?, phone = ?, preferredMarket = ?, profilePictureId = ?, updatedAt = ? WHERE id = ?',
  ).bind(displayName || user.name || user.email, displayName, phone, preferredMarket, profilePictureId, new Date().toISOString(), user.id).run();
  const updated = await env.DB.prepare(
    'SELECT id, name, email, image, displayName, phone, preferredMarket, profilePictureId FROM "user" WHERE id = ?',
  ).bind(user.id).first();
  return json(updated);
}

function extractModelText(result) {
  return result?.response
    ?? result?.result?.response
    ?? result?.choices?.[0]?.message?.content
    ?? result?.output_text
    ?? "";
}

function parseModelJson(value) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim().replace(/^\`\`\`(?:json)?/i, "").replace(/\`\`\`$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI did not return valid structured data.");
  return JSON.parse(text.slice(start, end + 1));
}

async function callTextModel(env, system, userContent, maxTokens = 1800) {
  if (!env.AI) throw new Error("Workers AI binding is not configured.");
  const result = await env.AI.run(AI_MODEL, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
    max_tokens: maxTokens,
  });
  return parseModelJson(extractModelText(result));
}

async function handleAI(request, env, user) {
  if (request.method !== "POST") return error("Method not allowed.", 405);
  let body;
  try { body = await request.json(); } catch { return error("Invalid request body."); }
  const action = String(body.action || "");
  const data = body.data && typeof body.data === "object" ? body.data : body;

  if (action === "readShoppingBill") {
    const fileId = parseFileId(data.fileUri);
    if (!fileId) return error("The uploaded bill is not stored in this Cloudflare account.");
    const file = await env.DB.prepare(
      "SELECT r2_key, original_name, content_type FROM uploaded_files WHERE id = ? AND user_id = ?",
    ).bind(fileId, user.id).first();
    if (!file) return error("Uploaded bill not found.", 404);
    const object = await env.FILES.get(file.r2_key);
    if (!object) return error("Uploaded bill content is missing.", 404);
    if (!env.AI?.toMarkdown) return error("Cloudflare document conversion is not enabled.", 503);
    const converted = await env.AI.toMarkdown().transform({
      name: file.original_name,
      blob: new Blob([await object.arrayBuffer()], { type: file.content_type }),
    });
    const extractedText = (converted?.data || converted?.results?.[0]?.data || "").slice(0, 28000);
    if (!extractedText.trim()) return error("No readable text was found. Try a clearer photo.");
    const purpose = data.purpose === "priced_list" ? "priced_list" : "shopping_list";
    const prompt = purpose === "shopping_list"
      ? "Extract the shopping list. Do not invent prices. Return JSON only: {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:0,amount:0}]}}. If quantity or unit is unreadable, use qty 1 and unit pcs. Use YYYY-MM-DD dates only when clearly printed; otherwise use today's date."
      : "Extract the shop's actual priced bill/list. Return JSON only: {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:number,amount:number}]}}. Prefer the printed line total for amount and compute unit price only when possible. Do not add items that are not visible.";
    const parsed = await callTextModel(env, `You accurately read Indian grocery and household shopping bills. The currency is Indian rupees (INR). Normalize common Indian quantity units (kg, g, L, ml, pcs, pkt, dozen, box). ${prompt}`, extractedText, 2600);
    if (!parsed?.draft || !Array.isArray(parsed.draft.items)) return error("The bill could not be interpreted. Try a clearer, straight photo.");
    return json({ draft: parsed.draft });
  }

  if (action === "suggestMarketRate") {
    const name = String(data.name || "").trim().slice(0, 100);
    const unit = String(data.unit || "pcs").trim().slice(0, 20);
    if (!name) return error("Enter an item name.");
    const parsed = await callTextModel(env,
      "You estimate typical retail grocery prices in India, in INR per the exact requested unit. These are rough estimates, not live quotations. Be conservative and do not claim real-time market data. Return JSON only: {suggestion:{rate:number,min:number,max:number,note:string}}.",
      `Item: ${name}\nUnit: ${unit}\nMarket area: ${String(data.market || user.preferredMarket || "India").slice(0, 100)}\nReturn a reasonable broad range in INR.`,
      450,
    );
    const suggestion = parsed.suggestion;
    if (!suggestion || !(Number(suggestion.rate) > 0)) return error("No reliable estimate was available for this item.", 503);
    return json({ suggestion });
  }

  if (action === "estimateMarketRates") {
    const items = Array.isArray(data.items) ? data.items.slice(0, 80) : [];
    if (!items.length) return error("Add items to estimate.");
    const promptItems = items.map((item, index) => ({ index, name: String(item.name || "").slice(0, 100), unit: String(item.unit || "pcs").slice(0, 20) }));
    const parsed = await callTextModel(env,
      "You estimate typical retail grocery prices in India in INR per the supplied unit. Estimates are approximate, not live market quotations. Keep the same item order and indexes. Return JSON only: {rates:[{index:number,rate:number}]} with one entry per item when a plausible estimate exists.",
      `Market area: ${String(user.preferredMarket || "India").slice(0, 100)}\nItems: ${JSON.stringify(promptItems)}`,
      1600,
    );
    const rates = Array.isArray(parsed.rates) ? parsed.rates
      .filter((r) => Number.isInteger(r.index) && r.index >= 0 && r.index < items.length && Number(r.rate) > 0)
      .map((r) => ({ index: r.index, rate: Math.round(Number(r.rate) * 100) / 100 })) : [];
    return json({ rates });
  }

  return error("Unknown AI action.", 404);
}

export async function handleNativeApi(request, env) {
  const url = new URL(request.url);
  try {
    const authContext = await requireUser(request, env);
    if (!authContext) return error("Please sign in to continue.", 401);
    const { user } = authContext;

    if (url.pathname === "/api/records" || url.pathname.startsWith("/api/records/")) {
      return await handleRecords(request, env, user, url);
    }
    if (url.pathname === "/api/files" || url.pathname.startsWith("/api/files/")) {
      return await handleFiles(request, env, user, url);
    }
    if (url.pathname === "/api/profile") return await handleProfile(request, env, user);
    if (url.pathname === "/api/ai") return await handleAI(request, env, user);
    return error("Not found.", 404);
  } catch (cause) {
    console.error("Native API request failed", cause);
    return error(cause?.message || "Internal server error.", 500);
  }
}
