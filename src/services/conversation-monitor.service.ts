/**
 * Conversation Monitor Service
 *
 * Mengawasi percakapan WhatsApp tamu secara aktif dan mengirim alert
 * ke super admin via Telegram ketika mendeteksi masalah:
 *
 *  1. REPETITIVE   — Tamu mengirim pesan berulang / keluar dari konteks
 *                    (AI sudah membalas tapi tamu terus mengirim ulang pertanyaan serupa)
 *  2. ESCALATION   — Tamu eksplisit meminta manager/eskalasi
 *  3. UNRESPONSIVE — Pesan tamu tidak dibalas >10 menit (mode Human Takeover)
 *  4. FALLBACK_LOOP— AI gagal membalas (fallback message) >2x berturut-turut
 *  5. KEYWORD      — Kata sensitif / keluhan keras terdeteksi
 *
 * Alert dikirim ke:
 *  a. super_admin yang punya telegram_chat_id (DM langsung)
 *  b. Kanal manajerial (telegram_agent_channels) sesuai jenis masalah:
 *       escalation / keyword → customer-care + manager
 *       fallback_loop        → customer-care + manager
 *       repetitive           → customer-care
 *       unresponsive         → manager
 *       manual               → manager
 * Alert juga disimpan di tabel conversation_alerts untuk dashboard admin.
 *
 * Fire-and-forget — semua fungsi exported tidak pernah throw,
 * hanya log warning agar tidak memblokir pipeline utama.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendMessage as tgSendMessage,
  editMessageText as tgEditMessage,
  type TgResult,
} from "./telegram.service";

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

/** Format timestamp WIB. */
function fmtWIB(date = new Date()): string {
  return date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "short",
    timeStyle: "short",
  });
}

// ─── DB Helpers ──────────────────────────────────────────────────────────────

async function getTelegramBotToken(db: Db): Promise<string | null> {
  const { data } = await db
    .from("properties")
    .select("telegram_bot_token")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.telegram_bot_token as string | null) ?? null;
}

async function getSuperAdmins(
  db: Db,
): Promise<Array<{ id: string; name: string; telegram_chat_id: string }>> {
  const { data, error } = await db
    .from("property_managers")
    .select("id, name, telegram_chat_id")
    .eq("role", "super_admin")
    .eq("is_active", true)
    .not("telegram_chat_id", "is", null);
  if (error) {
    console.warn("[ConvMonitor] getSuperAdmins error:", error.message);
    return [];
  }
  return (data ?? []) as Array<{ id: string; name: string; telegram_chat_id: string }>;
}

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
    telegramMessageId?: string;
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
      telegram_message_id: opts.telegramMessageId ?? null,
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[ConvMonitor] insertAlert error:", error.message);
    return null;
  }
  return (data as any).id as string;
}

/** Update telegram_message_id setelah pesan berhasil dikirim. */
async function patchTelegramMessageId(
  db: Db,
  alertId: string,
  tgMsgId: string,
): Promise<void> {
  await db
    .from("conversation_alerts")
    .update({ telegram_message_id: tgMsgId })
    .eq("id", alertId);
}

// ─── Telegram Alert Formatter ─────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<string, string> = {
  low: "🔵",
  medium: "🟡",
  high: "🟠",
  critical: "🔴",
};

const TRIGGER_LABEL: Record<string, string> = {
  repetitive: "⟳ Percakapan Berulang / Off-Context",
  escalation: "🚨 Permintaan Eskalasi",
  unresponsive: "⏰ Tidak Dibalas (10 Menit)",
  fallback_loop: "🤖 AI Gagal Berulang",
  keyword: "⚠️ Kata Sensitif Terdeteksi",
  manual: "📌 Alert Manual",
};

function buildTelegramMessage(opts: {
  guestName: string | null;
  phone: string;
  triggerType: string;
  triggerDetail: string;
  lastMessage: string;
  aiStatus: "auto" | "human";
  severity: "low" | "medium" | "high" | "critical";
  alertId: string;
}): string {
  const sev = SEVERITY_EMOJI[opts.severity] ?? "⚠️";
  const label = TRIGGER_LABEL[opts.triggerType] ?? opts.triggerType;
  const aiLabel = opts.aiStatus === "human" ? "👤 Human Takeover" : "🤖 AI Auto";
  const last = opts.lastMessage.length > 280
    ? opts.lastMessage.slice(0, 277) + "…"
    : opts.lastMessage;

  return (
    `${sev} PENGAWASAN PERCAKAPAN — ${label}\n\n` +
    `👤 Tamu: ${opts.guestName ?? "Tidak dikenal"}\n` +
    `📱 No HP: ${opts.phone}\n` +
    `⚠️ Detail: ${opts.triggerDetail}\n\n` +
    `💬 Pesan Terakhir:\n"${last}"\n\n` +
    `🤖 Status AI: ${aiLabel}\n` +
    `⏱️ Waktu: ${fmtWIB()}\n\n` +
    `🆔 Alert ID: ${opts.alertId.slice(0, 8)}\n` +
    `Balas /handled_${opts.alertId.slice(0, 8)} untuk tandai selesai.`
  );
}

