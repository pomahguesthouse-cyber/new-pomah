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
  // Outbox pembayaran otomatis: kirim ulang notifikasi/sinkron invoice yang
  // gagal (klaim atomik di DB; aman bila tabel belum dimigrasi → 0).
  const { retryPendingPaymentNotices } = await import("@/services/payment-auto-apply");
  const paymentNotices = await retryPendingPaymentNotices(supabaseAdmin as never).catch(() => ({ retried: 0 }));
  const { maintainBankMutationPipeline } = await import("@/services/bank-mutation-match");
  const { productionMutationDeps } = await import("@/services/moota-runtime-deps");
  const { pollMootaMutations } = await import("@/services/moota-poll");
  const mutationDeps = productionMutationDeps(supabaseAdmin as never);
  const mutations = await maintainBankMutationPipeline(supabaseAdmin as never, mutationDeps).catch(() => ({ timeouts: 0, retriedUnmatched: 0 }));
  const mootaPoll = await pollMootaMutations({ supabase: supabaseAdmin as never, deps: mutationDeps }).catch((e: unknown) => ({
    ok: false,
    reason: e instanceof Error ? e.message : String(e),
  }));
  if (!result.ok) {
    return Response.json({ ...result, paymentNotices, mutations, mootaPoll }, { status: 500 });
  }
  return Response.json({ ...result, paymentNotices, mutations, mootaPoll });
}

export const Route = createFileRoute("/api/cron/recover-missing-invoices")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});
