import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyBookingStuck } from "@/services/manager-notifier.service";
import { getRequiredField, type BookingState } from "@/ai/state-machine/booking-machine";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Cron-driven booking-flow stuck monitor.
 *
 * Dijalankan setiap 1 menit oleh pg_cron job `booking-stuck-monitor`.
 * Logika:
 *   1. Cari semua wa_booking_states di state data-entry (CONFIRMING_PHONE,
 *      AWAITING_EMAIL, dst.) yang updated_at sudah lebih dari 90 detik lalu.
 *   2. Untuk masing-masing phone, ambil pesan WA terakhir di threadnya.
 *   3. Anggap "macet" jika pesan terakhir adalah inbound (direction='in')
 *      dan sudah > 90 detik tanpa balasan outbound — artinya tamu sudah
 *      mengirim sesuatu tapi bot belum membalas.
 *   4. Kirim alert ke super admin via WhatsApp/Telegram (dedupe per inbound
 *      message timestamp sehingga tidak spam).
 *
 * Akses: tidak ada secret — sama dengan endpoint cron lain di project
 * ini (drain-wa-queue, run-article-schedules) yang hanya menjalankan
 * pekerjaan internal berdasarkan data DB, tidak ada vektor input dari luar.
 */

const STUCK_STATES = [
  "AWAITING_NAME",
  "CONFIRMING_NAME",
  "AWAITING_EMAIL",
  "CONFIRMING_PHONE",
  "AWAITING_PHONE",
  "CONFIRMING_BOOKING",
  "COLLECTING_DATA",
] as const;

// Ambang "macet": pesan inbound terakhir sudah lebih lama dari ini tanpa
// balasan. Harus jelas DI ATAS window balasan normal bot — smart delay
// menunggu hingga maxWaitMs (12 detik) untuk mengumpulkan burst, lalu butuh
// waktu antrian + pemanggilan LLM (bisa belasan detik). Threshold 10 detik
// yang lama memicu banyak false-positive "macet" untuk balasan yang sebenarnya
// hanya lambat. 90 detik memastikan ini benar-benar kemacetan, bukan latency.
const STUCK_THRESHOLD_MS = 90_000;

