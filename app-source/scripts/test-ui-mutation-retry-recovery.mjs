import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const ui = await readFile(new URL("../src/routes/_authed/sessions/$sessionId.jsx", import.meta.url), "utf8");
const section = (startMarker, endMarker) => {
  const start = ui.indexOf(startMarker);
  const end = ui.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `section not found: ${startMarker}`);
  return ui.slice(start, end);
};
const afterRefresh = (code, resetMarker, label) => {
  const refresh = code.indexOf("if (!await loadSession())");
  const reset = code.indexOf(resetMarker);
  assert.ok(refresh >= 0 && reset > refresh, `${label}: retry key/state reset must happen only after a successful refresh guard`);
};

const loadStart = ui.indexOf("const loadSession = useCallback(async");
const loadEnd = ui.indexOf("}, [sessionId]);", loadStart);
const loader = ui.slice(loadStart, loadEnd);
assert.match(loader, /return true;/);
assert.match(loader, /return false;/);

const undo = section("const undoPlannedItem = async", "const loadBillLines = async");
assert.match(undo, /headers: \\{ "Idempotency-Key": undoRestoreRequestKeyRef\\.current\\.key \\}/, "Undo restoration must send a retry key");
assert.match(undo, /undoRestoreRequestKeyRef\\.current\\.payload/);
afterRefresh(undo, "undoRestoreRequestKeyRef.current = null", "Undo restore");
afterRefresh(undo, "setUndoItem(null)", "Undo restore");

const estimate = section("const saveEstimate = async", "const saveBill = async");
afterRefresh(estimate, "estimateRequestKeyRef.current = null", "Estimate save");

const bill = section("const saveBill = async", "const handleUploadedBill");
afterRefresh(bill, "billRequestKeyRef.current = null", "Manual bill save");
assert.match(bill, /billRequestKeyRef\\.current\\.payload !== billPayloadText/, "manual bill key is payload-bound");

const upload = section("const saveUploadedBill = async", "const updateBillStatus");
afterRefresh(upload, "uploadedBillCreateKeyRef.current = null", "Uploaded bill save");
afterRefresh(upload, "setUploadedBillDraft(null)", "Uploaded bill save");

const confirm = section("const confirmSession = async", "const moveListItem");
afterRefresh(confirm, "confirmationRequestKeyRef.current = null", "Trip confirmation");

const scanned = section("const saveScannedList = async", "const saveList = async");
afterRefresh(scanned, "scannedSourceListKeyRef.current = null", "Scanned list save");
afterRefresh(scanned, "setScannedDraft(null)", "Scanned list save");

const manualList = section("const saveList = async", "if (loading)");
afterRefresh(manualList, "manualSourceListKeyRef.current = null", "Manual list save");
afterRefresh(manualList, "setRows([blankRow()])", "Manual list save");

const billDelete = section("const deleteBill = async", "const editBillLine");
afterRefresh(billDelete, "delete billDeleteKeysRef.current[billId]", "Bill delete");

const billLineDelete = section("const deleteBillLine = async", "const handleScannedList");
afterRefresh(billLineDelete, "delete billLineDeleteRequestKeysRef.current[lineId]", "Bill-line delete");

console.log("PASS: create, confirmation, list, delete and Undo mutation keys/state survive failed session refreshes.");
