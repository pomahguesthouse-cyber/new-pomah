/**
 * Fast-path foto/brosur, konversi WebP sebelum kirim Meta, ambang quick-ack
 * (hanya setelah jawaban belum siap ~3 dtk), dan gerbang poll Evolution.
 *
 * Tidak mengirim WhatsApp. Urutan ack vs balasan diuji di
 * `scripts/test-quick-ack.ts` dengan timer palsu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  QUICK_ACK_SLOW_THRESHOLD_MS,
  isQuickAckSuppressedMessage,
  quickAckDelayMs,
  shouldArmQuickAck,
} from "../src/services/wa-autoreply/runtime-policy";
import {
  MEDIA_FAST_PATH_ALREADY_SENT_REPLY,
  MEDIA_FAST_PATH_BROCHURE_ALREADY_SENT_REPLY,
  MEDIA_FAST_PATH_BROCHURE_REPLY,
  MEDIA_FAST_PATH_PHOTO_BROCHURE_REPLY,
  MEDIA_FAST_PATH_PHOTO_REPLY,
  matchGalleryRoom,
  planMediaFastPath,
  roomsForPhotoPlan,
  type GalleryRoom,
} from "../src/services/wa-autoreply/media-fast-path";
import { isMediaRequest, isViewRoomRequest } from "../src/services/wa-autoreply/message-parsers";
import { isBrochureRequest } from "../src/services/reply-postprocess";
import { evolutionInboxPollDecision } from "../src/services/evolution-inbox-gate";
import {
  BROCHURE_CAPTION,
  MEDIA_DEDUP_WINDOW_MS,
  roomPhotoCaption,
} from "../src/services/wa-media-dedup";
import { transcodeWebpToJpeg } from "../src/services/meta-image-transcode";
import {
  isMetaSafeRasterUrl,
  isUnsupportedMetaImage,
  metaSafeImageFilename,
  prepareMetaImageForSend,
  siblingRasterCandidates,
  sniffImageMime,
  type MetaImageDeps,
} from "../src/services/meta-media";

const rooms: GalleryRoom[] = [
  {
    name: "Deluxe",
    hero_image_url: "https://cdn.example/room-images/deluxe.webp",
    images: ["https://cdn.example/room-images/deluxe-2.webp"],
  },
  {
    name: "Family Suite",
    hero_image_url: "https://cdn.example/room-images/family.jpg",
    images: [],
  },
  {
    name: "Junior Suite",
    hero_image_url: "https://cdn.example/room-images/junior.webp",
    images: [],
  },
  { name: "Single", hero_image_url: null, images: [] },
];

function inbound(body: string) {
  return [{ direction: "in", body }];
}

// ─── Quick-ack hanya setelah jawaban belum siap ~3 detik ────────────────────

assert.equal(QUICK_ACK_SLOW_THRESHOLD_MS, 3_000);
assert.equal(quickAckDelayMs(0), QUICK_ACK_SLOW_THRESHOLD_MS);
assert.equal(quickAckDelayMs(500), 2_500);
assert.equal(quickAckDelayMs(QUICK_ACK_SLOW_THRESHOLD_MS), 0);
assert.equal(quickAckDelayMs(QUICK_ACK_SLOW_THRESHOLD_MS + 400), 0);
assert.equal(quickAckDelayMs(-10), quickAckDelayMs(0));
assert.equal(shouldArmQuickAck("malam"), false);
assert.equal(shouldArmQuickAck("ada kamar tanggal 12?"), true);

assert.equal(isQuickAckSuppressedMessage("makasih ya kak"), true);
assert.equal(isQuickAckSuppressedMessage("minta foto?"), false);
assert.equal(isQuickAckSuppressedMessage("minta foto dong"), false);

// ─── Gerbang foto / brosur ───────────────────────────────────────────────────

// Permintaan foto → brosur PDF (dokumen); foto per kamar hanya cadangan.
const photo = planMediaFastPath(inbound("minta foto dong"), rooms);
assert.equal(photo?.kind, "brochure");
if (photo?.kind === "brochure") {
  assert.equal(photo.reply, MEDIA_FAST_PATH_PHOTO_BROCHURE_REPLY);
  const fb = photo.photoFallback;
  assert.ok(fb, "foto per kamar tetap jadi cadangan");
  assert.equal(fb?.roomType, null);
  assert.equal(fb?.maxPhotos, 1);
  assert.equal(fb?.reply, MEDIA_FAST_PATH_PHOTO_REPLY);
  assert.deepEqual(
    roomsForPhotoPlan(rooms, fb!).map((r) => r.name),
    ["Deluxe", "Family Suite", "Junior Suite"],
  );
}

const deluxe = planMediaFastPath(inbound("kirim gambar kamar deluxe"), rooms);
assert.equal(deluxe?.kind, "brochure");
if (deluxe?.kind === "brochure") {
  assert.equal(deluxe.photoFallback?.roomType, "Deluxe");
  assert.equal(deluxe.photoFallback?.maxPhotos, 3);
}

assert.equal(matchGalleryRoom("foto family suite kak", rooms)?.name, "Family Suite");

const brochure = planMediaFastPath(inbound("minta brosur ya"), rooms);
assert.equal(brochure?.kind, "brochure");
assert.equal(
  brochure && brochure.kind === "brochure" ? brochure.reply : "",
  MEDIA_FAST_PATH_BROCHURE_REPLY,
);
assert.equal(brochure?.kind === "brochure" ? brochure.photoFallback : "x", null);

const both = planMediaFastPath(inbound("minta pricelist beserta gambar kamarnya"), rooms);
assert.equal(both?.kind, "brochure");
if (both?.kind === "brochure") assert.equal(both.reply, MEDIA_FAST_PATH_BROCHURE_REPLY);

// "Mau lihat kamar" / "boleh lihat kamarnya" (tanpa kata foto) → brosur PDF juga,
// dengan balasan ramah yang sama seperti permintaan foto.
for (const phrase of [
  "mau lihat kamar",
  "boleh lihat kamarnya",
  "boleh lihat kamarnya kak?",
  "Kak mau liat kamarnya dong",
  "boleh dilihat kamarnya?",
  "Selamat sore, mau lihat kamar nya boleh?",
  // Insiden 1 Okt 2026: awalan "me-" membuat pola lama gagal → bot hanya menjawab deskripsi kamar.
  "apakah saya boleh melihat kamarnya kak?",
  "pengen lihat kamar",
  "pengen melihat kamarnya",
  "lihat kamar dong",
  "mau liat kamar",
  "kak bisa saya lihat kamarnya?",
  "boleh saya lihat-lihat kamarnya dulu?",
  "ingin melihat kamar grand deluxe",
  "boleh lihat kamar yang deluxe?",
  "show me the room",
]) {
  const view = planMediaFastPath(inbound(phrase), rooms);
  assert.equal(view?.kind, "brochure", `"${phrase}" harus dijawab brosur PDF`);
  if (view?.kind === "brochure") {
    assert.equal(view.reply, MEDIA_FAST_PATH_PHOTO_BROCHURE_REPLY, `"${phrase}" memakai balasan ramah`);
    assert.equal(view.photoFallback, null, "tanpa kata foto → tidak ada cadangan foto per kamar");
  }
}
// Kunjungan langsung bukan permintaan media.
assert.equal(planMediaFastPath(inbound("mau lihat kamar langsung"), rooms), null);
assert.equal(planMediaFastPath(inbound("mau datang survei lihat kamar"), rooms), null);
assert.equal(isViewRoomRequest("boleh lihat kamar mandinya?"), false, "kamar mandi bukan permintaan media");
assert.equal(isMediaRequest("apakah saya boleh melihat kamarnya kak?"), true, "router/orchestrator ikut mengenali");
// Pesan sudah dijawab sebelumnya: hanya burst inbound terakhir yang dihitung (alur insiden 1 Okt 2026).
assert.equal(
  planMediaFastPath(
    [
      { direction: "in", body: "kalau grand deluxe brp ya kak?" },
      { direction: "out", body: "Grand Deluxe harganya Rp300.000/malam, Kak." },
      { direction: "in", body: "apakah saya boleh melihat kamarnya kak?" },
    ],
    rooms,
  )?.kind,
  "brochure",
);
// Campuran dengan harga/tanggal tetap ke Front Office (LLM) — tool media + lampiran brosur tetap aktif di sana.
assert.equal(planMediaFastPath(inbound("boleh lihat kamarnya, harganya berapa?"), rooms), null);
assert.equal(isBrochureRequest("apakah saya boleh melihat kamarnya kak?"), true);
// Teks > 280 karakter tidak masuk fast-path (dibiarkan ke LLM).
assert.equal(planMediaFastPath(inbound("mau lihat kamar " + "x".repeat(300)), rooms), null);

// Nada balasan: hangat (sapaan "Kak", tanpa huruf kapital teriak / tanda seru berulang / teguran).
for (const reply of [
  MEDIA_FAST_PATH_PHOTO_REPLY,
  MEDIA_FAST_PATH_ALREADY_SENT_REPLY,
  MEDIA_FAST_PATH_BROCHURE_REPLY,
  MEDIA_FAST_PATH_PHOTO_BROCHURE_REPLY,
  MEDIA_FAST_PATH_BROCHURE_ALREADY_SENT_REPLY,
]) {
  assert.ok(reply.includes("Kak"), `sapaan Kak: ${reply}`);
  assert.ok(!/[A-Z]{4,}/.test(reply), `tanpa huruf kapital teriak: ${reply}`);
  assert.ok(!/[!?]{2,}/.test(reply), `tanpa tanda seru/tanya berulang: ${reply}`);
  assert.ok(!/\b(jangan|dilarang|tidak boleh|harus)\b/i.test(reply), `tanpa teguran: ${reply}`);
  assert.ok(!/https?:\/\//i.test(reply), `tanpa URL di teks: ${reply}`);
}
assert.match(MEDIA_FAST_PATH_PHOTO_BROCHURE_REPLY, /Dengan senang hati Kak/);
assert.match(MEDIA_FAST_PATH_PHOTO_BROCHURE_REPLY, /foto-foto lengkap tiap tipe kamar/);

assert.equal(planMediaFastPath(inbound("harganya berapa ya ka"), rooms), null);
assert.equal(
  planMediaFastPath(
    [
      { direction: "in", body: "apakah ada gambarnya kak?" },
      { direction: "in", body: "harganya berapa ya ka" },
    ],
    rooms,
  ),
  null,
  "harga + foto dalam satu burst tetap ke LLM",
);
assert.equal(planMediaFastPath(inbound("virtual tour dong"), rooms), null);
assert.equal(planMediaFastPath(inbound("wifi rusak, kirim foto"), rooms), null);
assert.equal(
  planMediaFastPath(
    [
      { direction: "in", body: "wifi ga bisa" },
      { direction: "in", body: "minta foto" },
    ],
    rooms,
  ),
  null,
);
const ambiguous = planMediaFastPath(inbound("foto suite"), rooms);
assert.equal(ambiguous?.kind, "brochure", "brosur mencakup semua tipe kamar");
assert.equal(
  ambiguous?.kind === "brochure" ? ambiguous.photoFallback : "x",
  null,
  "suite ambigu tidak boleh menebak foto cadangan",
);
const noGallery = planMediaFastPath(inbound("minta foto"), [
  { name: "Single", hero_image_url: null, images: [] },
]);
assert.equal(noGallery?.kind, "brochure");
assert.equal(noGallery?.kind === "brochure" ? noGallery.photoFallback : "x", null);

assert.equal(roomPhotoCaption("Deluxe"), "Foto kamar *Deluxe* 📸");
assert.equal(MEDIA_DEDUP_WINDOW_MS, 30 * 60_000);
assert.ok(BROCHURE_CAPTION.includes("Brosur"));

const toolSource = fs.readFileSync("src/tools/send-room-photos.tool.ts", "utf8");
assert.ok(
  toolSource.includes("loadRecentOutboundCaptions"),
  "dedup foto 30 menit harus tetap terpasang",
);
assert.ok(toolSource.includes("roomPhotoCaption"));
const serviceSource = fs.readFileSync("src/services/wa-autoreply.service.ts", "utf8");
assert.ok(serviceSource.includes("planMediaFastPath"));
assert.ok(serviceSource.includes("quickAckDelayMs"));
assert.ok(serviceSource.includes("shouldArmQuickAck"));
assert.ok(serviceSource.includes("beforeReplySend"));
assert.equal(
  serviceSource.includes("QUICK_ACK_AFTER_MS"),
  false,
  "jeda ack 6 detik tidak boleh kembali",
);

// ─── WebP tidak diteruskan ke Meta ───────────────────────────────────────────

const webpUrl = "https://cdn.example/storage/v1/object/public/room-images/deluxe.webp";
const jpegUrl = "https://cdn.example/storage/v1/object/public/room-images/deluxe.jpg";
assert.equal(isUnsupportedMetaImage(webpUrl), true);
assert.equal(isMetaSafeRasterUrl(jpegUrl), true);
assert.equal(isUnsupportedMetaImage(jpegUrl, "foto.jpg"), false);
assert.deepEqual(siblingRasterCandidates(webpUrl), [
  webpUrl.replace(/\.webp$/, ".jpg"),
  webpUrl.replace(/\.webp$/, ".jpeg"),
  webpUrl.replace(/\.webp$/, ".png"),
]);
assert.equal(metaSafeImageFilename("Deluxe_1.webp", jpegUrl), "Deluxe_1.jpg");

const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
assert.equal(sniffImageMime(webpBytes), "image/webp");
assert.equal(sniffImageMime(jpegBytes), "image/jpeg");

let fetches = 0;
let uploads = 0;
const deps: MetaImageDeps = {
  fetch: async () => {
    fetches += 1;
    return new Response(webpBytes, { status: 200, headers: { "content-type": "image/webp" } });
  },
  probeContentType: async () => null,
  cachedUrl: async () => null,
  transcodeToJpeg: async () => jpegBytes,
  uploadPublicImage: async (bytes, contentType) => {
    uploads += 1;
    assert.equal(contentType, "image/jpeg");
    assert.equal(sniffImageMime(bytes), "image/jpeg");
    return "https://cdn.example/storage/v1/object/public/room-images/meta-safe/abc.jpg";
  },
};

const passthrough = await prepareMetaImageForSend(jpegUrl, "Deluxe_1.jpg", deps);
assert.equal(passthrough?.url, jpegUrl);
assert.equal(fetches, 0, "JPEG yang sudah aman tidak diunduh");

const converted = await prepareMetaImageForSend(webpUrl, "Deluxe_1.jpg", deps);
assert.equal(converted?.url.endsWith(".jpg"), true);
assert.equal(converted?.filename.endsWith(".jpg"), true);
assert.equal(fetches, 1);
assert.equal(uploads, 1);
assert.equal(/\.webp(\?|#|$)/i.test(converted?.url ?? ""), false);

const siblingDeps: MetaImageDeps = {
  ...deps,
  fetch: async () => {
    throw new Error("tidak boleh mengunduh bila saudara JPEG ada");
  },
  probeContentType: async (url) => (url.endsWith(".jpg") ? "image/jpeg" : null),
  uploadPublicImage: async () => {
    throw new Error("tidak perlu unggah bila saudara JPEG ada");
  },
};
const sibling = await prepareMetaImageForSend(webpUrl, "Deluxe_1.webp", siblingDeps);
assert.equal(sibling?.url, webpUrl.replace(/\.webp$/, ".jpg"));

const failed = await prepareMetaImageForSend(webpUrl, "x.webp", {
  ...deps,
  probeContentType: async () => null,
  transcodeToJpeg: async () => null,
  fetch: async () => new Response(webpBytes, { status: 200 }),
});
assert.equal(failed, null, "WebP yang gagal dikonversi tidak boleh dikirim");

const encodedWebp = Buffer.from(
  "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAgA0JaACdLoB+AADsAD+8MQL/yC5YXXI1/8gP+QH/ID/+PIAAAA=",
  "base64",
);
assert.equal(sniffImageMime(encodedWebp), "image/webp");
const realJpeg = await transcodeWebpToJpeg(encodedWebp);
assert.ok(realJpeg, "WebP galeri harus terkonversi ke JPEG");
assert.equal(sniffImageMime(realJpeg!), "image/jpeg");
assert.equal(
  sniffImageMime((await transcodeWebpToJpeg(jpegBytes)) ?? new Uint8Array()),
  "image/jpeg",
);
assert.equal(await transcodeWebpToJpeg(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), null);

const metaSource = fs.readFileSync("src/services/whatsapp-meta.service.ts", "utf8");
assert.ok(metaSource.includes("prepareMetaImageForSend"));
assert.ok(metaSource.includes("131053"));

// ─── Evolution poll tidak menyentuh tamu Meta ────────────────────────────────

assert.equal(
  evolutionInboxPollDecision({
    LOVABLE_API_KEY: "lov",
    WHATSAPP_API_KEY: "wa",
  }).run,
  false,
);
assert.match(
  evolutionInboxPollDecision({ LOVABLE_API_KEY: "lov", WHATSAPP_API_KEY: "wa" }).reason,
  /Meta/,
);
assert.equal(
  evolutionInboxPollDecision({
    LOVABLE_API_KEY: "lov",
    WHATSAPP_API_KEY: "wa",
    EVOLUTION_INBOX_POLL_ENABLED: "true",
  }).run,
  true,
  "flag eksplisit menghidupkan poll internal",
);
assert.equal(
  evolutionInboxPollDecision({
    LOVABLE_API_KEY: "lov",
    WHATSAPP_API_KEY: "wa",
    WA_PRIMARY_GUEST_CHANNEL: "evolution",
  }).run,
  true,
);
assert.equal(evolutionInboxPollDecision({}).run, true);
assert.equal(evolutionInboxPollDecision({ EVOLUTION_INBOX_POLL_ENABLED: "false" }).run, false);

const pollSource = fs.readFileSync("src/services/evolution-inbox-poll.service.ts", "utf8");
assert.ok(pollSource.includes("evolutionInboxPollDecision"));
assert.ok(!pollSource.includes("delete from"), "kode Evolution tidak dihapus");

console.log(
  "✓ meta guest fast-path: ack waits 3s, photo gate, webp remap, evolution poll gated",
);
