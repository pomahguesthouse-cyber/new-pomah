import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { embedTrainingExample } from "@/ai/training-rag.service";
import { loadTrainingAiConfig } from "@/services/training-ai-config";
import { clearEmbedding, embedInline } from "@/services/training-embedding";
import { runTrainingEmbeddingBackfill } from "@/services/training-embedding-backfill.service";

/**
 * Embedding inline setelah rating/correction berubah. Timeout dan kegagalan
 * gateway tidak menggagalkan simpan — baris dibiarkan embedding NULL.
 */
async function reembedTrainingExampleAsync(logId: string): Promise<void> {
  await embedInline(`log:${logId}`, async (signal) => {
    const config = await loadTrainingAiConfig();
    if (!config) return false;
    const result = await embedTrainingExample(supabaseAdmin, logId, config, { signal });
    return result.ok;
  });
}

export const listConversationLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ rating: z.enum(["all", "good", "bad", "unrated"]).default("all") })
      .parse(d ?? { rating: "all" }),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("ai_conversation_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.rating === "good") q = q.eq("rating", "good");
    else if (data.rating === "bad") q = q.eq("rating", "bad");
    else if (data.rating === "unrated") q = q.is("rating", null);
    const { data: rows } = await q;
    return { logs: rows ?? [] };
  });

export const rateConversationLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        rating: z.enum(["good", "bad"]).nullable(),
        correction: z.string().max(4000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ai_conversation_logs")
      .update({
        rating: data.rating,
        correction: data.correction ?? null,
        // Hanya contoh "good" yang dipakai chatbot sebagai dasar jawaban
        used: data.rating === "good",
      })
      .eq("id", data.id);
    if (error) throw error;
    await clearEmbedding(supabaseAdmin, "ai_conversation_logs", data.id);
    if (data.rating === "good") {
      await reembedTrainingExampleAsync(data.id);
    }
    return { ok: true };
  });

/**
 * Save a simulated conversation as a training example. Accepted examples
 * (promoted) are marked `used` so the chatbot treats them as a basis for
 * future answers; rejected ones are kept as negative examples.
 */
export const saveTrainingExample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        userMessage: z.string().min(1).max(4000),
        aiResponse: z.string().min(1).max(8000),
        accepted: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await context.supabase
      .from("ai_conversation_logs")
      .insert({
        user_message: data.userMessage,
        ai_response: data.aiResponse,
        used: data.accepted,
        rating: data.accepted ? "good" : "bad",
      })
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (data.accepted && inserted?.id) {
      await reembedTrainingExampleAsync(inserted.id);
    }
    return { ok: true };
  });

export const deleteConversationLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ai_conversation_logs")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const updateConversationLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        userMessage: z.string().min(1).max(4000),
        aiResponse: z.string().min(1).max(8000),
        rating: z.enum(["good", "bad"]).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ai_conversation_logs")
      .update({
        user_message: data.userMessage,
        ai_response: data.aiResponse,
        rating: data.rating,
        used: data.rating === "good",
      })
      .eq("id", data.id);
    if (error) throw error;
    await clearEmbedding(supabaseAdmin, "ai_conversation_logs", data.id);
    if (data.rating === "good") {
      await reembedTrainingExampleAsync(data.id);
    }
    return { ok: true };
  });

export const exportTrainingData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("ai_conversation_logs")
      .select("user_message, ai_response, rating, correction")
      .in("rating", ["good", "bad"])
      .order("created_at", { ascending: false });
    return { rows: data ?? [] };
  });

/**
 * Backfill embedding untuk semua contoh `good + used` yang belum diindeks.
 * Aman dijalankan berulang kali — hanya memproses baris dengan
 * `embedding IS NULL`. Berhenti setelah `maxRows` agar request tidak timeout.
 */
export const backfillTrainingEmbeddings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ maxRows: z.number().int().min(1).max(200).default(50) }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const result = await runTrainingEmbeddingBackfill(supabaseAdmin, { rowLimit: data.maxRows });
    return { processed: result.checked, ok: result.embedded, failed: result.failed };
  });
