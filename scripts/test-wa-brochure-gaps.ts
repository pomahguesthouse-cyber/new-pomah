/**
 * Celah brosur 14 hari terakhir: ejaan memanjang, fasilitas, pesan campuran,
 * aturan kirim ulang, klaim foto palsu, dan PDF brosur yang disangka bukti transfer.
 */
import assert from "node:assert/strict";
import { classifyIntent } from "../src/ai/router/intent-classifier";
import {
  isGeneralFacilityQuestion,
  isRoomLookAsk,
  isSingleAmenityYesNo,
  normalizeGuestMediaText,
} from "../src/lib/guest-media-request";
import { buildPropertyFaqReply } from "../src/services/property-faq";
import {
  emptyMediaDelivery,
  guardUnverifiedMediaClaims,
  hasUnverifiedMediaClaim,
  isBrochureRequest,
} from "../src/services/reply-postprocess";
import { isOurBrochureFilename } from "../src/services/wa-autoreply/brochure-source";
import {
  BROCHURE_DAILY_CAP,
  BROCHURE_RESEND_AFTER_MS,
  decideBrochureRepeat,
  planMediaFastPath,
  type GalleryRoom,
} from "../src/services/wa-autoreply/media-fast-path";
import { isMediaRequest, shouldAnswerMediaWithAi } from "../src/services/wa-autoreply/message-parsers";
import { isPaymentProofCandidate, planPaymentProofGuestReply } from "../src/services/wa-inbound-media";

const rooms: GalleryRoom[] = [
  { name: "Deluxe", hero_image_url: "https://cdn.example/deluxe.jpg", images: [] },
  { name: "Single", hero_image_url: "https://cdn.example/single.jpg", images: [] },
  { name: "Family Suite", hero_image_url: "https://cdn.example/suite.jpg", images: [] },
  { name: "Family Room 222", hero_image_url: "https://cdn.example/fr222.jpg", images: [] },
];
const inbound = (body: string) => [{ direction: "in", body }];
const NOW = Date.parse("2026-10-11T03:00:00.000Z");
const MIN = 60_000;

const faqRooms = [
  { name: "Single", amenities: ["WiFi", "AC", "Kamar mandi dalam"] },
  { name: "Deluxe", amenities: ["WiFi", "AC", "Kamar mandi dalam", "TV"] },
];

function faq(message: string) {
  return buildPropertyFaqReply({
    message,
    property: { name: "Pomah Guesthouse" },
    rooms: faqRooms,
    greetingUsed: true,
    mode: "early",
  });
}

// ─── 1. Ejaan memanjang, pict/pic, "kaya apa" ────────────────────────────────

assert.equal(normalizeGuestMediaText("fotonyaa kamarnyaa fotoo kaa"), "fotonya kamarnya foto ka");
assert.equal(normalizeGuestMediaText("hello book"), "hello book");
assert.equal(normalizeGuestMediaText("can I see the room"), "can I see the room");

const elongated = "Boleh minta rincian fasilitas atau fotonyaa kaa";
assert.equal(isMediaRequest(elongated), true, "fotonyaa harus terbaca sebagai minta foto");
assert.equal(isGeneralFacilityQuestion(elongated), true);
assert.equal(planMediaFastPath(inbound(elongated), rooms), null, "fasilitas + foto bukan balasan kaleng saja");
const elongatedFaq = faq(elongated);
assert.equal(elongatedFaq?.intent, "faq_facility");
assert.equal(elongatedFaq?.sendBrochure, true);
assert.equal(isBrochureRequest(elongated), true);

for (const phrase of ["kirim pict kamar", "ada pic kamarnya?", "minta fotoo", "lihat kamarnyaa dong"]) {
  assert.equal(isMediaRequest(phrase), true, phrase);
  assert.equal(planMediaFastPath(inbound(phrase), rooms)?.kind, "brochure", phrase);
  assert.equal(isBrochureRequest(phrase), true, phrase);
}

const look = "yg 175k itu kaya apa kak";
assert.equal(isRoomLookAsk(look), true);
assert.equal(isMediaRequest(look), true);
assert.equal(isBrochureRequest(look), true);
assert.equal(planMediaFastPath(inbound(look), rooms)?.kind, "brochure");
assert.equal((await classifyIntent(look)).category, "media_request");
assert.equal((await classifyIntent(elongated)).category, "media_request");

for (const phrase of ["kamar deluxe kayak gimana", "family suite seperti apa", "single kaya gimana kak"]) {
  assert.equal(isRoomLookAsk(phrase), true, phrase);
  assert.equal(isMediaRequest(phrase), true, phrase);
}
assert.equal(isRoomLookAsk("kebijakan refund seperti apa"), false, "seperti apa tanpa kamar/harga bukan minta foto");
assert.equal(isMediaRequest("kebijakan refund seperti apa"), false);

// ─── 2. Fasilitas umum vs ya/tidak satu item ─────────────────────────────────

