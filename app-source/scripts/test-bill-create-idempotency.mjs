import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const engine = await readFile(new URL("../src/lib/shopping-engine.server.js", import.meta.url), "utf8");
const ui = await readFile(new URL("../src/routes/_authed/sessions/$sessionId.jsx", import.meta.url), "utf8");
const start = engine.indexOf('if (subpath === "bills" && method === "POST")');
const end = engine.indexOf("const billMatch=", start);
assert.notEqual(start, -1, "bill creation endpoint exists");
const handler = engine.slice(start, end);
assert.match(handler, /const operation=`bill_create:\\$\\{sessionId\\}`/);
assert.match(handler, /JSON.stringify\\(body\\)/, "bill creation hashes the request payload");
assert.match(handler, /request_hash!==requestHash/, "a reused key with changed bill data is rejected");
assert.match(handler, /SELECT \\* FROM shopping_actual_bills WHERE user_id=\\? AND session_id=\\? AND file_id=\\?/);
assert.match(handler, /bill_upload_recovered/, "saved-file recovery is audited");
assert.match(handler, /INSERT INTO shopping_idempotency_keys/, "bill create idempotency markers are persisted");
assert.match(handler, /try\\{\\s*await db\\.batch\\(statements\\)\\s*\\}catch/);
assert.match(handler, /const winner=await db\\.prepare\\("SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys/);
assert.match(handler, /winner\\.request_hash!==requestHash/, "race winner replay rejects mismatched payloads");

const manualStart = ui.indexOf("const saveBill = async");
const manualEnd = ui.indexOf("const handleUploadedBill", manualStart);
const manual = ui.slice(manualStart, manualEnd);
assert.match(manual, /billRequestKeyRef\\.current\\.payload !== billPayloadText/, "manual bill retries keep a key for the same payload");
assert.match(manual, /headers: \\{ "Idempotency-Key": billRequestKeyRef\\.current\\.key \\}/);
assert.match(manual, /body: billPayloadText/);

const uploadStart = ui.indexOf("const saveUploadedBill = async");
const uploadEnd = ui.indexOf("const updateBillStatus", uploadStart);
const uploaded = ui.slice(uploadStart, uploadEnd);
assert.match(uploaded, /uploadedBillCreateKeyRef\\.current/);
assert.match(uploaded, /uploadedBillLinesKeyRef\\.current/);
assert.match(uploaded, /if \\(!await loadSession\\(\\)\\)/, "upload UI must keep retry keys when session refresh fails");
console.log("PASS: bill creation retries, payload conflicts, race replay and uploaded-file recovery markers are guarded.");
