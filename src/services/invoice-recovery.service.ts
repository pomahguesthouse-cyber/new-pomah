import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyInvoiceResult } from "@/services/invoice-dispatch";
import {
  generateAndSendInvoiceNotification,
  type InvoiceResult,
} from "@/services/invoice-notification.service";

/**
 * Jaring pengaman untuk booking yang fungsi invoice-nya terputus sebelum
 * baris `invoices` tertulis. Hanya booking non-batal, 5 menit–24 jam,
 * punya nomor tamu, dan belum punya baris `invoices`.
 *
 * Tidak memakai `force`: klaim `wa_sent_at` tetap menolak kirim kedua.
 * Booking yang sudah punya baris invoice (termasuk yang gagal kirim lalu
 * melepas klaim) tidak disentuh — itu jalur "Kirim Invoice" manual.
 */

export const INVOICE_RECOVERY_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const INVOICE_RECOVERY_MIN_AGE_MS = 5 * 60 * 1000;
/** 3 × batas 9 detik tetap di bawah timeout pg_net 30 detik. */
export const INVOICE_RECOVERY_BATCH_LIMIT = 3;

export interface MissingInvoiceRow {
  id: string;
  status: string;
  created_at: string;
  guests: { phone: string | null } | Array<{ phone: string | null }> | null;
  invoices: { id: string } | Array<{ id: string }> | null;
}

export interface InvoiceRecoveryResult {
  ok: boolean;
  checked: number;
  eligible: number;
  sent: number;
  failed: number;
  skipped: number;
  error?: string;
}

export function guestPhoneOf(row: MissingInvoiceRow): string | null {
  const guest = row.guests;
  const phone = Array.isArray(guest) ? guest[0]?.phone : guest?.phone;
  const trimmed = typeof phone === "string" ? phone.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function hasInvoiceRecord(row: MissingInvoiceRow): boolean {
  const invoice = row.invoices;
  if (!invoice) return false;
  if (Array.isArray(invoice)) return invoice.length > 0;
  return Boolean(invoice.id);
}

/** Filter murni. Query DB sudah mempersempit jendela; ini penjaga kedua untuk tes. */
export function selectRecoverableBookings(
  rows: MissingInvoiceRow[],
  now = Date.now(),
): MissingInvoiceRow[] {
  const earliest = now - INVOICE_RECOVERY_LOOKBACK_MS;
  const latest = now - INVOICE_RECOVERY_MIN_AGE_MS;
  return rows.filter((row) => {
    if (row.status === "cancelled") return false;
    if (!guestPhoneOf(row)) return false;
    if (hasInvoiceRecord(row)) return false;
    const created = Date.parse(row.created_at);
    if (!Number.isFinite(created)) return false;
    return created >= earliest && created <= latest;
  });
}

type SendInvoice = (input: {
  supabase: SupabaseClient;
  bookingId: string;
  skipWhatsApp?: boolean;
  force?: boolean;
}) => Promise<InvoiceResult>;

/**
 * Supabase query builder is thenable. The structural type stays loose so a
 * test double can implement the same chain.
 */
interface RecoveryDb {
  from(table: string): {
    select(columns: string): RecoveryFilter;
  };
}

interface RecoveryFilter {
  neq(column: string, value: string): RecoveryFilter;
  gte(column: string, value: string): RecoveryFilter;
  lte(column: string, value: string): RecoveryFilter;
  order(column: string, options: { ascending: boolean }): RecoveryFilter;
  limit(count: number): PromiseLike<{
    data: MissingInvoiceRow[] | null;
    error: { message: string } | null;
  }>;
}

export async function recoverMissingInvoices(
  supabase: RecoveryDb,
  deps?: {
    now?: () => number;
    send?: SendInvoice;
    limit?: number;
  },
): Promise<InvoiceRecoveryResult> {
  const now = deps?.now?.() ?? Date.now();
  const limit = deps?.limit ?? INVOICE_RECOVERY_BATCH_LIMIT;
  const send = deps?.send ?? generateAndSendInvoiceNotification;
  const windowStart = new Date(now - INVOICE_RECOVERY_LOOKBACK_MS).toISOString();
  const windowEnd = new Date(now - INVOICE_RECOVERY_MIN_AGE_MS).toISOString();

  const { data, error } = await supabase
    .from("bookings")
    .select("id, status, created_at, guests(phone), invoices(id)")
    .neq("status", "cancelled")
    .gte("created_at", windowStart)
    .lte("created_at", windowEnd)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[recover-missing-invoices] query failed:", error.message);
    return { ok: false, checked: 0, eligible: 0, sent: 0, failed: 0, skipped: 0, error: error.message };
  }

  const rows = (data ?? []) as MissingInvoiceRow[];
  const eligible = selectRecoverableBookings(rows, now);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of eligible) {
    try {
      const result = await send({
        supabase: supabase as unknown as SupabaseClient,
        bookingId: row.id,
        skipWhatsApp: false,
        force: false,
      });
      const outcome = classifyInvoiceResult(result);
      if (outcome.status === "sent") sent += 1;
      else if (outcome.status === "failed") failed += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.warn(
        `[recover-missing-invoices] send threw for ${row.id.slice(0, 8)}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (eligible.length > 0) {
    console.info(
      `[recover-missing-invoices] checked=${rows.length} eligible=${eligible.length} sent=${sent} failed=${failed} skipped=${skipped}`,
    );
  }

  return { ok: true, checked: rows.length, eligible: eligible.length, sent, failed, skipped };
}
