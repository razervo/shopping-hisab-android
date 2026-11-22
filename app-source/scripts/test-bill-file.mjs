/* global File, console */
import assert from "node:assert/strict";
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

console.log("Receipt file checks passed: accepted formats, unsupported/empty files, PDF passthrough and safe HEIC failure.");
