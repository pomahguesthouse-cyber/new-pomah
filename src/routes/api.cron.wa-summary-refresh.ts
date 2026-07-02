import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWaitUntil, runDeferred } from "@/lib/cf-context";
import { resolvePropertyAiConfig } from "@/services/ai-client.service";

/**
 * Safety-net cron: perbarui `chat_summary` thread WA yang tertinggal.
 *
 * Alur `deferAfterReply` di wa-autoreply sudah menjadwalkan LLM summary +
 * seed fallback lewat `waitUntil` setelah tiap balasan — tidak menambah
 * latency ke path chatbot. Cron ini hanya menutupi kasus yang lolos jalur
 * itu (worker di-evict Cloudflare, admin balas via human takeover, atau
 * `waitUntil` di-drop). Dijalankan 5 menit sekali, batch kecil, dan tidak
 * pernah menyentuh path balasan tamu — jadi 100% aman untuk kecepatan bot.
 */
async function handle(_request: Request): Promise<Response> {
  const runWork = async () => {
    try {
      // Cari thread yang last_message-nya lebih baru dari update summary
      // terakhir + margin 3 menit (biar tidak balapan dengan deferAfterReply
      // yang barusan jalan).
      const staleBefore = new Date(Date.now() - 3 * 60_000).toISOString();
      const { data: threads, error } = await (supabaseAdmin as any)
        .from("whatsapp_threads")
        .select("id, chat_summary, chat_summary_updated_at, last_message_at")
        .not("last_message_at", "is", null)
        .lt("chat_summary_updated_at", staleBefore)
        .order("last_message_at", { ascending: false })
        .limit(20);

      if (error) {
        console.warn("[Cron.waSummaryRefresh] query gagal:", error.message);
        return;
      }

      const candidates = ((threads ?? []) as Array<{
        id: string;
        chat_summary: string | null;
        chat_summary_updated_at: string | null;
        last_message_at: string | null;
      }>).filter((t) => {
        if (!t.last_message_at) return false;
        if (!t.chat_summary_updated_at) return true;
        return new Date(t.last_message_at).getTime() > new Date(t.chat_summary_updated_at).getTime();
      });

      if (candidates.length === 0) return;

      const config = await resolvePropertyAiConfig(supabaseAdmin as any, {
        lovableFallbackModel: "google/gemini-2.5-flash",
      });

      // Import lazy supaya modul berat tidak ikut ke bundle route saat parse.
      const { regenerateThreadSummary } = await import("@/services/wa-autoreply.service");
      const { seedMissingThreadSummary } = await import("@/services/whatsapp-summary.service");

      let refreshed = 0;
      let seeded = 0;
      for (const t of candidates) {
        try {
          if (config) {
            const res = await regenerateThreadSummary(supabaseAdmin, t.id, config);
            if (res.ok) {
              refreshed += 1;
              continue;
            }
          }
          // Fallback: tetap tulis seed deterministik supaya kolom tidak kosong.
          const seed = await seedMissingThreadSummary(supabaseAdmin, t.id);
          if (seed.updated) seeded += 1;
        } catch (e) {
          console.warn(`[Cron.waSummaryRefresh] thread ${t.id.slice(0, 8)} gagal:`, e);
        }
      }
      console.info(
        `[Cron.waSummaryRefresh] scanned=${candidates.length} llm=${refreshed} seeded=${seeded}`,
      );
    } catch (e) {
      console.warn("[Cron.waSummaryRefresh] fatal:", e);
    }
  };

  const waitUntil = getWaitUntil();
  if (waitUntil) {
    waitUntil(runWork());
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }
  await runWork();
  return new Response(JSON.stringify({ accepted: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/cron/wa-summary-refresh")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

// Silence unused import lint in some builds
export const _unusedRunDeferred = runDeferred;
