/**
 * Server functions untuk modul Chatbot Training Examples.
 * Admin dapat upload .jsonl, list, edit jawaban ideal, toggle aktif,
 * backfill embedding, dan mempromosikan log percakapan menjadi
 * contoh kurasi.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TrainingJson =
  | string
  | number
  | boolean
  | null
  | TrainingJson[]
  | { [key: string]: TrainingJson };

export interface TrainingExampleRow {
  id: string;
  stage: string | null;
  state_before: string | null;
  user_message: string;
  intent: string | null;
  slot_updates: TrainingJson;
  ideal_assistant_response: string;
  source_file: string | null;
  training_type: string | null;
  language: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  embedding_updated_at?: string | null;
  promoted_from_log_id?: string | null;
}

const listInput = z
  .object({
    activeOnly: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(1000).optional().default(500),
  })
  .optional()
  .default({});

export const listTrainingExamples = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => listInput.parse(d))
  .handler(async ({ data, context }) => {
    let q = (context.supabase as any)
      .from("chatbot_training_examples")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.activeOnly) q = q.eq("is_active", true);
    const { data: rows, error } = await q;
    if (error) throw error;
    return { examples: (rows ?? []) as TrainingExampleRow[] };
  });

const exampleSchema = z.object({
  id: z.string().min(1).optional(),
  stage: z.string().nullable().optional(),
  state_before: z.string().nullable().optional(),
  user_message: z.string().min(1, "user_message wajib"),
  intent: z.string().nullable().optional(),
  slot_updates: z
    .unknown()
    .optional()
    .transform((v) => (v === undefined ? null : (v as TrainingJson))),
  ideal_assistant_response: z.string().min(1, "ideal_assistant_response wajib"),
  source_file: z.string().nullable().optional(),
  training_type: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
});

const uploadInput = z.object({
  sourceFile: z.string().min(1),
  examples: z.array(exampleSchema).min(1).max(2000),
});

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

/**
 * Best-effort embedding generator. Mengambil konfigurasi LLM dari
 * tabel `properties` (sama dengan pipeline lain). Gagal di tahap ini
 * tidak menggagalkan request — admin dapat menjalankan backfill nanti.
 */
async function embedCuratedRows(ids: string[]): Promise<{ ok: number; failed: number }> {
  if (ids.length === 0) return { ok: 0, failed: 0 };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { generateEmbedding } = await import("@/ai/embedding.service");

    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("ai_api_key, ai_base_url, ai_model")
      .limit(1)
      .maybeSingle();
    const p = (prop ?? {}) as { ai_api_key?: string; ai_base_url?: string; ai_model?: string };
    const explicitKey = p.ai_api_key?.trim();
    const lovableKey = process.env.LOVABLE_API_KEY?.trim();
    const useLovable = !explicitKey && !!lovableKey;
    const apiKey = explicitKey || lovableKey || null;
    if (!apiKey) return { ok: 0, failed: ids.length };
    const baseUrl = useLovable
      ? "https://ai.gateway.lovable.dev/v1"
      : (p.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
    const cfgModel = p.ai_model?.trim();
    const model = useLovable
      ? cfgModel?.includes("/")
        ? cfgModel
        : "google/gemini-2.5-flash"
      : cfgModel || "gpt-4o-mini";

    const { data: rows } = await (supabaseAdmin as any)
      .from("chatbot_training_examples")
      .select("id, user_message, ideal_assistant_response")
      .in("id", ids);

    let ok = 0;
    let failed = 0;
    for (const row of (rows ?? []) as Array<{
      id: string;
      user_message: string;
      ideal_assistant_response: string;
    }>) {
      const text = `Tamu: ${row.user_message}\nAsisten: ${row.ideal_assistant_response}`;
      const embedding = await generateEmbedding({ apiKey, baseUrl, model }, text);
      if (!embedding) {
        failed++;
        continue;
      }
      const { error: updErr } = await (supabaseAdmin as any)
        .from("chatbot_training_examples")
        .update({
          embedding: embedding as unknown as string,
          embedding_updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updErr) failed++;
      else ok++;
    }
    return { ok, failed };
  } catch (e) {
    console.warn("[chatbot-training] embed failed:", e);
    return { ok: 0, failed: ids.length };
  }
}

export const uploadTrainingExamples = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => uploadInput.parse(d))
  .handler(async ({ data, context }) => {
    const rows = data.examples.map((ex) => ({
      id: ex.id || genId("tr"),
      stage: ex.stage ?? null,
      state_before: ex.state_before ?? null,
      user_message: ex.user_message,
      intent: ex.intent ?? null,
      slot_updates: ex.slot_updates ?? null,
      ideal_assistant_response: ex.ideal_assistant_response,
      source_file: ex.source_file ?? data.sourceFile,
      training_type: ex.training_type ?? null,
      language: ex.language ?? "id-ID",
      is_active: true,
    }));

    const { data: inserted, error } = await (context.supabase as any)
      .from("chatbot_training_examples")
      .upsert(rows, { onConflict: "id" })
      .select("id");
    if (error) throw error;

    const ids = (inserted ?? []).map((r: { id: string }) => r.id);
    // Best-effort embedding di belakang layar — tidak blocking response.
    void embedCuratedRows(ids);

    return { inserted: ids.length, total: rows.length };
  });

