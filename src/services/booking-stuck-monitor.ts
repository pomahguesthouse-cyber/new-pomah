import type { SupabaseClient } from "@supabase/supabase-js";
import { getRequiredField, type BookingState } from "@/ai/state-machine/booking-machine";
import { notifyBookingStuck } from "@/services/manager-notifier.service";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Booking-flow stuck monitor.
 *
 * Hanya sesi yang `updated_at`-nya (dan awal episode-nya) masih dalam 24 jam
 * terakhir. Sesi lebih tua diabaikan. `alerted` menghitung notifikasi yang
 * benar-benar terkirim. Jika satu nomor punya beberapa thread, yang dipakai
 * adalah thread dengan pesan terbaru (`last_message_at`).
 */

export const STUCK_STATES = [
  "AWAITING_NAME",
  "CONFIRMING_NAME",
  "AWAITING_EMAIL",
  "CONFIRMING_PHONE",
  "AWAITING_PHONE",
  "CONFIRMING_BOOKING",
  "COLLECTING_DATA",
] as const;

export const STUCK_THRESHOLD_MS = 90_000;
export const STUCK_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface ThreadActivityRow {
  id: string;
  phone: string;
  last_message_at?: string | null;
}

/** Thread dengan `last_message_at` paling baru per nomor. Timestamp kosong kalah. */
export function pickThreadWithLatestMessage(rows: ThreadActivityRow[]): Map<string, string> {
  const best = new Map<string, { id: string; at: number }>();
  for (const row of rows) {
    const parsed = Date.parse(row.last_message_at ?? "");
    const at = Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
    const prev = best.get(row.phone);
    if (!prev || at > prev.at) best.set(row.phone, { id: row.id, at });
  }
  const out = new Map<string, string>();
  for (const [phone, value] of best) out.set(phone, value.id);
  return out;
}

/** True bila timestamp ada dan usianya tidak lebih dari jendela lookback. */
export function isWithinLookback(iso: string, now: number, lookbackMs = STUCK_LOOKBACK_MS): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  return age >= 0 && age <= lookbackMs;
}

type Db = SupabaseClient<any, any, any>;
type NotifyFn = typeof notifyBookingStuck;

export async function runBookingStuckMonitor(
  db: Db,
  opts?: { now?: number; notify?: NotifyFn },
): Promise<{ ok: true; checked: number; alerted: number } | { ok: false; error: string }> {
  const now = opts?.now ?? Date.now();
  const notify = opts?.notify ?? notifyBookingStuck;
  const cutoffIso = new Date(now - STUCK_THRESHOLD_MS).toISOString();
  const freshSinceIso = new Date(now - STUCK_LOOKBACK_MS).toISOString();

  const { data: states, error: stateErr } = await (db as any)
    .from("wa_booking_states")
    .select("phone, state, updated_at, context")
    .in("state", STUCK_STATES as unknown as string[])
    .lt("updated_at", cutoffIso)
    .gte("updated_at", freshSinceIso);

  if (stateErr) {
    console.error("[booking-stuck-monitor] state query failed:", stateErr.message);
    return { ok: false, error: stateErr.message };
  }

  const candidates = (states ?? []) as Array<{
    phone: string;
    state: string;
    updated_at: string;
    context: any;
  }>;

  if (candidates.length === 0) {
    return { ok: true, checked: 0, alerted: 0 };
  }

  const phones = candidates.map((c) => c.phone);

  const { data: threadRows } = await (db as any)
    .from("whatsapp_threads")
    .select("id, phone, last_message_at")
    .in("phone", phones);

  const threadByPhone = pickThreadWithLatestMessage(
    (threadRows ?? []) as ThreadActivityRow[],
  );

  const { data: handoffRows } = await (db as any)
    .from("handoff_tickets")
    .select("phone, status")
    .in("phone", phones)
    .eq("status", "open");

  const handoffPhones = new Set<string>();
  for (const h of (handoffRows ?? []) as Array<{ phone: string; status: string }>) {
    handoffPhones.add(h.phone);
  }

  const { data: activeQueueRows } = await (db as any)
    .from("wa_conversation_queue")
    .select("phone, status")
    .in("phone", phones)
    .in("status", ["pending", "waiting", "processing", "retrying"]);

  const busyPhones = new Set<string>();
  for (const q of (activeQueueRows ?? []) as Array<{ phone: string }>) {
    busyPhones.add(q.phone);
  }

  let alerted = 0;

  await Promise.all(
    candidates.map(async (c) => {
      if (!isWithinLookback(c.updated_at, now)) return;

      const threadId = threadByPhone.get(c.phone) ?? null;
      if (!threadId) return;
      if (handoffPhones.has(c.phone)) return;
      if (busyPhones.has(c.phone)) return;

      const { data: recentMsgs } = await (db as any)
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

      const lastMsg = msgs[0];
      if (lastMsg.direction !== "in") return;

      const lastOutboundIdx = msgs.findIndex((m) => m.direction === "out");
      let episodeStartMsg: (typeof msgs)[0];
      if (lastOutboundIdx === -1) {
        episodeStartMsg = msgs[msgs.length - 1];
      } else {
        episodeStartMsg = msgs[lastOutboundIdx - 1];
      }
      if (!episodeStartMsg) return;

      const episodeStartMs = Date.parse(episodeStartMsg.sent_at);
      if (!Number.isFinite(episodeStartMs)) return;
      if (!isWithinLookback(episodeStartMsg.sent_at, now)) return;

      const stuckMs = now - episodeStartMs;
      if (stuckMs < STUCK_THRESHOLD_MS) return;

      const guestName = typeof c.context?.guestName === "string" ? c.context.guestName : null;

      const sent = await notify(db, {
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

      if (sent) alerted += 1;
    }),
  );

  return {
    ok: true,
    checked: candidates.length,
    alerted,
  };
}
