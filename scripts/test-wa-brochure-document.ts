/**
 * Permintaan foto/brosur → brosur PDF dikirim sebagai dokumen WhatsApp (Meta).
 *
 * Tidak memanggil jaringan: `sendGuestWhatsApp` diuji dengan deps palsu dan
 * payload dokumen Meta dicek lewat sumber `whatsapp-meta.service.ts`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BROCHURE_FILENAME,
  brochureLinkFallbackReply,
  isPdfUrl,
  pickBrochure,
  publicStorageUrl,
} from "../src/services/wa-autoreply/brochure-source";
import { planMediaFastPath, type GalleryRoom } from "../src/services/wa-autoreply/media-fast-path";
import { sendGuestWhatsApp, type GuestWhatsAppDeps } from "../src/services/guest-whatsapp.service";
import { BROCHURE_CAPTION } from "../src/services/wa-media-dedup";

const SUPA = "https://proj.supabase.co";
const rooms: GalleryRoom[] = [
  { name: "Deluxe", hero_image_url: "https://cdn.example/deluxe.jpg", images: [] },
  { name: "Family Suite 100", hero_image_url: "https://cdn.example/family.jpg", images: [] },
];
const inbound = (body: string) => [{ direction: "in", body }];

// ─── Deteksi intent (Indonesia + Inggris) ───────────────────────────────────

const brochureAsks = [
  "foto kamar",
  "Apa ada fotonya ka?",
  "ada gambar?",
  "minta gambar kamarnya dong",
  "lihat kamar dong kak",
  "liat kamarnya boleh?",
  "boleh minta brosur?",
  "ada katalog nya?",
  "kirim brosurnya kak",
  "foto2 kamarnya ada?",
  "can I see the room?",
  "do you have photos?",
  "send me pictures of the rooms please",
  "brochure please",
  "contoh kamarnya kak",
  "aku butuh foto family suite 100",
];
for (const text of brochureAsks) {
  const plan = planMediaFastPath(inbound(text), rooms);
  assert.equal(plan?.kind, "brochure", `"${text}" harus dijawab dengan brosur PDF`);
}

const notBrochure = [
  "harga kamar deluxe berapa?",
  "ada kamar kosong tanggal 12?",
  "foto kamar sama harganya berapa",
  "virtual tour dong",
  "boleh lihat kamar langsung ke lokasi?",
  "wifi rusak, kirim foto",
  "terima kasih kak",
];
for (const text of notBrochure) {
  assert.equal(planMediaFastPath(inbound(text), rooms), null, `"${text}" bukan fast-path brosur`);
}

// ─── Sumber brosur ──────────────────────────────────────────────────────────

assert.equal(pickBrochure({ supabaseUrl: "" }), null);
assert.equal(pickBrochure({ supabaseUrl: SUPA, docs: [], storageObjects: [] }), null);

// Kasus produksi 28 Sep 2026: tidak ada baris sop_documents, file ada di bucket.
const fromStorage = pickBrochure({
  supabaseUrl: SUPA,
  docs: [
    { name: "brosur kamar pomah guesthouse.pdf", file_path: "sop/x.pdf", storage_bucket: null },
    { name: "Grand Deluxe", file_path: "room-types/a.jpg", storage_bucket: "room-images" },
  ],
  storageObjects: [
    { name: ".emptyFolderPlaceholder" },
    { name: "old.pdf", created_at: "2026-05-01T00:00:00Z" },
    { name: "5e93bce3.pdf", created_at: "2026-05-27T17:39:15Z", metadata: { mimetype: "application/pdf" } },
    { name: "cover.png", created_at: "2026-06-01T00:00:00Z" },
  ],
});
assert.deepEqual(fromStorage, {
  url: `${SUPA}/storage/v1/object/public/brosur/5e93bce3.pdf`,
  name: BROCHURE_FILENAME,
  source: "storage",
});

const fromDocs = pickBrochure({
  supabaseUrl: SUPA,
  docs: [
    { name: "cover", file_path: "cover.png", storage_bucket: "brosur" },
    { name: "Brosur", file_path: "b.pdf", storage_bucket: "brosur" },
  ],
  storageObjects: [{ name: "other.pdf", created_at: "2026-09-01T00:00:00Z" }],
});
assert.equal(fromDocs?.source, "sop_documents");
assert.equal(fromDocs?.url, `${SUPA}/storage/v1/object/public/brosur/b.pdf`);

const fromEnv = pickBrochure({ supabaseUrl: SUPA, envUrl: "https://cdn.example/brosur.pdf" });
assert.equal(fromEnv?.source, "env");
assert.equal(fromEnv?.name, BROCHURE_FILENAME);
assert.equal(pickBrochure({ supabaseUrl: "", envUrl: "http://insecure/brosur.pdf" }), null);

assert.equal(publicStorageUrl(SUPA + "/", "brosur", "a b.pdf"), `${SUPA}/storage/v1/object/public/brosur/a%20b.pdf`);
assert.equal(BROCHURE_FILENAME, "Brosur Pomah Guesthouse.pdf");
assert.ok(isPdfUrl("https://x/y.pdf?download=1"));
assert.ok(!isPdfUrl("https://x/y.webp"));
const linkReply = brochureLinkFallbackReply(fromStorage!.url);
assert.ok(linkReply.includes(fromStorage!.url), "fallback teks wajib memuat tautan brosur");

// ─── Kirim lewat Meta sebagai dokumen ────────────────────────────────────────

async function main() {
  const calls: Array<{ to: string; message: string; fileUrl?: string; filename?: string }> = [];
  let evolutionCalled = false;
  const deps: GuestWhatsAppDeps = {
    isMetaConfigured: () => true,
    toRecipient: (p) => p.replace(/\D/g, "").replace(/^0/, "62"),
    sendMeta: async (to, message, fileUrl, filename) => {
      calls.push({ to, message, fileUrl, filename });
      return { ok: true, error: null, messageId: "wamid.1" };
    },
    sendTemplate: async () => ({ ok: false, error: "unused" }),
    evolutionReady: () => true,
    sendEvolution: async () => {
      evolutionCalled = true;
      return { ok: true, error: null };
    },
    isReengagement: () => false,
    templateName: () => "",
    templateLang: () => "id",
  };
  const res = await sendGuestWhatsApp(
    "081234567890",
    BROCHURE_CAPTION,
    { evolutionToken: "tok", fileUrl: fromStorage!.url, filename: fromStorage!.name },
    deps,
  );
  assert.equal(res.ok, true);
  assert.equal(res.channel, "meta");
  assert.equal(evolutionCalled, false, "Evolution mati: brosur tidak boleh lewat Evolution");
  assert.deepEqual(calls, [
    {
      to: "6281234567890",
      message: BROCHURE_CAPTION,
      fileUrl: fromStorage!.url,
      filename: BROCHURE_FILENAME,
    },
  ]);

  // Payload Meta untuk .pdf = type "document" + link + filename + caption.
  const metaSource = fs.readFileSync("src/services/whatsapp-meta.service.ts", "utf8");
  assert.ok(metaSource.includes('if (type === "document") media.filename'));
  assert.ok(/return "document";/.test(metaSource));

  // Service: brosur lewat sendGuestWhatsApp, fallback tautan, dan tanpa balasan ganda.
  const svc = fs.readFileSync("src/services/wa-autoreply.service.ts", "utf8");
  assert.ok(svc.includes("sendGuestWhatsApp(phone || target, BROCHURE_CAPTION"));
  assert.ok(svc.includes("brochureLinkFallbackReply(outcome.file.url)"));
  assert.ok(svc.includes("MEDIA_FAST_PATH_BROCHURE_ALREADY_SENT_REPLY"));
  assert.ok(svc.includes("loadRecentOutboundCaptions(phone)"));

  console.log("test-wa-brochure-document: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
