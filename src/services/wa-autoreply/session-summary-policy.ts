import {
  BOOKING_STATUS_VALUES,
  LAST_TOPIC_VALUES,
  PAYMENT_STATUS_VALUES,
  type ChatSummaryStructured,
} from "@/ai/chat-summary.types";

/** Minimum interval between automatic summary regenerations for one thread. */
export const SUMMARY_REGEN_COOLDOWN_MS = 3 * 60 * 1000;

/** Messages containing these terms bypass the normal summary cooldown. */
export const FORCE_SUMMARY_KEYWORDS: readonly string[] = [
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

/** Hard cap on persisted short_summary length to prevent prompt bloat. */
export const SUMMARY_MAX_CHARS = 800;

export function shouldForceSummary(lastMessage: string): boolean {
  if (!lastMessage) return false;
  const text = lastMessage.toLowerCase();
  return FORCE_SUMMARY_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function parseStructuredSummary(raw: string): ChatSummaryStructured | null {
  if (!raw) return null;

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let obj: Record<string, unknown> | null = null;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        obj = JSON.parse(match[0]);
      } catch {
        // Invalid embedded JSON is handled below.
      }
    }
  }

  if (!obj || typeof obj !== "object") {
    console.warn(`[SessionSummarizer] summary failed invalid JSON: ${cleaned.slice(0, 200)}`);
    return null;
  }

  const pickEnum = <T extends string>(value: unknown, list: readonly T[]): T | null =>
    typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;
  const pickString = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const pickNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const pickBool = (value: unknown): boolean => value === true;

  let shortSummary = pickString(obj.short_summary) ?? "";
  if (shortSummary.length > SUMMARY_MAX_CHARS) {
    shortSummary = `${shortSummary.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
  }
  if (!shortSummary) {
    console.warn("[SessionSummarizer] summary failed invalid JSON: empty short_summary");
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
