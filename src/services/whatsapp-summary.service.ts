import type { ChatSummaryStructured, ChatSummarySource, LastTopic } from "@/ai/chat-summary.types";
import type { WhatsAppMessage, WhatsAppThread } from "@/types/whatsapp";
import { isEmptySummaryJson } from "@/types/whatsapp";

export interface SummaryLlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type SummaryGenerator = (
  history: Array<{ direction: string; body: string; sent_at?: string }>,
  existingSummary: string | null | undefined,
  config: SummaryLlmConfig,
) => Promise<ChatSummaryStructured | null>;

export interface SummaryBackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
}

const ROOM_KEYWORDS: Array<{ room: string; re: RegExp }> = [
  { room: "Family", re: /family/i },
  { room: "Deluxe", re: /deluxe/i },
  { room: "Single", re: /single/i },
];

const TOPIC_RULES: Array<{ topic: LastTopic; re: RegExp }> = [
  { topic: "payment", re: /(transfer|bayar|pembayaran|bukti|invoice|dp)/i },
  { topic: "booking", re: /(booking|reservasi|pesan kamar|check[- ]?in|check[- ]?out)/i },
  { topic: "pricing", re: /(harga|tarif|rate|berapa)/i },
  { topic: "availability", re: /(tersedia|available|kosong|penuh|tanggal)/i },
  { topic: "location", re: /(lokasi|alamat|maps|arah)/i },
  { topic: "facility", re: /(fasilitas|wifi|parkir|ac|kamar mandi)/i },
  { topic: "complaint", re: /(komplain|keluhan|rusak|kotor|bau|tidak bisa|nggak bisa|ga bisa)/i },
];

function bodyOf(message: Pick<WhatsAppMessage, "body"> | null | undefined): string {
  return String(message?.body ?? "").trim();
}

function latestInbound(messages: Array<Pick<WhatsAppMessage, "direction" | "body">>): string {
  return bodyOf([...messages].reverse().find((m) => m.direction === "in"));
}

function latestAny(messages: Array<Pick<WhatsAppMessage, "body">>): string {
  return bodyOf([...messages].reverse()[0]);
}

function detectRoomType(text: string): string | null {
  return ROOM_KEYWORDS.find((rule) => rule.re.test(text))?.room ?? null;
}

function detectTopic(text: string): LastTopic {
  return TOPIC_RULES.find((rule) => rule.re.test(text))?.topic ?? "general";
}

function hasComplaint(text: string): boolean {
  return /(komplain|keluhan|rusak|kotor|bau|tidak bisa|nggak bisa|ga bisa)/i.test(text);
}

function compactSummaryText(input: string, source: ChatSummarySource): string {
  const fallback = "Percakapan WhatsApp aktif. Belum ada ringkasan detail.";
  const base = input.trim() || fallback;
  const prefix = source === "human_takeover_auto"
    ? "Human takeover aktif. Percakapan tetap diringkas otomatis. Pesan terakhir tamu: "
    : "Percakapan WhatsApp aktif. Pesan terakhir tamu: ";
  return base === fallback ? fallback : `${prefix}${base.slice(0, 220)}`;
}

export function buildSeedSummary(args: {
  thread?: Pick<WhatsAppThread, "display_name" | "ai_auto" | "last_message_preview"> | null;
  messages: Array<Pick<WhatsAppMessage, "direction" | "body">>;
  source?: ChatSummarySource;
}): ChatSummaryStructured {
  const inbound = latestInbound(args.messages);
  const last = inbound || latestAny(args.messages) || args.thread?.last_message_preview || "";
  const combined = args.messages.map((m) => m.body).join(" ");
  const source = args.source ?? (args.thread?.ai_auto === false ? "human_takeover_auto" : "auto_seed");
  const complaint = hasComplaint(combined);
  const shortSummary = compactSummaryText(last, source);

  return {
    source,
    short_summary: shortSummary,
    guest_name: args.thread?.display_name ?? null,
    last_topic: complaint ? "complaint" : detectTopic(combined),
    room_type: detectRoomType(combined),
    check_in: null,
    check_out: null,
    guest_count: null,
    booking_status: /booking|reservasi|pesan kamar|check[- ]?in|check[- ]?out/i.test(combined) ? "pending" : null,
    payment_status: /sudah.*(transfer|bayar)|lunas|paid/i.test(combined)
      ? "paid"
      : /(transfer|bayar|pembayaran|bukti|invoice|dp)/i.test(combined)
        ? "unpaid"
        : null,
    complaint_active: complaint,
    unresolved_question: inbound.includes("?") ? inbound.slice(0, 240) : null,
    needs_human: complaint,
    handoff_reason: args.thread?.ai_auto === false ? "AI Auto nonaktif / Human Takeover" : null,
  };
}

