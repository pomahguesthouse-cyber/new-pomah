import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listIgnoredWhatsappTrainingThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ status: z.enum(["active", "restored", "all"]).default("active") }).parse(d ?? {}))
  .handler(async ({ data }) => {
    let q = (supabaseAdmin as any)
      .from("wa_training_ignored_threads")
      .select("id, thread_id, phone, display_name, reason, status, ignored_at, restored_at")
      .order("ignored_at", { ascending: false })
      .limit(500);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return { rows: rows ?? [] };
  });

export const hideWhatsappCorrectionThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    threadId: z.string().uuid(),
    reason: z.string().trim().max(500).nullable().optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { data: thread, error: threadErr } = await supabaseAdmin
      .from("whatsapp_threads")
      .select("id, phone, display_name")
      .eq("id", data.threadId)
      .maybeSingle();
    if (threadErr) throw threadErr;
    if (!thread) throw new Error("Percakapan tidak ditemukan.");

    const { error } = await (supabaseAdmin as any)
      .from("wa_training_ignored_threads")
      .upsert({
        thread_id: thread.id,
        phone: thread.phone,
        display_name: thread.display_name,
        reason: data.reason || "Sembunyikan dari WhatsApp Corrections",
        status: "active",
        restored_at: null,
        ignored_at: new Date().toISOString(),
      }, { onConflict: "thread_id" });
    if (error) throw error;

    await (supabaseAdmin as any)
      .from("wa_correction_sessions")
      .update({ status: "archived" })
      .eq("thread_id", data.threadId)
      .neq("status", "archived");

    return { ok: true };
  });

export const restoreWhatsappCorrectionThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await (supabaseAdmin as any)
      .from("wa_training_ignored_threads")
      .update({ status: "restored", restored_at: new Date().toISOString() })
      .eq("thread_id", data.threadId);
    if (error) throw error;
    return { ok: true };
  });
