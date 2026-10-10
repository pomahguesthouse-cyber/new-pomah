/**
 * Training RAG service.
 *
 * Mengindeks pasangan tanya–jawab di `ai_conversation_logs` (yang sudah
 * ditandai admin sebagai `rating='good'` & `used=true`) serta koreksi dari
 * `wa_correction_dataset` sebagai vector embeddings, lalu meretrieve top-K
 * contoh paling mirip dengan pesan terakhir tamu.
 *
 * Hasilnya dipakai sebagai few-shot examples di prompt sistem agent sehingga
 * koreksi admin di simulator maupun koreksi dari percakapan WhatsApp asli
 * benar-benar memengaruhi jawaban chatbot di produksi.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateEmbedding } from "./embedding.service";
import type { AiClientConfig } from "./types";
import {
  buildCorrectionEmbeddingText,
  buildLogEmbeddingText,
  buildSessionEmbeddingText,
  clearEmbedding,
  effectiveLogAnswer,
  writeEmbedding,
  type EmbedOutcome,
} from "@/services/training-embedding";

export interface LogTrainingExample {
  id: string;
  user_message: string;
  effective_answer: string;
  similarity: number;
}

/** @deprecated gunakan `LogTrainingExample` — alias dipertahankan untuk kompatibilitas. */
export type TrainingExample = LogTrainingExample;

/** Susun teks gabungan yang di-embed: pertanyaan + jawaban final yang dipakai. */
function composeEmbeddingText(userMessage: string, effectiveAnswer: string): string {
  return buildLogEmbeddingText(userMessage, effectiveAnswer);
}

/** Susun teks embedding untuk koreksi: konteks error + jawaban ideal. */
function composeCorrectionEmbeddingText(userMessage: string, badReply: string, idealReply: string): string {
  return buildCorrectionEmbeddingText(userMessage, badReply, idealReply);
}

/**
 * Hitung & simpan embedding untuk satu baris `ai_conversation_logs`.
 * Skip kalau log tidak ada, atau user_message / effective_answer kosong.
 */
export async function embedTrainingExample(
  supabaseAdmin: SupabaseClient,
  logId: string,
  llmConfig: AiClientConfig,
  options?: { signal?: AbortSignal },
): Promise<EmbedOutcome> {
  if (!llmConfig.apiKey) {
    return { ok: false, reason: "missing-api-key" };
  }

  const { data: row, error: readErr } = await supabaseAdmin
    .from("ai_conversation_logs")
    .select("id, user_message, ai_response, correction, rating, used")
    .eq("id", logId)
    .maybeSingle();

  if (readErr || !row) {
    return { ok: false, reason: readErr?.message ?? "not-found" };
  }

  const record = row as Record<string, unknown>;
  if (record.rating !== "good" || record.used !== true) {
    await clearEmbedding(supabaseAdmin, "ai_conversation_logs", logId);
    return { ok: false, reason: "not-eligible" };
  }

  // `effective_answer` adalah generated column — hitung ulang di sini agar
  // kita tidak perlu round-trip kedua kali. Correction menang atas ai_response.
  const effective = effectiveLogAnswer(
    record.correction as string | null,
    record.ai_response as string | null,
  );
  const userMessage = ((record.user_message as string | null) ?? "").trim();

  if (!effective || !userMessage) {
    return { ok: false, reason: "empty-content" };
  }

  const embedding = await generateEmbedding(
    llmConfig,
    composeEmbeddingText(userMessage, effective),
    { signal: options?.signal },
  );
  if (!embedding) {
    return { ok: false, reason: "embedding-failed" };
  }

  return writeEmbedding(supabaseAdmin, "ai_conversation_logs", logId, embedding);
}

/**
 * Hitung & simpan embedding untuk satu baris `wa_correction_dataset`.
 * Dipakai saat admin menandai jawaban WhatsApp asli sebagai salah dan memberi
 * balasan ideal. Row ini akan muncul sebagai positive + negative training signal.
 */
