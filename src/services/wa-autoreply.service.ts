/**
 * Reliable WhatsApp autoreply: debounce wait → AI → Fonnte send.
 * Runs inside waitUntil from the webhook (not HTTP self-fetch).
 */
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";
import { saveOutboundMessage, updateThreadAutoReplyMeta } from "@/repositories/message.repository";
import { sendWhatsAppMessage } from "@/services/whatsapp.service";
import { runMultiAgentOrchestration, deriveAgentLabelFromKey } from "@/ai/multi-agent-orchestrator";
import { fmtDateID, nextDay, todayWIB } from "@/lib/date";
import { queueClaimNext, queueComplete, queueFail, queueHeartbeat, queueUpsert } from "@/services/queue.service";
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
import { checkRoomAvailability } from "@/tools/availability.tool";
import { retrieveRelevantSopContext } from "@/ai/rag.service";
import { getBookingState } from "@/ai/state-machine/booking-machine";

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


const FALLBACK_MESSAGE = "Maaf Kak, sistem sedang lambat. Data terakhir sudah saya simpan. Kakak bisa ketik 'lanjut' untuk meneruskan.";
const MANAGER_FALLBACK_MESSAGE = "Maaf Admin, sistem AI sedang lambat dan belum berhasil memproses perintah ini. Silakan coba lagi sebentar lagi.";
const QUICK_ACK_MESSAGE = "Sebentar Kak, saya cekkan dulu ya.";

function buildStateAwareFallback(state?: string): string {
  if (state === "WAITING_DATE_CHANGE" || state === "WAITING_DATE_CHANGE_CONFIRMATION") {
    return "Baik Kak, untuk melanjutkan booking, tanggal barunya kapan dan berapa malam?";
  }
  if (state === "AWAITING_NAME" || state === "CONFIRMING_NAME") {
    return "Baik Kak, mohon ketikkan nama lengkap untuk booking ini.";
  }
  if (state === "AWAITING_PHONE" || state === "CONFIRMING_PHONE") {
    return "Baik Kak, mohon ketikkan nomor WhatsApp yang bisa dihubungi.";
  }
  if (state === "CONFIRMING_BOOKING") {
    return "Apakah data booking sudah sesuai? Kakak bisa balas Ya, Lanjut, atau Batal.";
  }
  return FALLBACK_MESSAGE;
}
const QUICK_ACK_AFTER_MS = 6_000;
const QUICK_ACK_ENABLED = process.env.WA_QUICK_ACK_ENABLED !== "false";
const FAST_FAQ_ENABLED = process.env.WA_FAST_FAQ_ENABLED !== "false";
const FAQ_BLOCK_RE =
  /\b(booking|pesan|reservasi|available|availability|tersedia|kamar|room|harga|rate|tarif|tanggal|check.?in|check.?out|malam|orang|tamu|bayar|transfer|dp|invoice)\b/i;

type FastFaqResult = {
  reply: string;
  intent: string;
  /** Tanggal yang di-parse (untuk jalur ketersediaan) — dipersist ke
   *  conversation-state agar turn berikutnya (mis. tanya harga) tidak
   *  menanyakan tanggal lagi. */
  dates?: { checkIn: string; checkOut: string };
};

type ParsedGuestCount = {
  adults: number;
  children: number;
  total: number;
};

/**
 * Anggaran waktu untuk SATU attempt orchestrasi penuh (klasifikasi intent →
 * route → jalankan agent → tool calls → balasan teks). Dibuat ketat agar
 * request worker tidak hidup terlalu lama dan berubah menjadi zombie. Jika AI
 * belum menghasilkan jawaban dalam batas ini, alur mengirim fallback yang jelas
 * ke tamu, bukan menunggu retry panjang tanpa sinyal.
 */
