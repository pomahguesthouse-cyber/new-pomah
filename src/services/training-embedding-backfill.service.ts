/**
 * Backfill embedding untuk empat sumber training dan dokumen SOP.
 * Dipakai cron `/api/cron/backfill-training-embeddings` dan tombol admin.
 * Tidak melempar bila satu baris gagal — baris itu tetap NULL dan dicoba lagi.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fillNullSopChunkEmbeddings, processSopDocumentChunks } from "@/ai/rag.service";
import {
  embedTrainingExample,
  embedWaCorrectionExample,
  embedWaCorrectionSession,
} from "@/ai/training-rag.service";
import { loadTrainingAiConfig } from "@/services/training-ai-config";
import {
  BACKFILL_ROW_LIMIT,
  embedInline,
  isIndexableSopDocument,
  isSkippedEmbedReason,
  selectBackfillBatch,
  selectSopReindexBatch,
  SOP_BACKFILL_DOC_LIMIT,
  sopNeedsReindex,
  sopReindexMode,
  type BackfillCandidate,
  type EmbeddingSource,
  type SopIndexSnapshot,
} from "@/services/training-embedding";

const RUN_BUDGET_MS = 22_000;
const TRAINING_WINDOW_MS = 12_000;
const ROW_TIMEOUT_MS = 8_000;

export interface TrainingBackfillCounts {
  checked: number;
  embedded: number;
  failed: number;
  sources: Record<string, { checked: number; embedded: number; failed: number }>;
}

export interface TrainingIndexSource {
  key: EmbeddingSource | "sop";
  label: string;
  active: number;
  indexed: number;
}

const SOURCE_LABELS: Record<TrainingIndexSource["key"], string> = {
  curated: "Contoh kurasi",
  log: "Log percakapan",
  correction: "Koreksi WhatsApp",
  session: "Sesi koreksi",
  sop: "Dokumen SOP",
};

type LooseClient = SupabaseClient & {
  from: (table: string) => any;
};

function emptyCounts(): TrainingBackfillCounts {
  return {
    checked: 0,
    embedded: 0,
    failed: 0,
    sources: {
      curated: { checked: 0, embedded: 0, failed: 0 },
      log: { checked: 0, embedded: 0, failed: 0 },
      correction: { checked: 0, embedded: 0, failed: 0 },
      session: { checked: 0, embedded: 0, failed: 0 },
      sop: { checked: 0, embedded: 0, failed: 0 },
    },
  };
}

function add(total: TrainingBackfillCounts, source: string, outcome: "embedded" | "failed") {
  const bucket = total.sources[source] ?? { checked: 0, embedded: 0, failed: 0 };
  total.sources[source] = bucket;
  total.checked += 1;
  bucket.checked += 1;
  if (outcome === "embedded") {
    total.embedded += 1;
    bucket.embedded += 1;
  } else {
    total.failed += 1;
    bucket.failed += 1;
  }
}

export async function runTrainingEmbeddingBackfill(
  supabase: SupabaseClient,
  options: { rowLimit?: number; sopLimit?: number; budgetMs?: number } = {},
): Promise<TrainingBackfillCounts> {
  const client = supabase as LooseClient;
  const counts = emptyCounts();
  const rowLimit = options.rowLimit ?? BACKFILL_ROW_LIMIT;
  const sopLimit = options.sopLimit ?? SOP_BACKFILL_DOC_LIMIT;
  const started = Date.now();
  const budgetMs = options.budgetMs ?? RUN_BUDGET_MS;
  const deadline = started + budgetMs;
  const remaining = () => deadline - Date.now();

  let config: Awaited<ReturnType<typeof loadTrainingAiConfig>> = null;
  try {
    config = await loadTrainingAiConfig();
  } catch (error) {
    console.error("[training-backfill] gagal memuat konfigurasi AI:", error);
  }
  if (!config) {
    console.error("[training-backfill] tidak ada API key; embedding dibiarkan NULL");
  }

  const trainingDeadline = started + Math.min(TRAINING_WINDOW_MS, budgetMs);
  try {
    const candidates = selectBackfillBatch(await loadTrainingCandidates(client, rowLimit), rowLimit);
    for (const candidate of candidates) {
      if (Date.now() >= trainingDeadline || remaining() < 1_000) break;
      if (!config) {
        add(counts, candidate.source, "failed");
        continue;
      }
      const timeoutMs = Math.min(ROW_TIMEOUT_MS, remaining());
      const embedded = await embedInline(
        `${candidate.source}:${candidate.id}`,
        (signal) => embedCandidate(client, candidate, config!, signal),
        timeoutMs,
      );
      add(counts, candidate.source, embedded ? "embedded" : "failed");
    }
  } catch (error) {
    console.error("[training-backfill] pemilihan baris training gagal:", error);
  }

  try {
    const sopDocs = selectSopReindexBatch(await loadSopSnapshots(client), sopLimit);
    for (const doc of sopDocs) {
      if (remaining() < 1_000) break;
      if (!config) {
        add(counts, "sop", "failed");
        continue;
      }
      const embedded = await embedInline(
        `sop:${doc.id}`,
        async (signal) => {
          const result = sopReindexMode(doc) === "missing"
            ? await fillNullSopChunkEmbeddings(client, doc.id, config!, { signal })
            : await processSopDocumentChunks(
              client,
              doc.id,
              doc.content ?? "",
              null,
              config!,
              { signal },
            );
          if (!result.complete || result.failed > 0) {
            console.error(
              `[training-backfill] sop ${doc.id} incomplete embedded=${result.embedded} failed=${result.failed}`,
            );
            return false;
          }
          return result.embedded > 0 || result.complete;
        },
        Math.max(1_000, remaining()),
      );
      add(counts, "sop", embedded ? "embedded" : "failed");
    }
  } catch (error) {
    console.error("[training-backfill] pemilihan dokumen SOP gagal:", error);
  }

  console.info(
    `[training-backfill] checked=${counts.checked} embedded=${counts.embedded} failed=${counts.failed}`,
  );
  return counts;
}

export async function summarizeTrainingIndex(supabase: SupabaseClient): Promise<TrainingIndexSource[]> {
  const client = supabase as LooseClient;
  const [curated, logs, corrections, sessions, sop] = await Promise.all([
    countPair(client, "chatbot_training_examples", (query) => query.eq("is_active", true)),
    countPair(client, "ai_conversation_logs", (query) => query.eq("rating", "good").eq("used", true)),
    countPair(client, "wa_correction_dataset", (query) => query.eq("status", "approved")),
    countPair(client, "wa_correction_sessions", (query) => query.eq("status", "approved")),
    countSop(client),
  ]);
  return [curated, logs, corrections, sessions, sop].map((row) => ({
    ...row,
    label: SOURCE_LABELS[row.key],
  }));
}

async function embedCandidate(
  supabase: LooseClient,
  candidate: BackfillCandidate,
  config: NonNullable<Awaited<ReturnType<typeof loadTrainingAiConfig>>>,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    if (candidate.source === "curated") {
      return await embedCuratedCandidate(supabase, candidate.id, config, signal);
    }
    const result = candidate.source === "log"
      ? await embedTrainingExample(supabase, candidate.id, config, { signal })
      : candidate.source === "correction"
        ? await embedWaCorrectionExample(supabase, candidate.id, config, { signal })
        : await embedWaCorrectionSession(supabase, candidate.id, config, { signal });
    if (result.ok) return true;
    if (isSkippedEmbedReason(result.reason)) return false;
    console.error(`[training-backfill] ${candidate.source} ${candidate.id}: ${result.reason ?? "failed"}`);
    return false;
  } catch (error) {
    console.error(`[training-backfill] ${candidate.source} ${candidate.id} threw:`, error);
    return false;
  }
}

async function embedCuratedCandidate(
  supabase: LooseClient,
  id: string,
  config: NonNullable<Awaited<ReturnType<typeof loadTrainingAiConfig>>>,
  signal: AbortSignal,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("chatbot_training_examples")
    .select("id, user_message, ideal_assistant_response, is_active")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    console.error(`[training-backfill] curated ${id}: ${error?.message ?? "not-found"}`);
    return false;
  }
  const row = data as {
    user_message?: string | null;
    ideal_assistant_response?: string | null;
    is_active?: boolean | null;
  };
  if (row.is_active === false) return false;
  const { generateEmbedding } = await import("@/ai/embedding.service");
  const { buildCuratedEmbeddingText, writeEmbedding } = await import("@/services/training-embedding");
  const text = buildCuratedEmbeddingText(row.user_message ?? "", row.ideal_assistant_response ?? "");
  if (!text.replace(/Tamu:|Asisten:/g, "").trim()) return false;
  const embedding = await generateEmbedding(config, text, { signal });
  if (!embedding) {
    console.error(`[training-backfill] curated ${id}: embedding-failed`);
    return false;
  }
  const written = await writeEmbedding(supabase, "chatbot_training_examples", id, embedding);
  if (!written.ok) console.error(`[training-backfill] curated ${id}: ${written.reason ?? "write-failed"}`);
  return written.ok;
}

async function loadTrainingCandidates(supabase: LooseClient, limit: number): Promise<BackfillCandidate[]> {
  const scan = Math.max(limit, 40);
  const [curated, logs, corrections, sessions] = await Promise.all([
    selectNullRows(supabase, "curated", "chatbot_training_examples", scan, (query) => query.eq("is_active", true)),
    selectNullRows(supabase, "log", "ai_conversation_logs", scan, (query) =>
      query.eq("rating", "good").eq("used", true),
    ),
    selectNullRows(supabase, "correction", "wa_correction_dataset", scan, (query) => query.eq("status", "approved")),
    selectSessionCandidates(supabase, scan),
  ]);
  return [...curated, ...logs, ...corrections, ...sessions];
}

async function selectNullRows(
  supabase: LooseClient,
  source: EmbeddingSource,
  table: string,
  limit: number,
  filter: (query: any) => any,
): Promise<BackfillCandidate[]> {
  try {
    let query = supabase
      .from(table)
      .select("id, created_at")
      .is("embedding", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    query = filter(query);
    const { data, error } = await query;
    if (error) {
      console.error(`[training-backfill] query ${table} gagal:`, error.message);
      return [];
    }
    return ((data ?? []) as Array<{ id?: string; created_at?: string | null }>).map((row) => ({
      source,
      id: String(row.id ?? ""),
      createdAt: row.created_at ?? "",
    }));
  } catch (error) {
    console.error(`[training-backfill] query ${table} threw:`, error);
    return [];
  }
}

async function selectSessionCandidates(supabase: LooseClient, limit: number): Promise<BackfillCandidate[]> {
  try {
    const { data, error } = await supabase
      .from("wa_correction_sessions")
      .select("id, created_at, corrected_transcript")
      .eq("status", "approved")
      .is("embedding", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) {
      console.error("[training-backfill] query wa_correction_sessions gagal:", error.message);
      return [];
    }
    const { isEmptyCorrectedTranscript } = await import("@/services/training-embedding");
    return ((data ?? []) as Array<{ id?: string; created_at?: string | null; corrected_transcript?: unknown }>)
      .filter((row) => !isEmptyCorrectedTranscript(row.corrected_transcript))
      .map((row) => ({
        source: "session" as const,
        id: String(row.id ?? ""),
        createdAt: row.created_at ?? "",
      }));
  } catch (error) {
    console.error("[training-backfill] query wa_correction_sessions threw:", error);
    return [];
  }
}

async function loadSopSnapshots(supabase: LooseClient): Promise<SopIndexSnapshot[]> {
  const docs = await selectSopDocuments(supabase);
  if (docs.length === 0) return [];
  const ids = docs.map((doc) => doc.id);
  let chunkRows: Array<{ document_id?: string; created_at?: string | null }> = [];
  let nullRows: Array<{ document_id?: string }> = [];
  try {
    const [allChunks, nullChunks] = await Promise.all([
      supabase.from("sop_chunks").select("document_id, created_at").in("document_id", ids),
      supabase.from("sop_chunks").select("document_id").in("document_id", ids).is("embedding", null),
    ]);
    if (allChunks.error || nullChunks.error) {
      console.error(
        "[training-backfill] agregat sop_chunks gagal:",
        allChunks.error?.message ?? nullChunks.error?.message,
      );
      return docs.map((doc) => ({ ...doc, chunkCount: -1, nullEmbeddingChunkCount: 0, newestChunkAt: null }));
    }
    chunkRows = (allChunks.data ?? []) as typeof chunkRows;
    nullRows = (nullChunks.data ?? []) as typeof nullRows;
  } catch (error) {
    console.error("[training-backfill] agregat sop_chunks threw:", error);
    return docs.map((doc) => ({ ...doc, chunkCount: -1, nullEmbeddingChunkCount: 0, newestChunkAt: null }));
  }

  const byDoc = new Map<string, { count: number; newest: string | null }>();
  for (const row of chunkRows) {
    const id = String(row.document_id ?? "");
    const current = byDoc.get(id) ?? { count: 0, newest: null };
    current.count += 1;
    if (row.created_at && (!current.newest || row.created_at > current.newest)) current.newest = row.created_at;
    byDoc.set(id, current);
  }
  const nullCounts = new Map<string, number>();
  for (const row of nullRows) {
    const id = String(row.document_id ?? "");
    nullCounts.set(id, (nullCounts.get(id) ?? 0) + 1);
  }
  return docs.map((doc) => {
    const stats = byDoc.get(doc.id);
    return {
      ...doc,
      chunkCount: stats?.count ?? 0,
      nullEmbeddingChunkCount: nullCounts.get(doc.id) ?? 0,
      newestChunkAt: stats?.newest ?? null,
    };
  });
}

async function selectSopDocuments(
  supabase: LooseClient,
): Promise<Array<Omit<SopIndexSnapshot, "chunkCount" | "nullEmbeddingChunkCount" | "newestChunkAt">>> {
  const columns = "id, content, doc_category, created_at, updated_at";
  const first = await supabase.from("sop_documents").select(columns).order("created_at", { ascending: true });
  let rows = first.data as Array<Record<string, unknown>> | null;
  let error = first.error as { message?: string; code?: string } | null;
  if (error && /updated_at/i.test(error.message ?? "")) {
    const second = await supabase
      .from("sop_documents")
      .select("id, content, doc_category, created_at")
      .order("created_at", { ascending: true });
    rows = second.data as Array<Record<string, unknown>> | null;
    error = second.error;
  }
  if (error) {
    console.error("[training-backfill] query sop_documents gagal:", error.message);
    return [];
  }
  return ((rows ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      id: String(row.id ?? ""),
      content: (row.content as string | null) ?? null,
      docCategory: (row.doc_category as string | null) ?? null,
      createdAt: (row.created_at as string | null) ?? "",
      updatedAt: (row.updated_at as string | null) ?? null,
    }))
    .filter((row) => row.id && isIndexableSopDocument(row));
}

async function countPair(
  supabase: LooseClient,
  table: string,
  filter: (query: any) => any,
): Promise<Omit<TrainingIndexSource, "label">> {
  const key = tableKey(table);
  const active = await headCount(filter(supabase.from(table).select("id", { count: "exact", head: true })));
  const indexed = await headCount(
    filter(supabase.from(table).select("id", { count: "exact", head: true })).not("embedding", "is", null),
  );
  return { key, active, indexed };
}

async function countSop(supabase: LooseClient): Promise<Omit<TrainingIndexSource, "label">> {
  try {
    const docs = await loadSopSnapshots(supabase);
    const activeDocs = docs.filter((doc) => isIndexableSopDocument(doc));
    const indexed = activeDocs.filter((doc) => doc.chunkCount >= 0 && !sopNeedsReindex(doc)).length;
    return { key: "sop", active: activeDocs.length, indexed };
  } catch (error) {
    console.error("[training-backfill] ringkasan SOP gagal:", error);
    return { key: "sop", active: 0, indexed: 0 };
  }
}

function tableKey(table: string): TrainingIndexSource["key"] {
  if (table === "chatbot_training_examples") return "curated";
  if (table === "ai_conversation_logs") return "log";
  if (table === "wa_correction_dataset") return "correction";
  return "session";
}

async function headCount(query: PromiseLike<{ count: number | null; error: { message?: string } | null }>): Promise<number> {
  try {
    const { count, error } = await query;
    if (error) {
      console.error("[training-index] count gagal:", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (error) {
    console.error("[training-index] count threw:", error);
    return 0;
  }
}

export const TRAINING_INDEX_LABELS = SOURCE_LABELS;
