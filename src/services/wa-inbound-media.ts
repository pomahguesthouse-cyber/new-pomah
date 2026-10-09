/**
 * Media masuk WhatsApp Business (Meta): unduh sekali, simpan di bucket
 * privat `wa-inbound`, lalu OCR bukti transfer memakai byte yang sama.
 *
 * Bucket belum ada (migrasi belum dijalankan manual) bukan kegagalan fatal:
 * status dicatat, placeholder pesan tetap tampil, webhook tidak melempar.
 */
import { saveMessageMetadata } from "@/repositories/message.repository";
import type { PaymentProofResult } from "@/services/payment-proof.service";

export const WA_INBOUND_BUCKET = "wa-inbound";
/** Selaras dengan file_size_limit di migrasi bucket. */
export const WA_INBOUND_MAX_BYTES = 16 * 1024 * 1024;

export const PAYMENT_PROOF_PLACEHOLDER = "[Tamu mengirim lampiran bukti transfer pembayaran]";

export const PAYMENT_PROOF_ACK_REPLY =
  "Terima kasih Kak, bukti transfernya sudah kami terima dan sedang kami cek. Kami kabari setelah terverifikasi ya 🙏";

/** Notifikasi staf + balasan tamu hanya untuk media yang baru masuk. */
export const PAYMENT_PROOF_FRESH_MS = 15 * 60 * 1000;

export const INBOUND_MEDIA_SWEEP_DAYS = 30;
export const INBOUND_MEDIA_SWEEP_BATCH = 5;
export const INBOUND_MEDIA_MAX_ATTEMPTS = 3;
/** Sisakan waktu di bawah timeout pg_net 30s pada cron safety-net. */
export const INBOUND_MEDIA_SWEEP_DEADLINE_MS = 22_000;

const MISSING_PROOF_CLAIM =
  /bukti[\s\S]{0,48}(belum|tidak|gagal)[\s\S]{0,48}(terdeteksi|terbaca)/i;

const THREAD_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/opus": "opus",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "text/plain": "txt",
};

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/opus",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  txt: "text/plain",
};

export interface InboundMediaRef {
  mediaId: string;
  mediaType: string | null;
  mimeType: string | null;
  fileName: string | null;
}

export interface MetaMediaFetchOk {
  ok: true;
  bytes: Uint8Array;
  mime: string;
  size: number;
}

export interface MetaMediaFetchErr {
  ok: false;
  reason: string;
}

export type MetaMediaFetchResult = MetaMediaFetchOk | MetaMediaFetchErr;

export function canonicalMime(mime: string | null | undefined): string {
  const raw = String(mime ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!raw) return "";
  if (raw === "image/jpg" || raw === "image/pjpeg") return "image/jpeg";
  if (raw === "application/x-pdf") return "application/pdf";
  return raw;
}

export function extensionForMedia(mime: string | null | undefined, fileName?: string | null): string {
  const canon = canonicalMime(mime);
  if (canon && MIME_EXT[canon]) return MIME_EXT[canon];
  const fromName = String(fileName ?? "")
    .split("?")[0]
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (fromName && fromName.length <= 5 && EXT_MIME[fromName]) return fromName === "jpeg" ? "jpg" : fromName;
  if (canon.startsWith("image/")) return "jpg";
  if (canon.startsWith("audio/")) return "ogg";
  if (canon.startsWith("video/")) return "mp4";
  return "bin";
}

function safePathSegment(value: string, max = 160): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "file").slice(0, max);
}

export function phoneFolder(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.slice(0, 16) || "unknown";
}

/** Folder bulan WIB: `yyyy-mm`. */
export function inboundMonthFolder(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).format(at);
  return parts.slice(0, 7);
}

/** `wa-inbound/<phone>/<yyyy-mm>/<message_id>.<ext>` (path di dalam bucket, tanpa nama bucket). */
export function inboundStoragePath(input: {
  phone: string;
  messageId: string;
  mimeType?: string | null;
  fileName?: string | null;
  at?: Date;
}): string {
  const ext = extensionForMedia(input.mimeType, input.fileName);
  const id = safePathSegment(input.messageId);
  const month = inboundMonthFolder(input.at ?? new Date());
  return `${phoneFolder(input.phone)}/${month}/${id}.${ext}`;
}

export function mediaDownloadStatus(ok: boolean, reason?: string | null): string {
  if (ok) return "stored";
  const clean = String(reason ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `failed:${clean || "unknown"}`;
}

export function uploadFailureReason(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("bucket") && (m.includes("not found") || m.includes("does not exist") || m.includes("tidak"))) {
    return "bucket_missing";
  }
  if (m.includes("mime") || m.includes("content type") || m.includes("invalid")) return "mime_rejected";
  if (m.includes("size") || m.includes("too large") || m.includes("payload") || m.includes("exceed")) {
    return "too_large";
  }
  return "upload_failed";
}