const AI_TIMEOUT_MS = 14_000;
// Deadline dinding-jam untuk satu iterasi handleOne (klaim → orkestrasi →
// persist → Fonnte → queueComplete). Harus < batas wall-time worker Cloudflare
// (≈30s). Jika terlampaui, kita paksa queueFail supaya entry tidak menjadi
// zombie dan fallback bisa dikirim di siklus cron berikutnya.
const HANDLE_ONE_DEADLINE_MS = 24_000;
// Retry penuh menggandakan rakit prompt/retrieval/tool orchestration di runtime
// Cloudflare yang CPU-nya ketat. Biarkan retry terjadi di level queue, bukan
// mengulang orchestration berat dalam satu request worker.
const AI_MAX_ATTEMPTS = 1;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Normalize an Indonesian phone to digits-only with 62 prefix. */
function normalizePhone(raw: string): string {
  let p = String(raw).replace(/\D/g, "");
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (p.startsWith("8")) p = "62" + p;
  return p;
}

function isConfiguredAdminPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  return (process.env.ADMIN_PHONE_NUMBERS || "")
    .split(",")
    .map((p) => normalizePhone(p))
    .filter(Boolean)
    .includes(normalized);
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

function buildFastFaqReply(
  message: string,
  property: Record<string, unknown>,
  rooms: Array<Record<string, unknown>>,
): FastFaqResult | null {
  const text = message.toLowerCase().trim();
  if (!text || FAQ_BLOCK_RE.test(text)) return null;

  const propertyName = String(property.name || property.title || "Pomah Guesthouse");
  const address = String(property.address || property.location || "").trim();
  const phone = String(property.phone || property.whatsapp || "").trim();
  const mapUrl = String(property.google_maps_url || property.maps_url || "").trim();
  const checkIn = String(property.check_in_time || property.checkin_time || "14.00").trim();
  const checkOut = String(property.check_out_time || property.checkout_time || "12.00").trim();

  if (/\b(alamat|lokasi|dimana|di mana|maps?|map|rute|arah|google maps)\b/i.test(text)) {
    const lines = [`${propertyName} berlokasi di ${address || "area Pomah Guesthouse"}.`];
    if (mapUrl) lines.push(`Google Maps: ${mapUrl}`);
    if (phone) lines.push(`Kalau Kakak kesulitan mencari lokasi, bisa hubungi kami di ${phone}.`);
    return { intent: "faq_location", reply: lines.join("\n") };
  }

  if (/\b(jam|waktu).*(check.?in|masuk)|check.?in.*(jam|waktu)|check.?out.*(jam|waktu|kapan)|checkout\b/i.test(text)) {
    return {
      intent: "faq_check_time",
      reply: `Check-in mulai pukul ${checkIn}, dan check-out maksimal pukul ${checkOut}.`,
    };
  }

  if (/\b(wifi|wi-fi|internet)\b/i.test(text)) {
    return {
      intent: "faq_wifi",
      reply: "Iya Kak, tersedia WiFi untuk tamu.",
    };
  }

  if (/\b(parkir|parking|mobil|motor)\b/i.test(text)) {
    return {
      intent: "faq_parking",
      reply: "Iya Kak, tersedia area parkir untuk tamu. Untuk kendaraan besar atau rombongan, kabari kami dulu ya agar bisa dibantu arahkan.",
    };
  }

  if (/\b(fasilitas|amenities|ada apa saja)\b/i.test(text)) {
    const amenities = Array.from(
      new Set(
        rooms
          .flatMap((r) => (Array.isArray(r.amenities) ? r.amenities : []))
          .map((v) => String(v).trim())
          .filter(Boolean),
      ),
    ).slice(0, 8);
    const suffix = amenities.length ? ` Beberapa fasilitas: ${amenities.join(", ")}.` : "";
    return {
      intent: "faq_facility",
      reply: `Fasilitas tergantung tipe kamar yang dipilih Kak.${suffix}`,
    };
  }

  return null;
}

const ID_MONTHS: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2, pebruari: 2,
  mar: 3, maret: 3,
  apr: 4, april: 4,
  mei: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  agu: 8, agt: 8, agustus: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  des: 12, desember: 12,
};

function makeIsoDate(day: number, month: number, year: number): string | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return null;
  return iso;
}

function resolveYear(month: number, explicitYear: string | undefined, today: string): number {
  if (explicitYear) {
    return Number(explicitYear.length === 2 ? `20${explicitYear}` : explicitYear);
  }
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  return month < currentMonth ? currentYear + 1 : currentYear;
}

