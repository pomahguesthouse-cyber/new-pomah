/**
 * Unduh ulang media masuk WhatsApp yang hanya menyimpan `meta_media_id`.
 *
 * Tidak dijalankan otomatis, tidak masuk skrip tes, dan menolak berjalan di CI
 * supaya pipeline tidak menyentuh produksi.
 *
 * Dry-run (tidak mengunduh):
 *   npx tsx scripts/backfill-wa-inbound-media.ts --days 14
 *
 * Simpan ke bucket wa-inbound (setelah migrasi dijalankan manual):
 *   npx tsx scripts/backfill-wa-inbound-media.ts --days 14 --apply
 */
import { pathToFileURL } from "node:url";
import {
  backfillInboundMediaMessages,
  needsInboundMediaBackfill,
  runInboundMediaJob,
  type BackfillCandidate,
} from "../src/services/wa-inbound-media";

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

function daysArg(): number {
  const eq = process.argv.find((arg) => arg.startsWith("--days="));
  if (eq) return Number(eq.slice("--days=".length)) || 14;
  const index = process.argv.indexOf("--days");
  if (index >= 0) return Number(process.argv[index + 1]) || 14;
  return 14;
}

async function main(): Promise<void> {
  if (process.env.CI) {
    console.log("backfill-wa-inbound-media: dilewati di CI (tidak menyentuh produksi).");
    return;
  }
  const days = daysArg();
  if (!process.argv.includes("--apply")) {
    console.log(
      `backfill-wa-inbound-media: dry-run ${days} hari. Tambahkan --apply untuk mengunduh dan menyimpan. Tidak dijalankan dari CI.`,
    );
    return;
  }

  const { supabaseAdmin } = await import("../src/integrations/supabase/client.server");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id, thread_id, sent_at, metadata, whatsapp_threads(phone, display_name)")
    .eq("direction", "in")
    .gte("sent_at", since)
    .not("metadata->>meta_media_id", "is", null)
    .order("sent_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const now = new Date();
  const rows: Array<BackfillCandidate & { phone: string; threadId: string | null; guestName: string | null; mediaId: string; mediaType: string | null; mimeType: string | null; fileName: string | null }> = [];
  for (const row of (data ?? []) as Array<Record<string, any>>) {
    const metadata = (row.metadata ?? null) as Record<string, unknown> | null;
    if (!needsInboundMediaBackfill({ sentAt: row.sent_at, metadata }, now, days)) continue;
    const thread = row.whatsapp_threads ?? {};
    rows.push({
      id: row.id,
      sentAt: row.sent_at,
      metadata,
      phone: String(thread.phone ?? ""),
      threadId: row.thread_id ?? null,
      guestName: thread.display_name ?? null,
      mediaId: String(metadata?.meta_media_id ?? ""),
      mediaType: typeof metadata?.media_type === "string" ? metadata.media_type : null,
      mimeType: typeof metadata?.mime_type === "string" ? metadata.mime_type : null,
      fileName: typeof metadata?.file_name === "string" ? metadata.file_name : null,
    });
  }

  const report = await backfillInboundMediaMessages(rows, async (row) => {
    const full = row as (typeof rows)[number];
    const result = await runInboundMediaJob(supabaseAdmin as never, {
      phone: full.phone,
      guestName: full.guestName,
      messageId: full.id,
      threadId: full.threadId,
      media: {
        mediaId: full.mediaId,
        mediaType: full.mediaType,
        mimeType: full.mimeType,
        fileName: full.fileName,
      },
      at: new Date(full.sentAt),
      sentAt: full.sentAt,
    });
    return { mediaDownloadStatus: result.mediaDownloadStatus };
  });

  console.log(
    `backfill-wa-inbound-media: scanned=${report.scanned} stored=${report.stored} expired=${report.expired} failed=${report.failed}`,
  );
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
