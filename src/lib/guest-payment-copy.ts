/**
 * Salinan pembayaran yang dilihat tamu.
 * Booking bayar di tempat tidak memakai kata "menunggu pembayaran",
 * batas waktu transfer, atau instruksi rekening wajib.
 */
import { isOnsitePaymentMethod } from "@/lib/deposit-policy";

export const ONSITE_GUEST_PAYMENT_LINE = "Pembayaran dilakukan di tempat saat check-in.";
export const ONSITE_STATUS_LABEL = "Bayar di Tempat";

/** Frasa yang tidak boleh muncul di teks tamu untuk booking bayar di tempat. */
export const ONSITE_FORBIDDEN_GUEST_RE =
  /menunggu pembayaran|pembayaran ditunggu|mohon segera transfer|transfer dalam 1 jam|dibatalkan otomatis|otomatis dibatalkan|batas waktu pembayaran|silakan transfer|kirim bukti transfer|transfer pembayaran/i;

export function formatGuestRupiah(amount: number): string {
  const n = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  return `Rp ${n.toLocaleString("id-ID")}`;
}

export function isOnsitePaymentChoice(
  paymentMethod?: string | null,
  paymentType?: string | null,
): boolean {
  if (String(paymentType ?? "").trim().toLowerCase() === "onsite") return true;
  return isOnsitePaymentMethod(paymentMethod) || isOnsitePaymentMethod(paymentType);
}

/** Blok status di pesan invoice WhatsApp untuk bayar di tempat. Total tetap disebut. */
export function buildOnsiteInvoicePaymentLines(totalAmount: number): string {
  return (
    `• Status Pembayaran: ${ONSITE_STATUS_LABEL}\n` +
    `• ${ONSITE_GUEST_PAYMENT_LINE}\n` +
    `• Total: ${formatGuestRupiah(totalAmount)}`
  );
}

/** Label kolom DETAIL TRANSAKSI di PDF/HTML invoice. */
export function invoiceTransactionStatusLabel(input: {
  payment_status?: string | null;
  payment_method?: string | null;
}): string {
  if (input.payment_status === "paid") return "Lunas";
  if (input.payment_status === "partial") return "Pembayaran Sebagian";
  if (isOnsitePaymentMethod(input.payment_method)) return ONSITE_STATUS_LABEL;
  return "Belum Bayar";
}

export type GuestConfirmationPaymentMode = "paid" | "onsite" | "partial" | "unpaid";

/** Mode blok pembayaran di halaman /book/confirmation. */
export function guestConfirmationPaymentMode(input: {
  paymentStatus?: string | null;
  paidAmount?: number | null;
  totalAmount?: number | null;
  paymentMethod?: string | null;
}): GuestConfirmationPaymentMode {
  const total = Number(input.totalAmount ?? 0);
  const paid = Number(input.paidAmount ?? 0);
  const status = String(input.paymentStatus ?? "unpaid");
  const isPaid = status === "paid" || (total > 0 && paid >= total);
  if (isPaid) return "paid";
  if (isOnsitePaymentMethod(input.paymentMethod)) return "onsite";
  if (status === "partial" || paid > 0) return "partial";
  return "unpaid";
}

/** Balasan bot tepat setelah createBooking. Transfer tetap memakai kalimat lama. */
export function buildBookingCreatedGuestReply(input: {
  guestName?: string | null;
  referenceCode: string;
  paymentType?: string | null;
  paymentMethod?: string | null;
  totalAmount?: number | null;
  invoiceUrl?: string | null;
}): string {
  const lead =
    `Terima kasih, Kak ${input.guestName ?? ""} 🙏 Pemesanan berhasil dibuat ` +
    `dengan kode ${input.referenceCode}. `;
  if (!isOnsitePaymentChoice(input.paymentMethod, input.paymentType)) {
    return `${lead}Berikut invoice dan cara pembayarannya:`;
  }
  const total = Number(input.totalAmount ?? 0);
  const totalBit =
    Number.isFinite(total) && total > 0
      ? ` Total Rp${Math.round(total).toLocaleString("id-ID")}.`
      : "";
  const link = String(input.invoiceUrl ?? "").trim();
  const linkBit = link ? ` Invoice: ${link}` : "";
  return `${lead}${ONSITE_GUEST_PAYMENT_LINE}${totalBit}${linkBit}`;
}

