import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runTrainingEmbeddingBackfill } from "@/services/training-embedding-backfill.service";

/**
 * Mengisi embedding training dan chunk SOP yang masih NULL.
 *
 * Dijalankan tiap 5 menit oleh pg_cron job `backfill-training-embeddings`
 * (migrasi 20261010183000_cron_backfill_training_embeddings.sql — harus
 * dijadwalkan manual setelah deploy jika migrasi tidak dijalankan otomatis).
 *
 * URL: https://pomahguesthouse.com/api/cron/backfill-training-embeddings
 */

async function handle(): Promise<Response> {
  try {
    const result = await runTrainingEmbeddingBackfill(supabaseAdmin);
    return Response.json({
      checked: result.checked,
      embedded: result.embedded,
      failed: result.failed,
    });
  } catch (error) {
    console.error("[backfill-training-embeddings] failed:", error);
    return Response.json(
      {
        checked: 0,
        embedded: 0,
        failed: 0,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/cron/backfill-training-embeddings")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});
