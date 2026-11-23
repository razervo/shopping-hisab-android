/* global File, console, URL */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BILL_MAX_BYTES, isAcceptedBill, prepareBillFile } from "../src/lib/billFile.js";

const file = (name, type, bytes = 128) =>
  new File([new Uint8Array(bytes)], name, { type, lastModified: 1 });

assert.equal(BILL_MAX_BYTES, 10 * 1024 * 1024);
for (const sample of [
  file("receipt.jpg", "image/jpeg"),
  file("receipt.jpeg", "image/jpeg"),
  file("receipt.png", "image/png"),
  file("receipt.webp", "image/webp"),
  file("receipt.heic", "image/heic"),
  file("receipt.heif", "image/heif"),
  file("receipt.pdf", "application/pdf"),
  file("camera.jpg", "application/octet-stream"),
]) {
  assert.equal(isAcceptedBill(sample), true, sample.name + " should be accepted");
}
for (const sample of [
  file("receipt.gif", "image/gif"),
  file("receipt.svg", "image/svg+xml"),
  file("document.txt", "text/plain"),
  file("unknown", "application/octet-stream"),
  file("empty.jpg", "image/jpeg", 0),
]) {
  assert.equal(isAcceptedBill(sample), false, sample.name + " should be rejected");
}

const smallJpeg = file("small.jpg", "image/jpeg", 1024);
assert.equal(await prepareBillFile(smallJpeg), smallJpeg, "Small JPEG should not be re-encoded");

const pdf = file("receipt.pdf", "application/pdf", 1024);
assert.equal(await prepareBillFile(pdf), pdf, "PDF should be passed to the document reader unchanged");

const heic = file("camera.heic", "image/heic", 4096);
await assert.rejects(
  () => prepareBillFile(heic),
  /HEIC photo could not be converted|JPG or PNG photo/,
  "A HEIC file that cannot be decoded must fail clearly instead of being uploaded unchanged",
);

const uploader = await readFile(new URL("../src/components/shopping/BillUploader.jsx", import.meta.url), "utf8");
assert.match(uploader, /setRecoveryFileUri\\(result.file_uri\\)/, "PDF OCR failure must preserve the saved file URI for recovery");
assert.match(uploader, /readShoppingBill\\(\\{ data: \\{ fileUri: recoveryFileUri, purpose \\} \\}\\)/, "Retry must reread the saved Drive file, not reupload");
assert.match(uploader, /Retry reading saved receipt|Retry reading saved receipt/, "Recovery UI must offer a retry for saved receipts");

console.log("Receipt file checks passed: accepted formats, unsupported/empty files, PDF passthrough, safe HEIC failure and saved-PDF OCR recovery.");
