/**
 * Webhook mutasi Moota (API v2).
 * URL yang didaftarkan di dashboard: https://<domain>/api/public/moota/webhook
 *
 * Verifikasi HMAC-SHA256 header Signature dengan MOOTA_WEBHOOK_SECRET
 * (raw body). Tidak ada rahasia di repo.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/moota/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleMootaWebhookRequest, readWebhookRequestMeta } = await import(
          "@/services/moota-webhook"
        );
        const rawBody = await request.text();
        const meta = readWebhookRequestMeta(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { productionMutationDeps } = await import("@/services/moota-runtime-deps");
        const deps = productionMutationDeps(supabaseAdmin as never);

        // Persist + matching di request yang sama. Matching harus idempotent
        // (unik mutation_id). Target respons < 5 detik (panduan Moota).
        const result = await handleMootaWebhookRequest({
          rawBody,
          signature: meta.signature,
          ip: meta.ip,
          supabase: supabaseAdmin as never,
          deps,
        });
        return new Response(JSON.stringify(result.body), {
          status: result.httpStatus,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
