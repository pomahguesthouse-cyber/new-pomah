import { SupabaseClient } from "@supabase/supabase-js";
import { classifyIntent } from "@/ai/router/intent-classifier";

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
}

export interface StateRecord {
  phone: string;
  state: BookingState;
  context: BookingContext;
  updated_at: string;
}

export interface StateMachineResult {
  handled: boolean;
  reply?: string;
}

const CANCELLATION_PATTERNS = /\b(batal|cancel|nggak jadi|ga jadi|tidak jadi|berhenti)\b/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^(?:\+62|62|0)[2-9][0-9]{7,11}$/;

// Affirm = "use this one"; Decline/Other = "use a different one".
const USE_THIS_PATTERN = /\b(ya|iya|yes|pakai ini|gunakan ini|ini saja|ini aja|pake ini|betul|benar|oke|ok|sip|setuju|lanjut)\b/i;
const USE_OTHER_PATTERN = /\b(lain|lainnya|beda|berbeda|ganti|bukan|tidak|nggak|ngga|enggak|gak|ubah|nama lain|nomor lain|no lain)\b/i;

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
    return { phone, state: "IDLE", context: {}, updated_at: new Date().toISOString() };
  }
  return data as StateRecord;
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

/**
 * Evaluates the message against the current state and returns whether the state machine handled it.
 */
export async function processBookingState(
  supabase: SupabaseClient,
  phone: string,
  message: string,
  currentStateRecord: StateRecord
): Promise<StateMachineResult> {
  let { state, context } = currentStateRecord;

  // Interruption Check (Cancellation)
  if (CANCELLATION_PATTERNS.test(message) && state !== "IDLE") {
    await updateBookingState(supabase, phone, "IDLE", {});
    return { handled: true, reply: "Baik Kak, proses reservasi telah dibatalkan. Ada hal lain yang bisa saya bantu?" };
  }

  // Interruption Check (General Questions)
  const intent = classifyIntent(message);
  if (intent.category !== "booking_inquiry" && intent.category !== "availability_check" && state !== "IDLE" && state !== "ROOM_SELECTED" && state !== "AWAITING_DATES") {
    // If we are strictly expecting a name, email, or phone, we might want to still accept it
    // if the intent is 'general' (since a name might be classified as general).
    // If it's a 'complaint' or 'housekeeping' in the middle of a booking, we interrupt.
    if (["complaint", "maintenance", "customer-care"].includes(intent.category)) {
      await updateBookingState(supabase, phone, "IDLE", {});
      return { handled: false }; // Let the main router handle this escalation/interruption
    }
  }

  if (state === "IDLE") {
    return { handled: false }; // Handled by LLM via normal AI workflow
  }

  // State: ROOM_SELECTED -> AWAITING_NAME
  // (Transition from IDLE to ROOM_SELECTED is handled by the AI Front Office Agent when tool is called)
  
  if (state === "AWAITING_NAME") {
    // We assume the user replied with their name.
    const name = message.trim();
    if (name.length < 2) {
      return { handled: true, reply: "Maaf, nama yang dimasukkan terlalu singkat. Silakan masukkan nama lengkap Kakak:" };
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
      // Create booking via tool normally or here.
      // Since this is intercepting, we can instruct the user to wait or we can call the tool directly.
      // But creating the booking requires DB access. We will let the orchestrator know it's time to trigger create_booking.
      // To keep it simple, we tell the orchestrator to run the Front Office Agent with a forced system prompt.
      // Or we can just set state to PAYMENT_PENDING and return unhandled so the AI handles the tool call.
      context.bookingCode = `BOOK-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      await updateBookingState(supabase, phone, "PAYMENT_PENDING", context);
      
      return { handled: false }; // Let the Front Office agent handle the actual `create_booking` tool call with this context!
    } else if (/\b(tidak|batal|salah|ubah|ganti)\b/i.test(message)) {
      await updateBookingState(supabase, phone, "AWAITING_NAME", context);
      return { handled: true, reply: "Baik, mari kita ulangi pengisian datanya. Mohon ketik nama lengkap Kakak:" };
    } else {
      return { handled: true, reply: 'Mohon konfirmasi dengan mengetik "Ya" jika benar, atau "Batal" jika ingin mengulang.' };
    }
  }
  
  if (state === "PAYMENT_PENDING") {
    // Awaiting payment proof
    if (/\b(sudah|lunas|bayar|bukti|transfer)\b/i.test(message)) {
      await updateBookingState(supabase, phone, "COMPLETED", context);
      return { handled: true, reply: "Terima kasih! Pembayaran Kakak akan segera diverifikasi oleh tim kami. Kami akan mengabari Kakak secepatnya setelah verifikasi berhasil." };
    }
    return { handled: true, reply: "Silakan selesaikan pembayaran ke rekening yang telah diinstruksikan sebelumnya, lalu kirimkan bukti transfer atau ketik 'Sudah bayar' di sini." };
  }

  if (state === "COMPLETED") {
    // Once completed, next message will reset to IDLE and process normally.
    await updateBookingState(supabase, phone, "IDLE", {});
    return { handled: false };
  }

  return { handled: false };
}
