import assert from "node:assert/strict";
import { parseCompleteReply } from "../src/ai/reply-integrity";
import { resolveRelativeDayRange } from "../src/lib/id-date";
import { parseAvailabilityDateRange, parseGuestCountFollowup } from "../src/services/wa-autoreply/message-parsers";
import { buildPropertyFaqReply } from "../src/services/property-faq";
import { resolveStartBookingGuests } from "../src/tools/start-booking.tool";

// A partial JSON reply used to be extracted by regex and sent to the guest.
assert.equal(parseCompleteReply('{"reply":"Untuk Family Room 222, rincian'), null);
assert.equal(parseCompleteReply('{"reply":"Harga Rp500.000/malam."}', "length"), null);
assert.equal(parseCompleteReply('{"reply":"Harga Rp500.000/malam."}', "stop"), "Harga Rp500.000/malam.");
assert.equal(parseCompleteReply('```json\n{"reply":"Lengkap\\nDua baris"}\n```'), "Lengkap\nDua baris");
assert.equal(parseCompleteReply('{"reply":"blocked"}', "content_filter"), null);

for (const text of ["Apakah ada homstay kosong untuk tgl 6/8 november", "Untuk Tgl 6/7/8 November Bisakah?"]) {
  const stay = resolveRelativeDayRange(text, "2026-11-01T12:00:00+07:00");
  assert.equal(stay?.checkIn, "2026-11-06");
  assert.equal(stay?.checkOut, "2026-11-08");
  assert.equal(stay?.needsConfirm, true);
  assert.equal(parseAvailabilityDateRange(text, "2026-11-01"), null);
}
// Ordinary day/month notation must continue working.
assert.equal(resolveRelativeDayRange("tgl 6/11/2026", "2026-11-01T12:00:00+07:00")?.checkIn, "2026-11-06");

for (const mode of ["early", "late"] as const) {
  for (const message of ["untuk kode booking nya dimana ya kak?", "invoice dimana?", "rekening di mana?"]) {
    assert.notEqual(buildPropertyFaqReply({ message, property: {}, mode })?.intent, "location_question");
  }
  assert.equal(buildPropertyFaqReply({ message: "minta maps nya kak", property: {}, mode })?.intent, "location_question");
}

const party = parseGuestCountFollowup("3 dewasa, 1 anak");
assert.deepEqual(party, { adults: 3, children: 1, total: 4 });
assert.deepEqual(resolveStartBookingGuests({ adults: 2, children: 0 }, {
  partialAdults: party!.adults, partialChildren: party!.children,
}, [{ capacity: 2 }]), { adults: 3, children: 1 });

console.log("WhatsApp November 1 incident regressions passed");
