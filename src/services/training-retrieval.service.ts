/**
 * Unified training retrieval — gabungkan tiga sumber contoh latihan:
 *   1) `chatbot_training_examples` (curated JSONL) → bobot lebih tinggi
 *   2) `ai_conversation_logs` (rating='good' admin) → bobot normal
 *   3) `wa_correction_dataset` (koreksi dari WhatsApp asli) → bobot tinggi
 *
 * Strategi:
 *   - Bila API key embedding tersedia → query vector ke semua sumber via RPC,
 *     gabungkan, dedup, beri boost, ambil top-K.
 *   - Bila tidak ada API key → fallback keyword overlap pada
 *     `chatbot_training_examples` (legacy path).
 *
 * Output kompatibel dengan struktur `AgentContext.trainingExamples` yang sudah
 * dipakai agent prompts. Koreksi WA asli juga masuk ke negative examples agar
 * agent melihat pola jawaban yang harus dihindari.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateEmbedding } from "@/ai/embedding.service";
import type { AiClientConfig } from "@/ai/types";
import {
  findRelevantTrainingExamples,
  type TrainingExample as KeywordExample,
} from "@/services/training-examples.service";

export interface UnifiedTrainingExample {
  id: string;
  source: "curated" | "log" | "correction";
  user_message: string;
  ideal_assistant_response: string;
  intent: string | null;
  stage: string | null;
  similarity: number;
}

export interface NegativeTrainingExample {
  id: string;
  source?: "log" | "wa_correction";
  user_message: string;
  bad_response: string;
  correction: string | null;
  similarity: number;
  correct_intent?: string | null;
  correct_agent?: string | null;
  error_type?: string | null;
}

interface FindInput {
  userMessage: string;
  intent?: string | null;
  stage?: string | null;
}

interface FindOptions {
  limit?: number;
  /** Bobot tambahan untuk contoh curated (0..1). Default 0.10. */
  curatedBoost?: number;
  /** Bobot tambahan untuk koreksi WhatsApp asli (0..1). Default 0.12. */
  correctionBoost?: number;
  /** Threshold kemiripan minimum untuk RPC vector (0..1). */
  minSimilarity?: number;
}

const DEFAULT_LIMIT = 3;
const DEFAULT_CURATED_BOOST = 0.10;
const DEFAULT_CORRECTION_BOOST = 0.12;
const DEFAULT_MIN_SIM = 0.72;

