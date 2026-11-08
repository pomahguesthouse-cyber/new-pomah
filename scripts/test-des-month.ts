/** Regresi token bulan "des" (log WA Hany 8 Nov 2026, Indri 25 Okt, Zultonik 30 Okt). */
import assert from "node:assert/strict";
import { resolveMonthOnlyCorrection, resolveRelativeDayRange } from "@/lib/id-date";
import { parseAvailabilityDateRange } from "@/services/wa-autoreply/message-parsers";

const today = "2026-11-08";
const now = "2026-11-08T10:30:00+07:00";
const range = (m: string) => {
  const r = resolveRelativeDayRange(m, now);
  return r ? `${r.checkIn}..${r.checkOut}` : null;
};

const cases: Array<[string, string | null]> = [
  ["11 des", "2026-12-11..2026-12-12"],
  ["11 Des.", "2026-12-11..2026-12-12"],
  ["11 DES", "2026-12-11..2026-12-12"],
  ["tgl 11 des", "2026-12-11..2026-12-12"],
  ["11-12 des", "2026-12-11..2026-12-12"],
  ["11- 14 des bukan Nov", "2026-12-11..2026-12-14"],
  ["11 desember", "2026-12-11..2026-12-12"],
  ["31 Des-4 Jan 2027", "2026-12-31..2027-01-04"],
  ["26 des -1 jan", "2026-12-26..2027-01-01"],
  ["28 nov - 2 des", "2026-11-28..2026-12-02"],
  ["30 Des 2026 – 2 Jan 2027", "2026-12-30..2027-01-02"],
  ["11 nov", "2026-11-11..2026-11-12"],
  ["5 jan", "2027-01-05..2027-01-06"],
  ["14-16 agu", "2027-08-14..2027-08-16"],
  ["Deluxe", null],
  ["kamar deluxe deskripsinya gimana", null],
];
for (const [msg, want] of cases) assert.equal(range(msg), want, msg);
assert.deepEqual(parseAvailabilityDateRange("tgl 11 des", today), { checkIn: "2026-12-11", checkOut: "2026-12-12" });

const prior = ["Rencana kami ditgl 11 - 14", "Sedang di list", "Pak Maaf"];
for (const msg of ["Des", "des", "DES", "Des.", "des kak", "bulan Desember", "Des bukan nov"]) {
  const r = resolveMonthOnlyCorrection(msg, prior, today);
  assert.deepEqual(r && [r.checkIn, r.checkOut], ["2026-12-11", "2026-12-14"], msg);
}
for (const msg of ["Deluxe", "desa", "deskripsi", "Des aja yang deluxe", "ok"]) {
  assert.equal(resolveMonthOnlyCorrection(msg, prior, today), null, msg);
}
// Rentang sebelumnya sudah punya bulan → jangan tebak ulang.
assert.equal(resolveMonthOnlyCorrection("Des", ["11 - 14 nov"], today), null);
// Tanpa rentang sebelumnya → null (biarkan agent bertanya).
assert.equal(resolveMonthOnlyCorrection("Des", ["halo kak"], today), null);
// "2 - 3 orang" bukan rentang tanggal.
assert.equal(resolveMonthOnlyCorrection("Des", ["2 - 3 orang"], today), null);
console.log("des-month: all passed");
