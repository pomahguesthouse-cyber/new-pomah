/**
 * Pemrosesan inbox webhook WhatsApp Business (Meta).
 *
 * Setiap delivery sudah tersimpan di `whatsapp_webhook_events` sebelum
 * diproses. Pemrosesan idempoten: pesan masuk di-dedup via wpp_id, status via
 * RPC `apply_whatsapp_meta_status` yang tidak menurunkan status.
 *
 * Jalur kritis (simpan pesan + queueUpsert) tetap sinkron di request webhook.
 * Ack 200 sebelum antrian ada menghilangkan redelivery gateway — itu celah
 * yang membuat pesan tersimpan tanpa balasan. OCR bukti transfer saja yang
 * ditunda lewat waitUntil, dan hanya setelah baris antrian berhasil ditulis.
 */
import { saveInboundMessage, saveMessageMetadata } from "@/repositories/message.repository";
import { classifyMessageIntent } from "@/webhook/intent-classifier";
import { runDeferred } from "@/lib/cf-context";
import { queueUpsert, resolveQueueTiming } from "@/services/queue.service";
import {
  assessInboundCoverage,
  formatInboundSkipNote,
  loadInboundSentAt,
  logInboundRecovered,
  logInboundSkip,
  phoneTail,
  type InboundSkipReason,
} from "@/services/wa-inbound-enqueue";

type Admin = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

interface MetaMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; caption?: string; filename?: string; mime_type?: string };
  video?: { id?: string; caption?: string };
  audio?: { id?: string };
  sticker?: { id?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}

interface MetaStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: unknown[];
}

/** Status belum punya pasangan outbound → tunda, bukan gagal. */
class DeferredError extends Error {}

const MAX_ATTEMPTS = 12;

