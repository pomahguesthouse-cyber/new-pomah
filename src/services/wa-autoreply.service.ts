/**
 * Reliable WhatsApp autoreply: debounce wait → AI → Wpp send.
 * Runs inside waitUntil from the webhook (not HTTP self-fetch).
 */
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";
import { saveOutboundMessage, updateThreadAutoReplyMeta } from "@/repositories/message.repository";
import { sendWhatsAppMessage, markWppSeen, setWppTyping } from "@/services/whatsapp.service";
import { runMultiAgentOrchestration, deriveAgentLabelFromKey } from "@/ai/multi-agent-orchestrator";
import { fmtDateID, nextDay, todayWIB } from "@/lib/date";
import { queueClaimNext, queueComplete, queueFail, queueHeartbeat, queueUpsert } from "@/services/queue.service";
import {
  findSessionStartIndex,
  isBrosurDoc,
  pickAttachment,
  normalizeBrochureReply,
  cleanReplyBody,
} from "@/services/reply-postprocess";
import { checkConversation } from "@/services/conversation-monitor.service";
import {
  type ChatSummaryStructured,
  LAST_TOPIC_VALUES,
  BOOKING_STATUS_VALUES,
  PAYMENT_STATUS_VALUES,
} from "@/ai/chat-summary.types";
import { findTrainingSignals } from "@/services/training-retrieval.service";
import { runDeferred } from "@/lib/cf-context";
import { checkRoomAvailability } from "@/tools/availability.tool";
import { retrieveRelevantSopContext } from "@/ai/rag.service";
import { getBookingState } from "@/ai/state-machine/booking-machine";
import { buildPropertyFaqReply } from "@/services/property-faq";
import {
  AI_TIMEOUT_MS,
  FALLBACK_MESSAGE,
  MANAGER_FALLBACK_MESSAGE,
  QUICK_ACK_MESSAGE,
  buildStateAwareFallback,
  pickAiBudgetMs,
} from "@/services/wa-autoreply/runtime-policy";
import {
  generateSessionSummary,
  regenerateThreadSummary,
  SUMMARY_MIN_MESSAGES,
  updateThreadSummary,
} from "@/services/wa-autoreply/session-summary";
import {
  SUMMARY_REGEN_COOLDOWN_MS,
  shouldForceSummary,
} from "@/services/wa-autoreply/session-summary-policy";
import {
  hasRecentPriceContext,
  isAvailabilityNeedDatesQuestion,
  isAvailabilitySourceContext,
  isExplicitBookingOrder,
  isTonightReply,
  looksLikeBookingInquiry,
  messageOpensWithGreeting,
  parseAvailabilityDateRange,
  parseGuestCountFollowup,
  shouldUseDeterministicAvailability,
  type ParsedGuestCount,
} from "@/services/wa-autoreply/message-parsers";
import {
  buildAvailabilityNeedDatesReply,
  formatAvailabilityForGuestCount,
  formatAvailabilityReply,
  lastBotAskedGuestCount,
} from "@/services/wa-autoreply/availability-formatters";
import {
  buildRecentAvailabilityNeedDatesReply,
  formatTonightAvailabilityReply,
} from "@/services/wa-autoreply/availability-context";
import {
  isConfiguredAdminPhone,
  isManagerInGuestMode,
  normalizePhone,
  resolveManagerByPhone,
} from "@/services/wa-autoreply/identity";

export {
  isConfiguredAdminPhone,
  isManagerInGuestMode,
  normalizePhone,
  resolveManagerByPhone,
};

/**
 * Pasangkan hasil pengiriman WA dengan log upaya kirim form booking.
 * Tool `generate_booking_form` menyisipkan baris `pending` di
 * `booking_form_send_logs` saat URL dibuat. Saat pesan berisi URL
 * `/booking/form/<token>` benar-benar dikirim (atau gagal), kami
 * memperbarui baris bersangkutan untuk audit di admin panel.
 */
async function updateBookingFormSendLog(args: {
  body: string;
  status: "sent" | "failed" | "superseded";
  failureReason?: string | null;
}): Promise<void> {
  try {
    const match = args.body.match(/\/booking\/form\/([A-Za-z0-9_-]+)/);
    if (!match) return;
    const token = match[1];
    const patch: Record<string, unknown> = { status: args.status };
    if (args.status === "sent") patch.sent_at = new Date().toISOString();
    if (args.failureReason !== undefined) patch.failure_reason = args.failureReason;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    // Increment attempts kecuali superseded.
    if (args.status !== "superseded") {
      const { data: existing } = await admin
        .from("booking_form_send_logs")
        .select("attempts")
        .eq("token", token)
        .maybeSingle();
      patch.attempts = ((existing?.attempts as number | undefined) ?? 0) + 1;
    }
    await admin.from("booking_form_send_logs").update(patch).eq("token", token);
  } catch (e) {
    console.warn("[booking-form-log] update failed (non-fatal):", e);
  }
}


const QUICK_ACK_AFTER_MS = 6_000;
const QUICK_ACK_ENABLED = process.env.WA_QUICK_ACK_ENABLED !== "false";
const FAST_FAQ_ENABLED = process.env.WA_FAST_FAQ_ENABLED !== "false";
// (FAQ_BLOCK_RE & COMPLAINT_SIGNAL_RE pindah ke property-faq.ts — O3.)

type FastFaqResult = {
  reply: string;
  intent: string;
  /** Tanggal yang di-parse (untuk jalur ketersediaan) — dipersist ke
   *  conversation-state agar turn berikutnya (mis. tanya harga) tidak
   *  menanyakan tanggal lagi. */
  dates?: { checkIn: string; checkOut: string };
};

/**
 * Anggaran waktu untuk SATU attempt orchestrasi penuh (klasifikasi intent →
 * route → jalankan agent → tool calls → balasan teks). Dibuat ketat agar
 * request worker tidak hidup terlalu lama dan berubah menjadi zombie. Jika AI
 * belum menghasilkan jawaban dalam batas ini, alur mengirim fallback yang jelas
 * ke tamu, bukan menunggu retry panjang tanpa sinyal.
 */
// 18s (naik dari 14s, 3 Jul 2026): worst case realistis = classifier LLM
// fallback ~5s + 2 ronde LLM @6.5s + tool/DB — 14s memotong percakapan
// booking berat dan memicu fallback "sistem sibuk". 18s masih di bawah
// HANDLE_ONE_DEADLINE_MS dan timeout klien penggerak (pg_net 30s,
// cron-job.org 30s).
const HANDLE_ONE_DEADLINE_MS = 26_000;
// Retry penuh menggandakan rakit prompt/retrieval/tool orchestration di runtime
// Cloudflare yang CPU-nya ketat. Biarkan retry terjadi di level queue, bukan
// mengulang orchestration berat dalam satu request worker.
const AI_MAX_ATTEMPTS = 1;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type AutoreplyOutcome =
  | "ok"
  | "skipped_config"
  | "context_error"
  | "no_api_key"
  | "send_failed"
  | "already_done"
  | "not_claimed"
  | "fatal";

/**
 * Generate reply and send via Wpp (no queue claim required).
 *
 * `onBeforeAttempt` runs right before each AI attempt — the drain worker uses
 * it to send a queue heartbeat so a slow-but-alive run isn't reaped as a zombie.
 */
// ── Summarizer tuning knobs ─────────────────────────────────────────────────
/**
 * Minimum interval between two summary regenerations for the same thread.
 * Dinaikkan dari 1 menit → 3 menit karena summarizer kini berjalan setiap
 * turn (bukan hanya di batas sesi). Cooldown ini yang menjaga biaya LLM tetap
 * terkendali: tanpa ini, percakapan cepat 20 pesan bisa memicu belasan
 * panggilan summary ekstra ke gateway. Kata kunci penting (FORCE_SUMMARY_KEYWORDS)
 * tetap bisa meng-override cooldown agar konteks kritikal selalu fresh.
 */
function shouldLoadHeavyRetrieval(message: string): boolean {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/^(halo|hai|hi|hello|pagi|siang|sore|malam|assalamualaikum|terima kasih|makasih|thanks|ok|oke|sip|baik)\b[.!?\s]*$/i.test(text)) {
    return false;
  }
  if (/^(saya )?(dapat|dapet|lihat|nemu).*\b(tiktok|tik tok|instagram|ig|facebook|fb|google|maps?)\b/i.test(text)) {
    return false;
  }
  if (text.length <= 18 && /^(ya|iya|ok|oke|sip|baik|bisa|boleh|lanjut|ready)\b/i.test(text)) {
    return false;
  }
  return true;
}

// (buildFastFaqReply dikonsolidasi ke buildPropertyFaqReply di
//  src/services/property-faq.ts — O3, 3 Jul 2026.)

/** Heuristik ringan: pesan tamu bernada booking_inquiry (tanya
 *  ketersediaan/harga/kamar) walau tanpa kata kunci tanggal. Dipakai untuk
 *  fast-path kontekstual yang meminjam tanggal dari state sebelumnya. */
/**
 * PERINTAH booking eksplisit ("saya pesan kamar deluxe tanggal 9-11 dengan
 * 1 extrabed") — HARUS ditangani alur booking (AI + state machine), BUKAN
 * fast-path availability yang hanya mengirim ulang daftar kamar. Insiden
 * 4 Jul 2026: perintah tamu ditelan dua kali oleh fast-path kontekstual
 * sehingga booking tidak pernah dimulai.
 */
async function buildDeterministicAvailabilityReply(params: {
  message: string;
  rooms: any[];
  property: any;
  origin: string;
}): Promise<FastFaqResult | null> {
  if (!shouldUseDeterministicAvailability(params.message)) return null;
  // Perintah booking eksplisit → serahkan ke alur booking, jangan balas daftar.
  if (isExplicitBookingOrder(params.message, params.rooms ?? [])) return null;
  const today = todayWIB();
  const range = parseAvailabilityDateRange(params.message, today);
  if (!range) return null;

  const raw = await checkRoomAvailability(
    { check_in: range.checkIn, check_out: range.checkOut },
    {
      supabasePublic: supabasePublic as any,
      supabaseAdmin: supabaseAdmin as any,
      rooms: params.rooms,
      property: params.property,
      today,
      origin: params.origin,
    } as any,
  );

  const result = formatAvailabilityReply(raw, messageOpensWithGreeting(params.message));
  // Lampirkan tanggal yang di-parse agar caller bisa mempersist-nya ke
  // conversation-state. Tanpa ini, tanggal hilang karena jalur deterministik
  // melewati orchestrator (satu-satunya tempat slot biasanya disimpan).
  if (result) {
    result.dates = { checkIn: range.checkIn, checkOut: range.checkOut };
  }
  return result;
}

/**
 * Fast-path kontekstual untuk intent `booking_inquiry`: pertanyaan
 * ketersediaan/harga yang TIDAK menyebut tanggal secara eksplisit, tetapi
 * tanggal check-in/check-out sudah tersimpan di booking-state atau chat
 * summary dari turn sebelumnya. Tanpa jalur ini, orkestrator agent penuh
 * (LLM + tools) yang p95-nya ~15 s ikut menghitung ketersediaan — beban
 * yang tak perlu dan berisiko zombie di Cloudflare Worker saat traffic
 * tinggi. Semua data dihitung dari `checkRoomAvailability` (deterministik).
 */
