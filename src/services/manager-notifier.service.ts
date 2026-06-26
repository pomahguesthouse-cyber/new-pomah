/**
 * Manager Notifier Service.
 *
 * Bertugas mengirim notifikasi WhatsApp ke manager/super admin untuk
 * tiga jenis event operasional:
 *   1. Booking baru     → semua manager aktif
 *   2. Bukti transfer   → super admin saja
 *   3. Komplain tamu    → semua manager aktif
 *
 * Semua pengiriman dicatat ke `notification_logs` (status, attempts, error)
 * dengan `dedupe_key` unik untuk mencegah pengiriman ganda.
 *
 * Pemicu di hot-path memanggil fungsi-fungsi ini secara fire-and-forget
 * agar tidak memblokir alur utama (booking creation, webhook reply).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDateID } from "@/lib/date";
import { sendWhatsAppMessage } from "./whatsapp.service";
import { sendMessage as tgSendMessage, sendPhoto as tgSendPhoto, type ReplyMarkup } from "./telegram.service";
import { normalizeAssistantName } from "@/ai/agents/persona";

type Db = SupabaseClient<any, any, any>;

interface ManagerContact {
  id: string;
  name: string;
  phone: string;
  role: string;
  telegram_chat_id: string | null;
}

type Channel = "wa" | "telegram";

interface PropertyTokens {
  fonnteToken: string | null;
  telegramToken: string | null;
}

async function getPropertyTokens(db: Db): Promise<PropertyTokens> {
  const { data } = await db
    .from("properties")
    .select("fonnte_token, telegram_bot_token")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return {
    fonnteToken: (data?.fonnte_token as string | null) ?? null,
    telegramToken: (data?.telegram_bot_token as string | null) ?? null,
  };
}

/* ---------------- Agent persona + channel resolution ---------------- */

/** Default persona names (mirror src/routes/admin/ai-lab.tsx). */
const DEFAULT_PERSONA: Record<string, string> = {
  "front-office": "Rania",
  pricing: "Julia",
  "customer-care": "Dewi",
  finance: "Santi",
  content: "Rara",
  manager: "Alexandria",
};

const AGENT_LABEL: Record<string, string> = {
  "front-office": "Front Office",
  pricing: "Pricing",
  "customer-care": "Customer Care",
  finance: "Finance",
  content: "Content Manager",
  manager: "Manager",
};

async function loadAgentPersonas(db: Db): Promise<Record<string, string>> {
  const personas: Record<string, string> = { ...DEFAULT_PERSONA };
  try {
    const { data } = await db
      .from("properties")
      .select("ai_lab_config")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const agents = ((data?.ai_lab_config as any)?.agents ?? {}) as Record<string, any>;
    for (const key of Object.keys(personas)) {
      const name = normalizeAssistantName(agents?.[key]?.managerName, "");
      if (name) personas[key] = name;
    }
  } catch (e) {
    console.warn("[ManagerNotifier] persona load failed:", e);
  }
  return personas;
}

function signature(agentKey: string, personas: Record<string, string>): string {
  const name = personas[agentKey] ?? DEFAULT_PERSONA[agentKey] ?? "Tim";
  const role = AGENT_LABEL[agentKey] ?? "Tim";
  return `\n\n— ${name} (${role})`;
}

interface AgentChannelRow {
  chat_id: string;
  agent_key: string;
  label: string | null;
  message_thread_id: string | null;
}

async function loadAgentChannels(db: Db, agentKeys: string[]): Promise<AgentChannelRow[]> {
  if (agentKeys.length === 0) return [];
  const { data, error } = await db
    .from("telegram_agent_channels")
    .select("chat_id, agent_key, label, message_thread_id")
    .in("agent_key", agentKeys)
    .eq("is_active", true);
  if (error) {
    console.warn("[ManagerNotifier] agent channels load failed:", error.message);
    return [];
  }
  return (data ?? []) as AgentChannelRow[];
}

/**
 * Send a notification to the Telegram group(s) bound to each agent key.
 * Each agent gets the message with their own persona signature so the
 * group sees who "spoke" — useful when several agents share one Telegram
 * workspace.
 */
async function fanOutToAgentChannels(
  db: Db,
  agentKeys: string[],
  base: {
    eventType: SendOptions["eventType"];
    message: string;
    fileUrl?: string;
    replyMarkup?: ReplyMarkup;
    relatedId?: string | null;
    dedupeKeyFor: (agentKey: string, chatId: string) => string;
  },
): Promise<void> {
  const [channels, personas] = await Promise.all([loadAgentChannels(db, agentKeys), loadAgentPersonas(db)]);
  if (channels.length === 0) return;

  const tasks = await Promise.all(
    channels.map(async (ch) => {
      const messageWithSig = base.message + signature(ch.agent_key, personas);
      const dedupSuffix = ch.message_thread_id ? `${ch.chat_id}:t${ch.message_thread_id}` : ch.chat_id;
      // Resolve per-agent bot token; falls back to property-wide token.
      const agentBotToken = await getAgentBotToken(db, ch.agent_key);
      return sendWithRetry(db, null, {
        eventType: base.eventType,
        message: messageWithSig,
        fileUrl: base.fileUrl,
        relatedId: base.relatedId,
        channel: "telegram",
        dedupeKey: base.dedupeKeyFor(ch.agent_key, dedupSuffix),
        replyMarkup: base.replyMarkup,
        messageThreadId: ch.message_thread_id ?? undefined,
        agentBotToken,
        recipient: {
          id: `agent:${ch.agent_key}:${ch.chat_id}${ch.message_thread_id ? ":t" + ch.message_thread_id : ""}`,
          name: ch.label || `${AGENT_LABEL[ch.agent_key] ?? ch.agent_key} channel`,
          phone: "",
          role: "agent_channel",
          telegram_chat_id: ch.chat_id,
        },
      });
    }),
  );
  await Promise.all(tasks);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

async function getFonnteToken(db: Db): Promise<string | null> {
  const { data } = await db
    .from("properties")
    .select("fonnte_token")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.fonnte_token as string | null) ?? null;
}

