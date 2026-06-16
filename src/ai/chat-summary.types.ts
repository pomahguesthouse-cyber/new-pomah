/**
 * Tipe Context Summary terstruktur untuk WhatsApp thread.
 *
 * Disimpan di kolom `whatsapp_threads.chat_summary_json`. Field yang tidak
 * pernah disebut tamu/bot HARUS bernilai null (atau false untuk boolean) —
 * jangan dikarang oleh LLM. `short_summary` juga di-mirror ke kolom
 * `chat_summary` (text) supaya alur lama tetap berfungsi.
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

export interface ChatSummaryStructured {
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

export function isChatSummaryStructured(v: unknown): v is ChatSummaryStructured {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { short_summary?: unknown }).short_summary === "string"
  );
}
