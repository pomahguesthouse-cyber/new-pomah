import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkText } from "./chunking.service";
import { generateEmbedding } from "./embedding.service";
import type { AiClientConfig } from "./types";

/**
 * Re-processes a SOP document by chunking its content, generating embeddings,
 * and saving them to the sop_chunks table.
 */
export async function processSopDocumentChunks(
  supabase: SupabaseClient,
  documentId: string,
  content: string,
  sourceUrl: string | null,
  llmConfig: AiClientConfig,
  options?: { signal?: AbortSignal },
): Promise<{ embedded: number; failed: number; complete: boolean }> {
  // 1. Delete existing chunks for this document
  await supabase.from("sop_chunks").delete().eq("document_id", documentId);

  if (!content.trim()) return { embedded: 0, failed: 0, complete: true };

  // 2. Chunk the text
  const chunks = chunkText(content, { maxLength: 800, overlap: 100 });

  // 3. Generate embeddings and save. A failed or skipped vector is stored as
  // NULL so a later run can fill it without deleting chunks that already
  // succeeded. Aborting mid-document still records the unread tail.
  let embedded = 0;
  let failed = 0;
  let aborted = false;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (options?.signal?.aborted) {
      aborted = true;
      failed += await insertPlainSopChunks(supabase, documentId, sourceUrl, chunks.slice(index));
      break;
    }
    const embedding = await generateEmbedding(llmConfig, chunk, { signal: options?.signal });
    if (options?.signal?.aborted && !embedding) {
      aborted = true;
      failed += await insertPlainSopChunks(supabase, documentId, sourceUrl, chunks.slice(index));
      break;
    }
    const { error } = await supabase.from("sop_chunks").insert({
      document_id: documentId,
      content: chunk,
      source_url: sourceUrl,
      embedding: embedding ?? null,
    });
    if (error) {
      console.error(`[RAG] Chunk insert failed for doc ${documentId}:`, error);
      failed += 1;
      aborted = true;
      break;
    }
    if (!embedding) failed += 1;
    else embedded += 1;
  }

  if (aborted) {
    console.warn(`[RAG] Chunking doc ${documentId} stopped early; remaining chunks left for backfill`);
  }
  return { embedded, failed, complete: !aborted && failed === 0 };
}

async function insertPlainSopChunks(
  supabase: SupabaseClient,
  documentId: string,
  sourceUrl: string | null,
  chunks: string[],
): Promise<number> {
  let failed = 0;
  for (const chunk of chunks) {
    const { error } = await supabase.from("sop_chunks").insert({
      document_id: documentId,
      content: chunk,
      source_url: sourceUrl,
      embedding: null,
    });
    if (error) {
      console.error(`[RAG] Null chunk insert failed for doc ${documentId}:`, error);
      failed += 1;
    } else {
      failed += 1;
    }
  }
  return Math.max(failed, chunks.length > 0 ? 1 : 0);
}

/** Isi chunk yang sudah ada tetapi embedding-nya masih NULL. Tidak menghapus chunk lain. */
export async function fillNullSopChunkEmbeddings(
  supabase: SupabaseClient,
  documentId: string,
  llmConfig: AiClientConfig,
  options?: { signal?: AbortSignal },
): Promise<{ embedded: number; failed: number; complete: boolean }> {
  const { data, error } = await supabase
    .from("sop_chunks")
    .select("id, content")
    .eq("document_id", documentId)
    .is("embedding", null);
  if (error) {
    console.error(`[RAG] Null chunk query failed for doc ${documentId}:`, error);
    return { embedded: 0, failed: 1, complete: false };
  }
  const rows = (data ?? []) as Array<{ id: string; content: string }>;
  let embedded = 0;
  let failed = 0;
  for (const row of rows) {
    if (options?.signal?.aborted) {
      return { embedded, failed: failed + 1, complete: false };
    }
    const embedding = await generateEmbedding(llmConfig, row.content, { signal: options?.signal });
    if (!embedding) {
      failed += 1;
      continue;
    }
    const updated = await supabase.from("sop_chunks").update({ embedding }).eq("id", row.id);
    if (updated.error) {
      console.error(`[RAG] Null chunk update failed for doc ${documentId}:`, updated.error);
      failed += 1;
    } else {
      embedded += 1;
    }
  }
  return { embedded, failed, complete: failed === 0 };
}

/**
 * Retrieves the most relevant SOP chunks for a given query.
 */
export async function retrieveRelevantSopContext(
  supabaseAdmin: SupabaseClient,
  query: string,
  llmConfig: AiClientConfig,
  matchCount = 5,
  matchThreshold = 0.7
): Promise<string> {
  // 1. Generate embedding for query
  const queryEmbedding = await generateEmbedding(llmConfig, query);
  if (!queryEmbedding) return "";

  // 2. Search using pgvector RPC
  const { data: chunks, error } = await supabaseAdmin.rpc("match_sop_chunks", {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
  });

  if (error || !chunks) {
    console.error("[RAG] Vector search error:", error);
    return "";
  }

  // 3. Format context
  const parts: string[] = [];
  for (const chunk of (chunks as any[])) {
    const head = chunk.source_url ? `(Tautan: ${chunk.source_url})` : "";
    parts.push(`[Excerpt${head}]\n${chunk.content}`);
  }

  return parts.join("\n\n");
}
