import type { ChatSummaryStructured } from "@/ai/chat-summary.types";
import { chatCompletionText } from "@/services/ai-client.service";
import {
  parseStructuredSummary,
  SUMMARY_MAX_CHARS,
} from "@/services/wa-autoreply/session-summary-policy";

export const SUMMARY_MIN_MESSAGES = 3;

export type SummaryMessage = {
  direction: string;
  body: string;
  sent_at?: string;
};

export type SummaryAiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export async function generateSessionSummary(
  history: SummaryMessage[],
  existingSummary: string | null | undefined,
  config: SummaryAiConfig,
): Promise<ChatSummaryStructured | null> {
  const historyText = history
    .map((message) => `${message.direction === "in" ? "Tamu" : "Bot"}: ${message.body}`)
    .join("\n");

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
  } catch (error) {
    console.error("[SessionSummarizer] Failed to generate summary:", error);
    return null;
  }
}

export async function updateThreadSummary(
  client: any,
  threadId: string,
  structured: ChatSummaryStructured,
  opts?: { jsonOnly?: boolean },
): Promise<void> {
  const { data: previous } = await client
    .from("whatsapp_threads")
    .select("chat_summary_version")
    .eq("id", threadId)
    .maybeSingle();

  const nextVersion =
    ((previous as { chat_summary_version?: number } | null)?.chat_summary_version ?? 0) + 1;

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
    console.error("[SessionSummarizer] Database update failed:", error.message);
  }
}

export async function regenerateThreadSummary(
  client: any,
  threadId: string,
  config: SummaryAiConfig,
): Promise<{ ok: boolean; summary?: ChatSummaryStructured; error?: string }> {
  const { data: rows } = await client
    .from("whatsapp_messages")
    .select("direction, body, sent_at")
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: false })
    .limit(30);

  const history = ((rows ?? []) as SummaryMessage[]).reverse();
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

  if (!summary) {
    return { ok: false, error: "Gagal membuat ringkasan (JSON invalid)." };
  }

  await updateThreadSummary(client, threadId, summary);
  console.info(`[SessionSummarizer] manual regen for thread ${threadId.slice(0, 8)}`);
  return { ok: true, summary };
}
