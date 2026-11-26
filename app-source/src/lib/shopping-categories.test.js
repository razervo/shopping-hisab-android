import test from "node:test";
import { parseVoiceShoppingItems, findDuplicateShoppingNames, sortShoppingListItems, applyManualShoppingOrder } from "./shopping-categories.js";
import assert from "node:assert/strict";
import { inferShoppingCategory, resolveShoppingCategory, groupShoppingItems, filterShoppingListItems, SHOPPING_CATEGORIES } from "./shopping-categories.js";

test("infers common grocery categories and falls back safely", () => {
  assert.equal(inferShoppingCategory("Fresh tomatoes"), "Produce");
  assert.equal(inferShoppingCategory("Potatoes"), "Produce");
  assert.equal(inferShoppingCategory("Amul milk 1L"), "Dairy & Eggs");
  assert.equal(inferShoppingCategory("Face cream"), "Personal Care");
  assert.equal(inferShoppingCategory("Body cream"), "Personal Care");
  assert.equal(inferShoppingCategory("Chicken"), "Meat & Seafood");
  assert.equal(inferShoppingCategory("Dishwash liquid"), "Household");
  assert.equal(inferShoppingCategory("Unknown product"), "Other");
  assert.equal(inferShoppingCategory(""), "Other");
});

test("manual category overrides inferred category only when valid", () => {
  const item = { id: "1", product_name: "Milk" };
  assert.equal(resolveShoppingCategory(item, { "1": "Pantry" }), "Pantry");
  assert.equal(resolveShoppingCategory(item, { "1": "not-a-category" }), "Dairy & Eggs");
});

test("groups items by resolved category in stable category order", () => {
  const items = [{ id: "1", product_name: "Milk" }, { id: "2", product_name: "Rice" }, { id: "3", product_name: "Banana" }];
  const groups = groupShoppingItems(items);
  assert.deepEqual(groups.map(([category]) => category), ["Produce", "Dairy & Eggs", "Pantry"]);
  assert.equal(groups.reduce((n, [, rows]) => n + rows.length, 0), items.length);
  assert.deepEqual(SHOPPING_CATEGORIES.at(-1), "Other");
});

test("smart list search and filters exclude cancelled items from active views", () => {
  const items = [
    { id: "1", product_name: "Milk", planned_quantity: 2, remaining_quantity: 1 },
    { id: "2", product_name: "Rice", planned_quantity: 1, remaining_quantity: 0 },
    { id: "3", product_name: "Cancelled tea", planned_quantity: 1, remaining_quantity: 1, item_status: "cancelled" },
  ];
  assert.deepEqual(filterShoppingListItems(items, "MILK", "remaining").map((item) => item.id), ["1"]);
  assert.deepEqual(filterShoppingListItems(items, "", "remaining").map((item) => item.id), ["1"]);
  assert.deepEqual(filterShoppingListItems(items, "", "purchased").map((item) => item.id), ["2"]);
  assert.deepEqual(filterShoppingListItems(items, "", "all").map((item) => item.id), ["1", "2", "3"]);
});


test("voice transcript splits spoken shopping lists without discarding item phrases", () => {
  assert.deepEqual(parseVoiceShoppingItems("Add milk, eggs and 2 kg rice"), ["milk", "eggs", "2 kg rice"]);
  assert.deepEqual(parseVoiceShoppingItems("tomatoes; bread"), ["tomatoes", "bread"]);
  assert.deepEqual(parseVoiceShoppingItems("Rice 5 kg, mustard oil 1 litre, potato 2 kg, milk 3 packets, onion 2 kg"), ["Rice 5 kg", "mustard oil 1 litre", "potato 2 kg", "milk 3 packets", "onion 2 kg"]);
  assert.deepEqual(parseVoiceShoppingItems("I need rice 5 kg and milk 2 L then eggs 12 pcs"), ["rice 5 kg", "milk 2 L", "eggs 12 pcs"]);
  assert.deepEqual(parseVoiceShoppingItems(""), []);
});

test("detects duplicates against the trip and within a pasted/manual batch", () => {
  const existing = [{ product_name: "Milk 1L" }, { product_name: "Rice" }];
  assert.deepEqual(findDuplicateShoppingNames(existing, ["milk 1l", "Eggs", "Eggs", "RICE"]), ["milk 1l", "Eggs", "RICE"]);
  assert.deepEqual(findDuplicateShoppingNames(existing, ["Sugar", "Salt"]), []);
  assert.deepEqual(findDuplicateShoppingNames([...existing, { product_name: "Tea", item_status: "cancelled" }], ["Tea"]), []);
});

test("smart sort modes order items without mutating original list", () => {
  const items = [{ product_name: "Rice", planned_quantity: 4, remaining_quantity: 2 }, { product_name: "Apples", planned_quantity: 1, remaining_quantity: 1 }];
  assert.deepEqual(sortShoppingListItems(items, "name").map((item) => item.product_name), ["Apples", "Rice"]);
  assert.deepEqual(sortShoppingListItems(items, "remaining").map((item) => item.product_name), ["Rice", "Apples"]);
  assert.deepEqual(sortShoppingListItems(items, "planned").map((item) => item.product_name), ["Rice", "Apples"]);
  assert.deepEqual(items.map((item) => item.product_name), ["Rice", "Apples"]);
});

test("manual item order is stable and puts newly added items at the end", () => {
  const items = [{ id: "a", product_name: "A" }, { id: "b", product_name: "B" }, { id: "c", product_name: "C" }];
  assert.deepEqual(applyManualShoppingOrder(items, ["c", "a"]).map((item) => item.id), ["c", "a", "b"]);
});
