import test from "node:test";
import assert from "node:assert/strict";
import { nativeAuthSecurityConfig } from "./native-auth-security-config.js";

test("authentication throttles are enabled with bounded defaults", () => {
  const config = nativeAuthSecurityConfig();
  assert.equal(config.rateLimit.enabled, true);
  assert.equal(config.rateLimit.window, 60);
  assert.equal(config.rateLimit.max, 100);
  assert.equal(config.rateLimit.storage, "memory");
});

test("sensitive auth routes receive tighter limits", () => {
  const rules = nativeAuthSecurityConfig().rateLimit.customRules;
  assert.deepEqual(rules["/sign-in/email"], { window: 60, max: 5 });
  assert.deepEqual(rules["/sign-up/email"], { window: 60, max: 5 });
  assert.deepEqual(rules["/request-password-reset"], { window: 60, max: 3 });
  assert.deepEqual(rules["/reset-password"], { window: 60, max: 5 });
  assert.deepEqual(rules["/change-password"], { window: 60, max: 5 });
});

test("session expiry and refresh lifecycle remain explicit", () => {
  const session = nativeAuthSecurityConfig().session;
  assert.equal(session.expiresIn, 7 * 24 * 60 * 60);
  assert.equal(session.updateAge, 24 * 60 * 60);
  assert.equal(session.freshAge, 24 * 60 * 60);
  assert.equal("cookieCache" in session, false, "avoid cache delaying revocation");
});
