/**
 * Keputusan enqueue balasan WhatsApp — dipakai webhook Meta dan safety-net.
 *
 * Insiden 24–26 Sep 2026: request pertama sempat menyimpan pesan lalu terputus
 * (cold start / timeout gateway) sebelum `wa_queue_upsert`. Redelivery membawa
 * `delivery_id` yang sama dengan `attempts` masih 0, `receive_whatsapp_message`
 * mengembalikan `is_duplicate`, dan handler lama langsung return. Event
 * ditandai selesai tanpa baris antrian dan tanpa error.
 *
 * Duplikat bukan alasan untuk diam. Antrian hanya dilewati bila pesan ini
 * sudah punya baris `wa_conversation_queue` (`last_message_id`), sudah ada
 * balasan outbound setelahnya, atau sudah ada antrian aktif untuk thread yang
 * dibuat pada/setelah pesan itu. Predikat yang sama dipakai safety-net supaya
 * kedua jalur tidak saling membalas dua kali.
 */

export type InboundSkipReason =
  | "missing_sender_or_id"
  | "duplicate_already_queued"
  | "duplicate_already_replied"
  | "duplicate_active_queue"
  | "auto_reply_disabled"
  | "missing_send_token"
  | "missing_thread_phone";

export interface InboundCoverageFlags {
  queuedForMessage: boolean;
  activeQueueForThread: boolean;
  outboundAfter: boolean;
  autoReplyEnabled: boolean;
}

export type InboundEnqueueDecision =
  | { action: "enqueue" }
  | { action: "skip"; reason: InboundSkipReason };

/** Status antrian yang masih akan menghasilkan (atau sedang menyusun) balasan. */
export const ACTIVE_QUEUE_STATUSES = ["pending", "waiting", "processing", "retrying"] as const;

/**
 * Apakah pesan masuk yang SUDAH tersimpan perlu `queueUpsert`.
 * `auto_reply_enabled === false` selalu menang: tidak ada balasan yang dijadwalkan.
 * Selain itu, baris antrian / outbound / antrian aktif adalah tanda "sudah ditangani".
 */
export function decideInboundEnqueue(flags: InboundCoverageFlags): InboundEnqueueDecision {
  if (!flags.autoReplyEnabled) {
    return { action: "skip", reason: "auto_reply_disabled" };
  }
  if (flags.queuedForMessage) {
    return { action: "skip", reason: "duplicate_already_queued" };
  }
  if (flags.outboundAfter) {
    return { action: "skip", reason: "duplicate_already_replied" };
  }
  if (flags.activeQueueForThread) {
    return { action: "skip", reason: "duplicate_active_queue" };
  }
  return { action: "enqueue" };
}

export function formatInboundSkipNote(reasons: readonly string[]): string | null {
  const unique = [...new Set(reasons.filter((r) => r.trim().length > 0))];
  if (unique.length === 0) return null;
  return `skip:${unique.join("|")}`;
}

export function phoneTail(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.slice(-6);
}

/** Satu baris JSON supaya skip yang disengaja bisa dicari di log produksi. */
export function logInboundSkip(
  source: "MetaInbox" | "QueueRecovery",
  reason: InboundSkipReason,
  fields: Record<string, unknown>,
): void {
  console.warn(
    JSON.stringify({
      src: source,
      event: "inbound_skipped",
      reason,
      ...fields,
    }),
  );
}

export function logInboundRecovered(
  source: "MetaInbox" | "QueueRecovery",
  fields: Record<string, unknown>,
): void {
  console.warn(
    JSON.stringify({
      src: source,
      event: "inbound_recovered",
      reason: "duplicate_unqueued",
      ...fields,
    }),
  );
}

type QueryError = { message?: string } | null;
type QueryResult = { data: unknown; error: QueryError };

export type InboundQueryClient = {
  from: (table: string) => {
    select: (columns: string) => any;
  };
};

function asRows(data: unknown): Array<Record<string, unknown>> {
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

function errorText(error: QueryError, fallback: string): string {
  return error?.message ?? fallback;
}

/**
 * Tiga cek yang sama dengan safety-net historis, berhenti di kondisi pertama
 * supaya scan menit-an tidak membaca antrian aktif/outbound untuk pesan yang
 * sudah punya baris `last_message_id`:
 *   1. ada baris antrian dengan `last_message_id` = pesan ini (status apa pun)
 *   2. ada pesan outbound thread yang `sent_at >= sent_at` pesan
 *   3. ada antrian aktif thread yang `created_at >= sent_at` pesan
 * Error query dilempar — jangan menganggap "gagal baca" sebagai "belum antri".
 */
export async function loadDuplicateEnqueueState(
  admin: InboundQueryClient,
  args: { messageId: string; threadId: string; sentAt: string },
): Promise<Omit<InboundCoverageFlags, "autoReplyEnabled">> {
  const queuedRes = (await admin
    .from("wa_conversation_queue")
    .select("id")
    .eq("last_message_id", args.messageId)
    .limit(1)) as QueryResult;
  if (queuedRes.error) {
    throw new Error(`cek antrian gagal: ${errorText(queuedRes.error, "unknown")}`);
  }
  // Sudah ada baris untuk pesan ini: jangan baca antrian aktif / outbound.
  // Safety-net memindai 20 pesan tiap menit; sebagian besar sudah mengantri.
  if (asRows(queuedRes.data).length > 0) {
    return { queuedForMessage: true, activeQueueForThread: false, outboundAfter: false };
  }

  const outboundRes = (await admin
    .from("whatsapp_messages")
    .select("id")
    .eq("thread_id", args.threadId)
    .eq("direction", "out")
    .gte("sent_at", args.sentAt)
    .limit(1)) as QueryResult;
  if (outboundRes.error) {
    throw new Error(`cek balasan gagal: ${errorText(outboundRes.error, "unknown")}`);
  }
  if (asRows(outboundRes.data).length > 0) {
    return { queuedForMessage: false, activeQueueForThread: false, outboundAfter: true };
  }

  const activeRes = (await admin
    .from("wa_conversation_queue")
    .select("id")
    .eq("thread_id", args.threadId)
    .in("status", [...ACTIVE_QUEUE_STATUSES])
    .gte("created_at", args.sentAt)
    .limit(1)) as QueryResult;
  if (activeRes.error) {
    throw new Error(`cek antrian aktif gagal: ${errorText(activeRes.error, "unknown")}`);
  }

  return {
    queuedForMessage: false,
    activeQueueForThread: asRows(activeRes.data).length > 0,
    outboundAfter: false,
  };
}

export async function loadInboundSentAt(
  admin: InboundQueryClient,
  messageId: string,
): Promise<string> {
  const res = (await admin
    .from("whatsapp_messages")
    .select("sent_at")
    .eq("id", messageId)
    .limit(1)) as QueryResult;
  if (res.error) {
    throw new Error(`cek sent_at gagal: ${errorText(res.error, "unknown")}`);
  }
  const sentAt = asRows(res.data)[0]?.sent_at;
  if (typeof sentAt !== "string" || !sentAt) {
    throw new Error("cek sent_at gagal: kosong");
  }
  return sentAt;
}

/** Coverage lengkap untuk satu pesan tersimpan. Dipakai webhook (jalur duplikat) dan safety-net. */
export async function assessInboundCoverage(
  admin: InboundQueryClient,
  args: { messageId: string; threadId: string; sentAt: string; autoReplyEnabled: boolean },
): Promise<InboundEnqueueDecision> {
  const flags = await loadDuplicateEnqueueState(admin, args);
  return decideInboundEnqueue({ ...flags, autoReplyEnabled: args.autoReplyEnabled });
}
