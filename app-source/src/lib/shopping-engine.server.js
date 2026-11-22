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
    db.prepare(`SELECT i.*,
      COALESCE(p.purchased_quantity,0) AS purchased_quantity,
      MAX(i.planned_quantity-COALESCE(p.purchased_quantity,0),0) AS remaining_quantity,
      COALESCE(p.purchase_count,0) AS purchase_count,
      COALESCE(p.unit_mismatch_count,0) AS unit_mismatch_count
      FROM shopping_items i
      LEFT JOIN (
        SELECT pl.shopping_item_id,
          SUM(CASE WHEN LOWER(TRIM(pl.unit))=LOWER(TRIM(i2.unit)) THEN pl.quantity ELSE 0 END) AS purchased_quantity,
          SUM(CASE WHEN LOWER(TRIM(pl.unit))<>LOWER(TRIM(i2.unit)) THEN 1 ELSE 0 END) AS unit_mismatch_count,
          COUNT(CASE WHEN LOWER(TRIM(pl.unit))=LOWER(TRIM(i2.unit)) THEN 1 END) AS purchase_count
        FROM shopping_purchase_lines pl
        INNER JOIN shopping_actual_bills b ON b.id=pl.bill_id AND b.user_id=pl.user_id AND b.session_id=pl.session_id
        INNER JOIN shopping_items i2 ON i2.id=pl.shopping_item_id AND i2.user_id=pl.user_id AND i2.session_id=pl.session_id
        WHERE pl.user_id=? AND pl.session_id=? AND pl.shopping_item_id IS NOT NULL
          AND b.included_in_actual=1 AND b.bill_status NOT IN ('duplicate','void')
        GROUP BY pl.shopping_item_id
      ) p ON p.shopping_item_id=i.id
      WHERE i.user_id=? AND i.session_id=? ORDER BY i.created_at,i.id`)
      .bind(userId, sessionId, userId, sessionId).all(),
    db.prepare(`SELECT id,shop_name,purchase_date,file_id,original_file_uri,receipt_number,bill_total_paise,bill_status,
      included_in_actual,duplicate_of_bill_id,uploaded_at FROM shopping_actual_bills
      WHERE user_id=? AND session_id=? ORDER BY uploaded_at,id`).bind(userId, sessionId).all(),
    db.prepare("SELECT id,version_number,estimated_total_paise,calculation_source,market_area,notes,created_at FROM shopping_estimates WHERE user_id=? AND session_id=? ORDER BY version_number DESC")
      .bind(userId, sessionId).all(),
  ]);
  const total = await db.prepare(`SELECT COALESCE(SUM(CASE WHEN included_in_actual=1 AND bill_status NOT IN ('duplicate','void') THEN bill_total_paise ELSE 0 END),0) AS actual_total_paise,
    SUM(CASE WHEN included_in_actual=1 AND bill_status NOT IN ('duplicate','void') AND bill_total_paise IS NULL THEN 1 ELSE 0 END) AS bills_amount_pending
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
      (SELECT COALESCE(SUM(b.bill_total_paise),0) FROM shopping_actual_bills b WHERE b.user_id=s.user_id AND b.session_id=s.id AND b.included_in_actual=1 AND b.bill_status NOT IN ('duplicate','void')) AS actual_total_paise
      FROM shopping_sessions s WHERE ${where.join(" AND ")}
      ORDER BY s.updated_at DESC LIMIT 100`).bind(...values).all();
    return json({ sessions: rows.results || [] });
  }

  if (path === "/sessions" && method === "POST") {
    const shoppingDate=text(body.shopping_date,10);
    if(!validDate(shoppingDate))return fail("A valid shopping_date (YYYY-MM-DD) is required.");
    const name=text(body.name,120);
    const requestKey=text(request.headers.get("Idempotency-Key"),160);
    const operation="session_create";
    const requestHash=requestKey?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({name,shopping_date:shoppingDate}))))).map(b=>b.toString(16).padStart(2,"0")).join(""):null;
    if(requestKey){const prior=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,requestKey).first();if(prior)return prior.request_hash===requestHash?new Response(prior.response_json,{status:prior.response_status,headers}):fail("Idempotency key reused with different session data.",409);}
    const sessionId=id(),timestamp=now();
    const responseBody={id:sessionId,session_id:sessionId,name,shopping_date:shoppingDate,status:"open",created_at:timestamp,updated_at:timestamp};
    const stmts=[
      db.prepare(`INSERT INTO shopping_sessions (id,user_id,name,shopping_date,status,created_at,updated_at) VALUES (?,?,?,?,'open',?,?)`).bind(sessionId,userId,name,shoppingDate,timestamp,timestamp),
      db.prepare("INSERT INTO shopping_audit_events (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,"session",sessionId,"session_created",null,JSON.stringify({name,shopping_date:shoppingDate}),timestamp)
    ];
    if(requestKey)stmts.push(db.prepare("INSERT INTO shopping_idempotency_keys (id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,operation,requestKey,requestHash,JSON.stringify(responseBody),201,timestamp));
    try{await db.batch(stmts);}catch(error){if(requestKey){const winner=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,requestKey).first();if(winner)return winner.request_hash===requestHash?new Response(winner.response_json,{status:winner.response_status,headers}):fail("Idempotency key reused with different session data.",409);}throw error;}
    return json(responseBody,201);
  }

  const sessionMatch = /^\/sessions\/([a-f0-9-]{36})(?:\/(.*))?$/i.exec(path);
  if (!sessionMatch) return fail("Shopping endpoint not found.",404);
  const sessionId = sessionMatch[1], subpath = sessionMatch[2] || "";
  const session = await ownedSession(db,userId,sessionId);
  if (!session) return fail("Shopping session not found.",404);
  if (session.status === "completed" && method !== "GET" && subpath !== "confirm") return fail("This shopping session is completed and read-only.",409);
  if (subpath === "confirm" && method === "POST" && session.status === "completed") {
    const key=text(request.headers.get("Idempotency-Key"),160);
    if(key){const replay=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,"session_confirm:"+sessionId,key).first();if(replay){const incoming=Number(body.confirmed_total_paise);const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({confirmed_total_paise:incoming}))))).map(b=>b.toString(16).padStart(2,"0")).join("");return replay.request_hash===hash?new Response(replay.response_json,{status:replay.response_status,headers}):fail("Idempotency key reused with different confirmation total.",409);}}
    return fail("This shopping session has already been completed. Refresh to view the saved confirmation.",409);
  }

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
    const requestKey=text(request.headers.get("Idempotency-Key"),160);
    const operation="source_list_create:"+sessionId;
    const payload={source_type:body.source_type||"manual_entry",file_id:text(body.file_id,80)||null,original_file_uri:text(body.original_file_uri,1200)||null,source_metadata:body.source_metadata&&typeof body.source_metadata==="object"?body.source_metadata:{}};
    const requestHash=requestKey?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(payload))))).map(b=>b.toString(16).padStart(2,"0")).join(""):null;
    if(requestKey){
      const prior=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,requestKey).first();
      if(prior)return prior.request_hash===requestHash?new Response(prior.response_json,{status:prior.response_status,headers}):fail("Idempotency key reused with different request data.",409);
    }
    const sourceType = body.source_type || "manual_entry";
    if (!["handwritten_scan","manual_entry","imported_list"].includes(sourceType)) return fail("Invalid source type.");
    const fileId = text(body.file_id,80) || null;
    if (fileId) {
      const file = await db.prepare("SELECT id FROM uploaded_files WHERE id=? AND user_id=?").bind(fileId,userId).first();
      if (!file) return fail("The selected file was not found in your account.",404);
    }
    const listId=id(), timestamp=now();
    const responseBody={id:listId,session_id:sessionId,source_type:sourceType,ocr_status:sourceType==="manual_entry"?"not_applicable":"not_started",created_at:timestamp};
    const stmts=[db.prepare(`INSERT INTO shopping_source_lists
      (id,user_id,session_id,source_type,file_id,original_file_uri,ocr_status,source_metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(listId,userId,sessionId,sourceType,fileId,text(body.original_file_uri,1200)||null,
        sourceType==="manual_entry"?"not_applicable":"not_started",
        JSON.stringify(body.source_metadata && typeof body.source_metadata==="object"?body.source_metadata:{}),timestamp),
      db.prepare("INSERT INTO shopping_audit_events (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id(),userId,sessionId,"source_list",listId,"source_list_added",null,JSON.stringify({source_type:sourceType,file_id:fileId}),timestamp)];
    if(requestKey)stmts.push(db.prepare("INSERT INTO shopping_idempotency_keys (id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,operation,requestKey,requestHash,JSON.stringify(responseBody),201,timestamp));
    try{await db.batch(stmts);}catch(error){
      if(requestKey){const winner=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,requestKey).first();if(winner)return winner.request_hash===requestHash?new Response(winner.response_json,{status:winner.response_status,headers}):fail("Idempotency key reused with different request data.",409);}
      throw error;
    }
    return json(responseBody,201);
  }

  const linesMatch=/^lists\/([a-f0-9-]{36})\/lines$/i.exec(subpath);
  if (linesMatch && method === "POST") {
    const listId=linesMatch[1];
    const list=await db.prepare("SELECT id FROM shopping_source_lists WHERE id=? AND user_id=? AND session_id=?").bind(listId,userId,sessionId).first();
    if (!list) return fail("Source list not found.",404);
    const lines=Array.isArray(body.lines)?body.lines:[body];
    if (!lines.length || lines.length>200) return fail("Add between 1 and 200 source lines.");
    const requestKey=text(request.headers.get("Idempotency-Key"),160);
    const operation="source_lines_create:"+sessionId+":"+listId;
    const requestHash=requestKey?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(body))))).map(b=>b.toString(16).padStart(2,"0")).join(""):null;
    if (requestKey) {
      const prior=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?")
        .bind(userId,operation,requestKey).first();
      if (prior) return prior.request_hash===requestHash?new Response(prior.response_json,{status:prior.response_status,headers}):fail("Idempotency key reused with different request data.",409);
    }
    const timestamp=now(), statements=[], createdLineIds=[];
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
      createdLineIds.push(lineId);
      statements.push(db.prepare(`INSERT INTO shopping_source_lines
        (id,user_id,session_id,source_list_id,line_number,original_name,recognized_name,brand,product_type,pack_size,quantity,unit,ocr_confidence,original_ocr_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(lineId,userId,sessionId,listId,
          Number.isInteger(line.line_number)?line.line_number:index+1,originalName,recognizedName,
          text(line.brand,100),text(line.product_type||"unsure",40),text(line.pack_size,60),quantity,
          text(line.unit,24),confidence,JSON.stringify(line.original_ocr && typeof line.original_ocr==="object"?line.original_ocr:line),timestamp,timestamp));
    }
    const responseBody={source_list_id:listId,created_count:lines.length,line_ids:createdLineIds};
    statements.push(db.prepare("UPDATE shopping_source_lists SET ocr_status='completed' WHERE id=? AND user_id=?").bind(listId,userId));
    statements.push(db.prepare("INSERT INTO shopping_audit_events (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id(),userId,sessionId,"source_list",listId,"source_lines_added",null,JSON.stringify({count:lines.length}),timestamp));
    if (requestKey) statements.push(db.prepare("INSERT INTO shopping_idempotency_keys (id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id(),userId,sessionId,operation,requestKey,requestHash,JSON.stringify(responseBody),201,timestamp));
    try {
      await db.batch(statements);
    } catch (error) {
      if (requestKey) {
        const winner=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?")
          .bind(userId,operation,requestKey).first();
        if (winner) return winner.request_hash===requestHash?new Response(winner.response_json,{status:winner.response_status,headers}):fail("Idempotency key reused with different request data.",409);
      }
      throw error;
    }
    return json(responseBody,201);
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
    const requestKey=text(request.headers.get("Idempotency-Key"),160)||(source?("source_line:"+source.id):null);
    const operation="item_create:"+sessionId;
    const payload={product_name:name,normalized_name:text(body.normalized_name||name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," "),160).toLowerCase(),planned_quantity:quantity,unit:text(body.unit||"pcs",24),brand:text(body.brand,100),product_type:text(body.product_type||"unsure",40),pack_size:text(body.pack_size,60),notes:text(body.notes,1000),source_line_id:source?.id||null};
    const requestHash=requestKey?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(payload))))).map(b=>b.toString(16).padStart(2,"0")).join(""):null;
    if(requestKey){const prior=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,requestKey).first();if(prior)return prior.request_hash===requestHash?new Response(prior.response_json,{status:prior.response_status,headers}):fail("Idempotency key reused with different request data.",409);}
    const normalized=text(body.normalized_name||name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," "),160).toLowerCase();
    const responseBody={id:itemId,session_id:sessionId,product_name:name,normalized_name:normalized,planned_quantity:quantity,unit:text(body.unit||"pcs",24),item_status:"planned",created_at:timestamp,updated_at:timestamp};
    const stmts=[db.prepare(`INSERT INTO shopping_items
      (id,user_id,session_id,product_name,normalized_name,brand,product_type,pack_size,planned_quantity,unit,item_status,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'planned',?,?,?)`)
      .bind(itemId,userId,sessionId,name,normalized,text(body.brand,100),text(body.product_type||"unsure",40),
        text(body.pack_size,60),quantity,text(body.unit||"pcs",24),text(body.notes,1000),timestamp,timestamp)];
    if(source)stmts.push(db.prepare("INSERT INTO shopping_item_sources (id,user_id,session_id,shopping_item_id,source_line_id,merged_quantity,created_at) VALUES (?,?,?,?,?,?,?)").bind(id(),userId,sessionId,itemId,source.id,quantity,timestamp));
    stmts.push(db.prepare("INSERT INTO shopping_audit_events (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,"shopping_item",itemId,"item_created",null,JSON.stringify({product_name:name,planned_quantity:quantity,unit:text(body.unit||"pcs",24)}),timestamp));
    if(requestKey)stmts.push(db.prepare("INSERT INTO shopping_idempotency_keys (id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,operation,requestKey,requestHash,JSON.stringify(responseBody),201,timestamp));
    try{await db.batch(stmts);}catch(error){if(requestKey){const winner=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,requestKey).first();if(winner)return winner.request_hash===requestHash?new Response(winner.response_json,{status:winner.response_status,headers}):fail("Idempotency key reused with different request data.",409);}throw error;}
    return json(responseBody,201);
  }
  const mergeItemMatch=/^items\/([a-f0-9-]{36})\/merge$/i.exec(subpath);
  if (mergeItemMatch && method === "POST") {
    const sourceId=mergeItemMatch[1],targetId=text(body.target_item_id,80);
    if(!targetId||targetId===sourceId)return fail("Choose a different planned item to merge into.");
    const requestKey=text(request.headers.get("Idempotency-Key"),160)||("merge:"+sourceId+":"+targetId);
    const operation="item_merge:"+sessionId;
    const payload={source_item_id:sourceId,target_item_id:targetId};
    const requestHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(payload))))).map(b=>b.toString(16).padStart(2,"0")).join("");
    const prior=await db.prepare("SELECT request_hash FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,requestKey).first();
    if(prior){if(prior.request_hash!==requestHash)return fail("Idempotency key reused with different request data.",409);return json(await sessionDetail(db,userId,sessionId));}
    const source=await db.prepare("SELECT * FROM shopping_items WHERE id=? AND user_id=? AND session_id=?").bind(sourceId,userId,sessionId).first();
    const target=await db.prepare("SELECT * FROM shopping_items WHERE id=? AND user_id=? AND session_id=?").bind(targetId,userId,sessionId).first();
    if(!source||!target)return fail("One of the selected planned items was not found.",404);
    if(source.item_status==="cancelled"||target.item_status==="cancelled")return fail("Cancelled items cannot be merged.");
    if(String(source.unit||"pcs").trim().toLowerCase()!==String(target.unit||"pcs").trim().toLowerCase())return fail("These items use different units. Convert or correct the units before merging.");
    const timestamp=now(),combinedQuantity=Number(target.planned_quantity||0)+Number(source.planned_quantity||0);
    const mergedNote=text([target.notes,source.notes].filter(Boolean).join(" · "),1000);
    const statements=[
      db.prepare("UPDATE shopping_items SET planned_quantity=?,notes=?,updated_at=? WHERE id=? AND user_id=? AND session_id=?").bind(combinedQuantity,mergedNote,timestamp,targetId,userId,sessionId),
      db.prepare("UPDATE shopping_item_sources SET shopping_item_id=? WHERE shopping_item_id=? AND source_line_id NOT IN (SELECT source_line_id FROM shopping_item_sources WHERE shopping_item_id=?) AND user_id=? AND session_id=?").bind(targetId,sourceId,targetId,userId,sessionId),
      db.prepare("UPDATE shopping_purchase_lines SET shopping_item_id=?,is_extra=0,match_method='confirmed',updated_at=? WHERE shopping_item_id=? AND user_id=? AND session_id=?").bind(targetId,timestamp,sourceId,userId,sessionId),
      db.prepare("UPDATE shopping_items SET item_status='cancelled',merged_into_item_id=?,notes=?,updated_at=? WHERE id=? AND user_id=? AND session_id=?").bind(targetId,text(`Merged into ${target.product_name} (${targetId})`,1000),timestamp,sourceId,userId,sessionId),
      db.prepare("INSERT INTO shopping_audit_events (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,"shopping_item",targetId,"items_merged",JSON.stringify({target_quantity:Number(target.planned_quantity||0)}),JSON.stringify({source_item_id:sourceId,added_quantity:Number(source.planned_quantity||0),combined_quantity:combinedQuantity}),timestamp),
      db.prepare("INSERT INTO shopping_audit_events (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,"shopping_item",sourceId,"item_merged_into",JSON.stringify({item_status:source.item_status}),JSON.stringify({target_item_id:targetId}),timestamp),
      db.prepare("INSERT INTO shopping_idempotency_keys (id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,operation,requestKey,requestHash,JSON.stringify({merged:true,source_item_id:sourceId,target_item_id:targetId}),200,timestamp)
    ];
    try{await db.batch(statements);}catch(error){
      const winner=await db.prepare("SELECT request_hash FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,requestKey).first();
      if(winner){if(winner.request_hash!==requestHash)return fail("Idempotency key reused with different request data.",409);return json(await sessionDetail(db,userId,sessionId));}
      throw error;
    }
    return json(await sessionDetail(db,userId,sessionId));
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




  if (subpath === "estimates" && method === "POST") {
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length || lines.length > 500) return fail("Add between 1 and 500 estimate lines.");
    const calculationSource = text(body.calculation_source || "mixed",30);
    if (!["previous_purchase","market_data","manual","ai_estimate","mixed"].includes(calculationSource)) return fail("Invalid estimate calculation source.");
    const prepared = [];
    let totalPaise = 0;
    for (let index=0; index<lines.length; index++) {
      const line=lines[index] || {};
      const itemId=text(line.shopping_item_id,80);
      const item=await db.prepare("SELECT id FROM shopping_items WHERE id=? AND user_id=? AND session_id=?").bind(itemId,userId,sessionId).first();
      if (!item) return fail(`Estimate line ${index+1} references an item outside this session.`,404);
      const quantity=Number(line.quantity);
      const unitPrice=Number(line.estimated_unit_price_paise);
      if (!Number.isFinite(quantity)||quantity<0||quantity>1000000) return fail(`Estimate line ${index+1} has invalid quantity.`);
      if (!Number.isSafeInteger(unitPrice)||unitPrice<0) return fail(`Estimate line ${index+1} has invalid unit price in paise.`);
      const lineTotal=line.estimated_line_total_paise==null?Math.round(quantity*unitPrice):Number(line.estimated_line_total_paise);
      if (!Number.isSafeInteger(lineTotal)||lineTotal<0) return fail(`Estimate line ${index+1} has invalid line total.`);
      const priceSource=text(line.price_source,30);
      if (!["previous_purchase","market_data","manual","ai_estimate"].includes(priceSource)) return fail(`Estimate line ${index+1} has invalid price source.`);
      const confidence=line.confidence==null?null:Number(line.confidence);
      if (confidence!==null&&(!Number.isFinite(confidence)||confidence<0||confidence>1)) return fail(`Estimate line ${index+1} has invalid confidence.`);
      totalPaise+=lineTotal;
      if (!Number.isSafeInteger(totalPaise)) return fail("Estimate total is too large.");
      prepared.push({id:id(),itemId,quantity,unit:text(line.unit||"pcs",24),unitPrice,lineTotal,priceSource,reference:text(line.source_reference,300),observed:text(line.source_observed_at,40)||null,confidence});
    }
    const versionRow=await db.prepare("SELECT COALESCE(MAX(version_number),0)+1 AS next_version FROM shopping_estimates WHERE user_id=? AND session_id=?").bind(userId,sessionId).first();
    const version=Number(versionRow?.next_version||1), estimateId=id(), timestamp=now();
    const statements=[db.prepare(`INSERT INTO shopping_estimates
      (id,user_id,session_id,version_number,estimated_total_paise,calculation_source,market_area,notes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(estimateId,userId,sessionId,version,totalPaise,calculationSource,text(body.market_area,120),text(body.notes,1000),timestamp)];
    for (const line of prepared) statements.push(db.prepare(`INSERT INTO shopping_estimate_lines
      (id,user_id,session_id,estimate_id,shopping_item_id,quantity,unit,estimated_unit_price_paise,estimated_line_total_paise,price_source,source_reference,source_observed_at,confidence,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(line.id,userId,sessionId,estimateId,line.itemId,line.quantity,line.unit,line.unitPrice,line.lineTotal,line.priceSource,line.reference,line.observed,line.confidence,timestamp));
    statements.push(db.prepare("UPDATE shopping_sessions SET latest_estimate_id=?,updated_at=? WHERE id=? AND user_id=?").bind(estimateId,timestamp,sessionId,userId));
    await db.batch(statements);
    await audit(db,userId,sessionId,"estimate",estimateId,"estimate_version_created",{version_number:version,estimated_total_paise:totalPaise,line_count:prepared.length});
    return json({id:estimateId,version_number:version,estimated_total_paise:totalPaise,lines:prepared},201);
  }

  const estimateMatch=/^estimates\/([a-f0-9-]{36})$/.exec(subpath);
  if (estimateMatch && method === "GET") {
    const estimate=await db.prepare("SELECT * FROM shopping_estimates WHERE id=? AND user_id=? AND session_id=?").bind(estimateMatch[1],userId,sessionId).first();
    if (!estimate) return fail("Estimate not found.",404);
    const rows=await db.prepare("SELECT * FROM shopping_estimate_lines WHERE estimate_id=? AND user_id=? AND session_id=? ORDER BY created_at,id").bind(estimate.id,userId,sessionId).all();
    return json({...estimate,lines:rows.results||[]});
  }

  if (subpath === "bills" && method === "POST") {
    const idempotencyKey=text(request.headers.get("Idempotency-Key"),160);
    const operation=`bill_create:${sessionId}`;
    const requestHash=idempotencyKey?await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(body))).then(bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("")):null;
    if(idempotencyKey){
      const prior=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,idempotencyKey).first();
      if(prior){
        if(prior.request_hash!==requestHash)return fail("This idempotency key was already used for a different bill request.",409);
        return json(safeJson(prior.response_json,{}),Number(prior.response_status)||200);
      }
    }
    const shopName=text(body.shop_name,160);
    const purchaseDate=body.purchase_date==null||body.purchase_date===""?null:text(body.purchase_date,10);
    if (purchaseDate&&!validDate(purchaseDate)) return fail("Invalid bill purchase date.");
    const moneyFields=["subtotal_paise","tax_paise","discount_paise","other_charges_paise","bill_total_paise","line_total_paise"];
    const money={};
    for (const key of moneyFields) {
      const value=body[key];
      if (value==null||value==="") money[key]=null;
      else { const n=Number(value); if(!Number.isSafeInteger(n)||n<0) return fail(`${key} must be a non-negative integer in paise.`); money[key]=n; }
    }
    const fileId=text(body.file_id,80)||null;
    if(fileId){
      const file=await db.prepare("SELECT id FROM uploaded_files WHERE id=? AND user_id=?").bind(fileId,userId).first();
      if(!file) return fail("The selected bill file was not found in your account.",404);
    }
    // Recover an already-created bill from its uploaded-file marker when the
    // client lost its transient idempotency key (e.g. reload after header save).
    if(fileId){
      const recovered=await db.prepare("SELECT * FROM shopping_actual_bills WHERE user_id=? AND session_id=? AND file_id=? ORDER BY uploaded_at,id LIMIT 1").bind(userId,sessionId,fileId).first();
      if(recovered){
        const responseBody={...recovered,possible_duplicate:null};
        if(idempotencyKey){
          const recoveryStatements=[
            db.prepare("INSERT INTO shopping_audit_events (id,user_id,session_id,entity_type,entity_id,event_type,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,"actual_bill",recovered.id,"bill_upload_recovered",JSON.stringify({file_id:fileId}),"{}",now()),
            db.prepare("INSERT INTO shopping_idempotency_keys (id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,operation,idempotencyKey,requestHash,JSON.stringify(responseBody),200,now())
          ];
          try{await db.batch(recoveryStatements);}catch(error){
            const winner=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,idempotencyKey).first();
            if(winner){if(winner.request_hash!==requestHash)return fail("This idempotency key was already used for a different bill request.",409);return json(safeJson(winner.response_json,{}),Number(winner.response_status)||200);}
            throw error;
          }
        }
        return json(responseBody,200);
      }
    }
    const fingerprint=text(body.duplicate_fingerprint,200)||null;
    const possibleDuplicate=fingerprint?await db.prepare("SELECT id,shop_name,purchase_date,receipt_number,bill_total_paise FROM shopping_actual_bills WHERE user_id=? AND session_id=? AND duplicate_fingerprint=? LIMIT 1").bind(userId,sessionId,fingerprint).first():null;
    const requestedStatus=["uploaded","needs_review","verified","duplicate","void"].includes(body.bill_status)?body.bill_status:"uploaded";
    const billId=id(),timestamp=now(),status=["duplicate","void"].includes(requestedStatus)?requestedStatus:(possibleDuplicate?"needs_review":requestedStatus);
    const includedInActual=["duplicate","void"].includes(status)?0:1;
    const responseBody={id:billId,shop_name:shopName,bill_total_paise:money.bill_total_paise,bill_status:status,included_in_actual:includedInActual,possible_duplicate:possibleDuplicate};
    const billInsert=db.prepare(`INSERT INTO shopping_actual_bills
      (id,user_id,session_id,shop_name,purchase_date,file_id,original_file_uri,receipt_number,subtotal_paise,tax_paise,discount_paise,other_charges_paise,bill_total_paise,line_total_paise,reconciliation_difference_paise,bill_status,included_in_actual,duplicate_fingerprint,original_ocr_json,uploaded_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(billId,userId,sessionId,shopName,purchaseDate,fileId,text(body.original_file_uri,1200)||null,text(body.receipt_number,100),
        money.subtotal_paise,money.tax_paise,money.discount_paise,money.other_charges_paise,money.bill_total_paise,money.line_total_paise,
        money.bill_total_paise==null||money.line_total_paise==null?null:money.bill_total_paise-money.line_total_paise,status,includedInActual,fingerprint,
        JSON.stringify(body.original_ocr&&typeof body.original_ocr==="object"?body.original_ocr:{}),timestamp,timestamp);
    const auditInsert=db.prepare(`INSERT INTO shopping_audit_events
      (id,user_id,session_id,entity_type,entity_id,event_type,after_json,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(id(),userId,sessionId,"actual_bill",billId,"bill_uploaded",
        JSON.stringify({shop_name:shopName,bill_total_paise:money.bill_total_paise}),
        JSON.stringify({possible_duplicate_of:possibleDuplicate?.id||null}),timestamp);
    const statements=[billInsert,auditInsert];
    if(idempotencyKey)statements.push(db.prepare(`INSERT INTO shopping_idempotency_keys
      (id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(id(),userId,sessionId,operation,idempotencyKey,requestHash,JSON.stringify(responseBody),201,timestamp));
    try{
      await db.batch(statements);
    }catch(cause){
      if(idempotencyKey){
        const winner=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,idempotencyKey).first();
        if(winner){
          if(winner.request_hash!==requestHash)return fail("This idempotency key was already used for a different bill request.",409);
          return json(safeJson(winner.response_json,{}),Number(winner.response_status)||200);
        }
      }
      throw cause;
    }
    return json(responseBody,201);
  }

  const billMatch=/^bills\/([a-f0-9-]{36})$/.exec(subpath);
  if (billMatch && ["GET","PATCH"].includes(method)) {
    const billId=billMatch[1];
    const existing=await db.prepare("SELECT * FROM shopping_actual_bills WHERE id=? AND user_id=? AND session_id=?").bind(billId,userId,sessionId).first();
    if(!existing) return fail("Bill not found.",404);
    if(method==="GET"){
      const lines=await db.prepare("SELECT * FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=? ORDER BY created_at,id").bind(billId,userId,sessionId).all();
      return json({...existing,purchase_lines:lines.results||[]});
    }
    const patch={};
    for(const key of ["shop_name","receipt_number","original_file_uri"]) if(body[key]!==undefined) patch[key]=text(body[key],key==="original_file_uri"?1200:160);
    if(body.purchase_date!==undefined){if(body.purchase_date&&!validDate(body.purchase_date))return fail("Invalid bill purchase date.");patch.purchase_date=body.purchase_date||null;}
    for(const key of ["subtotal_paise","tax_paise","discount_paise","other_charges_paise","bill_total_paise","line_total_paise"]){
      if(body[key]!==undefined){const n=body[key]==null||body[key]===""?null:Number(body[key]);if(n!==null&&(!Number.isSafeInteger(n)||n<0))return fail(`${key} must be a non-negative integer in paise.`);patch[key]=n;}
    }
    if(body.included_in_actual!==undefined){if(![0,1,false,true].includes(body.included_in_actual))return fail("included_in_actual must be true or false.");patch.included_in_actual=body.included_in_actual===true||body.included_in_actual===1?1:0;}
    if(body.bill_status!==undefined){if(!["uploaded","needs_review","verified","duplicate","void"].includes(body.bill_status))return fail("Invalid bill status.");patch.bill_status=body.bill_status;if(["duplicate","void"].includes(body.bill_status)&&body.included_in_actual===undefined)patch.included_in_actual=0;else if(["duplicate","void"].includes(existing.bill_status)&&!["duplicate","void"].includes(body.bill_status)&&body.included_in_actual===undefined)patch.included_in_actual=1;}
    if(body.duplicate_of_bill_id!==undefined){
      if(body.duplicate_of_bill_id){const other=await db.prepare("SELECT id FROM shopping_actual_bills WHERE id=? AND user_id=? AND session_id=? AND id<>?").bind(body.duplicate_of_bill_id,userId,sessionId,billId).first();if(!other)return fail("Referenced duplicate bill was not found.",404);}
      patch.duplicate_of_bill_id=body.duplicate_of_bill_id||null;
    }
    if(!Object.keys(patch).length)return fail("No supported bill changes were supplied.");
    const effectiveTotal=patch.bill_total_paise===undefined?existing.bill_total_paise:patch.bill_total_paise;
    const effectiveLines=patch.line_total_paise===undefined?existing.line_total_paise:patch.line_total_paise;
    if(patch.bill_total_paise!==undefined||patch.line_total_paise!==undefined)patch.reconciliation_difference_paise=effectiveTotal==null||effectiveLines==null?null:effectiveTotal-effectiveLines;
    patch.updated_at=now();
    const before=Object.fromEntries(Object.keys(patch).filter(k=>k in existing).map(k=>[k,existing[k]]));
    const timestamp=now();
    await db.batch([
      db.prepare(`UPDATE shopping_actual_bills SET ${Object.keys(patch).map(k=>k+"=?").join(",")} WHERE id=? AND user_id=? AND session_id=?`).bind(...Object.values(patch),billId,userId,sessionId),
      db.prepare("INSERT INTO shopping_audit_events (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,"actual_bill",billId,"bill_corrected",JSON.stringify(before),JSON.stringify(patch),timestamp),
    ]);
    return json(await db.prepare("SELECT * FROM shopping_actual_bills WHERE id=? AND user_id=? AND session_id=?").bind(billId,userId,sessionId).first());
  }

  const purchaseLinesMatch=/^bills\/([a-f0-9-]{36})\/lines$/.exec(subpath);
  if(purchaseLinesMatch && method==="POST"){
    const billId=purchaseLinesMatch[1];
    const idempotencyKey=text(request.headers.get("Idempotency-Key"),160);
    const operation=`bill_lines_create:${sessionId}:${billId}`;
    const requestHash=idempotencyKey?await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(body))).then(bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("")):null;
    if(idempotencyKey){
      const prior=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,idempotencyKey).first();
      if(prior){if(prior.request_hash!==requestHash)return fail("This idempotency key was already used for a different bill-line request.",409);return json(safeJson(prior.response_json,{}),Number(prior.response_status)||200);}
    }
    const bill=await db.prepare("SELECT id FROM shopping_actual_bills WHERE id=? AND user_id=? AND session_id=?").bind(billId,userId,sessionId).first();
    if(!bill)return fail("Bill not found.",404);
    const lines=Array.isArray(body.lines)?body.lines:[body];
    if(!lines.length||lines.length>300)return fail("Add between 1 and 300 bill lines.");
    const prepared=[];
    for(let index=0;index<lines.length;index++){
      const line=lines[index]||{},name=text(line.product_name||line.name,160);
      if(!name)return fail(`Bill line ${index+1} needs a product name.`);
      const quantity=Number(line.quantity??0),unitPrice=line.unit_price_paise==null?null:Number(line.unit_price_paise),amount=line.line_amount_paise==null?null:Number(line.line_amount_paise);
      if(!Number.isFinite(quantity)||quantity<0||quantity>1000000)return fail(`Bill line ${index+1} has invalid quantity.`);
      if(unitPrice!==null&&(!Number.isSafeInteger(unitPrice)||unitPrice<0))return fail(`Bill line ${index+1} has invalid unit price.`);
      if(amount!==null&&(!Number.isSafeInteger(amount)||amount<0))return fail(`Bill line ${index+1} has invalid amount.`);
      const itemId=text(line.shopping_item_id,80)||null;
      if(itemId&&!await db.prepare("SELECT id FROM shopping_items WHERE id=? AND user_id=? AND session_id=?").bind(itemId,userId,sessionId).first())return fail(`Bill line ${index+1} references an item outside this session.`,404);
      const extra=Boolean(line.is_extra)||!itemId;
      prepared.push({id:id(),name,normalized:name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim(),brand:text(line.brand,100),pack:text(line.pack_size,60),quantity,unit:text(line.unit||"pcs",24),unitPrice,amount,itemId,extra,method:extra?"extra":(line.match_method==="confirmed"?"confirmed":"suggested"),ocr:line.original_ocr&&typeof line.original_ocr==="object"?line.original_ocr:line});
    }
    const timestamp=now(),statements=prepared.map(line=>db.prepare(`INSERT INTO shopping_purchase_lines
      (id,user_id,session_id,bill_id,shopping_item_id,product_name,normalized_name,brand,pack_size,quantity,unit,unit_price_paise,line_amount_paise,is_extra,match_method,original_ocr_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(line.id,userId,sessionId,billId,line.itemId,line.name,line.normalized,line.brand,line.pack,line.quantity,line.unit,line.unitPrice,line.amount,line.extra?1:0,line.method,JSON.stringify(line.ocr),timestamp,timestamp));
    const priorSums=await db.prepare("SELECT COUNT(*) AS line_count,COUNT(line_amount_paise) AS priced_count,COALESCE(SUM(line_amount_paise),0) AS line_total FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?").bind(billId,userId,sessionId).first();
    const priorCount=Number(priorSums?.line_count||0),priorPriced=Number(priorSums?.priced_count||0),priorTotal=Number(priorSums?.line_total||0);
    const newCount=prepared.length,newPriced=prepared.filter(x=>x.amount!==null).length,newTotal=prepared.reduce((acc,x)=>acc+(x.amount||0),0);
    const allLinesPriced=priorCount+newCount===priorPriced+newPriced;
    const sum=allLinesPriced?priorTotal+newTotal:null;

    const responseBody={bill_id:billId,created_count:prepared.length,line_total_paise:sum,extra_line_count:prepared.filter(x=>x.extra).length};
    // Recompute reconciliation inside the atomic batch after line inserts so concurrent
    // submissions cannot persist a stale pre-insert sum.
    statements.push(db.prepare(`UPDATE shopping_actual_bills SET
      line_total_paise=CASE
        WHEN (SELECT COUNT(*) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
          = (SELECT COUNT(line_amount_paise) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
        THEN COALESCE((SELECT SUM(line_amount_paise) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?),0)
        ELSE NULL END,
      reconciliation_difference_paise=CASE
        WHEN bill_total_paise IS NULL OR
          (SELECT COUNT(*) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
          <> (SELECT COUNT(line_amount_paise) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
        THEN NULL
        ELSE bill_total_paise-(SELECT COALESCE(SUM(line_amount_paise),0) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
      END,
      updated_at=? WHERE id=? AND user_id=? AND session_id=?`).bind(
      billId,userId,sessionId,billId,userId,sessionId,billId,userId,sessionId,
      billId,userId,sessionId,billId,userId,sessionId,billId,userId,sessionId,
      timestamp,billId,userId,sessionId));
    statements.push(db.prepare("INSERT INTO shopping_audit_events (id,user_id,session_id,entity_type,entity_id,event_type,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,"actual_bill",billId,"bill_lines_added",JSON.stringify({line_count:prepared.length,line_total_paise:sum}),"{}",timestamp));
    if(idempotencyKey)statements.push(db.prepare("INSERT INTO shopping_idempotency_keys (id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,operation,idempotencyKey,requestHash,JSON.stringify(responseBody),201,timestamp));
    try{await db.batch(statements);}catch(cause){
      if(idempotencyKey){const winner=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,idempotencyKey).first();if(winner){if(winner.request_hash!==requestHash)return fail("This idempotency key was already used for a different bill-line request.",409);return json(safeJson(winner.response_json,{}),Number(winner.response_status)||200);}}
      throw cause;
    }
    return json(responseBody,201);
  }


  const purchaseLineMatch=/^bills\/[a-f0-9-]{36}\/lines\/([a-f0-9-]{36})$/.exec(subpath);
  if(purchaseLineMatch && method==="PATCH"){
    const routeBillId=purchaseLineMatch[1],lineId=purchaseLineMatch[2];
    const line=await db.prepare("SELECT * FROM shopping_purchase_lines WHERE id=? AND user_id=? AND session_id=?").bind(lineId,userId,sessionId).first();
    if(!line||line.bill_id!==routeBillId)return fail("Bill line not found.",404);
    const patch={};
    if(body.product_name!==undefined){patch.product_name=text(body.product_name,160);if(!patch.product_name)return fail("Product name cannot be empty.");patch.normalized_name=patch.product_name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();}
    for(const key of ["brand","pack_size","unit"])if(body[key]!==undefined)patch[key]=text(body[key],100);
    if(body.quantity!==undefined){patch.quantity=Number(body.quantity);if(!Number.isFinite(patch.quantity)||patch.quantity<0||patch.quantity>1000000)return fail("Invalid quantity.");}
    for(const key of ["unit_price_paise","line_amount_paise"]){if(body[key]!==undefined){const n=body[key]==null?null:Number(body[key]);if(n!==null&&(!Number.isSafeInteger(n)||n<0))return fail(`Invalid ${key}.`);patch[key]=n;}}
    if(body.shopping_item_id!==undefined){const itemId=text(body.shopping_item_id,80)||null;if(itemId&&!await db.prepare("SELECT id FROM shopping_items WHERE id=? AND user_id=? AND session_id=?").bind(itemId,userId,sessionId).first())return fail("Shopping item not found.",404);patch.shopping_item_id=itemId;}
    if(body.is_extra!==undefined){if(typeof body.is_extra!=="boolean")return fail("is_extra must be true or false.");patch.is_extra=body.is_extra?1:0;}
    if(body.match_method!==undefined){if(!["exact","confirmed","suggested","unmatched","extra"].includes(body.match_method))return fail("Invalid match method.");patch.match_method=body.match_method;}
    if(!Object.keys(patch).length)return fail("No supported bill-line changes were supplied.");
    patch.corrected_values_json=JSON.stringify({...safeJson(line.corrected_values_json,{}),...patch});
    patch.updated_at=now();
    const before=Object.fromEntries(Object.keys(patch).filter(k=>k in line).map(k=>[k,line[k]]));
    const timestamp=now();
    const statements=[
      db.prepare(`UPDATE shopping_purchase_lines SET ${Object.keys(patch).map(k=>k+"=?").join(",")} WHERE id=? AND user_id=? AND session_id=?`).bind(...Object.values(patch),lineId,userId,sessionId),
      db.prepare(`UPDATE shopping_actual_bills SET
        line_total_paise=CASE
          WHEN (SELECT COUNT(*) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
            = (SELECT COUNT(line_amount_paise) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
          THEN COALESCE((SELECT SUM(line_amount_paise) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?),0)
          ELSE NULL END,
        reconciliation_difference_paise=CASE
          WHEN bill_total_paise IS NULL OR
            (SELECT COUNT(*) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
            <> (SELECT COUNT(line_amount_paise) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
          THEN NULL
          ELSE bill_total_paise-(SELECT COALESCE(SUM(line_amount_paise),0) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
        END,updated_at=? WHERE id=? AND user_id=? AND session_id=?`).bind(
        line.bill_id,userId,sessionId,line.bill_id,userId,sessionId,line.bill_id,userId,sessionId,
        line.bill_id,userId,sessionId,line.bill_id,userId,sessionId,line.bill_id,userId,sessionId,
        timestamp,line.bill_id,userId,sessionId),
      db.prepare("INSERT INTO shopping_audit_events (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,"purchase_line",lineId,"bill_line_corrected",JSON.stringify(before),JSON.stringify(patch),timestamp),
    ];
    await db.batch(statements);
    return json(await db.prepare("SELECT * FROM shopping_purchase_lines WHERE id=? AND user_id=? AND session_id=?").bind(lineId,userId,sessionId).first());
  }

  if(purchaseLineMatch && method==="DELETE"){
    const lineId=purchaseLineMatch[1];
    const line=await db.prepare("SELECT * FROM shopping_purchase_lines WHERE id=? AND user_id=? AND session_id=?").bind(lineId,userId,sessionId).first();
    if(!line)return fail("Bill line not found.",404);
    const timestamp=now();
    const statements=[
      db.prepare("DELETE FROM shopping_purchase_lines WHERE id=? AND user_id=? AND session_id=?").bind(lineId,userId,sessionId),
      db.prepare(`UPDATE shopping_actual_bills SET
        line_total_paise=CASE
          WHEN (SELECT COUNT(*) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
            = (SELECT COUNT(line_amount_paise) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
          THEN COALESCE((SELECT SUM(line_amount_paise) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?),0)
          ELSE NULL END,
        reconciliation_difference_paise=CASE
          WHEN bill_total_paise IS NULL OR
            (SELECT COUNT(*) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
            <> (SELECT COUNT(line_amount_paise) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
          THEN NULL
          ELSE bill_total_paise-(SELECT COALESCE(SUM(line_amount_paise),0) FROM shopping_purchase_lines WHERE bill_id=? AND user_id=? AND session_id=?)
        END,updated_at=? WHERE id=? AND user_id=? AND session_id=?`).bind(
        line.bill_id,userId,sessionId,line.bill_id,userId,sessionId,line.bill_id,userId,sessionId,
        line.bill_id,userId,sessionId,line.bill_id,userId,sessionId,line.bill_id,userId,sessionId,
        timestamp,line.bill_id,userId,sessionId),
      db.prepare("INSERT INTO shopping_audit_events (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,"purchase_line",lineId,"bill_line_deleted",JSON.stringify(line),JSON.stringify({bill_id:line.bill_id}),timestamp),
    ];
    await db.batch(statements);
    const updatedBill=await db.prepare("SELECT line_total_paise,reconciliation_difference_paise FROM shopping_actual_bills WHERE id=? AND user_id=? AND session_id=?").bind(line.bill_id,userId,sessionId).first();
    return json({success:true,bill_id:line.bill_id,line_total_paise:updatedBill?.line_total_paise??null,reconciliation_difference_paise:updatedBill?.reconciliation_difference_paise??null});
  }

  if(subpath==="confirm" && method==="POST"){
    const confirmed=Number(body.confirmed_total_paise);
    if(!Number.isSafeInteger(confirmed)||confirmed<0)return fail("Enter the final confirmed expense as a non-negative integer in paise.");
    const requestKey=text(request.headers.get("Idempotency-Key"),160);
    const operation="session_confirm:"+sessionId;
    const requestHash=requestKey?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({confirmed_total_paise:confirmed}))))).map(b=>b.toString(16).padStart(2,"0")).join(""):null;
    if(requestKey){const prior=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,requestKey).first();if(prior)return prior.request_hash===requestHash?new Response(prior.response_json,{status:prior.response_status,headers}):fail("Idempotency key reused with different confirmation total.",409);}
    const totals=await db.prepare(`SELECT COALESCE(SUM(CASE WHEN included_in_actual=1 AND bill_status NOT IN ('duplicate','void') THEN bill_total_paise ELSE 0 END),0) AS actual_total_paise,
      SUM(CASE WHEN included_in_actual=1 AND bill_status NOT IN ('duplicate','void') AND bill_total_paise IS NULL THEN 1 ELSE 0 END) AS pending_bill_amounts
      FROM shopping_actual_bills WHERE user_id=? AND session_id=?`).bind(userId,sessionId).first();
    if(Number(totals?.pending_bill_amounts||0)>0)return fail("Resolve every included bill amount before confirming this session.");
    const billRows=await db.prepare("SELECT id,shop_name,purchase_date,receipt_number,bill_total_paise,bill_status,included_in_actual,duplicate_of_bill_id FROM shopping_actual_bills WHERE user_id=? AND session_id=? ORDER BY uploaded_at,id").bind(userId,sessionId).all();
    const pending=await db.prepare("SELECT id,product_name,planned_quantity,unit,item_status FROM shopping_items WHERE user_id=? AND session_id=? AND item_status IN ('planned','pending','partially_purchased') ORDER BY created_at,id").bind(userId,sessionId).all();
    const estimate=session.latest_estimate_id?await db.prepare("SELECT id,version_number,estimated_total_paise FROM shopping_estimates WHERE id=? AND user_id=? AND session_id=?").bind(session.latest_estimate_id,userId,sessionId).first():null;
    const calculated=Number(totals?.actual_total_paise||0),revisionRow=await db.prepare("SELECT COALESCE(MAX(revision_number),0)+1 AS next_revision FROM shopping_expense_confirmations WHERE user_id=? AND session_id=?").bind(userId,sessionId).first();
    const revision=Number(revisionRow?.next_revision||1),confirmationId=id(),timestamp=now();
    const snapshot={session_id:sessionId,revision_number:revision,calculated_total_paise:calculated,confirmed_total_paise:confirmed,pending_bill_amounts:Number(totals?.pending_bill_amounts||0),bills:billRows.results||[],pending_items:pending.results||[],estimate:estimate||null};
    const responseBody={id:confirmationId,revision_number:revision,calculated_total_paise:calculated,confirmed_total_paise:confirmed,pending_bill_amounts:Number(totals?.pending_bill_amounts||0),pending_items:pending.results||[],confirmed_at:timestamp};
    const stmts=[
      db.prepare(`INSERT INTO shopping_expense_confirmations (id,user_id,session_id,revision_number,calculated_total_paise,confirmed_total_paise,estimate_id,calculation_snapshot_json,confirmed_at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM shopping_sessions WHERE id=? AND user_id=? AND status IN ('open','ready_to_confirm'))`).bind(confirmationId,userId,sessionId,revision,calculated,confirmed,estimate?.id||null,JSON.stringify(snapshot),timestamp,sessionId,userId),
      db.prepare("UPDATE shopping_sessions SET status='completed',confirmed_actual_total_paise=?,updated_at=? WHERE id=? AND user_id=? AND status IN ('open','ready_to_confirm')").bind(confirmed,timestamp,sessionId,userId),
      db.prepare("INSERT INTO shopping_audit_events (id,user_id,session_id,entity_type,entity_id,event_type,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,"session",sessionId,"expense_confirmed",null,JSON.stringify({confirmation_id:confirmationId,revision_number:revision,calculated_total_paise:calculated,confirmed_total_paise:confirmed}),timestamp)
    ];
    if(requestKey)stmts.push(db.prepare("INSERT INTO shopping_idempotency_keys (id,user_id,session_id,operation,idempotency_key,request_hash,response_json,response_status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id(),userId,sessionId,operation,requestKey,requestHash,JSON.stringify(responseBody),201,timestamp));
    try{const results=await db.batch(stmts);if(!results?.[0]?.meta?.changes)return fail("This session has already been completed. Refresh to view the saved confirmation.",409);}catch(error){if(requestKey){const winner=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys WHERE user_id=? AND operation=? AND idempotency_key=?").bind(userId,operation,requestKey).first();if(winner)return winner.request_hash===requestHash?new Response(winner.response_json,{status:winner.response_status,headers}):fail("Idempotency key reused with different confirmation total.",409);}throw error;}
    return json(responseBody,201);
  }

  if (subpath === "audit" && method === "GET") {
    const rows=await db.prepare("SELECT entity_type,entity_id,event_type,before_json,after_json,metadata_json,created_at FROM shopping_audit_events WHERE user_id=? AND session_id=? ORDER BY created_at DESC LIMIT 200")
      .bind(userId,sessionId).all();
    return json({events:(rows.results||[]).map(row=>({...row,before:safeJson(row.before_json,null),after:safeJson(row.after_json,null),metadata:safeJson(row.metadata_json,{})}))});
  }

  return fail("Shopping endpoint not found.",404);
}
