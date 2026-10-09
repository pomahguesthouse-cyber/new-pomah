/**
 * Conversation Monitor Service
 *
 * Mengawasi percakapan WhatsApp tamu secara aktif dan mencatat alert
 * di dashboard ketika mendeteksi masalah:
 *
 *  1. REPETITIVE   — Tamu mengirim pesan berulang / keluar dari konteks
 *                    (AI sudah membalas tapi tamu terus mengirim ulang pertanyaan serupa)
 *  2. ESCALATION   — Tamu eksplisit meminta manager/eskalasi
 *  3. UNRESPONSIVE — Pesan tamu tidak dibalas >10 menit (mode Human Takeover)
 *  4. FALLBACK_LOOP— AI gagal membalas (fallback message) >2x berturut-turut
 *  5. KEYWORD      — Kata sensitif / keluhan keras terdeteksi
 *
 * Alert disimpan di tabel conversation_alerts untuk dashboard admin.
 *
 * Fire-and-forget — semua fungsi exported tidak pernah throw,
 * hanya log warning agar tidak memblokir pipeline utama.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<any, any, any>;

// ─── Konfigurasi ─────────────────────────────────────────────────────────────

/** Waktu tanpa balasan (mode Human) sebelum alert UNRESPONSIVE dikirim (ms). */
const UNRESPONSIVE_THRESHOLD_MS = 10 * 60 * 1000; // 10 menit

/** Jumlah fallback message berturut-turut sebelum alert FALLBACK_LOOP. */
const FALLBACK_LOOP_THRESHOLD = 2;

/**
 * Skor kesamaan minimum untuk menganggap dua pesan "berulang".
 * 0–1; 0.75 berarti 75% mirip (bigram overlap).
 */
const REPETITION_SIMILARITY_THRESHOLD = 0.72;

/**
 * Jumlah pesan terakhir yang diperiksa untuk deteksi repetisi.
 */
const REPETITION_WINDOW = 8;

/** Kata/frasa pemicu alert ESCALATION (case-insensitive, trim). */
const ESCALATION_KEYWORDS = [
  "minta manager",
  "panggil manager",
  "hubungi manager",
  "mau bicara manager",
  "mau dengan manager",
  "minta pimpinan",
  "panggil pimpinan",
  "eskalasi",
  "laporkan",
  "lapor ke",
  "tidak puas",
  "sangat kecewa",
  "amat kecewa",
  "minta refund segera",
  "minta kembalikan uang",
  "akan komplain",
  "mau komplain",
  "mengancam",
  "saya ancam",
  "bawa ke media",
  "viralkan",
  "saya laporkan",
  "lapor polisi",
];

/** Kata sensitif pemicu alert KEYWORD. */
const SENSITIVE_KEYWORDS = [
  "brengsek",
  "anjing",
  "sialan",
  "bangsat",
  "goblok",
  "tolol",
  "babi",
  "keparat",
  "kurang ajar",
  "penipuan",
  "penipu",
  "ditipu",
  "bohong",
  "bohongi",
  "palsu",
  "abal-abal",
  "jorok sekali",
  "sangat kotor",
  "busuk",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Cek apakah pesan mengandung salah satu keyword (case-insensitive). */
function containsKeyword(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

/** Bigram similarity sederhana untuk deteksi repetisi. */
function bigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    const clean = s.toLowerCase().replace(/\s+/g, " ").trim();
    for (let i = 0; i < clean.length - 1; i++) {
      set.add(clean.slice(i, i + 2));
    }
    return set;
  };
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (ba.size === 0 || bb.size === 0) return 0;
  let common = 0;
  for (const g of ba) if (bb.has(g)) common++;
  return (2 * common) / (ba.size + bb.size);
}

// ─── DB Helpers ──────────────────────────────────────────────────────────────

/** Cek apakah sudah ada alert OPEN untuk (thread_id, trigger_type) ini. */
async function hasOpenAlert(
  db: Db,
  threadId: string,
  triggerType: string,
): Promise<boolean> {
  const { data } = await db
    .from("conversation_alerts")
    .select("id")
    .eq("thread_id", threadId)
    .eq("trigger_type", triggerType)
    .eq("status", "open")
    .maybeSingle();
  return !!data;
}