for (const phrase of [
  "fasilitas",
  "fasilitasnya apa saja",
  "rincian fasilitas",
  "ada apa aja",
  "fasilitas single sama deluxe apa ya",
]) {
  assert.equal(isGeneralFacilityQuestion(phrase), true, phrase);
  assert.equal(isSingleAmenityYesNo(phrase), false, phrase);
  const answer = faq(phrase);
  assert.equal(answer?.intent, "faq_facility", phrase);
  assert.equal(answer?.sendBrochure, true, phrase);
  assert.ok(answer?.reply && answer.reply.length > 0, phrase);
}

for (const phrase of ["parkir?", "ada dapur?", "kulkas?", "sarapan?"]) {
  assert.equal(isGeneralFacilityQuestion(phrase), false, phrase);
  assert.equal(isSingleAmenityYesNo(phrase), true, phrase);
  const answer = faq(phrase);
  assert.notEqual(answer?.sendBrochure, true, `${phrase} tetap teks saja`);
  if (answer) assert.notEqual(answer.intent, "faq_facility");
}

// ─── 3. Campuran dan pesan panjang ───────────────────────────────────────────

const mixed = "boleh minta foto kamar deluxe? apakah kamar mandi dalam atau diluar?";
assert.equal(isMediaRequest(mixed), true);
assert.equal(shouldAnswerMediaWithAi(mixed), true);
assert.equal(planMediaFastPath(inbound(mixed), rooms), null, "foto + pertanyaan lain bukan balasan kaleng");

const long =
  "Saya mau tanya beberapa hal sebelum booking. " +
  "Tolong jelaskan juga aturan tamu dan jam kedatangan. ".repeat(4) +
  "Boleh minta foto kamar terbaru? Apakah kamar mandi dalam atau diluar?";
assert.ok(long.length > 280, `panjang pesan ${long.length}`);
assert.equal(isMediaRequest(long), true);
assert.equal(shouldAnswerMediaWithAi(long), true);
assert.equal(planMediaFastPath(inbound(long), rooms), null);

assert.equal(
  planMediaFastPath(inbound("kirim foto kamar yang ada ac"), rooms)?.kind,
  "brochure",
  "kata ac tidak lagi memblokir fast-path",
);
assert.equal(
  planMediaFastPath(inbound("minta foto kamar, wifi nya bagaimana?"), rooms),
  null,
  "wifi yang ditanyakan bersama foto dijawab AI, bukan diblokir sebagai komplain",
);
assert.equal(shouldAnswerMediaWithAi("minta foto kamar, wifi nya bagaimana?"), true);
assert.equal(planMediaFastPath(inbound("wifi rusak, kirim foto"), rooms), null, "rusak tetap keluhan");

// ─── 4. Aturan kirim ulang ───────────────────────────────────────────────────

assert.equal(BROCHURE_RESEND_AFTER_MS, 30 * MIN);
assert.equal(BROCHURE_DAILY_CAP, 3);

const recent = [NOW - 10 * MIN];
assert.deepEqual(
  decideBrochureRepeat({
    text: "minta foto deluxe",
    rooms,
    now: NOW,
    threadSendAts: recent,
    draftRoomType: "Family Suite",
  }),
  { action: "room_photos", roomType: "Deluxe" },
  "tipe di pesan menang atas draf booking",
);
assert.deepEqual(
  decideBrochureRepeat({
    text: "ada fotonya ga",
    rooms,
    now: NOW,
    threadSendAts: recent,
    draftRoomType: "Deluxe",
  }),
  { action: "room_photos", roomType: "Deluxe" },
);

for (const phrase of ["kirim lagi", "tolong ulang", "belum masuk", "gak kebuka", "tidak bisa dibuka"]) {
  assert.deepEqual(
    decideBrochureRepeat({ text: phrase, rooms, now: NOW, threadSendAts: recent, draftRoomType: "Deluxe" }),
    { action: "send" },
    phrase,
  );
}

assert.deepEqual(
  decideBrochureRepeat({
    text: "minta foto",
    rooms,
    now: NOW,
    threadSendAts: [NOW - 31 * MIN],
  }),
  { action: "send" },
  "lebih dari 30 menit: kirim ulang",
);
assert.deepEqual(
  decideBrochureRepeat({
    text: "minta foto",
    rooms,
    now: NOW,
    threadSendAts: recent,
  }),
  { action: "already_sent" },
);

const capped = [NOW - 20 * MIN, NOW - 15 * MIN, NOW - 40 * MIN];
assert.equal(capped.length, 3);
assert.deepEqual(
  decideBrochureRepeat({ text: "kirim lagi dong", rooms, now: NOW, threadSendAts: capped }),
  { action: "already_sent" },
  "plafon 3 brosur per 24 jam",
);
assert.deepEqual(
  decideBrochureRepeat({ text: "foto family suite", rooms, now: NOW, threadSendAts: capped }),
  { action: "room_photos", roomType: "Family Suite" },
  "plafon brosur tidak menahan foto tipe yang disebut",
);
assert.deepEqual(
  decideBrochureRepeat({ text: "minta foto deluxe", rooms, now: NOW, threadSendAts: [] }),
  { action: "send" },
  "tanpa jejak thread jangan mengklaim sudah dikirim",
);

