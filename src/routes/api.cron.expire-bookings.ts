import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { shouldExpireUnpaidBooking } from "@/lib/booking-expiry";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Cron-driven payment deadline enforcer.
 *
 * Dijalankan setiap 1 menit oleh pg_cron job `expire-unpaid-bookings`.
 * Logika:
 *   1. Cari booking status='pending' AND payment_status='unpaid'
 *      AND expires_at sudah lewat. Bayar di tempat (expires_at null, atau
 *      payment_method onsite / "Bayar di tempat saat check-in") tidak ikut.
 *   2. Set status='expired' untuk baris yang lolos shouldExpireUnpaidBooking.
 *   3. Booking partial (sudah DP) atau paid tidak pernah tersentuh — filter
 *      payment_status='unpaid' adalah satu-satunya gerbang.
 *
 * Kamar otomatis bebas kembali tanpa perubahan kode lain: query availability
 * (pickAvailableRooms di booking.tool.ts/public.functions.ts, RPC
 * room_type_availability_detail) semuanya memfilter
 * status IN ('pending','confirmed','checked_in') — 'expired' tidak termasuk.
 *
 *   4. Kirim notifikasi WhatsApp ke manajemen untuk setiap booking
 *      yang baru saja expired (fire-and-forget, dedupe per booking id).
 *
 * Akses: tidak ada secret — sama dengan endpoint cron lain di project ini
 * yang hanya menjalankan pekerjaan internal berdasarkan data DB.
 */

async function handle(): Promise<Response> {
  const nowIso = new Date().toISOString();

  const nowMs = Date.parse(nowIso);
  const { data: candidates, error: findErr } = await (supabaseAdmin as any)
    .from("bookings")
    .select("id, reference_code, status, payment_status, payment_method, expires_at")
    .eq("status", "pending")
    .eq("payment_status", "unpaid")
    .not("expires_at", "is", null)
    .lt("expires_at", nowIso)
    // Saringan kasar. Kalimat "Bayar di tempat saat check-in" disaring lagi di JS.
    .or("payment_method.is.null,payment_method.not.in.(onsite,cash,pay_at_checkin,bayar_di_tempat)");

  if (findErr) {
    console.error("[expire-bookings] query failed:", findErr.message);
    return Response.json({ ok: false, error: findErr.message }, { status: 500 });
  }

  const rows = ((candidates ?? []) as Array<{
    id: string;
    reference_code: string | null;
    status?: string | null;
    payment_status?: string | null;
    payment_method?: string | null;
    expires_at?: string | null;
  }>).filter((row) => shouldExpireUnpaidBooking(row, nowMs));

  if (rows.length === 0) {
    return Response.json({ ok: true, checked: (candidates ?? []).length, expired: 0 });
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

  // Notifikasi manajemen — non-blocking, kegagalan tidak membatalkan expiry.
  try {
    const { notifyBookingExpired } = await import("@/services/manager-notifier.service");
    await Promise.all(ids.map((id) => notifyBookingExpired(supabaseAdmin as any, id)));
  } catch (e) {
    console.warn("[expire-bookings] notifikasi manajemen gagal (non-fatal):", e);
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
