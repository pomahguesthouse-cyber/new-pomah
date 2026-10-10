/**
 * Teks embedding, pemilihan batch, dan helper tulis yang dipakai
 * jalur simpan maupun cron backfill. Modul ini tidak membuka koneksi
 * database supaya bisa diuji tanpa Supabase.
 *
 * Kolom `embedding_updated_at` / `updated_at` boleh belum ada. Penulisan
 * mengulang tanpa kolom itu alih-alih menggagalkan simpan.
 */

export const INLINE_EMBED_TIMEOUT_MS = 12_000;
export const BACKFILL_ROW_LIMIT = 25;
export const SOP_BACKFILL_DOC_LIMIT = 2;
export const SESSION_IDEAL_MAX_CHARS = 3500;

const SKIPPED_EMBED_REASONS = new Set(["empty-content", "not-approved", "not-eligible", "inactive"]);

export type EmbedOutcome = { ok: boolean; reason?: string };

export type PostgrestErrorLike = { message?: string; code?: string | null } | null;

export type EmbeddingSource = "curated" | "log" | "correction" | "session";

export interface BackfillCandidate {
  source: EmbeddingSource;
  id: string;
  createdAt: string;
}

export interface SopIndexSnapshot {
  id: string;
  content: string | null;
  docCategory: string | null;
  createdAt: string;
  /** Null bila kolom belum ada atau nilainya kosong. */
  updatedAt: string | null;
  /** -1 = agregat chunk tidak terbaca; jangan hapus chunk yang ada. */
  chunkCount: number;
  nullEmbeddingChunkCount: number;
  newestChunkAt: string | null;
}

type LooseUpdate = {
  from: (table: string) => {
    update: (patch: Record<string, unknown>) => {
      eq: (column: string, value: string) => PromiseLike<{ error: PostgrestErrorLike }>;
    };
  };
};

export function isMissingColumnError(error: PostgrestErrorLike, column: string): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  const code = error.code ?? "";
  const name = column.toLowerCase();
  if (!message.includes(name) && code !== "42703" && code !== "PGRST204") return false;
  return (
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("does not exist") ||
    message.includes("could not find") ||
    message.includes("schema cache")
  );
}

export function isSkippedEmbedReason(reason: string | undefined): boolean {
  return !!reason && SKIPPED_EMBED_REASONS.has(reason);
}

/** Contoh kurasi: pasangan tamu + jawaban ideal. */
export function buildCuratedEmbeddingText(userMessage: string, idealResponse: string): string {
  return `Tamu: ${(userMessage ?? "").trim()}\nAsisten: ${(idealResponse ?? "").trim()}`;
}

/** Log percakapan. `effectiveAnswer` sudah memilih correction bila ada. */
export function buildLogEmbeddingText(userMessage: string, effectiveAnswer: string): string {
  const question = (userMessage ?? "").trim().slice(0, 1500);
  const answer = (effectiveAnswer ?? "").trim().slice(0, 2500);
  return `Tamu: ${question}\nAsisten: ${answer}`;
}

export function effectiveLogAnswer(
  correction: string | null | undefined,
  aiResponse: string | null | undefined,
): string {
  const corrected = correction?.trim() ?? "";
  if (corrected) return corrected;
  return (aiResponse ?? "").trim();
}

/** Koreksi WhatsApp: pertanyaan, jawaban salah, dan jawaban ideal. */
export function buildCorrectionEmbeddingText(
  userMessage: string,
  badReply: string,
  idealReply: string,
): string {
  const question = (userMessage ?? "").trim().slice(0, 1500);
  const bad = (badReply ?? "").trim().slice(0, 1200);
  const ideal = (idealReply ?? "").trim().slice(0, 2500);
  return [
    `Tamu: ${question}`,
    bad ? `Jawaban salah yang pernah terjadi: ${bad}` : "",
    `Jawaban benar: ${ideal}`,
  ].filter(Boolean).join("\n");
}

/**
 * Setara dengan teks yang `match_wa_correction_ideal_examples` jadikan
 * contoh sesi. RPC membaca kolom `wa_correction_sessions.embedding` dan
 * menyusun:
 *   user_message = COALESCE(conversation_summary, title, 'Contoh percakapan WhatsApp terkoreksi')
 *   ideal        = LEFT(COALESCE(
 *                    conversation_summary || E'\n\nTranscript terkoreksi:\n' || corrected_transcript::text,
 *                    corrected_transcript::text
 *                  ), 3500)
 * String jsonb di aplikasi memakai JSON.stringify, padanan `::text`.
 * Baris transcript kosong mengembalikan "" supaya embedding dibiarkan NULL.
 */
export function buildSessionEmbeddingText(input: {
  conversationSummary?: string | null;
  title?: string | null;
  correctedTranscript?: unknown;
}): string {
  if (isEmptyCorrectedTranscript(input.correctedTranscript)) return "";
  const summary = nullableText(input.conversationSummary);
  const title = nullableText(input.title);
  const transcriptText = correctedTranscriptDbText(input.correctedTranscript);
  const userMessage = summary || title || "Contoh percakapan WhatsApp terkoreksi";
  const idealBody = summary
    ? `${summary}\n\nTranscript terkoreksi:\n${transcriptText}`
    : transcriptText;
  const ideal = idealBody.slice(0, SESSION_IDEAL_MAX_CHARS);
  return `Tamu: ${userMessage}\nAsisten: ${ideal}`;
}

