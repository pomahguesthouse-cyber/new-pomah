/**
 * Unified training retrieval — gabungkan dua sumber contoh latihan:
 *   1) `chatbot_training_examples` (curated JSONL) → bobot lebih tinggi
 *   2) `ai_conversation_logs` (rating='good' admin) → bobot normal
 *
 * Strategi:
 *   - Bila API key embedding tersedia → query vector ke kedua tabel
 *     secara paralel via RPC, gabungkan, dedup, beri curated boost,
 *     ambil top-K.
 *   - Bila tidak ada API key → fallback keyword overlap pada
 *     `chatbot_training_examples` (legacy path).
 *
 * Output kompatibel dengan struktur `AgentContext.trainingExamples`
 * yang sudah dipakai `front-office.agent.ts`, jadi cukup satu blok
 * "CONTOH PERCAKAPAN BENAR" di system prompt.
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
  source: "curated" | "log";
  user_message: string;
  ideal_assistant_response: string;
  intent: string | null;
  stage: string | null;
  similarity: number;
}

export interface NegativeTrainingExample {
  id: string;
  user_message: string;
  bad_response: string;
  correction: string | null;
  similarity: number;
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
  /** Threshold kemiripan minimum untuk RPC vector (0..1). */
  minSimilarity?: number;
}

const DEFAULT_LIMIT = 3;
const DEFAULT_CURATED_BOOST = 0.10;
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
  const minSim = options.minSimilarity ?? DEFAULT_MIN_SIM;

  const userMsg = (input.userMessage ?? "").trim();
  if (!userMsg) return [];

  // ── Fallback path: tanpa API key, pakai keyword overlap ke curated saja.
  if (!llmConfig?.apiKey) {
    const kw = await findRelevantTrainingExamples(supabase, input, limit);
    return kw.map((ex) => keywordToUnified(ex, 0.5));
  }

  // ── Hybrid path: embed query sekali, lalu query dua RPC paralel.
  const queryEmbedding = await generateEmbedding(llmConfig, userMsg).catch(() => null);
  if (!queryEmbedding) {
    // Embedding gagal — degrade ke keyword agar bot tetap punya contoh.
    const kw = await findRelevantTrainingExamples(supabase, input, limit);
    return kw.map((ex) => keywordToUnified(ex, 0.5));
  }

  const [curatedRes, logRes] = await Promise.allSettled([
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

  // Dedup by normalized user_message — bila contoh curated & log mengulang
  // pertanyaan yang sama, simpan yang skornya lebih tinggi (curated menang
  // karena sudah dapat boost).
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
 * Sumber: `ai_conversation_logs` dengan `rating = 'bad'`. Bila admin
 * sudah memberi `correction`, sertakan agar agent tahu jawaban yang
 * benar untuk konteks tersebut.
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
  const minSim = options.minSimilarity ?? DEFAULT_MIN_SIM;

  const queryEmbedding = await generateEmbedding(llmConfig, trimmed).catch(() => null);
  if (!queryEmbedding) return [];

  try {
    const { data, error } = await supabase.rpc("match_bad_training_examples", {
      query_embedding: queryEmbedding as unknown as string,
      match_threshold: minSim,
      match_count: limit,
    });
    if (error || !Array.isArray(data)) return [];
    return (data as NegativeTrainingExample[]) ?? [];
  } catch {
    return [];
  }
}

/** Format contoh negatif sebagai blok teks untuk system prompt. */
export function formatNegativeExamplesBlock(examples: NegativeTrainingExample[]): string {
  if (examples.length === 0) return "";
  const lines = examples.map((ex, i) => {
    const parts = [
      `Contoh ${i + 1}`,
      `Tamu: ${ex.user_message.trim()}`,
      `JANGAN balas seperti ini: ${ex.bad_response.trim()}`,
    ];
    if (ex.correction && ex.correction.trim()) {
      parts.push(`Balasan yang benar: ${ex.correction.trim()}`);
    }
    return parts.join("\n");
  });
  return [
    "CONTOH JAWABAN BURUK (admin sudah menandai 'bad' — JANGAN tiru gaya, isi, atau pendekatan ini):",
    ...lines,
    "Bila konteks tamu mirip dengan contoh di atas, hindari pola jawaban tersebut. Bila ada 'Balasan yang benar', ikuti pendekatan itu.",
  ].join("\n\n");
}
