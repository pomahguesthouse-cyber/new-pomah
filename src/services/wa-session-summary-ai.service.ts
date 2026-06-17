import {
  BOOKING_STATUS_VALUES,
  LAST_TOPIC_VALUES,
  PAYMENT_STATUS_VALUES,
  type ChatSummaryStructured,
} from "@/ai/chat-summary.types";
import { chatCompletionText, type AiClientConfig } from "@/services/ai-client.service";

const SUMMARY_MAX_CHARS = 800;

export type WaSummaryMessage = {
  direction: string;
  body: string;
  sent_at?: string;
};

export async function generateWhatsAppSessionSummary(
  history: WaSummaryMessage[],
  existingSummary: string | null | undefined,
  config: AiClientConfig,
): Promise<ChatSummaryStructured | null> {
  const historyText = history
    .map((m) => `${m.direction === "in" ? "Tamu" : "Bot"}: ${m.body}`)
    .join("\n");

  const prompt = [
    "Ringkas percakapan Pomah Guesthouse ke JSON valid saja.",
    "Field JSON wajib: short_summary, guest_name, last_topic, room_type, check_in, check_out, guest_count, booking_status, payment_status, complaint_active, unresolved_question, needs_human, handoff_reason.",
    "Nilai yang tidak ada di percakapan harus null, kecuali boolean false.",
    "last_topic hanya salah satu: pricing, availability, facility, booking, payment, complaint, location, general, atau null.",
    "booking_status hanya salah satu: none, pending, confirmed, cancelled, checked_in, checked_out, atau null.",
    "payment_status hanya salah satu: unpaid, down_payment, paid, pay_at_hotel, atau null.",
    existingSummary ? `Ringkasan sebelumnya:\n${existingSummary}` : "",
    `Transkrip:\n${historyText}`,
  ].filter(Boolean).join("\n\n");

  const raw = await chatCompletionText(
    config,
    [{ role: "user", content: prompt }],
    {
      temperature: 0.2,
      maxTokens: 700,
      responseFormat: { type: "json_object" },
    },
  );

  return parseWhatsAppStructuredSummary(raw ?? "");
}

export function parseWhatsAppStructuredSummary(raw: string): ChatSummaryStructured | null {
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
    console.warn(`[SessionSummarizer] invalid JSON: ${cleaned.slice(0, 200)}`);
    return null;
  }

  const pickEnum = <T extends string>(v: unknown, list: readonly T[]): T | null =>
    typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
  const pickString = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const pickNumber = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const pickBool = (v: unknown): boolean => v === true;

  let shortSummary = pickString(obj.short_summary) ?? "";
  if (shortSummary.length > SUMMARY_MAX_CHARS) {
    shortSummary = shortSummary.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd() + "…";
  }
  if (!shortSummary) {
    console.warn("[SessionSummarizer] empty short_summary");
    return null;
  }

  return {
    source: "llm",
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
