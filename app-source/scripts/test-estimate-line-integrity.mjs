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
assert.match(route, /Number\(line\.estimated_line_total_paise\) !== lineTotal/, "a mismatching client total is rejected");
assert.match(route, /total does not match its quantity and unit price/, "mismatch has a clear response");
assert.match(ui, /estimated_line_total_paise: Math\.round\(Number\(item\.planned_quantity \|\| 0\) \* unitPrice\)/, "the UI sends the same quantity-times-unit-price calculation");

console.log("PASS: estimate totals use safe server-side paise arithmetic and reject client/server mismatches.");