// ─── 5. AI tidak mengarang kiriman / kendala teknis ──────────────────────────

const invented =
  "Foto Family Suite sudah kami kirim ya Kak. Untuk Family Room 222 ada kendala teknis jadi fotonya belum bisa dikirim.";
const stripped = guardUnverifiedMediaClaims(invented, emptyMediaDelivery());
assert.equal(/family suite/i.test(stripped), false);
assert.equal(/kendala teknis/i.test(stripped), false);
assert.equal(/sudah kami kirim/i.test(stripped), false);

const verified = guardUnverifiedMediaClaims(invented, {
  ...emptyMediaDelivery(),
  photoRoomsSent: ["Family Suite"],
  photoRoomsFailed: ["Family Room 222"],
  anyMediaFailed: true,
  genericPhotoSent: true,
});
assert.match(verified, /Family Suite/);
assert.match(verified, /kendala teknis/);

const brochureOnly = guardUnverifiedMediaClaims("Brosurnya sudah kami kirim ya Kak.", {
  ...emptyMediaDelivery(),
  brochureSent: true,
});
assert.match(brochureOnly, /Brosurnya sudah kami kirim/);

// ─── 6. PDF brosur bukan bukti transfer ──────────────────────────────────────

assert.equal(isOurBrochureFilename("Brosur Pomah Guesthouse.pdf"), true);
assert.equal(isOurBrochureFilename("brosur_pomah_guesthouse.pdf"), true);
assert.equal(isOurBrochureFilename("bukti-transfer.pdf"), false);
assert.equal(
  isPaymentProofCandidate({
    mediaType: "document",
    mimeType: "application/pdf",
    fileName: "Brosur Pomah Guesthouse.pdf",
    paymentProofCandidate: true,
  }),
  false,
);
assert.equal(
  planPaymentProofGuestReply({
    body: "[Tamu mengirim lampiran bukti transfer pembayaran]",
    mediaType: "document",
    mimeType: "application/pdf",
    fileName: "Brosur Pomah Guesthouse.pdf",
    paymentProofCandidate: true,
  }),
  null,
);
assert.equal(
  isPaymentProofCandidate({ mediaType: "document", mimeType: "application/pdf", fileName: "bukti.pdf" }),
  true,
);

// ─── Insiden 14 Okt 2026 (…9129): konsonan dobel & klaim "sudah Rani kirimkan" ───
assert.equal(normalizeGuestMediaText("boleh liatt kamarnya dlu kakk?"), "boleh liat kamarnya dlu kak?");
for (const keep of ["mall", "full", "all", "will", "staff", "access"]) {
  assert.equal(normalizeGuestMediaText(keep), keep, `kata ${keep} tidak diubah`);
}
assert.equal(isMediaRequest("boleh liatt kamarnya dlu kakk?"), true, "…9129 wajib dikenali minta foto");
assert.equal(isMediaRequest("boleh lihatt kamarnya kak"), true);
assert.equal(isMediaRequest("lagi di mall kak"), false);

const fakeClaim =
  "Baik Kak, foto-fotonya sudah Rani kirimkan ke chat Kakak ya.\n\nAda yang bisa Rani bantu lagi terkait ketersediaan atau booking?";
const none = emptyMediaDelivery();
assert.equal(hasUnverifiedMediaClaim(fakeClaim, none), true, "klaim 'sudah Rani kirimkan' tanpa kiriman terdeteksi");
assert.ok(!/sudah Rani kirimkan/.test(guardUnverifiedMediaClaims(fakeClaim, none)));
assert.equal(hasUnverifiedMediaClaim("Fotonya sudah saya kirimkan ya Kak.", none), true);
assert.equal(hasUnverifiedMediaClaim("Rani kirimkan foto kamarnya ya Kak.", none), true);
assert.equal(
  hasUnverifiedMediaClaim(fakeClaim, { ...none, brochureSent: true }),
  false,
  "setelah brosur benar-benar terkirim, klaim tidak lagi palsu",
);
// Penyelamatan brosur mengikuti batas kirim ulang yang sama.
assert.equal(decideBrochureRepeat({ text: "", rooms: [], now: Date.now(), threadSendAts: [] }).action, "send");
assert.equal(
  decideBrochureRepeat({ text: "", rooms: [], now: Date.now(), threadSendAts: [Date.now() - 60_000] }).action,
  "already_sent",
  "brosur baru saja dikirim → tidak dikirim lagi",
);

console.log("test-wa-brochure-gaps: OK");
