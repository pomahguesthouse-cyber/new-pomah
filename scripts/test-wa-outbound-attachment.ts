/**
 * Validasi input lampiran admin WhatsApp dan pemilihan tipe media.
 * Tidak memanggil jaringan.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { isMetaReengagementError } from "../src/services/guest-whatsapp.service";
import { guessMediaType } from "../src/services/whatsapp-meta.service";
import {
  META_CUSTOMER_WINDOW_MS,
  META_WINDOW_CLOSED_MESSAGE,
  WA_FILE_EMPTY_MESSAGE,
  WA_FILE_TOO_BIG_MESSAGE,
  WA_FILE_TYPE_MESSAGE,
  WA_IMAGE_INLINE_MAX_BYTES,
  WA_OUTBOUND_MAX_BYTES,
  WA_PATH_INVALID_MESSAGE,
  WA_ATTACHMENT_REQUIRED_MESSAGE,
  adminSendFailureMessage,
  attachmentPathForThread,
  fileNameForMime,
  lastInboundAt,
  metaCustomerWindowClosed,
  parseAdminSendInput,
  sanitizeFilename,
  selectOutboundMediaType,
  threadPreview,
  validateClientPick,
} from "../src/services/wa-outbound-attachment";

const threadId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";
const path = `${threadId}/${fileId}-foto.jpg`;

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    path,
    name: "foto.jpg",
    mime: "image/jpeg",
    size: 1200,
    ...overrides,
  };
}

// ─── Input sendMessage ───────────────────────────────────────────────────────

const textOnly = parseAdminSendInput({ threadId, body: "  Halo tamu  " });
assert.equal(textOnly.body, "Halo tamu");
assert.equal(textOnly.attachment, undefined);

const captionless = parseAdminSendInput({ threadId, body: "   ", attachment: attachment() });
assert.equal(captionless.body, "");
assert.equal(captionless.attachment?.path, path);

assert.throws(
  () => parseAdminSendInput({ threadId, body: "   " }),
  (error: Error) => error.message === WA_ATTACHMENT_REQUIRED_MESSAGE,
);
assert.throws(
  () => parseAdminSendInput({ threadId, body: "x".repeat(4001) }),
  (error: Error) => /4000|too big|terlalu/i.test(error.message) || error.message.length > 0,
);
assert.throws(
  () => parseAdminSendInput({ threadId, body: "", attachment: attachment({ mime: "image/webp" }) }),
  (error: Error) => error.message === WA_FILE_TYPE_MESSAGE,
);
assert.throws(
  () =>
    parseAdminSendInput({
      threadId,
      body: "",
      attachment: attachment({ size: WA_OUTBOUND_MAX_BYTES + 1 }),
    }),
  (error: Error) => error.message === WA_FILE_TOO_BIG_MESSAGE,
);
assert.throws(
  () => parseAdminSendInput({ threadId, body: "", attachment: attachment({ size: 1.5 }) }),
  (error: Error) => error.message.length > 0,
);
assert.throws(
  () =>
    parseAdminSendInput({
      threadId,
      body: "ok",
      attachment: attachment({ path: `${threadId}/../rahasia.pdf` }),
    }),
  (error: Error) => error.message === WA_PATH_INVALID_MESSAGE,
);
assert.throws(
  () =>
    parseAdminSendInput({
      threadId,
      body: "ok",
      attachment: attachment({
        path: `33333333-3333-4333-8333-333333333333/${fileId}-foto.jpg`,
      }),
    }),
  (error: Error) => error.message === WA_PATH_INVALID_MESSAGE,
);

assert.equal(attachmentPathForThread(path, threadId), true);
assert.equal(attachmentPathForThread(`${threadId}/${fileId}-a/b.jpg`, threadId), false);

// ─── Pilihan berkas di browser ───────────────────────────────────────────────

assert.deepEqual(validateClientPick({ name: "a.jpg", type: "", size: 10 }), {
  ok: true,
  mime: "image/jpeg",
});
assert.deepEqual(validateClientPick({ name: "scan.heic", type: "", size: 10 }), {
  ok: true,
  mime: "image/heic",
});
assert.equal(
  validateClientPick({ name: "x.exe", type: "application/octet-stream", size: 10 }).ok,
  false,
);
assert.equal(
  (validateClientPick({ name: "x.exe", type: "application/octet-stream", size: 10 }) as { error: string })
    .error,
  WA_FILE_TYPE_MESSAGE,
);
assert.equal(validateClientPick({ name: "a.pdf", type: "application/pdf", size: 0 }).ok, false);
assert.equal(
  (validateClientPick({ name: "a.pdf", type: "application/pdf", size: 0 }) as { error: string }).error,
  WA_FILE_EMPTY_MESSAGE,
);
assert.equal(
  (validateClientPick({ name: "a.pdf", type: "application/pdf", size: WA_OUTBOUND_MAX_BYTES + 1 }) as {
    error: string;
  }).error,
  WA_FILE_TOO_BIG_MESSAGE,
);
assert.equal(validateClientPick({ name: "nota.docx", type: "", size: 20 }).ok, true);

// ─── Nama berkas mempertahankan ekstensi ─────────────────────────────────────

assert.equal(fileNameForMime("Foto Kamar.HEIC", "image/jpeg"), "Foto_Kamar.jpg");
assert.equal(fileNameForMime("laporan akhir.pdf", "application/pdf"), "laporan_akhir.pdf");
assert.equal(
  fileNameForMime("harga.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  "harga.xlsx",
);
assert.equal(sanitizeFilename("../rahasia .pdf"), "rahasia_.pdf");

// ─── Tipe media: ekstensi, dan gambar > 5MB menjadi dokumen ─────────────────

assert.equal(guessMediaType("https://cdn.example/a.jpg?token=1", "a.jpg"), "image");
assert.equal(guessMediaType("https://cdn.example/a.jpeg", "a.jpeg"), "image");
assert.equal(guessMediaType("https://cdn.example/a.png", "foto.png"), "image");
assert.equal(guessMediaType("https://cdn.example/a.pdf?download=1", "Brosur.pdf"), "document");
assert.equal(guessMediaType("https://cdn.example/a.docx", "harga.docx"), "document");

assert.equal(
  selectOutboundMediaType({ mime: "image/jpeg", size: WA_IMAGE_INLINE_MAX_BYTES, name: "a.jpg" }),
  "image",
);
assert.equal(
  selectOutboundMediaType({
    mime: "image/jpeg",
    size: WA_IMAGE_INLINE_MAX_BYTES + 1,
    name: "a.jpg",
  }),
  "document",
);
assert.equal(
  selectOutboundMediaType({ mime: "image/png", size: 2048, name: "scan.png" }),
  "image",
);
assert.equal(
  selectOutboundMediaType({ mime: "application/pdf", size: 2048, name: "brosur.pdf" }),
  "document",
);
assert.equal(
  selectOutboundMediaType({ mime: "text/plain", size: 20, name: "catatan.txt" }),
  "document",
);
assert.equal(WA_IMAGE_INLINE_MAX_BYTES, 5 * 1024 * 1024);

assert.equal(threadPreview("Halo", "foto.jpg"), "Halo");
assert.equal(threadPreview("   ", "foto kamar.jpg"), "📎 foto kamar.jpg");
assert.equal(threadPreview("x".repeat(200), null).length, 120);

// ─── Jendela 24 jam + pesan gagal ────────────────────────────────────────────

const now = Date.parse("2026-09-30T12:00:00.000Z");
assert.equal(metaCustomerWindowClosed(null, now), true);
assert.equal(
  metaCustomerWindowClosed(new Date(now - META_CUSTOMER_WINDOW_MS + 1000).toISOString(), now),
  false,
);
assert.equal(
  metaCustomerWindowClosed(new Date(now - META_CUSTOMER_WINDOW_MS).toISOString(), now),
  true,
);
assert.equal(
  lastInboundAt([
    { direction: "out", sent_at: "2026-09-30T11:00:00.000Z" },
    { direction: "in", sent_at: "2026-09-30T08:00:00.000Z" },
    { direction: "in", sent_at: "2026-09-30T10:00:00.000Z" },
  ]),
  "2026-09-30T10:00:00.000Z",
);

const reengagement = { raw: { error: { code: 131047 } }, error: "HTTP 400" };
assert.equal(isMetaReengagementError(reengagement), true);
assert.equal(
  adminSendFailureMessage(isMetaReengagementError(reengagement), reengagement.error),
  META_WINDOW_CLOSED_MESSAGE,
);
assert.equal(adminSendFailureMessage(false, "gateway down"), "gateway down");
assert.equal(adminSendFailureMessage(false, "  "), "Pesan gagal dikirim.");

// ─── Server tidak menandai gagal sebagai terkirim, dan menandatangani URL ───

const fnSrc = fs.readFileSync("src/admin/functions/whatsapp.functions.ts", "utf8");
assert.match(fnSrc, /sendResult\.messageId/);
assert.doesNotMatch(fnSrc, /raw\?\.id/);
// Satu lampiran keluar memakai createSignedUrl. Penandatanganan batch inbox
// (createSignedUrls) ada di wa-signed-media, dipanggil lewat withOutboundMediaUrls.
assert.match(fnSrc, /createSignedUrl\(/);
assert.match(fnSrc, /withSignedWhatsAppMedia|withOutboundMediaUrls/);
const signedSrc = fs.readFileSync("src/services/wa-signed-media.ts", "utf8");
assert.match(signedSrc, /createSignedUrls/);
assert.match(fnSrc, /isMetaReengagementError/);
assert.match(fnSrc, /send_status: sendStatus/);
assert.match(fnSrc, /META_WINDOW_CLOSED_MESSAGE|adminSendFailureMessage/);
assert.match(fnSrc, /storage_path/);

const migration = fs.readFileSync(
  "supabase/migrations/20260930120000_wa_outbound_bucket.sql",
  "utf8",
);
assert.match(migration, /'wa-outbound'/);
assert.match(migration, /26214400/);
assert.match(migration, /image\/jpeg/);
assert.match(migration, /image\/png/);
assert.match(migration, /application\/pdf/);
assert.match(migration, /text\/plain/);
assert.match(migration, /wordprocessingml/);
assert.match(migration, /spreadsheetml/);
assert.match(migration, /presentationml/);
assert.match(migration, /wa-outbound staff insert/);
assert.match(migration, /wa-outbound staff select/);
assert.match(migration, /wa-outbound staff delete/);
assert.match(migration, /public\.is_staff\(auth\.uid\(\)\)/);
assert.match(migration, /on conflict \(id\) do update/i);

const metaSrc = fs.readFileSync("src/services/whatsapp-meta.service.ts", "utf8");
assert.match(metaSrc, /const type = mediaType \?\? guessMediaType\(link, name\)/);
assert.match(metaSrc, /if \(type === "document"\) media\.filename/);

console.log("test-wa-outbound-attachment: OK");
