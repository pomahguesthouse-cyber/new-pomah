/**
 * Reliable WhatsApp autoreply: debounce wait → AI → Fonnte send.
 * Runs inside waitUntil from the webhook (not HTTP self-fetch).
 */
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";
import { saveOutboundMessage, updateThreadAutoReplyMeta } from "@/repositories/message.repository";
import { sendWhatsAppMessage } from "@/services/whatsapp.service";
import { runMultiAgentOrchestration, deriveAgentLabelFromKey } from "@/ai/multi-agent-orchestrator";
import { todayWIB } from "@/lib/date";
import { queueClaimNext, queueComplete, queueFail, queueHeartbeat } from "@/services/queue.service";
import {
  SESSION_GAP_MS,
  findSessionStartIndex,
  isBrosurDoc,
  pickAttachment,
  cleanReplyBody,
} from "@/services/reply-postprocess";
import { checkConversation } from "@/services/conversation-monitor.service";
import {
  type ChatSummaryStructured,
  LAST_TOPIC_VALUES,
  BOOKING_STATUS_VALUES,
  PAYMENT_STATUS_VALUES,
} from "@/ai/chat-summary.types";
import { chatCompletionText } from "@/services/ai-client.service";
import { findTrainingSignals } from "@/services/training-retrieval.service";
import { runDeferred } from "@/lib/cf-context";

const FALLBACK_MESSAGE = "Mohon maaf, sistem kami sedang sibuk. Tim kami akan segera membalas pesan Anda. 🙏";

/**
 * Anggaran waktu untuk SATU attempt orchestrasi penuh (klasifikasi intent →
 * route → jalankan agent → tool calls → balasan teks). Harus lebih besar dari
 * LLM_CALL_TIMEOUT_MS (12s) dikali jumlah ronde tool-call yang wajar, jika
 * tidak orchestrasi multi-turn akan dipotong di tengah dan menghasilkan
 * balasan fallback. 40s menampung ~2-3 ronde. (Sebelumnya 22s — terlalu
 * pendek; satu panggilan LLM yang timeout saja sudah menghabiskan anggaran
 * sebelum ronde kedua sempat jalan.)
 *
 * Catatan Cloudflare Workers: pastikan ini masih di bawah batas wall-time
 * sub-request/worker pada paket yang dipakai. 40s aman untuk Workers berbayar
 * (CPU time terpisah dari wall time selama menunggu I/O LLM).
 */
const AI_TIMEOUT_MS = 40_000;
const AI_MAX_ATTEMPTS = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Normalize an Indonesian phone to digits-only with 62 prefix. */
function normalizePhone(raw: string): string {
  let p = String(raw).replace(/\D/g, "");
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (p.startsWith("8")) p = "62" + p;
  return p;
}

/**
 * Resolve an active property manager by their WhatsApp phone.
 * Returns the manager row, or null if the sender is a guest.
 * Tolerant to phone-format differences (with/without 62, leading 0, spaces).
 */
export async function resolveManagerByPhone(
  phone: string,
): Promise<{ id: string; name: string; role: string; phone: string } | null> {
  const needle = normalizePhone(phone);
  if (!needle) return null;
  // NOTE: do NOT chain `.catch()` onto the Supabase query builder. In the
  // edge runtime it is a thenable, not a native Promise, and `.catch` is
  // undefined → calling it throws `TypeError: ... .catch is not a function`,
  // which bubbles up as a 500 from /api/fonnte and silently kills every
  // incoming WhatsApp message. Schema fallback (missing `is_active` column)
  // is handled below via the standard `{ data, error }` return.
  const { data, error } = await (supabaseAdmin as any)
    .from("property_managers")
    .select("id, name, role, phone, is_active");

  if (error) {
    console.error("[Autoreply] Error fetching managers:", error);
    // If it's a column not found error, try without is_active
    if (error.code === "PGRST106" || String(error.message).includes("is_active")) {
      const fallback = await (supabaseAdmin as any).from("property_managers").select("id, name, role, phone");
      if (!fallback.error && fallback.data) {
        for (const m of fallback.data) {
          if (m.phone && normalizePhone(m.phone) === needle) return m as any;
        }
      }
    }
  }

  for (const m of (data ?? []) as any[]) {
    // Treat as active if is_active is true or undefined (fallback)
    const isActive = m.is_active !== false;
    if (isActive && m.phone && normalizePhone(m.phone) === needle) {
      return m as any;
    }
  }
  return null;
}

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
 * Generate reply and send via Fonnte (no queue claim required).
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
const SUMMARY_REGEN_COOLDOWN_MS = 3 * 60 * 1000;