function parseAvailabilityDateRange(message: string, today: string): { checkIn: string; checkOut: string } | null {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;

  const todayMatch = /\b(malam ini|nanti malam|hari ini|today)\b/i.test(text);
  if (todayMatch) return { checkIn: today, checkOut: nextDay(today) };
  if (/\b(besok|tomorrow)\b/i.test(text)) {
    const checkIn = nextDay(today);
    return { checkIn, checkOut: nextDay(checkIn) };
  }
  if (/\blusa\b/i.test(text)) {
    const checkIn = nextDay(nextDay(today));
    return { checkIn, checkOut: nextDay(checkIn) };
  }

  let m = text.match(/\b(\d{1,2})\s*(?:-|–|—|sampai|sd|s\/d|to)\s*(\d{1,2})\s+([a-z]+)\s*(\d{2,4})?\b/i);
  if (m) {
    const [, d1Raw, d2Raw, monthName, yearRaw] = m;
    const month = ID_MONTHS[monthName];
    if (!month) return null;
    const year = resolveYear(month, yearRaw, today);
    const checkIn = makeIsoDate(Number(d1Raw), month, year);
    const checkOut = makeIsoDate(Number(d2Raw), month, year);
    if (checkIn && checkOut && checkOut > checkIn) return { checkIn, checkOut };
  }

  m = text.match(/\b(\d{1,2})\s+([a-z]+)\s*(\d{2,4})?\b/i);
  if (m) {
    const [, dayRaw, monthName, yearRaw] = m;
    const month = ID_MONTHS[monthName];
    if (!month) return null;
    const checkIn = makeIsoDate(Number(dayRaw), month, resolveYear(month, yearRaw, today));
    if (checkIn) return { checkIn, checkOut: nextDay(checkIn) };
  }

  m = text.match(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/i);
  if (m) {
    const [, dayRaw, monthRaw, yearRaw] = m;
    const month = Number(monthRaw);
    const checkIn = makeIsoDate(Number(dayRaw), month, resolveYear(month, yearRaw, today));
    if (checkIn) return { checkIn, checkOut: nextDay(checkIn) };
  }

  return null;
}

function shouldUseDeterministicAvailability(message: string): boolean {
  const text = message.toLowerCase();
  const asksAvailability =
    /\b(ready|tersedia|available|avail|kosong|ada kamar|ada yg|ada yang|ada untuk|kamar.*ada|cek.*kamar|booking|pesan kamar|menginap)\b/i.test(text);
  const hasDateSignal =
    /\b(hari ini|malam ini|besok|lusa|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/i.test(text) ||
    /\b\d{1,2}\s*(?:-|–|—|sampai|sd|s\/d|to)\s*\d{1,2}\b/i.test(text) ||
    /\b\d{1,2}[\/.]\d{1,2}\b/i.test(text);
  return asksAvailability && hasDateSignal;
}

function looksLikeAvailabilityQuestion(message: string): boolean {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\b(ready|tersedia|available|availability|avail|kosong|ada kamar|ada room|cek kamar|booking|pesan kamar|menginap)\b/i.test(text)) {
    return true;
  }
  return /\b(kamar|room|guesthouse|guest house|penginapan)\b/i.test(text) &&
    /\b(available|availability|avail|tersedia|kosong|ready)\b/i.test(text);
}

function isAvailabilityNeedDatesQuestion(message: string, today: string): boolean {
  return looksLikeAvailabilityQuestion(message) && !parseAvailabilityDateRange(message, today);
}

