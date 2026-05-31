/**
 * Training RAG service.
 *
 * Mengindeks pasangan tanya–jawab di `ai_conversation_logs` (yang sudah
 * ditandai admin sebagai `rating='good'` & `used=true`) sebagai vector
 * embeddings, lalu meretrieve top-K contoh paling mirip dengan pesan
 * terakhir tamu. Hasilnya dipakai sebagai few-shot examples di prompt
 * sistem agent sehingga koreksi admin di simulator benar-benar
 * memengaruhi jawaban chatbot di produksi.
 *
 * Catatan:
 * - Pakai model embedding yang sama dengan sop_chunks (`text-embedding-3-small`,
 *   1536 dim) supaya konsisten dan re-pakai `generateEmbedding`.
 * - Hanya jalan dari server (memerlukan apiKey + supabaseAdmin).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateEmbedding } from "./embedding.service";
import type { AiClientConfig } from "./types";

export interface TrainingExample {
  id: string;
  user_message: string;
  effective_answer: string;
  similarity: number;
}

/** Susun teks gabungan yang di-embed: pertanyaan + jawaban final yang dipakai. */
function composeEmbeddingText(userMessage: string, effectiveAnswer: string): string {
  const q = (userMessage ?? "").trim().slice(0, 1500);
  const a = (effectiveAnswer ?? "").trim().slice(0, 2500);
  return `Tamu: ${q}\nAsisten: ${a}`;
}

/**
 * Hitung & simpan embedding untuk satu baris `ai_conversation_logs`.
 * Skip kalau log tidak ada, atau user_message / effective_answer kosong.
 */
export async function embedTrainingExample(
  supabaseAdmin: SupabaseClient,
  logId: string,
  llmConfig: AiClientConfig,
): Promise<{ ok: boolean; reason?: string }> {
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

  // `effective_answer` adalah generated column — hitung ulang di sini agar
  // kita tidak perlu round-trip kedua kali.
  const correction = ((row as Record<string, unknown>).correction as string | null) ?? null;
  const aiResponse = ((row as Record<string, unknown>).ai_response as string | null) ?? null;
  const effective = correction?.trim() ? correction.trim() : (aiResponse ?? "").trim();
  const userMessage = (((row as Record<string, unknown>).user_message as string | null) ?? "").trim();

  if (!effective || !userMessage) {
    return { ok: false, reason: "empty-content" };
  }

  const embedding = await generateEmbedding(
    llmConfig,
    composeEmbeddingText(userMessage, effective),
  );
  if (!embedding) {
    return { ok: false, reason: "embedding-failed" };
  }

  const { error: updErr } = await supabaseAdmin
    .from("ai_conversation_logs")
    .update({
      embedding: embedding as unknown as string,
      embedding_updated_at: new Date().toISOString(),
    })
    .eq("id", logId);

  if (updErr) {
    return { ok: false, reason: updErr.message };
  }
  return { ok: true };
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