/** Kirim alert ke semua super admin via Telegram. */
async function fanOutTelegramAlert(
  db: Db,
  message: string,
): Promise<string | null> {
  const [token, admins] = await Promise.all([
    getTelegramBotToken(db),
    getSuperAdmins(db),
  ]);

  if (!token) {
    console.warn("[ConvMonitor] No Telegram bot token found");
    return null;
  }
  if (admins.length === 0) {
    console.warn("[ConvMonitor] No active super admin with telegram_chat_id");
    return null;
  }

  let lastMsgId: string | null = null;

  await Promise.all(
    admins.map(async (admin) => {
      const result: TgResult = await tgSendMessage(
        token,
        admin.telegram_chat_id,
        message,
      );
      if (result.ok && (result.result as any)?.message_id) {
        lastMsgId = String((result.result as any).message_id);
        console.info(
          `[ConvMonitor] Alert terkirim ke ${admin.name} (${admin.telegram_chat_id})`,
        );
      } else {
        console.warn(
          `[ConvMonitor] Gagal kirim ke ${admin.name}: ${result.error}`,
        );
      }
    }),
  );

  return lastMsgId;
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
    | "manual";
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

  // 1. Simpan alert dulu (tanpa telegram_message_id)
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

  // 2. Bangun pesan Telegram
  const message = buildTelegramMessage({
    guestName: opts.guestName,
    phone: opts.phone,
    triggerType: opts.triggerType,
    triggerDetail: opts.triggerDetail,
    lastMessage: opts.lastMessage,
    aiStatus: opts.aiStatus,
    severity: opts.severity,
    alertId,
  });

  // 3. Kirim ke super admin (DM langsung) + kanal manajerial (paralel)
  const agentTargets = resolveAgentChannels(opts.triggerType);

  const [tgMsgId] = await Promise.all([
    // a. super admin DM
    fanOutTelegramAlert(db, message),
    // b. kanal agent manajerial
    fanOutToManagerialChannels(db, agentTargets, message, alertId),
  ]);

  // 4. Patch telegram_message_id (dari DM super admin) jika berhasil
  if (tgMsgId) {
    await patchTelegramMessageId(db, alertId, tgMsgId);
  }
}

/**
 * Petakan trigger type ke daftar agent channel key yang harus menerima alert.
 * Urutan: lebih spesifik → lebih umum.
 */
function resolveAgentChannels(triggerType: string): string[] {
  switch (triggerType) {
    case "keyword":
    case "escalation":
      return ["customer-care", "manager"];
    case "fallback_loop":
      return ["customer-care", "manager"];
    case "repetitive":
      return ["customer-care"];
    case "unresponsive":
      return ["manager"];
    case "manual":
      return ["manager"];
    default:
      return ["manager"];
  }
}

/**
 * Kirim alert ke kanal agent di Telegram (telegram_agent_channels).
 * Menggunakan fanOutToAgentChannels dari manager-notifier lewat dynamic import
 * untuk menghindari circular dependency.
 */
async function fanOutToManagerialChannels(
  db: Db,
  agentKeys: string[],
  message: string,
  alertId: string,
): Promise<void> {
  if (agentKeys.length === 0) return;
  try {
    const { fanOutAgentChannelsForMonitor } = await import(
      "./manager-notifier.service"
    );
    await fanOutAgentChannelsForMonitor(db, agentKeys, message, alertId);
  } catch (e) {
    // Jika managerial channel belum dikonfigurasi, tidak fatal
    console.warn("[ConvMonitor] fanOutManagerialChannels error (non-fatal):", e);
  }
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
  } = input;

  try {
    const inboundMsgs = messages.filter((m) => m.direction === "in");
    const lastInbound = [...inboundMsgs].reverse()[0];
    const lastMsg = lastInbound?.body ?? "";

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
 * Dipanggil dari cron atau webhook Fonnte (fire-and-forget).
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
 * Tandai alert sebagai handled dan edit pesan Telegram jika bisa.
 */
export async function resolveAlert(
  db: Db,
  alertId: string,
  resolvedBy: string,
  notes?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: alert } = await db
      .from("conversation_alerts")
      .select("telegram_message_id, phone, trigger_type")
      .eq("id", alertId)
      .maybeSingle();

    await db
      .from("conversation_alerts")
      .update({
        status: "handled",
        handled_by: resolvedBy,
        handled_at: new Date().toISOString(),
        notes: notes ?? null,
      })
      .eq("id", alertId);

    // Edit pesan Telegram jika ada message_id
    if ((alert as any)?.telegram_message_id) {
      const token = await getTelegramBotToken(db);
      const admins = await getSuperAdmins(db);
      if (token && admins.length > 0) {
        // Best-effort edit untuk setiap admin
        for (const admin of admins) {
          await tgEditMessage(
            token,
            admin.telegram_chat_id,
            parseInt((alert as any).telegram_message_id, 10),
            `✅ Alert diselesaikan oleh ${resolvedBy} pada ${fmtWIB()}\n\n` +
              `📱 No HP: ${(alert as any)?.phone ?? ""}\n` +
              `🏷️ Tipe: ${TRIGGER_LABEL[(alert as any)?.trigger_type ?? ""] ?? ""}\n` +
              (notes ? `📝 Catatan: ${notes}` : ""),
          ).catch(() => {/* ignore TG edit errors */});
        }
      }
    }

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

    const message = buildTelegramMessage({
      guestName: opts.guestName,
      phone: opts.phone,
      triggerType: "manual",
      triggerDetail: opts.note,
      lastMessage: lastMsg,
      aiStatus,
      severity: "high",
      alertId,
    });

    const [tgMsgId] = await Promise.all([
      fanOutTelegramAlert(db, message),
      fanOutToManagerialChannels(db, resolveAgentChannels("manual"), message, alertId),
    ]);
    if (tgMsgId) await patchTelegramMessageId(db, alertId, tgMsgId);

    return { ok: true, alertId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
