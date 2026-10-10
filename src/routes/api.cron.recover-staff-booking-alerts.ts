import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recoverStaffBookingAlerts } from "@/services/staff-booking-alert-recovery";

/**
 * Jaring pengaman alert WhatsApp booking baru ke staf.
 *
 * Dijalankan tiap menit oleh pg_cron job `recover-staff-booking-alerts`
 * (migrasi 20261010160000_cron_recover_staff_booking_alerts.sql — harus
 * dijadwalkan manual setelah deploy jika migrasi tidak dijalankan otomatis).
 *
 * Mengirim alert untuk booking non-batal yang dibuat 2 menit–24 jam yang
 * lalu bila pengelola aktif belum punya log sent/delivered/read, dan
 * mengulang baris pending dengan 0 attempt. Dedupe tetap di notifier.
 */

async function handle(): Promise<Response> {
  const result = await recoverStaffBookingAlerts(supabaseAdmin as never);
  if (!result.ok) {
    return Response.json(result, { status: 500 });
  }
  return Response.json(result);
}

export const Route = createFileRoute("/api/cron/recover-staff-booking-alerts")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});
