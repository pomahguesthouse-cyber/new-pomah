import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Cron-driven payment deadline enforcer.
 *
 * Dijalankan setiap 1 menit oleh pg_cron job `expire-unpaid-bookings`.
 * Logika:
 *   1. Cari semua bookings dengan status='pending' AND payment_status='unpaid'
 *      AND expires_at sudah lewat — berlaku sama untuk semua channel (web,
 *      chatbot WA, webchat, admin) karena expires_at diset di semua titik insert.
 *   2. Set status='expired' untuk baris-baris tersebut.
 *   3. Booking partial (sudah DP) atau paid tidak pernah tersentuh — filter
 *      payment_status='unpaid' adalah satu-satunya gerbang.
 *
 * Kamar otomatis bebas kembali tanpa perubahan kode lain: query availability
 * (pickAvailableRooms di booking.tool.ts/public.functions.ts, RPC
 * room_type_availability_detail) semuanya memfilter
 * status IN ('pending','confirmed','checked_in') — 'expired' tidak termasuk.
 *
 * Tidak ada notifikasi manager di sini (beda dengan booking-stuck-monitor):
 * booking expired adalah hasil normal dari tamu yang tidak membayar tepat
 * waktu, bukan anomali yang perlu alert.
 *
 * Akses: tidak ada secret — sama dengan endpoint cron lain di project ini
 * yang hanya menjalankan pekerjaan internal berdasarkan data DB.
 */

async function handle(): Promise<Response> {
  const nowIso = new Date().toISOString();

  const { data: candidates, error: findErr } = await (supabaseAdmin as any)
    .from("bookings")
    .select("id, reference_code")
    .eq("status", "pending")
    .eq("payment_status", "unpaid")
    .lt("expires_at", nowIso);

  if (findErr) {
    console.error("[expire-bookings] query failed:", findErr.message);
    return Response.json({ ok: false, error: findErr.message }, { status: 500 });
  }

  const rows = (candidates ?? []) as Array<{ id: string; reference_code: string | null }>;

  if (rows.length === 0) {
    return Response.json({ ok: true, checked: 0, expired: 0 });
  }

  const ids = rows.map((r) => r.id);
  const { error: updateErr } = await (supabaseAdmin as any)
    .from("bookings")
    .update({ status: "expired" })
    .in("id", ids);

  if (updateErr) {
    console.error("[expire-bookings] update failed:", updateErr.message);
    return Response.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  console.info(
    `[expire-bookings] expired ${ids.length} unpaid booking(s): ${rows.map((r) => r.reference_code ?? r.id.slice(0, 8)).join(", ")}`,
  );

  return Response.json({ ok: true, checked: rows.length, expired: ids.length });
}

export const Route = createFileRoute("/api/cron/expire-bookings")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});