async function getActiveManagers(db: Db, role?: string): Promise<ManagerContact[]> {
  let query = db.from("property_managers").select("id, name, phone, role, telegram_chat_id, is_active");

  if (role) query = query.eq("role", role);
  let { data, error } = await query;

  if (error && (error.code === "PGRST106" || String(error.message).includes("is_active"))) {
    console.warn("[ManagerNotifier] Failed with is_active, falling back");
    let fallbackQuery = db.from("property_managers").select("id, name, phone, role, telegram_chat_id");
    if (role) fallbackQuery = fallbackQuery.eq("role", role);
    const fallback = await fallbackQuery;
    data = fallback.data as any;
    error = fallback.error;
  }

  if (error) {
    console.error("[ManagerNotifier] Gagal memuat manager:", error.message);
    return [];
  }

  // Filter active managers in JS
  return (data ?? []).filter((m: any) => m.is_active !== false) as ManagerContact[];
}

interface SendOptions {
  eventType:
    | "new_booking"
    | "booking_updated"
    | "payment_proof"
    | "complaint"
    | "new_session"
    | "new_message"
    | "bot_loop"
    | "zombie_timeout"
    | "booking_stuck"
    | "rpc_failure";
  recipient: ManagerContact;
  message: string;
  fileUrl?: string;
  dedupeKey: string;
  relatedId?: string | null;
  /** Channel this delivery targets — affects log row + dedupe scoping. */
  channel: Channel;
  /** Optional inline keyboard (Telegram-only; ignored for WA). */
  replyMarkup?: ReplyMarkup;
  /** Telegram Topic ID for supergroup forum threads. */
  messageThreadId?: string;
  /** Override Telegram bot token (per-agent bot). Falls back to
   *  the property-wide token when null/undefined. */
  agentBotToken?: string | null;
}

/**
 * Kirim pesan ke satu manager via satu channel (wa atau telegram), dengan
 * retry 3x backoff. `notification_logs` di-dedupe per (channel, dedupe_key)
 * sehingga dua channel untuk event yang sama berjalan independen — hanya
 * memblokir kalau channel + key persis sama (mis. webhook + agent untuk
 * payment proof yang sama).
 */
async function sendWithRetry(db: Db, fonnteToken: string | null, opts: SendOptions): Promise<void> {
  // Cegah duplikat per channel: jika (channel, dedupe_key) sudah ada
  // dengan status sent, skip.
  const { data: existing } = await db
    .from("notification_logs")
    .select("id, status")
    .eq("dedupe_key", opts.dedupeKey)
    .eq("channel", opts.channel)
    .maybeSingle();

  if (existing) {
    const status = (existing as any).status as string;
    if (status === "sent") {
      console.info(`[ManagerNotifier] Skip — sudah terkirim: ${opts.dedupeKey}`);
      return;
    }
    if (status === "pending") {
      // Pengiriman sedang dalam proses (atau baru saja di-insert oleh cron
      // menit sebelumnya dan belum selesai) — jangan kirim ganda.
      console.info(`[ManagerNotifier] Skip — sedang pending: ${opts.dedupeKey}`);
      return;
    }
    if (status === "failed") {
      // Sudah dicoba 3x dan gagal dalam window 30 menit ini (Fonnte down?).
      // Biarkan window berikutnya yang retry agar tidak spam tiap menit.
      console.info(`[ManagerNotifier] Skip — gagal di window ini, tunggu window berikutnya: ${opts.dedupeKey}`);
      return;
    }
  }

  // Insert/upsert log row sebagai pending.
  let logId: string | null = (existing as any)?.id ?? null;
  if (!logId) {
    const { data: inserted, error: insErr } = await db
      .from("notification_logs")
      .insert({
        event_type: opts.eventType,
        recipient_phone:
          opts.channel === "telegram"
            ? (opts.recipient.telegram_chat_id ?? opts.recipient.phone)
            : opts.recipient.phone,
        recipient_role: opts.recipient.role,
        message: opts.message,
        attachment_url: opts.fileUrl ?? null,
        status: "pending",
        attempts: 0,
        dedupe_key: opts.dedupeKey,
        related_id: opts.relatedId ?? null,
        channel: opts.channel,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      // Race condition pada unique key → ambil baris yang sudah ada.
      const { data: again } = await db
        .from("notification_logs")
        .select("id")
        .eq("dedupe_key", opts.dedupeKey)
        .eq("channel", opts.channel)
        .maybeSingle();
      logId = (again as any)?.id ?? null;
      if (!logId) {
        console.error("[ManagerNotifier] Gagal insert log:", insErr?.message);
        return;
      }
    } else {
      logId = inserted.id as string;
    }
  }

  const delays = [0, 1000, 2000, 4000];
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (delays[attempt - 1] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt - 1]));
    }
    const result = await dispatchByChannel(opts, fonnteToken);

    if (result.ok) {
      await db
        .from("notification_logs")
        .update({
          status: "sent",
          attempts: attempt,
          sent_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", logId);
      console.info(`[ManagerNotifier] Terkirim ke ${opts.recipient.name} via ${opts.channel} (attempt ${attempt})`);
      return;
    }
    lastError = result.error ?? "unknown error";
    console.warn(
      `[ManagerNotifier] Gagal kirim ke ${opts.recipient.name} via ${opts.channel} (attempt ${attempt}): ${lastError}`,
    );
  }

  await db.from("notification_logs").update({ status: "failed", attempts: 3, error: lastError }).eq("id", logId);
}

async function dispatchByChannel(
  opts: SendOptions,
  fonnteToken: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (opts.channel === "wa") {
    if (!fonnteToken) return { ok: false, error: "no fonnte token" };
    const r = await sendWhatsAppMessage(fonnteToken, opts.recipient.phone, opts.message, opts.fileUrl);
    return { ok: r.ok, error: r.error ?? undefined };
  }
  // telegram
  const tgToken = opts.agentBotToken ?? (await getTelegramTokenCached());
  if (!tgToken) return { ok: false, error: "no telegram token" };
  if (!opts.recipient.telegram_chat_id) return { ok: false, error: "no telegram chat_id" };
  const sendOpts: any = {};
  if (opts.replyMarkup) sendOpts.reply_markup = opts.replyMarkup;
  if (opts.messageThreadId) sendOpts.message_thread_id = opts.messageThreadId;
  if (opts.fileUrl) {
    return tgSendPhoto(tgToken, opts.recipient.telegram_chat_id, opts.fileUrl, opts.message, sendOpts);
  }
  return tgSendMessage(tgToken, opts.recipient.telegram_chat_id, opts.message, sendOpts);
}

