import { SupabaseClient } from "@supabase/supabase-js";
import { classifyIntent } from "@/ai/router/intent-classifier";
import { createBooking } from "@/tools/booking.tool";
import type { ToolContext } from "@/tools/types";

export type BookingState =
  | "IDLE"
  | "AWAITING_DATES"
  | "ROOM_SELECTED"
  | "AWAITING_NAME"
  | "CONFIRMING_NAME"
  | "AWAITING_EMAIL"
  | "CONFIRMING_PHONE"
  | "AWAITING_PHONE"
  | "CONFIRMING_BOOKING"
  | "PAYMENT_PENDING"
  | "COMPLETED";

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

/** Build the pre-confirmation booking summary once all guest details are set. */
function buildBookingSummary(context: BookingContext): StateMachineResult {
  const summary = `Data pemesanan sudah lengkap! Berikut ringkasannya:

- Nama: ${context.guestName}
- Email: ${context.guestEmail}
- No. HP: ${context.guestPhone}
- Kamar: ${context.roomName}

Apakah data di atas sudah benar dan Kakak ingin melanjutkan untuk proses Booking & Pembayaran? (Ketik "Ya" atau "Lanjut" / "Batal")`;
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
      return !!extractPhone(message) || USE_THIS_PATTERN.test(message) || USE_OTHER_PATTERN.test(message);
    case "CONFIRMING_NAME":
      return USE_THIS_PATTERN.test(message) || USE_OTHER_PATTERN.test(message);
    case "CONFIRMING_BOOKING":
      return /\b(ya|lanjut|benar|oke|ok|setuju|betul|tidak|batal|salah|ubah|ganti)\b/i.test(message);
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
  const supabase = ctx.supabasePublic;
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
      // Don't store the garbage as guestName — re-prompt instead.
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
      // preference, not a name. Don't overwrite guestName with that.
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
    // Explicit "use this number" (the chat number)
    if (USE_THIS_PATTERN.test(trimmed) && !USE_OTHER_PATTERN.test(trimmed) && !extractPhone(trimmed)) {
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
    if (/\b(ya|lanjut|benar|oke|ok|setuju|betul)\b/i.test(message)) {
      // Create the booking deterministically with the data collected in context.
      const raw = await createBooking(
        {
          room_type:  context.roomName,
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
    } else if (/\b(tidak|batal|salah|ubah|ganti)\b/i.test(message)) {
      await updateBookingState(supabase, phone, "AWAITING_NAME", context);
      return { handled: true, reply: "Baik, mari kita ulangi pengisian datanya. Mohon ketik nama lengkap Kakak:" };
    } else {
      return { handled: true, reply: 'Mohon konfirmasi dengan mengetik "Ya" jika benar, atau "Batal" jika ingin mengulang.' };
    }
  }
  
  if (state === "PAYMENT_PENDING") {
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
