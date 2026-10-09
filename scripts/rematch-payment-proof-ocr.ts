/**
 * Hitung ulang pencocokan bukti transfer untuk pesan yang sudah punya ocr_result.
 *
 * Tidak dijalankan otomatis, tidak masuk tes, dan menolak berjalan di CI.
 * Tidak mengirim notifikasi. Tidak mengubah status atau nominal booking —
 * hanya menulis ulang whatsapp_messages.metadata.ocr_match.
 *
 * Dry-run (baca dan cetak, tidak menulis):
 *   npx tsx scripts/rematch-payment-proof-ocr.ts --days 45
 *
 * Simpan hasil pencocokan baru:
 *   npx tsx scripts/rematch-payment-proof-ocr.ts --days 45 --apply
 */
import { pathToFileURL } from "node:url";
import { matchPaymentProof } from "../src/services/payment-proof.service";
import type { PaymentProofOcrInput } from "../src/services/payment-proof-match";

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

function numberArg(flag: string, fallback: number): number {
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return Number(eq.slice(flag.length + 1)) || fallback;
  const index = process.argv.indexOf(flag);
  if (index >= 0) return Number(process.argv[index + 1]) || fallback;
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function main(): Promise<void> {
  if (process.env.CI) {
    console.log("rematch-payment-proof-ocr: dilewati di CI (tidak menyentuh produksi, tidak mengirim notifikasi).");
    return;
  }
  const apply = process.argv.includes("--apply");
  const days = numberArg("--days", 45);
  const limit = numberArg("--limit", 200);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(
      "rematch-payment-proof-ocr: butuh SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY. " +
        "Tanpa --apply skrip hanya mencetak rencana. Tidak mengubah pembayaran dan tidak mengirim notifikasi.",
    );
    return;
  }

  const { supabaseAdmin } = await import("../src/integrations/supabase/client.server");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id, sent_at, body, metadata, thread_id, whatsapp_threads(phone, canonical_phone)")
    .eq("direction", "in")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(Math.max(limit * 4, limit));
  if (error) throw new Error(error.message);

  const now = new Date();
  let scanned = 0;
  let updated = 0;
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    if (scanned >= limit) break;
    const metadata = asRecord(row.metadata);
    const ocr = asRecord(metadata?.ocr_result) as PaymentProofOcrInput | null;
    if (!ocr) continue;
    scanned += 1;
    const thread = (row.whatsapp_threads ?? {}) as { phone?: string | null; canonical_phone?: string | null };
    const phone = String(thread.phone ?? thread.canonical_phone ?? "").trim();
    const previous = asRecord(metadata?.ocr_match);
    const match = await matchPaymentProof(supabaseAdmin as never, phone, ocr, {
      now,
      note: typeof row.body === "string" ? row.body : null,
    });
    const before = typeof previous?.status === "string" ? previous.status : "-";
    console.log(
      [
        row.id,
        String(row.sent_at ?? "").slice(0, 10),
        `${before} -> ${match.status}`,
        match.booking_code ?? "-",
        match.destination_ok ? "rekening-ok" : "rekening-cek",
        match.summary,
      ].join(" | "),
    );
    if (!apply) continue;
    const { error: saveError } = await (supabaseAdmin as never).rpc("save_message_metadata", {
      p_message_id: row.id,
      p_metadata: {
        ocr_match: match,
        ocr_rematched_at: now.toISOString(),
      },
    });
    if (saveError) {
      console.warn("gagal simpan", row.id, saveError.message ?? saveError);
      continue;
    }
    updated += 1;
  }

  console.log(
    apply
      ? `rematch-payment-proof-ocr: ${scanned} baris dibaca, ${updated} ocr_match ditulis. Tidak ada notifikasi. Pembayaran tidak diubah.`
      : `rematch-payment-proof-ocr: dry-run ${scanned} baris. Tambahkan --apply untuk menulis ocr_match. Tidak ada notifikasi.`,
  );
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