// Per-invocation cache so a notif that fans out to N managers doesn't
// re-query the properties row N times.
let cachedTelegramToken: { value: string | null; at: number } | null = null;
const TG_TOKEN_TTL_MS = 60_000;
async function getTelegramTokenCached(): Promise<string | null> {
  const now = Date.now();
  if (cachedTelegramToken && now - cachedTelegramToken.at < TG_TOKEN_TTL_MS) {
    return cachedTelegramToken.value;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const tokens = await getPropertyTokens(supabaseAdmin as any);
  cachedTelegramToken = { value: tokens.telegramToken, at: now };
  return tokens.telegramToken;
}

/** Per-agent bot token cache (so a notif fanning out to N agent channels
 *  doesn't N-query the bots table). Keyed by agent_key. */
const cachedAgentBots = new Map<string, { token: string | null; at: number }>();
async function getAgentBotToken(db: Db, agentKey: string): Promise<string | null> {
  const cached = cachedAgentBots.get(agentKey);
  if (cached && Date.now() - cached.at < TG_TOKEN_TTL_MS) return cached.token;
  const { data } = await db
    .from("telegram_agent_bots")
    .select("bot_token, is_active")
    .eq("agent_key", agentKey)
    .maybeSingle();
  const token = data?.is_active && data?.bot_token ? (data.bot_token as string) : null;
  cachedAgentBots.set(agentKey, { token, at: Date.now() });
  return token;
}

/**
 * High-level fan-out: send the same notification to every active manager
 * via every channel they have configured (WA + Telegram in parallel).
 * `dedupeKey` should be unique per (event, manager) — the channel suffix
 * is added internally so the two channels for one manager don't collide.
 */
async function fanOut(
  db: Db,
  fonnteToken: string | null,
  managers: ManagerContact[],
  base: Omit<SendOptions, "channel" | "recipient" | "dedupeKey"> & {
    dedupeKeyFor: (m: ManagerContact) => string;
    telegramOnly?: Partial<Pick<SendOptions, "replyMarkup" | "fileUrl" | "message">>;
  },
): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const m of managers) {
    const baseDedup = base.dedupeKeyFor(m);
    if (m.phone) {
      tasks.push(
        sendWithRetry(db, fonnteToken, {
          eventType: base.eventType,
          message: base.message,
          fileUrl: base.fileUrl,
          relatedId: base.relatedId,
          recipient: m,
          channel: "wa",
          dedupeKey: baseDedup,
        }),
      );
    }
    if (m.telegram_chat_id) {
      tasks.push(
        sendWithRetry(db, fonnteToken, {
          eventType: base.eventType,
          message: base.telegramOnly?.message ?? base.message,
          fileUrl: base.telegramOnly?.fileUrl ?? base.fileUrl,
          relatedId: base.relatedId,
          recipient: m,
          channel: "telegram",
          dedupeKey: baseDedup,
          replyMarkup: base.telegramOnly?.replyMarkup,
        }),
      );
    }
  }
  await Promise.all(tasks);
}

function formatRupiah(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "Rp 0";
  return "Rp " + num.toLocaleString("id-ID");
}

function sourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "direct":
      return "Direct booking";
    case "ota":
      return "OTA import";
    case "manual":
      return "Admin booking";
    default:
      return source || "Direct booking";
  }
}

/* ------------------------------------------------------------------ */
/* 1. New Booking                                                     */
/* ------------------------------------------------------------------ */

export async function notifyNewBooking(db: Db, bookingId: string): Promise<void> {
  try {
    const { data: booking, error } = await db
      .from("bookings")
      .select(
        "id, reference_code, check_in, check_out, nights, total_amount, source, guest_id, guests(full_name), booking_rooms(room_type_id, room_types(name))",
      )
      .eq("id", bookingId)
      .maybeSingle();

    if (error || !booking) {
      console.error("[ManagerNotifier] Booking tidak ditemukan:", bookingId, error?.message);
      return;
    }

    const b = booking as any;
    const guestName = b.guests?.full_name ?? "Tamu";
    const roomName = b.booking_rooms?.[0]?.room_types?.name ?? "Kamar belum ditentukan";
    const message =
      "🏨 NEW BOOKING ALERT\n\n" +
      `Guest: ${guestName}\n` +
      `Room: ${roomName}\n` +
      `Check-in: ${fmtDateID(b.check_in)}\n` +
      `Check-out: ${fmtDateID(b.check_out)}\n` +
      `Nights: ${b.nights ?? "-"}\n` +
      `Total: ${formatRupiah(b.total_amount)}\n` +
      `Source: ${sourceLabel(b.source)}\n\n` +
      `Booking Code:\n${b.reference_code ?? b.id}\n\n` +
      "Please review in Manager Dashboard.";

    const { fonnteToken } = await getPropertyTokens(db);
    const managers = await getActiveManagers(db);
    if (managers.length === 0) {
      console.info("[ManagerNotifier] Belum ada manager aktif");
      return;
    }

    await Promise.all([
      fanOut(db, fonnteToken, managers, {
        eventType: "new_booking",
        message,
        relatedId: b.id,
        dedupeKeyFor: (m) => `new_booking:${b.id}:${m.id}`,
      }),
      // Bookings concern Front Office (intake) and Manager (oversight) channels.
      fanOutToAgentChannels(db, ["front-office", "manager"], {
        eventType: "new_booking",
        message,
        relatedId: b.id,
        dedupeKeyFor: (agent, chat) => `new_booking:${b.id}:agent:${agent}:${chat}`,
      }),
    ]);
  } catch (e) {
    console.error("[ManagerNotifier] notifyNewBooking error:", e);
  }
}

/* ------------------------------------------------------------------ */
/* 1b. Booking Updated                                                */
/* ------------------------------------------------------------------ */