export async function embedWaCorrectionExample(
  supabaseAdmin: SupabaseClient,
  correctionId: string,
  llmConfig: AiClientConfig,
  options?: { signal?: AbortSignal },
): Promise<EmbedOutcome> {
  if (!llmConfig.apiKey) {
    return { ok: false, reason: "missing-api-key" };
  }

  const { data: row, error: readErr } = await supabaseAdmin
    .from("wa_correction_dataset")
    .select("id, user_message, bot_wrong_reply, ideal_reply, status")
    .eq("id", correctionId)
    .maybeSingle();

  if (readErr || !row) {
    return { ok: false, reason: readErr?.message ?? "not-found" };
  }

  const record = row as Record<string, unknown>;
  if (record.status !== "approved") {
    await clearEmbedding(supabaseAdmin, "wa_correction_dataset", correctionId);
    return { ok: false, reason: "not-approved" };
  }

  const userMessage = ((record.user_message as string | null) ?? "").trim();
  const badReply = ((record.bot_wrong_reply as string | null) ?? "").trim();
  const idealReply = ((record.ideal_reply as string | null) ?? "").trim();

  if (!userMessage || !idealReply) {
    return { ok: false, reason: "empty-content" };
  }

  const embedding = await generateEmbedding(
    llmConfig,
    composeCorrectionEmbeddingText(userMessage, badReply, idealReply),
    { signal: options?.signal },
  );
  if (!embedding) {
    return { ok: false, reason: "embedding-failed" };
  }

  return writeEmbedding(supabaseAdmin, "wa_correction_dataset", correctionId, embedding);
}

/**
 * Embedding sesi koreksi. Vektor disimpan di `wa_correction_sessions.embedding`,
 * kolom yang dibaca `match_wa_correction_ideal_examples`.
 */
export async function embedWaCorrectionSession(
  supabaseAdmin: SupabaseClient,
  sessionId: string,
  llmConfig: AiClientConfig,
  options?: { signal?: AbortSignal },
): Promise<EmbedOutcome> {
  if (!llmConfig.apiKey) {
    return { ok: false, reason: "missing-api-key" };
  }

  const { data: row, error: readErr } = await supabaseAdmin
    .from("wa_correction_sessions")
    .select("id, conversation_summary, title, corrected_transcript, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (readErr || !row) {
    return { ok: false, reason: readErr?.message ?? "not-found" };
  }

  const record = row as Record<string, unknown>;
  if (record.status !== "approved") {
    await clearEmbedding(supabaseAdmin, "wa_correction_sessions", sessionId);
    return { ok: false, reason: "not-approved" };
  }

  const text = buildSessionEmbeddingText({
    conversationSummary: record.conversation_summary as string | null,
    title: record.title as string | null,
    correctedTranscript: record.corrected_transcript,
  });
  if (!text.trim()) {
    return { ok: false, reason: "empty-content" };
  }

  const embedding = await generateEmbedding(llmConfig, text, { signal: options?.signal });
  if (!embedding) {
    return { ok: false, reason: "embedding-failed" };
  }

  return writeEmbedding(supabaseAdmin, "wa_correction_sessions", sessionId, embedding);
}

/** Retrieve top-K contoh training yang paling mirip dengan pesan tamu. */
export async function retrieveTrainingExamples(
  supabaseAdmin: SupabaseClient,
  query: string,
  llmConfig: AiClientConfig,
  options: { matchCount?: number; minSimilarity?: number } = {},
): Promise<TrainingExample[]> {
  const trimmed = (query ?? "").trim();
  if (!trimmed || !llmConfig.apiKey) return [];

  const matchCount = options.matchCount ?? 3;
  const minSimilarity = options.minSimilarity ?? 0.78;

  const queryEmbedding = await generateEmbedding(llmConfig, trimmed);
  if (!queryEmbedding) return [];

  const { data, error } = await supabaseAdmin.rpc("match_training_examples", {
    query_embedding: queryEmbedding as unknown as string,
    match_threshold: minSimilarity,
    match_count: matchCount,
  });

  if (error) {
    console.error("[TrainingRAG] match_training_examples error:", error);
    return [];
  }
  return (data ?? []) as TrainingExample[];
}

/** Format contoh sebagai blok teks yang aman ditempel ke system prompt. */
export function formatTrainingExamplesForPrompt(examples: TrainingExample[]): string {
  if (!examples.length) return "";
  const blocks = examples.map((ex, i) => {
    const q = ex.user_message.trim().slice(0, 600);
    const a = ex.effective_answer.trim().slice(0, 600);
    return `Contoh ${i + 1} (kemiripan ${ex.similarity.toFixed(2)}):\nQ: ${q}\nA: ${a}`;
  });
  return [
    "## Contoh jawaban yang sudah disetujui admin",
    "Gunakan contoh berikut sebagai panduan gaya, nada, dan isi jawaban.",
    "Jangan menyalin mentah — adaptasikan ke pertanyaan tamu saat ini.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}