async function buildContextualBookingInquiryReply(params: {
  message: string;
  rooms: any[];
  property: any;
  origin: string;
  bookingSlots?: Record<string, unknown> | null;
  chatSummary?: { check_in?: unknown; check_out?: unknown; guest_count?: unknown } | null;
}): Promise<FastFaqResult | null> {
  if (!looksLikeBookingInquiry(params.message)) return null;
  // Perintah booking eksplisit → serahkan ke alur booking, jangan balas daftar.
  if (isExplicitBookingOrder(params.message, params.rooms ?? [])) return null;

  const today = todayWIB();
  // Prioritas: tanggal yang di-parse dari pesan → slot booking aktif →
  // ringkasan chat. Kalau pesan baru menyebut tanggal, jalur deterministik
  // "biasa" (buildDeterministicAvailabilityReply) sudah lebih dulu menang;
  // di sini kita hanya menutup celah saat pesan tanpa tanggal.
  const explicitRange = parseAvailabilityDateRange(params.message, today);
  const slotCheckIn = typeof params.bookingSlots?.checkIn === "string" ? params.bookingSlots?.checkIn as string : null;
  const slotCheckOut = typeof params.bookingSlots?.checkOut === "string" ? params.bookingSlots?.checkOut as string : null;
  const summaryCheckIn = typeof params.chatSummary?.check_in === "string" ? params.chatSummary?.check_in as string : null;
  const summaryCheckOut = typeof params.chatSummary?.check_out === "string" ? params.chatSummary?.check_out as string : null;

  const checkIn = explicitRange?.checkIn ?? slotCheckIn ?? summaryCheckIn;
  const checkOut = explicitRange?.checkOut ?? slotCheckOut ?? summaryCheckOut;
  if (!checkIn || !checkOut) return null;

  // Tolak tanggal lampau — biarkan agent menjelaskan supaya tidak terkesan
  // menutupi kesalahan slot lama yang belum dibersihkan.
  if (checkIn < today) return null;

  const guests = parseGuestCountFollowup(params.message);
  const summaryGuests = Number(params.chatSummary?.guest_count ?? 0);
  const adults = guests?.adults ?? (summaryGuests > 0 ? summaryGuests : undefined);
  const children = guests?.children ?? 0;

  let raw: string;
  try {
    raw = await checkRoomAvailability(
      { check_in: checkIn, check_out: checkOut, adults, children },
      {
        supabasePublic: supabasePublic as any,
        supabaseAdmin: supabaseAdmin as any,
        rooms: params.rooms,
        property: params.property,
        today,
        origin: params.origin,
      } as any,
    );
  } catch (e) {
    console.warn("[Autoreply] contextual booking_inquiry checkAvailability failed:", e);
    return null;
  }

  // Kalau kita punya jumlah tamu, format lebih kaya (dengan kapasitas + extra
  // bed). Kalau tidak, format ringkas seperti availability biasa.
  const greet = messageOpensWithGreeting(params.message);
  const result = adults
    ? formatAvailabilityForGuestCount(raw, { adults, children, total: adults + children })
    : formatAvailabilityReply(raw, greet);

  if (result) {
    result.dates = { checkIn, checkOut };
    result.intent = `${result.intent}_contextual`;
  }
  return result;
}


/**
 * Fast-path deterministik untuk intent ringan yang jawabannya sudah ada di
 * profil properti (greeting, thanks, bye, alamat/lokasi, kontak, policy
 * check-in/checkout). Sebelum ini, semua intent tersebut ikut lewat
 * orchestrator LLM (p95 ~10 s). Sekarang: match regex ringan → template
 * balasan langsung dari kolom `properties`. Return `null` bila tidak cocok.
 */
// (buildDeterministicPropertyFaqReply dikonsolidasi ke buildPropertyFaqReply
//  di src/services/property-faq.ts — O3, 3 Jul 2026.)


async function buildGuestCountAfterAvailabilityReply(params: {
  message: string;

  rooms: any[];
  property: any;
  origin: string;
  dates?: { checkIn?: unknown; checkOut?: unknown } | null;
  messages: Array<{ direction: string; body?: string }>;
}): Promise<FastFaqResult | null> {
  if (!lastBotAskedGuestCount(params.messages)) return null;
  const guests = parseGuestCountFollowup(params.message);
  if (!guests) return null;

  const checkIn = typeof params.dates?.checkIn === "string" ? params.dates.checkIn : null;
  const checkOut = typeof params.dates?.checkOut === "string" ? params.dates.checkOut : null;
  if (!checkIn || !checkOut) return null;

  const today = todayWIB();
  const raw = await checkRoomAvailability(
    {
      check_in: checkIn,
      check_out: checkOut,
      adults: guests.adults,
      children: guests.children,
    },
    {
      supabasePublic: supabasePublic as any,
      supabaseAdmin: supabaseAdmin as any,
      rooms: params.rooms,
      property: params.property,
      today,
      origin: params.origin,
    } as any,
  );

  const result = formatAvailabilityForGuestCount(raw, guests);
  if (result) {
    result.dates = { checkIn, checkOut };
  }
  return result;
}

async function buildTonightPriceReply(params: {
  rooms: any[];
  property: any;
  origin: string;
}): Promise<FastFaqResult | null> {
  const checkIn = todayWIB();
  const checkOut = nextDay(checkIn);
  const raw = await checkRoomAvailability(
    { check_in: checkIn, check_out: checkOut },
    {
      supabasePublic: supabasePublic as any,
      supabaseAdmin: supabaseAdmin as any,
      rooms: params.rooms,
      property: params.property,
      today: checkIn,
      origin: params.origin,
    } as any,
  );

  return formatTonightAvailabilityReply(raw, checkIn, checkOut);
}

/** Hard cap on persisted `short_summary` length (chars). Prevents prompt bloat. */
export { regenerateThreadSummary };