export interface BookingSnapshot {
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  children: number | null;
  /** Daftar label kamar (mis. "Deluxe 101") atau room type bila nomor kosong. */
  rooms: string[];
}

/**
 * Ambil snapshot field yang dipantau untuk diff alert booking_updated.
 * Caller dipanggil 2x: sebelum & sesudah mutasi.
 */
export async function snapshotBookingForDiff(db: Db, bookingId: string): Promise<BookingSnapshot | null> {
  const { data, error } = await db
    .from("bookings")
    .select("check_in, check_out, adults, children, booking_rooms(rooms(number), room_types(name))")
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !data) return null;
  const b = data as any;
  const rooms: string[] = (b.booking_rooms ?? []).map((br: any) => {
    const room = Array.isArray(br.rooms) ? br.rooms[0] : br.rooms;
    const rt = Array.isArray(br.room_types) ? br.room_types[0] : br.room_types;
    const number = room?.number ?? null;
    const typeName = rt?.name ?? null;
    if (number && typeName) return `${typeName} ${number}`;
    return number ?? typeName ?? "Kamar";
  });
  rooms.sort();
  return {
    checkIn: b.check_in ?? null,
    checkOut: b.check_out ?? null,
    adults: typeof b.adults === "number" ? b.adults : null,
    children: typeof b.children === "number" ? b.children : null,
    rooms,
  };
}

