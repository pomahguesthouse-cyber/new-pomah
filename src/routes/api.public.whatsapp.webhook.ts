/**
 * Webhook WhatsApp Business resmi (Meta) via Lovable connector.
 * Alur: verifikasi tanda tangan → simpan ke inbox → proses idempoten.
 */
import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhookRequest } from "@lovable.dev/webhooks-js";

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.WHATSAPP_API_KEY;
        if (!secret) return new Response("Not configured", { status: 503 });

        const deliveryId = request.headers.get("x-lovable-delivery")?.trim();
        const event = request.headers.get("x-lovable-event")?.trim();

        let payload: unknown;
        try {
          const verified = await verifyWebhookRequest({
            req: request,
            secret,
            maxBodyBytes: 4 * 1024 * 1024,
          });
          payload = verified.payload;
        } catch {
          return new Response("Invalid signature", { status: 401 });
        }
        if (!deliveryId || !event) return new Response("Missing headers", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as unknown as { from: (t: string) => any };

        const { error: insErr } = await admin
          .from("whatsapp_webhook_events")
          .upsert(
            { delivery_id: deliveryId, event, payload },
            { onConflict: "delivery_id", ignoreDuplicates: true },
          );
        if (insErr) {
          console.error("[MetaWebhook] inbox write failed:", insErr.message);
          return new Response("Storage error", { status: 500 });
        }

        const { data: row, error: selErr } = await admin
          .from("whatsapp_webhook_events")
          .select("id, event, payload, attempts, processed_at")
          .eq("delivery_id", deliveryId)
          .single();
        if (selErr || !row) return new Response("Storage error", { status: 500 });

        const { processInboxRow, drainMetaInbox } = await import(
          "@/services/whatsapp-meta-inbox.service"
        );

        if (!row.processed_at) {
          const result = await processInboxRow(row);
          // Status yang menunggu pasangan outbound sudah tersimpan & dijadwalkan ulang.
          if (!result.done && !result.deferred) {
            return new Response("Processing failed", { status: 500 });
          }
        }

        // Recovery baris lain yang tertunda, tanpa menahan respons.
        const { getWaitUntil } = await import("@/lib/cf-context");
        const waitUntil = getWaitUntil();
        if (waitUntil) waitUntil(drainMetaInbox(3).then(() => undefined).catch(() => undefined));

        return new Response("ok", { status: 200 });
      },
    },
  },
});