export function classifyMetaMediaLookupFailure(status: number, body: string): string {
  const text = body.toLowerCase();
  if (status === 404 || status === 410 || /expir|not found|unknown media|does not exist/.test(text)) {
    return "expired";
  }
  return `lookup_${status}`;
}

/**
 * Gambar, atau dokumen yang mime-nya gambar / PDF.
 * Stiker, audio, dan video disimpan tapi bukan kandidat bukti transfer.
 */
export function isPaymentProofCandidate(input: {
  mediaType?: string | null;
  mimeType?: string | null;
  body?: string | null;
  paymentProofCandidate?: boolean | null;
}): boolean {
  if (input.paymentProofCandidate === true) return true;
  const type = String(input.mediaType ?? "").toLowerCase();
  if (type === "sticker" || type === "audio" || type === "video") return false;
  const mime = canonicalMime(input.mimeType);
  if (type === "image" || type === "imagemessage") return true;
  if (type === "document" && (mime.startsWith("image/") || mime === "application/pdf")) return true;
  if (!type && mime.startsWith("image/")) return true;
  if ((input.body ?? "").trim() === PAYMENT_PROOF_PLACEHOLDER) return true;
  return false;
}

/** Vision OCR: gambar, dan PDF (dicoba sebagai data URI). */
export function ocrMimeSupported(mime: string | null | undefined, mediaType?: string | null): boolean {
  const type = String(mediaType ?? "").toLowerCase();
  if (type === "sticker" || type === "audio" || type === "video") return false;
  const canon = canonicalMime(mime);
  if (canon.startsWith("image/")) return true;
  if (canon === "application/pdf") return true;
  if (!canon && (type === "image" || type === "imagemessage")) return true;
  return false;
}

export function ocrLooksLikeTransfer(
  ocr:
    | {
        nominal?: number | null;
        bank_pengirim?: string | null;
        bank_tujuan?: string | null;
        nomor_referensi?: string | null;
        raw_text?: string | null;
      }
    | null
    | undefined,
): boolean {
  if (!ocr) return false;
  if (typeof ocr.nominal === "number" && Number.isFinite(ocr.nominal) && ocr.nominal > 0) return true;
  if (ocr.bank_pengirim || ocr.bank_tujuan || ocr.nomor_referensi) return true;
  return /\b(transfer|berhasil|terkirim|bi-?fast|virtual account|\bva\b|bca|bni|bri|mandiri)\b/i.test(
    ocr.raw_text ?? "",
  );
}

export function shouldNotifyPaymentProof(input: {
  candidate: boolean;
  ocrDetectsTransfer: boolean;
  awaitingPayment: boolean;
}): boolean {
  if (!input.candidate) return false;
  return input.ocrDetectsTransfer || input.awaitingPayment;
}

export function replyClaimsProofMissing(text: string): boolean {
  return MISSING_PROOF_CLAIM.test(text ?? "");
}

/**
 * Balasan tamu saat turn terakhir adalah kandidat bukti transfer.
 * `staffSilenceActive` menahan balasan — staf yang baru membalas tidak ditimpa bot.
 */
/**
 * Media yang `sent_at`-nya masih di dalam jendela (default 15 menit) boleh
 * dinotifikasi. Tanpa `sentAt` dianggap segar (jalur webhook yang baru saja
 * menyimpan pesan). Pemulihan sweeper/backfill selalu mengisi `sentAt`.
 */
export function isFreshPaymentProof(
  sentAt: string | Date | null | undefined,
  now: Date = new Date(),
  windowMs: number = PAYMENT_PROOF_FRESH_MS,
): boolean {
  if (sentAt == null || sentAt === "") return true;
  const sent = sentAt instanceof Date ? sentAt.getTime() : Date.parse(sentAt);
  if (!Number.isFinite(sent)) return true;
  return now.getTime() - sent <= windowMs;
}