function diffArrays(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

function shortHash(s: string): string {
  // FNV-1a 32-bit, cukup untuk dedupe.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

export async function notifyBookingUpdated(
  db: Db,
  bookingId: string,
  before: BookingSnapshot | null,
  after: BookingSnapshot | null,
  actor: string,
): Promise<void> {
  try {
    if (!before || !after) return;

    const lines: string[] = [];
    if (before.checkIn !== after.checkIn || before.checkOut !== after.checkOut) {
      lines.push(
        `• Check-in: ${before.checkIn ? fmtDateID(before.checkIn) : "-"} → ${after.checkIn ? fmtDateID(after.checkIn) : "-"}`,
      );
      lines.push(
        `• Check-out: ${before.checkOut ? fmtDateID(before.checkOut) : "-"} → ${after.checkOut ? fmtDateID(after.checkOut) : "-"}`,
      );
    }
    if (before.adults !== after.adults || before.children !== after.children) {
      lines.push(
        `• Tamu: ${before.adults ?? "-"} dewasa / ${before.children ?? 0} anak → ${after.adults ?? "-"} dewasa / ${after.children ?? 0} anak`,
      );
    }
    if (diffArrays(before.rooms, after.rooms)) {
      lines.push(`• Kamar: ${before.rooms.join(", ") || "-"} → ${after.rooms.join(", ") || "-"}`);
    }

    if (lines.length === 0) return; // tidak ada perubahan tracked

    const { data: booking, error } = await db
      .from("bookings")
      .select("id, reference_code, source, guest_id, guests(full_name)")
      .eq("id", bookingId)
      .maybeSingle();
    if (error || !booking) return;
    const b = booking as any;
    const guestName = b.guests?.full_name ?? "Tamu";

    const message =
      "✏️ BOOKING UPDATED\n\n" +
      `Guest: ${guestName}\n` +
      `Booking: ${b.reference_code ?? b.id}\n` +
      `Source: ${sourceLabel(b.source)}\n\n` +
      "Perubahan:\n" +
      lines.join("\n") +
      `\n\nDiubah oleh: ${actor}`;

    const { fonnteToken } = await getPropertyTokens(db);
    const managers = await getActiveManagers(db);
    if (managers.length === 0) return;

    const changeHash = shortHash(lines.join("|"));

    await Promise.all([
      fanOut(db, fonnteToken, managers, {
        eventType: "booking_updated",
        message,
        relatedId: b.id,
        dedupeKeyFor: (m) => `booking_updated:${b.id}:${changeHash}:${m.id}`,
      }),
      fanOutToAgentChannels(db, ["front-office", "manager"], {
        eventType: "booking_updated",
        message,
        relatedId: b.id,
        dedupeKeyFor: (agent, chat) => `booking_updated:${b.id}:${changeHash}:agent:${agent}:${chat}`,
      }),
    ]);
  } catch (e) {
    console.error("[ManagerNotifier] notifyBookingUpdated error:", e);
  }
}

import type { PaymentProofResult } from "./payment-proof.service";

export interface PaymentProofInput {
  threadId: string | null;
  phone: string;
  guestName: string | null;
  imageUrl: string;
  messageId: string;
  /** Hasil analisis Vision OCR (opsional — jika undefined, kirim notif sederhana) */
  ocrResult?: PaymentProofResult;
}

function matchStatusEmoji(status: string): string {
  switch (status) {
    case "matched":
      return "✅ COCOK";
    case "unmatched":
      return "❌ TIDAK COCOK";
    case "ambiguous":
      return "⚠️ PERLU DICEK";
    case "no_pending_booking":
      return "ℹ️ TIDAK ADA BOOKING PENDING";
    default:
      return "❓ " + status;
  }
}

function fmtRp(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return "Rp " + value.toLocaleString("id-ID");
}

export async function notifyPaymentProof(db: Db, input: PaymentProofInput): Promise<void> {
  try {
    // Cari booking aktif terbaru untuk phone tsb (best effort) jika belum ada dari OCR
    let bookingCode: string | null = input.ocrResult?.match.booking_code ?? null;
    let bookingId: string | null = null;
    if (input.phone) {
      const { data: guest } = await db
        .from("guests")
        .select("id")
        .eq("phone", input.phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (guest?.id) {
        const { data: bk } = await db
          .from("bookings")
          .select("id, reference_code")
          .eq("guest_id", (guest as any).id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (bk) {
          bookingCode = bookingCode ?? (bk as any).reference_code ?? null;
          bookingId = (bk as any).id ?? null;
        }
      }
    }

    // ── Build notification message ──
    const ocr = input.ocrResult?.ocr;
    const match = input.ocrResult?.match;

    let message: string;

    if (ocr && input.ocrResult?.ok) {
      // Enriched notification with OCR data
      const ocrLines = [
        ocr.bank_pengirim ? `  Bank Pengirim: ${ocr.bank_pengirim}` : null,
        ocr.bank_tujuan ? `  Bank Tujuan: ${ocr.bank_tujuan}` : null,
        ocr.nominal != null ? `  Nominal: ${fmtRp(ocr.nominal)}` : null,
        ocr.tanggal ? `  Tanggal: ${ocr.tanggal}` : null,
        ocr.nama_pengirim ? `  Nama Pengirim: ${ocr.nama_pengirim}` : null,
        ocr.nomor_referensi ? `  No. Referensi: ${ocr.nomor_referensi}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const matchLines = match
        ? [
            `  Status: ${matchStatusEmoji(match.status)}`,
            match.booking_code ? `  Kode Booking: ${match.booking_code}` : null,
            match.booking_amount != null ? `  Total Tagihan: ${fmtRp(match.booking_amount)}` : null,
            match.amount_diff != null ? `  Selisih: ${fmtRp(match.amount_diff)}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        : "  Status: ℹ️ Belum dicocokkan";

      message =
        "💳 BUKTI TRANSFER DITERIMA\n\n" +
        `Tamu: ${input.guestName ?? input.phone}\n` +
        `Telepon: ${input.phone}\n\n` +
        `📋 Hasil OCR:\n${ocrLines || "  (tidak ada data terekstrak)"}\n\n` +
        `🔍 Pencocokan Booking:\n${matchLines}\n\n` +
        "Silakan verifikasi dan konfirmasi di Dashboard.";
    } else {
      // Fallback: simple notification (OCR gagal atau tidak tersedia)
      message =
        "💳 BUKTI TRANSFER DITERIMA\n\n" +
        `Tamu: ${input.guestName ?? input.phone}\n` +
        `Kode Booking: ${bookingCode ?? "-"}\n\n` +
        "Bukti transfer telah dikirim dan memerlukan verifikasi manual.\n" +
        (input.ocrResult?.error ? `\n⚠️ OCR gagal: ${input.ocrResult.error}\n` : "") +
        `\nLampiran:\n${input.imageUrl}`;
    }

    const { fonnteToken } = await getPropertyTokens(db);
    const superAdmins = await getActiveManagers(db, "super_admin");
    if (superAdmins.length === 0) {
      console.info("[ManagerNotifier] Tidak ada super admin aktif untuk payment proof");
      return;
    }

    // Telegram gets inline approve/reject buttons when we know the booking
    // code. WA can't render inline buttons, so it gets text + image only.
    const tgMarkup = bookingCode
      ? {
          inline_keyboard: [
            [
              { text: "✅ Mark Paid", callback_data: `mark_paid:${bookingCode}` },
              { text: "❌ Reject", callback_data: `reject_proof:${bookingCode}` },
            ],
          ],
        }
      : undefined;

    await Promise.all([
      fanOut(db, fonnteToken, superAdmins, {
        eventType: "payment_proof",
        message,
        fileUrl: input.imageUrl,
        relatedId: bookingId,
        dedupeKeyFor: (m) => `payment_proof:${input.messageId}:${m.id}`,
        telegramOnly: tgMarkup ? { replyMarkup: tgMarkup } : undefined,
      }),
      // Payment proofs belong to Finance (verification) and Manager (oversight).
      fanOutToAgentChannels(db, ["finance", "manager"], {
        eventType: "payment_proof",
        message,
        fileUrl: input.imageUrl,
        relatedId: bookingId,
        replyMarkup: tgMarkup,
        dedupeKeyFor: (agent, chat) => `payment_proof:${input.messageId}:agent:${agent}:${chat}`,
      }),
    ]);
  } catch (e) {
    console.error("[ManagerNotifier] notifyPaymentProof error:", e);
  }
}

/* ------------------------------------------------------------------ */
/* 3. Complaint                                                       */
/* ------------------------------------------------------------------ */

export async function notifyComplaint(db: Db, complaintId: string): Promise<void> {
  try {
    const { data: comp, error } = await db
      .from("guest_complaints")
      .select("id, guest_name, phone, category, message, created_at")
      .eq("id", complaintId)
      .maybeSingle();

    if (error || !comp) {
      console.error("[ManagerNotifier] Complaint tidak ditemukan:", complaintId);
      return;
    }

    const c = comp as any;
    const message =
      "🚨 GUEST COMPLAINT DETECTED\n\n" +
      `Guest:\n${c.guest_name ?? "Tamu"}\n\n` +
      `Phone:\n${c.phone}\n\n` +
      `Category:\n${c.category}\n\n` +
      `Message:\n"${c.message}"\n\n` +
      `Time:\n${new Date(c.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}\n\n` +
      "Please follow up immediately.";

    const { fonnteToken } = await getPropertyTokens(db);
    const managers = await getActiveManagers(db);
    if (managers.length === 0) return;

    await Promise.all([
      fanOut(db, fonnteToken, managers, {
        eventType: "complaint",
        message,
        relatedId: c.id,
        dedupeKeyFor: (m) => `complaint:${c.id}:${m.id}`,
      }),
      // Complaints go to Customer Care (resolution) and Manager (escalation).
      fanOutToAgentChannels(db, ["customer-care", "manager"], {
        eventType: "complaint",
        message,
        relatedId: c.id,
        dedupeKeyFor: (agent, chat) => `complaint:${c.id}:agent:${agent}:${chat}`,
      }),
    ]);
  } catch (e) {
    console.error("[ManagerNotifier] notifyComplaint error:", e);
  }
}

/* ------------------------------------------------------------------ */
/* 4. New Conversation Session                                         */
/* ------------------------------------------------------------------ */

/**
 * Kirim notifikasi ke super admin via Telegram ketika tamu memulai
 * sesi percakapan WhatsApp baru (gap > 15 menit atau tamu baru sama sekali).
 *
 * Hanya menyasar super_admin dengan telegram_chat_id — tidak ke WA
 * agar tidak flooding manajer dengan notif rutin.
 *
 * Fire-and-forget-safe: tidak pernah throw.
 */
export async function notifyNewConversationSession(
  db: Db,
  opts: {
    phone: string;
    guestName: string | null;
    firstMessage: string;
    isNewThread: boolean; // true = tamu baru sama sekali, false = sesi baru dari tamu lama
    threadId: string | null;
  },
): Promise<void> {
  try {
    const { fonnteToken, telegramToken } = await getPropertyTokens(db);

    // Super admin via property_managers (yang punya nomor HP / chat id)
    const superAdmins = await getActiveManagers(db, "super_admin");
    if (superAdmins.length === 0) {
      console.info("[ManagerNotifier] notifyNewSession: no super_admin manager configured");
      return;
    }

    const sessionLabel = opts.isNewThread ? "🆕 TAMU BARU" : "🔄 SESI BARU";
    const preview = opts.firstMessage.length > 200 ? opts.firstMessage.slice(0, 197) + "…" : opts.firstMessage;
    const wibTime = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "short",
      timeStyle: "short",
    });

    const message =
      `💬 ${sessionLabel} — Percakapan WhatsApp\n\n` +
      `👤 Tamu: ${opts.guestName ?? "Tidak dikenal"}\n` +
      `📱 No HP: ${opts.phone}\n` +
      `⏱️ Waktu: ${wibTime}\n\n` +
      `💬 Pesan Pertama:\n"${preview}"\n\n` +
      (opts.isNewThread
        ? "Ini adalah tamu baru yang belum pernah menghubungi sebelumnya."
        : "Tamu sudah dikenal, memulai sesi percakapan baru.") +
      "\n\nℹ️ AI Customer Care sedang menangani percakapan ini.";

    const dedupeKeySuffix = opts.threadId ?? opts.phone;
    const dedupeWindow = Math.floor(Date.now() / (15 * 60 * 1000));
    const dedupeKey = `new_session:${dedupeKeySuffix}:${dedupeWindow}`;

    const jobs: Promise<unknown>[] = [];
    for (const admin of superAdmins) {
      // Kirim ke WA jika ada nomor
      if (admin.phone) {
        jobs.push(
          sendWithRetry(db, fonnteToken, {
            eventType: "new_session",
            message,
            relatedId: opts.threadId,
            recipient: admin,
            channel: "wa",
            dedupeKey: `${dedupeKey}:wa:${admin.id}`,
          }),
        );
      }
      // Mirror ke Telegram bila terdaftar (opsional, tidak fatal)
      if (telegramToken && admin.telegram_chat_id) {
        jobs.push(
          sendWithRetry(db, null, {
            eventType: "new_session",
            message,
            relatedId: opts.threadId,
            recipient: admin,
            channel: "telegram",
            dedupeKey: `${dedupeKey}:tg:${admin.id}`,
          }),
        );
      }
    }
    await Promise.all(jobs);

    console.info(
      `[ManagerNotifier] New session notif → ${superAdmins.length} super admin(s) | ${opts.phone.slice(-6)}`,
    );
  } catch (e) {
    console.warn("[ManagerNotifier] notifyNewConversationSession error (non-fatal):", e);
  }
}

/* ------------------------------------------------------------------ */
/* 5. Bot Health Alerts — loop & zombie                                */
/* ------------------------------------------------------------------ */

/**
 * Alert ketika tool agen "stuck" (mis. check_room_availability terus
 * mengembalikan need_dates di turn berulang dalam 1 percakapan).
 * Dikirim ke super admin WA agar bisa intervensi manual.
 */
export async function notifyBotLoop(
  db: Db,
  opts: {
    phone: string;
    threadId: string | null;
    toolName: string;
    repeatCount: number;
    lastArgs?: string;
    sampleOutput?: string;
  },
): Promise<void> {
  try {
    const { fonnteToken } = await getPropertyTokens(db);
    const superAdmins = await getActiveManagers(db, "super_admin");
    const targets = superAdmins.filter((m) => !!m.phone);
    if (targets.length === 0) return;

    const wibTime = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "short",
      timeStyle: "short",
    });

    const message =
      `⚠️ BOT STUCK — Tool Loop Terdeteksi\n\n` +
      `📱 Tamu: ${opts.phone}\n` +
      `🛠️ Tool: ${opts.toolName}\n` +
      `🔁 Diulang: ${opts.repeatCount}× dalam 1 turn\n` +
      `⏱️ Waktu: ${wibTime}\n\n` +
      (opts.lastArgs ? `📥 Args terakhir:\n${opts.lastArgs.slice(0, 240)}\n\n` : "") +
      (opts.sampleOutput ? `📤 Output:\n${opts.sampleOutput.slice(0, 240)}\n\n` : "") +
      `Bot mungkin tidak bisa menyelesaikan percakapan otomatis — silakan cek log/percakapan & bantu balas manual bila perlu.`;

    // Dedupe per thread per 10 menit
    const window = Math.floor(Date.now() / (10 * 60 * 1000));
    const dedupeKey = `bot_loop:${opts.threadId ?? opts.phone}:${opts.toolName}:${window}`;

    await Promise.all(
      targets.map((admin) =>
        sendWithRetry(db, fonnteToken, {
          eventType: "bot_loop",
          message,
          relatedId: opts.threadId,
          recipient: admin,
          channel: "wa",
          dedupeKey: `${dedupeKey}:${admin.id}`,
        }),
      ),
    );
  } catch (e) {
    console.warn("[ManagerNotifier] notifyBotLoop error (non-fatal):", e);
  }
}

/**
 * Alert ketika queue worker mendeteksi zombie (lock_expires_at lewat).
 * Tidak per-entry — digabung jadi 1 pesan ringkas dengan sample, dedupe
 * per 10 menit agar tidak flooding.
 */
export async function notifyZombieTimeout(
  db: Db,
  opts: {
    count: number;
    samples: Array<{ phone: string | null; entryId: string; lastError: string | null }>;
  },
): Promise<void> {
  try {
    if (opts.count <= 0) return;
    const { fonnteToken } = await getPropertyTokens(db);
    const superAdmins = await getActiveManagers(db, "super_admin");
    const targets = superAdmins.filter((m) => !!m.phone);
    if (targets.length === 0) return;

    const wibTime = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "short",
      timeStyle: "short",
    });

    const sampleLines = opts.samples
      .slice(0, 5)
      .map((s) => `• ${s.phone ?? "?"} — entry ${s.entryId.slice(0, 8)} (${s.lastError ?? "zombie_timeout"})`)
      .join("\n");

    const message =
      `🧟 ZOMBIE WORKER — Queue Reset\n\n` +
      `Jumlah job yang lock-nya expired & di-reset: ${opts.count}\n` +
      `⏱️ Waktu: ${wibTime}\n\n` +
      (sampleLines ? `Contoh:\n${sampleLines}\n\n` : "") +
      `Job akan dicoba ulang otomatis. Bila berulang, cek beban LLM / koneksi Fonnte.`;

    const window = Math.floor(Date.now() / (10 * 60 * 1000));
    const dedupeKey = `zombie_timeout:${window}`;

    await Promise.all(
      targets.map((admin) =>
        sendWithRetry(db, fonnteToken, {
          eventType: "zombie_timeout",
          message,
          relatedId: null,
          recipient: admin,
          channel: "wa",
          dedupeKey: `${dedupeKey}:${admin.id}`,
        }),
      ),
    );
  } catch (e) {
    console.warn("[ManagerNotifier] notifyZombieTimeout error (non-fatal):", e);
  }
}

