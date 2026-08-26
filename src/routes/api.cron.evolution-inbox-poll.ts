import { createFileRoute } from "@tanstack/react-router";
import { pollEvolutionInbox } from "@/services/evolution-inbox-poll.service";

/**
 * Jaring pengaman inbound WhatsApp: tarik pesan terbaru dari Evolution API dan
 * putar ulang ke /api/evolution. Dipanggil pg_cron tiap menit sehingga chatbot
 * tetap membalas walau webhook Evolution berhenti mengirim event.
 */
async function handle(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const result = await pollEvolutionInbox(origin);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 503,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/cron/evolution-inbox-poll")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
