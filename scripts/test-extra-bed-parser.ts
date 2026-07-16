import assert from "node:assert/strict";
import { extractRequestedExtraBeds } from "../src/ai/state-machine/extra-bed-parser";

const cases: Array<[string, number | undefined]> = [
  ["booking Grand Deluxe tambah 1 extra bed", 1],
  ["pakai extra bed satu ya", 1],
  ["2 extra bed", 2],
  ["extra bed: 3", 3],
  ["booking Deluxe dengan kasur tambahan", 1],
  ["tanpa extra bed", 0],
  ["hapus kasur tambahan", 0],
  ["harga extra bed berapa?", undefined],
  ["apakah tersedia extra bed?", undefined],
  ["booking Grand Deluxe untuk 2 orang", undefined],
];

for (const [message, expected] of cases) {
  assert.equal(extractRequestedExtraBeds(message), expected, message);
}

console.log("extra-bed parser regressions: OK");