export function mediaAttemptCount(metadata: Record<string, unknown> | null | undefined): number {
  const raw = Number(metadata?.media_attempts ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

/**
 * Baris yang boleh diunduh ulang: belum ada status, masih `pending`, atau
 * `failed:*` dengan percobaan di bawah batas. `stored` tidak diulang.
 */
export function inboundMediaStatusEligible(
  metadata: Record<string, unknown> | null | undefined,
  maxAttempts: number = INBOUND_MEDIA_MAX_ATTEMPTS,
): boolean {
  const status = metadata?.media_download_status;
  if (status == null || status === "" || status === "pending") return true;
  if (typeof status === "string" && status.startsWith("failed:")) {
    return mediaAttemptCount(metadata) < maxAttempts;
  }
  return false;
}

export function planPaymentProofGuestReply(input: {
  body?: string | null;
  mediaType?: string | null;
  mimeType?: string | null;
  paymentProofCandidate?: boolean | null;
  staffSilenceActive?: boolean;
  sentAt?: string | Date | null;
  now?: Date;
}): string | null {
  if (input.staffSilenceActive) return null;
  if (!isPaymentProofCandidate(input)) return null;
  if (!isFreshPaymentProof(input.sentAt, input.now)) return null;
  return PAYMENT_PROOF_ACK_REPLY;
}

export function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

export interface PaymentProofStaffNotice {
  messageId: string;
  phone: string;
  guestName: string;
  bookingRef: string | null;
  threadId: string | null;
  relatedId: string | null;
  url: string;
  message: string;
  pushTitle: string;
  pushBody: string;
}

export function buildPaymentProofStaffNotice(input: {
  phone: string;
  guestName?: string | null;
  bookingRef?: string | null;
  threadId?: string | null;
  messageId: string;
}): PaymentProofStaffNotice {
  const guestName = (input.guestName || "").trim() || "Tamu";
  const phone = String(input.phone ?? "").trim();
  const bookingRef = (input.bookingRef || "").trim() || null;
  const threadId = input.threadId && THREAD_UUID_RE.test(input.threadId) ? input.threadId : null;
  const url = threadId ? `/admin/whatsapp?thread=${threadId}` : "/admin/whatsapp";
  const message =
    "💳 BUKTI TRANSFER DITERIMA\n\n" +
    `Tamu: ${guestName}\n` +
    `Telepon: ${phone}\n` +
    `Kode Booking: ${bookingRef ?? "-"}\n` +
    `Chat: ${url}`;
  return {
    messageId: input.messageId,
    phone,
    guestName,
    bookingRef,
    threadId,
    relatedId: threadId,
    url,
    message,
    pushTitle: "Bukti transfer masuk",
    pushBody: `${guestName} · ${phone}${bookingRef ? ` · ${bookingRef}` : ""}`,
  };
}

type NoticeDb = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ error?: { message?: string } | null } | null>;
};

/**
 * Satu baris `notification_logs` (event payment_proof) + push staf bila RPC-nya ada.
 * Pemanggilan kedua untuk message id yang sama tidak menambah baris.
 * `fanOut` opsional memakai notifier yang sudah ada (WhatsApp), juga sekali.
 */
export async function claimPaymentProofStaffNotice(
  db: NoticeDb,
  notice: PaymentProofStaffNotice,
  fanOut?: (notice: PaymentProofStaffNotice) => Promise<void>,
): Promise<"sent" | "duplicate"> {
  const key = `payment_proof:${notice.messageId}:inbound`;
  const { data: existing } = await db
    .from("notification_logs")
    .select("id")
    .eq("dedupe_key", key)
    .maybeSingle();
  if (existing?.id) return "duplicate";

  const inserted = await db.from("notification_logs").insert({
    event_type: "payment_proof",
    recipient_phone: "staff-push",
    recipient_role: "staff",
    message: notice.message,
    status: "sent",
    attempts: 1,
    dedupe_key: key,
    related_id: notice.relatedId,
    channel: "push",
    sent_at: new Date().toISOString(),
  });
  const insertError = inserted?.error as { message?: string } | null | undefined;
  if (insertError) {
    const message = String(insertError.message ?? insertError);
    if (/duplicate|unique|23505/i.test(message)) return "duplicate";
    console.warn("[wa-inbound] notification_logs insert gagal:", message);
  }

  try {
    const push = await db.rpc("enqueue_staff_push", {
      p_payload: {
        kind: "payment_proof",
        title: notice.pushTitle,
        body: notice.pushBody,
        url: notice.url,
        thread_id: notice.threadId,
        message_id: notice.messageId,
      },
    });
    if (push?.error) {
      console.warn(
        "[wa-inbound] enqueue_staff_push gagal (log bukti transfer tetap ada):",
        push.error.message ?? push.error,
      );
    }
  } catch (e) {
    console.warn(
      "[wa-inbound] staff push tidak tersedia. Log bukti transfer tetap ada:",
      e instanceof Error ? e.message : e,
    );
  }

  if (fanOut) {
    try {
      await fanOut(notice);
    } catch (e) {
      console.warn("[wa-inbound] fan-out payment_proof gagal:", e instanceof Error ? e.message : e);
    }
  }
  return "sent";
}

