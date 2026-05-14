import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
