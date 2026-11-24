import test from "node:test";
import assert from "node:assert/strict";
import { inferShoppingCategory, resolveShoppingCategory, groupShoppingItems, SHOPPING_CATEGORIES } from "./shopping-categories.js";

test("infers common grocery categories and falls back safely", () => {
  assert.equal(inferShoppingCategory("Fresh tomatoes"), "Produce");
  assert.equal(inferShoppingCategory("Potatoes"), "Produce");
  assert.equal(inferShoppingCategory("Amul milk 1L"), "Dairy & Eggs");
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
