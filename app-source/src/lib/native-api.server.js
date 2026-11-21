import { createNativeAuth } from "@/lib/native-auth.server";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const AI_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const VISION_MODEL = "@cf/moondream/moondream3.1-9B-A2B";

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
    receipts: parseItems(row.receipts_json),
    reconciliation_status: row.reconciliation_status || "not_required",
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
    receipts_json: JSON.stringify((Array.isArray(input?.receipts) ? input.receipts : []).slice(0, 30)),
    reconciliation_status: String(input?.reconciliation_status || "not_required").slice(0, 30),
    legacy_bill_file_uri: parseFileId(input?.bill_file_uri) ? null : String(input?.bill_file_uri || "").slice(0, 1200) || null,
  };
}

function parseFileId(uri) {
  const match = /^cf-file:([a-f0-9-]{36})$/i.exec(String(uri || ""));
  return match?.[1] || null;
}

async function fetchRecord(db, userId, recordId) {
  const row = await db.prepare(
    "SELECT id, shop_name, date, items_json, total, item_count, notes, source, bill_file_id, legacy_bill_file_uri, receipts_json, reconciliation_status, created_at, updated_at FROM shopping_records WHERE user_id = ? AND id = ?",
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
      `SELECT id, shop_name, date, items_json, total, item_count, notes, source, bill_file_id, legacy_bill_file_uri, receipts_json, reconciliation_status, created_at, updated_at
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
       (id, user_id, shop_name, date, items_json, total, item_count, notes, source, bill_file_id, legacy_bill_file_uri, receipts_json, reconciliation_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, user.id, data.shop_name, data.date, data.items_json, data.total, data.item_count, data.notes, data.source, data.bill_file_id, data.legacy_bill_file_uri, data.receipts_json, data.reconciliation_status, now, now).run();
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
       notes = ?, source = ?, bill_file_id = ?, legacy_bill_file_uri = ?, receipts_json = ?, reconciliation_status = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).bind(data.shop_name, data.date, data.items_json, data.total, data.item_count, data.notes, data.source, data.bill_file_id, data.legacy_bill_file_uri, data.receipts_json, data.reconciliation_status, now, recordId, user.id).run();
    if (!result.meta?.changes) return error("Record not found.", 404);
    return json(await fetchRecord(env.DB, user.id, recordId));
  }

  if (method === "DELETE") {
    // Remove the linked engine session first. Its child rows are configured to
    // cascade, while shopping_sessions.legacy_record_id references this legacy
    // record and otherwise prevents the parent delete. D1 batch is atomic.
    const results = await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM shopping_sessions WHERE legacy_record_id = ? AND user_id = ?",
      ).bind(recordId, user.id),
      env.DB.prepare(
        "DELETE FROM shopping_records WHERE id = ? AND user_id = ?",
      ).bind(recordId, user.id),
    ]);
    return results?.[1]?.meta?.changes ? json({ success: true }) : error("Record not found.", 404);
  }

  return error("Method not allowed.", 405);
}

async function getGoogleDriveToken(db, userId, env) {
  const account = await db.prepare(
    "SELECT id, accessToken, refreshToken, accessTokenExpiresAt, scope FROM account WHERE userId = ? AND providerId = 'google' ORDER BY updatedAt DESC LIMIT 1",
  ).bind(userId).first();
  if (!account) throw new Error("Connect Google Drive from your profile before uploading files.");
  if (!String(account.scope || "").split(/[ ,]+/).includes("https://www.googleapis.com/auth/drive.file")) {
    throw new Error("Grant Google Drive file access from your profile before uploading files.");
  }
  const expiresAt = account.accessTokenExpiresAt ? new Date(account.accessTokenExpiresAt).getTime() : 0;
  if (account.accessToken && (!expiresAt || expiresAt > Date.now() + 60_000)) return account.accessToken;
  if (!account.refreshToken || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Your Google Drive connection needs to be renewed. Reconnect Google Drive from your profile.");
  }
  const form = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: account.refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const tokens = await response.json().catch(() => ({}));
  if (!response.ok || !tokens.access_token) {
    throw new Error("Google Drive authorization expired. Reconnect Google Drive from your profile.");
  }
  const nextExpiry = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
  await db.prepare(
    "UPDATE account SET accessToken = ?, accessTokenExpiresAt = ?, updatedAt = ? WHERE id = ?",
  ).bind(tokens.access_token, nextExpiry, new Date().toISOString(), account.id).run();
  return tokens.access_token;
}

async function driveRequest(token, url, options = {}) {
  let lastError;
  const method = String(options.method || "GET").toUpperCase();
  // Retry only idempotent reads. Drive create/upload POSTs may succeed even when
  // the client loses the response; automatic retries can create duplicate files.
  const retryable = method === "GET" || method === "HEAD";
  const maxAttempts = retryable ? 3 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
      if (!retryable || response.ok || (response.status < 500 && response.status !== 429) || attempt === maxAttempts - 1) return response;
      lastError = new Error(`Google Drive temporary error (${response.status}).`);
    } catch (cause) {
      lastError = cause;
      if (!retryable || attempt === maxAttempts - 1) throw new Error("Network connection to Google Drive failed. Please retry the receipt upload.");
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw lastError || new Error("Google Drive request failed. Please retry.");
}

async function ensureGoogleDriveFolder(db, userId, token) {
  const user = await db.prepare('SELECT googleDriveFolderId FROM "user" WHERE id = ?').bind(userId).first();
  if (user?.googleDriveFolderId) return user.googleDriveFolderId;
  const query = new URLSearchParams({
    q: "name = 'Shopping Hisab' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: "files(id,name)",
    pageSize: "10",
  });
  const listed = await driveRequest(token, `https://www.googleapis.com/drive/v3/files?${query}`);
  const listing = await listed.json().catch(() => ({}));
  if (!listed.ok) throw new Error("Could not check your Google Drive folder. Please reconnect Google Drive.");
  let folderId = listing.files?.[0]?.id;
  if (!folderId) {
    const created = await driveRequest(token, "https://www.googleapis.com/drive/v3/files?fields=id,name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Shopping Hisab", mimeType: "application/vnd.google-apps.folder" }),
    });
    const folder = await created.json().catch(() => ({}));
    if (!created.ok || !folder.id) throw new Error("Could not create the Shopping Hisab folder in your Google Drive.");
    folderId = folder.id;
  }
  await db.prepare('UPDATE "user" SET googleDriveFolderId = ? WHERE id = ?').bind(folderId, userId).run();
  return folderId;
}