export function correctedTranscriptDbText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function isEmptyCorrectedTranscript(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 || trimmed === "[]" || trimmed === "null";
  }
  return false;
}

export function isIndexableSopDocument(doc: {
  content?: string | null;
  docCategory?: string | null;
}): boolean {
  if ((doc.docCategory ?? "").trim().toLowerCase() === "brosur") return false;
  return (doc.content ?? "").trim().length > 0;
}

/**
 * `full` menulis ulang semua chunk (belum ada, atau isi dokumen lebih baru).
 * `missing` hanya mengisi chunk yang embedding-nya NULL, supaya proses yang
 * terputus tidak membuang vektor yang sudah jadi.
 */
export function sopReindexMode(doc: SopIndexSnapshot): "full" | "missing" | null {
  if (!isIndexableSopDocument(doc)) return null;
  if (doc.chunkCount < 0) return null;
  if (doc.chunkCount === 0) return "full";
  if (doc.updatedAt && doc.newestChunkAt) {
    const updated = Date.parse(doc.updatedAt);
    const newestChunk = Date.parse(doc.newestChunkAt);
    if (Number.isFinite(updated) && Number.isFinite(newestChunk) && updated > newestChunk) return "full";
  }
  if (doc.nullEmbeddingChunkCount > 0) return "missing";
  return null;
}

/** Dokumen aktif yang belum punya chunk, chunk-nya kosong vektornya, atau isinya lebih baru. */
export function sopNeedsReindex(doc: SopIndexSnapshot): boolean {
  return sopReindexMode(doc) !== null;
}

export function selectBackfillBatch(
  rows: BackfillCandidate[],
  limit = BACKFILL_ROW_LIMIT,
): BackfillCandidate[] {
  return rows
    .filter((row) => row.id.trim().length > 0)
    .sort((a, b) => {
      const aTime = Date.parse(a.createdAt);
      const bTime = Date.parse(b.createdAt);
      const aValue = Number.isFinite(aTime) ? aTime : Number.POSITIVE_INFINITY;
      const bValue = Number.isFinite(bTime) ? bTime : Number.POSITIVE_INFINITY;
      if (aValue !== bValue) return aValue - bValue;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, Math.max(0, limit));
}

export function selectSopReindexBatch(
  docs: SopIndexSnapshot[],
  limit = SOP_BACKFILL_DOC_LIMIT,
): SopIndexSnapshot[] {
  return docs
    .filter((doc) => sopNeedsReindex(doc))
    .sort((a, b) => {
      const aTime = Date.parse(a.createdAt);
      const bTime = Date.parse(b.createdAt);
      const aValue = Number.isFinite(aTime) ? aTime : Number.POSITIVE_INFINITY;
      const bValue = Number.isFinite(bTime) ? bTime : Number.POSITIVE_INFINITY;
      if (aValue !== bValue) return aValue - bValue;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Menjalankan embedding inline. Timeout atau exception tidak dilempar:
 * pemanggil sudah menyimpan baris, dan cron mengisi embedding yang tetap NULL.
 */
export async function embedInline(
  label: string,
  task: (signal: AbortSignal) => Promise<boolean>,
  timeoutMs = INLINE_EMBED_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      task(controller.signal).then(
        (embedded) => ({ done: true as const, embedded }),
        (error: unknown) => ({ done: true as const, embedded: false, error }),
      ),
      new Promise<{ done: false }>((resolve) => {
        timer = setTimeout(() => resolve({ done: false }), timeoutMs);
      }),
    ]);
    if (!result.done) {
      controller.abort();
      console.warn(
        `[training-embed] ${label} timed out after ${timeoutMs}ms; embedding left null for backfill`,
      );
      return false;
    }
    if ("error" in result && result.error) {
      console.warn(`[training-embed] ${label} failed; save kept:`, result.error);
      return false;
    }
    return result.embedded;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function updateRowTolerant(
  update: (patch: Record<string, unknown>) => PromiseLike<{ error: PostgrestErrorLike }>,
  patch: Record<string, unknown>,
  optionalColumns: string[] = ["embedding_updated_at", "updated_at"],
): Promise<void> {
  let current = { ...patch };
  for (;;) {
    const { error } = await update(current);
    if (!error) return;
    const missing = optionalColumns.find(
      (column) =>
        Object.prototype.hasOwnProperty.call(current, column) && isMissingColumnError(error, column),
    );
    if (!missing) throw error;
    const next = { ...current };
    delete next[missing];
    current = next;
  }
}

export async function writeEmbedding(
  supabase: LooseUpdate,
  table: string,
  id: string,
  embedding: number[] | null,
): Promise<EmbedOutcome> {
  try {
    const patch: Record<string, unknown> = {
      embedding: embedding as unknown as string,
      embedding_updated_at: embedding ? new Date().toISOString() : null,
    };
    await updateRowTolerant(
      (next) => supabase.from(table).update(next).eq("id", id),
      patch,
      ["embedding_updated_at"],
    );
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error
      ? error.message
      : (error as { message?: string } | null)?.message ?? String(error);
    return { ok: false, reason };
  }
}

export async function clearEmbedding(
  supabase: LooseUpdate,
  table: string,
  id: string,
): Promise<EmbedOutcome> {
  return writeEmbedding(supabase, table, id, null);
}

function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}
