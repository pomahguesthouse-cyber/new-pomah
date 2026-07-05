/**
 * Tipe Context Summary terstruktur untuk WhatsApp thread.
 *
 * Disimpan di kolom `whatsapp_threads.chat_summary_json`. Field yang tidak
 * pernah disebut tamu/bot HARUS bernilai null (atau false untuk boolean) —
 * jangan dikarang oleh LLM. `short_summary` juga di-mirror ke kolom
 * `chat_summary` (text) supaya alur lama tetap berfungsi.
 *
 * Field tambahan seperti `next_action`, `special_requests`, dan
 * `preference_notes` juga disalin ke tabel `guest_structured_memory` agar
 * konteks penting tamu tetap tersedia lintas sesi.
 */

export type LastTopic =
  | "pricing"
  | "availability"
  | "facility"
  | "booking"
  | "payment"
  | "complaint"
  | "location"
  | "general";

export type BookingSummaryStatus =
  | "none"
  | "pending"
  | "confirmed"
  | "cancelled"
  | "checked_in"
  | "checked_out";

export type PaymentSummaryStatus =
  | "unpaid"
  | "down_payment"
  | "paid"
  | "pay_at_hotel";

export type ChatSummarySource =
  | "llm"
  | "manual"
  | "auto_seed"
  | "human_takeover_auto"
  | "backfill_auto";

export interface ChatSummaryStructured {
  source?: ChatSummarySource;
  short_summary: string;
  guest_name: string | null;
  last_topic: LastTopic | null;
  room_type: string | null;
  check_in: string | null;
  check_out: string | null;
  guest_count: number | null;
  booking_status: BookingSummaryStatus | null;
  payment_status: PaymentSummaryStatus | null;
  complaint_active: boolean;
  unresolved_question: string | null;
  needs_human: boolean;
  handoff_reason: string | null;

  /** Jumlah dewasa jika eksplisit disebut. */
  adults?: number | null;
  /** Jumlah anak/balita jika eksplisit disebut. */
  children?: number | null;
  /** Sumber tamu: TikTok, IG, Google Maps, OTA, direct, dll. */
  source_channel?: string | null;
  /** Catatan budget/harga yang disebut tamu. */
  budget_note?: string | null;
  /** Permintaan khusus: extra bed, lantai bawah, parkir, dekat kampus, dll. */
  special_requests?: string | null;
  /** Preferensi umum tamu: tipe kamar favorit, kebiasaan, kebutuhan keluarga. */
  preference_notes?: string | null;
  /** Ringkasan keluhan aktif bila ada. */
  complaint_summary?: string | null;
  /** Tindakan berikutnya yang perlu dilakukan bot/admin. */
  next_action?: string | null;
  /** Intent terakhir jika diketahui oleh ringkasan. */
  last_intent?: string | null;
  /** Pesan terakhir tamu yang substantif. */
  last_user_message?: string | null;
  /** Balasan terakhir bot/admin yang substantif. */
  last_bot_message?: string | null;
}

export const LAST_TOPIC_VALUES: readonly LastTopic[] = [
  "pricing",
  "availability",
  "facility",
  "booking",
  "payment",
  "complaint",
  "location",
  "general",
];

export const BOOKING_STATUS_VALUES: readonly BookingSummaryStatus[] = [
  "none",
  "pending",
  "confirmed",
  "cancelled",
  "checked_in",
  "checked_out",
];

export const PAYMENT_STATUS_VALUES: readonly PaymentSummaryStatus[] = [
  "unpaid",
  "down_payment",
  "paid",
  "pay_at_hotel",
];

// (CHAT_SUMMARY_SOURCE_VALUES, isChatSummaryStructured, hasStructuredSummary
//  dihapus 3 Jul 2026 — dead code, tidak pernah diimpor.)
