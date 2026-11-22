import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { console } from "node:console";

const nativeApi = await readFile(new URL("../src/lib/native-api.server.js", import.meta.url), "utf8");
const uploader = await readFile(new URL("../src/components/shopping/BillUploader.jsx", import.meta.url), "utf8");
const tripPage = await readFile(new URL("../src/routes/_authed/sessions/$sessionId.jsx", import.meta.url), "utf8");
const { parseReceiptMoney } = await import("../src/lib/receipt-money.js");

assert.equal(parseReceiptMoney("Rs. 1,234.50"), 1234.5);
assert.equal(parseReceiptMoney("₹ 2,000/-"), 2000);
assert.equal(parseReceiptMoney("INR 80"), 80);
assert.equal(parseReceiptMoney("unreadable"), null);
assert.equal(parseReceiptMoney(-25), null);

const fallbackStart = nativeApi.indexOf("async function readBillWithFallback");
const fallbackEnd = nativeApi.indexOf("async function handleGeminiOcrTest", fallbackStart);
assert.notEqual(fallbackStart, -1, "OCR fallback function exists");
const fallback = nativeApi.slice(fallbackStart, fallbackEnd);
assert.match(fallback, /allowEmptyItems = false/, "empty rows are opt-in");
assert.match(fallback, /parsed\.draft\.items\.length \|\| allowEmptyItems/, "priced receipt OCR may return totals without item rows");

const directStart = nativeApi.indexOf("async function handleDirectBillRead");
const directEnd = nativeApi.indexOf("async function queryCombinedReportRecords", directStart);
const directRead = nativeApi.slice(directStart, directEnd);
assert.match(directRead, /purpose === "priced_list"\)/, "priced receipt route opts into empty item rows");
assert.match(directRead, /!parsed\.draft\.items\.length && purpose !== "priced_list"/, "shopping lists still require detected rows");
assert.match(directRead, /Set totals\.grandTotal only when a clearly labelled final\/net\/payable amount is visible/, "receipt prompt asks for a printed payable total, not a calculated one");

assert.match(uploader, /!result\.draft\.items\.length && purpose !== "priced_list"/, "retry allows a receipt-only review but not an empty shopping list");

const reviewStart = tripPage.indexOf("const handleUploadedBill");
const reviewEnd = tripPage.indexOf("const updateUploadedBillRow", reviewStart);
const review = tripPage.slice(reviewStart, reviewEnd);
assert.match(review, /No item rows were detected/, "user is told when OCR finds no item rows");
assert.match(review, /setUploadedBillTotal\(hasPrintedTotal/, "detected printed total is prefilled");

const saveStart = tripPage.indexOf("const saveUploadedBill");
const saveEnd = tripPage.indexOf("const updateBillLine", saveStart);
const save = tripPage.slice(saveStart, saveEnd);
assert.doesNotMatch(save, /!lines\.length \|\|/, "zero extracted rows do not block saving a verified bill total");
assert.match(save, /if \(lines\.length\) \{/, "bill line endpoint is skipped when OCR returns no rows");
assert.match(save, /Receipt and total saved\. You can add item details later\./, "receipt-only save has a clear confirmation message");
assert.match(tripPage, /We couldn't read the item rows\./, "manual fallback is explained in the receipt review UI");

console.log("PASS: receipt OCR total recovery works with or without detected item rows; shopping-list OCR remains strict.");