export async function executeAutoreplyForPhone(
  phone: string,
  origin: string,
  onBeforeAttempt?: () => Promise<void>,
  queueEntryId?: string,
  onReplyCommitted?: () => Promise<void>,
  queueAttempt = 1,
): Promise<AutoreplyOutcome> {
  const deferredAfterReply: Array<{ label: string; task: () => Promise<unknown> }> = [];
  const deferAfterReply = (label: string, task: () => Promise<unknown>) => {
    deferredAfterReply.push({ label, task });
  };
  const flushDeferredAfterReply = () => {
    for (const deferred of deferredAfterReply) {
      void runDeferred(deferred.label, deferred.task);
    }
  };
  const markReplyCommitted = async () => {
    if (!onReplyCommitted) return;
    try {
      await onReplyCommitted();
    } catch (e) {
      console.warn("[Autoreply] Early queue completion failed (will retry after return):", e);
    }
  };

  const { data: ctx, error: ctxErr } = await (supabaseAdmin as any).rpc("get_autoreply_context", { p_phone: phone });

  if (ctxErr || !ctx) {
    console.error(`[Autoreply] Context failed for ${phone}`, ctxErr);
    try {
      const { notifyRpcFailure } = await import("@/services/manager-notifier.service");
      await notifyRpcFailure(supabaseAdmin as any, {
        rpcName: "get_autoreply_context",
        errorMessage: ctxErr?.message ?? (ctx ? null : "empty context"),
        context: { phone, origin, queueEntryId },
      });
    } catch (_) {
      // notifikasi tidak boleh mengganggu alur
    }
    return "context_error";
  }

  const c = ctx as any;
  const sendTarget = String(c.send_target || c.external_chat_id || phone);
  const rawManager = await resolveManagerByPhone(phone);
  // Manager bisa mengaktifkan "guest mode" untuk menguji alur tamu (booking,
  // invoice, pembayaran) tanpa ter-route ke agen manajerial.
  const guestModeActive = rawManager ? await isManagerInGuestMode(phone) : false;
  const manager = guestModeActive ? null : rawManager;
  const metrics = {
    workerStartedAt: Date.now(),
    contextLoadedAt: Date.now(),
    aiStartedAt: 0,
    aiFinishedAt: 0,
    sendStartedAt: 0,
    sendFinishedAt: 0,
    ackSentAt: 0,
  };

  // ── Mode selection ──────────────────────────────
  let mode = "guest"; // Default
  if (manager || (isConfiguredAdminPhone(phone) && !guestModeActive)) {
    mode = "admin";
  }

  const isManager = mode === "admin";
  if ((!isManager && !c.auto_reply_enabled) || !c.wpp_token) {
    return "skipped_config";
  }

  // Rasa manusiawi: tandai dibaca + tampilkan "sedang mengetik" sebelum
  // orchestration. Best-effort, tidak boleh memblokir alur balasan.
  try { void markWppSeen(c.wpp_token, sendTarget); } catch { /* non-fatal */ }
  try { void setWppTyping(c.wpp_token, sendTarget, true); } catch { /* non-fatal */ }

  let bookingState: { state?: string | null; context?: unknown } | null = null;
  if (!isManager) {
    try {
      const { data: handoffState } = await (supabaseAdmin as any).rpc("get_active_booking_state", { p_phone: phone });
      bookingState = (handoffState as { state?: string | null; context?: unknown } | null) ?? null;
      const handoffContext = bookingState?.context;
      if (
        handoffContext &&
        typeof handoffContext === "object" &&
        (handoffContext as { handoff?: unknown }).handoff === true
      ) {
        console.info(`[Autoreply] Human handoff active — skipping bot reply for ${phone.slice(-6)}`);
        // Kirim satu ack sopan supaya tamu tidak merasa diabaikan saat admin
        // belum sempat membalas. Throttle 15 menit: hanya kirim jika ack
        // terakhir dari sistem (metadata.handoff_ack=true) lebih lama dari itu.
        try {
          const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
          const { data: recentAck } = await (supabaseAdmin as any)
            .from("whatsapp_messages")
            .select("id")
            .eq("thread_id", c.thread_id)
            .eq("direction", "out")
            .filter("metadata->>handoff_ack", "eq", "true")
            .gte("sent_at", fifteenMinAgo)
            .limit(1);
          if (!recentAck || recentAck.length === 0) {
            const ackBody =
              "Terima kasih Kak 🙏 Pesan Kakak sudah kami terima. " +
              "Admin manusia kami akan segera membalas ya, mohon ditunggu sebentar.";
            const ackRowId = await saveOutboundMessage(supabaseAdmin, {
              threadId: c.thread_id,
              body: ackBody,
              metadata: {
                agent: "system",
                agent_key: "handoff-ack",
                handoff_ack: true,
                send_status: "pending",
              } as any,
            });
            try {
              await sendWhatsAppMessage(c.wpp_token, sendTarget, ackBody);
              await (supabaseAdmin as any)
                .from("whatsapp_messages")
                .update({ metadata: { agent: "system", agent_key: "handoff-ack", handoff_ack: true, send_status: "sent" } })
                .eq("id", ackRowId);
            } catch (sendErr) {
              console.warn("[Autoreply] handoff ack send failed:", sendErr);
            }
          }
        } catch (ackErr) {
          console.warn("[Autoreply] handoff ack guard failed:", ackErr);
        }
        return "skipped_config";
      }

    } catch (e) {
      console.warn("[Autoreply] handoff guard failed (continuing):", e);
    }
  }

  // ── Zombie rescue: kirim ulang pesan outbound yang tersangkut 'pending' ──
  // Skenario: worker sebelumnya mati setelah menyimpan pesan ke DB
  // (send_status='pending') tapi sebelum memanggil Wpp API. Pesan itu
  // tersimpan di DB tapi tidak pernah sampai ke tamu. Attempt berikutnya
  // (ini) harus mengirim ulang pesan itu alih-alih memanggil AI lagi —
  // lebih hemat dan mencegah dua balasan berbeda untuk pesan yang sama.
  try {
    const fiveMinsAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: pendingMsgs } = await (supabaseAdmin as any)
      .from("whatsapp_messages")
      .select("id, body, metadata")
      .eq("thread_id", c.thread_id)
      .eq("direction", "out")
      .filter("metadata->>'send_status'", "eq", "pending")
      .lt("sent_at", fiveMinsAgo) // sudah pending > 5 menit = benar-benar zombie
      .order("sent_at", { ascending: false })
      .limit(1);

    const stuckMsg = (pendingMsgs ?? [])[0] as
      | { id: string; body: string; metadata: Record<string, unknown> }
      | undefined;

    if (stuckMsg?.body) {
      // Atomic claim: ubah send_status pending → rescuing HANYA kalau masih
      // pending. Kalau worker lain duluan, `claimed` kosong → kita tidak
      // memanggil Wpp (mencegah double resend).
      const { data: claimed } = await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .update({
          metadata: {
            ...stuckMsg.metadata,
            send_status: "rescuing",
            rescue_started_at: new Date().toISOString(),
            queue_entry_id: queueEntryId ?? (stuckMsg.metadata as any)?.queue_entry_id ?? null,
          },
        })
        .eq("id", stuckMsg.id)
        .filter("metadata->>send_status", "eq", "pending")
        .select("id");

      if (!Array.isArray(claimed) || claimed.length === 0) {
        console.info(
          `[Autoreply] Zombie rescue: msg ${stuckMsg.id.slice(0, 8)} sudah diklaim worker lain — skip`,
        );
        return "ok";
      }

      console.warn(
        `[Autoreply] 🧟 Zombie rescue: resending pending msg ${stuckMsg.id.slice(0, 8)} to ${phone.slice(-6)}`,
      );
      const { ok: reSent, error: reErr } = await (
        await import("@/services/whatsapp.service")
      ).sendWhatsAppMessage(c.wpp_token, sendTarget, stuckMsg.body);

      if (reSent) {
        await (supabaseAdmin as any)
          .from("whatsapp_messages")
          .update({
            metadata: { ...stuckMsg.metadata, send_status: "sent", zombie_rescued: true },
          })
          .eq("id", stuckMsg.id);
        console.info(`[Autoreply] ✅ Zombie rescue berhasil untuk ${phone.slice(-6)}`);
        return "ok";
      }
      // Resend gagal: kembalikan status ke 'failed' supaya tidak nge-block
      // rescue berikutnya (rescue lain bisa coba lagi setelah window 5 menit).
      await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .update({
          metadata: { ...stuckMsg.metadata, send_status: "failed", zombie_rescue_failed: true },
        })
        .eq("id", stuckMsg.id);
      console.warn(`[Autoreply] Zombie rescue gagal: ${reErr} — lanjut proses normal`);
      // Kalau resend juga gagal (Wpp down), lanjutkan ke AI normal
      // supaya tamu tetap dapat respons dari attempt ini.
    }
  } catch (e) {
    console.warn("[Autoreply] Zombie rescue check error (non-fatal):", e);
  }

  const [{ data: prop }, { data: rooms }] = await Promise.all([
    (supabaseAdmin as any).from("properties").select("*").limit(1).maybeSingle(),
    (supabasePublic as any)
      .from("room_types")
      .select(
        "id, name, base_rate, capacity, bed_type, floor_info, description, amenities, extrabed_capacity, extrabed_rate",
      )
      .order("base_rate"),
  ]);
  const p = (prop ?? {}) as any;

  const chatSummary = c.chat_summary || "";
  const rawSummaryJson = c.chat_summary_json;
  const chatSummaryJson =
    rawSummaryJson &&
    typeof rawSummaryJson === "object" &&
    !Array.isArray(rawSummaryJson) &&
    Object.keys(rawSummaryJson).length > 0
      ? (rawSummaryJson as ChatSummaryStructured)
      : undefined;
  const chatSummaryUpdatedAt = c.chat_summary_updated_at as string | null | undefined;
  const messages = c.messages ?? [];

  // manager is already resolved at the beginning of the function
  if (manager) {
    console.info(`[Autoreply] Managerial WA flow — ${manager.name} (${manager.role})`);
  }

  // Single source of truth for "where does the current session start?"
  // — used both to trim history sent to the agent AND to decide whether
  // a fresh summary of the PREVIOUS session is warranted.
  const sessionStartIndex = findSessionStartIndex(messages);
  const previousSession = messages.slice(0, sessionStartIndex);
  const currentSessionMessages = messages.slice(sessionStartIndex);
  // Filter pesan outbound "noise" supaya LLM tidak meniru mereka sebagai
  // assistant turn: fallback "sistem sibuk" dan quick-ack "sebentar Kak"
  // bukan jawaban substantif, dan kalau dibiarkan masuk history, model
  // sering mengulanginya sebagai balasan berikutnya (regresi yang muncul
  // di log: bot membalas "Mohon maaf, sistem kami sedang sibuk…").
  const cleanedSession = currentSessionMessages.filter((m: { direction: string; body?: string }) => {
    if (m.direction !== "out") return true;
    const body = (m.body ?? "").trim();
    if (!body) return false;
    if (body === FALLBACK_MESSAGE || body === MANAGER_FALLBACK_MESSAGE) return false;
    if (body === QUICK_ACK_MESSAGE) return false;
    return true;
  });
  const rollingMessages: Array<{ direction: string; body: string; sent_at?: string; isHuman?: boolean }> =
    cleanedSession.slice(-10);

  // Tandai outbound yang ditulis manual oleh admin (Wpp native/WhatsApp Web)
  // agar LLM tahu ada intervensi manusia dan tidak menimpa/menganulir jawaban
  // admin. Kita ambil metadata->>is_native_human & source untuk pesan out di
  // window rolling ini, lalu cocokkan dengan body + sent_at.
  try {
    const outSentAts = rollingMessages
      .filter((m) => m.direction === "out" && m.sent_at)
      .map((m) => m.sent_at as string);
    if (outSentAts.length && c.thread_id) {
      const minSent = outSentAts.reduce((a, b) => (a < b ? a : b));
      const { data: outMeta } = await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .select("body, sent_at, metadata")
        .eq("thread_id", c.thread_id)
        .eq("direction", "out")
        .gte("sent_at", minSent);
      const humanKeys = new Set<string>();
      for (const row of (outMeta ?? []) as Array<{ body: string; sent_at: string; metadata: any }>) {
        const md = row.metadata ?? {};
        const isHuman =
          md.is_native_human === true ||
          md.source === "whatsapp_native" ||
          (!md.agent && !md.agent_key && md.is_automated !== true);
        if (isHuman) humanKeys.add(`${row.sent_at}::${(row.body ?? "").slice(0, 80)}`);
      }
      for (const m of rollingMessages) {
        if (m.direction !== "out" || !m.sent_at) continue;
        if (humanKeys.has(`${m.sent_at}::${(m.body ?? "").slice(0, 80)}`)) {
          m.isHuman = true;
        }
      }
    }
  } catch (e) {
    console.warn("[Autoreply] failed to tag human-admin turns (non-fatal):", e);
  }


  const lastMessage =
    [...rollingMessages].reverse().find((m: { direction: string }) => m.direction === "in")?.body ?? "";

  let reply: string | null = null;
  let orchResult: any = null;

  const bookingActive = !!bookingState?.state && bookingState.state !== "IDLE";
  // A (4 Jul 2026): bila ada ≥2 pesan tamu beruntun yang belum terjawab,
  // fast-path satu-intent DILARANG menjawab hanya pesan terakhir — keluhan/
  // persetujuan di pesan sebelumnya ikut tertelan (insiden: "Maps ga bisa
  // dibuka" + "Boleh" + "Wifi aman?" → hanya wifi terjawab). Serahkan ke AI
  // yang melihat seluruh burst.
  const multiPendingInbound = countConsecutiveInbound(rollingMessages) >= 2;
  // Opener "Halo Kak 👋" hanya untuk kontak pertama: skip bila bot sudah
  // membalas di sesi berjalan atau tamu membuka dengan salam.
  const faqGreetingUsed =
    messageOpensWithGreeting(lastMessage) ||
    currentSessionMessages.some((m: { direction: string }) => m.direction === "out");
  if (FAST_FAQ_ENABLED && !isManager && !bookingActive && !multiPendingInbound && lastMessage) {
    const fastFaq = buildPropertyFaqReply({
      message: lastMessage,
      property: p as Record<string, unknown>,
      rooms: (rooms ?? []) as any[],
      greetingUsed: faqGreetingUsed,
      mode: "early",
    });
    if (fastFaq) {
      reply = fastFaq.reply;
      orchResult = {
        agentKey: "front-office",
        intent: fastFaq.intent,
        routingConfidence: 1,
        escalated: false,
        toolsUsed: ["faq-fast-path"],
        fastPath: true,
      };
      console.info(`[Autoreply] Fast-path FAQ (${fastFaq.intent}) for ${phone.slice(-6)}`);
    }
  }

  // Jangan tanya tanggal ULANG bila tanggal sudah tersimpan dari turn
  // sebelumnya (booking-state slots / chat summary). Insiden 3 Juli 2026:
  // tamu tanya "7-8 Agustus" → dijawab penuh → tamu bilang "kalo ada yg
  // kosong kabari ya" → bot balik bertanya "rencana menginap tanggal
  // berapa?" padahal tanggalnya baru saja dibahas. Dengan guard ini pesan
  // jatuh ke buildContextualBookingInquiryReply yang memakai tanggal
  // tersimpan.
  const storedAvailabilitySlots = ((bookingState as any)?.slots ?? {}) as Record<string, unknown>;
  const hasStoredAvailabilityDates = !!(
    (storedAvailabilitySlots.checkIn ?? chatSummaryJson?.check_in) &&
    (storedAvailabilitySlots.checkOut ?? chatSummaryJson?.check_out)
  );
  if (!reply && !isManager && !bookingActive && !multiPendingInbound && lastMessage && !hasStoredAvailabilityDates) {
    const needDatesReply = buildRecentAvailabilityNeedDatesReply(rollingMessages);
    if (needDatesReply) {
      reply = needDatesReply.reply;
      orchResult = {
        agentKey: "front-office",
        intent: needDatesReply.intent,
        routingConfidence: 1,
        escalated: false,
        toolsUsed: ["deterministic-availability"],
        fastPath: true,
      };
      console.info(`[Autoreply] Deterministic availability need-dates reply for ${phone.slice(-6)}`);
    }
  }

  // Guard "malam ini": tamu yang bertanya JAM ("bisa check-in hari ini jam 8
  // malam?") sedang bertanya kebijakan waktu, bukan harga malam ini.
  const asksTimeNotPrice = /\b(jam|pukul|check\s*[- ]?in|checkin|check\s*[- ]?out|checkout)\b/i.test(lastMessage ?? "");
  if (!reply && !isManager && !bookingActive && !multiPendingInbound && isTonightReply(lastMessage) && !asksTimeNotPrice && hasRecentPriceContext(rollingMessages)) {
    try {
      const tonightReply = await buildTonightPriceReply({
        rooms: rooms ?? [],
        property: p,
        origin,
      });
      if (tonightReply) {
        reply = tonightReply.reply;
        orchResult = {
          agentKey: "front-office",
          intent: tonightReply.intent,
          routingConfidence: 1,
          escalated: false,
          toolsUsed: ["deterministic-tonight-availability"],
          fastPath: true,
        };
        console.info(`[Autoreply] Deterministic tonight price reply for ${phone.slice(-6)}`);
      }
    } catch (e) {
      console.warn("[Autoreply] deterministic tonight price failed (falling back to AI):", e);
    }
  }

  if (!reply && !isManager && !bookingActive && !multiPendingInbound && lastMessage) {
    try {
      const activeSlots = ((bookingState as any)?.slots ?? {}) as Record<string, unknown>;
      const availabilitySlots = {
        checkIn: activeSlots.checkIn ?? chatSummaryJson?.check_in,
        checkOut: activeSlots.checkOut ?? chatSummaryJson?.check_out,
      };
      const guestCountReply = await buildGuestCountAfterAvailabilityReply({
        message: lastMessage,
        rooms: rooms ?? [],
        property: p,
        origin,
        dates: availabilitySlots,
        messages: rollingMessages,
      });
      if (guestCountReply) {
        reply = guestCountReply.reply;
        orchResult = {
          agentKey: "front-office",
          intent: guestCountReply.intent,
          routingConfidence: 1,
          escalated: false,
          toolsUsed: ["deterministic-availability"],
          fastPath: true,
        };
        console.info(`[Autoreply] Deterministic availability guest-count reply for ${phone.slice(-6)}`);
      }
    } catch (e) {
      console.warn("[Autoreply] deterministic guest-count availability failed (falling back to AI):", e);
    }
  }

  if (!reply && !isManager && !bookingActive && !multiPendingInbound && lastMessage) {
    try {
      const availabilityReply = await buildDeterministicAvailabilityReply({
        message: lastMessage,
        rooms: rooms ?? [],
        property: p,
        origin,
      });
      if (availabilityReply) {
        reply = availabilityReply.reply;
        orchResult = {
          agentKey: "front-office",
          intent: availabilityReply.intent,
          routingConfidence: 1,
          escalated: false,
          toolsUsed: ["deterministic-availability"],
          fastPath: true,
        };
        console.info(`[Autoreply] Deterministic availability reply for ${phone.slice(-6)}`);

        // Persist tanggal yang ditanyakan ke conversation-state. Jalur ini
        // melewati orchestrator, jadi tanpa ini slot tanggal tak pernah
        // tersimpan dan turn berikutnya (mis. "per malam berapa?") akan
        // menanyakan tanggal lagi. Fire-and-forget — tak boleh menggagalkan reply.
        if (availabilityReply.dates) {
          const { checkIn, checkOut } = availabilityReply.dates;
          void runDeferred("Autoreply.persist-availability-dates", async () => {
            const { error } = await (supabaseAdmin as any).rpc("update_conversation_topic", {
              p_phone: phone,
              p_last_topic: "availability",
              p_last_entity: null,
              p_slots: { checkIn, checkOut },
            });
            if (error) console.warn("[Autoreply] persist availability dates failed:", error.message);
          });
        }
      }
    } catch (e) {
      console.warn("[Autoreply] deterministic availability failed (falling back to AI):", e);
    }
  }

  // Fast-path kontekstual booking_inquiry: pesan tanya kamar/harga tanpa
  // menyebut tanggal, tetapi tanggal sudah tersimpan di slot/summary.
  // Jalur ini WAJIB dijalankan sebelum LLM supaya beban tinggi tidak
  // memaksa orkestrator agent (p95 ~15 s) untuk pekerjaan yang bisa
  // dihitung deterministik dari `checkRoomAvailability`.
  if (!reply && !isManager && !bookingActive && !multiPendingInbound && lastMessage) {
    try {
      const contextualReply = await buildContextualBookingInquiryReply({
        message: lastMessage,
        rooms: rooms ?? [],
        property: p,
        origin,
        bookingSlots: ((bookingState as any)?.slots ?? null) as Record<string, unknown> | null,
        chatSummary: chatSummaryJson as any,
      });
      if (contextualReply) {
        reply = contextualReply.reply;
        orchResult = {
          agentKey: "front-office",
          intent: contextualReply.intent,
          routingConfidence: 1,
          escalated: false,
          toolsUsed: ["deterministic-availability", "context-slots"],
          fastPath: true,
        };
        console.info(`[Autoreply] Contextual booking_inquiry fast-path for ${phone.slice(-6)}`);

        if (contextualReply.dates) {
          const { checkIn, checkOut } = contextualReply.dates;
          void runDeferred("Autoreply.persist-contextual-availability-dates", async () => {
            const { error } = await (supabaseAdmin as any).rpc("update_conversation_topic", {
              p_phone: phone,
              p_last_topic: "availability",
              p_last_entity: null,
              p_slots: { checkIn, checkOut },
            });
            if (error) console.warn("[Autoreply] persist contextual dates failed:", error.message);
          });
        }
      }
    } catch (e) {
      console.warn("[Autoreply] contextual booking_inquiry fast-path failed (falling back to AI):", e);
    }
  }


  // Fast-path deterministik untuk FAQ properti ringan (greeting, thanks,
  // alamat, kontak, jam check-in/out). Dijalankan setelah booking-inquiry
  // fast-path supaya "halo, ada kamar ga?" tetap masuk ke availability.
  if (!reply && !isManager && !bookingActive && !multiPendingInbound && lastMessage) {
    try {
      const propertyFaq = buildPropertyFaqReply({
        message: lastMessage,
        property: p as Record<string, unknown>,
        rooms: (rooms ?? []) as any[],
        greetingUsed: faqGreetingUsed,
        mode: "late",
      });
      if (propertyFaq) {
        reply = propertyFaq.reply;
        orchResult = {
          agentKey: "front-office",
          intent: propertyFaq.intent,
          routingConfidence: 1,
          escalated: false,
          toolsUsed: ["property-faq-template"],
          fastPath: true,
        };
        console.info(`[Autoreply] Property FAQ fast-path (${propertyFaq.intent}) for ${phone.slice(-6)}`);
      }
    } catch (e) {
      console.warn("[Autoreply] property FAQ fast-path failed:", e);
    }
  }


  const explicitKey = p.ai_api_key?.trim();
  const lovableKey = process.env.LOVABLE_API_KEY?.trim();
  const useLovable = !explicitKey && !!lovableKey;
  const apiKey = explicitKey || lovableKey;
  if (!apiKey && !reply) return "no_api_key";

  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : (p.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const cfgModel = p.ai_model?.trim();
  const model = useLovable
    ? cfgModel?.includes("/")
      ? cfgModel
      : "google/gemini-2.5-flash"
    : cfgModel || "gpt-4o-mini";
  const llmConfig = apiKey ? { apiKey, baseUrl, model } : null;

  const aiCfgRaw = p.ai_lab_config as any;
  const sopEnabled = aiCfgRaw?.tools?.["sop-knowledge"]?.enabled ?? true;
  let sopText = "";
  let brosurFiles: { name: string; url: string }[] = [];

  const isQueueRetry = queueAttempt > 1;
  const loadHeavyRetrieval = !isQueueRetry && shouldLoadHeavyRetrieval(lastMessage);

  // O1: retrieval training signals dimulai DI SINI, paralel dengan SOP
  // retrieval di bawah — keduanya independen (embedding + RPC masing-masing).
  // Dulu serial: SOP selesai dulu baru training mulai, menambah ~0,3-0,8s.
  const trainingSignalsPromise =
    !reply && llmConfig && loadHeavyRetrieval
      ? findTrainingSignals(
          supabaseAdmin as any,
          {
            userMessage: lastMessage ?? "",
            stage: (chatSummaryJson?.last_topic ?? null) as string | null,
            conversationContext: rollingMessages
              .slice(-6)
              .map((message) => `${message.direction === "in" ? "Tamu" : "Asisten"}: ${message.body}`)
              .join("\n"),
            roomType: (chatSummaryJson?.room_type ?? null) as string | null,
          },
          llmConfig,
          { positiveLimit: 2, negativeLimit: 0 },
        ).catch((e) => {
          console.warn("[Autoreply] training retrieval failed (non-fatal):", e);
          return { positiveExamples: [] as any[], negativeExamples: [] as any[] };
        })
      : null;

  if (sopEnabled && !reply && llmConfig && loadHeavyRetrieval) {
    try {
      const sopQuery = [lastMessage, chatSummaryJson?.last_topic, chatSummaryJson?.room_type]
        .filter(Boolean)
        .join(" ");
      const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
      const [relevantSop, { data: brosurDocs }] = await Promise.all([
        sopQuery.trim()
          ? retrieveRelevantSopContext(supabaseAdmin as any, sopQuery, llmConfig, 3, 0.65)
          : Promise.resolve(""),
        (supabaseAdmin as any)
          .from("sop_documents")
          .select("name, file_path, doc_category, storage_bucket")
          .order("created_at", { ascending: true })
          .limit(40),
      ]);

      sopText = relevantSop.slice(0, 2500);
      brosurFiles = ((brosurDocs ?? []) as any[])
        .filter(isBrosurDoc)
        .filter((d) => d.file_path)
        .map((d) => {
          const bucket = (d.storage_bucket as string | undefined)?.trim() || "sop-documents";
          return {
            name: d.name,
            url: `${supabaseUrl}/storage/v1/object/public/${bucket}/${d.file_path}`,
          };
        });
    } catch (e) {
      console.warn("[Autoreply] relevant SOP retrieval failed (continuing without SOP):", e);
    }
  }

  // ── Frustration / trust detection ──────────────────────────────────────
  // Tamu nulis "saya pusing", "ini benar?", "penipuan", "tidak AI kan?" dll.
  // Short-circuit sebelum AI dijalankan — kirim ringkasan booking + verifikasi
  // resmi, dan (kalau frustrasi) tandai handoff ke admin manusia.
  if (!manager && lastMessage) {
    try {
      const { detectFrustration, buildFrustrationReply, markHumanHandoff, createHandoffTicket } =
        await import("@/services/frustration-detector");
      const kind = detectFrustration(lastMessage);
      if (kind) {
        const { data: bs } = await (supabaseAdmin as any).rpc("get_active_booking_state", { p_phone: phone });
        const bookingContext = (bs as { context?: unknown } | null)?.context ?? {};
        const { reply: fReply, shouldHandoff } = buildFrustrationReply(kind, bookingContext);
        reply = fReply;
        if (shouldHandoff) {
          await markHumanHandoff(supabaseAdmin, phone, bookingContext);
          // Buat tiket admin (dengan ringkasan booking, skor frustrasi, status open).
          const ticket = await createHandoffTicket(supabaseAdmin as any, {
            phone,
            threadId: c.thread_id ?? null,
            kind,
            triggerMessage: lastMessage,
            context: bookingContext,
          });
          // Notify super admin secara fire-and-forget.
          deferAfterReply("Autoreply.handoffNotify", async () => {
            try {
              const { notifyBotLoop } = await import("@/services/manager-notifier.service");
              await notifyBotLoop(supabaseAdmin as any, {
                phone,
                threadId: c.thread_id,
                toolName: "human-handoff",
                repeatCount: 1,
                lastArgs: JSON.stringify({ trigger: lastMessage.slice(0, 200), ticketId: ticket?.id }),
                sampleOutput: "Frustration detected — tamu butuh admin manusia. Tiket dibuat.",
              });
            } catch (e) {
              console.warn("[Autoreply] handoff notify failed:", e);
            }
          });
        }
        console.info(`[Autoreply] Frustration short-circuit (${kind}) for ${phone.slice(-6)}`);
      }
    } catch (e) {
      console.warn("[Autoreply] Frustration detector failed (non-fatal):", e);
    }
  }

  // Quick-ack "saya cekkan dulu ya" tidak pantas untuk pesan penutup/basa-basi
  // ("Yahh, oke kak makasih ya") — tidak ada yang perlu dicek. Fast-path thanks
  // biasanya sudah menangkap ini; guard ini melindungi varian yang lolos.
  const CLOSING_CHITCHAT_RE =
    /\b(makasih|terima\s*kasih|trims?|trimakasih|thanks?|thank\s*you|thx|tq|sama\s*-?\s*sama|mantap|oke?\s*deh|ya\s*udah?|yaudah|sampai\s*(jumpa|ketemu)|see\s*you|bye)\b/i;
  const isClosingChitchat =
    (lastMessage ?? "").trim().length <= 60 &&
    !(lastMessage ?? "").includes("?") &&
    CLOSING_CHITCHAT_RE.test(lastMessage ?? "");

  let quickAckTimer: ReturnType<typeof setTimeout> | undefined;
  if (QUICK_ACK_ENABLED && !reply && !isManager && queueEntryId && c.wpp_token && !isClosingChitchat) {
    quickAckTimer = setTimeout(() => {
      void (async () => {
        try {
          // (1) Cek existing ack untuk entry ini.
          const { data: existingAck } = await (supabaseAdmin as any)
            .from("whatsapp_messages")
            .select("id")
            .eq("thread_id", c.thread_id)
            .eq("direction", "out")
            .filter("metadata->>queue_entry_id", "eq", queueEntryId)
            .filter("metadata->>is_ack", "eq", "true")
            .limit(1);
          if ((existingAck ?? []).length > 0) return;

          // (2) Persist-then-send + race guard: tulis baris ack 'pending'
          // dulu, lalu pastikan baris kita yang paling awal. Kalau bukan,
          // worker lain sudah menulis duluan → skip kirim Wpp.
          const ackRowId = await saveOutboundMessage(supabaseAdmin, {
            threadId: c.thread_id,
            body: QUICK_ACK_MESSAGE,
            metadata: {
              agent: "system",
              agent_key: "quick-ack",
              is_ack: true,
              queue_entry_id: queueEntryId,
              send_status: "pending",
            } as any,
          });

          const { data: allAcks } = await (supabaseAdmin as any)
            .from("whatsapp_messages")
            .select("id, sent_at")
            .eq("thread_id", c.thread_id)
            .eq("direction", "out")
            .filter("metadata->>queue_entry_id", "eq", queueEntryId)
            .filter("metadata->>is_ack", "eq", "true")
            .order("sent_at", { ascending: true })
            .limit(5);
          const winnerId = (allAcks ?? [])[0]?.id ?? null;
          if (winnerId && winnerId !== ackRowId) {
            // Kalah race: tandai baris kita superseded supaya tidak mengganggu dedup body.
            try {
              await (supabaseAdmin as any)
                .from("whatsapp_messages")
                .update({
                  metadata: {
                    agent: "system",
                    agent_key: "quick-ack",
                    is_ack: true,
                    queue_entry_id: queueEntryId,
                    send_status: "superseded",
                  } as any,
                })
                .eq("id", ackRowId);
            } catch {
              // ignore
            }
            return;
          }

          const { ok, error: ackErr } = await sendWhatsAppMessage(c.wpp_token, sendTarget, QUICK_ACK_MESSAGE);
          if (!ok) {
            console.warn(`[Autoreply] quick ack failed for ${phone.slice(-6)}: ${ackErr}`);
            try {
              await (supabaseAdmin as any)
                .from("whatsapp_messages")
                .update({
                  metadata: {
                    agent: "system",
                    agent_key: "quick-ack",
                    is_ack: true,
                    queue_entry_id: queueEntryId,
                    send_status: "failed",
                  } as any,
                })
                .eq("id", ackRowId);
            } catch {
              // ignore
            }
            return;
          }
          metrics.ackSentAt = Date.now();
          try {
            await (supabaseAdmin as any)
              .from("whatsapp_messages")
              .update({
                metadata: {
                  agent: "system",
                  agent_key: "quick-ack",
                  is_ack: true,
                  queue_entry_id: queueEntryId,
                  send_status: "sent",
                  latency_ms: metrics.ackSentAt - metrics.workerStartedAt,
                } as any,
              })
              .eq("id", ackRowId);
          } catch {
            // ignore
          }
          console.info(`[Autoreply] quick ack sent to ${phone.slice(-6)} (entry ${queueEntryId.slice(0, 8)})`);
        } catch (e) {
          console.warn("[Autoreply] quick ack error (non-fatal):", e);
        }
      })();
    }, QUICK_ACK_AFTER_MS);
  }

  let trainingExamples: any[] = [];
  let negativeExamples: any[] = [];
  if (!reply && trainingSignalsPromise) {
    const trainingSignals = await trainingSignalsPromise;
    trainingExamples = trainingSignals.positiveExamples;
    negativeExamples = trainingSignals.negativeExamples;

    if (trainingExamples.length > 0) {
      const top = trainingExamples[0];
      console.info(
        `[Autoreply] Training retrieval: ${trainingExamples.length} contoh ` +
          `(top ${top.source}/${top.similarity.toFixed(2)})`,
      );
    }
    if (negativeExamples.length > 0) {
      console.info(
        `[Autoreply] Negative retrieval: ${negativeExamples.length} contoh buruk ` +
          `(top sim ${negativeExamples[0].similarity.toFixed(2)})`,
      );
    }
  }

  for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS && !reply; attempt++) {
    if (attempt > 1) await sleep(Math.min(1000 * attempt, 3000));
    // Extend the worker lock before each (potentially slow) AI attempt.
    if (onBeforeAttempt) await onBeforeAttempt().catch(() => {});
    const controller = new AbortController();
    const aiBudgetMs = pickAiBudgetMs(lastMessage ?? "");
    const aiTimeout = setTimeout(() => controller.abort(), aiBudgetMs);
    if (!metrics.aiStartedAt) metrics.aiStartedAt = Date.now();
    const tStart = Date.now();
    try {
      const consecutiveInbound = countConsecutiveInbound(rollingMessages);
      const recoveryMode = consecutiveInbound >= 3;
      const unansweredMessages = recoveryMode
        ? getLastNInboundMessages(rollingMessages, consecutiveInbound)
        : undefined;

      orchResult = await runMultiAgentOrchestration({
        phone,
        isManager,
        messages: rollingMessages,
        agentCtx: {
          property: p,
          rooms: rooms || [],
          sopText,
          brosurFiles,
          today: todayWIB(),
          lastMessage,
          chatSummary,
          chatSummaryJson,
          managerName: manager?.name ?? (isManager ? "Admin" : undefined),
          mode: isManager ? "managerial" : undefined,
          recoveryMode,
          unansweredMessages,
          trainingExamples: trainingExamples.map((ex) => ({
            id: ex.id,
            intent: ex.intent,
            stage: ex.stage,
            user_message: ex.user_message,
            ideal_assistant_response: ex.ideal_assistant_response,
          })),
          negativeExamples: negativeExamples.map((ex) => ({
            id: ex.id,
            user_message: ex.user_message,
            bad_response: ex.bad_response,
            correction: ex.correction,
          })),
        },
        toolCtx: {
          supabasePublic: supabasePublic as any,
          supabaseAdmin: supabaseAdmin as any,
          rooms: rooms || [],
          property: p,
          today: todayWIB(),
          origin,
          idempotencyKey: queueEntryId ? `wa_queue:${queueEntryId}` : undefined,
          llmConfig: llmConfig!,
        },
        llmConfig: llmConfig!,
        signal: controller.signal,
      });

      // Log any retry attempts that happened inside this run
      if (orchResult?.retries && orchResult.retries.length > 0) {
        const rows = orchResult.retries.map((r: any) => ({
          thread_id: c.thread_id,
          phone,
          agent_key: orchResult.agentKey ?? "front-office",
          attempt: r.attempt + 1, // 0-based to 1-based
          reason: r.reason,
          model,
          latency_ms: r.latency_ms,
          resolved: false,
          queue_entry_id: queueEntryId || null,
        }));
        try {
          await (supabaseAdmin as any).from("ai_retry_audit").insert(rows);
        } catch (err) {
          console.warn("[Autoreply] Failed to log retry audits:", err);
        }
      }

      if (orchResult?.reply) {
        reply = orchResult.reply;

        // Heartbeat berbasis kemajuan: orkestrasi AI (bagian terlama pipeline)
        // baru saja selesai — segarkan lock SEKARANG, jangan bergantung pada
        // setInterval yang tick-nya bisa di-skip Cloudflare saat CPU sibuk.
        if (onBeforeAttempt) await onBeforeAttempt().catch(() => {});

        console.info(`[Inbound Processing] Phone: ${phone.slice(-6)} | Mode: ${mode} | PrevState: ${bookingState?.state || "IDLE"} | Msg: "${lastMessage}" | Agent: ${orchResult.agentKey} | Intent: ${orchResult.intent} | Tools: ${(orchResult.toolsUsed ?? []).join(",")}`);

        // Resolve all retry attempts for this message execution
        const updateQuery = (supabaseAdmin as any).from("ai_retry_audit").update({ resolved: true });
        if (queueEntryId) {
          try {
            await updateQuery.eq("queue_entry_id", queueEntryId);
          } catch (err) {
            console.warn("[Autoreply] Failed to resolve retry audits by queue entry:", err);
          }
        } else {
          const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
          try {
            await updateQuery.eq("phone", phone).eq("resolved", false).gte("created_at", twoMinutesAgo);
          } catch (err) {
            console.warn("[Autoreply] Failed to resolve retry audits by phone/time:", err);
          }
        }
        break;
      } else {
        // If runMultiAgentOrchestration returned normally but status is "error" or no reply,
        // and we haven't already logged retries (e.g. general orchestrator error), log it.
        if (orchResult?.error && (!orchResult.retries || orchResult.retries.length === 0)) {
          const latency = Date.now() - tStart;
          try {
            await (supabaseAdmin as any).from("ai_retry_audit").insert([
              {
                thread_id: c.thread_id,
                phone,
                agent_key: orchResult.agentKey ?? "front-office",
                attempt: 1,
                reason: orchResult.error === "Max turns exceeded" ? "max_turns_exceeded" : "orch_error",
                model,
                latency_ms: latency,
                resolved: false,
                queue_entry_id: queueEntryId || null,
              },
            ]);
          } catch (err) {
            console.warn("[Autoreply] Failed to log orch error:", err);
          }
        }
      }

      // Surface bot-loop signal ke super admin (fire-and-forget) —
      // berlaku baik saat ada reply maupun saat orchestrator gagal.
      if (orchResult?.loopAlert) {
        const la = orchResult.loopAlert;
        deferAfterReply("Autoreply.notifyBotLoop", async () => {
          try {
            const { notifyBotLoop } = await import("@/services/manager-notifier.service");
            await notifyBotLoop(supabaseAdmin as any, {
              phone,
              threadId: c.thread_id,
              toolName: la.toolName,
              repeatCount: la.repeatCount,
              lastArgs: la.lastArgs,
              sampleOutput: la.sampleOutput,
            });
          } catch (e) {
            console.warn("[Autoreply] notifyBotLoop failed:", e);
          }
        });
      }
    } catch (e) {
      console.error(`[Autoreply] AI attempt ${attempt}:`, e);
      const latency = Date.now() - tStart;
      const isTimeout =
        (e as { name?: string })?.name === "AbortError" ||
        String(e).includes("aborted") ||
        String(e).includes("timeout");
      const reason = isTimeout ? "timeout" : "fetch_error";
      try {
        await (supabaseAdmin as any).from("ai_retry_audit").insert([
          {
            thread_id: c.thread_id,
            phone,
            agent_key: "front-office",
            attempt: 1,
            reason,
            model,
            latency_ms: latency,
            resolved: false,
            queue_entry_id: queueEntryId || null,
          },
        ]);
      } catch (err) {
        console.warn("[Autoreply] Failed to log caught exception retry audit:", err);
      }
    } finally {
      clearTimeout(aiTimeout);
    }
  }
  if (quickAckTimer) clearTimeout(quickAckTimer);
  if (metrics.aiStartedAt && !metrics.aiFinishedAt) metrics.aiFinishedAt = Date.now();

  let finalFallback = isManager ? MANAGER_FALLBACK_MESSAGE : FALLBACK_MESSAGE;
  if (!reply && !isManager) {
    try {
      const stateRecord = await getBookingState(supabaseAdmin as any, phone);
      finalFallback = buildStateAwareFallback(stateRecord.state);
    } catch (err) {
      console.warn("[Autoreply] Failed to fetch state for fallback:", err);
    }
  }

  const rawReply = reply ?? finalFallback;
  const isFallback = !reply;
  // Saat fallback dikirim, catat ALASAN-nya supaya dashboard/Activity Log bisa
  // membedakan timeout vs. max-turns vs. gateway-error vs. balasan kosong —
  // tanpa ini kita cuma tahu "fallback terjadi" tapi tidak tahu kenapa.
  const fallbackReason = isFallback ? (orchResult?.error ?? "no_reply_after_retries") : undefined;
  let attachUrl: string | undefined;
  let attachName: string | undefined;

  if (!isFallback) {
    const picked = pickAttachment(lastMessage, rawReply, brosurFiles);
    attachUrl = picked.url;
    attachName = picked.name;
    if (picked.url) {
      console.info(`[Autoreply] Attachment selected: ${picked.name}`);
    }
  }

  // Strip any inline PDF URL that became the attachment + bare image URLs.
  const pdfToStrip = attachUrl && /\.pdf(\?|$)/i.test(attachUrl) ? attachUrl : undefined;
  const normalizedReply = normalizeBrochureReply(lastMessage, rawReply, attachName);
  let finalReply = cleanReplyBody(normalizedReply, pdfToStrip);

  // ── Duplicate-send guard ────────────────────────────────────────────────
  // Worker bisa mati setelah Wpp sukses tapi sebelum sempat menyimpan
  // outbound + memanggil queueComplete (zombie_timeout). Retry berikutnya
  // akan mencoba mengirim ulang → tamu menerima pesan dobel.
  // Dua lapis pengaman:
  //   (a) metadata.queue_entry_id sama → entry ini SUDAH pernah menghasilkan
  //       outbound. Cek TANPA batas waktu karena retry zombie bisa jalan
  //       beberapa menit setelah attempt pertama (lock TTL ~2 menit, dan
  //       jendela 120s ternyata kependekan sehingga retry lolos).
  //   (b) body identik & dikirim <300 detik terakhir → safety net untuk
  //       kasus queue_entry_id tidak tersimpan / berbeda tapi pesan sama.
  try {
    // (a) Cek by queue_entry_id TANPA filter waktu.
    if (queueEntryId) {
      const { data: existingForEntry } = await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .select("id, metadata")
        .eq("thread_id", c.thread_id)
        .eq("direction", "out")
        .filter("metadata->>queue_entry_id", "eq", queueEntryId)
        .limit(5);
      const existingFinalForEntry = (existingForEntry ?? []).find((m: any) => {
        const meta = (m.metadata ?? {}) as Record<string, unknown>;
        return meta.is_ack !== true && meta.send_status !== "failed";
      });
      if (existingFinalForEntry) {
        console.warn(
          `[Autoreply] Duplicate suppressed for ${phone.slice(-6)} ` +
            `(entry=${queueEntryId.slice(0, 8)}, match=entry)`,
        );
        return "ok";
      }
    }

    // (b) Cek body identik dalam 300 detik terakhir.
    const sinceIso = new Date(Date.now() - 300_000).toISOString();
    const { data: recentOut } = await (supabaseAdmin as any)
      .from("whatsapp_messages")
      .select("id, body, sent_at, metadata")
      .eq("thread_id", c.thread_id)
      .eq("direction", "out")
      .gte("sent_at", sinceIso)
      .order("sent_at", { ascending: false })
      .limit(5);
    const dup = (recentOut ?? []).find((m: any) => {
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      return meta.is_ack !== true && meta.send_status !== "failed" && (m.body ?? "").trim() === finalReply.trim();
    });
    if (dup) {
      console.warn(
        `[Autoreply] Duplicate suppressed for ${phone.slice(-6)} ` +
          `(entry=${queueEntryId?.slice(0, 8) ?? "-"}, match=body)`,
      );
      return "ok";
    }
  } catch (e) {
    console.warn("[Autoreply] Dedup check failed (continuing):", e);
  }

  const agentKey = orchResult?.agentKey ?? "front-office";
  const buildLatencyMetadata = () => ({
    latency_ms: Date.now() - metrics.workerStartedAt,
    ai_latency_ms:
      metrics.aiStartedAt && metrics.aiFinishedAt ? metrics.aiFinishedAt - metrics.aiStartedAt : null,
    send_latency_ms:
      metrics.sendStartedAt && metrics.sendFinishedAt ? metrics.sendFinishedAt - metrics.sendStartedAt : null,
    ack_sent: metrics.ackSentAt > 0,
    ack_latency_ms: metrics.ackSentAt ? metrics.ackSentAt - metrics.workerStartedAt : null,
    fast_path: orchResult?.fastPath === true,
  });
  const outboundMetadata = {
    agent: deriveAgentLabelFromKey(agentKey),
    tools_used: orchResult?.toolsUsed ?? [],
    agent_key: agentKey,
    intent: orchResult?.intent,
    routing_confidence: orchResult?.routingConfidence,
    escalated: orchResult?.escalated,
    is_fallback: isFallback,
    fallback_reason: fallbackReason,
    training_examples_used: orchResult?.trainingExamplesUsed ?? 0,
    training_example_ids: orchResult?.trainingExampleIds ?? [],
    queue_entry_id: queueEntryId ?? null,
    ...buildLatencyMetadata(),
  };

  // Persist outbound BEFORE calling Wpp. Kalau worker mati setelah Wpp
  // sukses, baris ini sudah ada dan dedup-guard di atas akan mencegah
  // pengiriman ulang pada retry berikutnya.
  const outboundRowId = await saveOutboundMessage(supabaseAdmin, {
    threadId: c.thread_id,
    body: finalReply,
    metadata: {
      ...outboundMetadata,
      send_status: "pending",
    } as any,
  });

  // ── Atomic claim per queue_entry_id ────────────────────────────────────
  // Dedup-guard di atas read-then-write: dua worker konkuren bisa sama-sama
  // lolos pengecekan dan dua-duanya menulis baris 'pending' + memanggil
  // Wpp → tamu menerima pesan dobel. Setelah persist, pastikan baris
  // kita adalah final-reply pertama untuk entry ini. Kalau ada baris lebih
  // awal (non-ack, non-failed/superseded) milik worker lain, tandai punya
  // kita superseded dan jangan kirim.
  if (outboundRowId && queueEntryId) {
    try {
      const { data: peers } = await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .select("id, sent_at, metadata")
        .eq("thread_id", c.thread_id)
        .eq("direction", "out")
        .filter("metadata->>queue_entry_id", "eq", queueEntryId)
        .order("sent_at", { ascending: true })
        .limit(10);
      const finalPeers = (peers ?? []).filter((m: any) => {
        const meta = (m.metadata ?? {}) as Record<string, unknown>;
        return meta.is_ack !== true && meta.send_status !== "failed" && meta.send_status !== "superseded";
      });
      const winnerId = finalPeers[0]?.id ?? null;
      if (winnerId && winnerId !== outboundRowId) {
        try {
          await (supabaseAdmin as any)
            .from("whatsapp_messages")
            .update({ metadata: { ...outboundMetadata, send_status: "superseded" } as any })
            .eq("id", outboundRowId);
        } catch {
          // ignore
        }
        console.warn(
          `[Autoreply] Final-reply race lost for ${phone.slice(-6)} ` +
            `(entry=${queueEntryId.slice(0, 8)}) — skip Wpp`,
        );
        void updateBookingFormSendLog({ body: finalReply, status: "superseded" });
        return "ok";
      }
    } catch (e) {
      console.warn("[Autoreply] Atomic claim check failed (continuing):", e);
    }
  }

  // Heartbeat berbasis kemajuan: sebelum langkah I/O terakhir (Wpp),
  // pastikan lock masih milik worker ini walau setInterval sempat di-skip.
  if (onBeforeAttempt) await onBeforeAttempt().catch(() => {});

  metrics.sendStartedAt = Date.now();
  let { ok: sent, error: sendErr } = await sendWhatsAppMessage(
    c.wpp_token,
    sendTarget,
    finalReply,
    attachUrl,
    attachName,
  );
  metrics.sendFinishedAt = Date.now();

  // If the attachment broke the send (e.g. unreachable file URL), retry with
  // the direct link appended so the guest still gets the brochure.
  if (!sent && attachUrl) {
    console.warn(`[Autoreply] Send with attachment failed (${sendErr}) — retrying with link`);
    metrics.sendStartedAt = Date.now();
    ({ ok: sent, error: sendErr } = await sendWhatsAppMessage(
      c.wpp_token,
      sendTarget,
      `${finalReply}\n\n${attachUrl}`.trim(),
    ));
    metrics.sendFinishedAt = Date.now();
  }

  // Matikan indikator "sedang mengetik" setelah kirim (sukses/gagal). Best-effort.
  try { void setWppTyping(c.wpp_token, sendTarget, false); } catch { /* non-fatal */ }



  if (!sent) {
    console.error(`[Autoreply] Send failed ${phone}: ${sendErr}`);
    // Tandai outbound row sebagai gagal kirim supaya retry tahu boleh kirim ulang
    // (dedup-guard mengandalkan body+window, jadi tetap aman dari double-send).
    if (outboundRowId) {
      try {
        await (supabaseAdmin as any)
          .from("whatsapp_messages")
          .update({
            metadata: {
              ...outboundMetadata,
              send_status: "failed",
              error: String(sendErr),
              ...buildLatencyMetadata(),
            } as any,
          })
          .eq("id", outboundRowId);
      } catch {
        /* non-fatal */
      }
    }
    void updateBookingFormSendLog({
      body: finalReply,
      status: "failed",
      failureReason: String(sendErr ?? "unknown"),
    });
    return "send_failed";
  }

  if (outboundRowId) {
    try {
      await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .update({
          metadata: {
            ...outboundMetadata,
            send_status: "sent",
            ...buildLatencyMetadata(),
          } as any,
        })
        .eq("id", outboundRowId);
    } catch (e) {
      console.warn("[Autoreply] Failed to update send_status (non-fatal):", e);
    }
  }

  void updateBookingFormSendLog({ body: finalReply, status: "sent" });

  await markReplyCommitted();

  void updateThreadAutoReplyMeta(supabaseAdmin, {
    threadId: c.thread_id,
    toolsUsed: orchResult?.toolsUsed ?? [],
  }).catch((e) => console.warn(e));

  // ── Conversation Monitor (fire-and-forget) ──────────────────────────────
  // Hitung berapa kali berturut-turut fallback dalam sesi ini.
  // Kami perkirakan dari metadata pesan outbound terakhir — bukan state
  // persisten agar tidak menambah latensi ke hot-path.
  deferAfterReply("Autoreply.conversationMonitor", async () => {
    try {
      // Hitung consecutive fallbacks: lihat N pesan outbound terakhir
      const { data: recentOut } = await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .select("metadata")
        .eq("thread_id", c.thread_id)
        .eq("direction", "out")
        .order("sent_at", { ascending: false })
        .limit(5);
      let consecutiveFallbacks = 0;
      for (const msg of (recentOut ?? []) as any[]) {
        if ((msg.metadata as any)?.is_fallback) consecutiveFallbacks++;
        else break;
      }
      if (isFallback) consecutiveFallbacks++; // hitung yang baru

      // Ambil guest name dari thread
      const { data: threadRow } = await (supabaseAdmin as any)
        .from("whatsapp_threads")
        .select("display_name, ai_auto")
        .eq("id", c.thread_id)
        .maybeSingle();
      const guestName = (threadRow as any)?.display_name ?? null;
      const aiAutoOn = (threadRow as any)?.ai_auto !== false;

      await checkConversation({
        db: supabaseAdmin as any,
        threadId: c.thread_id,
        phone,
        guestName,
        messages: rollingMessages,
        aiStatus: aiAutoOn ? "auto" : "human",
        isFallback,
        consecutiveFallbacks,
        summaryNeedsHuman: chatSummaryJson?.needs_human === true,
        summaryHandoffReason: chatSummaryJson?.handoff_reason ?? null,
      });
    } catch (e) {
      console.warn("[Autoreply] ConvMonitor check failed (non-fatal):", e);
    }
  });

  // Background summarizer: run AFTER the reply is sent so it never adds
  // latency to the user-visible turn. Perilaku (per keputusan produk):
  //   - Merangkum SESI BERJALAN setiap turn (bukan menunggu batas sesi 15 mnt),
  //     supaya panel admin terisi cepat begitu ada ≥3 pesan.
  //   - Butuh cukup pesan untuk layak dirangkum (SUMMARY_MIN_MESSAGES).
  //   - Cooldown (3 mnt) membatasi biaya; kata kunci penting meng-override-nya.
  //   - Saat tamu sedang mid-booking: TETAP perbarui context JSON (tipe kamar,
  //     status booking) tapi JANGAN timpa ringkasan TEKS — teks "wrap-up" baru
  //     ditulis setelah booking selesai agar tidak basi.
  // Pakai sesi yang sedang berjalan; fallback ke sesi sebelumnya bila perlu.
  const summarizableMessages =
    currentSessionMessages.length >= SUMMARY_MIN_MESSAGES ? currentSessionMessages : previousSession;
  // unresolved_question memaksa regen: begitu agent menjawabnya di turn ini,
  // summary harus segera diperbarui agar field-nya terhapus — tanpa ini,
  // cooldown 3 menit membuat "pertanyaan belum dijawab" basi menempel dan
  // terus disuntikkan ke prompt turn-turn berikutnya.
  const forced = shouldForceSummary(lastMessage) || !!chatSummaryJson?.unresolved_question;
  const summaryTextMissing = !chatSummary.trim();

  // Fallback deterministik: kalau kolom `chat_summary` masih kosong (thread
  // baru, LLM belum tersedia, atau LLM path akan di-skip), tanam seed dari
  // regex sederhana lewat waitUntil. Regex murni <5 ms — dan karena
  // dijalankan di dalam runDeferred (waitUntil di CF), TIDAK menambah
  // latency ke balasan tamu. Ini memastikan panel admin selalu punya
  // ringkasan minimal walau LLM regen gagal/di-skip.
  if (summaryTextMissing) {
    deferAfterReply("Autoreply.summarySeedFallback", async () => {
      try {
        const { seedMissingThreadSummary } = await import("@/services/whatsapp-summary.service");
        const res = await seedMissingThreadSummary(supabaseAdmin, c.thread_id);
        if (res.updated) {
          console.info(`[SessionSummarizer] seed fallback applied (thread ${c.thread_id.slice(0, 8)})`);
        }
      } catch (e) {
        console.warn("[SessionSummarizer] seed fallback failed:", e);
      }
    });
  }

  if (summarizableMessages.length < SUMMARY_MIN_MESSAGES) {
    // not enough — silent skip (seed fallback di atas sudah menutupi)
  } else if (!llmConfig) {
    console.info(`[SessionSummarizer] summary skipped: no LLM config (thread ${c.thread_id.slice(0, 8)})`);
  } else if (cooldownActive(chatSummaryUpdatedAt) && !forced) {
    console.info(`[SessionSummarizer] summary skipped: cooldown (thread ${c.thread_id.slice(0, 8)})`);
  } else {
    if (forced && cooldownActive(chatSummaryUpdatedAt)) {
      console.info(
        `[SessionSummarizer] cooldown di-override karena pesan penting ` + `(thread ${c.thread_id.slice(0, 8)})`,
      );
    }
    deferAfterReply("Autoreply.sessionSummarizer", async () => {
      try {
        const { data: bs } = await (supabaseAdmin as any).rpc("get_active_booking_state", { p_phone: phone });
        const bookingActive = !!(bs && bs.state && bs.state !== "IDLE");
        const summary = await generateSessionSummary(summarizableMessages, chatSummary, llmConfig);
        if (summary) {
          // Saat booking aktif → jsonOnly (jangan timpa teks). Selain itu → full.
          await updateThreadSummary(supabaseAdmin, c.thread_id, summary, {
            jsonOnly: bookingActive,
          });
          console.info(
            `[SessionSummarizer] summary ${bookingActive ? "json-only " : ""}` +
              `generated for ${phone.slice(-6)} ` +
              `(thread ${c.thread_id.slice(0, 8)}, ${summary.short_summary.length} chars, ` +
              `topic=${summary.last_topic ?? "-"}, room=${summary.room_type ?? "-"}, ` +
              `forced=${forced}, bookingActive=${bookingActive})`,
          );
        }
      } catch (e) {
        console.warn("[SessionSummarizer] Background run failed:", e);
      }
    });
  }


  flushDeferredAfterReply();

  console.log(
    `[Autoreply] ✓ Sent to ${phone.slice(-6)} ` +
      `(latency=${Date.now() - metrics.workerStartedAt}ms, ` +
      `ai=${buildLatencyMetadata().ai_latency_ms ?? "-"}ms, ` +
      `send=${buildLatencyMetadata().send_latency_ms ?? "-"}ms, ` +
      `fastPath=${orchResult?.fastPath === true}, ack=${metrics.ackSentAt > 0})`,
  );
  return "ok";
}