function isAvailabilitySourceContext(message: string): boolean {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  return /^\[lampiran\b/i.test(text) ||
    /\b(tiktok|tik tok|instagram|ig|facebook|fb|google|maps?|iklan|promo|dapat|dapet|lihat|nemu)\b/i.test(text);
}

function buildAvailabilityNeedDatesReply(
  askMessage: string,
  recentInboundMessages: string[] = [],
): FastFaqResult {
  const mentionsSource = [askMessage, ...recentInboundMessages].some((m) =>
    /\b(tiktok|tik tok|instagram|ig|facebook|fb|google|maps?)\b/i.test(m),
  );
  const prefix = messageOpensWithGreeting(askMessage)
    ? "Halo Kak, "
    : mentionsSource
      ? "Terima kasih infonya Kak. "
      : "";
  return {
    intent: "deterministic_availability_need_dates",
    reply:
      `${prefix}Untuk cek ketersediaan kamar, boleh tahu rencana menginap tanggal berapa sampai tanggal berapa?`,
  };
}

function buildRecentAvailabilityNeedDatesReply(
  messages: Array<{ direction: string; body?: string }>,
): FastFaqResult | null {
  const today = todayWIB();
  const recent = messages.slice(-8);
  let askBody = "";
  let askIndex = -1;

  for (let i = recent.length - 1; i >= 0; i--) {
    const row = recent[i];
    if (row.direction === "out") break;
    if (row.direction !== "in") continue;

    const body = (row.body ?? "").trim();
    if (isAvailabilityNeedDatesQuestion(body, today)) {
      askBody = body;
      askIndex = i;
      break;
    }
  }

  if (!askBody || askIndex < 0) return null;

  const inboundAfterAsk = recent
    .slice(askIndex)
    .filter((m) => m.direction === "in")
    .map((m) => (m.body ?? "").trim())
    .filter(Boolean);
  const latestInbound = inboundAfterAsk[inboundAfterAsk.length - 1] ?? askBody;
  if (latestInbound !== askBody && !isAvailabilitySourceContext(latestInbound)) {
    return null;
  }

  return buildAvailabilityNeedDatesReply(askBody, inboundAfterAsk);
}

function formatAvailabilityReply(raw: string, greet = false): FastFaqResult | null {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(data.kamar)) return null;
  const period = typeof data.periode === "string" ? data.periode : data.tanggal ?? "tanggal tersebut";
  const rooms = data.kamar as Array<Record<string, unknown>>;
  const available = rooms.filter((r) => Number(r.kamar_tersedia ?? 0) > 0 && r.tidak_tersedia !== true);

  if (available.length === 0) {
    return {
      intent: "deterministic_availability_full",
      reply:
        `${greet ? "Halo Kak, mohon" : "Mohon"} maaf Kak, untuk tanggal ${period} kamar kami sudah penuh.\n\n` +
        "Kalau Kakak berkenan, kirim tanggal alternatif ya, nanti saya cek lagi.",
    };
  }

  const lines = available.slice(0, 5).map((r) => {
    const count = Number(r.kamar_tersedia ?? 0);
    const price = Number(r.harga_per_malam ?? r.nightly_rate ?? 0);
    const priceText = price > 0 ? `, Rp${price.toLocaleString("id-ID")}/malam` : "";
    return `- ${String(r.nama ?? "Kamar")}: ${count} kamar tersedia${priceText}`;
  });

  return {
    intent: "deterministic_availability",
    reply:
      `${greet ? "Halo Kak, untuk" : "Untuk"} tanggal ${period}, masih tersedia:\n${lines.join("\n")}\n\n` +
      "Kakak rencana untuk berapa orang?",
  };
}

function parseGuestCountFollowup(message: string): ParsedGuestCount | null {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text || !/\b(orang|dewasa|adult|anak|child|children|kids?|pax|tamu)\b/i.test(text)) return null;

  const adultMatch = text.match(/(?:dewasa|adult|pax|tamu)\s*(?::?\s*)?(\d{1,2})|(\d{1,2})\s*(?:orang\s+)?(?:dewasa|adult|pax|tamu)\b/i);
  const childMatch = text.match(/(?:anak|child(?:ren)?|kids?)\s*(?::?\s*)?(\d{1,2})|(\d{1,2})\s*(?:orang\s+)?(?:anak|child(?:ren)?|kids?)\b/i);
  const genericMatch = text.match(/\b(\d{1,2})\s*(?:orang|pax|tamu)\b/i);

  let adults = adultMatch ? Number(adultMatch[1] ?? adultMatch[2]) : 0;
  const children = childMatch ? Number(childMatch[1] ?? childMatch[2]) : 0;

  if (!adults && !children && genericMatch) {
    adults = Number(genericMatch[1]);
  }

  if (!Number.isFinite(adults) || !Number.isFinite(children)) return null;
  if (adults < 0 || adults > 20 || children < 0 || children > 20) return null;
  const total = adults + children;
  if (total < 1 || total > 20) return null;

  return { adults, children, total };
}