/** Simpan alert dan kembalikan ID-nya. */
async function insertAlert(
  db: Db,
  opts: {
    threadId: string | null;
    phone: string;
    guestName: string | null;
    triggerType: string;
    triggerDetail: string;
    lastMessage: string;
    aiStatus: "auto" | "human";
    severity: "low" | "medium" | "high" | "critical";
    dedupeKey: string;
  },
): Promise<string | null> {
  const { data, error } = await db
    .from("conversation_alerts")
    .insert({
      thread_id: opts.threadId,
      phone: opts.phone,
      guest_name: opts.guestName,
      trigger_type: opts.triggerType,
      trigger_detail: opts.triggerDetail,
      last_message: opts.lastMessage,
      ai_status: opts.aiStatus,
      severity: opts.severity,
      dedupe_key: opts.dedupeKey,
      status: "open",
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[ConvMonitor] insertAlert error:", error.message);
    return null;
  }
  return (data as any).id as string;
}

// ─── Core Alert Dispatcher ────────────────────────────────────────────────────

interface AlertOptions {
  db: Db;
  threadId: string | null;
  phone: string;
  guestName: string | null;
  triggerType:
    | "repetitive"
    | "escalation"
    | "unresponsive"
    | "fallback_loop"
    | "keyword"
    | "manual"
    | "needs_human";
  triggerDetail: string;
  lastMessage: string;
  aiStatus: "auto" | "human";
  severity: "low" | "medium" | "high" | "critical";
}

async function dispatchAlert(opts: AlertOptions): Promise<void> {
  const { db } = opts;

  // Dedupe: hindari alert ganda untuk thread + tipe yang sama
  if (opts.threadId) {
    const exists = await hasOpenAlert(db, opts.threadId, opts.triggerType);
    if (exists) {
      console.info(
        `[ConvMonitor] Skip — alert ${opts.triggerType} sudah open untuk ${opts.phone}`,
      );
      return;
    }
  }

  const dedupeKey = `conv_alert:${opts.phone}:${opts.triggerType}:${Date.now()}`;

  // 1. Simpan alert
  const alertId = await insertAlert(db, {
    threadId: opts.threadId,
    phone: opts.phone,
    guestName: opts.guestName,
    triggerType: opts.triggerType,
    triggerDetail: opts.triggerDetail,
    lastMessage: opts.lastMessage,
    aiStatus: opts.aiStatus,
    severity: opts.severity,
    dedupeKey,
  });

  if (!alertId) return;
}

// ─── Exported Detection Functions ────────────────────────────────────────────

export interface MonitorCheckInput {
  db: Db;
  threadId: string;
  phone: string;
  guestName: string | null;
  /** Semua pesan dalam sesi ini (ascending). */
  messages: Array<{ direction: string; body: string; sent_at?: string }>;
  /** Apakah AI aktif (auto) atau sudah diambil alih human. */
  aiStatus: "auto" | "human";
  /** True jika AI baru saja mengirim fallback message. */
  isFallback?: boolean;
  /** Jumlah fallback berturut-turut dalam sesi ini. */
  consecutiveFallbacks?: number;
  /** chat_summary_json.needs_human — LLM summarizer menandai tamu butuh manusia. */
  summaryNeedsHuman?: boolean;
  /** chat_summary_json.handoff_reason — alasan versi summarizer (bila ada). */
  summaryHandoffReason?: string | null;
}

/**
 * Periksa satu percakapan terhadap semua trigger.
 * Panggil setelah autoreply berhasil kirim (fire-and-forget).
 */
export async function checkConversation(input: MonitorCheckInput): Promise<void> {
  const {
    db,
    threadId,
    phone,
    guestName,
    messages,
    aiStatus,
    isFallback = false,
    consecutiveFallbacks = 0,
    summaryNeedsHuman = false,
    summaryHandoffReason = null,
  } = input;

  try {
    const inboundMsgs = messages.filter((m) => m.direction === "in");
    const lastInbound = [...inboundMsgs].reverse()[0];
    const lastMsg = lastInbound?.body ?? "";

    // ── 0. NEEDS_HUMAN — summary LLM menandai tamu butuh manusia ────────────
    // Non-blocking terhadap trigger lain; dedup via satu alert 'open' per
    // thread per tipe (dispatchAlert), jadi tidak spam tiap turn.
    if (summaryNeedsHuman && aiStatus === "auto") {
      await dispatchAlert({
        db,
        threadId,
        phone,
        guestName,
        triggerType: "needs_human",
        triggerDetail: summaryHandoffReason
          ? `Summary AI menandai butuh human: ${summaryHandoffReason}`
          : "Summary AI menandai percakapan ini butuh penanganan manusia.",
        lastMessage: lastMsg,
        aiStatus,
        severity: "high",
      });
    }

    // ── 1. KEYWORD — kata sensitif ───────────────────────────────────────────
    const foundSensitive = containsKeyword(lastMsg, SENSITIVE_KEYWORDS);
    if (foundSensitive) {
      await dispatchAlert({
        db,
        threadId,
        phone,
        guestName,
        triggerType: "keyword",
        triggerDetail: `Kata sensitif terdeteksi: "${foundSensitive}"`,
        lastMessage: lastMsg,
        aiStatus,
        severity: "high",
      });
      return; // keyword sudah cukup, tidak perlu cek lain
    }

    // ── 2. ESCALATION — permintaan eskalasi eksplisit ────────────────────────
    const foundEscalation = containsKeyword(lastMsg, ESCALATION_KEYWORDS);
    if (foundEscalation) {
      await dispatchAlert({
        db,
        threadId,
        phone,
        guestName,
        triggerType: "escalation",
        triggerDetail: `Tamu meminta eskalasi: "${foundEscalation}"`,
        lastMessage: lastMsg,
        aiStatus,
        severity: "critical",
      });
      return;
    }

    // ── 3. FALLBACK_LOOP — AI gagal berulang ─────────────────────────────────
    if (isFallback && consecutiveFallbacks >= FALLBACK_LOOP_THRESHOLD) {
      await dispatchAlert({
        db,
        threadId,
        phone,
        guestName,
        triggerType: "fallback_loop",
        triggerDetail: `AI gagal membalas ${consecutiveFallbacks}x berturut-turut dalam sesi ini`,
        lastMessage: lastMsg,
        aiStatus,
        severity: "high",
      });
      return;
    }

    // ── 4. REPETITIVE — pesan berulang / off-context ─────────────────────────
    // Ambil pesan tamu dalam window terakhir
    const window = inboundMsgs.slice(-REPETITION_WINDOW);
    if (window.length >= 4 && lastMsg) {
      // Cek apakah pesan terakhir sangat mirip dengan ≥2 pesan sebelumnya
      const prevMsgs = window.slice(0, -1);
      const highSimilarCount = prevMsgs.filter(
        (m) => bigramSimilarity(lastMsg, m.body) >= REPETITION_SIMILARITY_THRESHOLD,
      ).length;

      if (highSimilarCount >= 2) {
        await dispatchAlert({
          db,
          threadId,
          phone,
          guestName,
          triggerType: "repetitive",
          triggerDetail:
            `Tamu mengirim pesan serupa ${highSimilarCount + 1}x dalam ` +
            `${window.length} pesan terakhir — kemungkinan AI tidak menjawab dengan memuaskan`,
          lastMessage: lastMsg,
          aiStatus,
          severity: "medium",
        });
      }
    }
  } catch (e) {
    console.warn("[ConvMonitor] checkConversation error (non-fatal):", e);
  }
}

/**
 * Cek thread yang mode Human Takeover dan belum dibalas >10 menit.
 * Dipanggil dari cron atau webhook WhatsApp gateway (fire-and-forget).
 */
export async function checkUnresponsiveThreads(db: Db): Promise<void> {
  try {
    const thresholdTime = new Date(
      Date.now() - UNRESPONSIVE_THRESHOLD_MS,
    ).toISOString();

    // Thread dengan ai_auto=false dan pesan masuk terakhir sudah >10 menit lalu
    // tapi belum ada balasan setelahnya
    const { data: threads, error } = await db
      .from("whatsapp_threads")
      .select("id, phone, display_name, last_message_at")
      .eq("ai_auto", false) // human takeover mode
      .eq("status", "open")
      .lt("last_message_at", thresholdTime)
      .limit(20);

    if (error) {
      console.warn("[ConvMonitor] checkUnresponsive query error:", error.message);
      return;
    }

    for (const thread of threads ?? []) {
      const t = thread as any;

      // Periksa apakah pesan terakhir adalah dari tamu (in), bukan dari bot/admin (out)
      const { data: lastMsgs } = await db
        .from("whatsapp_messages")
        .select("direction, body, sent_at")
        .eq("thread_id", t.id)
        .order("sent_at", { ascending: false })
        .limit(3);

      const recentMsgs = (lastMsgs ?? []) as Array<{
        direction: string;
        body: string;
        sent_at: string;
      }>;
      const lastMsg = recentMsgs[0];

      // Hanya alert jika pesan terakhir memang dari tamu
      if (!lastMsg || lastMsg.direction !== "in") continue;

      const minutesElapsed = Math.round(
        (Date.now() - new Date(lastMsg.sent_at).getTime()) / 60000,
      );

      await dispatchAlert({
        db,
        threadId: t.id,
        phone: t.phone,
        guestName: t.display_name ?? null,
        triggerType: "unresponsive",
        triggerDetail:
          `Pesan tamu belum dibalas ${minutesElapsed} menit (mode Human Takeover aktif)`,
        lastMessage: lastMsg.body,
        aiStatus: "human",
        severity: minutesElapsed >= 20 ? "high" : "medium",
      });
    }
  } catch (e) {
    console.warn("[ConvMonitor] checkUnresponsiveThreads error (non-fatal):", e);
  }
}

/**
 * Tandai alert sebagai handled di dashboard.
 */
export async function resolveAlert(
  db: Db,
  alertId: string,
  resolvedBy: string,
  notes?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await db
      .from("conversation_alerts")
      .update({
        status: "handled",
        handled_by: resolvedBy,
        handled_at: new Date().toISOString(),
        notes: notes ?? null,
      })
      .eq("id", alertId);

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[ConvMonitor] resolveAlert error:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Trigger manual alert — dipanggil admin dari dashboard.
 */
export async function triggerManualAlert(
  db: Db,
  opts: {
    threadId: string;
    phone: string;
    guestName: string | null;
    note: string;
  },
): Promise<{ ok: boolean; alertId?: string; error?: string }> {
  try {
    // Ambil pesan terakhir
    const { data: msgs } = await db
      .from("whatsapp_messages")
      .select("body, direction")
      .eq("thread_id", opts.threadId)
      .order("sent_at", { ascending: false })
      .limit(1);
    const lastMsg = ((msgs ?? []) as any[])[0]?.body ?? "";

    // Cek ai_auto
    const { data: thread } = await db
      .from("whatsapp_threads")
      .select("ai_auto")
      .eq("id", opts.threadId)
      .maybeSingle();
    const aiStatus: "auto" | "human" =
      (thread as any)?.ai_auto === false ? "human" : "auto";

    const dedupeKey = `conv_alert:${opts.phone}:manual:${Date.now()}`;
    const alertId = await insertAlert(db, {
      threadId: opts.threadId,
      phone: opts.phone,
      guestName: opts.guestName,
      triggerType: "manual",
      triggerDetail: opts.note,
      lastMessage: lastMsg,
      aiStatus,
      severity: "high",
      dedupeKey,
    });

    if (!alertId) return { ok: false, error: "Failed to insert alert" };

    return { ok: true, alertId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
