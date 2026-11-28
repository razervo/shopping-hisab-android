import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import console from "node:console";
import { calculateEstimateLineTotalPaise } from "../src/lib/estimate-money.js";

assert.equal(calculateEstimateLineTotalPaise(2, 150), 300);
assert.equal(calculateEstimateLineTotalPaise(0.5, 25000), 12500);
assert.equal(calculateEstimateLineTotalPaise(1.25, 123), 154);
assert.equal(calculateEstimateLineTotalPaise(0, 999), 0);
assert.equal(calculateEstimateLineTotalPaise(-1, 100), null);
assert.equal(calculateEstimateLineTotalPaise(1, -100), null);
assert.equal(calculateEstimateLineTotalPaise(1, 1.5), null);
assert.equal(calculateEstimateLineTotalPaise(Number.MAX_VALUE, Number.MAX_SAFE_INTEGER), null);

const engine = await readFile(new URL("../src/lib/shopping-engine.server.js", import.meta.url), "utf8");
const ui = await readFile(new URL("../src/routes/_authed/sessions/$sessionId.jsx", import.meta.url), "utf8");
const routeStart = engine.indexOf('if (subpath === "estimates" && method === "POST")');
const routeEnd = engine.indexOf('const estimateMatch=', routeStart);
assert.notEqual(routeStart, -1, "estimate creation endpoint exists");
const route = engine.slice(routeStart, routeEnd);

assert.match(route, /calculateEstimateLineTotalPaise\(quantity, unitPrice\)/, "server recalculates every estimate line total");
assert.match(route, /const seenEstimateItemIds = new Set\(\)/, "the server tracks item IDs within one estimate submission");
assert.match(route, /seenEstimateItemIds\.has\(itemId\)/, "duplicate item lines are rejected before estimate persistence");
assert.match(route, /duplicates a shopping item/, "duplicate estimates return a clear validation error");
assert.match(route, /Number\(line\.estimated_line_total_paise\) !== lineTotal/, "a mismatching client total is rejected");
assert.match(route, /total does not match its quantity and unit price/, "mismatch has a clear response");
assert.match(ui, /const lineTotalPaise = Math\.round\(rupees \* 100\)/, "the UI converts entered rupees into integer paise");
assert.match(ui, /const unitPrice = Math\.round\(lineTotalPaise \/ quantity\)/, "the UI derives the per-unit paise price from the entered line total and quantity");
assert.match(ui, /estimated_unit_price_paise: unitPrice/, "the UI sends the derived unit price");
assert.match(ui, /estimated_line_total_paise: lineTotalPaise/, "the UI sends the entered line total for server-side math validation");

console.log("PASS: estimate totals use safe server-side paise arithmetic and reject client/server mismatches.");
