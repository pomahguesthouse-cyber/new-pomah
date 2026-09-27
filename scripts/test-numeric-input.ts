/**
 * Kolom angka: string kosong tidak boleh langsung jadi 0 di dalam draft,
 * tapi nilai yang disimpan tetap fallback yang sama seperti sebelumnya.
 */
import assert from "node:assert/strict";

import {
  commitNumericValue,
  isAllowedNumericDraft,
  numericDraftAfterChange,
} from "../src/lib/numeric-input";

assert.equal(commitNumericValue("", { emptyValue: 0 }), 0);
assert.equal(commitNumericValue("", { emptyValue: 1 }), 1);
assert.equal(commitNumericValue("0", { emptyValue: 0 }), 0);
assert.equal(commitNumericValue("0", { emptyValue: 1 }), 1);
assert.equal(commitNumericValue("0", { emptyValue: 2026 }), 2026);
assert.equal(commitNumericValue("5", { emptyValue: 0 }), 5);
assert.equal(commitNumericValue("05", { emptyValue: 0 }), 5);
assert.equal(commitNumericValue("-", { emptyValue: 0 }), 0);
assert.equal(commitNumericValue("-3"), -3);

assert.equal(commitNumericValue("25", { max: 20, phase: "edit" }), 20);
assert.equal(commitNumericValue("24", { min: 0, max: 23 }), 23);
assert.equal(commitNumericValue("1", { min: 10, phase: "edit" }), 1);
assert.equal(commitNumericValue("1", { min: 10, phase: "commit" }), 10);
assert.equal(commitNumericValue("", { min: 1, emptyValue: 1, phase: "edit" }), 1);
assert.equal(commitNumericValue("15", { min: 1, max: 20 }), 15);
assert.equal(commitNumericValue("1.5", { allowDecimal: true }), 1.5);
assert.equal(commitNumericValue("1.", { allowDecimal: true, emptyValue: 0 }), 0);

assert.equal(numericDraftAfterChange("", 0), "");
assert.equal(numericDraftAfterChange("5", 5), "5");
assert.equal(numericDraftAfterChange("25", 20, { max: 20 }), "20");
assert.equal(numericDraftAfterChange("0", 1, { emptyValue: 1 }), "0");

assert.equal(isAllowedNumericDraft(""), true);
assert.equal(isAllowedNumericDraft("12"), true);
assert.equal(isAllowedNumericDraft("1.2"), false);
assert.equal(isAllowedNumericDraft("-1"), false);
assert.equal(isAllowedNumericDraft("-1", { allowNegative: true }), true);
assert.equal(isAllowedNumericDraft("1.5", { allowDecimal: true }), true);

console.log("numeric input commit rules ok");