/* ------------------------------------------------------------------ */
/* Booking-flow stuck alert                                           */
/* ------------------------------------------------------------------ */

/**
 * Alert ke super admin ketika alur booking di state machine (CONFIRMING_PHONE,
 * AWAITING_EMAIL, dst.) macet — tamu sudah mengirim pesan tetapi tidak ada
 * balasan bot >90 detik.
 *
 * Dedupe per kombinasi (phone, state, inbound message timestamp) sehingga
 * tiap kejadian macet hanya menghasilkan satu pesan, tetapi kejadian baru
 * berikutnya tetap dialarmkan.
 */
export async function notifyBookingStuck(
  db: Db,
  opts: {
    phone: string;
    state: string;
    requiredField?: string | null;
    stuckSeconds: number;
    lastInboundBody: string | null;
    lastInboundAt: string;
    /** Timestamp inbound PERTAMA sejak outbound terakhir — anchor episode.
     *  Selama belum ada balasan baru, key ini tidak berubah → notif sekali.
     *  Begitu bot/human balas, monitor berhenti sendiri (direction check). */
    episodeStartAt: string;
    threadId: string | null;
    guestName?: string | null;
  },
): Promise<void> {
  try {
    const { fonnteToken } = await getPropertyTokens(db);
    const superAdmins = await getActiveManagers(db, "super_admin");
    const targets = superAdmins.filter((m) => !!m.phone || !!m.telegram_chat_id);
    if (targets.length === 0) return;

    const wibTime = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "short",
      timeStyle: "short",
    });

    const inboundPreview = (opts.lastInboundBody ?? "").slice(0, 200);

    const message =
      `🛑 BOOKING FLOW MACET\n\n` +
      `📱 Tamu: ${opts.phone}${opts.guestName ? ` (${opts.guestName})` : ""}\n` +
      `📍 State: ${opts.state}\n` +
      (opts.requiredField ? `🔖 Field ditunggu: ${opts.requiredField}\n` : "") +
      `⏱️ Macet: ~${opts.stuckSeconds}s\n` +
      `🕒 Waktu: ${wibTime}\n\n` +
      (inboundPreview ? `📥 Pesan terakhir tamu:\n"${inboundPreview}"\n\n` : "") +
      `Bot belum membalas pesan tamu. Mohon cek log percakapan & bantu balas manual jika perlu.`;

    // DedupeKey berbasis EPISODE — bukan window waktu.
    // episodeStartAt = inbound pertama sejak outbound terakhir. Selama
    // bot/human belum membalas, key ini tidak berubah → notif hanya sekali.
    // Begitu ada balasan (outbound baru), monitor tidak menemukan kondisi
    // macet sama sekali karena direction check di cron gagal → berhenti
    // otomatis tanpa perlu timer atau window. Episode baru = key baru.
    const episodeKey = Date.parse(opts.episodeStartAt) || 0;
    const dedupeBase = `booking_stuck:${opts.phone}:${opts.state}:${episodeKey}`;

    await Promise.all(
      targets.flatMap((admin) => {
        const tasks: Promise<void>[] = [];
        if (admin.phone) {
          tasks.push(
            sendWithRetry(db, fonnteToken, {
              eventType: "booking_stuck",
              message,
              relatedId: opts.threadId,
              recipient: admin,
              channel: "wa",
              dedupeKey: `${dedupeBase}:wa:${admin.id}`,
            }),
          );
        }
        if (admin.telegram_chat_id) {
          tasks.push(
            sendWithRetry(db, fonnteToken, {
              eventType: "booking_stuck",
              message,
              relatedId: opts.threadId,
              recipient: admin,
              channel: "telegram",
              dedupeKey: `${dedupeBase}:tg:${admin.id}`,
            }),
          );
        }
        return tasks;
      }),
    );
  } catch (e) {
    console.warn("[ManagerNotifier] notifyBookingStuck error (non-fatal):", e);
  }
}

