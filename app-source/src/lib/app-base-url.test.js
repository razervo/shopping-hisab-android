import test from "node:test";
import assert from "node:assert/strict";
import { validateAppBaseURL } from "./app-base-url.js";

test("accepts HTTPS origin and normalizes trailing slash", () => {
  assert.equal(validateAppBaseURL("https://shopping.example.com/"), "https://shopping.example.com");
});
test("allows HTTP only for localhost development", () => {
  assert.equal(validateAppBaseURL("http://localhost:8787/"), "http://localhost:8787");
  assert.equal(validateAppBaseURL("http://example.com"), null);
});
test("rejects non-HTTPS, credentials, path, query, and fragment", () => {
  for (const value of [
    "ftp://example.com/",
    "https://user:pass@example.com/",
    "https://example.com/app",
    "https://example.com/?next=1",
    "https://example.com/#hash",
    "",
    null,
  ]) assert.equal(validateAppBaseURL(value), null, String(value));
});
