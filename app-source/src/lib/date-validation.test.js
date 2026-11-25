import test from "node:test";
import assert from "node:assert/strict";
import { isValidCalendarDate } from "../src/lib/date-validation.js";

test("accepts real calendar dates and leap days", () => {
  for (const date of ["2026-11-25", "2024-02-29", "2000-01-01", "2026-12-31"]) {
    assert.equal(isValidCalendarDate(date), true, date);
  }
});

test("rejects impossible calendar dates and malformed formats", () => {
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-2-01", "", "not-a-date", null]) {
    assert.equal(isValidCalendarDate(date), false, String(date));
  }
});
