/**
 * E2E test: pastikan webhook Fonnte memicu notifikasi `new_message`
 * ke super_admin dan ter-dedupe per messageId.
 *
 * Skenario:
 *   1. Kirim payload webhook Fonnte (POST /api/fonnte) dengan fonnteId unik.
 *   2. Kirim payload yang sama 2x lagi → harus ter-dedup oleh in-memory
 *      deduplicator sehingga hanya 1 messageId yang tersimpan.
 *   3. Verifikasi `notification_logs` punya minimal 1 baris dengan
 *      event_type = "new_message" untuk dedupe_key new_message:<messageId>:<admin>.
 *   4. Panggil ulang `notifyIncomingMessage` (via webhook lagi dgn fonnteId
 *      sama) → pastikan jumlah baris log tidak bertambah (dedupe OK).
 *
 * Jalankan:
 *   bun run scripts/test-fonnte-webhook-notify-dedupe.ts \
 *     [--base=https://new-pomah.lovable.app] [--phone=628123456789]
 *
 * ENV yang dibutuhkan:
 *   FONNTE_WEBHOOK_TOKEN, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const BASE   = (args.base as string) || "https://new-pomah.lovable.app";
const PHONE  = (args.phone as string) || `6281200${Date.now().toString().slice(-7)}`;
const TOKEN  = process.env.FONNTE_WEBHOOK_TOKEN ?? "";
const SUPA_URL = process.env.SUPABASE_URL ?? "";
const SUPA_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

if (!TOKEN || !SUPA_URL || !SUPA_KEY) {
  console.error("✗ Env hilang: FONNTE_WEBHOOK_TOKEN / SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const db = createClient(SUPA_URL, SUPA_KEY);

const FONNTE_ID = `e2e-test-${Date.now()}`;
const MSG       = `[E2E test ${new Date().toISOString()}] ping notifikasi super admin`;

function payload(): Record<string, string> {
  return {
    sender:  PHONE,
    message: MSG,
    name:    "E2E Tester",
    id:      FONNTE_ID,
  };
}

async function postWebhook(): Promise<number> {
  const res = await fetch(`${BASE}/api/fonnte`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(payload()),
  });
  return res.status;
}

async function countNewMessageLogs(): Promise<number> {
  // notification_logs.message berisi nomor HP tamu di body, kita filter
  // berdasarkan event_type + recipient_role super_admin + waktu recent.
  const sinceIso = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data, error } = await db
    .from("notification_logs")
    .select("id, dedupe_key, status, recipient_role, message, created_at")
    .eq("event_type", "new_message")
    .eq("recipient_role", "super_admin")
    .gte("created_at", sinceIso)
    .ilike("message", `%${PHONE}%`);

  if (error) {
    console.warn("  ⚠ query notification_logs error:", error.message);
    return -1;
  }
  return (data ?? []).length;
}

async function waitForLogs(target: number, timeoutMs = 30_000): Promise<number> {
  const start = Date.now();
  let last = 0;
  while (Date.now() - start < timeoutMs) {
    last = await countNewMessageLogs();
    if (last >= target) return last;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return last;
}

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log(`▶ Base URL : ${BASE}`);
  console.log(`▶ Phone    : ${PHONE}`);
  console.log(`▶ FonnteID : ${FONNTE_ID}`);

  // Sanity: super_admin ada?
  const { data: admins } = await db
    .from("property_managers")
    .select("id, name, phone")
    .eq("role", "super_admin");
  if (!admins || admins.length === 0) {
    console.error("✗ Tidak ada super_admin di property_managers — test dibatalkan.");
    process.exit(1);
  }
  console.log(`▶ Super admin terdaftar: ${admins.length}`);

  // 1. Kirim webhook pertama
  console.log("\n[1] POST /api/fonnte (pertama)");
  const s1 = await postWebhook();
  check("Webhook 1 status 200", s1 === 200, `status=${s1}`);

  // 2. Tunggu notif terkirim (waitUntil di CF Worker bisa butuh beberapa detik)
  console.log("\n[2] Menunggu notification_logs muncul…");
  const c1 = await waitForLogs(admins.length, 30_000);
  check(
    "Notifikasi new_message tercatat untuk super_admin",
    c1 >= 1,
    `count=${c1}, expected≥1`,
  );

  // 3. Kirim webhook duplikat (fonnteId sama) — harus ter-dedup di hot path
  console.log("\n[3] POST /api/fonnte (duplikat, fonnteId sama)");
  const s2 = await postWebhook();
  const s3 = await postWebhook();
  check("Webhook 2 status 200", s2 === 200, `status=${s2}`);
  check("Webhook 3 status 200", s3 === 200, `status=${s3}`);

  // 4. Tunggu sebentar lalu pastikan jumlah log TIDAK bertambah
  console.log("\n[4] Verifikasi dedupe per messageId (jumlah log stabil)");
  await new Promise((r) => setTimeout(r, 6_000));
  const c2 = await countNewMessageLogs();
  check(
    "Tidak ada notifikasi tambahan setelah webhook duplikat",
    c2 === c1,
    `before=${c1}, after=${c2}`,
  );

  // 5. Bersihkan baris test
  console.log("\n[5] Cleanup");
  const sinceIso = new Date(Date.now() - 10 * 60_000).toISOString();
  const { error: delErr } = await db
    .from("notification_logs")
    .delete()
    .eq("event_type", "new_message")
    .ilike("message", `%${PHONE}%`)
    .gte("created_at", sinceIso);
  check("Cleanup notification_logs", !delErr, delErr?.message);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ Unhandled error:", e);
  process.exit(1);
});
