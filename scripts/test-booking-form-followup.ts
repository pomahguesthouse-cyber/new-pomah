/**
 * Regresi follow-up form booking sekali pakai.
 *
 * Lubang yang ditutup fitur ini: tautan form ber-TTL 30 menit dikirim, state
 * pindah ke AWAITING_FORM_SUBMISSION, lalu tamu diam. Sebelum ada cron
 * `booking-form-followup`, token mati diam-diam dan percakapan berhenti tanpa
 * kesimpulan — fallback di `booking-machine` hanya jalan kalau tamu kebetulan
 * mengirim pesan lagi.
 *
 * Yang diuji di sini adalah invarian "jangan sampai bot mengirim pesan yang
 * bertentangan dengan gilirannya sendiri":
 *   1. nudge hanya untuk token yang MASIH ditunggu bot
 *   2. satu token = maksimum satu nudge
 *   3. token hampir kedaluwarsa tidak di-nudge (hindari nudge + expiry beruntun)
 *   4. token mati SELALU ditutup, meski pesannya tidak jadi dikirim
 *   5. kalimat kedaluwarsa proaktif == kalimat kedaluwarsa reaktif
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  planBookingFormFollowup,
  buildNudgeMessage,
  FORM_EXPIRY_MESSAGE,
  NUDGE_AFTER_MS,
  NUDGE_MIN_REMAINING_MS,
  type FollowupStateRow,
  type FollowupTokenRow,
} from "../src/services/booking-form-followup.service";

const NOW = Date.parse("2026-08-10T10:00:00.000Z");
const minutes = (n: number) => n * 60_000;

function token(over: Partial<FollowupTokenRow> = {}): FollowupTokenRow {
  return {
    id: over.id ?? "id-1",
    token: over.token ?? "tok-1",
    phone: over.phone ?? "628111111111",
    thread_id: over.thread_id ?? "thread-1",
    // Default: dibuat 12 menit lalu, kedaluwarsa 18 menit lagi → layak nudge.
    created_at: over.created_at ?? new Date(NOW - minutes(12)).toISOString(),
    expires_at: over.expires_at ?? new Date(NOW + minutes(18)).toISOString(),
    reminder_sent_at: over.reminder_sent_at ?? null,
  };
}

function awaiting(t: FollowupTokenRow): Map<string, FollowupStateRow> {
  return new Map([[t.phone, { state: "AWAITING_FORM_SUBMISSION", formToken: t.token }]]);
}

function plan(
  tokens: FollowupTokenRow[],
  stateByPhone: Map<string, FollowupStateRow>,
  blocked: string[] = [],
) {
  return planBookingFormFollowup({
    tokens,
    stateByPhone,
    blockedPhones: new Set(blocked),
    nowMs: NOW,
  });
}

// ─── 1. Nudge dasar ──────────────────────────────────────────────────────────

const t1 = token();
assert.equal(plan([t1], awaiting(t1)).nudge.length, 1, "token berumur 12 menit harus di-nudge");

// Belum cukup umur → belum di-nudge.
const muda = token({ created_at: new Date(NOW - (NUDGE_AFTER_MS - minutes(1))).toISOString() });
assert.equal(plan([muda], awaiting(muda)).nudge.length, 0);

// ─── 2. Satu token = maksimum satu nudge ─────────────────────────────────────

const sudah = token({ reminder_sent_at: new Date(NOW - minutes(1)).toISOString() });
assert.equal(
  plan([sudah], awaiting(sudah)).nudge.length,
  0,
  "token yang sudah pernah di-nudge tidak boleh di-nudge lagi",
);

// ─── 3. Nudge hanya bila bot MASIH menunggu token ini ────────────────────────

// (a) Tamu sudah lanjut via chat → state pindah.
assert.equal(
  plan([t1], new Map([[t1.phone, { state: "COLLECTING_DATA", formToken: t1.token }]])).nudge.length,
  0,
  "state sudah pindah — nudge akan bertentangan dengan giliran bot terakhir",
);

// (b) Tamu men-generate form baru → hanya token terbaru yang relevan.
assert.equal(
  plan([t1], new Map([[t1.phone, { state: "AWAITING_FORM_SUBMISSION", formToken: "tok-baru" }]])).nudge
    .length,
  0,
  "token lama tidak boleh memicu nudge setelah form baru dibuat",
);

// (c) Tidak ada state sama sekali.
assert.equal(plan([t1], new Map()).nudge.length, 0);

// (d) Admin manusia sudah mengambil alih / worker antrian sedang memproses.
assert.equal(
  plan([t1], awaiting(t1), [t1.phone]).nudge.length,
  0,
  "jangan menyela handoff manusia atau balasan worker yang sedang disusun",
);

// ─── 4. Token hampir mati tidak di-nudge ─────────────────────────────────────
// Skenario cron sempat mati: token berumur 27 menit, sisa 3 menit. Nudge di
// sini akan langsung disusul pesan kedaluwarsa — dua pesan yang bertentangan.

const nyaris = token({
  created_at: new Date(NOW - minutes(27)).toISOString(),
  expires_at: new Date(NOW + (NUDGE_MIN_REMAINING_MS - minutes(1))).toISOString(),
});
const planNyaris = plan([nyaris], awaiting(nyaris));
assert.equal(planNyaris.nudge.length, 0, "sisa waktu di bawah ambang — serahkan ke fase EXPIRE");
assert.equal(planNyaris.expire.length, 0, "belum lewat expires_at, jadi belum ditutup juga");

// ─── 5. Token mati SELALU ditutup ────────────────────────────────────────────

const mati = token({ expires_at: new Date(NOW - minutes(1)).toISOString() });

// (a) Bot masih menunggu → tutup, reset state, kirim pesan.
const e1 = plan([mati], awaiting(mati)).expire;
assert.deepEqual(
  { n: e1.length, reset: e1[0]?.resetState, notify: e1[0]?.notify },
  { n: 1, reset: true, notify: true },
);

// (b) Nomor sedang di-handoff → tetap ditutup & state direset, tapi TANPA
//     pesan ke tamu (admin manusia sedang memegang percakapan).
const e2 = plan([mati], awaiting(mati), [mati.phone]).expire;
assert.deepEqual(
  { n: e2.length, reset: e2[0]?.resetState, notify: e2[0]?.notify },
  { n: 1, reset: true, notify: false },
);

// (c) State sudah pindah (tamu keburu lanjut via chat) → token tetap ditutup,
//     tapi jangan sentuh state atau kirim apa pun.
const e3 = plan([mati], new Map([[mati.phone, { state: "CONFIRMING_BOOKING" }]])).expire;
assert.deepEqual(
  { n: e3.length, reset: e3[0]?.resetState, notify: e3[0]?.notify },
  { n: 1, reset: false, notify: false },
);

// (d) expires_at rusak/tidak terbaca → perlakukan sebagai mati, jangan
//     dibiarkan menggantung selamanya.
const rusak = token({ expires_at: "bukan-tanggal" });
assert.equal(plan([rusak], awaiting(rusak)).expire.length, 1);

// ─── 6. Isi pesan ────────────────────────────────────────────────────────────

const pesanNudge = buildNudgeMessage(t1, "https://pomahguesthouse.com", NOW);
assert.match(pesanNudge, /https:\/\/pomahguesthouse\.com\/booking\/form\/tok-1/);
assert.match(pesanNudge, /18 menit/, "sisa waktu harus disebut apa adanya");
assert.match(pesanNudge, /chat ini/i, "nudge wajib menawarkan jalur chat sebagai alternatif");

// Base URL bertrailing slash tidak boleh menghasilkan URL dobel slash.
assert.match(
  buildNudgeMessage(t1, "https://pomahguesthouse.com/", NOW),
  /com\/booking\/form\/tok-1/,
);

// ─── 7. Jalur proaktif dan reaktif harus berkata sama ────────────────────────
// `booking-machine` (reaktif, saat tamu mengirim pesan) wajib memakai konstanta
// yang sama, bukan menyalin kalimatnya.

// Dijalankan dari root repo (lihat script `test:booking-form-followup`).
const machineSrc = readFileSync(
  resolve(process.cwd(), "src/ai/state-machine/booking-machine.ts"),
  "utf8",
);
assert.ok(
  machineSrc.includes("FORM_EXPIRY_MESSAGE"),
  "booking-machine harus memakai FORM_EXPIRY_MESSAGE, bukan menyalin kalimatnya",
);
assert.ok(
  !/link formulir booking tadi sudah kedaluwarsa/.test(
    machineSrc.replace(/FORM_EXPIRY_MESSAGE/g, ""),
  ),
  "kalimat kedaluwarsa tidak boleh diduplikasi sebagai literal di booking-machine",
);
assert.match(FORM_EXPIRY_MESSAGE, /nama lengkap/, "fallback harus memberi tamu langkah berikutnya");

console.log("✓ booking form followup regressions passed");