/**
 * Kata kunci penting yang memaksa regenerasi ringkasan walaupun cooldown
 * masih aktif. Tujuannya: konteks WhatsApp tetap fresh untuk topik kritikal
 * (booking, pembayaran, komplain) tanpa menambah latency balasan.
 */
const FORCE_SUMMARY_KEYWORDS: readonly string[] = [
  "booking",
  "pesan",
  "reservasi",
  "check in",
  "check-in",
  "check out",
  "check-out",
  "transfer",
  "bayar",
  "bukti",
  "komplain",
  "keluhan",
  "rusak",
  "kotor",
  "deluxe",
  "family",
  "single",
  "tanggal",
  "malam",
  "tamu",
];

function shouldForceSummary(lastMessage: string): boolean {
  if (!lastMessage) return false;
  const text = lastMessage.toLowerCase();
  return FORCE_SUMMARY_KEYWORDS.some((kw) => text.includes(kw));
}
/** Hard cap on persisted `short_summary` length (chars). Prevents prompt bloat. */
const SUMMARY_MAX_CHARS = 800;
/** Below this many messages, summarizing is pointless — skip. */
const SUMMARY_MIN_MESSAGES = 3;
// (SESSION_GAP_MS / findSessionStartIndex now live in reply-postprocess.ts
//  so the AI Lab simulator can share the same windowing logic.)
void SESSION_GAP_MS;

/**
 * Panggil LLM untuk menghasilkan ringkasan terstruktur JSON.
 * Kalau LLM gagal/JSON invalid → return null (caller fallback ke text lama).
 */
export async function generateSessionSummary(
  history: Array<{ direction: string; body: string; sent_at?: string }>,
  existingSummary: string | null | undefined,
  config: { apiKey: string; baseUrl: string; model: string },
): Promise<ChatSummaryStructured | null> {
  const historyText = history.map((m) => `${m.direction === "in" ? "Tamu" : "Bot"}: ${m.body}`).join("\n");

  const schemaHint = `{
  "short_summary": string (maks ${SUMMARY_MAX_CHARS} karakter, 1-3 kalimat Bahasa Indonesia),
  "guest_name": string|null,
  "last_topic": "pricing"|"availability"|"facility"|"booking"|"payment"|"complaint"|"location"|"general"|null,
  "room_type": string|null,
  "check_in": string|null (YYYY-MM-DD),
  "check_out": string|null (YYYY-MM-DD),
  "guest_count": number|null,
  "booking_status": "none"|"pending"|"confirmed"|"cancelled"|"checked_in"|"checked_out"|null,
  "payment_status": "unpaid"|"down_payment"|"paid"|"pay_at_hotel"|null,
  "complaint_active": boolean,
  "unresolved_question": string|null,
  "needs_human": boolean,
  "handoff_reason": string|null
}`;

  const prompt =
    `Riwayat obrolan tamu Pomah Guesthouse:\n\n${historyText}\n\n` +
    (existingSummary ? `Ringkasan sesi sebelumnya:\n${existingSummary}\n\n` : "") +
    `Ekstrak status percakapan ke JSON dengan schema:\n${schemaHint}\n\n` +
    `ATURAN PENTING:\n` +
    `- Jangan mengarang. Field yang TIDAK pernah disebut tamu/bot di transkrip → null (atau false untuk boolean).\n` +
    `- short_summary: 1-3 kalimat fokus konteks aktif (tipe kamar, status booking, pertanyaan belum dijawab).\n` +
    `- last_topic: pilih topik terakhir yang dibahas tamu.\n` +
    `- Jawab HANYA JSON valid, tanpa code fence, tanpa kata pengantar.`;

  try {
    const raw = await chatCompletionText(config, [{ role: "user", content: prompt }], {
      temperature: 0.2,
      maxTokens: 700,
      responseFormat: { type: "json_object" },
    });

    return parseStructuredSummary(raw ?? "");
  } catch (e) {
    console.error(`[SessionSummarizer] Failed to generate summary:`, e);
    return null;
  }
}

