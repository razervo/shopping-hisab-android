import test from "node:test";
import assert from "node:assert/strict";
import { publicProfile } from "./public-profile.js";

test("returns only explicitly public profile fields", () => {
  const input = { id: "u1", name: "Example", email: "a@example.com", image: null, displayName: "Example",
    phone: "123", preferredMarket: "Local", postalCode: "123456", profilePictureId: null,
    passwordHash: "secret", role: "admin", sessionToken: "token", privateMetadata: { secret: true } };
  assert.deepEqual(publicProfile(input), { id: "u1", name: "Example", email: "a@example.com", image: null,
    displayName: "Example", phone: "123", preferredMarket: "Local", postalCode: "123456", profilePictureId: null });
});

test("handles missing or invalid user input safely", () => {
  assert.deepEqual(publicProfile(null), {});
  assert.deepEqual(publicProfile("not-user"), {});
});
