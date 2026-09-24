/**
 * Fast-path foto/brosur, konversi WebP sebelum kirim Meta, anggaran quick-ack
 * di bawah 2 detik sejak worker mengambil antrian, dan gerbang poll Evolution.
 *
 * Tidak mengirim WhatsApp. Latensi ack diukur dari timer dinding-jam
 * `quickAckDelayMs(0)` plus anggaran kirim yang dicadangkan.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  QUICK_ACK_DEADLINE_MS,
  QUICK_ACK_SEND_BUDGET_MS,
  isQuickAckSuppressedMessage,
  quickAckDelayMs,
} from "../src/services/wa-autoreply/runtime-policy";
import {
  MEDIA_FAST_PATH_BROCHURE_REPLY,
  MEDIA_FAST_PATH_PHOTO_REPLY,
  matchGalleryRoom,
  planMediaFastPath,
  roomsForPhotoPlan,
  type GalleryRoom,
} from "../src/services/wa-autoreply/media-fast-path";
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

// ─── Quick-ack di bawah 2 detik sejak pickup ────────────────────────────────

assert.ok(QUICK_ACK_DEADLINE_MS <= 2_000, "deadline ack harus di bawah 2 detik");
assert.equal(quickAckDelayMs(0), QUICK_ACK_DEADLINE_MS - QUICK_ACK_SEND_BUDGET_MS);
assert.ok(
  quickAckDelayMs(0) + QUICK_ACK_SEND_BUDGET_MS <= 2_000,
  "jeda timer + anggaran kirim harus muat dalam 2 detik",
);
assert.equal(quickAckDelayMs(500), 400);
assert.equal(quickAckDelayMs(QUICK_ACK_DEADLINE_MS), 0);
assert.equal(quickAckDelayMs(-10), quickAckDelayMs(0));

const pickup = Date.now();
const delay = quickAckDelayMs(Date.now() - pickup);
await new Promise((resolve) => setTimeout(resolve, delay));
const ackElapsed = Date.now() - pickup;
assert.ok(
  ackElapsed < 2_000,
  `callback ack harus mulai sebelum 2 detik, dapat ${ackElapsed}ms (tanpa panggilan WhatsApp)`,
);

assert.equal(isQuickAckSuppressedMessage("makasih ya kak"), true);
assert.equal(isQuickAckSuppressedMessage("minta foto?"), false);
assert.equal(isQuickAckSuppressedMessage("minta foto dong"), false);

// ─── Gerbang foto / brosur ───────────────────────────────────────────────────

const photo = planMediaFastPath(inbound("minta foto dong"), rooms);
assert.equal(photo?.kind, "room_photos");
if (photo?.kind === "room_photos") {
  assert.equal(photo.roomType, null);
  assert.equal(photo.maxPhotos, 1);
  assert.equal(photo.reply, MEDIA_FAST_PATH_PHOTO_REPLY);
  const selected = roomsForPhotoPlan(rooms, photo);
  assert.deepEqual(
    selected.map((r) => r.name),
    ["Deluxe", "Family Suite", "Junior Suite"],
  );
}

const deluxe = planMediaFastPath(inbound("kirim gambar kamar deluxe"), rooms);
assert.equal(deluxe?.kind, "room_photos");
if (deluxe?.kind === "room_photos") {
  assert.equal(deluxe.roomType, "Deluxe");
  assert.equal(deluxe.maxPhotos, 3);
}

assert.equal(matchGalleryRoom("foto family suite kak", rooms)?.name, "Family Suite");

const brochure = planMediaFastPath(inbound("minta brosur ya"), rooms);
assert.equal(brochure?.kind, "brochure");
assert.equal(
  brochure && brochure.kind === "brochure" ? brochure.reply : "",
  MEDIA_FAST_PATH_BROCHURE_REPLY,
);

const both = planMediaFastPath(inbound("minta pricelist beserta gambar kamarnya"), rooms);
assert.equal(both?.kind, "room_photos");
if (both?.kind === "room_photos") assert.equal(both.alsoBrochure, true);

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
assert.equal(
  planMediaFastPath(inbound("foto suite"), rooms),
  null,
  "suite ambigu tidak boleh menebak",
);
assert.equal(
  planMediaFastPath(inbound("minta foto"), [{ name: "Single", hero_image_url: null, images: [] }]),
  null,
);

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
  `✓ meta guest fast-path: ack timer ${ackElapsed}ms (<2000), photo gate, webp remap, evolution poll gated`,
);