function lastBotAskedGuestCount(messages: Array<{ direction: string; body?: string }>): boolean {
  const lastOutbound = [...messages]
    .reverse()
    .find((m) => m.direction === "out" && (m.body ?? "").trim());
  const body = (lastOutbound?.body ?? "").toLowerCase();
  return /\brencana untuk berapa orang\b|\bberapa orang\b/.test(body) && /\btersedia\b/.test(body);
}

function formatAvailabilityForGuestCount(raw: string, guests: ParsedGuestCount): FastFaqResult | null {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(data.kamar)) return null;
  const period = typeof data.periode === "string" ? data.periode : data.tanggal ?? "tanggal tersebut";
  const rooms = data.kamar as Array<Record<string, unknown>>;
  const available = rooms.filter((r) => Number(r.kamar_tersedia ?? 0) > 0 && r.tidak_tersedia !== true);
  const suitable = available.filter((r) => r.cocok_untuk_jumlah_tamu === true);
  const guestLabel = guests.children > 0
    ? `${guests.adults} dewasa dan ${guests.children} anak`
    : `${guests.total} tamu`;

  if (suitable.length > 0) {
    const lines = suitable.slice(0, 5).map((r) => {
      const count = Number(r.kamar_tersedia ?? 0);
      const price = Number(r.harga_per_malam ?? r.nightly_rate ?? 0);
      const maxGuests = Number(r.kapasitas_maksimal_dengan_extra_bed ?? r.kapasitas_tamu ?? 0);
      const extraBeds = Number(r.extra_bed_dibutuhkan ?? 0);
      const extraBedRate = Number(r.tarif_extra_bed_per_malam ?? 0);
      const priceText = price > 0 ? `, Rp${price.toLocaleString("id-ID")}/malam` : "";
      const capacityText = maxGuests > 0 ? `, maks ${maxGuests} tamu/kamar` : "";
      const extraBedText = extraBeds > 0
        ? extraBedRate > 0
          ? `, butuh ${extraBeds} extra bed @ Rp${extraBedRate.toLocaleString("id-ID")}/malam`
          : `, butuh ${extraBeds} extra bed`
        : "";
      return `- ${String(r.nama ?? "Kamar")}: ${count} kamar tersedia${priceText}${capacityText}${extraBedText}`;
    });

    return {
      intent: "deterministic_availability_guest_count",
      reply:
        `Untuk ${period} dengan ${guestLabel}, pilihan yang tersedia dan cukup kapasitas:\n` +
        `${lines.join("\n")}\n\n` +
        "Kakak mau pilih tipe kamar yang mana?",
    };
  }

  if (available.length === 0) {
    return {
      intent: "deterministic_availability_full",
      reply:
        `Mohon maaf Kak, untuk ${period} kamar kami sudah penuh.\n\n` +
        "Kalau Kakak berkenan, kirim tanggal alternatif ya, nanti saya cek lagi.",
    };
  }

  const lines = available.slice(0, 5).map((r) => {
    const count = Number(r.kamar_tersedia ?? 0);
    const maxGuests = Number(r.kapasitas_maksimal_dengan_extra_bed ?? r.kapasitas_tamu ?? 0);
    const capacityText = maxGuests > 0 ? `maks ${maxGuests} tamu/kamar` : "kapasitas belum terdata";
    return `- ${String(r.nama ?? "Kamar")}: ${count} kamar tersedia, ${capacityText}`;
  });

  return {
    intent: "deterministic_availability_over_capacity",
    reply:
      `Maaf Kak, untuk ${period} belum ada tipe kamar tersedia yang cukup untuk ${guestLabel}.\n\n` +
      `Yang masih tersedia:\n${lines.join("\n")}\n\n` +
      "Kakak mau coba tanggal lain, atau saya bantu cek opsi kamar lain kalau ada?",
  };
}

/** True bila pesan tamu DIBUKA dengan sapaan — agar bot membalas sapaan
 *  hanya saat tepat (turn pembuka), tidak mengulang di tengah percakapan. */
