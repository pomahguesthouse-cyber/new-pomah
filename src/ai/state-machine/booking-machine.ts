import { SupabaseClient } from "@supabase/supabase-js";
import { classifyIntent } from "@/ai/router/intent-classifier";
import { createBooking } from "@/tools/booking.tool";
import { getDailyRatesForRange, resolveRoomNightlyRates } from "@/services/pricing/daily-rate.service";
import { getSubmittedBookingForm, type BookingFormSubmission } from "@/services/booking-form.service";
import type { RoomTypeRow } from "@/ai/context-builder";
import type { ToolContext } from "@/tools/types";
import { extractAllSlots, getMissingSlots, formatPartialBookingSummary } from "./flexible-slot-extractor";

export type BookingState =
  | "IDLE"
  | "AWAITING_DATES"
  | "AWAITING_ALTERNATIVE_ROOM_TYPE"
  | "ROOM_SELECTED"
  | "AWAITING_FORM_SUBMISSION"
  | "COLLECTING_DATA" // Flexible slot-filling (replaces old linear states)
  | "AWAITING_NAME"
  | "CONFIRMING_NAME"
  | "AWAITING_EMAIL"
  | "CONFIRMING_PHONE"
  | "AWAITING_PHONE"
  | "CONFIRMING_BOOKING"
  | "AWAITING_CANCEL_CONFIRMATION"
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
  /** Catatan khusus tamu dari chat/form. */
  specialRequests?: string;
  /** Token form booking temporer yang sedang ditunggu. */
  formToken?: string;
  /** Tarif extra bed per malam (default Rp80.000). */
  extraBedRate?: number;
  /** Flag bahwa tamu sudah handoff ke admin manusia. */
  handoff?: boolean;
  /** Tamu sudah pernah ditanya email opsional, termasuk saat memilih skip. */
  email_clarification_asked?: boolean;
  /** Tamu minta invoice meski email/flow belum lengkap. */
  invoice_requested?: boolean;
  /** State sebelumnya saat bot sedang menunggu konfirmasi cancel dua langkah. */
  cancelPreviousState?: BookingState;
  /** Skema pembayaran yang dipilih tamu: 'full' = lunas, 'dp' = uang muka dulu. */
  paymentType?: "full" | "dp";
  /** Jumlah DP yang disepakati (nominal, bukan persen). Diisi saat paymentType='dp'. */
  dpAmount?: number;
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

const CANCELLATION_PATTERNS = /\b(batal|batalkan|cancel|nggak jadi|ga jadi|gak jadi|tidak jadi)\b/i;
const FORM_SUBMITTED_PATTERN = /^\[FORM_SUBMITTED:([^\]]+)\]\s*$/i;
const CANCEL_CONFIRM_PATTERN =
  /^(ya|iya|yes|ok|oke|betul|benar)(?:\s+(batal|cancel|batalkan))?[\s.!]*$|^(batal|batalkan|cancel)[\s.!]*$/i;
const CANCEL_DECLINE_PATTERN = /^(tidak|nggak|ngga|gak|ga|jangan|bukan|lanjut booking|lanjutkan booking)[\s.!]*$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_SKIP_PATTERN = /^(lewati|skip|no|tidak|tanpa|-)$/i;
const PHONE_PATTERN = /^(?:\+62|62|0)[2-9][0-9]{7,11}$/;

// Affirm = "use this one"; Decline/Other = "use a different one".
const USE_THIS_PATTERN =
  /\b(ya|iya|yes|pakai ini|gunakan ini|ini saja|ini aja|pake ini|betul|benar|oke|ok|sip|setuju|lanjut)\b/i;
const USE_OTHER_PATTERN =
  /\b(lain|lainnya|beda|berbeda|ganti|bukan|tidak|nggak|ngga|enggak|gak|ubah|nama lain|nomor lain|no lain)\b/i;

// Specific "use this phone number" phrases for CONFIRMING_PHONE state.
const USE_THIS_PHONE_PATTERN =
  /^(ya|iya|yes)?\s*(pakai|gunakan|pake|nomor)?\s*(nomor)\s*(ini|sini|aja|saja|oke|ok|ya)\b/i;

const CONFIRM_PATTERN = /\b(ya|iya|yes|lanjut|benar|oke|ok|setuju|betul|lanjutkan|ya benar|yup)\b/i;
const CANCEL_PATTERN = /\b(tidak|batal|salah|ubah|ganti|cancel|no|nggak|ngga)\b/i;

/**
 * Token-token yang BUKAN nama orang — termasuk frasa frustrasi/kebingungan.
 * Mencegah "saya pusing", "bingung", "embuh" tersimpan sebagai guestName.
 */
const NON_NAME_TOKENS =
  /\b(aja|biar|buat|tolong|kalo|kalau|yang|sama|sebelahan|samping|atas|bawah|deket|dekat|atau|tapi|cuma|sih|nih|dong|deh|nya|kamar|room|wifi|ac|sarapan|breakfast|pusing|bingung|embuh|ribet|capek|cape|penipuan|scam|email|nomor|hp|bukan)\b/i;

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

