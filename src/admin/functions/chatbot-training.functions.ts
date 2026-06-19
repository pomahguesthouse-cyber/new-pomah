/**
 * Server functions untuk modul Chatbot Training Examples.
 * Admin dapat upload .jsonl, list, edit jawaban ideal, dan toggle aktif.
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
    return { inserted: (inserted ?? []).length, total: rows.length };
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
    }
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await (context.supabase as any)
      .from("chatbot_training_examples")
      .update(patch)
      .eq("id", data.id);
    if (error) throw error;
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