function messageOpensWithGreeting(message: string): boolean {
  return /^\s*(halo|hai|hi|hei|hey|hello|assalam|selamat\s+(pagi|siang|sore|malam)|pagi|siang|sore|malam)\b/i.test(
    message,
  );
}

/** Heuristik ringan: pesan tamu bernada booking_inquiry (tanya
 *  ketersediaan/harga/kamar) walau tanpa kata kunci tanggal. Dipakai untuk
 *  fast-path kontekstual yang meminjam tanggal dari state sebelumnya. */
function looksLikeBookingInquiry(message: string): boolean {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text || text.length > 240) return false;
  if (/\b(ready|tersedia|available|avail|kosong|ada kamar|cek kamar|cek ketersediaan|booking|pesan kamar|menginap|masih ada|masih available|harga|rate|tarif|per malam|permalam)\b/i.test(text)) {
    return true;
  }
  // Follow-up singkat seperti "gimana kak?", "jadi kosong?", "cek dong"
  return /\b(kamar|room|guesthouse|guest house|penginapan)\b/i.test(text);
}

async function buildDeterministicAvailabilityReply(params: {
  message: string;
  rooms: any[];
  property: any;
  origin: string;
}): Promise<FastFaqResult | null> {
  if (!shouldUseDeterministicAvailability(params.message)) return null;
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
function buildDeterministicPropertyFaqReply(params: {
  message: string;
  property: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
    whatsapp_number?: string | null;
    email?: string | null;
    check_in_time?: string | null;
    check_out_time?: string | null;
    hotel_policy?: string | null;
    instagram_url?: string | null;
    google_place_id?: string | null;
  } | null;
  greetingUsed: boolean;
}): FastFaqResult | null {
  const raw = params.message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 200) return null;
  const p = params.property ?? {};
  const opener = params.greetingUsed ? "" : "Halo Kak 👋 ";

  // — Greeting murni (tanpa pertanyaan lain) —
  if (
    /^(halo|hai|hi|hello|assalamu?alaikum|salam|permisi|selamat (pagi|siang|sore|malam))[\s!.\-,]*$/i.test(raw)
  ) {
    const name = p.name ?? "Pomah Guesthouse";
    return {
      reply: `Halo Kak, terima kasih sudah menghubungi ${name} 🙏\nAda yang bisa kami bantu — mau cek ketersediaan kamar, harga, atau info fasilitas?`,
      intent: "greeting",
    };
  }

  // — Terima kasih / penutup —
  if (/^(makasih|terima\s*kasih|thanks|thank\s*you|thx|tq|ty|oke\s*(makasih|thanks)?|sip|siap)[\s!.\-,]*$/i.test(raw)) {
    return {
      reply: `Sama-sama Kak 🙏 Kalau ada yang perlu ditanyakan lagi, silakan chat kami ya.`,
      intent: "thanks",
    };
  }

  // — Alamat / lokasi —
  if (
    /\b(alamat|lokasi|dimana|di mana|dmn|maps|map|lokasinya|arah|arahan|posisi)\b/i.test(raw) &&
    p.address
  ) {
    const mapsLink = p.google_place_id
      ? `https://www.google.com/maps/place/?q=place_id:${p.google_place_id}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`;
    return {
      reply: `${opener}Alamat kami:\n📍 ${p.address}\n\nMaps: ${mapsLink}`,
      intent: "location_question",
    };
  }

  // — Kontak (nomor WA / telepon / email / IG) —
  if (/\b(kontak|nomor|no\.?\s*wa|whatsapp|telepon|telp|hp|email|ig|instagram)\b/i.test(raw)) {
    const bits: string[] = [];
    if (p.whatsapp_number ?? p.phone) bits.push(`📱 WA/Telp: ${p.whatsapp_number ?? p.phone}`);
    if (p.email) bits.push(`✉️ Email: ${p.email}`);
    if (p.instagram_url) bits.push(`📸 Instagram: ${p.instagram_url}`);
    if (bits.length === 0) return null;
    return {
      reply: `${opener}Berikut kontak kami:\n${bits.join("\n")}`,
      intent: "contact_request",
    };
  }

  // — Jam check-in / check-out —
  if (/\b(check\s*[- ]?in|checkin|jam\s*masuk|waktu\s*masuk|check\s*[- ]?out|checkout|jam\s*keluar|waktu\s*keluar)\b/i.test(raw)) {
    const ci = p.check_in_time?.slice(0, 5) ?? "14:00";
    const co = p.check_out_time?.slice(0, 5) ?? "12:00";
    return {
      reply: `${opener}Waktu check-in mulai pukul *${ci}* dan check-out paling lambat *${co}*.\nEarly check-in / late check-out mengikuti ketersediaan kamar ya Kak 🙏`,
      intent: "policy_question",
    };
  }

  return null;
}


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

