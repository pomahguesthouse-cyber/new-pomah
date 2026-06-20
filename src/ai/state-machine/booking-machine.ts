import { SupabaseClient } from "@supabase/supabase-js";
import { classifyIntent } from "@/ai/router/intent-classifier";
import { createBooking } from "@/tools/booking.tool";
import {
  getDailyRatesForRange,
  resolveRoomNightlyRates,
} from "@/services/pricing/daily-rate.service";
import type { RoomTypeRow } from "@/ai/context-builder";
import type { ToolContext } from "@/tools/types";

export type BookingState =
  | "IDLE"
  | "AWAITING_DATES"
  | "AWAITING_ALTERNATIVE_ROOM_TYPE"
  | "ROOM_SELECTED"
  | "AWAITING_NAME"
  | "CONFIRMING_NAME"
  | "AWAITING_EMAIL"
  | "CONFIRMING_PHONE"
  | "AWAITING_PHONE"
  | "CONFIRMING_BOOKING"
  | "PAYMENT_PENDING"
  | "COMPLETED";

export interface BookingRoomItem {
  roomTypeId: string;
  roomTypeName: string;
  quantity: number;
  pricePerNight: number;
}

export interface AlternativeRoomOption {
  roomTypeId: string;
  name: string;
  pricePerNight: number;
}

export interface BookingContext {
  checkIn?: string;
  checkOut?: string;
  roomId?: string;
  roomName?: string;
  pricePerNight?: number;
  totalPrice?: number;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  bookingCode?: string;
  adults?: number;
  children?: number;
  rooms?: BookingRoomItem[];
  /** Tipe kamar yang AWALNYA diminta tamu (mis. "Deluxe") tapi penuh. */
  requestedRoomType?: string;
  /** Tipe kamar alternatif yang dipilih tamu setelah requested room penuh. */
  selectedRoomType?: string;
  /** Daftar alternatif yang ditawarkan saat requested room penuh. */
  availableAlternatives?: AlternativeRoomOption[];
  /** Jumlah extra bed yang sudah disepakati (Deluxe: max 1/kamar). */
  extraBeds?: number;
  /** Tarif extra bed per malam (default Rp80.000). */
  extraBedRate?: number;
  /** Flag bahwa tamu sudah handoff ke admin manusia. */
  handoff?: boolean;
}


export interface StateRecord {
  phone: string;
  state: BookingState;
  context: BookingContext;
  updated_at: string;
  /** Last conversational topic outside the booking flow (e.g. "room_facilities"). */
  last_topic?: string | null;
  /** Entity the topic was about, e.g. { kind: "room", label: "Deluxe" }. */
  last_entity?: Record<string, unknown> | null;
  /** Partial slot data the user has mentioned (dates, guests, etc.). */
  slots?: Record<string, unknown>;
}

export interface StateMachineResult {
  handled: boolean;
  reply?: string;
  /**
   * Optional follow-up action for the orchestrator to perform AFTER the
   * state machine reply. Used to hand invoice delivery off to the Finance
   * Agent in the same turn so the guest sees one combined message:
   * state-machine ack + agent-crafted invoice details.
   */
  followUp?: "send_invoice";
  /** Reference code of the booking the follow-up should reference. */
  followUpRef?: string;
}

const CANCELLATION_PATTERNS = /\b(batal|batalkan|cancel|nggak jadi|ga jadi|gak jadi|tidak jadi|berhenti)\b/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^(?:\+62|62|0)[2-9][0-9]{7,11}$/;

// Affirm = "use this one"; Decline/Other = "use a different one".
const USE_THIS_PATTERN = /\b(ya|iya|yes|pakai ini|gunakan ini|ini saja|ini aja|pake ini|betul|benar|oke|ok|sip|setuju|lanjut)\b/i;
const USE_OTHER_PATTERN = /\b(lain|lainnya|beda|berbeda|ganti|bukan|tidak|nggak|ngga|enggak|gak|ubah|nama lain|nomor lain|no lain)\b/i;

// Specific "use this phone number" phrases for CONFIRMING_PHONE state.
const USE_THIS_PHONE_PATTERN =
  /^(ya|iya|yes)?\s*(pakai|gunakan|pake|nomor)?\s*(nomor)\s*(ini|sini|aja|saja|oke|ok|ya)\b/i;

const CONFIRM_PATTERN = /\b(ya|iya|yes|lanjut|benar|oke|ok|setuju|betul|lanjutkan|ya benar|yup)\b/i;
const CANCEL_PATTERN = /\b(tidak|batal|salah|ubah|ganti|cancel|no|nggak|ngga)\b/i;

/**
 * Token-token yang BUKAN nama orang — termasuk frasa frustrasi/kebingungan.
 * Mencegah "saya pusing", "bingung", "embuh" tersimpan sebagai guestName.
 */
const NON_NAME_TOKENS = /\b(aja|biar|buat|tolong|kalo|kalau|yang|sama|sebelahan|samping|atas|bawah|deket|dekat|atau|tapi|cuma|sih|nih|dong|deh|nya|kamar|room|wifi|ac|sarapan|breakfast|pusing|bingung|embuh|ribet|capek|cape|penipuan|scam|email|nomor|hp|bukan)\b/i;


// Honorifik / panggilan umum yang sering ditempel di awal/akhir nama
// (contoh: "Ratih Asmarani kak", "kak Budi", "mas Joko"). Dibersihkan
// sebelum validasi nama supaya tidak salah-tolak.
const HONORIFIC_TOKEN = /\b(kak|kakak|mba|mbak|mas|pak|bu|bro|sis|bang|kk)\b/gi;

/**
 * Detect "this looks like a request about the booking itself (room
 * preference, payment, etc.), not a name". Used inside CONFIRMING_NAME
 * so we can defer to the LLM (which can acknowledge "kamar 205/206
 * sebelahan dicatat ya") instead of just rejecting flatly. We keep the
 * existing guestName intact in this case.
 */
const ROOM_PREFERENCE_OR_QUESTION =
  /(?:\d{2,3}\s*[\/\-]\s*\d{2,3})|\b(sebelahan|samping|sebelah|depan|belakang|atas|bawah|deket|dekat|view|pemandangan|pojok)\b|\?/i;

/**
 * Bersihkan kandidat nama: ambil baris pertama (tamu sering menulis
 * "Ratih Asmarani\n28 Juni kak, single"), buang honorifik di awal/akhir,
 * dan rapikan whitespace. Mengembalikan string siap-validasi.
 */
