import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { drainQueue } from "@/services/wa-autoreply.service";
import { getWaitUntil, runDeferred } from "@/lib/cf-context";

/**
 * Cron-driven queue drain.
 *
 * Dipanggil tiap 2 detik oleh pg_cron job `drain-wa-queue` (migrasi
 * 20260528120100_wa_queue_pg_cron_poll.sql). pg_cron tidak mudah membawa
 * secret tanpa setup Vault, dan endpoint ini hanya men-drain entry yang sudah
 * tervalidasi dan tersimpan di antrian DB lewat atomic claim (FOR UPDATE SKIP
 * LOCKED) — tidak ada vektor pesan masuk di sini.
 *
 * GERBANG MURAH (audit 7 Agu 2026 — P1). Sebelumnya setiap tick menjalankan
 * cleanup zombie + scan recovery 20 pesan + claim + fallback-sender, TANPA
 * memeriksa apakah ada pekerjaan. Dengan cadence 2 detik itu berarti ±43.000
 * invokasi/hari dan ratusan query/menit meski antrian kosong. Sekarang tick
 * dimulai dengan satu query super-ringan; kalau tidak ada entry yang siap,
 * handler langsung keluar. Pekerjaan safety-net (recovery pesan yang tidak
 * ter-enqueue + fallback untuk entry gagal) dipindah ke
 * /api/cron/wa-queue-safety-net yang jalan tiap menit.
 */

/** Status yang berarti "masih ada pekerjaan di antrian". */
const ACTIVE_QUEUE_STATUSES = ["pending", "waiting", "processing", "retrying"];

async function hasQueueWork(): Promise<boolean> {
  try {
    const { data, error } = await (supabaseAdmin as any)
      .from("wa_conversation_queue")
      .select("id")
      .in("status", ACTIVE_QUEUE_STATUSES)
      .limit(1);
    if (error) {
      // Jangan diam saat query gerbang gagal — lebih baik lanjut bekerja
      // (perilaku lama) daripada antrian berhenti diproses tanpa jejak.
      console.warn("[Cron.drain] queue gate query failed, continuing:", error.message);
      return true;
    }
    return (data ?? []).length > 0;
  } catch (e) {
    console.warn("[Cron.drain] queue gate threw, continuing:", e);
    return true;
  }
}

async function handle(request: Request): Promise<Response> {
  if (!(await hasQueueWork())) {
    return new Response(JSON.stringify({ accepted: true, idle: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

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

  const origin = new URL(request.url).origin;
  // Process 1 entry per request. Multi-agent orchestration is CPU-heavy in
  // Cloudflare Workers; running 2 in one invocation caused worker eviction and
  // zombie_timeout retries. pg_cron still ticks every 2s, while DB claims keep
  // concurrency safe across separate invocations.
  const runDrainWork = async () => {
    try {
      await drainQueue(origin, 1);
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
