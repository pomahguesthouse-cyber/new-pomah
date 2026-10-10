import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recoverMissingInvoices } from "@/services/invoice-recovery.service";

/**
 * Jaring pengaman invoice WhatsApp.
 *
 * Dijalankan tiap menit oleh pg_cron job `recover-missing-invoices`
 * (migrasi 20261010140000_cron_recover_missing_invoices.sql — harus
 * dijadwalkan manual setelah deploy jika migrasi tidak dijalankan otomatis).
 *
 * Mengirim invoice untuk booking non-batal yang dibuat 5 menit–24 jam
 * yang lalu, punya nomor tamu, dan belum punya baris `invoices`.
 * Tidak mengirim ulang booking yang sudah punya record.
 */

async function handle(): Promise<Response> {
  const result = await recoverMissingInvoices(supabaseAdmin as never);
  if (!result.ok) {
    return Response.json(result, { status: 500 });
  }
  return Response.json(result);
}

export const Route = createFileRoute("/api/cron/recover-missing-invoices")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});
