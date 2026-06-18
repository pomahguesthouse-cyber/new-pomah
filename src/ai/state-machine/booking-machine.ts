import { SupabaseClient } from "@supabase/supabase-js";
import { classifyIntent } from "@/ai/router/intent-classifier";
import { createBooking } from "@/tools/booking.tool";
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

const CANCELLATION_PATTERNS = /\b(batal|cancel|nggak jadi|ga jadi|tidak jadi|berhenti)\b/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^(?:\+62|62|0)[2-9][0-9]{7,11}$/;

// Affirm = "use this one"; Decline/Other = "use a different one".
const USE_THIS_PATTERN = /\b(ya|iya|yes|pakai ini|gunakan ini|ini saja|ini aja|pake ini|betul|benar|oke|ok|sip|setuju|lanjut)\b/i;
const USE_OTHER_PATTERN = /\b(lain|lainnya|beda|berbeda|ganti|bukan|tidak|nggak|ngga|enggak|gak|ubah|nama lain|nomor lain|no lain)\b/i;

// Specific "use this phone number" phrases for CONFIRMING_PHONE state.
// Must be checked BEFORE USE_THIS_PATTERN to guarantee "ya nomor ini" doesn't
// get misrouted by the generic interruption-detection heuristics.
const USE_THIS_PHONE_PATTERN =
  /^(ya|iya|yes)?\s*(pakai|gunakan|pake|nomor)?\s*(nomor)\s*(ini|sini|aja|saja|oke|ok|ya)\b/i;

const CONFIRM_PATTERN = /\b(ya|iya|yes|lanjut|benar|oke|ok|setuju|betul|lanjutkan|ya benar|yup)\b/i;
const CANCEL_PATTERN = /\b(tidak|batal|salah|ubah|ganti|cancel|no|nggak|ngga)\b/i;

/**
 * Looks-like-a-person-name heuristic. The state machine previously took
 * literally any non-confirm reply as "the new name" — so when a guest in
 * CONFIRMING_NAME typed "205/206 aja kak biar sebelahan" (actually a room
 * preference, not a name), it stored that whole sentence as guestName.
 *
 * Reject candidates that:
 *   - Contain digits, slashes, or @ (room numbers, emails, phone fragments).
 *   - Contain typical request/filler words ("aja", "biar", "buat", "tolong",
 *     "kalo", "yang", etc.).
 *   - Have more than 5 whitespace-separated tokens (real names rarely do).
 *   - End with "?" (it's a question, not a name).
 */
const NON_NAME_TOKENS = /\b(aja|biar|buat|tolong|kalo|kalau|yang|sama|sebelahan|samping|atas|bawah|deket|dekat|atau|tapi|cuma|sih|nih|dong|deh|kak|kakak|mba|mbak|mas|pak|bu|nya|kamar|room|wifi|ac|sarapan|breakfast)\b/i;

/**
 * Detect "this looks like a request about the booking itself (room
 * preference, payment, etc.), not a name". Used inside CONFIRMING_NAME
 * so we can defer to the LLM (which can acknowledge "kamar 205/206
 * sebelahan dicatat ya") instead of just rejecting flatly. We keep the
 * existing guestName intact in this case.
 */
const ROOM_PREFERENCE_OR_QUESTION =
  /(?:\d{2,3}\s*[\/\-]\s*\d{2,3})|\b(sebelahan|samping|sebelah|depan|belakang|atas|bawah|deket|dekat|view|pemandangan|pojok)\b|\?/i;

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