function cooldownActive(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  return ageMs < SUMMARY_REGEN_COOLDOWN_MS;
}

// Outcomes that must NOT be retried — they are config/permanent, so retrying
// just burns attempts and delays the 'failed' terminal state.
const NON_RETRYABLE_OUTCOMES: ReadonlySet<AutoreplyOutcome> = new Set(["skipped_config", "no_api_key"]);
const FALLBACK_SENT_MARKER_RE = /\[fallback_sent(?::[^\]]+)?\]/;

function hasFallbackSentMarker(lastError: unknown): boolean {
  return typeof lastError === "string" && FALLBACK_SENT_MARKER_RE.test(lastError);
}

function withFallbackSentMarker(lastError: unknown, marker: "[fallback_sent]" | "[fallback_sent:skipped]" | "[fallback_sent:claimed]" | "[fallback_sent:send_failed]"): string {
  const base = typeof lastError === "string" ? lastError.trim() : "";
  if (FALLBACK_SENT_MARKER_RE.test(base)) return base.slice(0, 500);
  return `${base} ${marker}`.trim().slice(0, 500);
}

/**
 * Poll-based worker: drain all currently-ready queue entries.
 *
 * Each iteration atomically claims the next ready entry (wa_queue_claim_next,
 * FOR UPDATE SKIP LOCKED), generates + sends the reply, then marks the entry
 * complete/failed under the claiming worker_id. The debounce/idle window is
 * enforced entirely by process_after in the DB — this worker never sleeps
 * waiting for it, so it is safe to run on a short interval and across many
 * instances concurrently (each entry is claimed by exactly one worker).
 *
 * Returns how many entries were processed in this invocation.
 */
