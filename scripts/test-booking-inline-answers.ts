/**
 * Regression script untuk jawaban inline DP & perbandingan fasilitas.
 *
 * Latar (percakapan produksi 3 Juli 2026):
 * - "yang deluxe aja ya min, untuk paymentnya dp dulu apa gimana?" → jawaban
 *   DP DITUNDA sampai nama lengkap ada. Seharusnya dijawab langsung.
 * - "untuk perbedaan deluxe sama grand deluxe itu di fasilitas apa ya min?" →
 *   dijawab daftar gabungan generik dengan duplikat ("WI-FI ... WIfi"),
 *   bukan perbandingan.
 *
 * Jalankan: npx tsx scripts/test-booking-inline-answers.ts
 */

import {
  buildPaymentPolicyAnswer,
  buildFacilityReply,
  findMentionedRooms,
} from "../src/ai/state-machine/booking-inline-answers";

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ─── Payment ──────────────────────────────────────────────────────────────────

console.log("— buildPaymentPolicyAnswer —");
{
  const noTotal = buildPaymentPolicyAnswer();
  check("tanpa total: sebut DP 50%", /DP dulu 50%/.test(noTotal), noTotal);
  check("tanpa total: sebut pelunasan saat check-in", /check-in/.test(noTotal));

  const withTotal = buildPaymentPolicyAnswer({ totalPrice: 350000 });
  check("dengan total: nominal DP dihitung (Rp175.000)", withTotal.includes("Rp175.000"), withTotal);

  const withBank = buildPaymentPolicyAnswer({
    includeBank: true,
    bankName: "BCA",
    accountNumber: "1234567890",
    accountHolder: "Pomah Guesthouse",
  });
  check("minta norek: rekening disebut", /BCA 1234567890 a\.n\. Pomah Guesthouse/.test(withBank), withBank);

  const noBankData = buildPaymentPolicyAnswer({ includeBank: true });
  check("minta norek tapi data kosong: tidak menyebut transfer", !/Transfer/.test(noBankData));
}

// ─── Facilities ───────────────────────────────────────────────────────────────

const rooms = [
  { name: "Deluxe", amenities: ["AC", "WI-FI", "Shower", "Air Panas"] },
  { name: "Grand Deluxe", amenities: ["AC", "WIfi", "Shower", "Air Panas", "View Taman", "Bathtub"] },
  { name: "Family Room 222", amenities: ["AC", "Dapur Bersama", "2 K. Tidur"] },
];

console.log("— findMentionedRooms —");
{
  const q = "untuk perbedaan deluxe sama grand deluxe itu di fasilitas apa ya min?";
  const found = findMentionedRooms(q, rooms).map((r) => r.name);
  check(
    '"grand deluxe" tidak tertangkap dobel sebagai "Deluxe"',
    found.length === 2 && found.includes("Deluxe") && found.includes("Grand Deluxe"),
    JSON.stringify(found),
  );
  const only = findMentionedRooms("fasilitas grand deluxe apa aja?", rooms).map((r) => r.name);
  check('hanya "Grand Deluxe" saat cuma itu yang disebut', only.length === 1 && only[0] === "Grand Deluxe", JSON.stringify(only));
}

console.log("— buildFacilityReply —");
{
  const q = "untuk perbedaan deluxe sama grand deluxe itu di fasilitas apa ya min?";
  const reply = buildFacilityReply(q, rooms)!;
  check("kasus produksi: reply per kamar", reply.includes("*Deluxe*") && reply.includes("*Grand Deluxe*"), reply);
  check("kasus produksi: perbedaan disorot (View Taman, Bathtub)", /Perbedaan utamanya:.*View Taman, Bathtub/.test(reply), reply);
  check("dedup wifi: WI-FI vs WIfi tidak dobel", (reply.match(/wi-?fi/gi) ?? []).length <= 2, reply);

  const one = buildFacilityReply("fasilitas family room 222 apa aja?", rooms)!;
  check("satu kamar: daftar kamar itu saja", one.includes("*Family Room 222*") && one.includes("Dapur Bersama"), one);
  check("satu kamar: tidak menyebut Bathtub kamar lain", !one.includes("Bathtub"));

  const generic = buildFacilityReply("fasilitasnya ada apa saja?", rooms)!;
  check("generik: gabungan ter-dedup", (generic.match(/wi-?fi/gi) ?? []).length === 1, generic);
  check("generik: ajak sebut tipe kamar", /Sebutkan tipe kamarnya/.test(generic));

  const empty = buildFacilityReply("fasilitas apa saja?", [{ name: "X" }]);
  check("tanpa data amenities: null (fallback)", empty === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