export interface AwaitingPaymentContext {
  awaiting: boolean;
  bookingRef: string | null;
  guestName: string | null;
}

/** Baca saja. Tidak mengubah booking, harga, atau state. */
export async function loadAwaitingPaymentContext(
  admin: { from: (table: string) => any },
  phone: string,
): Promise<AwaitingPaymentContext> {
  let awaiting = false;
  let bookingRef: string | null = null;
  let guestName: string | null = null;

  try {
    const { data: state } = await admin
      .from("wa_booking_states")
      .select("state, context")
      .eq("phone", phone)
      .maybeSingle();
    const ctx = (state?.context ?? {}) as Record<string, unknown>;
    if (state?.state === "PAYMENT_PENDING") {
      awaiting = true;
      const code = ctx.bookingCode ?? ctx.booking_code ?? ctx.reference_code;
      if (typeof code === "string" && code.trim()) bookingRef = code.trim();
    }
  } catch (e) {
    console.warn("[wa-inbound] baca state booking gagal:", e instanceof Error ? e.message : e);
  }

  try {
    const { data: guest } = await admin
      .from("guests")
      .select("id, full_name")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (typeof guest?.full_name === "string" && guest.full_name.trim()) guestName = guest.full_name.trim();
    if (guest?.id) {
      const { data: bookings } = await admin
        .from("bookings")
        .select("reference_code, status, payment_status")
        .eq("guest_id", guest.id)
        .order("created_at", { ascending: false })
        .limit(5);
      for (const booking of (bookings ?? []) as Array<{
        reference_code?: string | null;
        status?: string | null;
        payment_status?: string | null;
      }>) {
        const open = booking.status === "pending" || booking.status === "confirmed";
        const unpaid =
          booking.payment_status == null ||
          booking.payment_status === "unpaid" ||
          booking.payment_status === "partial";
        if (open && unpaid) {
          awaiting = true;
          if (!bookingRef && booking.reference_code) bookingRef = booking.reference_code;
          break;
        }
      }
    }
  } catch (e) {
    console.warn("[wa-inbound] baca booking tamu gagal:", e instanceof Error ? e.message : e);
  }

  return { awaiting, bookingRef, guestName };
}

export interface InboundMediaJobInput {
  phone: string;
  guestName?: string | null;
  messageId: string;
  threadId?: string | null;
  media: InboundMediaRef;
  /** Waktu untuk folder bulan di storage. */
  at?: Date;
  /** `whatsapp_messages.sent_at`. Menentukan notifikasi segar vs pemulihan diam. */
  sentAt?: string | Date | null;
  now?: Date;
}