function cleanNameCandidate(candidate: string): string {
  const firstLine = candidate.split(/\r?\n/)[0] ?? candidate;
  return firstLine
    .replace(HONORIFIC_TOKEN, " ")
    .replace(/[,.\-–—!]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikePersonName(candidate: string): boolean {
  const t = candidate.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (/[\d/@]/.test(t)) return false;          // numbers, slashes, @ → not a name
  if (t.endsWith("?")) return false;
  if (NON_NAME_TOKENS.test(t)) return false;
  const tokens = t.split(/\s+/);
  if (tokens.length > 5) return false;          // names rarely > 5 tokens
  // Must contain at least one alphabetic word of length ≥ 2.
  if (!tokens.some((w) => /^[A-Za-zÀ-ÿ.'\-]{2,}$/.test(w))) return false;
  return true;
}

/** Display a raw WA phone (e.g. "628123...") in a friendly local format. */
function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.startsWith("62")) return "0" + digits.slice(2);
  return digits;
}

/** Format YYYY-MM-DD ke "10 Juni 2026" dalam bahasa Indonesia. */
function formatDateId(iso: string): string {
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${months[month - 1]} ${year}`;
}

/** Hitung selisih malam antara dua tanggal YYYY-MM-DD. */
function countNights(checkIn: string, checkOut: string): number {
  const d1 = new Date(checkIn);
  const d2 = new Date(checkOut);
  return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86_400_000));
}

/**
 * Struktur policy extra bed per tipe kamar. Selalu berasal dari DB
 * (`room_types`), tidak boleh hardcode per nama kamar.
 */
export interface RoomExtraBedPolicy {
  roomTypeId?: string;
  roomTypeName?: string;
  /** Kapasitas default tanpa extra bed. Fallback 1 bila DB kosong. */
  capacity: number;
  /** Berapa extra bed maksimum yang boleh ditambahkan per kamar. */
  extrabedCapacity: number;
  /** Tarif extra bed per malam dalam Rupiah. 0 = belum dikonfigurasi. */
  extrabedRate: number;
}

/** Bentuk minimal entri katalog kamar yang dibutuhkan untuk extra bed. */
interface RoomCatalogEntry {
  id: string;
  name: string;
  capacity?: number | null;
  extrabed_capacity?: number | null;
  extrabed_rate?: number | null;
}

/**
 * Pilih policy extra bed berdasarkan konteks booking + katalog kamar dari DB.
 * Prioritas pencarian: roomId → roomName → context.rooms[0].
 */
export function resolveRoomExtraBedPolicy(
  context: BookingContext,
  roomsCatalog?: RoomCatalogEntry[],
): RoomExtraBedPolicy {
  const list = roomsCatalog ?? [];
  let match: RoomCatalogEntry | undefined;

  if (context.roomId) {
    match = list.find((r) => r.id === context.roomId);
  }
  if (!match && context.roomName) {
    const target = context.roomName.toLowerCase();
    match = list.find((r) => r.name.toLowerCase() === target);
  }
  if (!match && context.rooms && context.rooms.length > 0) {
    const first = context.rooms[0];
    const firstName = first.roomTypeName?.toLowerCase();
    match = list.find(
      (r) =>
        r.id === first.roomTypeId ||
        (firstName != null && r.name.toLowerCase() === firstName),
    );
  }

  return {
    roomTypeId: match?.id,
    roomTypeName: match?.name,
    capacity: Number(match?.capacity ?? 0) || 1,
    extrabedCapacity: Number(match?.extrabed_capacity ?? 0) || 0,
    extrabedRate: Number(match?.extrabed_rate ?? 0) || 0,
  };
}

/**
 * Build the pre-confirmation booking summary once all guest details are set.
 * Versi sync — fallback ketika daily-rate dynamic tidak bisa di-resolve.
 */
function buildBookingSummary(
  context: BookingContext,
  roomsCatalog?: RoomCatalogEntry[],
  overrides?: {
    rooms?: BookingRoomItem[];
    roomSubtotal?: number;
    displayRatePerNight?: number;
    hasDynamicBreakdown?: boolean;
  },
): StateMachineResult {
  // --- Room line ---
  const summaryRooms = overrides?.rooms ?? context.rooms;
  let roomsDisplay: string;
  if (summaryRooms && summaryRooms.length > 0) {
    roomsDisplay = summaryRooms
      .map((r) => `${r.quantity}x ${r.roomTypeName}`)
      .join(", ");
  } else {
    roomsDisplay = context.roomName ?? "—";
  }

  // --- Price per night (prefer dynamic average bila tersedia) ---
  const pricePerNight =
    overrides?.displayRatePerNight ??
    (summaryRooms && summaryRooms.length > 0
      ? summaryRooms[0].pricePerNight
      : (context.pricePerNight ?? 0));

  // --- Nights & total ---
  const nights =
    context.checkIn && context.checkOut
      ? countNights(context.checkIn, context.checkOut)
      : null;

  // --- Dates with check-in / check-out times ---
  const checkInDisplay = context.checkIn
    ? `${formatDateId(context.checkIn)}, 14.00`
    : "—";
  const checkOutDisplay = context.checkOut
    ? `${formatDateId(context.checkOut)}, 12.00`
    : "—";

  // --- Adults ---
  const adults = context.adults ?? 1;
  const adultLine = `${adults} orang dewasa`;

  // --- Format currency IDR ---
  const fmtRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

  // --- Resolve extra-bed policy & jumlah extra bed dari DB ---
  const policy = resolveRoomExtraBedPolicy(context, roomsCatalog);
  const resolvedExtraBedRate = policy.extrabedRate;
  if (resolvedExtraBedRate > 0) context.extraBedRate = resolvedExtraBedRate;

  const totalRooms = summaryRooms?.reduce((s, r) => s + r.quantity, 0) ?? 1;
  const eb = computeExtraBeds(policy, totalRooms, adults);
  const extraBeds = context.extraBeds ?? eb.extraBeds;
  const hasRate = resolvedExtraBedRate > 0;
  const extraBedTotal =
    nights && extraBeds > 0 && hasRate ? nights * extraBeds * resolvedExtraBedRate : 0;

  // Subtotal kamar: pakai dynamic (jika tersedia), kalau tidak fallback rata.
  const fallbackSubtotal = nights && pricePerNight ? nights * pricePerNight * totalRooms : 0;
  const roomSubtotal = overrides?.roomSubtotal ?? context.totalPrice ?? fallbackSubtotal;
  const grandTotal = roomSubtotal + extraBedTotal;

  const ratePrefix = overrides?.hasDynamicBreakdown ? "rata-rata " : "";

  const extraBedLine = extraBeds > 0
    ? (hasRate
        ? `- Extra bed: ${extraBeds}x @ ${fmtRp(resolvedExtraBedRate)}/malam = ${fmtRp(extraBedTotal)}\n`
        : `- Extra bed: ${extraBeds}x (tarif perlu dikonfirmasi admin)\n`)
    : "";

  const roomLabel = policy.roomTypeName ?? context.roomName ?? "kamar";
  const totalMaxGuests = (policy.capacity + policy.extrabedCapacity) * totalRooms;
  const overCapLine = eb.overCapacity
    ? `\n⚠️ Kapasitas maksimum ${totalRooms} kamar ${roomLabel} adalah ${totalMaxGuests} tamu. ` +
      `Mohon tambah kamar atau kurangi jumlah tamu.\n`
    : "";

  const summary =
    `Data pemesanan sudah lengkap! Berikut ringkasannya:\n\n` +
    `- Nama: ${context.guestName ?? "—"}\n` +
    `- Email: ${context.guestEmail ?? "—"}\n` +
    `- No. HP: ${context.guestPhone ?? "—"}\n` +
    `- Kamar: ${roomsDisplay}\n` +
    `- Check-in: ${checkInDisplay}\n` +
    `- Check-out: ${checkOutDisplay}\n` +
    `- Durasi: ${nights != null ? `${nights} malam` : "—"}\n` +
    `- Jumlah tamu: ${adultLine}\n` +
    `- Harga: ${pricePerNight ? `${ratePrefix}${fmtRp(pricePerNight)}/malam` : "—"}\n` +
    extraBedLine +
    `- Total: ${grandTotal ? fmtRp(grandTotal) : "—"}` +
    overCapLine +
    `\n\nApakah data di atas sudah benar dan Kakak ingin melanjutkan ke Booking & Pembayaran? ` +
    `Ketik "Ya" atau "Lanjut" untuk konfirmasi, atau langsung sebutkan data yang ingin dikoreksi ` +
    `(misal: "jumlah tamu 5", "tanggal 22 Juni", "ganti Family Suite"). Ketik "Batal" untuk membatalkan.`;
  return { handled: true, reply: summary };
}

/**
 * Resolve nightly rates dinamis dari `room_daily_rates` (fallback `base_rate`)
 * untuk seluruh tipe kamar dalam booking. Mengembalikan subtotal kamar,
 * tarif tampilan, dan flag dynamic breakdown sehingga ringkasan selaras
 * dengan harga final yang dipakai create_booking.
 */
export async function resolveBookingSummaryRates(
  ctx: ToolContext,
  context: BookingContext,
): Promise<{
  rooms: BookingRoomItem[];
  roomSubtotal: number;
  displayRatePerNight: number;
  hasDynamicBreakdown: boolean;
  stopSellDates: string[];
} | null> {
  if (!context.checkIn || !context.checkOut) return null;
  const items = context.rooms ?? [];
  if (items.length === 0) return null;

  const roomTypeIds = Array.from(
    new Set(items.map((r) => r.roomTypeId).filter((id): id is string => !!id)),
  );
  if (roomTypeIds.length === 0) return null;

  const overrides = await getDailyRatesForRange(
    ctx.supabasePublic,
    roomTypeIds,
    context.checkIn,
    context.checkOut,
  );

  const nights = countNights(context.checkIn, context.checkOut);
  const resolvedRooms: BookingRoomItem[] = [];
  const stopSellDates: string[] = [];
  let roomSubtotal = 0;
  let hasDynamicBreakdown = false;
  let firstAvg: number | null = null;
  let sameRate = true;
  let avgSum = 0;
  let avgCount = 0;

  for (const item of items) {
    const rt = ctx.rooms.find((r) => r.id === item.roomTypeId) as
      | RoomTypeRow
      | undefined;
    if (!rt) {
      resolvedRooms.push(item);
      roomSubtotal += item.pricePerNight * item.quantity * nights;
      continue;
    }
    const resolved = resolveRoomNightlyRates(
      rt,
      context.checkIn,
      context.checkOut,
      overrides.get(item.roomTypeId),
    );
    if (resolved.has_stop_sell) stopSellDates.push(...resolved.stop_sell_dates);
    if (!resolved.all_base) hasDynamicBreakdown = true;
    roomSubtotal += resolved.total * item.quantity;
    const avg = resolved.nights
      ? Math.round(resolved.total / resolved.nights)
      : item.pricePerNight;
    resolvedRooms.push({ ...item, pricePerNight: avg });
    avgSum += avg;
    avgCount += 1;
    if (firstAvg === null) firstAvg = avg;
    else if (avg !== firstAvg) sameRate = false;
  }

  const displayRatePerNight = sameRate
    ? (firstAvg ?? 0)
    : Math.round(avgSum / Math.max(1, avgCount));

  return {
    rooms: resolvedRooms,
    roomSubtotal,
    displayRatePerNight,
    hasDynamicBreakdown,
    stopSellDates: Array.from(new Set(stopSellDates)),
  };
}

/**
 * Versi async: pakai daily-rate dynamic. Jika ada stop_sell pada salah satu
 * malam, balas pesan minta pilih tanggal/tipe lain alih-alih ringkasan final.
 * Fallback ke versi sync bila resolve gagal (mis. data context tidak lengkap).
 */
async function buildBookingSummaryAsync(
  ctx: ToolContext,
  context: BookingContext,
): Promise<StateMachineResult> {
  try {
    const resolved = await resolveBookingSummaryRates(ctx, context);
    if (resolved && resolved.stopSellDates.length > 0) {
      const tanggalList = resolved.stopSellDates
        .map((d) => formatDateId(d))
        .join(", ");
      const roomLabel =
        context.rooms?.[0]?.roomTypeName ?? context.roomName ?? "tipe kamar ini";
      return {
        handled: true,
        reply:
          `Mohon maaf Kak, ${roomLabel} tidak dijual untuk tanggal ${tanggalList}. ` +
          `Silakan pilih tanggal lain atau tipe kamar lain ya 🙏.`,
      };
    }
    if (resolved) {
      return buildBookingSummary(context, ctx.rooms, {
        rooms: resolved.rooms,
        roomSubtotal: resolved.roomSubtotal,
        displayRatePerNight: resolved.displayRatePerNight,
        hasDynamicBreakdown: resolved.hasDynamicBreakdown,
      });
    }
  } catch (e) {
    console.warn("[BookingState] resolveBookingSummaryRates failed, fallback sync:", e);
  }
  return buildBookingSummary(context, ctx.rooms);
}



export async function getBookingState(supabase: SupabaseClient, phone: string): Promise<StateRecord> {
  const { data, error } = await supabase.rpc("get_active_booking_state", { p_phone: phone });
  if (error || !data) {
    return { phone, state: "IDLE", context: {}, updated_at: new Date().toISOString(), slots: {} };
  }
  const rec = data as StateRecord;
  if (!rec.slots) rec.slots = {};
  return rec;
}

export async function updateBookingState(
  supabase: SupabaseClient,
  phone: string,
  state: BookingState,
  context: BookingContext
): Promise<void> {
  await supabase.rpc("update_booking_state", {
    p_phone: phone,
    p_state: state,
    p_context: context,
  });
}

/**
 * Validates extraction using basic regex or string matching.
 * In a more advanced setup, this could use an LLM function call to extract entities.
 */
function extractEmail(text: string): string | null {
  const match = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  return match ? match[0] : null;
}

function extractPhone(text: string): string | null {
  const cleaned = text.replace(/[^0-9+]/g, '');
  if (PHONE_PATTERN.test(cleaned)) return cleaned;
  return null;
}

// States in which the bot is collecting/confirming guest data and can be
// interrupted by an unrelated question.
const DATA_ENTRY_STATES: BookingState[] = [
  "AWAITING_NAME",
  "CONFIRMING_NAME",
  "AWAITING_EMAIL",
  "CONFIRMING_PHONE",
  "AWAITING_PHONE",
  "CONFIRMING_BOOKING",
];

export function isDataEntryState(state: BookingState): boolean {
  return DATA_ENTRY_STATES.includes(state);
}

/**
 * Human-readable label of the field the bot is currently waiting on.
 * Used by the stuck-state monitor + super-admin notifications so investigators
 * see "macet di nomor_hp" tanpa menebak dari nama state.
 */
export function getRequiredField(state: BookingState): string | null {
  switch (state) {
    case "AWAITING_DATES":                  return "tanggal";
    case "AWAITING_ALTERNATIVE_ROOM_TYPE":  return "tipe_kamar_alternatif";
    case "ROOM_SELECTED":                   return "tipe_kamar";
    case "AWAITING_NAME":                   return "nama";
    case "CONFIRMING_NAME":                 return "konfirmasi_nama";
    case "AWAITING_EMAIL":                  return "email";
    case "CONFIRMING_PHONE":                return "konfirmasi_nomor_hp";
    case "AWAITING_PHONE":                  return "nomor_hp";
    case "CONFIRMING_BOOKING":              return "konfirmasi_booking";
    case "PAYMENT_PENDING":                 return "bukti_pembayaran";
    default:                                return null;
  }
}

/** Format daftar alternatif sebagai numbered list untuk ditampilkan ke tamu. */
export function formatAlternativesList(alts: AlternativeRoomOption[]): string {
  return alts
    .map((a, i) => `${i + 1}. ${a.name} - Rp${a.pricePerNight.toLocaleString("id-ID")}/malam`)
    .join("\n");
}

/** Cocokkan jawaban tamu dengan salah satu alternatif (nama / nomor urut). */
export function matchAlternative(
  message: string,
  alts: AlternativeRoomOption[],
): AlternativeRoomOption | null {
  const t = message.trim().toLowerCase();
  if (!t) return null;
  // Pilihan nomor: "1", "2", "pilih 2", "no 3"
  const numMatch = t.match(/^(?:pilih\s+|nomor\s+|no\.?\s+|opsi\s+)?(\d+)\b/);
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    if (idx >= 0 && idx < alts.length) return alts[idx];
  }
  // Cocokkan nama (substring dua arah, case-insensitive)
  for (const a of alts) {
    const n = a.name.toLowerCase();
    if (t === n) return a;
    if (t.includes(n) || n.includes(t)) return a;
  }
  return null;
}

/** Normalisasi nama kamar untuk perbandingan: lowercase, trim, buang prefix umum. */
export function normalizeRoomName(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(kamar|room|tipe|type)\b/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Temukan tipe kamar yang disebut tamu di pesan bebas. Dynamic — tidak
 * hardcode daftar nama kamar. Kalau ada lebih dari satu match dengan
 * panjang nama yang sama (ambigu), return null agar bot minta klarifikasi.
 */
export function findMentionedRoomType<
  R extends { id: string; name: string; base_rate?: number | null },
>(input: string, rooms: R[]): R | null {
  const normInput = normalizeRoomName(input);
  if (!normInput || rooms.length === 0) return null;

  // Exact match terhadap seluruh input.
  const exact = rooms.find((r) => normalizeRoomName(r.name) === normInput);
  if (exact) return exact;

  // Partial: nama room muncul sebagai substring token-bounded.
  const matches = rooms
    .map((r) => ({ room: r, norm: normalizeRoomName(r.name) }))
    .filter(({ norm }) => norm.length >= 2)
    .filter(({ norm }) => {
      const re = new RegExp(
        `(^|\\s)${norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(\\s|$)`,
      );
      return re.test(normInput);
    })
    .sort((a, b) => b.norm.length - a.norm.length);

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].room;
  // Ambigu bila top-2 punya panjang nama sama.
  if (matches[0].norm.length === matches[1].norm.length) return null;
  return matches[0].room;
}

/** Temukan koreksi tipe kamar yang disebut tamu sebelum konfirmasi final. */
export function detectRequestedRoomChange(
  message: string,
  rooms: Array<{ id: string; name: string; base_rate?: number | null }>,
  currentRoomId?: string,
): { id: string; name: string; pricePerNight: number } | null {
  const candidates = rooms.filter((room) => room.id !== currentRoomId);
  const selected = findMentionedRoomType(message, candidates);
  if (!selected) return null;
  return {
    id: selected.id,
    name: selected.name,
    pricePerNight: Number(selected.base_rate ?? 0),
  };
}


/** Detect "tamu jelas-jelas memulai booking baru" — pakai untuk auto-reset stale states. */
const NEW_BOOKING_INTENT_PATTERN =
  /\b(booking|pesan|reservasi|mau (nginap|menginap|pesan|booking)|cek (kamar|ketersediaan)|ada kamar|kamar (kosong|tersedia))\b/i;

// Question / info-request signals that indicate the guest is asking something
// else instead of answering the current prompt.
const QUESTION_PATTERN =
  /\?|\b(apa|apakah|berapa|bagaimana|gimana|kapan|di ?mana|dimana|kenapa|mengapa|tanya|fasilitas|wifi|parkir|sarapan|breakfast|lokasi|alamat|harga|tarif|refund|kebijakan|check ?in|check ?out|jam berapa)\b/i;

/**
 * Is the message the answer we're currently expecting for `state`?
 * Used to avoid misreading a valid answer as an interruption.
 */
function isExpectedAnswer(state: BookingState, message: string): boolean {
  switch (state) {
    case "AWAITING_EMAIL":
      return !!extractEmail(message);
    case "AWAITING_PHONE":
    case "CONFIRMING_PHONE":
      return !!extractPhone(message) || USE_THIS_PATTERN.test(message) || USE_OTHER_PATTERN.test(message) || USE_THIS_PHONE_PATTERN.test(message);
    case "CONFIRMING_NAME":
      return USE_THIS_PATTERN.test(message) || USE_OTHER_PATTERN.test(message);
    case "CONFIRMING_BOOKING":
      return CONFIRM_PATTERN.test(message) || CANCEL_PATTERN.test(message);
    case "AWAITING_NAME":
    default:
      return false; // a name is freeform — rely on interruption signals instead
  }
}

// Intent categories that should pause data entry and be answered by the LLM /
// specialist agents (the booking state is preserved so the flow can resume).
const INTERRUPT_INTENTS = new Set([
  "complaint",
  "maintenance",
  "customer-care",
  "pricing_inquiry",
  "payment",
  "availability_check",
  "booking_inquiry",
]);

/**
 * Parser koreksi slot saat tamu menjawab di state akhir (CONFIRMING_BOOKING).
 * Mendukung pola umum berbahasa Indonesia. Mengembalikan patch parsial untuk
 * digabungkan ke BookingContext + bool apakah ada perubahan.
 */
export function parseSlotCorrection(input: string): {
  patch: Partial<BookingContext>;
  changed: boolean;
} {
  const text = input.toLowerCase();
  const patch: Partial<BookingContext> = {};
  let changed = false;

  // Jumlah tamu: "5 tamu", "tamu 5", "jumlah tamu 5", "kami 5 orang"
  const guestsMatch = text.match(
    /(?:jumlah\s+)?(?:tamu|orang|pax|dewasa|guest)s?\s*(?:nya|:)?\s*(\d{1,2})|(?:\d{1,2})\s*(?:tamu|orang|pax|dewasa|guest)s?/i,
  );
  if (guestsMatch) {
    const n = Number(guestsMatch[1] ?? guestsMatch[0].match(/\d{1,2}/)?.[0]);
    if (n && n >= 1 && n <= 16) {
      patch.adults = n;
      changed = true;
    }
  }

  // Tipe kamar: deluxe / family / single
  if (/\bdeluxe\b/i.test(input)) { patch.roomName = "Deluxe"; changed = true; }
  else if (/\bfamily(?:\s+suite)?\b/i.test(input)) { patch.roomName = "Family Suite"; changed = true; }
  else if (/\bsingle\b/i.test(input)) { patch.roomName = "Single"; changed = true; }

  // Jumlah kamar: "2 kamar deluxe"
  const roomsCountMatch = input.match(/(\d+)\s*kamar\b/i);
  if (roomsCountMatch && patch.roomName) {
    const qty = Number(roomsCountMatch[1]);
    if (qty >= 1 && qty <= 10) {
      patch.rooms = [{
        roomTypeId: "",
        roomTypeName: patch.roomName,
        quantity: qty,
        pricePerNight: 0,
      }];
      changed = true;
    }
  }

  return { patch, changed };
}

/**
 * Hitung extra bed berbasis policy DB. Tidak hardcode tipe kamar/tarif.
 *
 * - totalDefaultCapacity = policy.capacity * roomCount
 * - totalExtraBedCapacity = policy.extrabedCapacity * roomCount
 * - overCapacity = guests > (totalDefaultCapacity + totalExtraBedCapacity)
 */
export function computeExtraBeds(
  policy: RoomExtraBedPolicy,
  roomCount: number,
  guests: number,
): { extraBeds: number; overCapacity: boolean; ratePerNight: number } {
  const ratePerNight = policy.extrabedRate;
  if (roomCount <= 0) return { extraBeds: 0, overCapacity: false, ratePerNight };

  const totalDefault = policy.capacity * roomCount;
  const totalExtra = policy.extrabedCapacity * roomCount;
  const totalMax = totalDefault + totalExtra;

  if (guests <= totalDefault) {
    return { extraBeds: 0, overCapacity: false, ratePerNight };
  }
  const need = guests - totalDefault;
  const extraBeds = Math.min(need, totalExtra);
  const overCapacity = guests > totalMax;
  return { extraBeds, overCapacity, ratePerNight };
}


/**
 * Evaluates the message against the current state and returns whether the state machine handled it.
 */
export async function processBookingState(
  ctx: ToolContext,
  phone: string,
  message: string,
  currentStateRecord: StateRecord
): Promise<StateMachineResult> {
  const supabase = ctx.supabaseAdmin;
  let { state, context } = currentStateRecord;

  // Cancellation: bersihkan draft booking + pending invoice agar tidak
  // pernah ada invoice "menggantung" sampai user mulai ulang & konfirmasi.
  if (CANCELLATION_PATTERNS.test(message) && state !== "IDLE") {
    try {
      // Cari guest berdasarkan phone, lalu cancel booking pending miliknya.
      const { data: guests } = await (supabase as any)
        .from("guests")
        .select("id")
        .eq("phone", phone);
      const guestIds = ((guests ?? []) as Array<{ id: string }>).map((g) => g.id);
      if (guestIds.length > 0) {
        const { data: pendingBookings } = await (supabase as any)
          .from("bookings")
          .select("id")
          .in("guest_id", guestIds)
          .in("status", ["pending"]);
        const bookingIds = ((pendingBookings ?? []) as Array<{ id: string }>).map((b) => b.id);
        if (bookingIds.length > 0) {
          await (supabase as any)
            .from("bookings")
            .update({ status: "cancelled" })
            .in("id", bookingIds);
          // Tandai invoice terkait (jika ada) sebagai void via payment_status_snapshot.
          await (supabase as any)
            .from("invoices")
            .delete()
            .in("booking_id", bookingIds);
        }
      }
    } catch (e) {
      console.warn("[BookingState] cancel cleanup failed (non-fatal):", e);
    }
    await updateBookingState(supabase, phone, "IDLE", {});
    return {
      handled: true,
      reply:
        "Baik Kak, proses reservasi sudah dibatalkan dan draft invoice juga sudah saya bersihkan. " +
        "Kalau nanti ingin mulai ulang, tinggal sebut tanggal & tipe kamarnya ya 🙏.",
    };
  }



  if (state === "IDLE") {
    return { handled: false }; // Handled by LLM via normal AI workflow
  }

  // Mid-booking interruption: the guest asks something unrelated instead of
  // answering the current prompt. Hand the turn to the LLM / specialist agents
  // to answer, but KEEP the booking state so the flow resumes on the next
  // relevant reply (the state auto-resets after 15 min if truly abandoned).
  if (isDataEntryState(state) && !isExpectedAnswer(state, message)) {
    const interruptByQuestion = QUESTION_PATTERN.test(message);
    const interruptByIntent   = INTERRUPT_INTENTS.has((await classifyIntent(message, supabase)).category);
    if (interruptByQuestion || interruptByIntent) {
      console.info(`[BookingState] Interruption during ${state} — preserving state, deferring to LLM`);
      return { handled: false };
    }
  }

  // State: AWAITING_ALTERNATIVE_ROOM_TYPE
  // Requested room is full; tamu memilih tipe kamar pengganti.
  if (state === "AWAITING_ALTERNATIVE_ROOM_TYPE") {
    const alts = context.availableAlternatives ?? [];
    const requested = context.requestedRoomType ?? "kamar pilihan awal";
    const altListText = formatAlternativesList(alts);
    const altNamesInline = alts.map((a) => a.name).join(", ");

    // Helper: prompt ulang setelah menyimpan info pendukung.
    const reAskWithPrefix = (prefix: string): StateMachineResult => ({
      handled: true,
      reply: `${prefix}Untuk melanjutkan booking, silakan pilih tipe kamar yang tersedia: ${altNamesInline}.`,
    });

    const trimmed = message.trim();
    // 1) Pilih alternatif valid → simpan & lanjut ke pengisian nama.
    const picked = matchAlternative(trimmed, alts);
    if (picked) {
      context.selectedRoomType = picked.name;
      context.roomId = picked.roomTypeId;
      context.roomName = picked.name;
      context.pricePerNight = picked.pricePerNight;
      context.rooms = [{
        roomTypeId:    picked.roomTypeId,
        roomTypeName:  picked.name,
        quantity:      1,
        pricePerNight: picked.pricePerNight,
      }];
      // Lanjut ke slot berikutnya yang masih kosong.
      if (context.guestName && looksLikePersonName(context.guestName)) {
        await updateBookingState(supabase, phone, "CONFIRMING_NAME", context);
        return {
          handled: true,
          reply:
            `Siap Kak, kamar ${picked.name} saya catat. ` +
            `Apakah Kakak ingin memakai nama "${context.guestName}" untuk pemesanan, ` +
            `atau menggunakan nama lain? Balas "Ya" untuk memakai nama ini, atau ketik nama lain.`,
        };
      }
      await updateBookingState(supabase, phone, "AWAITING_NAME", context);
      return {
        handled: true,
        reply: `Siap Kak, kamar ${picked.name} saya catat. Untuk melanjutkan, mohon ketikkan nama lengkap Kakak:`,
      };
    }

    // 2) Email → simpan, tetap minta tipe kamar.
    const email = extractEmail(trimmed);
    if (email) {
      context.guestEmail = email;
      await updateBookingState(supabase, phone, state, context);
      return {
        handled: true,
        reply:
          `Email ${email} sudah saya catat, Kak. ` +
          `Untuk melanjutkan booking, silakan pilih tipe kamar yang tersedia: ${altNamesInline}.`,
      };
    }

    // 3) Nomor HP → simpan, tetap minta tipe kamar.
    const typedPhone = extractPhone(trimmed);
    if (typedPhone) {
      context.guestPhone = typedPhone;
      await updateBookingState(supabase, phone, state, context);
      return reAskWithPrefix(`Nomor ${typedPhone} sudah saya catat, Kak. `);
    }

    // 4) Konfirmasi tanpa pilih kamar ("ya", "lanjut", "oke") → tampilkan ulang.
    if (USE_THIS_PATTERN.test(trimmed) && !matchAlternative(trimmed, alts)) {
      return {
        handled: true,
        reply:
          `Siap Kak. Karena ${requested} penuh, silakan pilih salah satu kamar yang tersedia:\n${altListText}`,
      };
    }

    // 5) Nama orang → simpan, tetap minta tipe kamar.
    if (looksLikePersonName(trimmed)) {
      context.guestName = trimmed;
      await updateBookingState(supabase, phone, state, context);
      const firstName = trimmed.split(/\s+/)[0];
      return reAskWithPrefix(
        `Baik Kak ${firstName}, saya catat namanya. Karena ${requested} penuh, `,
      );
    }

    // 6) Tidak jelas → tampilkan ulang opsi.
    return {
      handled: true,
      reply:
        `Mohon maaf Kak, saya belum menangkap pilihan kamarnya. ` +
        `Kamar yang tersedia untuk tanggal tersebut:\n${altListText}\n\n` +
        `Balas dengan salah satu nama kamar di atas ya, Kak.`,
    };
  }

  // State: ROOM_SELECTED -> AWAITING_NAME
  // (Transition from IDLE to ROOM_SELECTED is handled by the AI Front Office Agent when tool is called)

  
  if (state === "AWAITING_NAME") {
    // We assume the user replied with their name. Bersihkan honorifik
    // ("kak", "mas", dll.) dan ambil baris pertama sebelum validasi.
    const raw = message.trim();
    const name = cleanNameCandidate(raw);
    if (name.length < 2) {
      return { handled: true, reply: "Maaf, nama yang dimasukkan terlalu singkat. Silakan masukkan nama lengkap Kakak:" };
    }
    if (!looksLikePersonName(name)) {
      // Looks like the guest typed a question or a room preference instead.
      // Don't store the garbage as guestName.
      // If clearly a question/room-pref, defer to LLM so it can answer and
      // then re-ask for the name in the same turn.
      if (ROOM_PREFERENCE_OR_QUESTION.test(raw)) {
        console.info(
          `[BookingState] AWAITING_NAME: question/room-pref detected ("${raw.slice(0, 60)}…"). ` +
          `Deferring to LLM.`,
        );
        return { handled: false };
      }
      return {
        handled: true,
        reply:
          "Sepertinya itu belum berupa nama. Mohon ketikkan nama lengkap " +
          "yang akan dipakai pada pemesanan ya, Kak (contoh: 'Budi Santoso').",
      };
    }
    // Record as a candidate name and confirm before locking it in for the booking.
    context.guestName = name;
    await updateBookingState(supabase, phone, "CONFIRMING_NAME", context);
    return {
      handled: true,
      reply: `Baik, nama "${name}". Apakah Kakak ingin memakai nama ini untuk pemesanan, atau menggunakan nama lain?\n\nBalas "Ya" untuk memakai nama ini, atau ketik langsung nama lain yang Kakak inginkan.`,
    };
  }

  if (state === "CONFIRMING_NAME") {
    const trimmed = message.trim();
    // Guard pertama: jika pesan jelas berupa pertanyaan / preferensi kamar
    // (mis. "untuk parkir mobil aman ya?", "kamar pojok ya"), JANGAN
    // perlakukan kata "ya" di akhirnya sebagai konfirmasi nama. Serahkan ke
    // LLM supaya pertanyaan tamu dijawab; state nama dipertahankan.
    if (ROOM_PREFERENCE_OR_QUESTION.test(trimmed)) {
      console.info(
        `[BookingState] CONFIRMING_NAME: question/room-pref detected ` +
        `("${trimmed.slice(0, 60)}…") — preserving guestName "${context.guestName}" ` +
        `and deferring to LLM.`,
      );
      return { handled: false };
    }
    // Explicit "use this name"
    if (USE_THIS_PATTERN.test(trimmed) && !USE_OTHER_PATTERN.test(trimmed)) {
      await updateBookingState(supabase, phone, "AWAITING_EMAIL", context);
      return {
        handled: true,
        reply: `Terima kasih Kak ${context.guestName}. Selanjutnya, mohon ketikkan alamat email Kakak (contoh: budi@email.com):`,
      };
    }
    // "Use another name" without supplying a new one yet → ask for it.
    if (USE_OTHER_PATTERN.test(trimmed) && trimmed.replace(USE_OTHER_PATTERN, "").trim().length < 2) {
      await updateBookingState(supabase, phone, "AWAITING_NAME", context);
      return { handled: true, reply: "Baik, silakan ketikkan nama yang ingin Kakak gunakan untuk pemesanan:" };
    }
    // Otherwise treat the message as the new name to use.
    const newName = cleanNameCandidate(trimmed.replace(/^(pakai|gunakan|pake|nama)\s+/i, ""));
    if (newName.length < 2) {
      return { handled: true, reply: 'Mohon balas "Ya" untuk memakai nama sebelumnya, atau ketik nama lengkap yang ingin Kakak gunakan:' };
    }
    if (!looksLikePersonName(newName)) {
      // Guest sent something like "205/206 aja kak biar sebelahan" — a room
      // preference or unrelated question, not a name. CRITICAL: do NOT
      // overwrite the existing guestName (the previous version of this
      // code did, corrupting the booking record).
      //
      // If it looks like a room preference / question, defer to the LLM so
      // it can acknowledge ("kamar 205/206 bersebelahan dicatat ya, nanti
      // tim assign saat check-in") AND re-ask for the name. The booking
      // state is preserved so the flow resumes on the next reply.
      if (ROOM_PREFERENCE_OR_QUESTION.test(trimmed)) {
        console.info(
          `[BookingState] CONFIRMING_NAME: room-preference/question detected ` +
          `("${trimmed.slice(0, 60)}…") — preserving existing guestName "${context.guestName}" ` +
          `and deferring to LLM.`,
        );
        return { handled: false };
      }
      // Otherwise treat as a confused reply and politely re-ask, still
      // without overwriting guestName.
      return {
        handled: true,
        reply:
          `Sepertinya pesan tadi bukan nama. Balas "Ya" untuk memakai nama ` +
          `"${context.guestName}", atau ketik nama lengkap baru yang ingin Kakak gunakan.`,
      };
    }
    context.guestName = newName;
    await updateBookingState(supabase, phone, "AWAITING_EMAIL", context);
    return {
      handled: true,
      reply: `Siap, nama pemesanan diatur menjadi "${newName}". Selanjutnya, mohon ketikkan alamat email Kakak (contoh: budi@email.com):`,
    };
  }

  if (state === "AWAITING_EMAIL") {
    const email = extractEmail(message);
    if (!email) {
      // Escape hatch: jika pesan jelas BUKAN upaya mengetik email (mis.
      // pertanyaan "untuk parkir mobil aman ya?", "boleh minta maps nya",
      // atau link), serahkan ke LLM agar pertanyaan tamu dijawab. State
      // AWAITING_EMAIL tetap dipertahankan, jadi giliran berikutnya tamu
      // bisa kirim email dan flow lanjut. Tanpa ini, bot terjebak
      // mengulang "format email tidak valid" tanpa henti.
      const trimmed = message.trim();
      const looksLikeEmailAttempt = /@/.test(trimmed) || /^[A-Za-z0-9._%+-]+$/.test(trimmed);
      const looksLikeQuestionOrChat =
        ROOM_PREFERENCE_OR_QUESTION.test(trimmed) ||
        /^https?:\/\//i.test(trimmed) ||
        /\b(maps|peta|lokasi|alamat|parkir|jarak|km|wifi|sarapan|breakfast|check ?in|check ?out|harga|berapa|bisa|boleh|gimana|bagaimana|kenapa|apakah|kapan|dimana|gmn)\b/i.test(trimmed);
      if (!looksLikeEmailAttempt && looksLikeQuestionOrChat) {
        console.info(
          `[BookingState] AWAITING_EMAIL: non-email question detected ` +
          `("${trimmed.slice(0, 60)}…") — deferring to LLM, keeping state.`,
        );
        return { handled: false };
      }
      return { handled: true, reply: "Maaf, format email sepertinya tidak valid. Mohon pastikan ada tanda '@' dan '.com' (contoh: budi@email.com). Silakan ketik ulang email Kakak:" };
    }
    context.guestEmail = email;
    await updateBookingState(supabase, phone, "CONFIRMING_PHONE", context);
    const chatNumber = formatPhoneDisplay(phone);
    return {
      handled: true,
      reply: `Email ${email} telah dicatat. Terakhir untuk nomor kontak: nomor WhatsApp yang sedang Kakak gunakan ini adalah ${chatNumber}.\n\nApakah ingin memakai nomor ini untuk pemesanan, atau menggunakan nomor lain? Balas "Ya" untuk memakai nomor ini, atau ketik nomor lain yang Kakak inginkan.`,
    };
  }

  if (state === "CONFIRMING_PHONE") {
    const trimmed = message.trim();
    // Explicit "use this (chat) number" — check phrase-specific pattern first
    // to handle "ya nomor ini", "pakai nomor ini", "nomor ini aja", etc.
    // BEFORE the generic USE_THIS_PATTERN so the word "nomor" doesn't confuse
    // the interruption detector into thinking it's a phone question.
    const wantsThisPhone =
      USE_THIS_PHONE_PATTERN.test(trimmed) ||
      (USE_THIS_PATTERN.test(trimmed) && !USE_OTHER_PATTERN.test(trimmed) && !extractPhone(trimmed));
    if (wantsThisPhone) {
      context.guestPhone = formatPhoneDisplay(phone);
      await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
      return buildBookingSummary(context, ctx.rooms);
    }
    // A phone number was typed directly → use it.
    const typedPhone = extractPhone(trimmed);
    if (typedPhone) {
      context.guestPhone = typedPhone;
      await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
      return buildBookingSummary(context, ctx.rooms);
    }
    // "Use another number" without supplying one yet → ask for it.
    if (USE_OTHER_PATTERN.test(trimmed)) {
      await updateBookingState(supabase, phone, "AWAITING_PHONE", context);
      return { handled: true, reply: "Baik, silakan masukkan nomor handphone / WhatsApp lain yang bisa dihubungi (contoh: 08123456789):" };
    }
    return { handled: true, reply: 'Mohon balas "Ya" untuk memakai nomor yang sedang dipakai chat ini, atau ketik nomor lain (contoh: 08123456789):' };
  }

  if (state === "AWAITING_PHONE") {
    const phoneNum = extractPhone(message);
    if (!phoneNum && message.trim().length < 8) {
      return { handled: true, reply: "Format nomor handphone sepertinya kurang tepat. Mohon masukkan nomor yang valid (contoh: 08123456789):" };
    }
    context.guestPhone = phoneNum || message.replace(/[^0-9+]/g, '');
    await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
    return buildBookingSummary(context, ctx.rooms);
  }

  if (state === "CONFIRMING_BOOKING") {
    // Koreksi tipe kamar harus diproses sebelum kata konfirmasi. Pesan seperti
    // "eh sorry Family Suite 100 ya" mengandung kata "ya", tetapi maksudnya
    // mengganti kamar — bukan menyetujui ringkasan kamar sebelumnya.
    const requestedRoom = detectRequestedRoomChange(message, ctx.rooms, context.roomId);
    if (requestedRoom && context.checkIn && context.checkOut) {
      const { data: availabilityRows, error: availabilityError } = await supabase.rpc(
        "room_type_availability_detail",
        { p_check_in: context.checkIn, p_check_out: context.checkOut },
      );
      const rows = Array.isArray(availabilityRows)
        ? availabilityRows as Array<{ room_type_id?: unknown; available?: unknown }>
        : [];
      const availability = rows.find((row) => row.room_type_id === requestedRoom.id);
      const availableCount = Number(availability?.available ?? 0);

      if (availabilityError || availableCount < 1) {
        return {
          handled: true,
          reply:
            `Mohon maaf Kak, ${requestedRoom.name} sudah tidak tersedia untuk tanggal tersebut. ` +
            `Ringkasan sebelumnya belum saya proses. Silakan pilih tipe kamar lain yang tersedia.`,
        };
      }

      const nights = countNights(context.checkIn, context.checkOut);
      context.roomId = requestedRoom.id;
      context.roomName = requestedRoom.name;
      context.pricePerNight = requestedRoom.pricePerNight;
      context.totalPrice = requestedRoom.pricePerNight * nights;
      context.rooms = [{
        roomTypeId: requestedRoom.id,
        roomTypeName: requestedRoom.name,
        quantity: 1,
        pricePerNight: requestedRoom.pricePerNight,
      }];
      await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
      return buildBookingSummary(context, ctx.rooms);
    }

    // Koreksi slot fleksibel: tamu kirim "jumlah tamu 5 kak", "tanggal 22 Juni",
    // "deluxe 2 kamar", dll. JANGAN paksa Ya/Batal — update slot, validasi
    // ulang (terutama extra bed Deluxe), lalu tampilkan ringkasan baru.
    // Trigger HANYA jika pesan TIDAK murni konfirmasi/kanselasi singkat.
    const isPureConfirm = /^(ya|iya|yes|lanjut|ok|oke|setuju|betul|benar)[\s.!]*$/i.test(message.trim());
    const isPureCancel  = /^(batal|cancel|tidak)[\s.!]*$/i.test(message.trim());
    if (!isPureConfirm && !isPureCancel) {
      const { patch, changed } = parseSlotCorrection(message);
      if (changed) {
        if (patch.adults) context.adults = patch.adults;
        if (patch.roomName) {
          context.roomName = patch.roomName;
          // Cari room di ctx.rooms agar harga ikut update.
          const rt = ctx.rooms.find((r) => r.name.toLowerCase() === patch.roomName!.toLowerCase());
          if (rt) {
            context.roomId = rt.id;
            context.pricePerNight = Number(rt.base_rate ?? 0);
          }
        }
        if (patch.rooms && context.roomName) {
          const rt = ctx.rooms.find((r) => r.name.toLowerCase() === context.roomName!.toLowerCase());
          context.rooms = [{
            roomTypeId: rt?.id ?? "",
            roomTypeName: context.roomName,
            quantity: patch.rooms[0].quantity,
            pricePerNight: Number(rt?.base_rate ?? context.pricePerNight ?? 0),
          }];
        }
        // Recompute extra bed otomatis + tarif dari DB (room_types.extrabed_*).
        const totalRoomsCount = context.rooms?.reduce((s, r) => s + r.quantity, 0) ?? 1;
        const recomputePolicy = resolveRoomExtraBedPolicy(context, ctx.rooms);
        if (recomputePolicy.extrabedRate > 0) context.extraBedRate = recomputePolicy.extrabedRate;
        const eb = computeExtraBeds(recomputePolicy, totalRoomsCount, context.adults ?? 1);
        context.extraBeds = eb.extraBeds;

        // Recompute total
        if (context.checkIn && context.checkOut && context.pricePerNight) {
          const nights = countNights(context.checkIn, context.checkOut);
          context.totalPrice = nights * context.pricePerNight * totalRoomsCount;
        }
        await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
        return buildBookingSummary(context, ctx.rooms);
      }
    }

    if (CONFIRM_PATTERN.test(message)) {
      // GATING INVOICE: validasi semua slot wajib sebelum buat booking.
      const missing: string[] = [];
      if (!context.checkIn || !context.checkOut) missing.push("tanggal");
      if (!context.roomName) missing.push("tipe kamar");
      if (!context.guestName) missing.push("nama");
      if (!context.guestEmail || !EMAIL_PATTERN.test(context.guestEmail)) missing.push("email");
      if (!context.guestPhone || !PHONE_PATTERN.test(context.guestPhone.replace(/[^0-9+]/g, ""))) missing.push("nomor HP");
      const totalRoomsCount = context.rooms?.reduce((s, r) => s + r.quantity, 0) ?? 1;
      const confirmPolicy = resolveRoomExtraBedPolicy(context, ctx.rooms);
      const eb = computeExtraBeds(confirmPolicy, totalRoomsCount, context.adults ?? 1);
      if (eb.overCapacity) missing.push("kapasitas (jumlah tamu melebihi maksimal)");
      if (eb.extraBeds > 0) {
        context.extraBeds = eb.extraBeds;
        if (confirmPolicy.extrabedRate > 0) context.extraBedRate = confirmPolicy.extrabedRate;
      }
      if (missing.length > 0) {
        return {
          handled: true,
          reply:
            `Sebelum saya buat invoice, ada data yang masih perlu diperbaiki: ${missing.join(", ")}. ` +
            `Mohon dilengkapi dulu ya, Kak 🙏.`,
        };
      }

      // Create the booking deterministically with the data collected in context.
      const raw = await createBooking(
        {
          room_type:  context.roomName,
          rooms:      context.rooms,
          full_name:  context.guestName,
          email:      context.guestEmail,
          phone:      context.guestPhone,
          check_in:   context.checkIn,
          check_out:  context.checkOut,
          adults:     context.adults ?? 1,
          children:   context.children ?? 0,
        },
        ctx,
      );

      let result: any = {};
      try { result = JSON.parse(raw); } catch { /* ignore */ }

      if (!result.ok) {
        await updateBookingState(supabase, phone, "IDLE", {});
        return {
          handled: true,
          reply: `Mohon maaf Kak, pemesanan belum bisa diproses: ${result.error ?? "terjadi kendala"}. Silakan coba lagi atau hubungi staf kami.`,
        };
      }

      context.bookingCode = result.reference_code;
      await updateBookingState(supabase, phone, "PAYMENT_PENDING", context);

      return {
        handled: true,
        reply:
          `Terima kasih Kak ${context.guestName}! Pemesanan berhasil dibuat ` +
          `dengan kode ${result.reference_code}. ` +
          `Berikut detail invoice dan pembayarannya:`,
        followUp: "send_invoice",
        followUpRef: result.reference_code,
      };
    } else if (isPureCancel) {
      // Ditangani oleh handler CANCELLATION_PATTERNS di awal, tapi safety net.
      await updateBookingState(supabase, phone, "IDLE", {});
      return { handled: true, reply: "Baik Kak, reservasi dibatalkan. Kalau ingin mulai ulang, sebut saja tanggalnya ya." };
    } else {
      // Tidak dikenali sebagai konfirmasi maupun koreksi — tampilkan ulang ringkasan
      // dengan petunjuk yang lebih ramah, jangan kaku.
      return buildBookingSummary(context, ctx.rooms);
    }
  }

  
  if (state === "PAYMENT_PENDING") {
    // Auto-reset bila tamu jelas memulai booking baru (mis. "mau pesan kamar
    // lagi tanggal 25", "ada kamar deluxe 30 Juni?"). Tanpa ini, state
    // tersangkut sampai 15-menit auto-expire dan tamu disambut Finance Agent
    // padahal yang dia mau adalah Front Office.
    if (NEW_BOOKING_INTENT_PATTERN.test(message)) {
      console.info(`[BookingState] PAYMENT_PENDING → IDLE: tamu memulai booking baru.`);
      await updateBookingState(supabase, phone, "IDLE", {});
      return { handled: false };
    }
    // Pre-Finance-Agent ownership, this state auto-flipped to COMPLETED on
    // any "bayar/sudah/transfer" keyword which bypassed OCR + status update.
    // Now the Finance Agent owns the post-booking flow: hand the turn over
    // so it can run get_payment_proof_result → update_payment_status →
    // craft the LUNAS notification (or ask for clarification when the OCR
    // didn't match). State stays at PAYMENT_PENDING until the agent is
    // confident; the 15-minute auto-reset still applies if the guest goes
    // silent.
    return { handled: false };
  }

  if (state === "COMPLETED") {
    // Once completed, next message will reset to IDLE and process normally.
    await updateBookingState(supabase, phone, "IDLE", {});
    return { handled: false };
  }

  return { handled: false };
}