/** Retrieval utama. `llmConfig` opsional — bila null, pakai keyword fallback. */
export async function findTrainingContext(
  supabase: SupabaseClient,
  input: FindInput,
  llmConfig: AiClientConfig | null,
  options: FindOptions = {},
): Promise<UnifiedTrainingExample[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const curatedBoost = options.curatedBoost ?? DEFAULT_CURATED_BOOST;
  const correctionBoost = options.correctionBoost ?? DEFAULT_CORRECTION_BOOST;
  const minSim = options.minSimilarity ?? DEFAULT_MIN_SIM;

  const userMsg = (input.userMessage ?? "").trim();
  if (!userMsg) return [];

  // ── Fallback path: tanpa API key, pakai keyword overlap ke curated saja.
  if (!llmConfig?.apiKey) {
    const kw = await findRelevantTrainingExamples(supabase, input, limit);
    return kw.map((ex) => keywordToUnified(ex, 0.5));
  }

  // ── Hybrid path: embed query sekali, lalu query semua RPC paralel.
  const queryEmbedding = await generateEmbedding(llmConfig, userMsg).catch(() => null);
  if (!queryEmbedding) {
    // Embedding gagal — degrade ke keyword agar bot tetap punya contoh.
    const kw = await findRelevantTrainingExamples(supabase, input, limit);
    return kw.map((ex) => keywordToUnified(ex, 0.5));
  }

  const [curatedRes, logRes, correctionRes] = await Promise.allSettled([
    supabase.rpc("match_chatbot_training_examples", {
      query_embedding: queryEmbedding as unknown as string,
      match_threshold: minSim,
      match_count: limit,
    }),
    supabase.rpc("match_training_examples", {
      query_embedding: queryEmbedding as unknown as string,
      match_threshold: minSim,
      match_count: limit,
    }),
    supabase.rpc("match_wa_correction_ideal_examples", {
      query_embedding: queryEmbedding as unknown as string,
      match_threshold: minSim,
      match_count: limit,
    }),
  ]);

  const merged: UnifiedTrainingExample[] = [];

  if (curatedRes.status === "fulfilled" && Array.isArray(curatedRes.value.data)) {
    for (const r of curatedRes.value.data as Array<{
      id: string;
      user_message: string;
      ideal_assistant_response: string;
      intent: string | null;
      stage: string | null;
      similarity: number;
    }>) {
      merged.push({
        id: r.id,
        source: "curated",
        user_message: r.user_message,
        ideal_assistant_response: r.ideal_assistant_response,
        intent: r.intent,
        stage: r.stage,
        similarity: r.similarity + curatedBoost,
      });
    }
  }

  if (logRes.status === "fulfilled" && Array.isArray(logRes.value.data)) {
    for (const r of logRes.value.data as Array<{
      id: string;
      user_message: string;
      effective_answer: string;
      similarity: number;
    }>) {
      merged.push({
        id: r.id,
        source: "log",
        user_message: r.user_message,
        ideal_assistant_response: r.effective_answer,
        intent: null,
        stage: null,
        similarity: r.similarity,
      });
    }
  }

  if (correctionRes.status === "fulfilled" && Array.isArray(correctionRes.value.data)) {
    for (const r of correctionRes.value.data as Array<{
      id: string;
      user_message: string;
      ideal_assistant_response: string;
      intent: string | null;
      stage: string | null;
      similarity: number;
    }>) {
      merged.push({
        id: r.id,
        source: "correction",
        user_message: r.user_message,
        ideal_assistant_response: r.ideal_assistant_response,
        intent: r.intent,
        stage: r.stage,
        similarity: r.similarity + correctionBoost,
      });
    }
  }

  // Dedup by normalized user_message — bila contoh curated/log/correction
  // mengulang pertanyaan yang sama, simpan yang skornya lebih tinggi.
  const seen = new Map<string, UnifiedTrainingExample>();
  for (const ex of merged) {
    const key = normalize(ex.user_message);
    const prev = seen.get(key);
    if (!prev || ex.similarity > prev.similarity) seen.set(key, ex);
  }

  return Array.from(seen.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

function keywordToUnified(ex: KeywordExample, fakeSim: number): UnifiedTrainingExample {
  return {
    id: ex.id,
    source: "curated",
    user_message: ex.user_message,
    ideal_assistant_response: ex.ideal_assistant_response,
    intent: ex.intent,
    stage: ex.stage,
    similarity: fakeSim,
  };
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Cari contoh "jawaban buruk" yang serupa dengan pesan tamu saat ini.
 * Sumber:
 *   - `ai_conversation_logs` dengan `rating = 'bad'`
 *   - `wa_correction_dataset` dari percakapan WhatsApp asli
 */
export async function findNegativeExamples(
  supabase: SupabaseClient,
  userMessage: string,
  llmConfig: AiClientConfig | null,
  options: { limit?: number; minSimilarity?: number } = {},
): Promise<NegativeTrainingExample[]> {
  const trimmed = (userMessage ?? "").trim();
  if (!trimmed || !llmConfig?.apiKey) return [];
  const limit = options.limit ?? 2;
  if (limit <= 0) return [];
  const minSim = options.minSimilarity ?? DEFAULT_MIN_SIM;

  const queryEmbedding = await generateEmbedding(llmConfig, trimmed).catch(() => null);
  if (!queryEmbedding) return [];

  const [badLogRes, waCorrectionRes] = await Promise.allSettled([
    supabase.rpc("match_bad_training_examples", {
      query_embedding: queryEmbedding as unknown as string,
      match_threshold: minSim,
      match_count: limit,
    }),
    supabase.rpc("match_wa_correction_examples", {
      query_embedding: queryEmbedding as unknown as string,
      match_threshold: minSim,
      match_count: limit,
    }),
  ]);

  const merged: NegativeTrainingExample[] = [];

  if (badLogRes.status === "fulfilled" && Array.isArray(badLogRes.value.data)) {
    for (const r of badLogRes.value.data as Array<NegativeTrainingExample>) {
      merged.push({ ...r, source: "log" });
    }
  }

  if (waCorrectionRes.status === "fulfilled" && Array.isArray(waCorrectionRes.value.data)) {
    for (const r of waCorrectionRes.value.data as Array<NegativeTrainingExample>) {
      merged.push({ ...r, source: "wa_correction" });
    }
  }

  const seen = new Map<string, NegativeTrainingExample>();
  for (const ex of merged) {
    const key = normalize(`${ex.user_message}\n${ex.bad_response}`);
    const prev = seen.get(key);
    if (!prev || ex.similarity > prev.similarity) seen.set(key, ex);
  }

  return Array.from(seen.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Gabungan sinyal training (positif + negatif) yang dipakai autoreply.
 * Disatukan di satu helper supaya jalur retrieval mudah dilacak dan
 * orchestrator tidak perlu me-retrieve ulang bila `agentCtx.trainingExamples`
 * sudah terisi.
 */
export interface TrainingSignals {
  positiveExamples: UnifiedTrainingExample[];
  negativeExamples: NegativeTrainingExample[];
}

export async function findTrainingSignals(
  supabase: SupabaseClient,
  input: FindInput,
  llmConfig: AiClientConfig | null,
  options: {
    positiveLimit?: number;
    negativeLimit?: number;
    minSimilarity?: number;
  } = {},
): Promise<TrainingSignals> {
  const [positiveExamples, negativeExamples] = await Promise.all([
    findTrainingContext(supabase, input, llmConfig, {
      limit: options.positiveLimit,
      minSimilarity: options.minSimilarity,
    }),
    findNegativeExamples(supabase, input.userMessage, llmConfig, {
      limit: options.negativeLimit,
      minSimilarity: options.minSimilarity,
    }),
  ]);
  return { positiveExamples, negativeExamples };
}

/** Format contoh negatif sebagai blok teks untuk system prompt. */
export function formatNegativeExamplesBlock(examples: NegativeTrainingExample[]): string {
  if (examples.length === 0) return "";
  const lines = examples.map((ex, i) => {
    const meta = [
      ex.source === "wa_correction" ? "sumber: koreksi WhatsApp asli" : null,
      ex.correct_intent ? `intent benar: ${ex.correct_intent}` : null,
      ex.correct_agent ? `agent benar: ${ex.correct_agent}` : null,
      ex.error_type ? `jenis error: ${ex.error_type}` : null,
    ].filter(Boolean).join("; ");
    const parts = [
      `Contoh ${i + 1}${meta ? ` (${meta})` : ""}`,
      `Tamu: ${ex.user_message.trim()}`,
      `JANGAN balas seperti ini: ${ex.bad_response.trim()}`,
    ];
    if (ex.correction && ex.correction.trim()) {
      parts.push(`Balasan yang benar: ${ex.correction.trim()}`);
    }
    return parts.join("\n");
  });
  return [
    "CONTOH JAWABAN BURUK (admin sudah menandai 'bad' atau mengoreksi WhatsApp asli — JANGAN tiru gaya, isi, atau pendekatan ini):",
    ...lines,
  ].join("\n\n");
}