async function handle(): Promise<Response> {
  const cutoffIso = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();

  const { data: states, error: stateErr } = await (supabaseAdmin as any)
    .from("wa_booking_states")
    .select("phone, state, updated_at, context")
    .in("state", STUCK_STATES as unknown as string[])
    .lt("updated_at", cutoffIso);

  if (stateErr) {
    console.error("[booking-stuck-monitor] state query failed:", stateErr.message);
    return Response.json({ ok: false, error: stateErr.message }, { status: 500 });
  }

  const candidates = (states ?? []) as Array<{
    phone: string;
    state: string;
    updated_at: string;
    context: any;
  }>;

  if (candidates.length === 0) {
    return Response.json({ ok: true, checked: 0, alerted: 0 });
  }

  const phones = candidates.map((c) => c.phone);

  // Ambil thread id untuk setiap phone (untuk related_id pada notif).
  const { data: threadRows } = await (supabaseAdmin as any)
    .from("whatsapp_threads")
    .select("id, phone")
    .in("phone", phones);

  const threadByPhone = new Map<string, string>();
  for (const t of (threadRows ?? []) as Array<{ id: string; phone: string }>) {
    threadByPhone.set(t.phone, t.id);
  }

  // Hindari notifikasi macet untuk nomor yang sudah di-handoff ke manusia.
  const { data: handoffRows } = await (supabaseAdmin as any)
    .from("handoff_tickets")
    .select("phone, status")
    .in("phone", phones)
    .eq("status", "open");

  const handoffPhones = new Set<string>();
  for (const h of (handoffRows ?? []) as Array<{ phone: string; status: string }>) {
    handoffPhones.add(h.phone);
  }

  // Skip alert juga untuk nomor yang queue worker-nya masih aktif memproses
  // (pending/waiting/processing/retrying). Tanpa guard ini, monitor akan
  // memicu "BOOKING FLOW MACET" padahal worker sedang menyusun balasan.
  const { data: activeQueueRows } = await (supabaseAdmin as any)
    .from("wa_conversation_queue")
    .select("phone, status")
    .in("phone", phones)
    .in("status", ["pending", "waiting", "processing", "retrying"]);

  const busyPhones = new Set<string>();
  for (const q of (activeQueueRows ?? []) as Array<{ phone: string }>) {
    busyPhones.add(q.phone);
  }

  let alerted = 0;
  const now = Date.now();

  await Promise.all(
    candidates.map(async (c) => {
      const threadId = threadByPhone.get(c.phone) ?? null;
      if (!threadId) return;

      // Lewati notifikasi jika tiket handoff masih terbuka untuk nomor ini.
      if (handoffPhones.has(c.phone)) return;
      // Lewati jika queue worker masih aktif → biarkan worker selesai dulu.
      if (busyPhones.has(c.phone)) return;

      // Ambil 20 pesan terakhir untuk menentukan "episode kemacetan":
      // - Kalau pesan paling akhir adalah OUTBOUND → bot/human sudah balas
      //   → bukan macet, skip.
      // - Kalau paling akhir INBOUND, cari outbound terakhir sebelumnya,
      //   lalu ambil inbound PERTAMA setelah outbound itu sebagai anchor
      //   episode. Ini menjadi dedupeKey episode — notif hanya dikirim sekali
      //   per episode (bukan per pesan atau per window waktu).
      // Begitu ada balasan outbound baru, episode selesai dan monitor berhenti
      // secara otomatis — tidak butuh timer atau window.
      const { data: recentMsgs } = await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .select("id, direction, body, sent_at")
        .eq("thread_id", threadId)
        .order("sent_at", { ascending: false })
        .limit(20);

      const msgs = (recentMsgs ?? []) as Array<{
        id: string;
        direction: string;
        body: string | null;
        sent_at: string;
      }>;

      if (msgs.length === 0) return;

      // Pesan paling akhir (index 0 karena desc).
      const lastMsg = msgs[0];

      // Kalau balasan outbound sudah ada → bukan macet, stop.
      if (lastMsg.direction !== "in") return;

      // Cari outbound terakhir (maju dari belakang = asc dalam array desc).
      const lastOutboundIdx = msgs.findIndex((m) => m.direction === "out");

      // episodeStart = inbound PERTAMA setelah outbound terakhir.
      // Kalau tidak ada outbound sama sekali, episode dimulai dari inbound paling awal.
      let episodeStartMsg: (typeof msgs)[0];
      if (lastOutboundIdx === -1) {
        // Tidak ada outbound dalam 20 pesan — ambil inbound paling lama.
        episodeStartMsg = msgs[msgs.length - 1];
      } else {
        // Semua pesan sebelum lastOutboundIdx (index 0..lastOutboundIdx-1) adalah
        // inbound setelah outbound terakhir (karena urutan desc). Yang PALING AWAL
        // dalam episode = index lastOutboundIdx - 1.
        episodeStartMsg = msgs[lastOutboundIdx - 1];
      }

      const episodeStartMs = Date.parse(episodeStartMsg.sent_at);
      if (!Number.isFinite(episodeStartMs)) return;

      // Kemacetan dihitung dari pesan inbound PERTAMA episode, bukan terakhir.
      const stuckMs = now - episodeStartMs;
      if (stuckMs < STUCK_THRESHOLD_MS) return;

      const guestName = typeof c.context?.guestName === "string" ? c.context.guestName : null;

      await notifyBookingStuck(supabaseAdmin as any, {
        phone: c.phone,
        state: c.state,
        requiredField: getRequiredField(c.state as BookingState),
        stuckSeconds: Math.round(stuckMs / 1000),
        lastInboundBody: lastMsg.body,
        lastInboundAt: lastMsg.sent_at,
        episodeStartAt: episodeStartMsg.sent_at,
        threadId,
        guestName,
      });

      alerted += 1;
    }),
  );

  return Response.json({
    ok: true,
    checked: candidates.length,
    alerted,
  });
}

export const Route = createFileRoute("/api/cron/booking-stuck-monitor")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});
