import assert from "node:assert/strict";
import { normalizeGuestPhone } from "../src/services/guest-resolver.service";

const cases: Array<[string | null | undefined, string | null]> = [
  ["+62 813-3896-9133", "6281338969133"],
  ["0813-3896-9133", "6281338969133"],
  ["81338969133", "6281338969133"],
  ["6281338969133", "6281338969133"],
  ["", null],
  [null, null],
];

for (const [input, expected] of cases) {
  assert.equal(normalizeGuestPhone(input), expected, String(input));
}

console.log("guest resolver phone regressions: OK");
