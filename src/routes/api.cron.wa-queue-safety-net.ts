import { createFileRoute } from "@tanstack/react-router";
import {
  recoverUnqueuedInboundMessages,
  sendFailureFallbackToGuests,
} from "@/services/wa-autoreply.service";
import { getWaitUntil } from "@/lib/cf-context";

/**
 * Safety-net antrian WhatsApp — dijalankan pg_cron tiap 1 menit.
 *
 * Dipisahkan dari /api/cron/process-wa-queue pada 7 Agu 2026 (audit — P1).
 * Dua pekerjaan di bawah ini adalah jaring pengaman, bukan hot path, tetapi
 * dulu ikut jalan pada SETIAP tick 2 detik:
 *
 *   1. `recoverUnqueuedInboundMessages` — SELECT 20 pesan inbound terakhir,
 *      lalu hingga 3 query per baris untuk memastikan tiap pesan sudah masuk
 *      antrian. Pada cadence 2 detik ini bisa ratusan query per menit meski
 *      tidak ada yang perlu diselamatkan.
 *   2. `sendFailureFallbackToGuests` — kirim balasan darurat untuk entry yang
 *      sudah habis semua percobaan.
 *
 * Pada cadence 1 menit, keterlambatan terburuk untuk kasus tepi ini ±60 detik
 * — jauh di dalam toleransi, karena jalur normal (webhook → antrian → drain)
 * tidak bergantung padanya sama sekali.
 *
 * Sweep media masuk (bukti transfer yang belum punya storage_path) juga jalan
 * di sini, ditunggu langsung. Bukan di tick 2 detik, dan bukan lewat waitUntil.
 */
async function handle(_request: Request): Promise<Response> {
  // Media masuk ditunggu di sini, bukan lewat waitUntil. pg_net memberi 30s;
  // sweep sendiri berhenti lebih awal supaya request ini sempat membalas.
  let media = { scanned: 0, stored: 0, failed: 0 };
  try {
    const { sweepPendingInboundMedia } = await import("@/services/wa-inbound-media");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    media = await sweepPendingInboundMedia(supabaseAdmin as never);
  } catch (e) {
    console.warn("[Cron.safetyNet] inbound media sweep failed:", e);
  }

  const runWork = async () => {
    try {
      const { recovered } = await recoverUnqueuedInboundMessages({
        lookbackMinutes: 30,
        limit: 20,
      });
      if (recovered > 0) {
        console.warn(`[Cron.safetyNet] ${recovered} pesan inbound diselamatkan ke antrian`);
      }
    } catch (e) {
      console.warn("[Cron.safetyNet] recoverUnqueuedInboundMessages failed:", e);
    }

    try {
      await sendFailureFallbackToGuests();
    } catch (e) {
      console.warn("[Cron.safetyNet] sendFailureFallbackToGuests failed:", e);
    }
  };

  const waitUntil = getWaitUntil();
  if (waitUntil) {
    waitUntil(runWork());
    return new Response(JSON.stringify({ accepted: true, media }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }

  await runWork();
  return new Response(JSON.stringify({ accepted: true, media }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/cron/wa-queue-safety-net")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
