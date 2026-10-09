/**
 * Media masuk WhatsApp (bukti transfer) dan filter riwayat routing-debug.
 * Meta dan storage dipalsukan. Tidak mengunduh produksi dan tidak menjalankan backfill.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { pipelineIntentAgent } from "../src/ai/router/agent-router";
import { intentHistoryDirections } from "../src/admin/functions/message-direction";
import { getMessageAttachment } from "../src/admin/modules/whatsapp/message-attachment";
import { withSignedWhatsAppMedia } from "../src/services/wa-signed-media";
import {
  PAYMENT_PROOF_ACK_REPLY,
  PAYMENT_PROOF_PLACEHOLDER,
  backfillInboundMediaMessages,
  buildPaymentProofStaffNotice,
  claimPaymentProofStaffNotice,
  classifyMetaMediaLookupFailure,
  inboundStoragePath,
  isPaymentProofCandidate,
  needsInboundMediaBackfill,
  planPaymentProofGuestReply,
  processInboundMedia,
  replyClaimsProofMissing,
  type InboundMediaDeps,
  type InboundMediaJobInput,
  type PaymentProofStaffNotice,
} from "../src/services/wa-inbound-media";

const PHONE = "6281234567890";
const THREAD = "11111111-1111-4111-8111-111111111111";
const AT = new Date("2026-10-09T02:00:00.000Z");
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

function emptyOcr(nominal: number | null = null) {
  return {
    bank_pengirim: nominal ? "BCA" : null,
    bank_tujuan: null,
    nominal,
    biaya_admin: null,
    total_dibayar: null,
    tanggal: null,
    nama_pengirim: null,
    nomor_referensi: nominal ? "REF1" : null,
    raw_text: nominal ? "transfer berhasil" : "foto kucing",
  };
}

function proofResult(nominal: number | null, ok = true) {
  return {
    ok,
    ocr: emptyOcr(nominal),
    match: { status: "no_pending_booking" as const, booking_code: null, booking_amount: null, amount_diff: null },
    ...(ok ? {} : { error: "vision down" }),
  };
}

function harness(options?: {
  download?: InboundMediaDeps["download"];
  upload?: InboundMediaDeps["upload"];
  analyze?: InboundMediaDeps["analyze"];
  awaiting?: boolean;
  bookingRef?: string | null;
}) {
  const meta = new Map<string, Record<string, unknown>>();
  const notices: PaymentProofStaffNotice[] = [];
  let downloads = 0;
  const deps: InboundMediaDeps = {
    download: async (mediaId) => {
      downloads += 1;
      if (options?.download) return options.download(mediaId);
      return { ok: true, bytes: JPEG, mime: "image/jpeg", size: JPEG.byteLength };
    },
    upload: async (path, bytes, mime) => {
      if (options?.upload) return options.upload(path, bytes, mime);
      return { ok: true };
    },
    readMetadata: async (id) => meta.get(id) ?? null,
    saveMetadata: async (id, patch) => {
      meta.set(id, { ...(meta.get(id) ?? {}), ...patch });
    },
    analyze: options?.analyze ?? (async () => proofResult(250000)),
    loadPaymentContext: async () => ({
      awaiting: options?.awaiting === true,
      bookingRef: options?.bookingRef ?? null,
      guestName: "Sari",
    }),
    claimNotice: async (notice) => {
      if (notices.some((row) => row.messageId === notice.messageId)) return "duplicate";
      notices.push(notice);
      return "sent";
    },
  };
  return {
    deps,
    meta,
    notices,
    downloads: () => downloads,
  };
}

function imageInput(over: Partial<InboundMediaJobInput> = {}): InboundMediaJobInput {
  return {
    phone: PHONE,
    guestName: "Sari",
    messageId: "msg-img",
    threadId: THREAD,
    at: AT,
    media: {
      mediaId: "meta-img",
      mediaType: "image",
      mimeType: "image/jpeg",
      fileName: null,
    },
    ...over,
  };
}

function storageClient(failBucket = false) {
  const calls: Array<{ bucket: string; paths: string[] }> = [];
  return {
    calls,
    from(bucket: string) {
      return {
        async createSignedUrls(paths: string[]) {
          calls.push({ bucket, paths });
          if (failBucket) return { data: null, error: { message: "Bucket not found" } };
          return {
            data: paths.map((path) => ({
              path,
              signedUrl: `https://signed.example/${bucket}/${path}?token=short`,
              error: null,
            })),
            error: null,
          };
        },
      };
    },
  };
}

// ─── 1. Gambar masuk tersimpan, admin memakai signed URL ─────────────────────

{
  const h = harness();
  const result = await processInboundMedia(imageInput(), h.deps);
  assert.equal(result.mediaDownloadStatus, "stored");
  assert.equal(result.storagePath, inboundStoragePath({
    phone: PHONE,
    messageId: "msg-img",
    mimeType: "image/jpeg",
    at: AT,
  }));
  assert.match(result.storagePath ?? "", /^6281234567890\/2026-10\/msg-img\.jpg$/);
  assert.equal(result.mediaSize, JPEG.byteLength);
  assert.equal(h.meta.get("msg-img")?.storage_bucket, "wa-inbound");
  assert.equal(h.downloads(), 1, "unduh sekali, OCR memakai byte yang sama");
  assert.equal(result.ocrAttempted, true);
  assert.equal(result.ocrStatus, "ok");
  assert.equal(result.notified, true);

  const stored = {
    id: "msg-img",
    body: "ini buktinya",
    metadata: {
      ...h.meta.get("msg-img"),
      media_url: "https://cdn.expired.example/old.jpg",
      file_name: "bukti.jpg",
    },
  };
  const client = storageClient();
  const [signed] = await withSignedWhatsAppMedia([stored], client);
  const attachment = getMessageAttachment(signed);
  assert.equal(attachment?.kind, "image");
  assert.match(attachment?.url ?? "", /^https:\/\/signed\.example\/wa-inbound\//);
  assert.equal(client.calls[0]?.bucket, "wa-inbound");
  assert.equal(stored.body, "ini buktinya", "caption tetap ada");
}

// ─── 2. JPG dikirim sebagai dokumen: tersimpan dan OCR dicoba ────────────────

{
  let seenUri = "";
  const h = harness({
    analyze: async (uri) => {
      seenUri = uri;
      return proofResult(100000);
    },
  });
  const result = await processInboundMedia(
    imageInput({
      messageId: "msg-doc",
      media: {
        mediaId: "meta-doc",
        mediaType: "document",
        mimeType: "image/jpeg",
        fileName: "bukti.jpg",
      },
    }),
    h.deps,
  );
  assert.equal(isPaymentProofCandidate({ mediaType: "document", mimeType: "image/jpeg" }), true);
  assert.equal(result.mediaDownloadStatus, "stored");
  assert.match(result.storagePath ?? "", /bukti\.jpg$|msg-doc\.jpg$/);
  assert.equal(result.ocrAttempted, true);
  assert.match(seenUri, /^data:image\/jpeg;base64,/);
  assert.equal(h.downloads(), 1);
  assert.equal(h.meta.get("msg-doc")?.file_name, "bukti.jpg");

  const [signed] = await withSignedWhatsAppMedia(
    [{ metadata: h.meta.get("msg-doc") }],
    storageClient(),
  );
  const attachment = getMessageAttachment(signed);
  assert.equal(attachment?.kind, "image");
  assert.equal(attachment?.name, "bukti.jpg");
}

// ─── 3. Meta kedaluwarsa: status gagal, placeholder tetap, tidak melempar ───

{
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const h = harness({
      download: async () => ({ ok: false, reason: "expired" }),
    });
    const body = PAYMENT_PROOF_PLACEHOLDER;
    const result = await processInboundMedia(imageInput({ messageId: "msg-exp" }), h.deps);
    assert.equal(result.mediaDownloadStatus, "failed:expired");
    assert.equal(result.storagePath, null);
    assert.equal(result.ocrStatus, "skipped");
    assert.equal(result.ocrAttempted, false);
    const message = { body, metadata: h.meta.get("msg-exp") };
    assert.equal(message.body, PAYMENT_PROOF_PLACEHOLDER);
    assert.equal(getMessageAttachment(message), null);
    assert.ok(warnings.some((line) => /placeholder tetap ditampilkan/i.test(line)));
  } finally {
    console.warn = warn;
  }
  assert.equal(classifyMetaMediaLookupFailure(404, "media not found"), "expired");
}

// ─── Bucket belum ada: log, tidak melempar, placeholder tetap ───────────────

{
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const h = harness({
      upload: async () => ({ ok: false, reason: "bucket_missing" }),
      analyze: async () => proofResult(null),
      awaiting: false,
    });
    const result = await processInboundMedia(imageInput({ messageId: "msg-bucket" }), h.deps);
    assert.equal(result.mediaDownloadStatus, "failed:bucket_missing");
    assert.equal(result.storagePath, null);
    const [unchanged] = await withSignedWhatsAppMedia(
      [{ body: PAYMENT_PROOF_PLACEHOLDER, metadata: h.meta.get("msg-bucket") }],
      storageClient(true),
    );
    assert.equal(getMessageAttachment(unchanged), null);
    assert.equal((unchanged as { body: string }).body, PAYMENT_PROOF_PLACEHOLDER);
    assert.ok(warnings.some((line) => /wa-inbound/.test(line) && /placeholder tetap ditampilkan/i.test(line)));
  } finally {
    console.warn = warn;
  }
}

// ─── 4. OCR gagal, gambar tetap kelihatan ────────────────────────────────────

{
  const h = harness({
    analyze: async () => {
      throw new Error("vision timeout");
    },
  });
  const result = await processInboundMedia(imageInput({ messageId: "msg-ocr" }), h.deps);
  assert.equal(result.ocrStatus, "failed");
  assert.match(result.ocrReason ?? "", /vision timeout/);
  assert.equal(result.mediaDownloadStatus, "stored");
  assert.ok(result.storagePath);
  const [signed] = await withSignedWhatsAppMedia([{ metadata: h.meta.get("msg-ocr") }], storageClient());
  const attachment = getMessageAttachment(signed);
  assert.equal(attachment?.kind, "image");
  assert.match(attachment?.url ?? "", /signed\.example/);
  assert.equal(h.meta.get("msg-ocr")?.ocr_status, "failed");
}

// ─── 5. Tepat satu notifikasi payment_proof ──────────────────────────────────

{
  const h = harness();
  const input = imageInput({ messageId: "msg-once" });
  const first = await processInboundMedia(input, h.deps);
  const second = await processInboundMedia(input, h.deps);
  assert.equal(first.notified, true);
  assert.equal(second.notified, true, "redelivery menganggap sudah dinotifikasi");
  assert.equal(h.notices.length, 1);
  assert.equal(h.downloads(), 1, "redelivery tidak mengunduh ulang");
  assert.match(h.notices[0].message, new RegExp(PHONE));
  assert.match(h.notices[0].message, /Sari/);
  assert.match(h.notices[0].url, new RegExp(THREAD));

  const logs: Array<Record<string, unknown>> = [];
  const pushes: unknown[] = [];
  let fanOuts = 0;
  const db = {
    from(table: string) {
      assert.equal(table, "notification_logs");
      return {
        select() {
          return {
            eq(col: string, val: unknown) {
              return {
                async maybeSingle() {
                  const row = logs.find((item) => item[col] === val);
                  return { data: row ? { id: row.id } : null, error: null };
                },
              };
            },
          };
        },
        async insert(row: Record<string, unknown>) {
          if (logs.some((item) => item.dedupe_key === row.dedupe_key)) {
            return { error: { message: "duplicate key value violates unique constraint" } };
          }
          logs.push({ ...row, id: `log-${logs.length + 1}` });
          return { error: null };
        },
      };
    },
    async rpc(fn: string, args: unknown) {
      assert.equal(fn, "enqueue_staff_push");
      pushes.push(args);
      return { error: null };
    },
  };
  const notice = buildPaymentProofStaffNotice({
    phone: PHONE,
    guestName: "Sari",
    bookingRef: "PMH-1",
    threadId: THREAD,
    messageId: "msg-log",
  });
  assert.equal(await claimPaymentProofStaffNotice(db, notice, async () => {
    fanOuts += 1;
  }), "sent");
  assert.equal(await claimPaymentProofStaffNotice(db, notice, async () => {
    fanOuts += 1;
  }), "duplicate");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event_type, "payment_proof");
  assert.match(String(logs[0].message), /PMH-1/);
  assert.match(String(logs[0].message), new RegExp(PHONE));
  assert.equal(pushes.length, 1);
  assert.equal(fanOuts, 1);

  const pending = harness({ analyze: async () => proofResult(null), awaiting: true, bookingRef: "PMH-PENDING" });
  const pendingResult = await processInboundMedia(imageInput({ messageId: "msg-pending" }), pending.deps);
  assert.equal(pendingResult.notified, true);
  assert.equal(pending.notices.length, 1);
  assert.equal(pending.notices[0].bookingRef, "PMH-PENDING");
  await processInboundMedia(imageInput({ messageId: "msg-pending" }), pending.deps);
  assert.equal(pending.notices.length, 1);

  const neither = harness({ analyze: async () => proofResult(null), awaiting: false });
  const quiet = await processInboundMedia(imageInput({ messageId: "msg-cat" }), neither.deps);
  assert.equal(quiet.notified, false);
  assert.equal(neither.notices.length, 0);
}

// ─── 6. Balasan bot pada turn gambar tidak menuduh bukti hilang ──────────────

{
  const reply = planPaymentProofGuestReply({
    body: PAYMENT_PROOF_PLACEHOLDER,
    mediaType: "image",
    mimeType: "image/jpeg",
    staffSilenceActive: false,
  });
  assert.equal(reply, PAYMENT_PROOF_ACK_REPLY);
  assert.equal(replyClaimsProofMissing(reply ?? ""), false);
  assert.match(reply ?? "", /sudah kami terima/);

  const docReply = planPaymentProofGuestReply({
    body: "bukti.jpg",
    mediaType: "document",
    mimeType: "image/jpeg",
  });
  assert.equal(docReply, PAYMENT_PROOF_ACK_REPLY);
  assert.equal(replyClaimsProofMissing(docReply ?? ""), false);

  assert.equal(
    planPaymentProofGuestReply({
      body: PAYMENT_PROOF_PLACEHOLDER,
      mediaType: "image",
      staffSilenceActive: true,
    }),
    null,
  );
  assert.equal(planPaymentProofGuestReply({ body: "halo kak", mediaType: "text" }), null);
  assert.equal(isPaymentProofCandidate({ mediaType: "sticker", mimeType: "image/webp" }), false);

  const autoreply = fs.readFileSync("src/services/wa-autoreply.service.ts", "utf8");
  const silenceAt = autoreply.indexOf("Staff replied recently");
  const ackAt = autoreply.indexOf("staffSilenceActive: false");
  assert.ok(silenceAt >= 0 && ackAt > silenceAt, "diam staf dicek sebelum balasan bukti transfer");
}

// ─── 7. Riwayat routing-debug memakai in/out, intent pipeline terpetakan ─────

{
  assert.deepEqual(intentHistoryDirections(), { outbound: "out", inbound: "in" });
  const src = fs.readFileSync("src/admin/functions/routing-debug.functions.ts", "utf8");
  assert.match(src, /intentHistoryDirections\(\)/);
  assert.match(src, /directions\.outbound/);
  assert.match(src, /directions\.inbound/);
  assert.equal(src.includes('"outbound"'), false);
  assert.equal(src.includes('"inbound"'), false);

  assert.equal(pipelineIntentAgent("deterministic_availability")?.agent, "front-office");
  assert.equal(pipelineIntentAgent("deterministic_made_up")?.agent, "front-office");
  assert.equal(pipelineIntentAgent("policy_question")?.agent, "front-office");
  assert.equal(pipelineIntentAgent("invoice_send")?.agent, "finance");
  assert.equal(pipelineIntentAgent("bebas_teks_llm"), null);

  const page = fs.readFileSync("src/admin/modules/routing/routing-debug-page.tsx", "utf8");
  assert.match(page, /pipelineIntentAgent/);
}

// ─── PDF dokumen adalah kandidat; audio bukan ────────────────────────────────

{
  assert.equal(isPaymentProofCandidate({ mediaType: "document", mimeType: "application/pdf" }), true);
  const h = harness({
    analyze: async () => proofResult(null),
    download: async () => ({ ok: true, bytes: JPEG, mime: "application/pdf", size: JPEG.byteLength }),
  });
  const result = await processInboundMedia(
    imageInput({
      messageId: "msg-pdf",
      media: { mediaId: "meta-pdf", mediaType: "document", mimeType: "application/pdf", fileName: "bukti.pdf" },
    }),
    h.deps,
  );
  assert.equal(result.ocrAttempted, true);
  const [signed] = await withSignedWhatsAppMedia([{ metadata: h.meta.get("msg-pdf") }], storageClient());
  const attachment = getMessageAttachment(signed);
  assert.equal(attachment?.kind, "file");
  assert.equal(attachment?.name, "bukti.pdf");
}

// ─── Backfill menghitung sukses/kedaluwarsa dan skrip tidak jalan di CI ─────

{
  const now = new Date("2026-10-09T00:00:00.000Z");
  assert.equal(
    needsInboundMediaBackfill(
      { sentAt: "2026-10-08T00:00:00.000Z", metadata: { meta_media_id: "m1" } },
      now,
      14,
    ),
    true,
  );
  assert.equal(
    needsInboundMediaBackfill(
      { sentAt: "2026-10-08T00:00:00.000Z", metadata: { meta_media_id: "m1", storage_path: "a/b.jpg" } },
      now,
      14,
    ),
    false,
  );
  assert.equal(
    needsInboundMediaBackfill(
      { sentAt: "2026-08-01T00:00:00.000Z", metadata: { meta_media_id: "m1" } },
      now,
      14,
    ),
    false,
  );

  const report = await backfillInboundMediaMessages(
    [
      { id: "a", sentAt: now.toISOString(), metadata: { meta_media_id: "1" } },
      { id: "b", sentAt: now.toISOString(), metadata: { meta_media_id: "2" } },
      { id: "c", sentAt: now.toISOString(), metadata: { meta_media_id: "3" } },
    ],
    async (row) => {
      if (row.id === "a") return { mediaDownloadStatus: "stored" };
      if (row.id === "b") return { mediaDownloadStatus: "failed:expired" };
      return { mediaDownloadStatus: "failed:lookup_500" };
    },
  );
  assert.deepEqual(report, { scanned: 3, stored: 1, expired: 1, failed: 1 });

  const script = fs.readFileSync("scripts/backfill-wa-inbound-media.ts", "utf8");
  assert.match(script, /process\.env\.CI/);
  assert.match(script, /--apply/);
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  const joined = Object.values(pkg.scripts).join("\n");
  assert.equal(joined.includes("backfill-wa-inbound-media"), false);
  const migration = fs.readFileSync("supabase/migrations/20261009121500_wa_inbound_bucket.sql", "utf8");
  assert.match(migration, /where not exists/);
  assert.match(migration, /'wa-inbound'/);
  assert.match(migration, /16777216/);
  assert.match(migration, /public = false|false,/);
  assert.match(migration, /wa-inbound staff select/);
  assert.match(migration, /APPLY MANUALLY/);
}

console.log("test-wa-inbound-media: OK");