function isTonightReply(message: string): boolean {
  return /\b(malam ini|nanti malam|hari ini|today)\b/i.test(message);
}

function hasRecentPriceContext(messages: Array<{ direction: string; body: string }>): boolean {
  const recent = messages
    .slice(-6)
    .map((m) => m.body)
    .join("\n")
    .toLowerCase();
  return /\b(harga|rate|tarif|kamar|guest house|guesthouse|tanggal spesifik|check-in|check.?in|ketersediaan)\b/i.test(recent);
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

  const data = JSON.parse(raw) as {
    kamar?: Array<{
      nama?: string;
      harga_per_malam?: number;
      kamar_tersedia?: number | null;
      tidak_tersedia?: boolean;
      alasan?: string;
    }>;
  };

  const available = (data.kamar ?? [])
    .filter((r) => !r.tidak_tersedia && (r.kamar_tersedia ?? 0) > 0)
    .sort((a, b) => Number(a.harga_per_malam ?? 0) - Number(b.harga_per_malam ?? 0));

  if (available.length === 0) {
    return {
      intent: "deterministic_tonight_availability",
      reply:
        `Untuk malam ini (${fmtDateID(checkIn)} - ${fmtDateID(checkOut)}), ` +
        `sementara kamar yang tersedia belum ada di sistem. Saya bantu teruskan ke admin ya Kak.`,
    };
  }

  const lines = available.slice(0, 6).map((r) => {
    const price = Number(r.harga_per_malam ?? 0).toLocaleString("id-ID");
    const stock = r.kamar_tersedia == null ? "" : ` (${r.kamar_tersedia} kamar tersedia)`;
    return `- ${r.nama}: Rp${price}/malam${stock}`;
  });

  return {
    intent: "deterministic_tonight_price",
    reply:
      `Untuk malam ini (${fmtDateID(checkIn)} - ${fmtDateID(checkOut)}), pilihan yang tersedia:\n` +
      `${lines.join("\n")}\n\n` +
      `Mau saya bantu pilihkan kamar yang paling sesuai, Kak?`,
  };
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
  const manager = await resolveManagerByPhone(phone);
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
  if (manager || isConfiguredAdminPhone(phone)) {
    mode = "admin";
  }

  const isManager = mode === "admin";
  if ((!isManager && !c.auto_reply_enabled) || !c.fonnte_token) {
    return "skipped_config";
  }

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
              await sendWhatsAppMessage(c.fonnte_token, phone, ackBody);
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
      // Atomic claim: ubah send_status pending → rescuing HANYA kalau masih
      // pending. Kalau worker lain duluan, `claimed` kosong → kita tidak
      // memanggil Fonnte (mencegah double resend).
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
      // Resend gagal: kembalikan status ke 'failed' supaya tidak nge-block
      // rescue berikutnya (rescue lain bisa coba lagi setelah window 5 menit).
      await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .update({
          metadata: { ...stuckMsg.metadata, send_status: "failed", zombie_rescue_failed: true },
        })
        .eq("id", stuckMsg.id);
      console.warn(`[Autoreply] Zombie rescue gagal: ${reErr} — lanjut proses normal`);
      // Kalau resend juga gagal (Fonnte down), lanjutkan ke AI normal
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
  const rollingMessages = cleanedSession.slice(-10);

  const lastMessage =
    [...rollingMessages].reverse().find((m: { direction: string }) => m.direction === "in")?.body ?? "";

  let reply: string | null = null;
  let orchResult: any = null;

  const bookingActive = !!bookingState?.state && bookingState.state !== "IDLE";
  if (FAST_FAQ_ENABLED && !isManager && !bookingActive && lastMessage) {
    const fastFaq = buildFastFaqReply(lastMessage, p, (rooms ?? []) as Array<Record<string, unknown>>);
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

  if (!reply && !isManager && !bookingActive && lastMessage) {
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

  if (!reply && !isManager && !bookingActive && isTonightReply(lastMessage) && hasRecentPriceContext(rollingMessages)) {
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

  if (!reply && !isManager && !bookingActive && lastMessage) {
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

  if (!reply && !isManager && !bookingActive && lastMessage) {
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
  if (!reply && !isManager && !bookingActive && lastMessage) {
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
  if (!reply && !isManager && !bookingActive && lastMessage) {
    try {
      const propertyFaq = buildDeterministicPropertyFaqReply({
        message: lastMessage,
        property: p as any,
        greetingUsed: messageOpensWithGreeting(lastMessage),
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

  let quickAckTimer: ReturnType<typeof setTimeout> | undefined;
  if (QUICK_ACK_ENABLED && !reply && !isManager && queueEntryId && c.fonnte_token) {
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
          // worker lain sudah menulis duluan → skip kirim Fonnte.
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

          const { ok, error: ackErr } = await sendWhatsAppMessage(c.fonnte_token, phone, QUICK_ACK_MESSAGE);
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
  if (!reply && llmConfig && loadHeavyRetrieval) {
    const trainingSignals = await findTrainingSignals(
      supabaseAdmin as any,
      {
        userMessage: lastMessage ?? "",
        stage: (chatSummaryJson?.last_topic ?? null) as string | null,
      },
      llmConfig,
      { positiveLimit: 2, negativeLimit: 0 },
    );
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
    const aiTimeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
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

  // ── Atomic claim per queue_entry_id ────────────────────────────────────
  // Dedup-guard di atas read-then-write: dua worker konkuren bisa sama-sama
  // lolos pengecekan dan dua-duanya menulis baris 'pending' + memanggil
  // Fonnte → tamu menerima pesan dobel. Setelah persist, pastikan baris
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
            `(entry=${queueEntryId.slice(0, 8)}) — skip Fonnte`,
        );
        void updateBookingFormSendLog({ body: finalReply, status: "superseded" });
        return "ok";
      }
    } catch (e) {
      console.warn("[Autoreply] Atomic claim check failed (continuing):", e);
    }
  }

  metrics.sendStartedAt = Date.now();
  let { ok: sent, error: sendErr } = await sendWhatsAppMessage(
    c.fonnte_token,
    phone,
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
      c.fonnte_token,
      phone,
      `${finalReply}\n\n${attachUrl}`.trim(),
    ));
    metrics.sendFinishedAt = Date.now();
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
    // Fonnte) melewati batas, kita paksa outcome fatal supaya cabang di bawah
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

      const c = ctx as { auto_reply_enabled?: boolean; fonnte_token?: string | null };
      if (!c.auto_reply_enabled || !c.fonnte_token) continue;

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
  // failed. Worker bisa saja masih hidup memproses outbound (Fonnte +
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

    if (!fonnteToken || (!autoReplyEnabled && !isManagerEntry)) {
      // Tandai tetap supaya tidak dicek terus-menerus.
      await (supabaseAdmin as any)
        .from("wa_conversation_queue")
        .update({ last_error: withFallbackSentMarker(entry.last_error, "[fallback_sent:skipped]") })
        .eq("id", entry.id);
      continue;
    }

    // ── Atomic claim: tandai entry SEBELUM kirim (idempotency key) ─────────
    // Dua tick cron dapat melihat row 'failed' yang sama sebelum salah satu
    // menyetel marker. Tanpa claim atomik, keduanya akan memanggil Fonnte
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

    // Persist outbound BEFORE Fonnte (pola persist-then-send). Jika worker
    // mati setelah Fonnte tapi sebelum baris ini disimpan, claim di atas
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

    const { ok, error: sendErr } = await sendWhatsAppMessage(fonnteToken, entry.phone, fallbackBody);

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
