import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  runTrainingEmbeddingBackfill,
  summarizeTrainingIndex,
  type TrainingIndexSource,
} from "@/services/training-embedding-backfill.service";

export type { TrainingIndexSource };

export const getTrainingIndexSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const sources = await summarizeTrainingIndex(supabaseAdmin);
    return { sources };
  });

/** Satu batch yang sama dengan cron backfill embedding. */
export const reindexTrainingEmbeddings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const result = await runTrainingEmbeddingBackfill(supabaseAdmin);
    return {
      checked: result.checked,
      embedded: result.embedded,
      failed: result.failed,
    };
  });