const updateInput = z.object({
  id: z.string().min(1),
  ideal_assistant_response: z.string().min(1).max(8000).optional(),
  is_active: z.boolean().optional(),
});

export const updateTrainingExample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateInput.parse(d))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.ideal_assistant_response !== undefined) {
      patch.ideal_assistant_response = data.ideal_assistant_response;
      // Reset embedding karena teks berubah — backfill akan re-embed.
      patch.embedding = null;
      patch.embedding_updated_at = null;
    }
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await (context.supabase as any)
      .from("chatbot_training_examples")
      .update(patch)
      .eq("id", data.id);
    if (error) throw error;
    // Re-embed bila jawaban diubah & sekarang aktif.
    if (data.ideal_assistant_response !== undefined) {
      void embedCuratedRows([data.id]);
    }
    return { ok: true };
  });

const deleteInput = z.object({ id: z.string().min(1) });
export const deleteTrainingExample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => deleteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("chatbot_training_examples")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Backfill embedding untuk semua contoh aktif yang belum punya embedding.
 * Aman dijalankan berulang kali — hanya memproses baris dengan
 * `embedding IS NULL`. Dibatasi `maxRows` agar request tidak timeout.
 */
const backfillInput = z
  .object({ maxRows: z.number().int().min(1).max(200).default(50) })
  .optional()
  .default({});

export const backfillCuratedEmbeddings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => backfillInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("chatbot_training_examples")
      .select("id")
      .eq("is_active", true)
      .is("embedding", null)
      .limit(data.maxRows);
    if (error) throw error;
    const ids = (rows ?? []).map((r: { id: string }) => r.id);
    const res = await embedCuratedRows(ids);
    return { processed: ids.length, ...res };
  });

/**
 * Mempromosikan satu log percakapan (ai_conversation_logs) menjadi
 * contoh kurasi (chatbot_training_examples). Memakai `effective_answer`
 * (correction bila ada, kalau tidak ai_response) sebagai jawaban ideal.
 * Idempoten: jika log sudah pernah dipromosi, kembalikan id yang sama.
 */
const promoteInput = z.object({
  logId: z.string().uuid(),
  intent: z.string().nullable().optional(),
  stage: z.string().nullable().optional(),
  overrideResponse: z.string().min(1).max(8000).optional(),
});

export const promoteLogToCurated = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => promoteInput.parse(d))
  .handler(async ({ data, context }) => {
    // Cek apakah sudah pernah dipromosi
    const existing = await (context.supabase as any)
      .from("chatbot_training_examples")
      .select("id")
      .eq("promoted_from_log_id", data.logId)
      .maybeSingle();
    if (existing.data?.id) {
      return { ok: true, id: existing.data.id as string, alreadyExisted: true };
    }

    const { data: log, error: logErr } = await (context.supabase as any)
      .from("ai_conversation_logs")
      .select("id, user_message, ai_response, correction, metadata")
      .eq("id", data.logId)
      .maybeSingle();
    if (logErr) throw logErr;
    if (!log?.user_message) {
      throw new Error("Log tidak ditemukan atau tidak memiliki user_message.");
    }
    const effective =
      data.overrideResponse?.trim() ||
      (log.correction as string | null)?.trim() ||
      (log.ai_response as string | null)?.trim() ||
      "";
    if (!effective) {
      throw new Error("Log tidak memiliki jawaban yang dapat dipromosi.");
    }

    const meta = (log.metadata ?? {}) as Record<string, unknown>;
    const intent = data.intent ?? (meta.intent as string | undefined) ?? null;

    const id = genId("tr");
    const row = {
      id,
      stage: data.stage ?? null,
      state_before: null,
      user_message: log.user_message as string,
      intent,
      slot_updates: null,
      ideal_assistant_response: effective,
      source_file: "from-log",
      training_type: "promoted",
      language: "id-ID",
      is_active: true,
      promoted_from_log_id: data.logId,
    };
    const { error: insErr } = await (context.supabase as any)
      .from("chatbot_training_examples")
      .insert(row);
    if (insErr) throw insErr;

    void embedCuratedRows([id]);
    return { ok: true, id, alreadyExisted: false };
  });