function parseStructuredSummary(raw: string): ChatSummaryStructured | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let obj: Record<string, unknown> | null = null;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        /* noop */
      }
    }
  }
  if (!obj || typeof obj !== "object") {
    console.warn(`[SessionSummarizer] summary failed invalid JSON: ${cleaned.slice(0, 200)}`);
    return null;
  }

  const pickEnum = <T extends string>(v: unknown, list: readonly T[]): T | null =>
    typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
  const pickString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const pickNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const pickBool = (v: unknown): boolean => v === true;

  let shortSummary = pickString((obj as Record<string, unknown>).short_summary) ?? "";
  if (shortSummary.length > SUMMARY_MAX_CHARS) {
    shortSummary = shortSummary.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd() + "…";
  }
  if (!shortSummary) {
    console.warn(`[SessionSummarizer] summary failed invalid JSON: empty short_summary`);
    return null;
  }

  return {
    short_summary: shortSummary,
    guest_name: pickString(obj.guest_name),
    last_topic: pickEnum(obj.last_topic, LAST_TOPIC_VALUES),
    room_type: pickString(obj.room_type),
    check_in: pickString(obj.check_in),
    check_out: pickString(obj.check_out),
    guest_count: pickNumber(obj.guest_count),
    booking_status: pickEnum(obj.booking_status, BOOKING_STATUS_VALUES),
    payment_status: pickEnum(obj.payment_status, PAYMENT_STATUS_VALUES),
    complaint_active: pickBool(obj.complaint_active),
    unresolved_question: pickString(obj.unresolved_question),
    needs_human: pickBool(obj.needs_human),
    handoff_reason: pickString(obj.handoff_reason),
  };
}

/**
 * Persist a structured summary ke whatsapp_threads. Memperbarui:
 * - chat_summary (short_summary text, mirror untuk alur lama)
 * - chat_summary_json (full structured object)
 * - chat_summary_version (++)
 * - chat_summary_updated_at (now)
 */
async function updateThreadSummary(
  client: any,
  threadId: string,
  structured: ChatSummaryStructured,
  opts?: { jsonOnly?: boolean },
): Promise<void> {
  const { data: prev } = await client
    .from("whatsapp_threads")
    .select("chat_summary_version")
    .eq("id", threadId)
    .maybeSingle();
  const nextVersion = ((prev as { chat_summary_version?: number } | null)?.chat_summary_version ?? 0) + 1;

  // jsonOnly: perbarui HANYA context terstruktur (tipe kamar, status booking,
  // dll.) tanpa menyentuh `chat_summary` teks. Dipakai saat tamu sedang di
  // tengah alur booking — admin tetap melihat konteks terkini, tapi ringkasan
  // teks "wrap-up" tidak ditimpa dengan rangkuman setengah jadi yang cepat basi.
  const patch: Record<string, unknown> = opts?.jsonOnly
    ? {
        chat_summary_json: structured,
        chat_summary_version: nextVersion,
        chat_summary_updated_at: new Date().toISOString(),
      }
    : {
        chat_summary: structured.short_summary,
        chat_summary_json: structured,
        chat_summary_version: nextVersion,
        chat_summary_updated_at: new Date().toISOString(),
      };

  const { error } = await client.from("whatsapp_threads").update(patch).eq("id", threadId);
  if (error) {
    console.error(`[SessionSummarizer] Database update failed:`, error.message);
  }
}

/**
 * Helper publik: regenerate summary untuk satu thread (dipakai admin UI).
 * Mengambil 30 pesan terakhir, memanggil LLM, lalu menyimpan hasilnya.
 */
