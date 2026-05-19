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
  llmConfig: AiClientConfig
): Promise<void> {
  // 1. Delete existing chunks for this document
  await supabase.from("sop_chunks").delete().eq("document_id", documentId);

  if (!content.trim()) return;

  // 2. Chunk the text
  const chunks = chunkText(content, { maxLength: 800, overlap: 100 });

  // 3. Generate embeddings and save
  for (const chunk of chunks) {
    const embedding = await generateEmbedding(llmConfig, chunk);
    if (embedding) {
      const { error } = await supabase.from("sop_chunks").insert({
        document_id: documentId,
        content: chunk,
        source_url: sourceUrl,
        embedding: embedding,
      });

      if (error) {
        console.error(`[RAG] Error inserting chunk for doc ${documentId}:`, error);
      }
    } else {
      console.warn(`[RAG] Failed to generate embedding for chunk in doc ${documentId}`);
    }
  }
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
