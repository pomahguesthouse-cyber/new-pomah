import { toast } from "sonner";
import {
  INVOICE_RESEND_ACTION_LABEL,
  planBookingInvoiceToast,
} from "@/lib/invoice-toast-plan";
import type { BookingInvoiceOutcome } from "@/services/invoice-dispatch";

export { INVOICE_RESEND_ACTION_LABEL };

type ResendResult = { wa_sent?: boolean; error?: string | null };

/**
 * Toast invoice setelah booking admin dibuat.
 * Tombol "Kirim Invoice" memakai `resendInvoice` yang sudah ada (force resend).
 */
export function toastBookingInvoice(
  invoice: BookingInvoiceOutcome | null | undefined,
  opts?: { onResend?: () => Promise<ResendResult> },
): void {
  const plan = planBookingInvoiceToast(invoice, { canResend: Boolean(opts?.onResend) });
  if (!plan) return;
  if (plan.kind === "success") {
    toast.success(plan.title);
    return;
  }
  if (plan.kind === "info") {
    toast.info(plan.title, { duration: 7000 });
    return;
  }
  toast.warning(plan.title, {
    duration: 14000,
    action:
      plan.actionLabel && opts?.onResend
        ? {
            label: plan.actionLabel,
            onClick: () => {
              const resend = opts.onResend;
              if (!resend) return;
              void resend()
                .then((res) => {
                  if (res?.wa_sent) {
                    toast.success("Invoice berhasil dikirim via WhatsApp");
                    return;
                  }
                  toast.warning(res?.error?.trim() || "Invoice tetap gagal dikirim", {
                    duration: 8000,
                  });
                })
                .catch((err: unknown) => {
                  toast.error(err instanceof Error ? err.message : "Gagal mengirim invoice");
                });
            },
          }
        : undefined,
  });
}