export interface InboundMediaDeps {
  download: (mediaId: string) => Promise<MetaMediaFetchResult>;
  upload: (
    path: string,
    bytes: Uint8Array,
    mime: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  readMetadata?: (messageId: string) => Promise<Record<string, unknown> | null>;
  saveMetadata: (messageId: string, patch: Record<string, unknown>) => Promise<void>;
  analyze?: (dataUri: string, phone: string, messageId: string) => Promise<PaymentProofResult>;
  loadPaymentContext?: (phone: string) => Promise<AwaitingPaymentContext>;
  claimNotice?: (notice: PaymentProofStaffNotice) => Promise<"sent" | "duplicate">;
}

export interface InboundMediaJobResult {
  storagePath: string | null;
  mediaDownloadStatus: string;
  mediaSize: number | null;
  ocrStatus: "ok" | "failed" | "skipped";
  ocrReason: string | null;
  ocrAttempted: boolean;
  notified: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function processInboundMedia(
  input: InboundMediaJobInput,
  deps: InboundMediaDeps,
): Promise<InboundMediaJobResult> {
  const candidate = isPaymentProofCandidate({
    mediaType: input.media.mediaType,
    mimeType: input.media.mimeType,
  });
  const empty = (patch: Partial<InboundMediaJobResult>): InboundMediaJobResult => ({
    storagePath: null,
    mediaDownloadStatus: "failed:unknown",
    mediaSize: null,
    ocrStatus: "skipped",
    ocrReason: null,
    ocrAttempted: false,
    notified: false,
    ...patch,
  });

  let existing: Record<string, unknown> | null = null;
  try {
    existing = asRecord(await deps.readMetadata?.(input.messageId));
    if (
      existing?.media_download_status === "stored" &&
      typeof existing.storage_path === "string" &&
      existing.storage_path &&
      typeof existing.ocr_status === "string" &&
      (existing.payment_proof_notified === true || existing.payment_proof_notified === false)
    ) {
      return empty({
        storagePath: existing.storage_path,
        mediaDownloadStatus: "stored",
        mediaSize: typeof existing.media_size === "number" ? existing.media_size : null,
        ocrStatus: existing.ocr_status === "ok" || existing.ocr_status === "failed" ? existing.ocr_status : "skipped",
        ocrReason: typeof existing.ocr_reason === "string" ? existing.ocr_reason : null,
        notified: existing.payment_proof_notified === true,
      });
    }

    const fetched = await deps.download(input.media.mediaId);
    if (!fetched.ok) {
      const status = mediaDownloadStatus(false, fetched.reason);
      const ocrReason = fetched.reason || "download_failed";
      await deps.saveMetadata(input.messageId, {
        media_download_status: status,
        media_attempts: mediaAttemptCount(existing) + 1,
        ocr_status: "skipped",
        ocr_reason: ocrReason,
        storage_bucket: WA_INBOUND_BUCKET,
      });
      const notified = await maybeNotify(input, deps, candidate, false, null);
      if (notified || candidate) {
        await deps.saveMetadata(input.messageId, { payment_proof_notified: notified });
      }
      console.warn(
        `[wa-inbound] unduh media gagal (${fetched.reason}). Placeholder tetap ditampilkan.`,
      );
      return empty({
        mediaDownloadStatus: status,
        ocrStatus: "skipped",
        ocrReason,
        notified,
      });
    }

    const mime = canonicalMime(fetched.mime) || canonicalMime(input.media.mimeType) || "application/octet-stream";
    const path = inboundStoragePath({
      phone: input.phone,
      messageId: input.messageId,
      mimeType: mime,
      fileName: input.media.fileName,
      at: input.at,
    });
    const uploaded = await deps.upload(path, fetched.bytes, mime);
    const downloadStatus = uploaded.ok ? "stored" : mediaDownloadStatus(false, uploaded.reason);
    if (!uploaded.ok && uploaded.reason === "bucket_missing") {
      console.warn(
        `[wa-inbound] bucket ${WA_INBOUND_BUCKET} belum ada. Jalankan migrasi secara manual. Placeholder tetap ditampilkan.`,
      );
    } else if (!uploaded.ok) {
      console.warn(
        `[wa-inbound] simpan media gagal (${uploaded.reason}). Placeholder tetap ditampilkan.`,
      );
    }

    await deps.saveMetadata(input.messageId, {
      storage_bucket: WA_INBOUND_BUCKET,
      ...(uploaded.ok ? { storage_path: path, media_size: fetched.size } : {}),
      media_download_status: downloadStatus,
      mime_type: mime,
      ...(input.media.fileName ? { file_name: input.media.fileName } : {}),
    });

    let ocrStatus: "ok" | "failed" | "skipped" = "skipped";
    let ocrReason: string | null = candidate ? null : "not_payment_proof";
    let ocrAttempted = false;
    let transfer = false;
    let ocrResult: PaymentProofResult | null = null;

    if (!candidate) {
      ocrStatus = "skipped";
      ocrReason = "not_payment_proof";
    } else if (!ocrMimeSupported(mime, input.media.mediaType)) {
      ocrStatus = "skipped";
      ocrReason = "mime_unsupported";
    } else if (!deps.analyze) {
      ocrStatus = "skipped";
      ocrReason = "ocr_unavailable";
    } else {
      ocrAttempted = true;
      try {
        ocrResult = await deps.analyze(bytesToDataUri(fetched.bytes, mime), input.phone, input.messageId);
        if (ocrResult.ok) {
          ocrStatus = "ok";
          ocrReason = null;
          transfer = ocrLooksLikeTransfer(ocrResult.ocr);
        } else {
          ocrStatus = "failed";
          ocrReason = (ocrResult.error || "ocr_failed").slice(0, 180);
        }
      } catch (e) {
        ocrStatus = "failed";
        ocrReason = (e instanceof Error ? e.message : String(e)).slice(0, 180);
        console.warn("[wa-inbound] OCR gagal (gambar tetap disimpan bila unggah berhasil):", ocrReason);
      }
    }

    await deps.saveMetadata(input.messageId, {
      ocr_status: ocrStatus,
      ocr_reason: ocrReason,
    });

    const notified = await maybeNotify(input, deps, candidate, transfer, ocrResult);
    await deps.saveMetadata(input.messageId, { payment_proof_notified: notified });

    return {
      storagePath: uploaded.ok ? path : null,
      mediaDownloadStatus: downloadStatus,
      mediaSize: fetched.size,
      ocrStatus,
      ocrReason,
      ocrAttempted,
      notified,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[wa-inbound] media job gagal (pesan tetap tersimpan):", reason);
    try {
      await deps.saveMetadata(input.messageId, {
        media_download_status: mediaDownloadStatus(false, "job_failed"),
        media_attempts: mediaAttemptCount(existing) + 1,
        ocr_status: "failed",
        ocr_reason: reason.slice(0, 180),
      });
    } catch (saveErr) {
      console.warn("[wa-inbound] gagal mencatat status media:", saveErr);
    }
    return empty({
      mediaDownloadStatus: mediaDownloadStatus(false, "job_failed"),
      ocrStatus: "failed",
      ocrReason: reason.slice(0, 180),
    });
  }
}

async function maybeNotify(
  input: InboundMediaJobInput,
  deps: InboundMediaDeps,
  candidate: boolean,
  transfer: boolean,
  _ocr: PaymentProofResult | null,
): Promise<boolean> {
  // Pemulihan sweeper/backfill untuk pesan lama: simpan + OCR, tanpa notifikasi
  // staf dan tanpa balasan tamu. Job ini tidak mengirim pesan ke tamu.
  if (!isFreshPaymentProof(input.sentAt, input.now ?? new Date())) return false;
  let awaiting = false;
  let bookingRef: string | null = null;
  let guestName = input.guestName ?? null;
  if (candidate && deps.loadPaymentContext) {
    try {
      const ctx = await deps.loadPaymentContext(input.phone);
      awaiting = ctx.awaiting;
      bookingRef = ctx.bookingRef;
      guestName = guestName || ctx.guestName;
    } catch (e) {
      console.warn("[wa-inbound] konteks pembayaran gagal:", e instanceof Error ? e.message : e);
    }
  }
  if (!shouldNotifyPaymentProof({ candidate, ocrDetectsTransfer: transfer, awaitingPayment: awaiting })) {
    return false;
  }
  if (!deps.claimNotice) return false;
  const notice = buildPaymentProofStaffNotice({
    phone: input.phone,
    guestName,
    bookingRef,
    threadId: input.threadId,
    messageId: input.messageId,
  });
  const result = await deps.claimNotice(notice);
  return result === "sent" || result === "duplicate";
}

export interface BackfillCandidate {
  id: string;
  sentAt: string;
  metadata: Record<string, unknown> | null;
}

export function needsInboundMediaBackfill(
  row: { sentAt: string; metadata: Record<string, unknown> | null },
  now: Date,
  days: number,
): boolean {
  const meta = row.metadata;
  const mediaId = meta?.meta_media_id;
  if (typeof mediaId !== "string" || !mediaId.trim()) return false;
  if (typeof meta?.storage_path === "string" && meta.storage_path.trim()) return false;
  const sent = Date.parse(row.sentAt);
  if (!Number.isFinite(sent)) return false;
  const windowMs = Math.max(1, days) * 24 * 60 * 60 * 1000;
  return sent >= now.getTime() - windowMs;
}

export interface InboundMediaSweepOptions {
  now?: Date;
  days?: number;
  limit?: number;
  maxAttempts?: number;
}

/**
 * Pilih batch kecil. Urutan input dipertahankan (pemanggil mengirim terbaru
 * dulu supaya bukti yang baru timeout masih sempat dinotifikasi).
 */
export function selectInboundMediaSweep<T extends { sentAt: string; metadata: Record<string, unknown> | null }>(
  rows: T[],
  now: Date,
  options?: InboundMediaSweepOptions,
): T[] {
  const days = options?.days ?? INBOUND_MEDIA_SWEEP_DAYS;
  const limit = options?.limit ?? INBOUND_MEDIA_SWEEP_BATCH;
  const maxAttempts = options?.maxAttempts ?? INBOUND_MEDIA_MAX_ATTEMPTS;
  const selected: T[] = [];
  for (const row of rows) {
    if (selected.length >= limit) break;
    if (!needsInboundMediaBackfill(row, now, days)) continue;
    if (!inboundMediaStatusEligible(row.metadata, maxAttempts)) continue;
    selected.push(row);
  }
  return selected;
}

export interface BackfillReport {
  scanned: number;
  stored: number;
  expired: number;
  failed: number;
}

export async function backfillInboundMediaMessages(
  rows: BackfillCandidate[],
  run: (row: BackfillCandidate) => Promise<{ mediaDownloadStatus: string }>,
): Promise<BackfillReport> {
  const report: BackfillReport = { scanned: 0, stored: 0, expired: 0, failed: 0 };
  for (const row of rows) {
    report.scanned += 1;
    try {
      const result = await run(row);
      if (result.mediaDownloadStatus === "stored") report.stored += 1;
      else if (result.mediaDownloadStatus.includes("expired")) report.expired += 1;
      else report.failed += 1;
    } catch (e) {
      report.failed += 1;
      console.warn("[wa-inbound] backfill baris gagal:", row.id, e instanceof Error ? e.message : e);
    }
  }
  return report;
}

type StorageAdmin = {
  storage?: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Uint8Array | Buffer,
        options: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message?: string } | null }>;
    };
  };
  from: (table: string) => any;
  rpc: NoticeDb["rpc"];
};