export async function drainQueue(
  origin: string,
  maxBatch = 1,
  abortSignal?: AbortSignal,
): Promise<{ processed: number }> {
  const workerId = `w-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

  // 1) Claim up to `maxBatch` entries in parallel. Each claim hits
  // FOR UPDATE SKIP LOCKED so concurrent claims don't collide.
  const claimResults = await Promise.allSettled(
    Array.from({ length: maxBatch }, () => queueClaimNext(supabaseAdmin, workerId)),
  );
  const claims = claimResults
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((c): c is NonNullable<typeof c> => !!c);

  if (claims.length === 0) return { processed: 0 };

  // 2) Process claims concurrently. Each entry has its own heartbeat so a
  // slow one doesn't starve the others. If `abortSignal` fires we skip
  // starting new work — claims already in-flight finish or fail normally.
  const handleOne = async (claim: (typeof claims)[number]) => {
    const logPhone = claim.phone.slice(-6);
    let outcome: AutoreplyOutcome = "fatal";
    let queueCompleted = false;
    const completeQueue = async (completionResult: string) => {
      if (queueCompleted) return;
      await queueComplete(supabaseAdmin, claim.entryId, workerId, completionResult);
      queueCompleted = true;
    };

    // Kirim heartbeat pertama SEGERA setelah klaim supaya lock langsung
    // di-refresh (jangan menunggu tick pertama). Lalu tick tiap 7 detik —
    // lebih rapat dari TTL 40s (≈5 tick slack) supaya worker yang masih hidup
    // tapi sibuk (LLM + tools) tidak salah ditandai zombie oleh cron cleanup.
    void queueHeartbeat(supabaseAdmin, claim.entryId, workerId).catch(() => {});
    const heartbeatTimer = setInterval(() => {
      void queueHeartbeat(supabaseAdmin, claim.entryId, workerId).catch(() => {});
    }, 7_000);

    // Deadline dinding-jam per klaim: kalau pipeline (orkestrasi + persist +
    // Wpp) melewati batas, kita paksa outcome fatal supaya cabang di bawah
    // memanggil queueFail SEBELUM Cloudflare mematikan worker. Tanpa ini,
    // worker mati diam-diam dan entry menjadi zombie (lock expired tanpa
    // completion) yang harus di-cleanup oleh cron dan tidak dapat fallback
    // segera.
    const deadlinePromise = new Promise<AutoreplyOutcome>((resolve) => {
      setTimeout(() => resolve("fatal"), HANDLE_ONE_DEADLINE_MS);
    });

    try {
      const workPromise = (async (): Promise<AutoreplyOutcome> => {
        if (abortSignal?.aborted) return "fatal";

        if (claim.attempt >= 1) {
          // Guard retry basi: kalau entry ini dicoba ulang (mis. setelah
          // zombie_timeout) TAPI sudah ada queue entry lebih baru untuk phone
          // yang sama yang sudah 'sent', balasan kita akan terasa telat/tidak
          // nyambung karena tamu sudah lanjut menanyakan hal lain. Skip.
          try {
            const { data: selfRow } = await (supabaseAdmin as any)
              .from("wa_conversation_queue")
              .select("created_at")
              .eq("id", claim.entryId)
              .maybeSingle();
            const selfCreatedAt = (selfRow as { created_at?: string } | null)?.created_at ?? null;
            if (selfCreatedAt) {
              const { data: newer } = await (supabaseAdmin as any)
                .from("wa_conversation_queue")
                .select("id")
                .eq("phone", claim.phone)
                .eq("status", "sent")
                .gt("created_at", selfCreatedAt)
                .limit(1);
              if (newer && newer.length > 0) {
                console.info(`[Drain] ${logPhone} skip stale retry (entry=${claim.entryId.slice(0, 8)}, attempt=${claim.attempt})`);
                return "skipped_config";
              }
            }
          } catch (guardErr) {
            console.warn(`[Drain] ${logPhone} stale-retry guard failed:`, guardErr);
          }
        }

        return executeAutoreplyForPhone(
          claim.phone,
          origin,
          () => queueHeartbeat(supabaseAdmin, claim.entryId, workerId).then(() => {}),
          claim.entryId,
          () => completeQueue("sent"),
          claim.attempt,
        );
      })();

      outcome = await Promise.race([workPromise, deadlinePromise]);
      if (outcome === "fatal" && !queueCompleted) {
        // Deadline mungkin memicu; catat supaya jelas di log kalau ini bukan
        // fatal biasa melainkan timeout dinding-jam yang mencegah zombie.
        console.warn(`[Drain] ${logPhone} wall-clock deadline hit — forcing queueFail`);
      }
    } catch (e) {
      console.error(`[Drain] ${logPhone} error:`, e);
      outcome = "fatal";
    } finally {
      clearInterval(heartbeatTimer);
    }

    if (outcome === "ok" || NON_RETRYABLE_OUTCOMES.has(outcome)) {
      const completionResult = outcome === "ok" ? "sent" : outcome;
      await completeQueue(completionResult);
    } else {
      await queueFail(supabaseAdmin, claim.entryId, workerId, outcome);
    }

    console.log(`[Drain] ${logPhone} outcome=${outcome} (entry ${claim.entryId.slice(0, 8)})`);
  };

  await Promise.allSettled(claims.map(handleOne));
  return { processed: claims.length };
}

export async function recoverUnqueuedInboundMessages(options?: {
  lookbackMinutes?: number;
  limit?: number;
}): Promise<{ recovered: number }> {
  const lookbackMinutes = options?.lookbackMinutes ?? 30;
  const limit = options?.limit ?? 10;
  const sinceIso = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();

  const { data: inboundRows, error: inboundErr } = await (supabaseAdmin as any)
    .from("whatsapp_messages")
    .select("id, thread_id, body, sent_at")
    .eq("direction", "in")
    .gte("sent_at", sinceIso)
    .order("sent_at", { ascending: false })
    .limit(limit);

  if (inboundErr) {
    console.warn("[QueueRecovery] inbound lookup failed:", inboundErr.message);
    return { recovered: 0 };
  }

  const rows = ((inboundRows ?? []) as Array<{
    id: string;
    thread_id: string;
    body: string | null;
    sent_at: string;
  }>).filter((r) => r.id && r.thread_id && r.sent_at);

  if (rows.length === 0) return { recovered: 0 };

  const threadIds = Array.from(new Set(rows.map((r) => r.thread_id)));
  const { data: threadRows, error: threadErr } = await (supabaseAdmin as any)
    .from("whatsapp_threads")
    .select("id, phone")
    .in("id", threadIds);

  if (threadErr) {
    console.warn("[QueueRecovery] thread lookup failed:", threadErr.message);
    return { recovered: 0 };
  }

  const phoneByThread = new Map(
    ((threadRows ?? []) as Array<{ id: string; phone: string | null }>).map((t) => [t.id, t.phone]),
  );

  let recovered = 0;
  for (const row of rows.reverse()) {
    const phone = phoneByThread.get(row.thread_id);
    if (!phone) continue;

    try {
      const { data: queued } = await (supabaseAdmin as any)
        .from("wa_conversation_queue")
        .select("id")
        .eq("last_message_id", row.id)
        .limit(1);
      if ((queued ?? []).length > 0) continue;

      const { data: activeQueue } = await (supabaseAdmin as any)
        .from("wa_conversation_queue")
        .select("id")
        .eq("thread_id", row.thread_id)
        .in("status", ["pending", "waiting", "processing", "retrying"])
        .gte("created_at", row.sent_at)
        .limit(1);
      if ((activeQueue ?? []).length > 0) continue;

      const { data: outboundAfter } = await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .select("id")
        .eq("thread_id", row.thread_id)
        .eq("direction", "out")
        .gte("sent_at", row.sent_at)
        .limit(1);
      if ((outboundAfter ?? []).length > 0) continue;

      const { data: ctx, error: ctxErr } = await (supabaseAdmin as any).rpc("get_autoreply_context", {
        p_phone: phone,
      });
      if (ctxErr || !ctx) {
        console.warn(
          `[QueueRecovery] context lookup failed for ${phone.slice(-6)}: ${ctxErr?.message ?? "empty context"}`,
        );
        continue;
      }

      const c = ctx as { auto_reply_enabled?: boolean; wpp_token?: string | null };
      if (!c.auto_reply_enabled || !c.wpp_token) continue;

      const entry = await queueUpsert(supabaseAdmin, {
        phone,
        threadId: row.thread_id,
        messageId: row.id,
        body: row.body ?? "",
        delayMs: 0,
        // Beri jendela 30 detik agar worker sempat menjawab; 1s sebelumnya
        // langsung memicu max_wait_exceeded dan fallback "sistem sibuk".
        maxWaitMs: 30_000,
      });


      if (entry?.entryId) {
        recovered++;
        console.warn(
          `[QueueRecovery] recovered inbound ${row.id.slice(0, 8)} ` +
            `for ${phone.slice(-6)} into queue ${entry.entryId.slice(0, 8)}`,
        );
      }
    } catch (e) {
      console.warn(`[QueueRecovery] failed for message ${row.id.slice(0, 8)}:`, e);
    }
  }

  return { recovered };
}

/**
 * Kirim pesan fallback ke tamu untuk entry antrian yang sudah habis semua
 * percobaan (status='failed', biasanya akibat zombie_timeout berulang).
 *
 * Tanpa ini, tamu tidak menerima balasan apapun ketika orchestrator gagal
 * tiga kali — chatbot terlihat "diam". Helper ini menjamin minimal ada
 * acknowledgement, lalu menandai entry agar tidak dikirim ulang.
 *
 * Idempotent: melewati entry yang sudah ada outbound setelah completed_at
 * atau yang last_error-nya sudah berisi marker [fallback_sent].
 */
export async function sendFailureFallbackToGuests(): Promise<{
  notified: number;
}> {
  const sinceIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  // Grace period: jangan kirim fallback langsung setelah entry di-mark
  // failed. Worker bisa saja masih hidup memproses outbound (Wpp +
  // persistence) walau heartbeat telat. Tunggu 90 detik sejak completed_at
  // — jika benar-benar mati, fallback akan tetap terkirim. Jika worker
  // sebenarnya berhasil, pengecekan outbound di bawah akan menangkapnya
  // dan kita skip.
  const graceCutoffIso = new Date(Date.now() - 90_000).toISOString();
  const { data: failedEntries } = await (supabaseAdmin as any)
    .from("wa_conversation_queue")
    .select("id, phone, thread_id, created_at, completed_at, last_error, last_message_id")
    .eq("status", "failed")
    .gte("completed_at", sinceIso)
    .lte("completed_at", graceCutoffIso)
    .limit(20);

  if (!failedEntries || failedEntries.length === 0) {
    return { notified: 0 };
  }


  let notified = 0;
  for (const entry of failedEntries as any[]) {
    if (hasFallbackSentMarker(entry.last_error)) {
      continue;
    }

    const isManagerEntry = !!(await resolveManagerByPhone(entry.phone)) || isConfiguredAdminPhone(entry.phone);
    const fallbackBody = isManagerEntry ? MANAGER_FALLBACK_MESSAGE : FALLBACK_MESSAGE;

    // Lewati kalau worker sebenarnya sudah mengirim balasan sebelum di-mark zombie/failed,
    // atau ada queue lain yang sudah membalas thread ini.
    try {
      // (a) outbound yang sama queue_entry_id-nya → reply asli sudah terkirim.
      const { data: sameQid } = await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .select("id")
        .eq("thread_id", entry.thread_id)
        .eq("direction", "out")
        .eq("metadata->>queue_entry_id", entry.id)
        .limit(1);

      // (b) outbound apa pun setelah queue entry dibuat → percakapan sudah dilayani
      // (entah oleh worker yang sama sebelum zombie, queue lain, atau operator).
      const { data: anyOut } = await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .select("id")
        .eq("thread_id", entry.thread_id)
        .eq("direction", "out")
        .gte("sent_at", entry.created_at)
        .limit(1);

      // (c) queue lain yang lebih baru di thread sama → guest sudah lanjut, jangan ganggu.
      const { data: newerQueue } = await (supabaseAdmin as any)
        .from("wa_conversation_queue")
        .select("id")
        .eq("thread_id", entry.thread_id)
        .gt("created_at", entry.created_at)
        .limit(1);

      // (d) queue lock guard: ada worker yang sedang aktif memproses thread
      // ini (status processing/retrying dengan heartbeat masih segar). Kalau
      // ada, JANGAN kirim fallback — worker tersebut sedang menyelesaikan
      // balasan dan fallback akan jadi double-message ke tamu.
      const lockFreshSinceIso = new Date(Date.now() - 30_000).toISOString();
      const { data: activeWorker } = await (supabaseAdmin as any)
        .from("wa_conversation_queue")
        .select("id, status, locked_at")
        .eq("thread_id", entry.thread_id)
        .in("status", ["processing", "retrying"])
        .gte("locked_at", lockFreshSinceIso)
        .limit(1);

      // (e) inbound baru dari guest setelah entry ini → guest sudah lanjut
      // mengirim pesan baru. Kirim fallback hanya akan membingungkan: pesan
      // "sistem sibuk" muncul setelah guest sudah pindah topik. Biarkan
      // burst baru yang menjawab.
      const { data: newerInbound } = await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .select("id")
        .eq("thread_id", entry.thread_id)
        .eq("direction", "in")
        .gt("sent_at", entry.created_at)
        .limit(1);

      if (
        (sameQid ?? []).length > 0 ||
        (anyOut ?? []).length > 0 ||
        (newerQueue ?? []).length > 0 ||
        (activeWorker ?? []).length > 0 ||
        (newerInbound ?? []).length > 0
      ) {
        console.info(
          `[Fallback] skip ${entry.id.slice(0, 8)} — worker_active=${(activeWorker ?? []).length > 0} newer_inbound=${(newerInbound ?? []).length > 0}`,
        );
        await (supabaseAdmin as any)
          .from("wa_conversation_queue")
          .update({ last_error: withFallbackSentMarker(entry.last_error, "[fallback_sent:skipped]") })
          .eq("id", entry.id);
        continue;
      }

    } catch (e) {
      console.warn("[Fallback] outbound lookup failed:", e);
    }

    // Ambil token Wpp via context RPC.
    let wppToken: string | null = null;
    let autoReplyEnabled = false;
    let fallbackSendTarget = entry.phone;
    try {
      const { data: ctx } = await (supabaseAdmin as any).rpc("get_autoreply_context", {
        p_phone: entry.phone,
      });
      const c = ctx as any;
      wppToken = c?.wpp_token ?? null;
      autoReplyEnabled = !!c?.auto_reply_enabled;
      fallbackSendTarget = String(c?.send_target || c?.external_chat_id || entry.phone);
    } catch (e) {
      console.warn("[Fallback] context fetch failed:", e);
    }

    if (!wppToken || (!autoReplyEnabled && !isManagerEntry)) {
      // Tandai tetap supaya tidak dicek terus-menerus.
      await (supabaseAdmin as any)
        .from("wa_conversation_queue")
        .update({ last_error: withFallbackSentMarker(entry.last_error, "[fallback_sent:skipped]") })
        .eq("id", entry.id);
      continue;
    }

    // ── Atomic claim: tandai entry SEBELUM kirim (idempotency key) ─────────
    // Dua tick cron dapat melihat row 'failed' yang sama sebelum salah satu
    // menyetel marker. Tanpa claim atomik, keduanya akan memanggil Wpp
    // dan tamu menerima dua pesan "sistem sibuk". Update bersyarat ini
    // menjamin hanya satu pemanggil yang mendapat baris (`select` akan
    // kosong untuk pemanggil yang kalah race).
    let claimWon = false;
    try {
      const { data: claimed } = await (supabaseAdmin as any)
        .from("wa_conversation_queue")
        .update({ last_error: withFallbackSentMarker(entry.last_error, "[fallback_sent:claimed]") })
        .eq("id", entry.id)
        .or("last_error.is.null,last_error.not.ilike.%[fallback_sent%")
        .select("id");
      claimWon = Array.isArray(claimed) && claimed.length > 0;
    } catch (e) {
      console.warn("[Fallback] claim failed:", e);
    }
    if (!claimWon) {
      console.info(`[Fallback] entry ${entry.id.slice(0, 8)} sudah diklaim worker lain — skip`);
      continue;
    }

    // Persist outbound BEFORE Wpp (pola persist-then-send). Jika worker
    // mati setelah Wpp tapi sebelum baris ini disimpan, claim di atas
    // sudah mengunci entry sehingga retry tidak akan kirim ulang.
    let outboundRowId: string | null = null;
    try {
      outboundRowId = await saveOutboundMessage(supabaseAdmin, {
        threadId: entry.thread_id,
        body: fallbackBody,
        metadata: {
          agent: "system",
          agent_key: "fallback",
          is_fallback: true,
          queue_entry_id: entry.id,
          send_status: "pending",
          reason: "queue_terminal_failure",
        } as any,
      });
    } catch (e) {
      console.warn("[Fallback] save outbound (pending) failed:", e);
    }

    const { ok, error: sendErr } = await sendWhatsAppMessage(wppToken, fallbackSendTarget, fallbackBody);

    if (!ok) {
      console.warn(`[Fallback] send failed for ${entry.phone.slice(-6)}: ${sendErr}`);
      // Tandai final supaya tidak retry tanpa henti — claim sudah set,
      // tapi kita pertegas dengan marker terminal khusus.
      try {
        if (outboundRowId) {
          await (supabaseAdmin as any)
            .from("whatsapp_messages")
            .update({ metadata: { send_status: "failed", queue_entry_id: entry.id, is_fallback: true } as any })
            .eq("id", outboundRowId);
        }
        await (supabaseAdmin as any)
          .from("wa_conversation_queue")
          .update({ last_error: withFallbackSentMarker(entry.last_error, "[fallback_sent:send_failed]") })
          .eq("id", entry.id);
      } catch (e) {
        console.warn("[Fallback] mark send_failed failed:", e);
      }
      continue;
    }

    // Promote pending → sent.
    if (outboundRowId) {
      try {
        await (supabaseAdmin as any)
          .from("whatsapp_messages")
          .update({
            metadata: {
              agent: "system",
              agent_key: "fallback",
              is_fallback: true,
              queue_entry_id: entry.id,
              send_status: "sent",
              reason: "queue_terminal_failure",
            } as any,
          })
          .eq("id", outboundRowId);
      } catch (e) {
        console.warn("[Fallback] promote pending→sent failed:", e);
      }
    }

    await (supabaseAdmin as any)
      .from("wa_conversation_queue")
      .update({ last_error: withFallbackSentMarker(entry.last_error, "[fallback_sent]") })
      .eq("id", entry.id);

    // Eskalasi ke admin: buat handoff ticket supaya percakapan mati tidak
    // hilang dari radar. `createHandoffTicket` idempotent per (phone, open),
    // jadi aman dipanggil setiap tick fallback.
    if (!isManagerEntry) {
      try {
        const { createHandoffTicket } = await import("@/services/frustration-detector");
        const { data: lastInbound } = await (supabaseAdmin as any)
          .from("whatsapp_messages")
          .select("body")
          .eq("thread_id", entry.thread_id)
          .eq("direction", "in")
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        await createHandoffTicket(supabaseAdmin as any, {
          phone: entry.phone,
          threadId: entry.thread_id,
          kind: "frustrated",
          triggerMessage: String(lastInbound?.body ?? "(pesan tidak tersedia)"),
          context: {
            reason: "queue_terminal_failure",
            queue_entry_id: entry.id,
            last_error: entry.last_error ?? null,
            created_at: entry.created_at,
          },
        });
      } catch (e) {
        console.warn("[Fallback] createHandoffTicket failed:", e);
      }
    }

    notified++;
    console.log(`[Fallback] ✓ Sent terminal-fail fallback to ${entry.phone.slice(-6)}`);
  }


  return { notified };
}

function countConsecutiveInbound(messages: Array<{ direction: string; body: string }>): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].direction === "in") {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function getLastNInboundMessages(messages: Array<{ direction: string; body: string }>, n: number): string[] {
  const result: string[] = [];
  for (let i = messages.length - 1; i >= 0 && result.length < n; i--) {
    if (messages[i].direction === "in") {
      result.unshift(messages[i].body);
    } else {
      break;
    }
  }
  return result;
}
