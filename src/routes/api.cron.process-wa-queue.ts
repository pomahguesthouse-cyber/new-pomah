import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  drainQueue,
  recoverUnqueuedInboundMessages,
  sendFailureFallbackToGuests,
} from "@/services/wa-autoreply.service";
import { getWaitUntil, runDeferred } from "@/lib/cf-context";

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

  try {
    await recoverUnqueuedInboundMessages({ lookbackMinutes: 30, limit: 20 });
  } catch (e) {
    console.warn("[Cron] recoverUnqueuedInboundMessages failed:", e);
  }

  const origin = new URL(request.url).origin;
  // Process 1 entry per request. Multi-agent orchestration is CPU-heavy in
  // Cloudflare Workers; running 2 in one invocation caused worker eviction and
  // zombie_timeout retries. pg_cron still ticks every 2s, while DB claims keep
  // concurrency safe across separate invocations.
  const runDrainWork = async () => {
    try {
      await drainQueue(origin, 1);

      // Kirim fallback ke tamu untuk entry yang habis semua percobaan.
      // Tanpa ini tamu tidak mendapat respons apapun saat orchestrator gagal 3x.
      await sendFailureFallbackToGuests();
    } catch (e) {
      console.warn("[Cron] background drain failed:", e);
    }
  };

  const waitUntil = getWaitUntil();
  if (waitUntil) {
    waitUntil(runDrainWork());
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }

  await runDrainWork();
  return new Response(JSON.stringify({ accepted: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/cron/process-wa-queue")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
