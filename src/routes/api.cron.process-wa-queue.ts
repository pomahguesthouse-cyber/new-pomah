import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  drainQueue,
  recoverUnqueuedInboundMessages,
  sendFailureFallbackToGuests,
} from "@/services/wa-autoreply.service";
import { runDeferred } from "@/lib/cf-context";

/**
 * Cron-driven queue drain.
 *
 * Invoked every 2s by the pg_cron job `drain-wa-queue` (see migration
 * 20260528120100_wa_queue_pg_cron_poll.sql). pg_cron's net.http_post cannot
 * easily carry a secret without vault setup, and this endpoint only drains
 * entries already validated and persisted in the DB queue via atomic claim
 * (FOR UPDATE SKIP LOCKED) — there is no inbound message vector here. Mirrors
 * the access posture of /api/queue-worker (hotfix 54a3274).
 */
async function handle(request: Request): Promise<Response> {
  const cleanupStartedAt = new Date(Date.now() - 5_000).toISOString();
  const { data: zombieCount } = await (supabaseAdmin as any).rpc(
    "wa_queue_cleanup_zombies",
  );
  const count = typeof zombieCount === "number" ? zombieCount : 0;

  // Fire-and-forget super admin alert when zombies were reset.
  if (count > 0) {
    void runDeferred("Cron.notifyZombieTimeout", async () => {
      try {
        // Ambil sampel entry yang baru saja di-reset (status retrying + zombie error).
        const { data: samples } = await (supabaseAdmin as any)
          .from("wa_conversation_queue")
          .select("id, phone, last_error, updated_at")
          .ilike("last_error", "%zombie%")
          .gte("updated_at", cleanupStartedAt)
          .order("updated_at", { ascending: false })
          .limit(5);

        const { notifyZombieTimeout } = await import(
          "@/services/manager-notifier.service"
        );
        await notifyZombieTimeout(supabaseAdmin as any, {
          count,
          samples: ((samples ?? []) as any[]).map((r) => ({
            phone: r.phone ?? null,
            entryId: r.id,
            lastError: r.last_error ?? null,
          })),
        });
      } catch (e) {
        console.warn("[Cron] notifyZombieTimeout failed:", e);
      }
    });
  }

  let recovered = 0;
  try {
    ({ recovered } = await recoverUnqueuedInboundMessages({ lookbackMinutes: 30, limit: 20 }));
  } catch (e) {
    console.warn("[Cron] recoverUnqueuedInboundMessages failed:", e);
  }

  const origin = new URL(request.url).origin;
  // Batch claims & processes in parallel inside drainQueue (Promise.allSettled).
  // Sebelumnya 5/tick — namun orchestrator multi-agent + tool call sering
  // memakan CPU budget Cloudflare Worker per request, menyebabkan handler
  // dimatikan paksa di tengah jalan dan entry ditandai zombie_timeout.
  // 2/tick × 2s cron = 60/menit, masih jauh di atas throughput nyata,
  // namun masing-masing klaim mendapat headroom CPU yang lebih besar.
  // request.signal stops new work if the platform disconnects mid-run.
  const { processed } = await drainQueue(origin, 2, request.signal);


  // Kirim fallback ke tamu untuk entry yang habis semua percobaan.
  // Tanpa ini tamu tidak mendapat respons apapun saat orchestrator gagal 3x.
  let notified = 0;
  try {
    ({ notified } = await sendFailureFallbackToGuests());
  } catch (e) {
    console.warn("[Cron] sendFailureFallbackToGuests failed:", e);
  }

  return new Response(
    JSON.stringify({ processed, zombies_reset: count, recovered, fallback_notified: notified }, null, 2),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export const Route = createFileRoute("/api/cron/process-wa-queue")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
