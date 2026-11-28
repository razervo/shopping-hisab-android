import { createNativeAuth } from "@/lib/native-auth.server";
import { isValidCalendarDate } from "@/lib/date-validation.js";
import { publicProfile } from "@/lib/public-profile.js";

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

function finiteNonNegative(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function validateRecord(input) {
  const date = String(input?.date || "");
  if (!isValidCalendarDate(date)) throw new Error("Please provide a valid shopping date.");
  const items = Array.isArray(input?.items) ? input.items : [];
  if (items.length > 500) throw new Error("A shopping record cannot contain more than 500 items.");
  const cleaned = items.map((item) => {
    const estimatedPrice = Number(item?.estimated_price ?? item?.estimatedPrice);
    return {
      name: String(item?.name || "").trim().slice(0, 120),
      qty: finiteNonNegative(item?.qty),
      unit: String(item?.unit || "").trim().slice(0, 24),
      price: finiteNonNegative(item?.price),
      ...(Number.isFinite(estimatedPrice) && estimatedPrice > 0
        ? { estimated_price: estimatedPrice }
        : {}),
      amount: finiteNonNegative(item?.amount),
    };
  });
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
    const requestedLimit = Number(url.searchParams.get("limit") || 30);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 30;
    const requestedOffset = Number(url.searchParams.get("cursor") || 0);
    const offset = Number.isSafeInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 100000000) : 0;
    const shop = String(url.searchParams.get("shop") || "").trim().slice(0, 100);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    return json(await queryCombinedReportRecords(env.DB, user.id, { shop, from, to, limit, offset }));
  }

  if (path === "/aggregate" && method === "GET") {
    const [legacy, sessions] = await Promise.all([
      env.DB.prepare("SELECT COALESCE(SUM(total), 0) AS sum_total, COALESCE(MAX(total), 0) AS max_total, COUNT(*) AS count FROM shopping_records WHERE user_id = ?")
        .bind(user.id).first(),
      env.DB.prepare("SELECT COALESCE(SUM(COALESCE(confirmed_actual_total_paise, 0)), 0) / 100.0 AS sum_total, COALESCE(MAX(confirmed_actual_total_paise), 0) / 100.0 AS max_total, COUNT(*) AS count FROM shopping_sessions WHERE user_id = ? AND status = 'completed' AND legacy_record_id IS NULL")
        .bind(user.id).first(),
    ]);
    return json({ rows: [{
      sum_total: (Number(legacy?.sum_total) || 0) + (Number(sessions?.sum_total) || 0),
      max_total: Math.max(Number(legacy?.max_total) || 0, Number(sessions?.max_total) || 0),
      count: (Number(legacy?.count) || 0) + (Number(sessions?.count) || 0),
    }] });
  }

  if (path === "/" && method === "POST") {
    let data;
    try { data = validateRecord(await request.json()); } catch (e) { return error(e.message); }
    const idempotencyKey = String(request.headers.get("Idempotency-Key") || "").trim();
    if (!idempotencyKey || idempotencyKey.length > 180) return error("Missing or invalid Idempotency-Key. Please retry.", 400);
    const operation = "legacy_record_create";
    const requestHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(data)));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const responseJson = JSON.stringify({ id });
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO shopping_idempotency_keys (id, user_id, session_id, operation, idempotency_key, request_hash, response_json, response_status, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, 201, ?)").bind(crypto.randomUUID(), user.id, operation, idempotencyKey, requestHash, responseJson, now),
      env.DB.prepare("INSERT INTO shopping_records (id, user_id, shop_name, date, items_json, total, item_count, notes, source, bill_file_id, legacy_bill_file_uri, receipts_json, reconciliation_status, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM shopping_idempotency_keys WHERE user_id = ? AND operation = ? AND idempotency_key = ? AND response_json = ? AND request_hash = ?) AND NOT EXISTS (SELECT 1 FROM shopping_records WHERE id = ? AND user_id = ?)").bind(id, user.id, data.shop_name, data.date, data.items_json, data.total, data.item_count, data.notes, data.source, data.bill_file_id, data.legacy_bill_file_uri, data.receipts_json, data.reconciliation_status, now, now, user.id, operation, idempotencyKey, responseJson, requestHash, id, user.id),
    ]);
    const stored = await env.DB.prepare("SELECT request_hash, response_json FROM shopping_idempotency_keys WHERE user_id = ? AND operation = ? AND idempotency_key = ?").bind(user.id, operation, idempotencyKey).first();
    if (!stored) return error("Save could not be confirmed. Please retry.", 503);
    if (stored.request_hash !== requestHash) return error("This save key was already used for different shopping data. Please start a new save.", 409);
    const savedId = JSON.parse(stored.response_json || "{}").id;
    const record = await fetchRecord(env.DB, user.id, savedId);
    return record ? json(record, 201) : error("Save could not be confirmed. Please retry.", 503);
  }

  const match = /^\/([a-f0-9-]{36})$/i.exec(path);
  if (!match) return error("Not found.", 404);
  const recordId = match[1];

  if (method === "GET") {
    const legacyRecord = await fetchRecord(env.DB, user.id, recordId);
    if (legacyRecord) return json(legacyRecord);
    const page = await queryCombinedReportRecords(env.DB, user.id, { recordId, limit: 1, offset: 0 });
    const record = page.items[0] || null;
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

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function findDriveUploadByMarker(token, folderId, markerKey, contentHash) {
  const query = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and appProperties has { key='shoppingHisabUploadKey' and value='${markerKey}' } and appProperties has { key='shoppingHisabContentHash' and value='${contentHash}' }`,
    fields: "files(id,name,mimeType,size,appProperties)", pageSize: "10",
  });
  const response = await driveRequest(token, `https://www.googleapis.com/drive/v3/files?${query}`);
  const listing = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Could not check Google Drive for a previous upload. Please reconnect Drive and retry.");
  return listing.files?.find((item) => item.id) || null;
}
async function uploadGoogleDriveFile(db, userId, env, file, originalName, idempotencyKey = crypto.randomUUID()) {
  const fileBytes = await file.arrayBuffer();
  const contentHash = await sha256Hex(fileBytes);
  const normalizedKey = String(idempotencyKey).slice(0, 500);
  const markerKey = await sha256Hex(new TextEncoder().encode(normalizedKey));
  const leaseToken = crypto.randomUUID();
  const token = await getGoogleDriveToken(db, userId, env);
  const folderId = await ensureGoogleDriveFolder(db, userId, token);
  await db.prepare("INSERT OR IGNORE INTO drive_upload_idempotency (id, user_id, idempotency_key, content_hash, status, lease_token) VALUES (?, ?, ?, ?, 'pending', ?)")
    .bind(crypto.randomUUID(), userId, normalizedKey, contentHash, leaseToken).run();
  const reservation = await db.prepare("SELECT * FROM drive_upload_idempotency WHERE user_id = ? AND idempotency_key = ?").bind(userId, normalizedKey).first();
  if (!reservation || reservation.content_hash !== contentHash) throw new Error("This upload retry key was already used for different file content. Choose the file again.");
  if (reservation.status === "complete" && reservation.drive_file_id) {
    const known = await db.prepare("SELECT original_name, size_bytes FROM uploaded_files WHERE user_id = ? AND drive_file_id = ?").bind(userId, reservation.drive_file_id).first();
    return { driveFileId: reservation.drive_file_id, size: Number(known?.size_bytes) || file.size, name: known?.original_name || String(originalName || file.name || "attachment").slice(0, 180), recovered: true };
  }
  // A pending upload lease is considered stale only after 30 minutes to reduce
  // the chance of taking over a slow active Drive upload and creating a duplicate.
  let driveFile = await findDriveUploadByMarker(token, folderId, markerKey, contentHash);
  if (!driveFile) {
    if (reservation.lease_token !== leaseToken) {
      const takeover = await db.prepare("UPDATE drive_upload_idempotency SET lease_token = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND idempotency_key = ? AND status = 'pending' AND updated_at < datetime('now', '-30 minutes')")
        .bind(leaseToken, userId, normalizedKey).run();
      if (!takeover?.meta?.changes) throw new Error("This upload is already being processed. Please wait a moment and retry.");
    }
    const metadata = { name: String(originalName || file.name || "attachment").slice(0, 180), parents: [folderId], appProperties: { shoppingHisabUploadKey: markerKey, shoppingHisabContentHash: contentHash } };
    const boundary = `shoppinghisab_${crypto.randomUUID().replace(/-/g, "")}`;
    const multipartBody = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`, fileBytes, `\r\n--${boundary}--`,
    ], { type: `multipart/related; boundary=${boundary}` });
    const response = await driveRequest(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,appProperties", {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: multipartBody,
    });
    driveFile = await response.json().catch(() => ({}));
    if (!response.ok || !driveFile.id) throw new Error("Google Drive could not save this attachment. Check your Drive storage and reconnect if needed.");
  }
  await db.prepare("UPDATE drive_upload_idempotency SET status = 'complete', drive_file_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND idempotency_key = ? AND content_hash = ?")
    .bind(driveFile.id, userId, normalizedKey, contentHash).run();
  return { driveFileId: driveFile.id, size: Number(driveFile.size) || file.size, name: driveFile.name || String(originalName || file.name || "attachment").slice(0, 180), recovered: Boolean(driveFile.recovered) };
}
async function ensureDriveUploadMetadata(db, userId, uploaded, contentType, legacyFileUri = null) {
  let existing = await db.prepare("SELECT id FROM uploaded_files WHERE user_id = ? AND drive_file_id = ?").bind(userId, uploaded.driveFileId).first();
  if (existing) {
    if (legacyFileUri) await db.prepare("UPDATE uploaded_files SET legacy_file_uri = COALESCE(legacy_file_uri, ?) WHERE id = ? AND user_id = ?").bind(legacyFileUri, existing.id, userId).run();
    await db.prepare("UPDATE drive_upload_idempotency SET uploaded_file_id = ?, status = 'complete', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND drive_file_id = ?").bind(existing.id, userId, uploaded.driveFileId).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  const statement = legacyFileUri
    ? db.prepare("INSERT OR IGNORE INTO uploaded_files (id, user_id, r2_key, storage_provider, drive_file_id, original_name, content_type, size_bytes, legacy_file_uri) VALUES (?, ?, ?, 'google_drive', ?, ?, ?, ?, ?)").bind(id, userId, `drive:${uploaded.driveFileId}`, uploaded.driveFileId, uploaded.name, contentType, uploaded.size, legacyFileUri)
    : db.prepare("INSERT OR IGNORE INTO uploaded_files (id, user_id, r2_key, storage_provider, drive_file_id, original_name, content_type, size_bytes) VALUES (?, ?, ?, 'google_drive', ?, ?, ?, ?)").bind(id, userId, `drive:${uploaded.driveFileId}`, uploaded.driveFileId, uploaded.name, contentType, uploaded.size);
  await statement.run();
  existing = await db.prepare("SELECT id FROM uploaded_files WHERE user_id = ? AND drive_file_id = ?").bind(userId, uploaded.driveFileId).first();
  if (!existing) throw new Error("Drive saved the attachment, but its metadata could not be recovered. Retry safely.");
  await db.prepare("UPDATE drive_upload_idempotency SET uploaded_file_id = ?, status = 'complete', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND drive_file_id = ?").bind(existing.id, userId, uploaded.driveFileId).run();
  return existing.id;
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
    const key = request.headers.get("Idempotency-Key") || crypto.randomUUID();
    const uploaded = await uploadGoogleDriveFile(env.DB, user.id, env, file, file.name || "upload", key);
    const id = await ensureDriveUploadMetadata(env.DB, user.id, uploaded, type);
    return json({ file_uri: `cf-file:${id}`, file_id: id, recovered: Boolean(uploaded.recovered) }, uploaded.recovered ? 200 : 201);
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
    return json(publicProfile(user));
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
    question: `Read this handwritten English shopping bill. Return JSON only, with no markdown or explanation. Currency is INR. Normalize units to kg, g, L, ml, pcs, pkt, dozen or box. Never guess unreadable text or prices. The number in the rightmost price column is the total for that row quantity. Put it in amount and calculate price=amount/qty when quantity is clear. If no price is visible, set price=0 and amount=0. Keep quantity in the normalized unit as written (200 gm => qty 200, unit g; 5 kg => qty 5, unit kg; half kg => qty 0.5, unit kg). ${instructions} Return exactly this shape: { "draft": { "shopName": "", "date": null, "notes": "", "items": [{ "name": "", "qty": 1, "unit": "pcs", "price": 0, "amount": 0 }], "totals": { "subtotal": null, "discount": null, "tax": null, "roundOff": null, "grandTotal": null, "grandTotalLabel": null } } }. For a priced receipt, read the printed bill summary separately from item rows. Set grandTotal only when a clearly printed final payable/net/grand total is visible; copy its number exactly and set grandTotalLabel to the printed label. Extract subtotal, discount, tax/GST and round-off only when explicitly printed. Use null for unreadable or absent totals. Never calculate or invent the grand total.`,
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
    "Convert this OCR transcription into valid JSON only for an Indian shopping list or receipt. Preserve all visible items and quantities. Never invent prices or items. If no row price is visible, set price=0 and amount=0. If a row total is visible, put it in amount and calculate price=amount/qty only when quantity is clear. For priced receipts, separately transcribe printed subtotal, discount, GST/tax, round-off and final payable/grand total. Only set totals.grandTotal when a clearly labelled final amount payable is visible; copy it exactly, include its printed label, and use null for absent or unreadable values. Never calculate a grand total from item rows. Return exactly {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:number,amount:number}],totals:{subtotal:number|null,discount:number|null,tax:number|null,roundOff:number|null,grandTotal:number|null,grandTotalLabel:string|null}}}.",
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
  const prompt = "Read this handwritten English shopping bill carefully. Return JSON only. Currency is INR. Never invent unreadable items, quantities or prices. Preserve quantities and units. A right-side price is the TOTAL for that row quantity; put it in amount and calculate price=amount/qty only when both are clear. If no price is visible, use price=0 and amount=0. Normalize kg/kilo to kg, gm/gram to g, litre/ltr to L, packet to pkt and piece to pcs. " + instructions + " Return exactly {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:number,amount:number}],totals:{subtotal:number|null,discount:number|null,tax:number|null,roundOff:number|null,grandTotal:number|null,grandTotalLabel:string|null}}}. For priced receipts, capture only totals explicitly printed on the bill. grandTotal means the clearly labelled final amount due/payable; never compute it from item rows. Use null when absent or unclear. Use empty shopName and null date when absent.";
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

async function readBillWithFallback(env, imageDataUrl, instructions, maxTokens = 2200, allowEmptyItems = false) {
  let geminiError = null;
  if (env.GEMINI_API_KEY) {
    try {
      const parsed = await callGeminiVision(env, imageDataUrl, instructions, maxTokens);
      if (parsed.draft.items.length || allowEmptyItems) return { ...parsed, reader: "gemini" };
      geminiError = new Error("Gemini did not detect any shopping-list items.");
    } catch (cause) {
      geminiError = cause;
      console.warn("Gemini OCR failed; trying Moondream fallback:", cause?.message || cause);
    }
  }
  if (env.AI) {
    try {
      const parsed = await callVisionModel(env, imageDataUrl, instructions, maxTokens);
      if (parsed?.draft && Array.isArray(parsed.draft.items) && (parsed.draft.items.length || allowEmptyItems)) {
        return { ...parsed, reader: "moondream_fallback" };
      }
      throw new Error("Moondream returned an invalid or empty OCR result.");
    } catch (fallbackError) {
      const details = [geminiError?.message, fallbackError?.message].filter(Boolean).join(" | ");
      throw new Error(details ? "OCR failed with Gemini and Cloudflare AI: " + details : "OCR could not read this image.");
    }
  }
  throw new Error(geminiError
    ? "Gemini OCR failed and Cloudflare AI fallback is not configured: " + geminiError.message
    : "OCR is unavailable. Configure GEMINI_API_KEY or the Cloudflare AI binding.");
}

async function handleGeminiOcrTest(request, env, user) {
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
    const imageDataUrl = `data:${mime};base64,${imageBase64}`;
    const parsed = await readBillWithFallback(env, imageDataUrl, prompt, 3000, purpose === "priced_list");
    return { parsed, ms: Date.now() - modelStarted };
  })();
  const uploadPromise = (async () => {
    const uploadStarted = Date.now();
    const key = request.headers.get("Idempotency-Key") || crypto.randomUUID();
    const uploaded = await uploadGoogleDriveFile(env.DB, user.id, env, file, file.name || "gemini-ocr-test.jpg", key);
    const id = await ensureDriveUploadMetadata(env.DB, user.id, uploaded, mime);
    return { file_uri: `cf-file:${id}`, ms: Date.now() - uploadStarted };
  })();
  const [model, uploaded] = await Promise.all([modelPromise, uploadPromise]);
  return json({
    draft: model.parsed.draft,
    file_uri: uploaded.file_uri,
    reader: model.parsed.reader,
    timing: { ocr_ms: model.ms, drive_upload_ms: uploaded.ms, total_ms: Date.now() - started }
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
    : "Read this priced Indian grocery list or handwritten shopping note carefully. Extract only visible rows. The number written in the rightmost price column beside an item is the TOTAL amount for that entire row quantity, not the price per kg/g/L/packet. Put that row total in amount. Set price to amount divided by qty only when both are clearly legible; otherwise set price to 0 and preserve the visible amount. For example, Rice — 5 kg — 200 means qty=5, unit=kg, amount=200, price=40. Chilli powder — 200 gm — 40 means qty=200, unit=g, amount=40, price=0.2. Normalize gm/gms to g, kilo to kg, litre to L, packet to pkt, and piece to pcs. Do not multiply a row total by quantity. Separately read the printed receipt summary: subtotal, discount, GST/tax, round-off and final amount due/payable. Set totals.grandTotal only when a clearly labelled final/net/payable amount is visible; copy the value exactly and set grandTotalLabel to the printed label. Extract other totals only when clearly printed. Use null for absent or unreadable values. Never calculate the grand total from item rows or invent invisible details. Return JSON only: {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:number,amount:number}],totals:{subtotal:number|null,discount:number|null,tax:number|null,roundOff:number|null,grandTotal:number|null,grandTotalLabel:string|null}}}.";

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageDataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
  // Save the original receipt first. Do not spend AI inference on a file that
  // cannot be persisted (for example, when Drive is disconnected or unavailable).
  // The upload operation is idempotent, so a retry after a lost response recovers
  // the existing Drive file instead of creating another copy.
  const uploadKey = request.headers.get("Idempotency-Key") || crypto.randomUUID();
  let uploaded;
  try {
    uploaded = await uploadGoogleDriveFile(env.DB, user.id, env, file, file.name || "shopping-list.jpg", uploadKey);
  } catch (cause) {
    throw new Error(`Receipt could not be saved to Google Drive: ${cause?.message || "Please reconnect Drive and retry."}`);
  }
  const id = await ensureDriveUploadMetadata(env.DB, user.id, uploaded, mime);
  const fileUri = `cf-file:${id}`;

  let parsed;
  try {
    parsed = await readBillWithFallback(env, imageDataUrl, `Purpose: ${purpose}. ${prompt}`, 2200, purpose === "priced_list");
  } catch (cause) {
    return json({ draft: null, file_uri: fileUri, recoverable: true, error: `Receipt saved. AI reading failed: ${cause?.message || "Try again."}` });
  }
  if (!parsed?.draft || !Array.isArray(parsed.draft.items) || (!parsed.draft.items.length && purpose !== "priced_list")) {
    return json({ draft: null, file_uri: fileUri, recoverable: true, error: "Receipt saved, but the bill could not be interpreted. Retry reading or enter items manually." });
  }
  return json({ draft: parsed.draft, file_uri: fileUri });
}


async function queryCombinedReportRecords(db, userId, { shop = "", from = "", to = "", recordId = "", limit = 200, offset = 0 } = {}) {
  const cleanShop = String(shop || "").trim().slice(0, 100);
  const cleanId = String(recordId || "").trim();
  const legacyFilters = [];
  const legacyValues = [];
  const sessionFilters = [];
  const sessionValues = [];
  if (cleanShop) {
    legacyFilters.push("instr(lower(shop_name), lower(?)) > 0");
    legacyValues.push(cleanShop);
    sessionFilters.push("instr(lower(COALESCE(NULLIF(s.name, ''), 'Shopping session')), lower(?)) > 0");
    sessionValues.push(cleanShop);
  }
  if (from) {
    legacyFilters.push("date >= ?");
    legacyValues.push(from);
    sessionFilters.push("s.shopping_date >= ?");
    sessionValues.push(from);
  }
  if (to) {
    legacyFilters.push("date <= ?");
    legacyValues.push(to);
    sessionFilters.push("s.shopping_date <= ?");
    sessionValues.push(to);
  }
  if (cleanId) {
    legacyFilters.push("id = ?");
    legacyValues.push(cleanId);
    sessionFilters.push("s.id = ?");
    sessionValues.push(cleanId);
  }
  const legacyWhere = legacyFilters.map((filter) => " AND " + filter).join("");
  const sessionWhere = sessionFilters.map((filter) => " AND " + filter).join("");
  const sql = `
    SELECT id, shop_name, date, items_json, total, item_count, notes, source,
      bill_file_id, legacy_bill_file_uri, receipts_json, reconciliation_status, created_at, updated_at
    FROM (
      SELECT id, shop_name, date, items_json, total, item_count, notes, source,
        bill_file_id, legacy_bill_file_uri, receipts_json, reconciliation_status, created_at, updated_at
      FROM shopping_records
      WHERE user_id = ?${legacyWhere}
      UNION ALL
      SELECT
        s.id AS id,
        COALESCE(NULLIF(s.name, ''), 'Shopping session') AS shop_name,
        s.shopping_date AS date,
        COALESCE((
          SELECT json_group_array(json_object(
            'name', pl.product_name,
            'qty', pl.quantity,
            'unit', pl.unit,
            'price', COALESCE(pl.unit_price_paise, 0) / 100.0,
            'amount', COALESCE(pl.line_amount_paise, 0) / 100.0,
            'is_extra', pl.is_extra
          ))
          FROM shopping_purchase_lines pl
          INNER JOIN shopping_actual_bills b
            ON b.id = pl.bill_id AND b.user_id = pl.user_id AND b.session_id = pl.session_id
          WHERE pl.user_id = s.user_id AND pl.session_id = s.id
            AND b.included_in_actual = 1 AND b.bill_status NOT IN ('duplicate', 'void')
        ), '[]') AS items_json,
        COALESCE(s.confirmed_actual_total_paise, 0) / 100.0 AS total,
        (
          SELECT COUNT(*)
          FROM shopping_purchase_lines pl
          INNER JOIN shopping_actual_bills b
            ON b.id = pl.bill_id AND b.user_id = pl.user_id AND b.session_id = pl.session_id
          WHERE pl.user_id = s.user_id AND pl.session_id = s.id
            AND b.included_in_actual = 1 AND b.bill_status NOT IN ('duplicate', 'void')
        ) AS item_count,
        'Completed shopping session' AS notes,
        'session' AS source,
        NULL AS bill_file_id,
        NULL AS legacy_bill_file_uri,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', b.id,
            'kind', 'actual',
            'shop_name', b.shop_name,
            'date', b.purchase_date,
            'receipt_number', b.receipt_number,
            'amount', CASE WHEN b.bill_total_paise IS NULL THEN NULL ELSE b.bill_total_paise / 100.0 END,
            'total', CASE WHEN b.bill_total_paise IS NULL THEN NULL ELSE b.bill_total_paise / 100.0 END,
            'item_count', (SELECT COUNT(*) FROM shopping_purchase_lines pl WHERE pl.bill_id=b.id AND pl.user_id=b.user_id AND pl.session_id=b.session_id),
            'file_uri', CASE WHEN b.file_id IS NULL THEN NULL ELSE 'cf-file:' || b.file_id END,
            'status', b.bill_status,
            'included_in_actual', b.included_in_actual
          ))
          FROM shopping_actual_bills b
          WHERE b.user_id = s.user_id AND b.session_id = s.id
        ), '[]') AS receipts_json,
        'complete' AS reconciliation_status,
        s.created_at AS created_at,
        s.updated_at AS updated_at
      FROM shopping_sessions s
      WHERE s.user_id = ? AND s.status = 'completed' AND s.legacy_record_id IS NULL${sessionWhere}
    )
    ORDER BY date DESC, created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `;
  const rows = await db.prepare(sql).bind(userId, ...legacyValues, userId, ...sessionValues, limit + 1, offset).all();
  const raw = rows.results || [];
  const hasMore = raw.length > limit;
  return {
    items: raw.slice(0, limit).map(mapRecord),
    has_more: hasMore,
    next_cursor: hasMore ? String(offset + limit) : null,
  };
}

async function handleReports(request, env, user, url) {
  if (request.method !== "GET") return error("Method not allowed.", 405);

  if (url.pathname === "/api/reports/export") {
    const requestedLimit = Number(url.searchParams.get("limit") || 200);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 200;
    const requestedOffset = Number(url.searchParams.get("cursor") || 0);
    const offset = Number.isSafeInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 100000000) : 0;
    return json(await queryCombinedReportRecords(env.DB, user.id, { limit, offset }));
  }

  const month = String(url.searchParams.get("month") || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return error("A valid month in YYYY-MM format is required.");
  const [year, monthNumber] = month.split("-").map(Number);
  const from = month + "-01";
  const to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const requestedLimit = Number(url.searchParams.get("limit") || 500);
  const monthlyLimit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 500;
  const requestedCursor = Number(url.searchParams.get("cursor") || 0);
  const monthlyOffset = Number.isSafeInteger(requestedCursor) ? Math.min(Math.max(requestedCursor, 0), 100000000) : 0;

  const [monthly, legacyLifetime, sessionLifetime] = await Promise.all([
    queryCombinedReportRecords(env.DB, user.id, { from, to, limit: monthlyLimit, offset: monthlyOffset }),
    env.DB.prepare(
      "SELECT COALESCE(SUM(total), 0) AS sum_total, COALESCE(MAX(total), 0) AS max_total, COUNT(*) AS count FROM shopping_records WHERE user_id = ?",
    ).bind(user.id).first(),
    env.DB.prepare(
      "SELECT COALESCE(SUM(COALESCE(confirmed_actual_total_paise, 0)), 0) / 100.0 AS sum_total, COALESCE(MAX(confirmed_actual_total_paise), 0) / 100.0 AS max_total, COUNT(*) AS count FROM shopping_sessions WHERE user_id = ? AND status = 'completed' AND legacy_record_id IS NULL",
    ).bind(user.id).first(),
  ]);
  const legacyTotal = Number(legacyLifetime?.sum_total) || 0;
  const sessionTotal = Number(sessionLifetime?.sum_total) || 0;
  return json({
    month,
    records: monthly.items,
    records_truncated: monthly.has_more,
    next_cursor: monthly.next_cursor,
    lifetime: {
      total: legacyTotal + sessionTotal,
      highest: Math.max(Number(legacyLifetime?.max_total) || 0, Number(sessionLifetime?.max_total) || 0),
      entries: (Number(legacyLifetime?.count) || 0) + (Number(sessionLifetime?.count) || 0),
    },
  });
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
      ? "Read this shopping list image carefully. Extract only visible items. Do not invent prices or items. Preserve quantities and units exactly when legible. If quantity or unit is unclear, use qty 1 and unit pcs. Return JSON only: {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:0,amount:0}],totals:{subtotal:null,discount:null,tax:null,roundOff:null,grandTotal:null,grandTotalLabel:null}}}. Use YYYY-MM-DD dates only when clearly printed; otherwise use today's date."
      : "Read this priced Indian grocery list or receipt carefully. Extract only visible rows. The number written in the rightmost price column beside an item is the TOTAL amount for that entire row quantity, not the price per kg/g/L/packet. Put that row total in amount. Set price to amount divided by qty only when both are clearly legible; otherwise set price to 0 and preserve the visible amount. For example, Rice — 5 kg — 200 means qty=5, unit=kg, amount=200, price=40. Chilli powder — 200 gm — 40 means qty=200, unit=g, amount=40, price=0.2. Normalize gm/gms to g, kilo to kg, litre to L, packet to pkt, and piece to pcs. Do not multiply a row total by quantity. Separately extract the printed bill subtotal, discount, tax/GST, round-off and final amount due/payable. Set totals.grandTotal only when that final total is clearly printed; return the exact value and printed label. Use null for missing or unclear totals. Never calculate a grand total by adding item rows. Return JSON only: {draft:{shopName:string,date:string|null,notes:string,items:[{name:string,qty:number,unit:string,price:number,amount:number}],totals:{subtotal:number|null,discount:number|null,tax:number|null,roundOff:number|null,grandTotal:number|null,grandTotalLabel:string|null}}}. Do not invent prices or add invisible items.";
    let parsed;
    const mime = String(file.content_type || "").toLowerCase();
    if (mime.startsWith("image/")) {
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_FILE_BYTES) return error("The bill image is empty or too large. Please choose an image under 10 MB.");
      const imageDataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
      parsed = await readBillWithFallback(env, imageDataUrl, prompt, 2200, false);
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
      'UPDATE "user" SET name = COALESCE(NULLIF(?, \'\'), name), displayName = COALESCE(NULLIF(?, \'\'), displayName), phone = COALESCE(NULLIF(?, \'\'), phone), preferredMarket = COALESCE(NULLIF(?, \'\'), preferredMarket), profilePictureId = COALESCE(?, profilePictureId), updatedAt = ? WHERE id = ?',
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

  const originalName = String(file.name || "attachment").slice(0, 180);
  const uploadKey = `legacy-file:${await sha256Hex(new TextEncoder().encode(legacyUri))}`;
  const uploaded = await uploadGoogleDriveFile(env.DB, user.id, env, file, originalName, uploadKey);
  const id = await ensureDriveUploadMetadata(env.DB, user.id, uploaded, type, legacyUri);
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

    if (url.pathname === "/api/reports" || url.pathname === "/api/reports/export") {
      return await handleReports(request, env, user, url);
    }
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
    return error(cause?.message || "The request failed unexpectedly. Please retry.", 500);
  }
}
