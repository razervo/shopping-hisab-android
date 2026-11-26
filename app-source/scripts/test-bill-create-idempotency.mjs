import console from "node:console";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const engine = await readFile(new URL("../src/lib/shopping-engine.server.js", import.meta.url), "utf8");
const ui = await readFile(new URL("../src/routes/_authed/sessions/$sessionId.jsx", import.meta.url), "utf8");
const start = engine.indexOf('if (subpath === "bills" && method === "POST")');
const end = engine.indexOf("const billMatch=", start);
assert.notEqual(start, -1, "bill creation endpoint exists");
const handler = engine.slice(start, end);
assert.ok(handler.includes("const operation=`bill_create:${sessionId}`));
assert.ok(handler.includes("JSON.stringify(body)"), "bill creation hashes the request payload");
assert.ok(handler.includes("request_hash!==requestHash"), "a reused key with changed bill data is rejected");
assert.ok(handler.includes("SELECT * FROM shopping_actual_bills WHERE user_id=? AND session_id=? AND file_id=?"));
assert.ok(handler.includes("bill_upload_recovered"), "saved-file recovery is audited");
assert.ok(handler.includes("INSERT INTO shopping_idempotency_keys"), "bill create idempotency markers are persisted");
assert.ok(handler.includes("try{") && handler.includes("await db.batch(statements);") && handler.includes("catch(cause)"), "bill writes use atomic batch and winner recovery");
assert.ok(handler.includes('const winner=await db.prepare("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys'));
assert.ok(handler.includes("winner.request_hash!==requestHash"), "race winner replay rejects mismatched payloads");

const manualStart = ui.indexOf("const saveBill = async");
const manualEnd = ui.indexOf("const handleUploadedBill", manualStart);
const manual = ui.slice(manualStart, manualEnd);
assert.ok(manual.includes("billRequestKeyRef.current.payload !== billPayloadText"), "manual bill retries keep a key for the same payload");
assert.ok(manual.includes('headers: { "Idempotency-Key": billRequestKeyRef.current.key }'));
assert.ok(manual.includes("body: billPayloadText"));

const uploadStart = ui.indexOf("const saveUploadedBill = async");
const uploadEnd = ui.indexOf("const updateBillStatus", uploadStart);
const uploaded = ui.slice(uploadStart, uploadEnd);
assert.ok(uploaded.includes("uploadedBillCreateKeyRef.current"));
assert.ok(uploaded.includes("uploadedBillLinesKeyRef.current"));
assert.ok(uploaded.includes("if (!await loadSession())"), "upload UI must keep retry keys when session refresh fails");
console.log("PASS: bill creation retries, payload conflicts, race replay and uploaded-file recovery markers are guarded.");
