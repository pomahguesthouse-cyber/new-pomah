import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppMessage } from "@/services/whatsapp.service";
import { saveOutboundMessage } from "@/repositories/message.repository";
import { updateBookingState, type BookingContext } from "@/ai/state-machine/booking-machine";
import {
  planBookingFormFollowup,
  buildNudgeMessage,
  FORM_EXPIRY_MESSAGE,
  type FollowupStateRow,
  type FollowupTokenRow,
} from "@/services/booking-form-followup.service";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Cron follow-up form booking sekali pakai.
 *
 * Dijalankan tiap 1 menit oleh pg_cron job `booking-form-followup`. Dua fase:
 *   1. NUDGE  — token pending berumur > 10 menit yang belum pernah di-nudge:
 *      satu pengingat hangat + tawaran melanjutkan via chat, lalu stempel
 *      `reminder_sent_at` agar tidak pernah terkirim dua kali.
 *   2. EXPIRE — token pending yang lewat `expires_at`: ditandai `expired`
 *      secara atomik, state dikembalikan ke COLLECTING_DATA, dan tamu diberi
 *      pesan fallback yang identik dengan fallback reaktif di `booking-machine`.
 *
 * Seluruh logika keputusan ada di `services/booking-form-followup.service.ts`
 * (murni, teruji lewat `scripts/test-booking-form-followup.ts`). Route ini
 * hanya mengurus IO: ambil data, klaim atomik, kirim, catat.
 *
 * Akses: tanpa secret, sama seperti endpoint cron lain di project ini — tidak
 * ada input dari luar, seluruh keputusan diambil dari data DB.
 */

const ACTIVE_QUEUE_STATUSES = ["pending", "waiting", "processing", "retrying"];

/** Nomor yang tidak boleh disentuh bot saat ini (handoff manusia / worker aktif). */
async function collectBlockedPhones(phones: string[]): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (phones.length === 0) return blocked;

  const [handoff, queue] = await Promise.all([
    (supabaseAdmin as any).from("handoff_tickets").select("phone").in("phone", phones).eq("status", "open"),
    (supabaseAdmin as any)
      .from("wa_conversation_queue")
      .select("phone")
      .in("phone", phones)
      .in("status", ACTIVE_QUEUE_STATUSES),
  ]);

  for (const r of (handoff.data ?? []) as Array<{ phone: string }>) blocked.add(r.phone);
  for (const r of (queue.data ?? []) as Array<{ phone: string }>) blocked.add(r.phone);
  return blocked;
}

async function fetchStates(
  phones: string[],
): Promise<{ plain: Map<string, FollowupStateRow>; contexts: Map<string, BookingContext> }> {
  const plain = new Map<string, FollowupStateRow>();
  const contexts = new Map<string, BookingContext>();
  if (phones.length === 0) return { plain, contexts };

  const { data } = await (supabaseAdmin as any)
    .from("wa_booking_states")
    .select("phone, state, context")
    .in("phone", phones);

  for (const r of (data ?? []) as Array<{ phone: string; state: string; context: any }>) {
    const ctx = (r.context ?? {}) as BookingContext;
    plain.set(r.phone, { state: r.state, formToken: ctx.formToken });
    contexts.set(r.phone, ctx);
  }
  return { plain, contexts };
}

async function getPropertyDefaults(): Promise<{ waToken: string | null; baseUrl: string }> {
  const { data } = await (supabaseAdmin as any)
    .from("properties")
    .select("wpp_token, public_domain")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const domain = (data?.public_domain as string | null) ?? null;
  const baseUrl = domain
    ? (domain.startsWith("http") ? domain : `https://${domain}`).replace(/\/+$/, "")
    : "https://pomahguesthouse.com";

  return { waToken: (data?.wpp_token as string | null) ?? null, baseUrl };
}

