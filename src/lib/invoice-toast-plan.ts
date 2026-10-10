import type { BookingInvoiceOutcome } from "@/services/invoice-dispatch";

export const INVOICE_RESEND_ACTION_LABEL = "Kirim Invoice";

export type InvoiceToastPlan =
  | { kind: "success"; title: string }
  | { kind: "info"; title: string }
  | { kind: "warning"; title: string; actionLabel: typeof INVOICE_RESEND_ACTION_LABEL | null };

/**
 * Pesan toast setelah booking admin tersimpan.
 * `sent` → sukses. `failed` → peringatan + aksi kirim ulang bila booking id ada.
 * `skipped` (tanpa nomor / sudah terkirim) tidak menawarkan kirim ulang.
 */
export function planBookingInvoiceToast(
  invoice: BookingInvoiceOutcome | null | undefined,
  opts?: { canResend?: boolean },
): InvoiceToastPlan | null {
  if (!invoice) return null;
  if (invoice.status === "sent") {
    return { kind: "success", title: "Invoice terkirim ke WhatsApp tamu" };
  }
  if (invoice.status === "skipped") {
    return { kind: "info", title: invoice.reason };
  }
  return {
    kind: "warning",
    title: invoice.reason,
    actionLabel: opts?.canResend ? INVOICE_RESEND_ACTION_LABEL : null,
  };
}
