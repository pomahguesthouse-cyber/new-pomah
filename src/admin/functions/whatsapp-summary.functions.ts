import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  seedMissingThreadSummary,
  summaryIsMissing,
  clearWhatsappThreadSummary,
} from "@/services/whatsapp-summary.service";

const threadIdSchema = z.object({ threadId: z.string().uuid() });

/**
 * Creates a deterministic seed summary only when the thread has no context summary.
 * This is safe to call when an admin opens an old thread because it does not
 * overwrite existing LLM summaries.
 */
export const seedMissingWhatsappSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => threadIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const result = await seedMissingThreadSummary(context.supabase as any, data.threadId);
    return { ok: true, updated: result.updated };
  });

/**
 * Backfills missing summaries in small batches. Keep batch size modest so an
 * admin action cannot time out or lock too much data.
 */
export const backfillMissingWhatsappSummaries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(50).default(20) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { data: threads, error } = await context.supabase
      .from("whatsapp_threads")
      .select("id, chat_summary, chat_summary_json, chat_summary_updated_at")
      .order("last_message_at", { ascending: false })
      .limit(data.limit);
    if (error) throw error;

    let updated = 0;
    let skipped = 0;
    for (const thread of threads ?? []) {
      if (!summaryIsMissing(thread as any)) {
        skipped += 1;
        continue;
      }
      const result = await seedMissingThreadSummary(context.supabase as any, (thread as any).id);
      if (result.updated) updated += 1;
      else skipped += 1;
    }

    return { ok: true, scanned: threads?.length ?? 0, updated, skipped };
  });

export const clearWhatsappSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => threadIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    await clearWhatsappThreadSummary(context.supabase as any, data.threadId);
    return { ok: true };
  });
