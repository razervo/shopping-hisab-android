import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const engine = await readFile(new URL("../src/lib/shopping-engine.server.js", import.meta.url), "utf8");
const ui = await readFile(new URL("../src/routes/_authed/sessions/$sessionId.jsx", import.meta.url), "utf8");
const routeStart = engine.indexOf('const purchaseLinesMatch=/^bills\\/([a-f0-9-]{36})\\/lines$/.exec(subpath);');
const routeEnd = engine.indexOf('const purchaseLineMatch=', routeStart);
assert.notEqual(routeStart, -1, "bill-line creation endpoint exists");
const route = engine.slice(routeStart, routeEnd);
assert.match(route, /if\(!idempotencyKey\)return fail\("An Idempotency-Key is required for bill-line creation\.",400\)/, "bill-line creation rejects requests without retry keys");
assert.match(route, /SELECT request_hash,response_json,response_status FROM shopping_idempotency_keys/, "existing retry keys are checked");
assert.match(route, /INSERT INTO shopping_idempotency_keys/, "successful bill-line requests persist retry markers");
assert.match(ui, /headers: \{ "Idempotency-Key": billLineRequestKeysRef\.current\[billId\]/, "manual bill-line flow sends a stable retry key");
assert.match(ui, /headers: \{ "Idempotency-Key": uploadedBillLinesKeyRef\.current/, "uploaded bill-line flow sends a retry key");
assert.match(ui, /headers: \{ "Idempotency-Key": scannedSourceLinesKeyRef\.current/, "scanned bill-line flow sends a retry key");
assert.match(ui, /headers: \{ "Idempotency-Key": manualSourceLinesKeyRef\.current/, "manual source bill-line flow sends a retry key");
console.log("PASS: bill-line creation requires and persists idempotency keys; client bill-line flows send stable retry keys.");