async function uploadInboundBytes(
  admin: StorageAdmin,
  path: string,
  bytes: Uint8Array,
  mime: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const bucket = admin.storage?.from(WA_INBOUND_BUCKET);
  if (!bucket) {
    console.warn(
      `[wa-inbound] klien storage tidak ada. Placeholder tetap ditampilkan.`,
    );
    return { ok: false, reason: "storage_unavailable" };
  }
  try {
    const { error } = await bucket.upload(path, Buffer.from(bytes), {
      contentType: mime,
      upsert: true,
    });
    if (!error) return { ok: true };
    const reason = uploadFailureReason(error.message ?? "upload_failed");
    return { ok: false, reason };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: uploadFailureReason(message) };
  }
}

export interface InboundMediaModules {
  fetchMetaMediaBytes: (mediaId: string, maxBytes?: number) => Promise<MetaMediaFetchResult>;
  analyzePaymentProof: (
    admin: StorageAdmin,
    dataUri: string,
    phone: string,
    messageId: string,
  ) => Promise<PaymentProofResult>;
  notifyPaymentProof: (admin: StorageAdmin, input: Record<string, unknown>) => Promise<void>;
}

async function loadInboundMediaModules(): Promise<InboundMediaModules> {
  const { fetchMetaMediaBytes } = await import("./whatsapp-meta.service");
  const { analyzePaymentProof } = await import("./payment-proof.service");
  const { notifyPaymentProof } = await import("./manager-notifier.service");
  return {
    fetchMetaMediaBytes,
    analyzePaymentProof: (admin, dataUri, phone, messageId) =>
      analyzePaymentProof(admin as never, dataUri, phone, messageId),
    notifyPaymentProof: (admin, notice) => notifyPaymentProof(admin as never, notice as never),
  };
}

