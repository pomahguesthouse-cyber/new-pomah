import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateAndSendInvoiceNotification } from "@/services/invoice-notification.service";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveBookingId(rawId: string): Promise<string | null> {
  const q = (supabaseAdmin as any)
    .from("bookings")
    .select("id")
    .limit(1)
    .maybeSingle();

  const { data, error } = isUuid(rawId)
    ? await q.eq("id", rawId)
    : await q.eq("reference_code", rawId);

  if (error) throw error;
  return data?.id ?? null;
}

async function handle(id: string, request: Request): Promise<Response> {
  try {
    const rawId = decodeURIComponent(id).trim();
    if (!rawId) {
      return Response.json({ ok: false, error: "Kode booking kosong." }, { status: 400 });
    }

    const bookingId = await resolveBookingId(rawId);
    if (!bookingId) {
      return Response.json({ ok: false, error: "Booking tidak ditemukan." }, { status: 404 });
    }

    const result = await generateAndSendInvoiceNotification({
      supabase: supabaseAdmin as any,
      bookingId,
      origin: new URL(request.url).origin,
      skipWhatsApp: false,
    });

    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error: any) {
    console.error("[api.booking-invoice.send] Error sending invoice:", error);
    return Response.json(
      { ok: false, error: error?.message ?? "Gagal mengirim invoice." },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/booking-invoice/$id/send")({
  server: {
    handlers: {
      POST: async ({ params, request }) => handle(params.id, request),
    },
  },
});
