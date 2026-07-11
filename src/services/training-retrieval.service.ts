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
  /** Ringkasan singkat atau 1–3 turn terakhir. Jangan kirim seluruh transkrip. */
  conversationContext?: string | null;
  roomType?: string | null;
}

interface FindOptions {
  limit?: number;
  curatedBoost?: number;
  correctionBoost?: number;
  minSimilarity?: number;
}

const DEFAULT_LIMIT = 3;
const DEFAULT_CURATED_BOOST = 0.10;
const DEFAULT_CORRECTION_BOOST = 0.12;
const DEFAULT_MIN_SIM = 0.72;
const INTENT_MATCH_BOOST = 0.12;
const STAGE_MATCH_BOOST = 0.08;
const INTENT_MISMATCH_PENALTY = 0.08;
const STAGE_MISMATCH_PENALTY = 0.04;
const MAX_CONTEXT_CHARS = 700;

function cleanMeta(value?: string | null): string | null {
  const cleaned = value?.trim().toLowerCase();
  return cleaned || null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Pesan pendek WhatsApp seperti "kalau deluxe" tidak cukup berdiri sendiri.
 * Query embedding diperkaya secara terbatas dengan konteks, intent, stage dan
 * tipe kamar aktif agar retrieval memahami turn lanjutan tanpa prompt bloat.
 */
function buildRetrievalQuery(input: FindInput): string {
  const parts = [`Pesan terbaru: ${(input.userMessage ?? "").trim()}`];
  const context = input.conversationContext?.trim().slice(0, MAX_CONTEXT_CHARS);
  if (context) parts.push(`Konteks percakapan: ${context}`);
  if (input.intent?.trim()) parts.push(`Intent aktif: ${input.intent.trim()}`);
  if (input.stage?.trim()) parts.push(`Tahap/topik aktif: ${input.stage.trim()}`);
  if (input.roomType?.trim()) parts.push(`Tipe kamar aktif: ${input.roomType.trim()}`);
  return parts.join("\n");
}

function rerankExample(
  ex: UnifiedTrainingExample,
  input: FindInput,
  sourceBoost: number,
): UnifiedTrainingExample {
  let score = ex.similarity + sourceBoost;
  const wantedIntent = cleanMeta(input.intent);
  const exampleIntent = cleanMeta(ex.intent);
  const wantedStage = cleanMeta(input.stage);
  const exampleStage = cleanMeta(ex.stage);

  if (wantedIntent && exampleIntent) {
    score += wantedIntent === exampleIntent ? INTENT_MATCH_BOOST : -INTENT_MISMATCH_PENALTY;
  }
  if (wantedStage && exampleStage) {
    score += wantedStage === exampleStage ? STAGE_MATCH_BOOST : -STAGE_MISMATCH_PENALTY;
  }

  return { ...ex, similarity: clampScore(score) };
}

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
  if (!userMsg || limit <= 0) return [];

  const retrievalQuery = buildRetrievalQuery(input);

  if (!llmConfig?.apiKey) {
    const kw = await findRelevantTrainingExamples(
      supabase,
      { userMessage: retrievalQuery, intent: input.intent, stage: input.stage },
      limit,
    );
    return kw.map((ex) => rerankExample(keywordToUnified(ex, 0.5), input, curatedBoost));
  }

  const queryEmbedding = await generateEmbedding(llmConfig, retrievalQuery).catch(() => null);
  if (!queryEmbedding) {
    const kw = await findRelevantTrainingExamples(
      supabase,
      { userMessage: retrievalQuery, intent: input.intent, stage: input.stage },
      limit,
    );
    return kw.map((ex) => rerankExample(keywordToUnified(ex, 0.5), input, curatedBoost));
  }

  // Ambil kandidat lebih banyak sebelum reranking agar contoh intent/stage yang
  // benar tidak tersingkir hanya karena selisih similarity yang sangat kecil.
  const candidateCount = Math.max(limit * 4, 8);
  const [curatedRes, logRes, correctionRes] = await Promise.allSettled([
    supabase.rpc("match_chatbot_training_examples", {
      query_embedding: queryEmbedding as unknown as string,
      match_threshold: minSim,
      match_count: candidateCount,
    }),
    supabase.rpc("match_training_examples", {
      query_embedding: queryEmbedding as unknown as string,
      match_threshold: minSim,
      match_count: candidateCount,
    }),
    supabase.rpc("match_wa_correction_ideal_examples", {
      query_embedding: queryEmbedding as unknown as string,
      match_threshold: minSim,
      match_count: candidateCount,
    }),
  ]);

  const merged: UnifiedTrainingExample[] = [];

  if (curatedRes.status === "fulfilled" && Array.isArray(curatedRes.value.data)) {
    for (const r of curatedRes.value.data as Array<{
      id: string; user_message: string; ideal_assistant_response: string;
      intent: string | null; stage: string | null; similarity: number;
    }>) {
      merged.push(rerankExample({
        id: r.id,
        source: "curated",
        user_message: r.user_message,
        ideal_assistant_response: r.ideal_assistant_response,
        intent: r.intent,
        stage: r.stage,
        similarity: r.similarity,
      }, input, curatedBoost));
    }
  }

  if (logRes.status === "fulfilled" && Array.isArray(logRes.value.data)) {
    for (const r of logRes.value.data as Array<{
      id: string; user_message: string; effective_answer: string; similarity: number;
    }>) {
      merged.push(rerankExample({
        id: r.id,
        source: "log",
        user_message: r.user_message,
        ideal_assistant_response: r.effective_answer,
        intent: null,
        stage: null,
        similarity: r.similarity,
      }, input, 0));
    }
  }

  if (correctionRes.status === "fulfilled" && Array.isArray(correctionRes.value.data)) {
    for (const r of correctionRes.value.data as Array<{
      id: string; user_message: string; ideal_assistant_response: string;
      intent: string | null; stage: string | null; similarity: number;
    }>) {
      merged.push(rerankExample({
        id: r.id,
        source: "correction",
        user_message: r.user_message,
        ideal_assistant_response: r.ideal_assistant_response,
        intent: r.intent,
        stage: r.stage,
        similarity: r.similarity,
      }, input, correctionBoost));
    }
  }

  // Pertanyaan yang sama boleh mempunyai contoh berbeda untuk intent/stage yang
  // berbeda. Dedup lama hanya memakai user_message dan menghapus konteks penting.
  const seen = new Map<string, UnifiedTrainingExample>();
  for (const ex of merged) {
    const key = [normalize(ex.user_message), cleanMeta(ex.intent) ?? "", cleanMeta(ex.stage) ?? ""].join("|");
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

export async function findNegativeExamples(
  supabase: SupabaseClient,
  userMessage: string,
  llmConfig: AiClientConfig | null,
  options: { limit?: number; minSimilarity?: number; conversationContext?: string | null } = {},
): Promise<NegativeTrainingExample[]> {
  const trimmed = (userMessage ?? "").trim();
  if (!trimmed || !llmConfig?.apiKey) return [];
  const limit = options.limit ?? 2;
  if (limit <= 0) return [];
  const minSim = options.minSimilarity ?? DEFAULT_MIN_SIM;
  const enrichedQuery = options.conversationContext?.trim()
    ? `${trimmed}\nKonteks percakapan: ${options.conversationContext.trim().slice(0, MAX_CONTEXT_CHARS)}`
    : trimmed;

  const queryEmbedding = await generateEmbedding(llmConfig, enrichedQuery).catch(() => null);
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
      merged.push({ ...r, source: "log", similarity: clampScore(r.similarity) });
    }
  }
  if (waCorrectionRes.status === "fulfilled" && Array.isArray(waCorrectionRes.value.data)) {
    for (const r of waCorrectionRes.value.data as Array<NegativeTrainingExample>) {
      merged.push({ ...r, source: "wa_correction", similarity: clampScore(r.similarity) });
    }
  }

  const seen = new Map<string, NegativeTrainingExample>();
  for (const ex of merged) {
    const key = normalize(`${ex.user_message}\n${ex.bad_response}`);
    const prev = seen.get(key);
    if (!prev || ex.similarity > prev.similarity) seen.set(key, ex);
  }
  return Array.from(seen.values()).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

export interface TrainingSignals {
  positiveExamples: UnifiedTrainingExample[];
  negativeExamples: NegativeTrainingExample[];
}

export async function findTrainingSignals(
  supabase: SupabaseClient,
  input: FindInput,
  llmConfig: AiClientConfig | null,
  options: { positiveLimit?: number; negativeLimit?: number; minSimilarity?: number } = {},
): Promise<TrainingSignals> {
  const [positiveExamples, negativeExamples] = await Promise.all([
    findTrainingContext(supabase, input, llmConfig, {
      limit: options.positiveLimit,
      minSimilarity: options.minSimilarity,
    }),
    findNegativeExamples(supabase, input.userMessage, llmConfig, {
      limit: options.negativeLimit,
      minSimilarity: options.minSimilarity,
      conversationContext: input.conversationContext,
    }),
  ]);
  return { positiveExamples, negativeExamples };
}

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
    if (ex.correction?.trim()) parts.push(`Balasan yang benar: ${ex.correction.trim()}`);
    return parts.join("\n");
  });
  return [
    "CONTOH JAWABAN BURUK (jangan tiru gaya, isi, atau pendekatannya):",
    ...lines,
  ].join("\n\n");
}