const emptyMediaResult = (status: string, reason: string): InboundMediaJobResult => ({
  storagePath: null,
  mediaDownloadStatus: status,
  mediaSize: null,
  ocrStatus: "failed",
  ocrReason: reason.slice(0, 180),
  ocrAttempted: false,
  notified: false,
});

async function recordMediaImportFailure(
  admin: StorageAdmin,
  messageId: string,
  reason: string,
): Promise<void> {
  let attempts = 1;
  try {
    const res = await admin.from("whatsapp_messages").select("metadata").eq("id", messageId).limit(1);
    const data = res?.data;
    const row = Array.isArray(data) ? data[0] : data;
    attempts = mediaAttemptCount(asRecord(row?.metadata)) + 1;
  } catch {
    attempts = 1;
  }
  await saveMessageMetadata(admin as never, {
    messageId,
    metadata: {
      media_download_status: mediaDownloadStatus(false, "import"),
      media_attempts: attempts,
      ocr_status: "failed",
      ocr_reason: reason.slice(0, 180),
      storage_bucket: WA_INBOUND_BUCKET,
    },
  });
}

/** Jalur produksi: Meta download + storage + OCR + satu notifikasi staf. Tidak melempar. */
export async function runInboundMediaJob(
  admin: StorageAdmin,
  input: InboundMediaJobInput,
  loadModules: () => Promise<InboundMediaModules> = loadInboundMediaModules,
): Promise<InboundMediaJobResult> {
  let modules: InboundMediaModules;
  try {
    modules = await loadModules();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[wa-inbound] impor modul media gagal:", reason);
    try {
      await recordMediaImportFailure(admin, input.messageId, reason);
    } catch (saveErr) {
      console.warn("[wa-inbound] gagal mencatat failed:import:", saveErr);
    }
    return emptyMediaResult(mediaDownloadStatus(false, "import"), reason);
  }

  return processInboundMedia(input, {
    download: (mediaId) => modules.fetchMetaMediaBytes(mediaId, WA_INBOUND_MAX_BYTES),
    upload: (path, bytes, mime) => uploadInboundBytes(admin, path, bytes, mime),
    readMetadata: async (messageId) => {
      const { data } = await admin
        .from("whatsapp_messages")
        .select("metadata")
        .eq("id", messageId)
        .maybeSingle();
      return asRecord(data?.metadata);
    },
    saveMetadata: (messageId, patch) => saveMessageMetadata(admin as never, { messageId, metadata: patch }),
    analyze: (dataUri, phone, messageId) => modules.analyzePaymentProof(admin, dataUri, phone, messageId),
    loadPaymentContext: (phone) => loadAwaitingPaymentContext(admin, phone),
    claimNotice: (notice) =>
      claimPaymentProofStaffNotice(admin, notice, async () => {
        await modules.notifyPaymentProof(admin, {
          threadId: notice.threadId,
          phone: notice.phone,
          guestName: notice.guestName,
          messageId: notice.messageId,
          chatUrl: notice.url,
        });
      }),
  });
}