async function resolveThreadId(row: FollowupTokenRow): Promise<string | null> {
  if (row.thread_id) return row.thread_id;
  const { data } = await (supabaseAdmin as any)
    .from("whatsapp_threads")
    .select("id")
    .eq("phone", row.phone)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Kirim ke tamu + catat sebagai pesan outbound, supaya muncul di inbox admin
 * dan terbaca sebagai riwayat oleh giliran bot berikutnya. Tanpa pencatatan
 * ini, LLM tidak tahu nudge pernah dikirim dan berpotensi mengulanginya.
 */
async function sendAndRecord(params: {
  waToken: string;
  phone: string;
  message: string;
  threadId: string | null;
  agent: string;
}): Promise<boolean> {
  const result = await sendWhatsAppMessage(params.waToken, params.phone, params.message);
  if (!result.ok) {
    console.warn(
      `[booking-form-followup] gagal kirim WA ke ${params.phone.slice(-6)}: ${result.error ?? "unknown"}`,
    );
    return false;
  }
  if (params.threadId) {
    try {
      await saveOutboundMessage(supabaseAdmin as any, {
        threadId: params.threadId,
        body: params.message,
        metadata: { agent: params.agent },
      });
    } catch (e) {
      // Non-fatal: pesan sudah sampai ke tamu, hanya arsipnya yang gagal.
      console.warn("[booking-form-followup] gagal simpan outbound:", e);
    }
  }
  return true;
}

async function handle(): Promise<Response> {
  const nowMs = Date.now();

  const { data: pendingRows, error } = await (supabaseAdmin as any)
    .from("booking_form_tokens")
    .select("id, token, phone, thread_id, expires_at, created_at, reminder_sent_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[booking-form-followup] query gagal:", error.message);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const tokens = (pendingRows ?? []) as FollowupTokenRow[];
  if (tokens.length === 0) {
    return Response.json({ ok: true, checked: 0, nudged: 0, expired: 0 });
  }

  const phones = Array.from(new Set(tokens.map((t) => t.phone)));
  const [blockedPhones, states] = await Promise.all([collectBlockedPhones(phones), fetchStates(phones)]);

  const plan = planBookingFormFollowup({
    tokens,
    stateByPhone: states.plain,
    blockedPhones,
    nowMs,
  });

  if (plan.nudge.length === 0 && plan.expire.length === 0) {
    return Response.json({ ok: true, checked: tokens.length, nudged: 0, expired: 0 });
  }

  const { waToken, baseUrl } = await getPropertyDefaults();
  let nudged = 0;
  let expired = 0;

  // ── Fase 1: NUDGE ────────────────────────────────────────────────────────
  for (const row of plan.nudge) {
    if (!waToken) {
      console.warn("[booking-form-followup] wpp_token kosong — nudge dilewati");
      break;
    }

    // Klaim atomik: hanya satu eksekusi cron yang boleh mengirim nudge ini.
    const { data: claimed } = await (supabaseAdmin as any)
      .from("booking_form_tokens")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .is("reminder_sent_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const ok = await sendAndRecord({
      waToken,
      phone: row.phone,
      message: buildNudgeMessage(row, baseUrl, nowMs),
      threadId: await resolveThreadId(row),
      agent: "booking-form-followup:nudge",
    });

    if (ok) {
      nudged += 1;
    } else {
      // Kirim gagal → lepas stempelnya supaya eksekusi berikutnya mencoba lagi
      // (retry dulu, bukan diam-diam kehilangan nudge).
      await (supabaseAdmin as any)
        .from("booking_form_tokens")
        .update({ reminder_sent_at: null })
        .eq("id", row.id);
    }
  }

  // ── Fase 2: EXPIRE + fallback ke chat ────────────────────────────────────
  for (const item of plan.expire) {
    const { row } = item;

    // Klaim atomik status expired — dilakukan lebih dulu agar token mati selalu
    // tertutup, bahkan bila pengiriman pesannya nanti dilewati.
    const { data: claimed } = await (supabaseAdmin as any)
      .from("booking_form_tokens")
      .update({ status: "expired" })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    expired += 1;

    // Catatan: `booking_form_send_logs` sengaja tidak disentuh — tabel itu
    // mengaudit hasil PENGIRIMAN tautan, sedangkan kedaluwarsanya token adalah
    // siklus hidup berbeda yang sudah tercatat di `booking_form_tokens.status`.

    if (!item.resetState) continue;

    const { formToken: _dropped, ...restContext } = (states.contexts.get(row.phone) ?? {}) as BookingContext;

    // Reset state DULU. Kalau pengiriman WA gagal, tamu tetap bisa melanjutkan
    // via chat pada pesan berikutnya — state menggantung di
    // AWAITING_FORM_SUBMISSION jauh lebih merusak daripada pesan yang hilang.
    try {
      await updateBookingState(supabaseAdmin as any, row.phone, "COLLECTING_DATA", restContext);
    } catch (e) {
      console.warn("[booking-form-followup] gagal reset state:", e);
      continue;
    }

    if (!item.notify || !waToken) continue;

    await sendAndRecord({
      waToken,
      phone: row.phone,
      message: FORM_EXPIRY_MESSAGE,
      threadId: await resolveThreadId(row),
      agent: "booking-form-followup:expired",
    });
  }

  if (nudged > 0 || expired > 0) {
    console.info(`[booking-form-followup] nudged=${nudged} expired=${expired} checked=${tokens.length}`);
  }

  return Response.json({ ok: true, checked: tokens.length, nudged, expired });
}

export const Route = createFileRoute("/api/cron/booking-form-followup")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});
