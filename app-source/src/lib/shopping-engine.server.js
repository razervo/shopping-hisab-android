import { createNativeAuth } from "@/lib/native-auth.server";

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
const fail = (message, status = 400) => json({ error: message }, status);
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const text = (value, max = 160) => String(value ?? "").trim().slice(0, max);
const safeJson = (value, fallback = {}) => {
  if (value && typeof value === "object") return value;
  if (value == null || value === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(value));

async function audit(db, userId, sessionId, entityType, entityId, eventType, after, before = null) {
  await db.prepare(`INSERT INTO shopping_audit_events
    (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(id(), userId, sessionId, entityType, entityId, eventType,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after), now()).run();
}

async function ownedSession(db, userId, sessionId) {
  return db.prepare("SELECT * FROM shopping_sessions WHERE id=? AND user_id=?")
    .bind(sessionId, userId).first();
}

async function sessionDetail(db, userId, sessionId) {
  const session = await ownedSession(db, userId, sessionId);
  if (!session) return null;
  const [lists, items, bills, estimates] = await Promise.all([
    db.prepare("SELECT * FROM shopping_source_lists WHERE user_id=? AND session_id=? ORDER BY created_at,id")
      .bind(userId, sessionId).all(),
    db.prepare("SELECT * FROM shopping_items WHERE user_id=? AND session_id=? ORDER BY created_at,id")
      .bind(userId, sessionId).all(),
    db.prepare(`SELECT id,shop_name,purchase_date,receipt_number,bill_total_paise,bill_status,
      included_in_actual,duplicate_of_bill_id,uploaded_at FROM shopping_actual_bills
      WHERE user_id=? AND session_id=? ORDER BY uploaded_at,id`).bind(userId, sessionId).all(),
    db.prepare("SELECT id,version_number,estimated_total_paise,calculation_source,market_area,notes,created_at FROM shopping_estimates WHERE user_id=? AND session_id=? ORDER BY version_number DESC")
      .bind(userId, sessionId).all(),
  ]);
  const total = await db.prepare(`SELECT COALESCE(SUM(CASE WHEN included_in_actual=1 THEN bill_total_paise ELSE 0 END),0) AS actual_total_paise,
    SUM(CASE WHEN included_in_actual=1 AND bill_total_paise IS NULL THEN 1 ELSE 0 END) AS bills_amount_pending
    FROM shopping_actual_bills WHERE user_id=? AND session_id=?`).bind(userId, sessionId).first();
  return {
    ...session,
    source_lists: lists.results || [],
    items: items.results || [],
    bills: bills.results || [],
    estimates: estimates.results || [],
    actual_total_paise: Number(total?.actual_total_paise || 0),
    bills_amount_pending: Number(total?.bills_amount_pending || 0),
  };
}

export async function handleShoppingEngine(request, env) {
  const auth = await createNativeAuth(env).api.getSession({ headers: request.headers });
  const userId = auth?.user?.id;
  if (!userId) return fail("Please sign in to continue.", 401);
  const db = env.DB;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/shopping/, "") || "/";
  const method = request.method;
  let body = {};
  if (["POST", "PATCH"].includes(method)) {
    try { body = await request.json(); } catch { return fail("Invalid JSON request."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid request body.");
  }

  if (path === "/sessions" && method === "GET") {
    const status = text(url.searchParams.get("status"), 24);
    const where = ["s.user_id=?"];
    const values = [userId];
    if (["open", "ready_to_confirm", "completed"].includes(status)) {
      where.push("s.status=?"); values.push(status);
    }
    const rows = await db.prepare(`SELECT s.*,
      (SELECT COUNT(*) FROM shopping_source_lists l WHERE l.user_id=s.user_id AND l.session_id=s.id) AS list_count,
      (SELECT COUNT(*) FROM shopping_items i WHERE i.user_id=s.user_id AND i.session_id=s.id) AS item_count,
      (SELECT COALESCE(SUM(b.bill_total_paise),0) FROM shopping_actual_bills b WHERE b.user_id=s.user_id AND b.session_id=s.id AND b.included_in_actual=1) AS actual_total_paise
      FROM shopping_sessions s WHERE ${where.join(" AND ")}
      ORDER BY s.updated_at DESC LIMIT 100`).bind(...values).all();
    return json({ sessions: rows.results || [] });
  }

  if (path === "/sessions" && method === "POST") {
    const shoppingDate = text(body.shopping_date, 10);
    if (!validDate(shoppingDate)) return fail("A valid shopping_date (YYYY-MM-DD) is required.");
    const sessionId = id(), timestamp = now();
    const name = text(body.name, 120);
    await db.prepare(`INSERT INTO shopping_sessions
      (id,user_id,name,shopping_date,status,created_at,updated_at) VALUES (?,?,?,?,'open',?,?)`)
      .bind(sessionId,userId,name,shoppingDate,timestamp,timestamp).run();
    await audit(db,userId,sessionId,"session",sessionId,"session_created",{name,shopping_date:shoppingDate});
    return json(await sessionDetail(db,userId,sessionId),201);
  }

  const sessionMatch = /^\/sessions\/([a-f0-9-]{36})(?:\/(.*))?$/i.exec(path);
  if (!sessionMatch) return fail("Shopping endpoint not found.",404);
  const sessionId = sessionMatch[1], subpath = sessionMatch[2] || "";
  const session = await ownedSession(db,userId,sessionId);
  if (!session) return fail("Shopping session not found.",404);

  if (!subpath && method === "GET") return json(await sessionDetail(db,userId,sessionId));
  if (!subpath && method === "PATCH") {
    const patch = {};
    if (body.name !== undefined) patch.name = text(body.name,120);
    if (body.shopping_date !== undefined) {
      if (!validDate(body.shopping_date)) return fail("A valid shopping date is required.");
      patch.shopping_date = body.shopping_date;
    }
    if (body.status !== undefined) {
      if (!["open","ready_to_confirm"].includes(body.status)) return fail("A session can only be completed through explicit expense confirmation.");
      patch.status = body.status;
    }
    if (!Object.keys(patch).length) return fail("No supported session changes were supplied.");
    const before = Object.fromEntries(Object.keys(patch).map(k=>[k,session[k]]));
    const sets = Object.keys(patch).map(k=>`${k}=?`);
    await db.prepare(`UPDATE shopping_sessions SET ${sets.join(",")},updated_at=? WHERE id=? AND user_id=?`)
      .bind(...Object.values(patch),now(),sessionId,userId).run();
    await audit(db,userId,sessionId,"session",sessionId,"session_updated",patch,before);
    return json(await sessionDetail(db,userId,sessionId));
  }

  if (subpath === "lists" && method === "POST") {
    const sourceType = body.source_type || "manual_entry";
    if (!["handwritten_scan","manual_entry","imported_list"].includes(sourceType)) return fail("Invalid source type.");
    const fileId = text(body.file_id,80) || null;
    if (fileId) {
      const file = await db.prepare("SELECT id FROM uploaded_files WHERE id=? AND user_id=?").bind(fileId,userId).first();
      if (!file) return fail("The selected file was not found in your account.",404);
    }
    const listId=id(), timestamp=now();
    await db.prepare(`INSERT INTO shopping_source_lists
      (id,user_id,session_id,source_type,file_id,original_file_uri,ocr_status,source_metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(listId,userId,sessionId,sourceType,fileId,text(body.original_file_uri,1200)||null,
        sourceType==="manual_entry"?"not_applicable":"not_started",
        JSON.stringify(body.source_metadata && typeof body.source_metadata==="object"?body.source_metadata:{}),timestamp).run();
    await audit(db,userId,sessionId,"source_list",listId,"source_list_added",{source_type:sourceType,file_id:fileId});
    return json({id:listId,session_id:sessionId,source_type:sourceType,ocr_status:sourceType==="manual_entry"?"not_applicable":"not_started",created_at:timestamp},201);
  }

  const linesMatch=/^lists\/([a-f0-9-]{36})\/lines$/i.exec(subpath);
  if (linesMatch && method === "POST") {
    const listId=linesMatch[1];
    const list=await db.prepare("SELECT id FROM shopping_source_lists WHERE id=? AND user_id=? AND session_id=?").bind(listId,userId,sessionId).first();
    if (!list) return fail("Source list not found.",404);
    const lines=Array.isArray(body.lines)?body.lines:[body];
    if (!lines.length || lines.length>200) return fail("Add between 1 and 200 source lines.");
    const timestamp=now(), statements=[];
    for (let index=0;index<lines.length;index++) {
      const line=lines[index]||{};
      const originalName=text(line.original_name ?? line.name,160);
      const recognizedName=text(line.recognized_name ?? line.name,160);
      if (!originalName && !recognizedName) return fail(`Line ${index+1} needs a name.`);
      const quantity=line.quantity==null?null:Number(line.quantity);
      if (quantity!==null && (!Number.isFinite(quantity)||quantity<0||quantity>1000000)) return fail(`Line ${index+1} has an invalid quantity.`);
      const confidence=line.ocr_confidence==null?null:Number(line.ocr_confidence);
      if (confidence!==null && (!Number.isFinite(confidence)||confidence<0||confidence>1)) return fail(`Line ${index+1} has invalid OCR confidence.`);
      const lineId=id();
      statements.push(db.prepare(`INSERT INTO shopping_source_lines
        (id,user_id,session_id,source_list_id,line_number,original_name,recognized_name,brand,product_type,pack_size,quantity,unit,ocr_confidence,original_ocr_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(lineId,userId,sessionId,listId,
          Number.isInteger(line.line_number)?line.line_number:index+1,originalName,recognizedName,
          text(line.brand,100),text(line.product_type||"unsure",40),text(line.pack_size,60),quantity,
          text(line.unit,24),confidence,JSON.stringify(line.original_ocr && typeof line.original_ocr==="object"?line.original_ocr:line),timestamp,timestamp));
    }
    await db.batch(statements);
    await db.prepare("UPDATE shopping_source_lists SET ocr_status='completed' WHERE id=? AND user_id=?").bind(listId,userId).run();
    await audit(db,userId,sessionId,"source_list",listId,"source_lines_added",{count:lines.length});
    return json({source_list_id:listId,created_count:lines.length},201);
  }

  if (subpath === "items" && method === "POST") {
    const name=text(body.product_name,160);
    if (!name) return fail("An item name is required.");
    const quantity=body.planned_quantity==null?0:Number(body.planned_quantity);
    if (!Number.isFinite(quantity)||quantity<0||quantity>1000000) return fail("Invalid planned quantity.");
    const itemId=id(),timestamp=now();
    let source = null;
    if (body.source_line_id) {
      const sourceId=text(body.source_line_id,80);
      source=await db.prepare("SELECT id,quantity FROM shopping_source_lines WHERE id=? AND user_id=? AND session_id=?")
        .bind(sourceId,userId,sessionId).first();
      if (!source) return fail("Source line not found.",404);
    }
    const normalized=text(body.normalized_name||name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," "),160).toLowerCase();
    await db.prepare(`INSERT INTO shopping_items
      (id,user_id,session_id,product_name,normalized_name,brand,product_type,pack_size,planned_quantity,unit,item_status,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'planned',?,?,?)`)
      .bind(itemId,userId,sessionId,name,normalized,text(body.brand,100),text(body.product_type||"unsure",40),
        text(body.pack_size,60),quantity,text(body.unit||"pcs",24),text(body.notes,1000),timestamp,timestamp).run();
    if (source) {
      await db.prepare("INSERT INTO shopping_item_sources (id,user_id,session_id,shopping_item_id,source_line_id,merged_quantity,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(id(),userId,sessionId,itemId,source.id,quantity,timestamp).run();
    }
    await audit(db,userId,sessionId,"shopping_item",itemId,"item_created",{product_name:name,planned_quantity:quantity,unit:text(body.unit||"pcs",24)});
    return json({id:itemId,session_id:sessionId,product_name:name,normalized_name:normalized,planned_quantity:quantity,unit:text(body.unit||"pcs",24),item_status:"planned",created_at:timestamp,updated_at:timestamp},201);
  }

  const itemMatch=/^items\/([a-f0-9-]{36})$/i.exec(subpath);
  if (itemMatch && method === "PATCH") {
    const itemId=itemMatch[1];
    const existing=await db.prepare("SELECT * FROM shopping_items WHERE id=? AND user_id=? AND session_id=?").bind(itemId,userId,sessionId).first();
    if (!existing) return fail("Shopping item not found.",404);
    const allowed=["product_name","brand","product_type","pack_size","planned_quantity","unit","item_status","notes"];
    const patch={};
    for (const key of allowed) if (body[key]!==undefined) patch[key]=body[key];
    if (!Object.keys(patch).length) return fail("No supported item changes were supplied.");
    if (patch.product_name!==undefined) {
      patch.product_name=text(patch.product_name,160);
      if (!patch.product_name) return fail("Item name cannot be empty.");
      patch.normalized_name=patch.product_name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
    }
    for (const key of ["brand","product_type","pack_size","unit","notes"]) if (patch[key]!==undefined) patch[key]=text(patch[key],key==="notes"?1000:100);
    if (patch.planned_quantity!==undefined) {
      patch.planned_quantity=Number(patch.planned_quantity);
      if (!Number.isFinite(patch.planned_quantity)||patch.planned_quantity<0||patch.planned_quantity>1000000) return fail("Invalid planned quantity.");
    }
    if (patch.item_status!==undefined && !["planned","pending","partially_purchased","purchased","cancelled"].includes(patch.item_status)) return fail("Invalid item status.");
    const before=Object.fromEntries(Object.keys(patch).filter(k=>k in existing).map(k=>[k,existing[k]]));
    await db.prepare(`UPDATE shopping_items SET ${Object.keys(patch).map(k=>k+"=?").join(",")},updated_at=? WHERE id=? AND user_id=? AND session_id=?`)
      .bind(...Object.values(patch),now(),itemId,userId,sessionId).run();
    await audit(db,userId,sessionId,"shopping_item",itemId,"item_updated",patch,before);
    return json(await db.prepare("SELECT * FROM shopping_items WHERE id=? AND user_id=? AND session_id=?").bind(itemId,userId,sessionId).first());
  }

  if (subpath === "audit" && method === "GET") {
    const rows=await db.prepare("SELECT entity_type,entity_id,event_type,before_json,after_json,metadata_json,created_at FROM shopping_audit_events WHERE user_id=? AND session_id=? ORDER BY created_at DESC LIMIT 200")
      .bind(userId,sessionId).all();
    return json({events:(rows.results||[]).map(row=>({...row,before:safeJson(row.before_json,null),after:safeJson(row.after_json,null),metadata:safeJson(row.metadata_json,{})}))});
  }

  return fail("Shopping endpoint not found.",404);
}
