/**
 * E2E: webhook Fonnte → notifikasi super_admin → dedupe per messageId.
 *
 * Script ini hanya mengirim 3 payload (1 unik + 2 duplikat) ke endpoint
 * /api/fonnte. Verifikasi `notification_logs` dilakukan terpisah via
 * supabase query (anon tidak punya akses baca tabel ini).
 *
 * Run: bun run scripts/test-fonnte-webhook-notify-dedupe.ts
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const BASE  = (args.base as string) || "https://new-pomah.lovable.app";
const PHONE = (args.phone as string) || `6281200${Date.now().toString().slice(-7)}`;
const TOKEN = process.env.FONNTE_WEBHOOK_TOKEN ?? "";

if (!TOKEN) {
  console.error("✗ FONNTE_WEBHOOK_TOKEN tidak ditemukan");
  process.exit(1);
}

const FONNTE_ID = `e2e-${Date.now()}`;
const MSG = `[E2E ${new Date().toISOString()}] uji notifikasi super admin & dedupe`;

async function postWebhook(label: string): Promise<void> {
  const res = await fetch(`${BASE}/api/fonnte`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      sender:  PHONE,
      message: MSG,
      name:    "E2E Tester",
      id:      FONNTE_ID,
    }),
  });
  const text = await res.text();
  console.log(`  ${label} → HTTP ${res.status} ${text.slice(0, 40)}`);
  if (res.status !== 200) throw new Error(`${label} status ${res.status}`);
}

async function main(): Promise<void> {
  console.log(`▶ Base    : ${BASE}`);
  console.log(`▶ Phone   : ${PHONE}`);
  console.log(`▶ FonnteID: ${FONNTE_ID}`);
  console.log("");

  console.log("[1] POST webhook pertama");
  await postWebhook("req#1");

  console.log("[2] Tunggu 8 detik agar waitUntil menyelesaikan notifikasi");
  await new Promise((r) => setTimeout(r, 8_000));

  console.log("[3] POST webhook duplikat (fonnteId & body sama)");
  await postWebhook("req#2");
  await postWebhook("req#3");

  console.log("[4] Tunggu 5 detik untuk memastikan tidak ada notif tambahan");
  await new Promise((r) => setTimeout(r, 5_000));

  console.log("\n✅ Selesai mengirim. Verifikasi di notification_logs:");
  console.log(`   filter: event_type='new_message' AND message ILIKE '%${PHONE}%'`);
  console.log(`   harapan: 1 baris per super_admin, status='sent'`);
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
