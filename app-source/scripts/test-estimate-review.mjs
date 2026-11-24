import assert from "node:assert/strict";
import { reviewEstimateItems } from "../src/lib/estimate-review.js";

const warnings = reviewEstimateItems([
  { id: "a", product_name: "Cooking oil", planned_quantity: 2, unit: "kg", pack_size: "" },
  { id: "b", product_name: "Rice", planned_quantity: 0, unit: "L" },
  { id: "c", product_name: "Milk packet", planned_quantity: 3, unit: "L", pack_size: "" },
  { id: "d", product_name: "Milk packet", planned_quantity: 2, unit: "L", pack_size: "500ml" },
  { id: "e", product_name: "Tomato", planned_quantity: 1001, unit: "kg" },
]);
assert.ok(warnings.some((w) => w.itemId === "a" && /volume/.test(w.message)));
assert.ok(warnings.some((w) => w.itemId === "b" && /weight/.test(w.message)));
assert.ok(warnings.some((w) => w.itemId === "b" && /zero/.test(w.message)));
assert.ok(warnings.some((w) => w.itemId === "c" && /pack size/.test(w.message)));
assert.ok(warnings.some((w) => w.itemId === "c" && /same name/.test(w.message)));
assert.ok(warnings.some((w) => w.itemId === "e" && /unusually large/.test(w.message)));
assert.equal(reviewEstimateItems([{ product_name: "Potato", planned_quantity: 2, unit: "kg", pack_size: "" }]).length, 0);
console.log("PASS: smart estimate review warnings cover units, packs, duplicates, and suspicious quantities.");