/* ------------------------------------------------------------------ */
/* 5. Conversation Monitor → Managerial Channels                      */
/* ------------------------------------------------------------------ */

/**
 * Publik wrapper untuk `fanOutToAgentChannels` yang dipakai oleh
 * conversation-monitor.service (dynamic import) agar tidak ada
 * circular dependency di bundler.
 *
 * Setiap alert percakapan dikirim ke kanal agent yang relevan dengan
 * tanda tangan agent (persona) sehingga grup Telegram tahu siapa yang
 * "berbicara".
 *
 * eventType "complaint" dipakai supaya sistem dedupe yang sudah ada
 * bekerja (kolom event_type di notification_logs), meski konteksnya
 * monitoring bukan complaint murni.
 */
export async function fanOutAgentChannelsForMonitor(
  db: Db,
  agentKeys: string[],
  message: string,
  alertId: string,
): Promise<void> {
  if (agentKeys.length === 0) return;
  await fanOutToAgentChannels(db, agentKeys, {
    eventType: "complaint", // tipe terdekat yang sudah ada di enum
    message,
    relatedId: alertId,
    dedupeKeyFor: (agentKey, chatId) => `conv_monitor:${alertId}:${agentKey}:${chatId}`,
  });
}

/* ------------------------------------------------------------------ */
/* 6. Notifikasi setiap pesan WhatsApp masuk                           */
/* ------------------------------------------------------------------ */