function valueOf(payload: unknown): Record<string, unknown> {
  const v = (payload as { entry?: Array<{ changes?: Array<{ value?: unknown }> }> })?.entry?.[0]
    ?.changes?.[0]?.value;
  return (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
}

async function getAdmin(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Admin;
}

function messageText(m: MetaMessage): string {
  if (m.text?.body) return m.text.body;
  if (m.button?.text) return m.button.text;
  if (m.interactive?.button_reply?.title) return m.interactive.button_reply.title;
  if (m.interactive?.list_reply?.title) return m.interactive.list_reply.title;
  const caption = m.image?.caption ?? m.document?.caption ?? m.video?.caption;
  if (caption) return caption;
  if (m.type === "image") return "[Tamu mengirim lampiran bukti transfer pembayaran]";
  return m.type ? `[Lampiran ${m.type}]` : "";
}

export interface MetaInboundHandleResult {
  enqueued: boolean;
  /** Duplikat yang belum punya antrian maupun balasan — di-enqueue ulang. */
  recoveredDuplicate: boolean;
  skipReason: InboundSkipReason | null;
}

function logFields(
  phone: string,
  messageId: string | null,
  wppId: string | null,
  isRetry: boolean,
): Record<string, unknown> {
  return {
    message_id: messageId,
    wpp_id: wppId,
    phone_tail: phoneTail(phone),
    is_retry: isRetry,
  };
}

async function persistInboundMetadata(
  admin: Admin,
  messageId: string,
  m: MetaMessage,
  body: string,
  skipReason: InboundSkipReason | null,
) {
  const mediaId = m.image?.id ?? m.document?.id ?? m.video?.id ?? m.audio?.id ?? m.sticker?.id ?? null;
  await saveMessageMetadata(admin as never, {
    messageId,
    metadata: {
      source: "whatsapp_meta",
      provider: "meta",
      intent_label: classifyMessageIntent(body),
      media_type: m.type ?? null,
      meta_media_id: mediaId,
      mime_type: m.image?.mime_type ?? m.document?.mime_type ?? null,
      file_name: m.document?.filename ?? null,
      ...(skipReason
        ? { inbound_skip_reason: skipReason, inbound_skip_at: new Date().toISOString() }
        : {}),
    },
  });
}

/** OCR vision lambat. Jalan setelah antrian tertulis, tanpa menahan ack webhook. */
function schedulePaymentProofOcr(admin: Admin, phone: string, messageId: string, mediaId: string) {
  void runDeferred("MetaInbox.ocr", async () => {
    const { fetchMetaMediaDataUri } = await import("./whatsapp-meta.service");
    const { analyzePaymentProof } = await import("./payment-proof.service");
    const dataUri = await fetchMetaMediaDataUri(mediaId);
    if (dataUri) await analyzePaymentProof(admin as never, dataUri, phone, messageId);
  });
}

function shouldOcr(m: MetaMessage, skipReason: InboundSkipReason | null, enqueued: boolean): boolean {
  if (!(m.type === "image" && m.image?.id)) return false;
  if (enqueued) return true;
  // Redelivery setelah antrian tertulis, atau auto-reply mati: OCR sebelumnya
  // bisa terputus. Jangan ulang bila balasan atau antrian aktif sudah ada.
  return skipReason === "duplicate_already_queued" || skipReason === "auto_reply_disabled";
}

export async function handleMetaInboundMessage(
  admin: Admin,
  value: Record<string, unknown>,
  m: MetaMessage,
  isRetry: boolean,
): Promise<MetaInboundHandleResult> {
  if (!m.from || !m.id) {
    logInboundSkip("MetaInbox", "missing_sender_or_id", { is_retry: isRetry, has_from: !!m.from, has_id: !!m.id });
    return { enqueued: false, recoveredDuplicate: false, skipReason: "missing_sender_or_id" };
  }
  const contacts = value.contacts as Array<{ profile?: { name?: string } }> | undefined;
  const name = contacts?.[0]?.profile?.name ?? m.from;
  const body = messageText(m);
  const phone = m.from;

  const { messageId, duplicate, error } = await saveInboundMessage(admin as never, {
    phone,
    name,
    body,
    wppId: m.id,
  });
  if (error || !messageId) throw new Error(`saveInbound gagal: ${error?.message ?? "no id"}`);
  const logged = () => logFields(phone, messageId, m.id ?? null, isRetry);

  // Tandai thread agar balasan otomatis lewat nomor resmi.
  const { error: provErr } = await admin
    .from("whatsapp_threads")
    .update({ provider: "meta" })
    .or(`phone.eq.${phone},canonical_phone.eq.${phone}`);
  if (provErr) throw new Error(`set provider gagal: ${provErr.message}`);

  const { data: ctx, error: ctxErr } = await admin.rpc("get_autoreply_context", { p_phone: phone });
  if (ctxErr || !ctx) throw new Error(`context gagal: ${ctxErr?.message ?? "kosong"}`);
  const c = ctx as {
    thread_id: string;
    thread_phone?: string | null;
    canonical_phone?: string | null;
    auto_reply_enabled: boolean;
    smart_delay_config?: Record<string, unknown> | null;
  };

  const finishSkipped = async (reason: InboundSkipReason): Promise<MetaInboundHandleResult> => {
    logInboundSkip("MetaInbox", reason, { ...logged(), duplicate: !!duplicate });
    await persistInboundMetadata(admin, messageId, m, body, reason);
    if (shouldOcr(m, reason, false) && m.image?.id) {
      schedulePaymentProofOcr(admin, phone, messageId, m.image.id);
    }
    return { enqueued: false, recoveredDuplicate: false, skipReason: reason };
  };

  if (!c.auto_reply_enabled) return finishSkipped("auto_reply_disabled");

  let recoveredDuplicate = false;
  if (duplicate) {
    const sentAt = await loadInboundSentAt(admin, messageId);
    const coverage = await assessInboundCoverage(admin, {
      messageId,
      threadId: c.thread_id,
      sentAt,
      autoReplyEnabled: true,
    });
    if (coverage.action === "skip") return finishSkipped(coverage.reason);
    recoveredDuplicate = true;
    logInboundRecovered("MetaInbox", logged());
  }

  // Antrian sebelum metadata/OCR. Kalau request terputus setelah baris ini,
  // redelivery melihat last_message_id dan tidak membuat balasan kedua.
  const { delayMs, maxWaitMs } = resolveQueueTiming(body, c.smart_delay_config as never);
  const entry = await queueUpsert(admin as never, {
    phone: c.canonical_phone || c.thread_phone || phone,
    threadId: c.thread_id,
    messageId,
    body,
    delayMs,
    maxWaitMs,
  });
  // Gagal masuk antrian = balasan tidak akan terkirim; ulangi lewat inbox.
  if (!entry) throw new Error("queueUpsert gagal: balasan belum dijadwalkan");

  await persistInboundMetadata(admin, messageId, m, body, null);
  if (shouldOcr(m, null, true) && m.image?.id) {
    schedulePaymentProofOcr(admin, phone, messageId, m.image.id);
  }
  return { enqueued: true, recoveredDuplicate, skipReason: null };
}

async function handleStatus(admin: Admin, s: MetaStatus) {
  if (!s.id || !s.status) return;
  const ts = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString();
  const { data, error } = await admin.rpc("apply_whatsapp_meta_status", {
    p_message_id: s.id,
    p_status: s.status,
    p_ts: ts,
    p_errors: s.errors && s.errors.length ? s.errors : null,
  });
  if (error) throw new Error(`status gagal: ${error.message}`);
  if (data !== true) throw new DeferredError(`outbound ${s.id} belum tersimpan`);
}

/** Proses satu event tersimpan. Melempar error bila harus diulang. */
async function processEvent(
  admin: Admin,
  event: string,
  payload: unknown,
  isRetry: boolean,
): Promise<string[]> {
  const value = valueOf(payload);
  const skipReasons: string[] = [];
  if (event === "whatsapp.message") {
    for (const m of (value.messages as MetaMessage[] | undefined) ?? []) {
      const result = await handleMetaInboundMessage(admin, value, m, isRetry);
      if (result.skipReason) skipReasons.push(result.skipReason);
    }
  } else if (event === "whatsapp.status") {
    for (const s of (value.statuses as MetaStatus[] | undefined) ?? []) {
      await handleStatus(admin, s);
    }
  } else if (event === "whatsapp.message_error") {
    console.warn("[MetaInbox] account error:", JSON.stringify(value.errors ?? []).slice(0, 500));
  }
  // Event lain cukup disimpan di inbox.
  return skipReasons;
}

/** Proses baris inbox; kembalikan true bila selesai (atau ditunda dengan aman). */
export async function processInboxRow(row: {
  id: string;
  event: string;
  payload: unknown;
  attempts: number;
}): Promise<{ done: boolean; deferred: boolean; error?: string }> {
  const admin = await getAdmin();
  try {
    const skipReasons = await processEvent(admin, row.event, row.payload, row.attempts > 0);
    // Catatan skip bukan kegagalan: baris tetap selesai (processed_at terisi)
    // supaya gateway tidak mengirim ulang, tapi alasannya tetap terbaca.
    const skipNote = formatInboundSkipNote(skipReasons);
    const { error } = await admin
      .from("whatsapp_webhook_events")
      .update({ processed_at: new Date().toISOString(), processing_error: skipNote })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    return { done: true, deferred: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = row.attempts + 1;
    const deferred = e instanceof DeferredError;
    const giveUp = attempts >= MAX_ATTEMPTS;
    // Backoff eksponensial ringan agar baris macet tidak memblokir yang lain.
    const next = new Date(Date.now() + Math.min(60_000 * 2 ** Math.min(attempts, 6), 3_600_000));
    await admin
      .from("whatsapp_webhook_events")
      .update({
        attempts,
        processing_error: giveUp ? `menyerah: ${msg}` : msg,
        next_attempt_at: next.toISOString(),
        ...(giveUp ? { processed_at: new Date().toISOString() } : {}),
      })
      .eq("id", row.id);
    return { done: false, deferred, error: msg };
  }
}

/** Recovery: proses baris tertunda yang sudah jatuh tempo (dibatasi). */
export async function drainMetaInbox(limit = 5): Promise<number> {
  const admin = await getAdmin();
  const { data, error } = await admin
    .from("whatsapp_webhook_events")
    .select("id, event, payload, attempts")
    .is("processed_at", null)
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (error || !data) return 0;
  let done = 0;
  for (const row of data as Array<{ id: string; event: string; payload: unknown; attempts: number }>) {
    const r = await processInboxRow(row);
    if (r.done) done++;
  }
  return done;
}