export async function regenerateThreadSummary(
  client: any,
  threadId: string,
  config: { apiKey: string; baseUrl: string; model: string },
): Promise<{ ok: boolean; summary?: ChatSummaryStructured; error?: string }> {
  const { data: rows } = await client
    .from("whatsapp_messages")
    .select("direction, body, sent_at")
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: false })
    .limit(30);
  const history = ((rows ?? []) as Array<{ direction: string; body: string; sent_at?: string }>).reverse();
  if (history.length < SUMMARY_MIN_MESSAGES) {
    return { ok: false, error: "Belum cukup pesan untuk diringkas." };
  }
  const { data: existing } = await client
    .from("whatsapp_threads")
    .select("chat_summary")
    .eq("id", threadId)
    .maybeSingle();
  const summary = await generateSessionSummary(
    history,
    (existing as { chat_summary?: string } | null)?.chat_summary ?? "",
    config,
  );
  if (!summary) return { ok: false, error: "Gagal membuat ringkasan (JSON invalid)." };
  await updateThreadSummary(client, threadId, summary);
  console.info(`[SessionSummarizer] manual regen for thread ${threadId.slice(0, 8)}`);
  return { ok: true, summary };
}

/**
 * Helper publik: hapus context summary (semua field) — dipakai admin UI.
 */
export async function clearThreadSummary(client: any, threadId: string): Promise<void> {
  await client
    .from("whatsapp_threads")
    .update({
      chat_summary: null,
      chat_summary_json: {},
      chat_summary_updated_at: null,
    })
    .eq("id", threadId);
}

