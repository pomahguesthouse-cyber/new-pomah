import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Untyped client view — `source` column isn't in the generated types. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
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
      .update({ rating: data.rating, correction: data.correction ?? null })
      .eq("id", data.id);
    if (error) throw error;
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
    const { error } = await context.supabase.from("ai_conversation_logs").insert({
      user_message: data.userMessage,
      ai_response: data.aiResponse,
      used: data.accepted,
      rating: data.accepted ? "good" : "bad",
    });
    if (error) throw error;
    return { ok: true };
  });

export type WebchatLogRow = {
  id: string;
  thread_id: string | null;
  user_message: string | null;
  ai_response: string | null;
  used: boolean | null;
  created_at: string;
};

/** List logged public webchat exchanges, oldest first (grouped by thread). */
export const listWebchatLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await db(context.supabase)
      .from("ai_conversation_logs")
      .select("id, thread_id, user_message, ai_response, used, created_at")
      .eq("source", "webchat")
      .order("created_at", { ascending: true })
      .limit(500);
    return { logs: (data ?? []) as unknown as WebchatLogRow[] };
  });

/** Mark (or unmark) a whole webchat thread as training material. */
export const setWebchatTraining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string(), used: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("ai_conversation_logs")
      .update({ used: data.used })
      .eq("thread_id", data.threadId)
      .eq("source", "webchat");
    if (error) throw error;
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