export function looksLikePersonName(candidate: string): boolean {
  const t = candidate.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (/[\d/@]/.test(t)) return false; // numbers, slashes, @ → not a name
  if (t.endsWith("?")) return false;
  const tokens = t.split(/\s+/);
  if (tokens.length > 8) return false; // names rarely > 8 tokens
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

function normalizePhone(raw: string | null | undefined): string {
  let p = String(raw ?? "").replace(/\D/g, "");
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (p.startsWith("8")) p = "62" + p;
  return p;
}

function phoneCandidates(...values: Array<string | null | undefined>): string[] {
  const candidates = new Set<string>();
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    const normalized = normalizePhone(raw);
    if (raw) candidates.add(raw);
    if (normalized) {
      candidates.add(normalized);
      if (normalized.startsWith("62")) candidates.add("0" + normalized.slice(2));
    }
  }
  return Array.from(candidates);
}

/** Format YYYY-MM-DD ke "10 Juni 2026" dalam bahasa Indonesia. */
function formatDateId(iso: string): string {
  const months = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
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
    match = list.find((r) => r.id === first.roomTypeId || (firstName != null && r.name.toLowerCase() === firstName));
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
    roomsDisplay = summaryRooms.map((r) => `${r.quantity}x ${r.roomTypeName}`).join(", ");
  } else {
    roomsDisplay = context.roomName ?? "—";
  }

  // --- Price per night (prefer dynamic average bila tersedia) ---
  const pricePerNight =
    overrides?.displayRatePerNight ??
    (summaryRooms && summaryRooms.length > 0 ? summaryRooms[0].pricePerNight : (context.pricePerNight ?? 0));

  // --- Nights & total ---
  const nights = context.checkIn && context.checkOut ? countNights(context.checkIn, context.checkOut) : null;

  // --- Dates with check-in / check-out times ---
  const checkInDisplay = context.checkIn ? `${formatDateId(context.checkIn)}, 14.00` : "—";
  const checkOutDisplay = context.checkOut ? `${formatDateId(context.checkOut)}, 12.00` : "—";

  // --- Adults ---
  const adults = context.adults ?? 1;
  const adultLine = `${adults} orang dewasa`;

  // --- Format currency IDR ---
  const fmtRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

  // --- Resolve extra-bed policy & jumlah extra bed dari DB ---
  const policy = resolveRoomExtraBedPolicy(context, roomsCatalog);
  const resolvedExtraBedRate = policy.extrabedRate;

  const totalRooms = summaryRooms?.reduce((s, r) => s + r.quantity, 0) ?? 1;
  const eb = computeExtraBeds(policy, totalRooms, adults);
  const extraBeds = context.extraBeds ?? eb.extraBeds;
  const hasRate = resolvedExtraBedRate > 0;
  const extraBedTotal = nights && extraBeds > 0 && hasRate ? nights * extraBeds * resolvedExtraBedRate : 0;

  // Subtotal kamar: pakai dynamic (jika tersedia), kalau tidak fallback rata.
  const fallbackSubtotal = nights && pricePerNight ? nights * pricePerNight * totalRooms : 0;
  const roomSubtotal = overrides?.roomSubtotal ?? context.totalPrice ?? fallbackSubtotal;
  const grandTotal = roomSubtotal + extraBedTotal;

  const ratePrefix = overrides?.hasDynamicBreakdown ? "rata-rata " : "";
  const paymentLine =
    context.paymentType === "dp"
      ? `- Pembayaran: DP${context.dpAmount ? ` ${fmtRp(context.dpAmount)}` : " dulu"}\n`
      : context.paymentType === "full"
        ? `- Pembayaran: Lunas\n`
        : "";

  const extraBedLine =
    extraBeds > 0
      ? hasRate
        ? `- Extra bed: ${extraBeds}x @ ${fmtRp(resolvedExtraBedRate)}/malam = ${fmtRp(extraBedTotal)}\n`
        : `- Extra bed: ${extraBeds}x (tarif perlu dikonfirmasi admin)\n`
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
    `- Email: ${context.guestEmail ?? "(tidak diisi)"}\n` +
    `- No. HP: ${context.guestPhone ?? "—"}\n` +
    `- Kamar: ${roomsDisplay}\n` +
    `- Check-in: ${checkInDisplay}\n` +
    `- Check-out: ${checkOutDisplay}\n` +
    `- Durasi: ${nights != null ? `${nights} malam` : "—"}\n` +
    `- Jumlah tamu: ${adultLine}\n` +
    `- Harga: ${pricePerNight ? `${ratePrefix}${fmtRp(pricePerNight)}/malam` : "—"}\n` +
    extraBedLine +
    paymentLine +
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

  const roomTypeIds = Array.from(new Set(items.map((r) => r.roomTypeId).filter((id): id is string => !!id)));
  if (roomTypeIds.length === 0) return null;

  const overrides = await getDailyRatesForRange(ctx.supabasePublic, roomTypeIds, context.checkIn, context.checkOut);

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
    const rt = ctx.rooms.find((r) => r.id === item.roomTypeId) as RoomTypeRow | undefined;
    if (!rt) {
      resolvedRooms.push(item);
      roomSubtotal += item.pricePerNight * item.quantity * nights;
      continue;
    }
    const resolved = resolveRoomNightlyRates(rt, context.checkIn, context.checkOut, overrides.get(item.roomTypeId));
    if (resolved.has_stop_sell) stopSellDates.push(...resolved.stop_sell_dates);
    if (!resolved.all_base) hasDynamicBreakdown = true;
    roomSubtotal += resolved.total * item.quantity;
    const avg = resolved.nights ? Math.round(resolved.total / resolved.nights) : item.pricePerNight;
    resolvedRooms.push({ ...item, pricePerNight: avg });
    avgSum += avg;
    avgCount += 1;
    if (firstAvg === null) firstAvg = avg;
    else if (avg !== firstAvg) sameRate = false;
  }

  const displayRatePerNight = sameRate ? (firstAvg ?? 0) : Math.round(avgSum / Math.max(1, avgCount));

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
async function buildBookingSummaryAsync(ctx: ToolContext, context: BookingContext): Promise<StateMachineResult> {
  try {
    const resolved = await resolveBookingSummaryRates(ctx, context);
    if (resolved && resolved.stopSellDates.length > 0) {
      const tanggalList = resolved.stopSellDates.map((d) => formatDateId(d)).join(", ");
      const roomLabel = context.rooms?.[0]?.roomTypeName ?? context.roomName ?? "tipe kamar ini";
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

async function applyResolvedRatesToContext(ctx: ToolContext, context: BookingContext): Promise<void> {
  try {
    const resolved = await resolveBookingSummaryRates(ctx, context);
    if (!resolved || resolved.stopSellDates.length > 0) return;
    context.rooms = resolved.rooms;
    context.pricePerNight = resolved.displayRatePerNight;
    context.totalPrice = resolved.roomSubtotal;
  } catch (e) {
    console.warn("[BookingState] applyResolvedRatesToContext failed (non-fatal):", e);
  }
}

function bookingFormSubmissionToContext(
  submission: BookingFormSubmission,
  phone: string,
  roomsCatalog: RoomCatalogEntry[],
  previous: BookingContext = {},
): BookingContext {
  const room = roomsCatalog.find((r) => r.id === submission.roomTypeId) ?? roomsCatalog[0];
  const quantity = Math.max(1, Math.min(10, Number(submission.rooms) || 1));
  const adults = Math.max(1, Math.min(20, Number(submission.guestCount) || 1));
  const context: BookingContext = {
    ...previous,
    checkIn: submission.checkIn,
    checkOut: submission.checkOut,
    guestName: submission.fullName.trim(),
    guestEmail: submission.email && EMAIL_PATTERN.test(submission.email) ? submission.email : undefined,
    guestPhone: phone,
    adults,
    children: 0,
    roomId: room?.id ?? submission.roomTypeId,
    roomName: room?.name ?? previous.roomName,
    pricePerNight: Number((room as any)?.base_rate ?? previous.pricePerNight ?? 0),
    specialRequests: submission.notes?.trim() || undefined,
    email_clarification_asked: true,
  };

  if (context.roomId && context.roomName) {
    context.rooms = [{
      roomTypeId: context.roomId,
      roomTypeName: context.roomName,
      quantity,
      pricePerNight: context.pricePerNight ?? 0,
    }];
  }

  const policy = resolveRoomExtraBedPolicy(context, roomsCatalog);
  const required = computeExtraBeds(policy, quantity, adults);
  const requestedExtraBeds = Math.max(0, Math.min(20, Number(submission.extrabed) || 0));
  context.extraBeds = Math.max(requestedExtraBeds, required.extraBeds);
  if (policy.extrabedRate > 0) context.extraBedRate = policy.extrabedRate;
  if (context.checkIn && context.checkOut && context.pricePerNight) {
    context.totalPrice = countNights(context.checkIn, context.checkOut) * context.pricePerNight * quantity;
  }
  return context;
}

function clearCancelConfirmation(context: BookingContext): BookingContext {
  const { cancelPreviousState: _cancelPreviousState, ...rest } = context;
  return rest;
}

async function cleanupPendingBookingAndInvoice(supabase: SupabaseClient, phone: string): Promise<void> {
  try {
    const { data: guests } = await (supabase as any).from("guests").select("id").eq("phone", phone);
    const guestIds = ((guests ?? []) as Array<{ id: string }>).map((g) => g.id);
    if (guestIds.length === 0) return;

    const { data: bookings } = await (supabase as any)
      .from("bookings")
      .select("id")
      .in("guest_id", guestIds)
      .in("status", ["pending", "confirmed"]);
    const bookingIds = ((bookings ?? []) as Array<{ id: string }>).map((b) => b.id);
    if (bookingIds.length === 0) return;

    await (supabase as any)
      .from("bookings")
      .update({ status: "cancelled" })
      .in("id", bookingIds)
      .in("status", ["pending", "confirmed"]);
    await (supabase as any).from("invoices").delete().in("booking_id", bookingIds);
  } catch (e) {
    console.warn("[BookingState] cancel cleanup failed (non-fatal):", e);
  }
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
  context: BookingContext,
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
  const cleaned = text.replace(/[^0-9+]/g, "");
  if (PHONE_PATTERN.test(cleaned)) return cleaned;
  return null;
}

// States in which the bot is collecting/confirming guest data and can be
// interrupted by an unrelated question.
const DATA_ENTRY_STATES: BookingState[] = [
  "COLLECTING_DATA",
  "AWAITING_FORM_SUBMISSION",
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
    case "COLLECTING_DATA":
      return "data_booking";
    case "AWAITING_FORM_SUBMISSION":
      return "submit_form_booking";
    case "AWAITING_DATES":
      return "tanggal";
    case "AWAITING_ALTERNATIVE_ROOM_TYPE":
      return "tipe_kamar_alternatif";
    case "ROOM_SELECTED":
      return "tipe_kamar";
    case "AWAITING_NAME":
      return "nama";
    case "CONFIRMING_NAME":
      return "konfirmasi_nama";
    case "AWAITING_EMAIL":
      return "email";
    case "CONFIRMING_PHONE":
      return "konfirmasi_nomor_hp";
    case "AWAITING_PHONE":
      return "nomor_hp";
    case "CONFIRMING_BOOKING":
      return "konfirmasi_booking";
    case "PAYMENT_PENDING":
      return "bukti_pembayaran";
    default:
      return null;
  }
}

/** Format daftar alternatif sebagai numbered list untuk ditampilkan ke tamu. */
export function formatAlternativesList(alts: AlternativeRoomOption[]): string {
  return alts.map((a, i) => `${i + 1}. ${a.name} - Rp${a.pricePerNight.toLocaleString("id-ID")}/malam`).join("\n");
}

/** Cocokkan jawaban tamu dengan salah satu alternatif (nama / nomor urut). */
export function matchAlternative(message: string, alts: AlternativeRoomOption[]): AlternativeRoomOption | null {
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
export function findMentionedRoomType<R extends { id: string; name: string; base_rate?: number | null }>(
  input: string,
  rooms: R[],
): R | null {
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
      const re = new RegExp(`(^|\\s)${norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(\\s|$)`);
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
      return (
        !!extractPhone(message) ||
        USE_THIS_PATTERN.test(message) ||
        USE_OTHER_PATTERN.test(message) ||
        USE_THIS_PHONE_PATTERN.test(message)
      );
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
export function parseSlotCorrection(
  input: string,
  rooms?: Array<{ id: string; name: string; base_rate?: number | null }>,
): {
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

  // Tipe kamar: dinamis dari katalog DB (tanpa hardcode nama kamar).
  const mentionedRoom = rooms?.length ? findMentionedRoomType(input, rooms) : null;
  if (mentionedRoom) {
    patch.roomName = mentionedRoom.name;
    patch.roomId = mentionedRoom.id;
    changed = true;

    // Jumlah kamar: "2 kamar", "ganti deluxe 3 kamar"
    const roomsCountMatch = input.match(/(\d+)\s*kamar\b/i);
    if (roomsCountMatch) {
      const qty = Number(roomsCountMatch[1]);
      if (qty >= 1 && qty <= 10) {
        patch.rooms = [
          {
            roomTypeId: mentionedRoom.id,
            roomTypeName: mentionedRoom.name,
            quantity: qty,
            pricePerNight: Number(mentionedRoom.base_rate ?? 0),
          },
        ];
      }
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
  currentStateRecord: StateRecord,
): Promise<StateMachineResult> {
  const supabase = ctx.supabaseAdmin;
  let { state, context } = currentStateRecord;

  const formSubmittedMatch = message.match(FORM_SUBMITTED_PATTERN);
  if (formSubmittedMatch) {
    const token = formSubmittedMatch[1]?.trim();
    const row = token ? await getSubmittedBookingForm(supabase as any, token) : null;
    if (!row?.submitted_data) {
      return {
        handled: true,
        reply:
          "Maaf Kak, data formulir booking belum terbaca di sistem. Mohon tunggu sebentar lalu kirim pesan ke kami lagi ya 🙏.",
      };
    }

    const allowedPhones = phoneCandidates(phone, row.phone);
    if (!allowedPhones.includes(row.phone) && row.phone !== phone) {
      return { handled: true, reply: "Maaf Kak, formulir ini tidak sesuai dengan nomor WhatsApp percakapan ini." };
    }

    context = bookingFormSubmissionToContext(row.submitted_data, phone, ctx.rooms, context);
    context.formToken = token;
    await applyResolvedRatesToContext(ctx, context);
    await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
    return await buildBookingSummaryAsync(ctx, context);
  }

  if (state === "AWAITING_CANCEL_CONFIRMATION") {
    const previousState = context.cancelPreviousState ?? "COLLECTING_DATA";
    const restoredContext = clearCancelConfirmation(context);

    if (CANCEL_CONFIRM_PATTERN.test(message)) {
      await cleanupPendingBookingAndInvoice(supabase, phone);
      await updateBookingState(supabase, phone, "IDLE", {});
      return {
        handled: true,
        reply:
          "Baik Kak, proses reservasi sudah dibatalkan dan draft invoice juga sudah saya bersihkan. " +
          "Kalau nanti ingin mulai ulang, tinggal sebut tanggal & tipe kamarnya ya 🙏.",
      };
    }

    await updateBookingState(supabase, phone, previousState, restoredContext);
    if (CANCEL_DECLINE_PATTERN.test(message)) {
      return {
        handled: true,
        reply: "Siap Kak, reservasinya tidak saya batalkan. Kita lanjutkan dari data terakhir ya.",
      };
    }
    return { handled: false };
  }

  // Cancellation is destructive, so ask for explicit confirmation first.
  if (CANCELLATION_PATTERNS.test(message) && state !== "IDLE") {
    context.cancelPreviousState = state;
    await updateBookingState(supabase, phone, "AWAITING_CANCEL_CONFIRMATION", context);
    return {
      handled: true,
      reply:
        "Saya tangkap Kakak ingin membatalkan reservasi ini. " +
        'Untuk memastikan, balas "Ya, batalkan". Kalau tidak jadi batal, balas "Jangan".',
    };
  }

  if (state === "IDLE") {
    return { handled: false }; // Handled by LLM via normal AI workflow
  }

  if (state === "AWAITING_FORM_SUBMISSION") {
    return {
      handled: true,
      reply:
        "Saya masih menunggu formulir booking yang tadi saya kirim ya, Kak. " +
        "Silakan lengkapi link tersebut dulu. Setelah dikirim, saya akan langsung balas ringkasan booking di chat ini.",
    };
  }

  // Guard: jika state masih di tahap pengumpulan data tamu (AWAITING_*/CONFIRMING_*)
  // padahal SUDAH ada booking aktif (pending/confirmed) untuk nomor ini yang
  // dibuat dalam 90 menit terakhir, berarti flow sebenarnya sudah lewat fase
  // booking — kemungkinan invoice sudah dikirim. Tanpa guard ini, jawaban tamu
  // seperti "sudah bayar / sudah transfer" akan terus dibaca sebagai email
  // tidak valid sehingga bot mengulang "format email tidak valid" tanpa henti.
  // Reset state ke PAYMENT_PENDING dan serahkan ke Finance Agent.
  if (isDataEntryState(state)) {
    try {
      const guestPhones = phoneCandidates(phone, context.guestPhone);
      const { data: guests } = await (supabase as any)
        .from("guests")
        .select("id")
        .in("phone", guestPhones.length > 0 ? guestPhones : [phone])
        .limit(20);
      const guestIds = ((guests ?? []) as Array<{ id: string }>).map((g) => g.id);
      if (guestIds.length > 0) {
        const cutoff = new Date(Date.now() - 90 * 60 * 1000).toISOString();
        const { data: activeBooking } = await (supabase as any)
          .from("bookings")
          .select("reference_code, created_at, status")
          .in("guest_id", guestIds)
          .in("status", ["pending", "confirmed"])
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (activeBooking?.reference_code) {
          console.info(
            `[BookingState] ${state} → PAYMENT_PENDING: booking aktif ` +
              `${activeBooking.reference_code} sudah ada, hentikan loop data-entry.`,
          );
          context.bookingCode = activeBooking.reference_code;
          await updateBookingState(supabase, phone, "PAYMENT_PENDING", context);
          return { handled: false };
        }
      }
    } catch (e) {
      console.warn("[BookingState] active-booking guard failed (non-fatal):", e);
    }
  }

  // Mid-booking interruption: the guest asks something unrelated instead of
  // answering the current prompt. Hand the turn to the LLM / specialist agents
  // to answer, but KEEP the booking state so the flow resumes on the next
  // relevant reply (the state auto-resets after 15 min if truly abandoned).
  if (isDataEntryState(state) && !isExpectedAnswer(state, message)) {
    const interruptByQuestion = QUESTION_PATTERN.test(message);
    const interruptByIntent = INTERRUPT_INTENTS.has(
      (
        await classifyIntent(message, supabase, ctx.llmConfig, {
          bookingActive: true,
          lastTopic: currentStateRecord.last_topic ?? null,
          roomTypeNames: ctx.rooms.map((r) => r.name),
        })
      ).category,
    );
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
      context.rooms = [
        {
          roomTypeId: picked.roomTypeId,
          roomTypeName: picked.name,
          quantity: 1,
          pricePerNight: picked.pricePerNight,
        },
      ];
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
        reply: `Siap Kak. Karena ${requested} penuh, silakan pilih salah satu kamar yang tersedia:\n${altListText}`,
      };
    }

    // 5) Nama orang → simpan, tetap minta tipe kamar.
    if (looksLikePersonName(trimmed)) {
      context.guestName = trimmed;
      await updateBookingState(supabase, phone, state, context);
      const firstName = trimmed.split(/\s+/)[0];
      return reAskWithPrefix(`Baik Kak ${firstName}, saya catat namanya. Karena ${requested} penuh, `);
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

  if (
    state === "COLLECTING_DATA" ||
    state === "AWAITING_NAME" ||
    state === "CONFIRMING_NAME" ||
    state === "AWAITING_EMAIL" ||
    state === "CONFIRMING_PHONE" ||
    state === "AWAITING_PHONE"
  ) {
    const roomsList = ctx.rooms || [];
    const todayStr = ctx.today || new Date().toISOString().slice(0, 10);
    const extracted = extractAllSlots(message, roomsList, phone, todayStr);
    const trimmedMessage = message.trim();

    // Merge extracted values to context
    if (extracted.check_in) context.checkIn = extracted.check_in;
    if (extracted.check_out) context.checkOut = extracted.check_out;

    if (extracted.room_type) {
      context.roomName = extracted.room_type;
      context.roomId = extracted.room_type_id;
      const rt = roomsList.find((r) => r.id === extracted.room_type_id);
      if (rt) {
        context.pricePerNight = Number(rt.base_rate ?? 0);
      }
    }

    if (extracted.room_quantity) {
      if (context.roomId && context.roomName) {
        context.rooms = [
          {
            roomTypeId: context.roomId,
            roomTypeName: context.roomName,
            quantity: extracted.room_quantity,
            pricePerNight: context.pricePerNight ?? 0,
          },
        ];
      }
    } else if (context.roomId && context.roomName && (!context.rooms || context.rooms.length === 0)) {
      context.rooms = [
        {
          roomTypeId: context.roomId,
          roomTypeName: context.roomName,
          quantity: 1,
          pricePerNight: context.pricePerNight ?? 0,
        },
      ];
    }

    if (extracted.guest_name) context.guestName = extracted.guest_name;
    if (extracted.email) context.guestEmail = extracted.email;
    if (extracted.phone) context.guestPhone = extracted.phone;
    if (extracted.adults) context.adults = extracted.adults;
    if (extracted.children) context.children = extracted.children;

    // Additional slots
    if (extracted.is_invoice_request) {
      context.invoice_requested = true;
    }

    if (extracted.is_skip_email) {
      context.guestEmail = undefined;
      context.email_clarification_asked = true;
    }

    const hasInterruptionSignal =
      extracted.is_payment_question ||
      extracted.is_bank_account_request ||
      extracted.is_invoice_request ||
      extracted.is_checkin_policy ||
      extracted.is_room_detail_question ||
      extracted.is_early_arrival;

    const autoSkipOptionalEmail =
      !context.guestEmail &&
      !!context.email_clarification_asked &&
      state === "AWAITING_EMAIL" &&
      !extracted.email &&
      !extracted.is_skip_email &&
      !hasInterruptionSignal;

    if (autoSkipOptionalEmail) {
      context.guestEmail = undefined;
      if (!context.guestPhone || context.guestPhone.length < 8) context.guestPhone = phone;
      const hasDatesForSkip = !!context.checkIn && !!context.checkOut;
      const hasRoomForSkip = !!context.roomName;
      const hasNameForSkip = !!context.guestName && context.guestName.length >= 2;
      if (hasDatesForSkip && hasRoomForSkip && hasNameForSkip) {
        console.info(`[BookingState] AWAITING_EMAIL auto-skip → CONFIRMING_BOOKING for ${phone.slice(-6)}`);
        await applyResolvedRatesToContext(ctx, context);
        await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
        return await buildBookingSummaryAsync(ctx, context);
      }
    }

    // Mid-booking interruption signals check
    if (hasInterruptionSignal) {
      console.info(
        `[BookingState] Interrupt detected via signals ("${message.slice(0, 50)}") — preserving state, deferring to LLM`,
      );
      await updateBookingState(supabase, phone, "COLLECTING_DATA", context);
      return { handled: false };
    }

    // Check mandatory fields: Dates, Room type, guest name
    // guestPhone diisi otomatis dari nomor WA sesi (ctx.phone) bila kosong —
    // tidak perlu memintanya ke tamu yang sudah menghubungi via WhatsApp.
    if (!context.guestPhone || context.guestPhone.length < 8) {
      context.guestPhone = phone;
    }
    const hasDates = !!context.checkIn && !!context.checkOut;
    const hasRoom = !!context.roomName;
    const hasName = !!context.guestName && context.guestName.length >= 2;
    const hasPhone = true; // selalu true — sudah diisi otomatis di atas

    if (hasDates && hasRoom && hasName && hasPhone) {
      // Prompt for optional email if not yet filled and not yet clarified
      if (!context.guestEmail && !context.email_clarification_asked) {
        // Special case: if user typed skip email or skipped in the message, we skip
        const isSkipInput = EMAIL_SKIP_PATTERN.test(trimmedMessage);
        if (isSkipInput) {
          context.email_clarification_asked = true;
        } else {
          context.email_clarification_asked = true;
          await updateBookingState(supabase, phone, "AWAITING_EMAIL", context);
          return {
            handled: true,
            reply: `Terima kasih Kak ${context.guestName}. Jika berkenan, mohon ketikkan alamat email Kakak (opsional, balas "lewati" atau "-" jika tidak ingin mengisi):`,
          };
        }
      }

      // Recompute extra bed policy
      const totalRoomsCount = context.rooms?.reduce((s, r) => s + r.quantity, 0) ?? 1;
      const recomputePolicy = resolveRoomExtraBedPolicy(context, roomsList);
      if (recomputePolicy.extrabedRate > 0) context.extraBedRate = recomputePolicy.extrabedRate;
      const eb = computeExtraBeds(recomputePolicy, totalRoomsCount, context.adults ?? 1);
      context.extraBeds = eb.extraBeds;

      if (context.checkIn && context.checkOut && context.pricePerNight) {
        const nights = countNights(context.checkIn, context.checkOut);
        context.totalPrice = nights * context.pricePerNight * totalRoomsCount;
      }

      await applyResolvedRatesToContext(ctx, context);
      await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
      return await buildBookingSummaryAsync(ctx, context);
    }

    // Still missing details: update state to COLLECTING_DATA
    await updateBookingState(supabase, phone, "COLLECTING_DATA", context);

    const missing: string[] = [];
    if (!hasDates) missing.push("Tanggal check-in & check-out");
    if (!hasRoom) missing.push("Tipe kamar");
    if (!hasName) missing.push("Nama lengkap tamu");
    // guestPhone otomatis dari nomor WA — tidak perlu diminta ke tamu

    const summary = formatPartialBookingSummary(context);
    let reply = `Data booking sementara:\n${summary}\n\n`;
    reply += `Mohon lengkapi data berikut untuk melanjutkan reservasi:\n`;
    missing.forEach((item, idx) => {
      reply += `${idx + 1}. ${item}\n`;
    });
    reply += `\nKakak bisa mengetikkan data di atas sekaligus (contoh: "booking Deluxe, atas nama: Budi, tanggal 25-27 Juni, no hp: 08123456789").`;

    return {
      handled: true,
      reply,
    };
  }

  if (state === "CONFIRMING_BOOKING") {
    // Koreksi tipe kamar harus diproses sebelum kata konfirmasi. Pesan seperti
    // "eh sorry Family Suite 100 ya" mengandung kata "ya", tetapi maksudnya
    // mengganti kamar — bukan menyetujui ringkasan kamar sebelumnya.
    const requestedRoom = detectRequestedRoomChange(message, ctx.rooms, context.roomId);
    if (requestedRoom && context.checkIn && context.checkOut) {
      const { data: availabilityRows, error: availabilityError } = await supabase.rpc("room_type_availability_detail", {
        p_check_in: context.checkIn,
        p_check_out: context.checkOut,
      });
      const rows = Array.isArray(availabilityRows)
        ? (availabilityRows as Array<{ room_type_id?: unknown; available?: unknown }>)
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
      context.rooms = [
        {
          roomTypeId: requestedRoom.id,
          roomTypeName: requestedRoom.name,
          quantity: 1,
          pricePerNight: requestedRoom.pricePerNight,
        },
      ];
      await applyResolvedRatesToContext(ctx, context);
      await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
      return await buildBookingSummaryAsync(ctx, context);
    }

    // Koreksi slot fleksibel: tamu kirim "jumlah tamu 5 kak", "tanggal 22 Juni",
    // "deluxe 2 kamar", dll. JANGAN paksa Ya/Batal — update slot, validasi
    // ulang (terutama extra bed Deluxe), lalu tampilkan ringkasan baru.
    // Trigger HANYA jika pesan TIDAK murni konfirmasi/kanselasi singkat.
    const isPureConfirm = /^(ya|iya|yes|lanjut|ok|oke|setuju|betul|benar)[\s.!]*$/i.test(message.trim());
    const isPureCancel = /^(batal|cancel|tidak)[\s.!]*$/i.test(message.trim());
    if (!isPureConfirm && !isPureCancel) {
      const { patch, changed } = parseSlotCorrection(message, ctx.rooms);
      if (changed) {
        if (patch.adults) context.adults = patch.adults;
        if (patch.roomName) {
          context.roomName = patch.roomName;
          if (patch.roomId) {
            context.roomId = patch.roomId;
            const rt = ctx.rooms.find((r) => r.id === patch.roomId);
            context.pricePerNight = Number(rt?.base_rate ?? context.pricePerNight ?? 0);
          }
        }
        if (patch.rooms && patch.rooms.length > 0) {
          context.rooms = patch.rooms;
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
        await applyResolvedRatesToContext(ctx, context);
        await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
        return await buildBookingSummaryAsync(ctx, context);
      }
    }

    // Deteksi preferensi pembayaran DP dari pesan tamu (bisa muncul kapan saja
    // di CONFIRMING_BOOKING, termasuk bersamaan dengan konfirmasi "ya, DP dulu").
    const dpMatch = message.match(/\b(dp|down\s*payment|uang\s*muka|dp\s*dulu|bayar\s*sebagian)\b/i);
    const fullPayMatch = message.match(/\b(lunas|full\s*pay|bayar\s*penuh|langsung\s*lunas)\b/i);
    if (dpMatch && !fullPayMatch) {
      context.paymentType = "dp";
      // Coba ekstrak nominal DP kalau disebut (mis. "DP 200rb", "DP 50%").
      const nominalMatch = message.match(/dp\s+(?:rp\.?\s*)?(\d[\d.,]*(?:rb|ribu|jt|juta)?)/i);
      if (nominalMatch) {
        let raw = nominalMatch[1].replace(/[.,]/g, "");
        if (/rb|ribu/i.test(nominalMatch[1])) raw = String(parseFloat(raw) * 1000);
        if (/jt|juta/i.test(nominalMatch[1])) raw = String(parseFloat(raw) * 1_000_000);
        const parsed = parseInt(raw, 10);
        if (!isNaN(parsed) && parsed > 0) context.dpAmount = parsed;
      }
      const pctMatch = message.match(/dp\s+(\d+)\s*%/i);
      if (pctMatch && context.totalPrice) {
        context.dpAmount = Math.round((parseInt(pctMatch[1], 10) / 100) * context.totalPrice);
      }
      // Kalau tidak ada nominal spesifik, default 50% dari total.
      if (!context.dpAmount && context.totalPrice) {
        context.dpAmount = Math.round(context.totalPrice * 0.5);
      }
      await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
    } else if (fullPayMatch) {
      context.paymentType = "full";
      context.dpAmount = undefined;
      await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
    }

    if (CONFIRM_PATTERN.test(message)) {
      // GATING INVOICE: validasi semua slot wajib sebelum buat booking.
      // guestPhone diisi otomatis dari nomor WA sesi — tidak perlu divalidasi di sini.
      if (!context.guestPhone || context.guestPhone.length < 8) {
        context.guestPhone = phone;
      }
      const missing: string[] = [];
      if (!context.checkIn || !context.checkOut) missing.push("tanggal");
      if (!context.roomName) missing.push("tipe kamar");
      if (!context.guestName) missing.push("nama");
      // Email opsional: hanya validasi format jika tamu mengisinya.
      if (context.guestEmail && !EMAIL_PATTERN.test(context.guestEmail)) missing.push("email");
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
          room_type: context.roomName,
          rooms: context.rooms,
          full_name: context.guestName,
          email: context.guestEmail,
          phone: context.guestPhone,
          check_in: context.checkIn,
          check_out: context.checkOut,
          adults: context.adults ?? 1,
          children: context.children ?? 0,
          payment_type: context.paymentType ?? "full",
          dp_amount: context.dpAmount ?? 0,
        },
        ctx,
      );

      let result: any = {};
      try {
        result = JSON.parse(raw);
      } catch {
        /* ignore */
      }

      if (!result.ok) {
        await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
        return {
          handled: true,
          reply:
            `Mohon maaf Kak, pemesanan belum bisa diproses: ${result.error ?? "terjadi kendala"}. ` +
            `Data booking sebelumnya tetap saya simpan. Kakak bisa koreksi datanya, pilih kamar/tanggal lain, atau balas "batal".`,
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
      context.cancelPreviousState = "CONFIRMING_BOOKING";
      await updateBookingState(supabase, phone, "AWAITING_CANCEL_CONFIRMATION", context);
      return {
        handled: true,
        reply:
          "Saya tangkap Kakak ingin membatalkan reservasi ini. " +
          'Untuk memastikan, balas "Ya, batalkan". Kalau tidak jadi batal, balas "Jangan".',
      };
    } else {
      // Tidak dikenali sebagai konfirmasi maupun koreksi — tampilkan ulang ringkasan
      // dengan petunjuk yang lebih ramah, jangan kaku.
      return await buildBookingSummaryAsync(ctx, context);
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