/** Build the pre-confirmation booking summary once all guest details are set. */
function buildBookingSummary(context: BookingContext): StateMachineResult {
  // --- Room line ---
  let roomsDisplay: string;
  if (context.rooms && context.rooms.length > 0) {
    roomsDisplay = context.rooms
      .map((r) => `${r.quantity}x ${r.roomTypeName}`)
      .join(", ");
  } else {
    roomsDisplay = context.roomName ?? "—";
  }

  // --- Price per night ---
  const pricePerNight =
    context.rooms && context.rooms.length > 0
      ? context.rooms[0].pricePerNight
      : (context.pricePerNight ?? 0);

  // --- Nights & total ---
  const nights =
    context.checkIn && context.checkOut
      ? countNights(context.checkIn, context.checkOut)
      : null;
  const total =
    context.totalPrice ??
    (nights && pricePerNight ? nights * pricePerNight : null);

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
    `- Harga: ${pricePerNight ? `${fmtRp(pricePerNight)}/malam` : "—"}\n` +
    `- Total: ${total ? fmtRp(total) : "—"}\n\n` +
    `Apakah data di atas sudah benar dan Kakak ingin melanjutkan ke Booking & Pembayaran? ` +
    `Ketik "Ya", "Lanjut", atau "Batal".`;
  return { handled: true, reply: summary };
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

/** Temukan koreksi tipe kamar yang disebut tamu sebelum konfirmasi final. */
export function detectRequestedRoomChange(
  message: string,
  rooms: Array<{ id: string; name: string; base_rate?: number | null }>,
  currentRoomId?: string,
): { id: string; name: string; pricePerNight: number } | null {
  const normalizedMessage = message.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalizedMessage) return null;

  const matches = rooms
    .filter((room) => room.id !== currentRoomId)
    .filter((room) => {
      const normalizedName = room.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return normalizedName.length > 1 && normalizedMessage.includes(normalizedName);
    })
    .sort((a, b) => b.name.length - a.name.length);

  const selected = matches[0];
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

  // Interruption Check (Cancellation) — explicit "batal" resets the flow.
  if (CANCELLATION_PATTERNS.test(message) && state !== "IDLE") {
    await updateBookingState(supabase, phone, "IDLE", {});
    return { handled: true, reply: "Baik Kak, proses reservasi telah dibatalkan. Ada hal lain yang bisa saya bantu?" };
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
    // We assume the user replied with their name.
    const name = message.trim();
    if (name.length < 2) {
      return { handled: true, reply: "Maaf, nama yang dimasukkan terlalu singkat. Silakan masukkan nama lengkap Kakak:" };
    }
    if (!looksLikePersonName(name)) {
      // Looks like the guest typed a question or a room preference instead.
      // Don't store the garbage as guestName.
      // If clearly a question/room-pref, defer to LLM so it can answer and
      // then re-ask for the name in the same turn.
      if (ROOM_PREFERENCE_OR_QUESTION.test(name)) {
        console.info(
          `[BookingState] AWAITING_NAME: question/room-pref detected ("${name.slice(0, 60)}…"). ` +
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
    const newName = trimmed.replace(/^(pakai|gunakan|pake|nama)\s+/i, "").trim();
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
      return buildBookingSummary(context);
    }
    // A phone number was typed directly → use it.
    const typedPhone = extractPhone(trimmed);
    if (typedPhone) {
      context.guestPhone = typedPhone;
      await updateBookingState(supabase, phone, "CONFIRMING_BOOKING", context);
      return buildBookingSummary(context);
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
    return buildBookingSummary(context);
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
      return buildBookingSummary(context);
    }

    if (CONFIRM_PATTERN.test(message)) {
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

      // Short ack only — the Finance Agent owns invoice delivery and will
      // append the bank details + invoice link as the second half of this
      // turn's reply (orchestrator stitches the two together).
      return {
        handled: true,
        reply:
          `Terima kasih Kak ${context.guestName}! Pemesanan berhasil dibuat ` +
          `dengan kode ${result.reference_code}. ` +
          `Berikut detail invoice dan pembayarannya:`,
        followUp: "send_invoice",
        followUpRef: result.reference_code,
      };
    } else if (CANCEL_PATTERN.test(message)) {
      await updateBookingState(supabase, phone, "AWAITING_NAME", context);
      return { handled: true, reply: "Baik, mari kita ulangi pengisian datanya. Mohon ketik nama lengkap Kakak:" };
    } else {
      return { handled: true, reply: 'Mohon konfirmasi dengan mengetik "Ya" jika benar, atau "Batal" jika ingin mengulang.' };
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