export interface InboundMediaSweepReport {
  scanned: number;
  stored: number;
  failed: number;
}

type SweepMessageRow = {
  id: string;
  sent_at?: string | null;
  thread_id?: string | null;
  metadata?: unknown;
  whatsapp_threads?: { phone?: string | null; canonical_phone?: string | null; display_name?: string | null } | null;
};

function mapSweepRow(row: SweepMessageRow): BackfillCandidate & {
  phone: string;
  threadId: string | null;
  guestName: string | null;
  mediaId: string;
  mediaType: string | null;
  mimeType: string | null;
  fileName: string | null;
} | null {
  const metadata = asRecord(row.metadata);
  const sentAt = typeof row.sent_at === "string" ? row.sent_at : "";
  if (!row.id || !sentAt) return null;
  const thread = row.whatsapp_threads ?? {};
  return {
    id: row.id,
    sentAt,
    metadata,
    phone: String(thread.phone ?? thread.canonical_phone ?? ""),
    threadId: row.thread_id ?? null,
    guestName: typeof thread.display_name === "string" ? thread.display_name : null,
    mediaId: typeof metadata?.meta_media_id === "string" ? metadata.meta_media_id : "",
    mediaType: typeof metadata?.media_type === "string" ? metadata.media_type : null,
    mimeType: typeof metadata?.mime_type === "string" ? metadata.mime_type : null,
    fileName: typeof metadata?.file_name === "string" ? metadata.file_name : null,
  };
}

/**
 * Unduh media masuk yang tertinggal. Ditunggu langsung oleh cron menit-an,
 * bukan `waitUntil`. Pesan lebih tua dari jendela segar disimpan dan di-OCR
 * tanpa notifikasi staf dan tanpa balasan tamu.
 */
export async function sweepPendingInboundMedia(
  admin: StorageAdmin,
  options?: InboundMediaSweepOptions & {
    deadlineMs?: number;
    run?: typeof runInboundMediaJob;
  },
): Promise<InboundMediaSweepReport> {
  const now = options?.now ?? new Date();
  const days = options?.days ?? INBOUND_MEDIA_SWEEP_DAYS;
  const limit = options?.limit ?? INBOUND_MEDIA_SWEEP_BATCH;
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const fetchCap = Math.max(limit * 8, limit);
  const report: InboundMediaSweepReport = { scanned: 0, stored: 0, failed: 0 };

  const { data, error } = await admin
    .from("whatsapp_messages")
    .select("id, thread_id, sent_at, metadata, whatsapp_threads(phone, canonical_phone, display_name)")
    .eq("direction", "in")
    .gte("sent_at", since)
    .not("metadata->>meta_media_id", "is", null)
    .order("sent_at", { ascending: false })
    .limit(fetchCap);
  if (error || !data) {
    console.warn("[wa-inbound] sweep query gagal:", error?.message ?? error);
    return report;
  }

  const mapped = (data as SweepMessageRow[])
    .map((row) => mapSweepRow(row))
    .filter((row): row is NonNullable<typeof row> => row != null);
  const batch = selectInboundMediaSweep(mapped, now, { ...options, now, days, limit });
  const deadline = Date.now() + (options?.deadlineMs ?? INBOUND_MEDIA_SWEEP_DEADLINE_MS);
  const run = options?.run ?? runInboundMediaJob;

  for (const row of batch) {
    if (Date.now() > deadline) break;
    report.scanned += 1;
    try {
      const result = await run(admin, {
        phone: row.phone,
        guestName: row.guestName,
        messageId: row.id,
        threadId: row.threadId,
        media: {
          mediaId: row.mediaId,
          mediaType: row.mediaType,
          mimeType: row.mimeType,
          fileName: row.fileName,
        },
        at: new Date(row.sentAt),
        sentAt: row.sentAt,
        now,
      });
      if (result.mediaDownloadStatus === "stored") report.stored += 1;
      else report.failed += 1;
    } catch (e) {
      report.failed += 1;
      console.warn("[wa-inbound] sweep baris gagal:", row.id, e instanceof Error ? e.message : e);
    }
  }
  if (report.scanned > 0) {
    console.info(
      `[wa-inbound] sweep scanned=${report.scanned} stored=${report.stored} failed=${report.failed}`,
    );
  }
  return report;
}
