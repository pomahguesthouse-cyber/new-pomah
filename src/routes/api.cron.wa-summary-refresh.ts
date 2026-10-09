import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolvePropertyAiConfig } from "@/services/ai-client.service";
import {
  SUMMARY_REFRESH_MARGIN_MS,
  threadSummaryRefreshDue,
} from "@/services/whatsapp-summary.service";

/**
 * Safety-net cron: perbarui `chat_summary` thread WA yang tertinggal.
 *
 * Ringkasan di jalur balasan dititipkan ke `waitUntil`, dan di produksi janji
 * itu sering tidak selesai. Cron ini yang menutupinya: thread tanpa
 * `chat_summary_updated_at` dan thread yang pesan terakhirnya lebih baru dari
 * ringkasan. Dijalankan dari Cloudflare cron tiap menit (server.ts) dan boleh
 * dipanggil langsung. Kerja ditunggu di request ini, bukan lewat waitUntil.
 */
export const SUMMARY_REFRESH_DEADLINE_MS = 20_000;

async function refreshStaleThreadSummaries(now = new Date()): Promise<void> {
  const staleBefore = new Date(now.getTime() - SUMMARY_REFRESH_MARGIN_MS).toISOString();
  const deadline = Date.now() + SUMMARY_REFRESH_DEADLINE_MS;
  const { data: threads, error } = await (supabaseAdmin as any)
    .from("whatsapp_threads")
    .select("id, chat_summary, chat_summary_updated_at, last_message_at")
    .not("last_message_at", "is", null)
    .or(`chat_summary_updated_at.is.null,chat_summary_updated_at.lt.${staleBefore}`)
    .order("last_message_at", { ascending: false })
    .limit(40);

  if (error) {
    console.warn("[Cron.waSummaryRefresh] query gagal:", error.message);
    return;
  }

  const candidates = ((threads ?? []) as Array<{
    id: string;
    chat_summary: string | null;
    chat_summary_updated_at: string | null;
    last_message_at: string | null;
  }>)
    .filter((thread) => threadSummaryRefreshDue(thread, now))
    .slice(0, 20);

  if (candidates.length === 0) return;

  const config = await resolvePropertyAiConfig(supabaseAdmin as any, {
    lovableFallbackModel: "google/gemini-2.5-flash",
  });

  const { regenerateThreadSummary } = await import("@/services/wa-autoreply.service");
  const { seedMissingThreadSummary } = await import("@/services/whatsapp-summary.service");

  let refreshed = 0;
  let seeded = 0;
  for (const t of candidates) {
    if (Date.now() > deadline) break;
    try {
      if (config) {
        const res = await regenerateThreadSummary(supabaseAdmin, t.id, config);
        if (res.ok) {
          refreshed += 1;
          continue;
        }
      }
      const seed = await seedMissingThreadSummary(supabaseAdmin, t.id);
      if (seed.updated) seeded += 1;
    } catch (e) {
      console.warn(`[Cron.waSummaryRefresh] thread ${t.id.slice(0, 8)} gagal:`, e);
    }
  }
  console.info(
    `[Cron.waSummaryRefresh] scanned=${candidates.length} llm=${refreshed} seeded=${seeded}`,
  );
}

async function handle(_request: Request): Promise<Response> {
  try {
    await refreshStaleThreadSummaries();
  } catch (e) {
    console.warn("[Cron.waSummaryRefresh] fatal:", e);
  }
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
