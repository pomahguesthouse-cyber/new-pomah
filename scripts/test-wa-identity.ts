import assert from "node:assert/strict";
import {
  isConfiguredAdminPhone,
  normalizePhone,
} from "../src/services/wa-autoreply/identity";

const cases: Array<[string, string]> = [
  ["0812-3456-7890", "6281234567890"],
  ["812 3456 7890", "6281234567890"],
  ["+62 812 3456 7890", "6281234567890"],
  ["62081234567890", "6281234567890"],
  ["6281234567890", "6281234567890"],
  ["", ""],
];

for (const [input, expected] of cases) {
  assert.equal(normalizePhone(input), expected, `normalizePhone(${JSON.stringify(input)})`);
}

const previous = process.env.ADMIN_PHONE_NUMBERS;
process.env.ADMIN_PHONE_NUMBERS = "081234567890, +62 811 2222 3333";

assert.equal(isConfiguredAdminPhone("6281234567890"), true);
assert.equal(isConfiguredAdminPhone("0811-2222-3333"), true);
assert.equal(isConfiguredAdminPhone("0819-9999-9999"), false);
assert.equal(isConfiguredAdminPhone(""), false);

if (previous === undefined) delete process.env.ADMIN_PHONE_NUMBERS;
else process.env.ADMIN_PHONE_NUMBERS = previous;

console.log("✓ WhatsApp identity regression cases passed");
