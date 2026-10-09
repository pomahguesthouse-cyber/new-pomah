import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runBookingStuckMonitor } from "@/services/booking-stuck-monitor";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Cron-driven booking-flow stuck monitor.
 *
 * Dijalankan setiap 1 menit oleh pg_cron job `booking-stuck-monitor`.
 * Hanya sesi wa_booking_states yang updated_at-nya (dan awal episode-nya)
 * masih dalam 24 jam. Alert ke super admin lewat WhatsApp; `alerted`
 * menghitung pengiriman yang benar-benar sukses.
 *
 * Akses: tidak ada secret — sama dengan endpoint cron lain di project
 * ini (drain-wa-queue, run-article-schedules) yang hanya menjalankan
 * pekerjaan internal berdasarkan data DB, tidak ada vektor input dari luar.
 */

async function handle(): Promise<Response> {
  const result = await runBookingStuckMonitor(supabaseAdmin as any);
  if (!result.ok) {
    return Response.json(result, { status: 500 });
  }
  return Response.json(result);
}

export const Route = createFileRoute("/api/cron/booking-stuck-monitor")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});
