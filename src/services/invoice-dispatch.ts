import {
  generateAndSendInvoiceNotification,
  type InvoiceResult,
} from "@/services/invoice-notification.service";

/**
 * Batas tunggu pengiriman invoice di jalur booking.
 *
 * `void generateAndSendInvoiceNotification(...)` di Cloudflare Workers terputus
 * begitu response dikirim, jadi baris `invoices` tidak pernah tertulis.
 * `waitUntil` juga tidak bisa diandalkan di produksi (media masuk, PR #76).
 * Jalur booking menanti pengiriman di request yang sama, dengan batas waktu
 * supaya simpan booking tidak menggantung.
 */
export const INVOICE_DISPATCH_TIMEOUT_MS = 9_000;

export const INVOICE_TIMEOUT_REASON =
  "Pengiriman invoice melewati batas waktu. Ketuk Kirim Invoice untuk mencoba lagi.";

export type BookingInvoiceOutcome =
  | { status: "sent" }
  | { status: "failed"; reason: string }
  | { status: "skipped"; reason: string };

const TIMEOUT = Symbol("invoice-dispatch-timeout");

export function humanizeInvoiceReason(reason: string): string {
  const text = reason.trim();
  if (!text) return "Gagal mengirim invoice";
  if (/no phone|tidak ada nomor|tanpa nomor/i.test(text)) {
    return "Tamu tidak punya nomor WhatsApp, invoice tidak dikirim.";
  }
  if (/^failed to fetch booking:/i.test(text)) return "Gagal membaca data booking.";
  if (/^failed to upsert invoice:/i.test(text)) return "Gagal menyimpan data invoice.";
  return text;
}

/** Nomor kosong / tidak valid bukan kegagalan kirim — tidak ada yang bisa dikirim ulang. */
export function isSkippableInvoiceReason(reason: string): boolean {
  return /no phone|tidak ada nomor|tanpa nomor|nomor tidak valid/i.test(reason);
}

/**
 * Map hasil service ke status yang dikembalikan ke pemanggil booking.
 * Klaim `wa_sent_at` yang kalah (sudah pernah dikirim) menjadi `skipped`,
 * bukan `failed`, supaya tidak memicu kirim ulang.
 */
export function classifyInvoiceResult(result: InvoiceResult): BookingInvoiceOutcome {
  if (result.wa_sent) return { status: "sent" };
  const reason = (result.error ?? "").trim();
  if (result.ok && !reason) {
    return { status: "skipped", reason: "Invoice sudah pernah dikirim untuk booking ini." };
  }
  const readable = humanizeInvoiceReason(reason);
  if (isSkippableInvoiceReason(reason)) return { status: "skipped", reason: readable };
  return { status: "failed", reason: readable };
}

type SendInvoice = typeof generateAndSendInvoiceNotification;

/**
 * Tunggu pengiriman invoice. Timeout, error, dan kegagalan WhatsApp
 * dikembalikan sebagai status — tidak pernah melempar, supaya booking tetap tersimpan.
 * Dedupe sekali-per-booking tetap di `generateAndSendInvoiceNotification` (`wa_sent_at`).
 */
export async function awaitInvoiceNotification(
  input: Parameters<SendInvoice>[0],
  opts?: { timeoutMs?: number; send?: SendInvoice },
): Promise<BookingInvoiceOutcome> {
  const timeoutMs = opts?.timeoutMs ?? INVOICE_DISPATCH_TIMEOUT_MS;
  const send = opts?.send ?? generateAndSendInvoiceNotification;
  const work = Promise.resolve()
    .then(() => send(input))
    .catch((err): InvoiceResult => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      pdf_url: null,
      wa_sent: false,
    }));

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      work,
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
      }),
    ]);
    if (result === TIMEOUT) {
      void work.then(() => undefined);
      console.warn(
        `[InvoiceDispatch] timeout ${timeoutMs}ms booking=${input.bookingId.slice(0, 8)}`,
      );
      return { status: "failed", reason: INVOICE_TIMEOUT_REASON };
    }
    return classifyInvoiceResult(result);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
