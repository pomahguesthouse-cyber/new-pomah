/**
 * Regresi insiden Lana Arifah, 26 Nov 2026 (thread 5a539273-9653-4c2f-872e-2163c49bb2a1).
 *
 * Tamu menulis "admin". Bot membalas kalimat serah-terima, lalu tetap
 * menjawab sendiri (sapaan susulan, ketersediaan, DP). Setelah handoff:
 *   1. flag booking + jeda thread tersimpan
 *   2. pesan tamu berikutnya tidak dibalas
 *   3. pesan proaktif (nudge form, fallback) ditekan
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ADMIN_HANDOFF_PAUSE_MS,
  buildAdminHandoffGuestReply,
  detectGuestHandoffTrigger,
  triggerAdminHandoff,
} from "../src/services/wa-autoreply/admin-handoff";
import {
  isPauseActive,
  loadThreadHandoverSnapshot,
  shouldSuppressBotSend,
} from "../src/services/wa-autoreply/handover-guard";
import { shouldSkipForHumanHandoff } from "../src/services/frustration-detector";
import { decideInboundEnqueue } from "../src/services/wa-inbound-enqueue";
import { planBookingFormFollowup, type FollowupTokenRow } from "../src/services/booking-form-followup.service";
import { processBookingState } from "../src/ai/state-machine/booking-machine";

const PHONE = "62895378220195";
const THREAD = "5a539273-9653-4c2f-872e-2163c49bb2a1";
const NOW = new Date("2026-11-26T04:26:00.000Z"); // 11:26 WIB

// ── 1. "admin" adalah permintaan manusia, kalimatnya persis insiden ────────
assert.equal(detectGuestHandoffTrigger("admin"), "admin_request");
const guestReply = buildAdminHandoffGuestReply("admin_request");
assert.match(guestReply, /Pesan Kakak sudah kami teruskan ke admin Pomah Guesthouse/);
assert.match(guestReply, /Admin akan membalas langsung di chat ini/);

// ── 2. Handoff menulis jeda thread DAN flag booking ────────────────────────
const updates: Array<[string, Record<string, unknown>]> = [];
const rpcCalls: Array<{ fn: string; args: any }> = [];
const db = {
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { ai_paused_until: null, ai_auto: true }, error: null }),
        eq: () => ({
          limit: async () => ({ data: [{ id: "tk-open" }], error: null }),
        }),
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: async () => {
        updates.push([table, patch]);
        return { error: null };
      },
    }),
  }),
  rpc: async (fn: string, args: any) => {
    rpcCalls.push({ fn, args });
    return { data: null, error: null };
  },
};

const handed = await triggerAdminHandoff(
  db,
  {
    phone: PHONE,
    threadId: THREAD,
    kind: "admin_request",
    triggerMessage: "admin",
    guestName: "Lana Arifah",
    now: NOW,
    notify: false,
  },
  {
    createTicket: async () => ({ id: "tk-lana" }),
    notify: async () => {
      throw new Error("notify dimatikan");
    },
  },
);

const pauseUntil = new Date(NOW.getTime() + ADMIN_HANDOFF_PAUSE_MS).toISOString();
assert.equal(handed.ticketId, "tk-lana");
assert.equal(handed.pausedUntil, pauseUntil);
assert.deepEqual(updates[0], ["whatsapp_threads", { ai_paused_until: pauseUntil }]);
const flagCall = rpcCalls.find((c) => c.fn === "update_booking_state");
assert.ok(flagCall, "context.handoff harus diset lewat update_booking_state");
assert.equal(flagCall!.args.p_phone, PHONE);
assert.equal(flagCall!.args.p_context.handoff, true);
assert.ok(flagCall!.args.p_context.handoff_at);

// ── 3. Pesan berikutnya tidak dibalas, meski auto_reply SQL masih true ─────
const sixHoursLater = new Date(NOW.getTime() + 60 * 60_000);
assert.equal(
  shouldSuppressBotSend({
    aiPausedUntil: pauseUntil,
    handoffFlag: false,
    hasOpenTicket: false,
    now: sixHoursLater,
  }),
  true,
  "jeda thread saja wajib membisukan bot (lubang 26 Nov: flag tidak dicek)",
);
assert.equal(
  shouldSkipForHumanHandoff({
    handoffFlag: false,
    aiPausedUntil: pauseUntil,
    hasOpenTicket: true,
    now: sixHoursLater,
  }),
  true,
);
assert.equal(
  shouldSuppressBotSend({
    aiPausedUntil: null,
    handoffFlag: true,
    hasOpenTicket: true,
    now: new Date(NOW.getTime() + ADMIN_HANDOFF_PAUSE_MS + 60_000),
  }),
  true,
  "tiket terbuka + flag menahan bot melewati jeda 6 jam sampai staf melepas",
);

const enqueue = decideInboundEnqueue({
  autoReplyEnabled: false,
  queuedForMessage: false,
  activeQueueForThread: false,
  outboundAfter: false,
});
assert.equal(enqueue.action, "skip");
if (enqueue.action === "skip") assert.equal(enqueue.reason, "auto_reply_disabled");

// Snapshot yang dibaca ulang tepat sebelum kirim (giliran yang sudah lewat pagar awal).
const reread = await loadThreadHandoverSnapshot(db as any, {
  threadId: THREAD,
  phone: PHONE,
  now: sixHoursLater,
});
assert.equal(reread.aiAuto, true);
assert.equal(isPauseActive(reread.aiPausedUntil, sixHoursLater), false, "mock jeda kosong = tidak aktif");
// Pakai jeda hasil handoff, bukan baris mock yang kosong.
assert.equal(
  shouldSuppressBotSend({ ...reread, aiPausedUntil: handed.pausedUntil, handoffFlag: true, now: sixHoursLater }),
  true,
);

// ── 4. Setelah jeda habis DAN tiket/flag lepas, bot boleh menjawab ─────────
assert.equal(
  shouldSuppressBotSend({
    aiAuto: true,
    aiPausedUntil: pauseUntil,
    handoffFlag: false,
    hasOpenTicket: false,
    now: new Date(NOW.getTime() + ADMIN_HANDOFF_PAUSE_MS + 1000),
  }),
  false,
  "batas 6 jam: tanpa tiket dan tanpa flag, bot aktif lagi",
);
assert.equal(
  shouldSuppressBotSend({
    handoffFlag: true,
    hasOpenTicket: false,
    aiPausedUntil: null,
    now: NOW,
  }),
  false,
  "flag usang setelah staf melepas tidak boleh membisukan bot",
);
assert.equal(shouldSuppressBotSend({ aiAuto: false, now: NOW }), true);

// ── 5. State machine tidak menjawab ketersediaan / DP saat handoff ─────────
const silent = await processBookingState(
  { supabaseAdmin: {}, rooms: [], property: {}, today: "2026-11-26" } as any,
  PHONE,
  "Family Suite 100 kosong April? DP 50% ya",
  {
    state: "COLLECTING_DATA",
    context: { handoff: true, checkIn: "2026-04-10", roomName: "Family Suite 100" },
    updated_at: NOW.toISOString(),
  },
);
assert.equal(silent.handled, true);
assert.equal(silent.silent, true);
assert.equal(silent.reply, undefined);

// ── 6. Nudge / expiry proaktif ditekan ─────────────────────────────────────
const token = (over: Partial<FollowupTokenRow> = {}): FollowupTokenRow => ({
  id: "id-1",
  token: "tok-1",
  phone: PHONE,
  thread_id: THREAD,
  created_at: new Date(NOW.getTime() - 12 * 60_000).toISOString(),
  expires_at: new Date(NOW.getTime() + 18 * 60_000).toISOString(),
  reminder_sent_at: null,
  ...over,
});
const awaiting = (row: FollowupTokenRow, handoff: boolean) =>
  new Map([[row.phone, { state: "AWAITING_FORM_SUBMISSION", formToken: row.token, handoff }]]);

const live = token();
assert.equal(
  planBookingFormFollowup({
    tokens: [live],
    stateByPhone: awaiting(live, true),
    blockedPhones: new Set(),
    nowMs: NOW.getTime(),
  }).nudge.length,
  0,
  "nudge form tidak boleh terkirim saat handoff",
);
const dead = token({ expires_at: new Date(NOW.getTime() - 1000).toISOString() });
const expired = planBookingFormFollowup({
  tokens: [dead],
  stateByPhone: awaiting(dead, true),
  blockedPhones: new Set(),
  nowMs: NOW.getTime(),
});
assert.equal(expired.expire.length, 1);
assert.equal(expired.expire[0].notify, false, "pesan kedaluwarsa proaktif ditekan");
assert.equal(expired.expire[0].resetState, true, "token tetap ditutup");

const pausedPhone = token();
assert.equal(
  planBookingFormFollowup({
    tokens: [pausedPhone],
    stateByPhone: awaiting(pausedPhone, false),
    blockedPhones: new Set([PHONE]),
    nowMs: NOW.getTime(),
  }).nudge.length,
  0,
  "nomor yang jeda/ai_auto=false (di-block cron) tidak di-nudge",
);

// ── 7. Setiap jalur kirim di worker memakai pagar yang sama ────────────────
const workerSrc = readFileSync(resolve(process.cwd(), "src/services/wa-autoreply.service.ts"), "utf8");
for (const marker of [
  "quick ack suppressed",
  "Zombie rescue suppressed",
  "Brochure/photo suppressed",
  "Facility brochure suppressed",
  "LLM suppressed",
  "Outbound dropped — handover active",
]) {
  assert.ok(workerSrc.includes(marker), `worker harus menekan: ${marker}`);
}
const dropAt = workerSrc.indexOf("Outbound dropped — handover active");
const persistAt = workerSrc.indexOf("const outboundRowId = await saveOutboundMessage", dropAt);
assert.ok(dropAt > 0 && persistAt > dropAt, "balasan final dicek sebelum disimpan/dikirim");
assert.ok(
  !workerSrc.includes("handoff-ack"),
  "ack susulan 15 menit tidak boleh dikirim setelah handoff",
);
const followupSrc = readFileSync(resolve(process.cwd(), "src/routes/api.cron.booking-form-followup.ts"), "utf8");
assert.ok(followupSrc.includes("shouldSuppressBotSend"));
assert.ok(followupSrc.includes("handoff: ctx.handoff === true"));
const reviewSrc = readFileSync(resolve(process.cwd(), "supabase/functions/send-review-request/index.ts"), "utf8");
assert.ok(reviewSrc.includes("ai_paused_until"));

console.log("✓ wa handover: admin sets pause+flag, later replies and nudges stay silent");
