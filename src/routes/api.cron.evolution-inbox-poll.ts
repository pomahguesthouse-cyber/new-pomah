import { createFileRoute } from "@tanstack/react-router";
import { pollEvolutionInbox } from "@/services/evolution-inbox-poll.service";

/**
 * Jaring pengaman inbound Evolution (internal/staf).
 *
 * pg_cron masih boleh memanggil endpoint ini tiap menit. Bila kanal tamu
 * adalah Meta, handler kembali segera tanpa menarik atau memutar ulang pesan
 * (lihat `evolutionInboxPollDecision`). Webhook langsung `/api/evolution`
 * tidak dimatikan di sini.
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
