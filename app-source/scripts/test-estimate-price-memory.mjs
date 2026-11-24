import console from "node:console";
import assert from "node:assert/strict";
import { estimatePriceMemoryKey, findRememberedEstimatePrices, rememberEstimatePrices } from "../src/lib/estimate-price-memory.js";

const storage = {
  data: {},
  getItem(key) { return this.data[key] ?? null; },
  setItem(key, value) { this.data[key] = value; },
};
const item100g = { id: "1", product_name: "Amul Butter", brand: "Amul", pack_size: "100g", unit: "pack" };
const item500g = { id: "2", product_name: "Amul Butter", brand: "Amul", pack_size: "500g", unit: "pack" };
assert.notEqual(estimatePriceMemoryKey(item100g), estimatePriceMemoryKey(item500g));
assert.equal(estimatePriceMemoryKey(item100g), estimatePriceMemoryKey({ ...item100g, pack_size: "0.1kg" }));
assert.equal(estimatePriceMemoryKey({ ...item100g, pack_size: "1L" }), estimatePriceMemoryKey({ ...item100g, pack_size: "1000 ml" }));
rememberEstimatePrices([item100g], { "1": "62" }, storage);
assert.deepEqual(findRememberedEstimatePrices([item100g], storage), { "1": "62" });
assert.deepEqual(findRememberedEstimatePrices([item500g], storage), {});
assert.deepEqual(findRememberedEstimatePrices([{ ...item100g, id: "3", product_name: "amul butter" }], storage), { "3": "62" });
const loose = { id: "4", product_name: "Rice", brand: "", pack_size: "", unit: "kg" };
rememberEstimatePrices([loose], { "4": "48" }, storage);
assert.deepEqual(findRememberedEstimatePrices([{ ...loose, id: "5" }], storage), { "5": "48" });
assert.deepEqual(findRememberedEstimatePrices([{ ...loose, id: "6", unit: "L" }], storage), {});
console.log("PASS: estimate price memory distinguishes pack sizes and matches normalized names.");