export function summaryIsMissing(thread: Pick<WhatsAppThread, "chat_summary" | "chat_summary_json" | "chat_summary_updated_at"> | null | undefined): boolean {
  if (!thread) return false;
  return !thread.chat_summary_updated_at || !thread.chat_summary?.trim() || isEmptySummaryJson(thread.chat_summary_json);
}

export async function fetchThreadSummaryInput(client: any, threadId: string) {
  const { data: thread, error: threadError } = await client
    .from("whatsapp_threads")
    .select("id, display_name, ai_auto, last_message_preview, chat_summary, chat_summary_json, chat_summary_updated_at, chat_summary_version")
    .eq("id", threadId)
    .maybeSingle();
  if (threadError) throw threadError;
  if (!thread) throw new Error("Thread not found");

  const { data: messages, error: messagesError } = await client
    .from("whatsapp_messages")
    .select("direction, body, sent_at")
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: true })
    .limit(45);
  if (messagesError) throw messagesError;

  return {
    thread: thread as WhatsAppThread,
    messages: (messages ?? []) as WhatsAppMessage[],
  };
}

export async function persistThreadSummary(
  client: any,
  threadId: string,
  structured: ChatSummaryStructured,
): Promise<void> {
  const { data: prev } = await client
    .from("whatsapp_threads")
    .select("chat_summary_version")
    .eq("id", threadId)
    .maybeSingle();

  const nextVersion = ((prev as { chat_summary_version?: number } | null)?.chat_summary_version ?? 0) + 1;
  const { error } = await client
    .from("whatsapp_threads")
    .update({
      chat_summary: structured.short_summary,
      chat_summary_json: structured,
      chat_summary_version: nextVersion,
      chat_summary_updated_at: new Date().toISOString(),
    })
    .eq("id", threadId);

  if (error) throw error;
}

export async function generateAndPersistThreadSummary(args: {
  client: any;
  threadId: string;
  config: SummaryLlmConfig;
  generator: SummaryGenerator;
  fallbackToSeed?: boolean;
}): Promise<{ ok: true; summary: ChatSummaryStructured; source: "llm" | "seed" } | { ok: false; error: string }> {
  try {
    const { thread, messages } = await fetchThreadSummaryInput(args.client, args.threadId);
    const normalizedHistory = messages.map((m) => ({
      direction: m.direction,
      body: m.body,
      sent_at: m.sent_at ?? undefined,
    }));
    const generated = await args.generator(normalizedHistory, thread.chat_summary, args.config);
    const summary = generated
      ? { ...generated, source: "llm" as const }
      : args.fallbackToSeed === false
        ? null
        : buildSeedSummary({ thread, messages, source: "auto_seed" });

    if (!summary) return { ok: false, error: "Summary generator returned empty result" };
    await persistThreadSummary(args.client, args.threadId, summary);
    return { ok: true, summary, source: generated ? "llm" : "seed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function seedMissingThreadSummary(client: any, threadId: string): Promise<{ updated: boolean }> {
  const { thread, messages } = await fetchThreadSummaryInput(client, threadId);
  if (!summaryIsMissing(thread)) return { updated: false };
  const summary = buildSeedSummary({ thread, messages, source: "backfill_auto" });
  await persistThreadSummary(client, threadId, summary);
  return { updated: true };
}

export async function clearWhatsappThreadSummary(client: any, threadId: string): Promise<void> {
  const { error } = await client
    .from("whatsapp_threads")
    .update({
      chat_summary: null,
      chat_summary_json: {},
      chat_summary_updated_at: null,
    })
    .eq("id", threadId);
  if (error) throw error;
}
