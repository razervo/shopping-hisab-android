import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "./html-escape.js";

test("escapes all HTML special characters for email templates", () => {
  assert.equal(escapeHtml("<script>alert('x')</script> & \"quoted\""), "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quoted&quot;");
});

test("escapes ampersands in reset URLs and keeps ordinary text", () => {
  assert.equal(escapeHtml("https://example.com/reset?a=1&b=2"), "https://example.com/reset?a=1&amp;b=2");
  assert.equal(escapeHtml("Abdul"), "Abdul");
});