/**
 * Kirim notifikasi WhatsApp ke super admin SETIAP kali ada pesan baru
 * masuk dari tamu. Berbeda dengan `notifyNewConversationSession` yang
 * hanya memicu saat awal sesi (gap >15 menit), fungsi ini akan memicu
 * untuk setiap pesan inbound.
 *
 * Dedupe per `messageId` sehingga walau dipanggil berulang untuk pesan
 * yang sama (mis. retry webhook) tetap hanya 1 notif terkirim.
 *
 * Fire-and-forget-safe: tidak pernah throw.
 */
export async function notifyIncomingMessage(
  db: Db,
  opts: {
    phone: string;
    guestName: string | null;
    body: string;
    messageId: string;
    threadId: string | null;
    hasAttachment?: boolean;
  },
): Promise<void> {
  try {
    const { fonnteToken } = await getPropertyTokens(db);
    const superAdmins = await getActiveManagers(db, "super_admin");
    const targets = superAdmins.filter((m) => !!m.phone);
    if (targets.length === 0) return;

    const wibTime = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "short",
      timeStyle: "short",
    });

    const preview = opts.body.length > 300 ? opts.body.slice(0, 297) + "…" : opts.body;

    const message =
      `📩 Pesan WhatsApp Baru\n\n` +
      `👤 Tamu: ${opts.guestName ?? "Tidak dikenal"}\n` +
      `📱 No HP: ${opts.phone}\n` +
      `🕒 Waktu: ${wibTime}\n\n` +
      `💬 Pesan:\n"${preview}"` +
      (opts.hasAttachment ? `\n\n📎 Pesan ini berisi lampiran.` : ``);

    const dedupeKey = `new_message:${opts.messageId}`;

    await Promise.all(
      targets.map((admin) =>
        sendWithRetry(db, fonnteToken, {
          eventType: "new_message",
          message,
          relatedId: opts.threadId,
          recipient: admin,
          channel: "wa",
          dedupeKey: `${dedupeKey}:${admin.id}`,
        }),
      ),
    );
  } catch (e) {
    console.warn("[ManagerNotifier] notifyIncomingMessage error (non-fatal):", e);
  }
}

/* ------------------------------------------------------------------ */
/* 6. RPC Failure Alerts                                              */
/* ------------------------------------------------------------------ */

/**
 * Catat kegagalan RPC dan kirim notifikasi ke super_admin (WA + Telegram)
 * dengan jumlah kejadian per jam terakhir.
 *
 * - Setiap kegagalan dicatat ke tabel `rpc_failure_events` (untuk audit).
 * - Notifikasi di-dedupe per (rpc_name, window 1 jam) supaya tidak
 *   banjir — hanya 1 alert per jam per RPC, tapi pesannya menyertakan
 *   total kejadian dalam 1 jam terakhir.
 *
 * Fire-and-forget-safe: tidak pernah throw.
 */
export async function notifyRpcFailure(
  db: Db,
  opts: {
    rpcName: string;
    errorMessage: string | null;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    // 1. Catat event kegagalan (selalu).
    await db.from("rpc_failure_events").insert({
      rpc_name: opts.rpcName,
      error_message: opts.errorMessage ?? null,
      context: opts.context ?? null,
    });

    // 2. Hitung kejadian dalam 1 jam terakhir.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: hourlyCount } = await db
      .from("rpc_failure_events")
      .select("id", { count: "exact", head: true })
      .eq("rpc_name", opts.rpcName)
      .gte("created_at", oneHourAgo);

    const total = hourlyCount ?? 1;

    // 3. Resolve target super_admin.
    const { fonnteToken, telegramToken } = await getPropertyTokens(db);
    const superAdmins = await getActiveManagers(db, "super_admin");
    if (superAdmins.length === 0) {
      console.info("[ManagerNotifier] notifyRpcFailure: no super_admin configured");
      return;
    }

    const wibTime = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "short",
      timeStyle: "short",
    });

    const errPreview = (opts.errorMessage ?? "(no error message)").slice(0, 280);
    const ctxPreview = opts.context ? JSON.stringify(opts.context).slice(0, 280) : "";

    const message =
      `🛑 RPC FAILURE — Database Error\n\n` +
      `🔧 RPC: ${opts.rpcName}\n` +
      `📊 Kejadian 1 jam terakhir: ${total}×\n` +
      `⏱️ Waktu: ${wibTime}\n\n` +
      `❌ Error:\n${errPreview}\n` +
      (ctxPreview ? `\n📥 Konteks:\n${ctxPreview}\n` : "") +
      `\nSilakan cek log/database — bot mungkin tidak bisa merespon tamu.`;

    // Dedupe per jam supaya max 1 notif / jam / rpc.
    const hourWindow = Math.floor(Date.now() / (60 * 60 * 1000));
    const dedupeBase = `rpc_failure:${opts.rpcName}:${hourWindow}`;

    const jobs: Promise<unknown>[] = [];
    for (const admin of superAdmins) {
      if (admin.phone) {
        jobs.push(
          sendWithRetry(db, fonnteToken, {
            eventType: "rpc_failure",
            message,
            recipient: admin,
            channel: "wa",
            dedupeKey: `${dedupeBase}:wa:${admin.id}`,
          }),
        );
      }
      if (telegramToken && admin.telegram_chat_id) {
        jobs.push(
          sendWithRetry(db, null, {
            eventType: "rpc_failure",
            message,
            recipient: admin,
            channel: "telegram",
            dedupeKey: `${dedupeBase}:tg:${admin.id}`,
          }),
        );
      }
    }
    await Promise.all(jobs);

    console.warn(`[ManagerNotifier] RPC failure logged: ${opts.rpcName} (${total}× / 1h)`);
  } catch (e) {
    console.warn("[ManagerNotifier] notifyRpcFailure error (non-fatal):", e);
  }
}