export async function executeAutoreplyForPhone(
  phone: string,
  origin: string,
  onBeforeAttempt?: () => Promise<void>,
  queueEntryId?: string,
): Promise<AutoreplyOutcome> {
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
  const manager = await resolveManagerByPhone(phone);
  const isManager = !!manager;
  if ((!isManager && !c.auto_reply_enabled) || !c.fonnte_token) {
    return "skipped_config";
  }

  if (!isManager) {
    try {
      const { data: handoffState } = await (supabaseAdmin as any).rpc("get_active_booking_state", { p_phone: phone });
      const handoffContext = (handoffState as { context?: unknown } | null)?.context;
      if (
        handoffContext &&
        typeof handoffContext === "object" &&
        (handoffContext as { handoff?: unknown }).handoff === true
      ) {
        console.info(`[Autoreply] Human handoff active — skipping bot reply for ${phone.slice(-6)}`);
        return "skipped_config";
      }
    } catch (e) {
      console.warn("[Autoreply] handoff guard failed (continuing):", e);
    }
  }

  // ── Zombie rescue: kirim ulang pesan outbound yang tersangkut 'pending' ──
  // Skenario: worker sebelumnya mati setelah menyimpan pesan ke DB
  // (send_status='pending') tapi sebelum memanggil Fonnte API. Pesan itu
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
      console.warn(
        `[Autoreply] 🧟 Zombie rescue: resending pending msg ${stuckMsg.id.slice(0, 8)} to ${phone.slice(-6)}`,
      );
      const { ok: reSent, error: reErr } = await (
        await import("@/services/whatsapp.service")
      ).sendWhatsAppMessage(c.fonnte_token, phone, stuckMsg.body);

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
      console.warn(`[Autoreply] Zombie rescue gagal: ${reErr} — lanjut proses normal`);
      // Kalau resend juga gagal (Fonnte down), lanjutkan ke AI normal
      // supaya tamu tetap dapat respons dari attempt ini.
    }
  } catch (e) {
    console.warn("[Autoreply] Zombie rescue check error (non-fatal):", e);
  }

  const { data: prop } = await (supabaseAdmin as any).from("properties").select("*").limit(1).maybeSingle();
  const p = (prop ?? {}) as any;
  const { data: rooms } = await (supabasePublic as any)
    .from("room_types")
    .select(
      "id, name, base_rate, capacity, bed_type, floor_info, description, amenities, extrabed_capacity, extrabed_rate",
    )
    .order("base_rate");

  const aiCfgRaw = p.ai_lab_config as any;
  const sopEnabled = aiCfgRaw?.tools?.["sop-knowledge"]?.enabled ?? true;
  let sopText = "";
  let brosurFiles: { name: string; url: string }[] = [];

  if (sopEnabled) {
    const { data: sopDocs } = await (supabaseAdmin as any)
      .from("sop_documents")
      .select("name, content, source_url, file_path, doc_category, storage_bucket")
      .order("created_at", { ascending: true })
      .limit(40);
    const parts: string[] = [];
    const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
    for (const d of sopDocs ?? []) {
      if (isBrosurDoc(d)) {
        if (d.file_path) {
          const bucket = (d.storage_bucket as string | undefined)?.trim() || "sop-documents";
          brosurFiles.push({
            name: d.name,
            url: `${supabaseUrl}/storage/v1/object/public/${bucket}/${d.file_path}`,
          });
        }
        continue;
      }
      const content = d.content?.trim();
      const url = d.source_url?.trim();
      if (!content && !url) continue;
      const head = url ? `### ${d.name} (Tautan: ${url})` : `### ${d.name}`;
      parts.push(content ? `${head}\n${content}` : head);
    }
    sopText = parts.join("\n\n").slice(0, 8000);
  }

  const explicitKey = p.ai_api_key?.trim();
  const lovableKey = process.env.LOVABLE_API_KEY?.trim();
  const useLovable = !explicitKey && !!lovableKey;
  const apiKey = explicitKey || lovableKey;
  if (!apiKey) return "no_api_key";

  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : (p.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const cfgModel = p.ai_model?.trim();
  const model = useLovable
    ? cfgModel?.includes("/")
      ? cfgModel
      : "google/gemini-2.5-flash"
    : cfgModel || "gpt-4o-mini";

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
  const rollingMessages = currentSessionMessages.slice(-20);

  const lastMessage =
    [...rollingMessages].reverse().find((m: { direction: string }) => m.direction === "in")?.body ?? "";

  let reply: string | null = null;
  let orchResult: any = null;

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
          void runDeferred("Autoreply.handoffNotify", async () => {
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

  for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS && !reply; attempt++) {
    if (attempt > 1) await sleep(Math.min(1000 * attempt, 3000));
    // Extend the worker lock before each (potentially slow) AI attempt.
    if (onBeforeAttempt) await onBeforeAttempt().catch(() => {});
    const controller = new AbortController();
    const aiTimeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    const tStart = Date.now();
    const trainingSignals = await findTrainingSignals(
      supabaseAdmin as any,
      {
        userMessage: lastMessage ?? "",
        stage: (chatSummaryJson?.last_topic ?? null) as string | null,
      },
      { apiKey, baseUrl, model },
      { positiveLimit: 3, negativeLimit: 2 },
    );
    const trainingExamples = trainingSignals.positiveExamples;
    const negativeExamples = trainingSignals.negativeExamples;

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
    try {
      const consecutiveInbound = countConsecutiveInbound(rollingMessages);
      const recoveryMode = consecutiveInbound >= 3;
      const unansweredMessages = recoveryMode
        ? getLastNInboundMessages(rollingMessages, consecutiveInbound)
        : undefined;

      orchResult = await runMultiAgentOrchestration({
        phone,
        isManager: !!manager,
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
          managerName: manager?.name,
          mode: manager ? "managerial" : undefined,
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
          llmConfig: { apiKey, baseUrl, model },
        },
        llmConfig: { apiKey, baseUrl, model },
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
        void runDeferred("Autoreply.notifyBotLoop", async () => {
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

  const rawReply = reply ?? FALLBACK_MESSAGE;
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
  let finalReply = cleanReplyBody(rawReply, pdfToStrip);

  // ── Duplicate-send guard ────────────────────────────────────────────────
  // Worker bisa mati setelah Fonnte sukses tapi sebelum sempat menyimpan
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
        .select("id")
        .eq("thread_id", c.thread_id)
        .eq("direction", "out")
        .filter("metadata->>queue_entry_id", "eq", queueEntryId)
        .limit(1);
      if ((existingForEntry ?? []).length > 0) {
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
      .select("id, body, sent_at")
      .eq("thread_id", c.thread_id)
      .eq("direction", "out")
      .gte("sent_at", sinceIso)
      .order("sent_at", { ascending: false })
      .limit(5);
    const dup = (recentOut ?? []).find((m: any) => (m.body ?? "").trim() === finalReply.trim());
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
  };

  // Persist outbound BEFORE calling Fonnte. Kalau worker mati setelah Fonnte
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

  let { ok: sent, error: sendErr } = await sendWhatsAppMessage(
    c.fonnte_token,
    phone,
    finalReply,
    attachUrl,
    attachName,
  );

  // If the attachment broke the send (e.g. unreachable file URL), retry with
  // the direct link appended so the guest still gets the brochure.
  if (!sent && attachUrl) {
    console.warn(`[Autoreply] Send with attachment failed (${sendErr}) — retrying with link`);
    ({ ok: sent, error: sendErr } = await sendWhatsAppMessage(
      c.fonnte_token,
      phone,
      `${finalReply}\n\n${attachUrl}`.trim(),
    ));
  }

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
            } as any,
          })
          .eq("id", outboundRowId);
      } catch {
        /* non-fatal */
      }
    }
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
          } as any,
        })
        .eq("id", outboundRowId);
    } catch (e) {
      console.warn("[Autoreply] Failed to update send_status (non-fatal):", e);
    }
  }

  void updateThreadAutoReplyMeta(supabaseAdmin, {
    threadId: c.thread_id,
    toolsUsed: orchResult?.toolsUsed ?? [],
  }).catch((e) => console.warn(e));

  // ── Conversation Monitor (fire-and-forget) ──────────────────────────────
  // Hitung berapa kali berturut-turut fallback dalam sesi ini.
  // Kami perkirakan dari metadata pesan outbound terakhir — bukan state
  // persisten agar tidak menambah latensi ke hot-path.
  void runDeferred("Autoreply.conversationMonitor", async () => {
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
  const forced = shouldForceSummary(lastMessage);
  if (summarizableMessages.length < SUMMARY_MIN_MESSAGES) {
    // not enough — silent skip
  } else if (cooldownActive(chatSummaryUpdatedAt) && !forced) {
    console.info(`[SessionSummarizer] summary skipped: cooldown (thread ${c.thread_id.slice(0, 8)})`);
  } else {
    if (forced && cooldownActive(chatSummaryUpdatedAt)) {
      console.info(
        `[SessionSummarizer] cooldown di-override karena pesan penting ` + `(thread ${c.thread_id.slice(0, 8)})`,
      );
    }
    void runDeferred("Autoreply.sessionSummarizer", async () => {
      try {
        const { data: bs } = await (supabaseAdmin as any).rpc("get_active_booking_state", { p_phone: phone });
        const bookingActive = !!(bs && bs.state && bs.state !== "IDLE");
        const summary = await generateSessionSummary(summarizableMessages, chatSummary, { apiKey, baseUrl, model });
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

  console.log(`[Autoreply] ✓ Sent to ${phone.slice(-6)}`);
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

function withFallbackSentMarker(lastError: unknown, marker: "[fallback_sent]" | "[fallback_sent:skipped]"): string {
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
export async function drainQueue(origin: string, maxBatch = 10): Promise<{ processed: number }> {
  const workerId = `w-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  let processed = 0;

  for (let i = 0; i < maxBatch; i++) {
    const claim = await queueClaimNext(supabaseAdmin, workerId);
    if (!claim) break; // nothing ready → done

    const logPhone = claim.phone.slice(-6);
    let outcome: AutoreplyOutcome = "fatal";

    // Periodic heartbeat so a long-running single attempt (tool chain + LLM
    // retries) keeps extending lock_expires_at and the entry never becomes a
    // zombie. Fires every 30s for the entire executeAutoreplyForPhone call.
    const heartbeatTimer = setInterval(() => {
      void queueHeartbeat(supabaseAdmin, claim.entryId, workerId).catch(() => {});
    }, 30_000);

    try {
      outcome = await executeAutoreplyForPhone(
        claim.phone,
        origin,
        () => queueHeartbeat(supabaseAdmin, claim.entryId, workerId).then(() => {}),
        claim.entryId,
      );
    } catch (e) {
      console.error(`[Drain] ${logPhone} error:`, e);
      outcome = "fatal";
    } finally {
      clearInterval(heartbeatTimer);
    }

    if (outcome === "ok" || NON_RETRYABLE_OUTCOMES.has(outcome)) {
      const completionResult = outcome === "ok" ? "sent" : outcome;
      await queueComplete(supabaseAdmin, claim.entryId, workerId, completionResult);
    } else {
      // send_failed / context_error / fatal → retry with backoff (or fail).
      await queueFail(supabaseAdmin, claim.entryId, workerId, outcome);
    }

    console.log(`[Drain] ${logPhone} outcome=${outcome} (entry ${claim.entryId.slice(0, 8)})`);
    processed++;
  }

  return { processed };
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
  const { data: failedEntries } = await (supabaseAdmin as any)
    .from("wa_conversation_queue")
    .select("id, phone, thread_id, created_at, completed_at, last_error")
    .eq("status", "failed")
    .gte("completed_at", sinceIso)
    .limit(20);

  if (!failedEntries || failedEntries.length === 0) {
    return { notified: 0 };
  }

  let notified = 0;
  for (const entry of failedEntries as any[]) {
    if (hasFallbackSentMarker(entry.last_error)) {
      continue;
    }

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

      if ((sameQid ?? []).length > 0 || (anyOut ?? []).length > 0 || (newerQueue ?? []).length > 0) {
        await (supabaseAdmin as any)
          .from("wa_conversation_queue")
          .update({ last_error: withFallbackSentMarker(entry.last_error, "[fallback_sent:skipped]") })
          .eq("id", entry.id);
        continue;
      }
    } catch (e) {
      console.warn("[Fallback] outbound lookup failed:", e);
    }

    // Ambil token Fonnte via context RPC.
    let fonnteToken: string | null = null;
    let autoReplyEnabled = false;
    try {
      const { data: ctx } = await (supabaseAdmin as any).rpc("get_autoreply_context", {
        p_phone: entry.phone,
      });
      fonnteToken = (ctx as any)?.fonnte_token ?? null;
      autoReplyEnabled = !!(ctx as any)?.auto_reply_enabled;
    } catch (e) {
      console.warn("[Fallback] context fetch failed:", e);
    }

    if (!fonnteToken || !autoReplyEnabled) {
      // Tandai tetap supaya tidak dicek terus-menerus.
      await (supabaseAdmin as any)
        .from("wa_conversation_queue")
        .update({ last_error: withFallbackSentMarker(entry.last_error, "[fallback_sent:skipped]") })
        .eq("id", entry.id);
      continue;
    }

    const { ok, error: sendErr } = await sendWhatsAppMessage(fonnteToken, entry.phone, FALLBACK_MESSAGE);

    if (!ok) {
      console.warn(`[Fallback] send failed for ${entry.phone.slice(-6)}: ${sendErr}`);
      continue;
    }

    try {
      await saveOutboundMessage(supabaseAdmin, {
        threadId: entry.thread_id,
        body: FALLBACK_MESSAGE,
        metadata: {
          agent: "system",
          agent_key: "fallback",
          is_fallback: true,
          queue_entry_id: entry.id,
          send_status: "sent",
          reason: "queue_terminal_failure",
        } as any,
      });
    } catch (e) {
      console.warn("[Fallback] save outbound failed:", e);
    }

    await (supabaseAdmin as any)
      .from("wa_conversation_queue")
      .update({ last_error: withFallbackSentMarker(entry.last_error, "[fallback_sent]") })
      .eq("id", entry.id);

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
  return messages
    .filter((m) => m.direction === "in")
    .slice(-n)
    .map((m) => m.body);
}