async function uploadGoogleDriveFile(db, userId, env, file, originalName) {
  const token = await getGoogleDriveToken(db, userId, env);
  const folderId = await ensureGoogleDriveFolder(db, userId, token);
  const metadata = { name: String(originalName || file.name || "attachment").slice(0, 180), parents: [folderId] };
  const boundary = `shoppinghisab_${crypto.randomUUID().replace(/-/g, "")}`;
  const fileBytes = await file.arrayBuffer();
  const multipartBody = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
    fileBytes,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });
  const response = await driveRequest(token,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size",
    { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: multipartBody },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw new Error("Google Drive could not save this attachment. Check your Drive storage and reconnect if needed.");
  return { driveFileId: result.id, size: Number(result.size) || file.size, name: result.name || metadata.name };
}

async function downloadGoogleDriveFile(db, userId, env, driveFileId) {
  const token = await getGoogleDriveToken(db, userId, env);
  const response = await driveRequest(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`);
  if (!response.ok) throw new Error("Could not open this file from your Google Drive. Check that the file still exists and reconnect Drive if needed.");
  return response;
}

async function handleFiles(request, env, user, url) {
  if (url.pathname === "/api/files" && request.method === "POST") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return error("Choose a file to upload.");
    if (!file.size || file.size > MAX_FILE_BYTES) return error("Files must be between 1 byte and 10 MB.");
    const type = String(file.type || "application/octet-stream").toLowerCase();
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
    if (!allowed.has(type)) return error("Supported formats are JPG, PNG, WEBP and PDF.");
    const id = crypto.randomUUID();
    const uploaded = await uploadGoogleDriveFile(env.DB, user.id, env, file, file.name || "upload");
    await env.DB.prepare(
      "INSERT INTO uploaded_files (id, user_id, r2_key, storage_provider, drive_file_id, original_name, content_type, size_bytes) VALUES (?, ?, ?, 'google_drive', ?, ?, ?, ?)",
    ).bind(id, user.id, `drive:${uploaded.driveFileId}`, uploaded.driveFileId, uploaded.name, type, uploaded.size).run();
    return json({ file_uri: `cf-file:${id}`, file_id: id }, 201);
  }

  const match = /^\/api\/files\/([a-f0-9-]{36})\/(content|signed)$/i.exec(url.pathname);
  if (!match) return error("Not found.", 404);
  const [, id, action] = match;
  const file = await env.DB.prepare(
    "SELECT id, drive_file_id, storage_provider, original_name, content_type, size_bytes FROM uploaded_files WHERE id = ? AND user_id = ?",
  ).bind(id, user.id).first();
  if (!file) return error("File not found.", 404);

  if (action === "signed" && request.method === "GET") {
    return json({ signed_url: `/api/files/${id}/content` });
  }

  if (action === "content" && request.method === "GET") {
    if (file.storage_provider !== "google_drive" || !file.drive_file_id) return error("This attachment is not available in Google Drive.", 404);
    const object = await downloadGoogleDriveFile(env.DB, user.id, env, file.drive_file_id);
    const headers = new Headers({
      "Content-Type": file.content_type,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return new Response(object.body, { headers });
  }
  return error("Method not allowed.", 405);
}

async function handleDriveStatus(env, user) {
  const account = await env.DB.prepare(
    "SELECT scope, refreshToken FROM account WHERE userId = ? AND providerId = 'google' ORDER BY updatedAt DESC LIMIT 1",
  ).bind(user.id).first();
  const scopes = String(account?.scope || "").split(/[ ,]+/);
  return json({ connected: !!account && scopes.includes("https://www.googleapis.com/auth/drive.file"), email: user.email || null });
}

async function handleDriveInitialize(env, user) {
  const token = await getGoogleDriveToken(env.DB, user.id, env);
  const folderId = await ensureGoogleDriveFolder(env.DB, user.id, token);
  return json({ connected: true, folder_ready: true, folder_id: folderId });
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
  const postalCode = String(input.postal_code ?? input.postalCode ?? user.postalCode ?? "").trim();
  if (!displayName) return error("Enter your full name.");
  if (!/^\d{6}$/.test(postalCode)) return error("Enter a valid 6-digit Indian PIN code.");
  if (!preferredMarket) return error("Enter your locality or nearest market.");
  const profilePictureId = parseFileId(input.profile_picture_uri ?? input.profilePictureId);
  await env.DB.prepare(
    'UPDATE "user" SET name = ?, displayName = ?, phone = ?, preferredMarket = ?, postalCode = ?, profilePictureId = ?, updatedAt = ? WHERE id = ?',
  ).bind(displayName || user.name || user.email, displayName, phone, preferredMarket, postalCode || null, profilePictureId, new Date().toISOString(), user.id).run();
  const updated = await env.DB.prepare(
    'SELECT id, name, email, image, displayName, phone, preferredMarket, postalCode, profilePictureId FROM "user" WHERE id = ?',
  ).bind(user.id).first();
  return json(updated);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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
  const text = String(value || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI did not return valid structured data.");
  return JSON.parse(text.slice(start, end + 1));
}

async function callGeminiTextModel(env, system, userContent, maxTokens = 1800) {
  if (!env.GEMINI_API_KEY) throw new Error("Gemini API key is not configured.");
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `SYSTEM INSTRUCTIONS:\n${system}\n\nUSER REQUEST:\n${userContent}` }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload?.error?.message || "Gemini text request failed.").slice(0, 400));
  const output = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  if (!output) throw new Error("Gemini returned an empty response.");
  return parseModelJson(output);
}

async function callTextModel(env, system, userContent, maxTokens = 1800) {
  // Gemini is the primary text model, matching the working production OCR path.
  // Workers AI remains an optional fallback when an AI binding is configured.
  if (env.GEMINI_API_KEY) {
    try {
      return await callGeminiTextModel(env, system, userContent, maxTokens);
    } catch (geminiError) {
      console.warn("Gemini text request failed; trying Workers AI fallback:", geminiError?.message || geminiError);
    }
  }
  if (env.AI) {
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
  throw new Error("AI text estimation is temporarily unavailable. Check the Gemini API key or configure a Workers AI binding.");
}

async function callVisionModel(env, imageDataUrl, instructions, maxTokens = 1400) {
  if (!env.AI) throw new Error("Workers AI binding is not configured.");
  const result = await env.AI.run(VISION_MODEL, {
    task: "query",
    image: imageDataUrl,
    question: `Read this handwritten English shopping bill. Return JSON only, with no markdown or explanation. Currency is INR. Normalize units to kg, g, L, ml, pcs, pkt, dozen or box. Never guess unreadable text or prices. The number in the rightmost price column is the total for that row quantity. Put it in amount and calculate price=amount/qty when quantity is clear. If no price is visible, set price=0 and amount=0. Keep quantity in the normalized unit as written (200 gm => qty 200, unit g; 5 kg => qty 5, unit kg; half kg => qty 0.5, unit kg). ${instructions} Return exactly this shape: { "draft": { "shopName": "", "date": null, "notes": "", "items": [{ "name": "", "qty": 1, "unit": "pcs", "price": 0, "amount": 0 }] } }`,
    reasoning: false,
    temperature: 0.05,
    max_tokens: maxTokens,
  });
  let answer = result?.answer ?? result?.result?.answer ?? "";

  // Retry once with a short plain-transcription request if the first inference
  // returns no answer. Keeping OCR and JSON structuring separate is more reliable.
  if (!String(answer ?? "").trim()) {
    const retry = await env.AI.run(VISION_MODEL, {
      task: "query",
      image: imageDataUrl,
      question: "Transcribe every handwritten shopping-list line in this image exactly. Include item names and quantities. Do not summarize. If a word is unclear, write [unclear].",
      reasoning: true,
      temperature: 0.2,
      max_tokens: 1800,
    });
    answer = retry?.answer ?? retry?.result?.answer ?? "";
  }

  try {
    const parsed = parseModelJson(answer);
    if (parsed?.draft && Array.isArray(parsed.draft.items)) return parsed;
  } catch {
    // Moondream query answers may be plain OCR text rather than JSON.
  }
  const transcription = typeof answer === "string" ? answer.trim() : JSON.stringify(answer);
  if (!transcription) {
    const finishReason = result?.finish_reason ?? result?.result?.finish_reason ?? "unknown";
    throw new Error(`The image reader returned no text (finish reason: ${finishReason}). Please retry once; if it repeats, we need to inspect the model response.`);
  }
  return callTextModel(
    env,
    "Convert this OCR transcription into valid JSON only for an Indian shopping list. Preserve all visible items and quantities. Never invent prices or items. If no price is visible, set price=0 and amount=0. If a row total is visible, put it in amount and calculate price=amount/qty only when quantity is clear. Normalize units to kg, g, L, ml, pcs, pkt, dozen or box. Return exactly {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:number,amount:number}]}}.",
    `Rules: ${instructions}\nOCR transcription: ${transcription}`,
    maxTokens,
  );
}

async function callGeminiVision(env, imageDataUrl, instructions, maxTokens = 2200) {
  if (!env.GEMINI_API_KEY) throw new Error("Gemini API key is not configured.");
  const comma = imageDataUrl.indexOf(",");
  if (comma < 0) throw new Error("Invalid image data.");
  const mime = imageDataUrl.slice(5, imageDataUrl.indexOf(";"));
  const imageBase64 = imageDataUrl.slice(comma + 1);
  const prompt = "Read this handwritten English shopping bill carefully. Return JSON only. Currency is INR. Never invent unreadable items, quantities or prices. Preserve quantities and units. A right-side price is the TOTAL for that row quantity; put it in amount and calculate price=amount/qty only when both are clear. If no price is visible, use price=0 and amount=0. Normalize kg/kilo to kg, gm/gram to g, litre/ltr to L, packet to pkt and piece to pcs. " + instructions + " Return exactly {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:number,amount:number}]}}. Use empty shopName and null date when absent.";
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: imageBase64 } }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens, responseMimeType: "application/json" }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload?.error?.message || "Gemini OCR request failed.").slice(0, 400));
  const output = payload?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim() || "";
  const parsed = parseModelJson(output);
  if (!parsed?.draft || !Array.isArray(parsed.draft.items)) throw new Error("Gemini returned an invalid shopping-list format.");
  return parsed;
}

async function readBillWithFallback(env, imageDataUrl, instructions, maxTokens = 2200) {
  if (env.GEMINI_API_KEY) {
    try {
      const parsed = await callGeminiVision(env, imageDataUrl, instructions, maxTokens);
      if (parsed.draft.items.length) return { ...parsed, reader: "gemini" };
      throw new Error("Gemini did not detect any shopping-list items.");
    } catch (geminiError) {
      console.warn("Gemini OCR failed; trying Moondream fallback:", geminiError?.message || geminiError);
    }
  }
  if (!env.AI) throw new Error("Gemini OCR was unavailable and the Moondream fallback is not configured.");
  const parsed = await callVisionModel(env, imageDataUrl, instructions, maxTokens);
  return { ...parsed, reader: "moondream_fallback" };
}

async function handleGeminiOcrTest(request, env, user) {
  if (!env.GEMINI_API_KEY) return error("Gemini test is not configured. Add the GEMINI_API_KEY Worker secret.", 503);
  const form = await request.formData();
  const file = form.get("file");
  const purpose = form.get("purpose") === "priced_list" ? "priced_list" : "shopping_list";
  if (!(file instanceof File) || !file.size) return error("Choose a bill photo first.");
  if (file.size > MAX_FILE_BYTES) return error("Please choose a photo under 10 MB.");
  const mime = String(file.type || "").toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) return error("Choose a JPG, PNG or WEBP photo.");

  const prompt = purpose === "shopping_list"
    ? "Read this handwritten English shopping list. Extract every visible row, item name, quantity, unit and any price written on that same row. Never invent an item, quantity or price. A right-side price is the TOTAL for that row quantity; put it in amount and calculate price=amount/qty only when both are clear. If no price is visible, use price=0 and amount=0. Normalize kg/kilo to kg; gm/gram to g; litre/ltr to L; packet to pkt; piece to pcs. Preserve half kg as qty 0.5 kg. If unclear, mark the name as [unclear] or use qty=0; do not guess."
    : "Read this priced handwritten English grocery list. The rightmost number on a row is the TOTAL amount for that entire row quantity, not unit price. Put it in amount. Calculate price=amount/qty only when quantity is clear. If quantity is unclear, set qty=0 and price=0 but preserve a clearly visible amount. Never invent items or prices. Normalize units to kg, g, L, ml, pcs, pkt, dozen or box.";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageBase64 = bytesToBase64(bytes);
  const started = Date.now();
  const modelPromise = (async () => {
    const modelStarted = Date.now();
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: prompt + " Return only JSON matching {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:number,amount:number}]}}. Use an empty shopName and null date if absent. Currency is INR. Do not add commentary." },
          { inlineData: { mimeType: mime, data: imageBase64 } },
        ] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 3000,
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "OBJECT",
            properties: {
              draft: {
                type: "OBJECT",
                properties: {
                  shopName: { type: "STRING" },
                  date: { type: "STRING", nullable: true },
                  notes: { type: "STRING" },
                  items: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        name: { type: "STRING" },
                        qty: { type: "NUMBER" },
                        unit: { type: "STRING" },
                        price: { type: "NUMBER" },
                        amount: { type: "NUMBER" }
                      },
                      required: ["name", "qty", "unit", "price", "amount"]
                    }
                  }
                },
                required: ["shopName", "date", "notes", "items"]
              }
            },
            required: ["draft"]
          }
        }
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload?.error?.message || "Gemini API request failed.";
      throw new Error(detail.slice(0, 500));
    }
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
    const parsed = parseModelJson(text);
    if (!parsed?.draft || !Array.isArray(parsed.draft.items)) throw new Error("Gemini returned an unexpected shopping-list format.");
    return { parsed, ms: Date.now() - modelStarted };
  })();
  const uploadPromise = (async () => {
    const uploadStarted = Date.now();
    const uploaded = await uploadGoogleDriveFile(env.DB, user.id, env, file, file.name || "gemini-ocr-test.jpg");
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO uploaded_files (id, user_id, r2_key, storage_provider, drive_file_id, original_name, content_type, size_bytes) VALUES (?, ?, ?, 'google_drive', ?, ?, ?, ?)",
    ).bind(id, user.id, `drive:${uploaded.driveFileId}`, uploaded.driveFileId, uploaded.name, mime, uploaded.size).run();
    return { file_uri: `cf-file:${id}`, ms: Date.now() - uploadStarted };
  })();
  const [model, uploaded] = await Promise.all([modelPromise, uploadPromise]);
  return json({
    draft: model.parsed.draft,
    file_uri: uploaded.file_uri,
    timing: { gemini_ms: model.ms, drive_upload_ms: uploaded.ms, total_ms: Date.now() - started }
  });
}

async function handleDirectBillRead(request, env, user) {
  const form = await request.formData();
  const file = form.get("file");
  const purpose = form.get("purpose") === "priced_list" ? "priced_list" : "shopping_list";
  if (!(file instanceof File) || !file.size) return error("Choose a bill photo first.");
  if (file.size > MAX_FILE_BYTES) return error("Please choose a photo under 10 MB.");
  const mime = String(file.type || "").toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    return error("For the faster reader, please use a JPG, PNG or WEBP photo. PDFs can still use the standard reader.");
  }
  if (!env.GEMINI_API_KEY && !env.AI) return error("Bill reading is temporarily unavailable.", 503);

  const prompt = purpose === "shopping_list"
    ? "Read this handwritten Indian shopping list carefully. Extract every visible item, quantity, unit and any price written on the same row. Never invent missing prices. If a row has a visible right-side price, treat it as the TOTAL for that row quantity and return it as amount; calculate price=amount/qty. If no price is written, set price=0 and amount=0. Normalize units strictly: kg/kilo/kgs to kg; gm/gms/gram/grams to g; litre/liter/ltr to L; ml to ml; packet/pack to pkt; piece to pcs. Keep quantity in the normalized unit as written (e.g. 200 gm => qty 200, unit g; 5 kg => qty 5, unit kg; half kg => qty 0.5, unit kg). If unclear, do not guess. Return JSON only: {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:number,amount:number}]}}. Use today's date if no date is clearly written."
    : "Read this priced Indian grocery list or handwritten shopping note carefully. Extract only visible rows. The number written in the rightmost price column beside an item is the TOTAL amount for that entire row quantity, not the price per kg/g/L/packet. Put that row total in amount. Set price to amount divided by qty only when both are clearly legible; otherwise set price to 0 and preserve the visible amount. For example, Rice — 5 kg — 200 means qty=5, unit=kg, amount=200, price=40. Chilli powder — 200 gm — 40 means qty=200, unit=g, amount=40, price=0.2. Normalize gm/gms to g, kilo to kg, litre to L, packet to pkt, and piece to pcs. Do not multiply a row total by quantity. Return JSON only: {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:number,amount:number}]}}. Do not invent prices or add invisible items.";

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageDataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
  const readPromise = readBillWithFallback(env, imageDataUrl, `Purpose: ${purpose}. ${prompt}`, 2200);
  // Upload to Drive at the same time as AI reads the original image.
  const uploadPromise = uploadGoogleDriveFile(env.DB, user.id, env, file, file.name || "shopping-list.jpg");
  const [readResult, uploadResult] = await Promise.allSettled([readPromise, uploadPromise]);
  if (uploadResult.status === "rejected") throw new Error(`Receipt could not be saved to Google Drive: ${uploadResult.reason?.message || "Please reconnect Drive and retry."}`);
  const uploaded = uploadResult.value;
  // Persist the Drive file before OCR finishes so a failed read remains recoverable.
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO uploaded_files (id, user_id, r2_key, storage_provider, drive_file_id, original_name, content_type, size_bytes) VALUES (?, ?, ?, 'google_drive', ?, ?, ?, ?)",
  ).bind(id, user.id, `drive:${uploaded.driveFileId}`, uploaded.driveFileId, uploaded.name, mime, uploaded.size).run();
  const fileUri = `cf-file:${id}`;
  if (readResult.status === "rejected") {
    return json({ draft: null, file_uri: fileUri, recoverable: true, error: `Receipt saved. AI reading failed: ${readResult.reason?.message || "Try again."}` });
  }
  // callVisionModel already parses the model's answer into the draft object.
  const parsed = readResult.value;
  if (!parsed?.draft || !Array.isArray(parsed.draft.items) || !parsed.draft.items.length) {
    return json({ draft: null, file_uri: fileUri, recoverable: true, error: "Receipt saved, but the bill could not be interpreted. Retry reading or enter items manually." });
  }
  return json({ draft: parsed.draft, file_uri: fileUri });
}

async function handleAI(request, env, user) {
  if (request.method !== "POST") return error("Method not allowed.", 405);
  let body;
  try { body = await request.json(); } catch { return error("Invalid request body."); }
  const action = String(body.action || "");
  const data = body.data && typeof body.data === "object" ? body.data : body;

  if (action === "readShoppingBill") {
    const fileId = parseFileId(data.fileUri);
    if (!fileId) return error("The uploaded bill is not stored in Shopping Hisab.");
    const file = await env.DB.prepare(
      "SELECT drive_file_id, storage_provider, original_name, content_type FROM uploaded_files WHERE id = ? AND user_id = ?",
    ).bind(fileId, user.id).first();
    if (!file || file.storage_provider !== "google_drive" || !file.drive_file_id) return error("Uploaded bill not found in Google Drive.", 404);
    const object = await downloadGoogleDriveFile(env.DB, user.id, env, file.drive_file_id);
    const purpose = data.purpose === "priced_list" ? "priced_list" : "shopping_list";
    const prompt = purpose === "shopping_list"
      ? "Read this shopping list image carefully. Extract only visible items. Do not invent prices or items. Preserve quantities and units exactly when legible. If quantity or unit is unclear, use qty 1 and unit pcs. Return JSON only: {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:0,amount:0}]}}. Use YYYY-MM-DD dates only when clearly printed; otherwise use today's date."
      : "Read this priced Indian grocery list or handwritten shopping note carefully. Extract only visible rows. The number written in the rightmost price column beside an item is the TOTAL amount for that entire row quantity, not the price per kg/g/L/packet. Put that row total in amount. Set price to amount divided by qty only when both are clearly legible; otherwise set price to 0 and preserve the visible amount. For example, Rice — 5 kg — 200 means qty=5, unit=kg, amount=200, price=40. Chilli powder — 200 gm — 40 means qty=200, unit=g, amount=40, price=0.2. Normalize gm/gms to g, kilo to kg, litre to L, packet to pkt, and piece to pcs. Do not multiply a row total by quantity. Return JSON only: {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:number,amount:number}]}}. Do not invent prices or add invisible items.";
    let parsed;
    const mime = String(file.content_type || "").toLowerCase();
    if (mime.startsWith("image/")) {
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_FILE_BYTES) return error("The bill image is empty or too large. Please choose an image under 10 MB.");
      const imageDataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
      parsed = await callVisionModel(env, imageDataUrl, prompt, 2200);
    } else if (mime === "application/pdf") {
      if (!env.AI?.toMarkdown) return error("PDF reading is not enabled. Please upload a clear JPG or PNG photo instead.", 503);
      const converted = await env.AI.toMarkdown().transform({
        name: file.original_name,
        blob: new Blob([await object.arrayBuffer()], { type: mime }),
      });
      const extractedText = (converted?.data || converted?.results?.[0]?.data || "").slice(0, 28000);
      if (!extractedText.trim()) return error("No readable text was found in this PDF. Try a clear photo.");
      parsed = await callTextModel(env,
        `You accurately read Indian grocery and household shopping bills. Currency is INR. Normalize common units. ${prompt}`,
        extractedText,
        2200,
      );
    } else {
      return error("This bill format cannot be read. Please upload a JPG, PNG, WEBP photo or PDF.");
    }
    if (!parsed?.draft || !Array.isArray(parsed.draft.items)) return error("The bill could not be interpreted. Try a clearer, straight photo.");
    return json({ draft: parsed.draft });
  }

  if (action === "suggestMarketRate") {
    const name = String(data.name || "").trim().slice(0, 100);
    const unit = String(data.unit || "pcs").trim().slice(0, 20);
    const productType = String(data.productType || "unsure").slice(0, 20);
    const brand = String(data.brand || "").slice(0, 60);
    const packSize = String(data.packSize || "").slice(0, 40);
    if (!name) return error("Enter an item name.");
    const parsed = await callTextModel(env,
      "Estimate a plausible Indian local-retail grocery price in INR for exactly ONE requested unit. Unit discipline is critical: g means one gram (₹250/kg = ₹0.25/g); kg means one kilogram; ml means one millilitre (₹100/L = ₹0.10/ml); L means one litre. Never return per-kg or per-litre values for g or ml. Respect the supplied product type and brand. For loose items estimate loose retail rates; for branded/local products use the named brand where possible. For pkt estimate the whole packet price using pack size. This is an AI estimate, not a live store quotation. Return JSON only: {suggestion:{rate:number,min:number,max:number,note:string}}.",
      `Item: ${name}\\nProduct type: ${productType}\\nBrand/local shop: ${brand || "not supplied"}\\nPacket size: ${packSize || "not supplied"}\\nExact price unit: ${unit}\\nMarket area: ${String(data.market || user.preferredMarket || "India").slice(0, 100)}\\nPIN code: ${String(user.postalCode || "not supplied").slice(0, 6)}\\nUse everyday Indian retail prices, not wholesale rates. The rate must be INR per ONE ${unit}. For g or ml, convert from per-kg/per-litre prices to a single gram/millilitre. For pkt, estimate the whole packet price matching the supplied pack size.`,
      450,
    );
    const suggestion = parsed.suggestion;
    const rate = Number(suggestion?.rate);
    const unitKey = unit.toLowerCase();
    const ceiling = /^(g|gram|grams|ml|millilitre|milliliter)$/.test(unitKey) ? 5
      : /^(kg|kilogram|kilograms|l|litre|liter)$/.test(unitKey) ? 5000
      : /^(pcs|pc|piece|pieces)$/.test(unitKey) ? 50000 : 10000;
    if (!Number.isFinite(rate) || rate <= 0 || rate > ceiling) {
      return error("The market estimate looked unrealistic for this unit. Please enter a local shop rate instead.", 422);
    }
    return json({ suggestion: { ...suggestion, rate } });
  }

  if (action === "estimateMarketRates") {
    const items = Array.isArray(data.items) ? data.items.slice(0, 80) : [];
    if (!items.length) return error("Add items to estimate.");
    const normalizeRateUnit = (value) => {
      const key = String(value || "pcs").trim().toLowerCase().replaceAll(" ", "");
      const aliases = { gm: "g", gms: "g", gram: "g", grams: "g", kilo: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg", litre: "L", liter: "L", litres: "L", liters: "L", ltr: "L", packet: "pkt", packets: "pkt", pack: "pkt", packs: "pkt", piece: "pcs", pieces: "pcs", pc: "pcs" };
      return aliases[key] || (key === "l" ? "L" : key);
    };
    const promptItems = items.map((item, index) => ({ index, name: String(item.name || "").slice(0, 100), unit: normalizeRateUnit(item.unit), productType: String(item.productType || "unsure").slice(0, 20), brand: String(item.brand || "").slice(0, 60), packSize: String(item.packSize || "").slice(0, 40) }));
    const parsed = await callTextModel(env,
      "Estimate plausible Indian local-retail grocery prices in INR per EXACTLY ONE supplied unit. Unit discipline is critical: g means one gram (₹250/kg = ₹0.25/g); kg means one kilogram; ml means one millilitre (₹100/L = ₹0.10/ml); L means one litre. Never return per-kg or per-litre rates for g or ml. Keep original indexes. Respect each supplied productType, brand and packSize. For loose items use local loose retail assumptions; for branded/local products use the supplied brand and pack size. Do not silently assume all items are loose. Do not invent a live shop quote. Return no rate for ambiguous/non-grocery items you cannot price responsibly. Return JSON only: {rates:[{index:number,rate:number}]}.",
      `Market area: ${String(user.preferredMarket || "India").slice(0, 100)}; PIN code: ${String(user.postalCode || "not supplied").slice(0, 6)}. Prefer local Assam/nearby market context when location details support it, but do not fabricate a shop quotation.\nEach rate must be INR per ONE exact unit shown. Include loose/unbranded and local/regional brand assumptions where appropriate. Items: ${JSON.stringify(promptItems)}`,
      1600,
    );
    const rates = Array.isArray(parsed.rates) ? parsed.rates
      .filter((r) => {
        if (!Number.isInteger(r.index) || r.index < 0 || r.index >= items.length) return false;
        const unit = normalizeRateUnit(items[r.index].unit).toLowerCase();
        const ceiling = /^(g|gram|grams|ml|millilitre|milliliter)$/.test(unit) ? 5
          : /^(kg|kilogram|kilograms|l|litre|liter)$/.test(unit) ? 5000
          : /^(pcs|pc|piece|pieces)$/.test(unit) ? 50000 : 10000;
        return Number.isFinite(Number(r.rate)) && Number(r.rate) > 0 && Number(r.rate) <= ceiling;
      })
      .map((r) => ({ index: r.index, rate: Math.round(Number(r.rate) * 10000) / 10000 })) : [];
    return json({ rates });
  }

  return error("Unknown AI action.", 404);
}


function safeImportedTimestamp(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

async function resolveLegacyFileId(db, userId, legacyUri) {
  if (!legacyUri) return null;
  const row = await db.prepare(
    "SELECT id FROM uploaded_files WHERE user_id = ? AND legacy_file_uri = ?",
  ).bind(userId, legacyUri).first();
  return row?.id || null;
}

async function handleMigrationStatus(request, env, user) {
  if (request.method !== "GET") return error("Method not allowed.", 405);
  const [records, files, imports] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM shopping_records WHERE user_id = ? AND legacy_base44_id IS NOT NULL").bind(user.id).first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM uploaded_files WHERE user_id = ? AND legacy_file_uri IS NOT NULL").bind(user.id).first(),
    env.DB.prepare("SELECT imported_records, imported_files, created_at FROM migration_imports WHERE user_id = ? AND source = 'base44-v1'").bind(user.id).first(),
  ]);
  return json({
    imported_records: Number(records?.count) || 0,
    imported_files: Number(files?.count) || 0,
    last_import: imports?.created_at || null,
  });
}

async function handleMigrationImport(request, env, user) {
  if (request.method !== "POST") return error("Method not allowed.", 405);
  let body;
  try { body = await request.json(); } catch { return error("Invalid migration package."); }
  if (body?.schema !== "shopping-hisab-migration" || body?.version !== 1) {
    return error("This is not a supported Shopping Hisab migration package.");
  }
  if (!Array.isArray(body.records) || body.records.length > 250) {
    return error("Import up to 250 shopping records per batch.");
  }

  const profile = body.profile && typeof body.profile === "object" ? body.profile : null;
  if (profile?.email && String(profile.email).trim().toLowerCase() !== String(user.email || "").toLowerCase()) {
    return error("The export belongs to a different email account. Sign in with the same email before importing.", 403);
  }

  if (profile) {
    const displayName = String(profile.display_name || profile.full_name || user.name || "").trim().slice(0, 80);
    const phone = String(profile.phone || "").trim().slice(0, 24);
    const preferredMarket = String(profile.preferred_market || "").trim().slice(0, 80);
    const legacyPhotoUri = String(profile.profile_picture_uri || "").trim().slice(0, 1200);
    const photoId = parseFileId(legacyPhotoUri) || await resolveLegacyFileId(env.DB, user.id, legacyPhotoUri);
    await env.DB.prepare(
      'UPDATE "user" SET name = ?, displayName = ?, phone = ?, preferredMarket = ?, profilePictureId = COALESCE(?, profilePictureId), updatedAt = ? WHERE id = ?',
    ).bind(displayName || user.name, displayName, phone, preferredMarket, photoId, new Date().toISOString(), user.id).run();
  }

  const now = new Date().toISOString();
  const statements = [];
  for (const sourceRecord of body.records) {
    const legacyId = String(sourceRecord?.id || "").trim().slice(0, 160);
    if (!legacyId) continue;
    const legacyFileUri = String(sourceRecord?.bill_file_uri || "").trim().slice(0, 1200);
    let data;
    try {
      data = validateRecord({
        ...sourceRecord,
        bill_file_uri: legacyFileUri,
      });
    } catch (cause) {
      return error(`Record ${legacyId} could not be imported: ${cause.message}`);
    }
    const mappedFileId = data.bill_file_id || await resolveLegacyFileId(env.DB, user.id, legacyFileUri);
    data.bill_file_id = mappedFileId;
    data.legacy_bill_file_uri = mappedFileId ? null : (legacyFileUri || null);
    const id = crypto.randomUUID();
    const createdAt = safeImportedTimestamp(sourceRecord.created_date || sourceRecord.created_at, now);
    const updatedAt = safeImportedTimestamp(sourceRecord.updated_date || sourceRecord.updated_at, createdAt);
    statements.push(env.DB.prepare(
      `INSERT INTO shopping_records
       (id, user_id, shop_name, date, items_json, total, item_count, notes, source, bill_file_id, legacy_bill_file_uri, legacy_base44_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, legacy_base44_id) DO UPDATE SET
         shop_name = excluded.shop_name,
         date = excluded.date,
         items_json = excluded.items_json,
         total = excluded.total,
         item_count = excluded.item_count,
         notes = excluded.notes,
         source = excluded.source,
         bill_file_id = excluded.bill_file_id,
         legacy_bill_file_uri = excluded.legacy_bill_file_uri,
         updated_at = excluded.updated_at`,
    ).bind(id, user.id, data.shop_name, data.date, data.items_json, data.total, data.item_count, data.notes, data.source, data.bill_file_id, data.legacy_bill_file_uri, legacyId, createdAt, updatedAt));
  }

  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }

  const [recordCount, fileCount] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM shopping_records WHERE user_id = ? AND legacy_base44_id IS NOT NULL").bind(user.id).first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM uploaded_files WHERE user_id = ? AND legacy_file_uri IS NOT NULL").bind(user.id).first(),
  ]);
  await env.DB.prepare(
    `INSERT INTO migration_imports (id, user_id, source, imported_records, imported_files, created_at)
     VALUES (?, ?, 'base44-v1', ?, ?, ?)
     ON CONFLICT(user_id, source) DO UPDATE SET
       imported_records = excluded.imported_records,
       imported_files = excluded.imported_files,
       created_at = excluded.created_at`,
  ).bind(crypto.randomUUID(), user.id, Number(recordCount?.count) || 0, Number(fileCount?.count) || 0, now).run();

  return json({
    imported_this_batch: statements.length,
    total_imported_records: Number(recordCount?.count) || 0,
    total_imported_files: Number(fileCount?.count) || 0,
    message: "Records imported. Existing Base44 data has not been changed.",
  });
}

async function handleMigrationFile(request, env, user) {
  if (request.method !== "POST") return error("Method not allowed.", 405);
  const form = await request.formData();
  const file = form.get("file");
  const legacyUri = String(form.get("legacy_file_uri") || "").trim().slice(0, 1200);
  if (!(file instanceof File) || !legacyUri) return error("The file and its original Base44 file URI are required.");
  if (!file.size || file.size > MAX_FILE_BYTES) return error("Each attachment must be between 1 byte and 10 MB.");
  const type = String(file.type || "").toLowerCase();
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  if (!allowed.has(type)) return error("Supported attachment formats are JPG, PNG, WEBP and PDF.");

  const existing = await env.DB.prepare(
    "SELECT id FROM uploaded_files WHERE user_id = ? AND legacy_file_uri = ?",
  ).bind(user.id, legacyUri).first();
  if (existing) {
    await env.DB.prepare(
      "UPDATE shopping_records SET bill_file_id = ?, legacy_bill_file_uri = NULL WHERE user_id = ? AND legacy_bill_file_uri = ?",
    ).bind(existing.id, user.id, legacyUri).run();
    return json({ file_uri: `cf-file:${existing.id}`, already_imported: true });
  }

  const id = crypto.randomUUID();
  const originalName = String(file.name || "attachment").slice(0, 180);
  const uploaded = await uploadGoogleDriveFile(env.DB, user.id, env, file, originalName);
  await env.DB.prepare(
    "INSERT INTO uploaded_files (id, user_id, r2_key, storage_provider, drive_file_id, original_name, content_type, size_bytes, legacy_file_uri) VALUES (?, ?, ?, 'google_drive', ?, ?, ?, ?, ?)",
  ).bind(id, user.id, `drive:${uploaded.driveFileId}`, uploaded.driveFileId, uploaded.name, type, uploaded.size, legacyUri).run();
  await env.DB.prepare(
    "UPDATE shopping_records SET bill_file_id = ?, legacy_bill_file_uri = NULL WHERE user_id = ? AND legacy_bill_file_uri = ?",
  ).bind(id, user.id, legacyUri).run();
  return json({ file_uri: `cf-file:${id}`, already_imported: false }, 201);
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
    if (url.pathname === "/api/drive/status") return request.method === "GET" ? await handleDriveStatus(env, user) : error("Method not allowed.", 405);
    if (url.pathname === "/api/drive/initialize") return request.method === "POST" ? await handleDriveInitialize(env, user) : error("Method not allowed.", 405);
    if (url.pathname === "/api/ai/gemini-test") return request.method === "POST" ? await handleGeminiOcrTest(request, env, user) : error("Method not allowed.", 405);
    if (url.pathname === "/api/ai/read-bill") return request.method === "POST" ? await handleDirectBillRead(request, env, user) : error("Method not allowed.", 405);
    if (url.pathname === "/api/ai") return await handleAI(request, env, user);
    if (url.pathname === "/api/migration/status") return await handleMigrationStatus(request, env, user);
    if (url.pathname === "/api/migration/import") return await handleMigrationImport(request, env, user);
    if (url.pathname === "/api/migration/file") return await handleMigrationFile(request, env, user);
    return error("Not found.", 404);
  } catch (cause) {
    console.error("Native API request failed", cause);
    return error(cause?.message || "Internal server error.", 500);
  }
}
