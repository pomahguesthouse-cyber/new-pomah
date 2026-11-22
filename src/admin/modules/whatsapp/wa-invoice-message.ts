/**
 * Logika murni tombol "Kirim Invoice" di percakapan WhatsApp inbox admin.
 *
 * Pesan merangkum booking yang dipilih staf (termasuk kamar dari
 * `booking_rooms` bila kolom header booking kosong). Rekening transfer
 * tidak di-hardcode di sini — pemanggil wajib memakai
 * `formatTransferAccountLine(resolveBotTransferAccount(property))`.
 */
import { fmtDateID } from "@/lib/date";
import { isOnsitePaymentMethod } from "@/lib/deposit-policy";
import { ONSITE_GUEST_PAYMENT_LINE } from "@/lib/guest-payment-copy";

export const ADMIN_INVOICE_SOURCE = "admin_inbox_invoice";
export const DEFAULT_CHECK_IN_TIME = "14:00";
export const DEFAULT_CHECK_OUT_TIME = "12:00";

export type InvoiceMessageRoom = {
  typeName?: string | null;
  roomNumber?: string | null;
};

export type AdminInvoiceMessageInput = {
  guestName: string;
  referenceCode: string;
  rooms?: InvoiceMessageRoom[] | null;
  headerRoomType?: string | null;
  headerRoomNumber?: string | null;
  checkIn: string;
  checkOut: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  defaultCheckInTime?: string | null;
  defaultCheckOutTime?: string | null;
  totalAmount: number;
  paidAmount: number;
  nights?: number | null;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  invoiceUrl: string;
  transferAccountLine: string;
};

export function canSendThreadInvoice(input: {
  hasThread: boolean;
  metaWindowClosed: boolean;
  sending: boolean;
}): boolean {
  return input.hasThread && !input.metaWindowClosed && !input.sending;
}

/** "14:00" / "14.00" / "14" → "14.00" */
export function formatPukul(raw: string | null | undefined, fallback: string): string {
  const pick = (value: string | null | undefined): string | null => {
    const m = String(value ?? "").trim().match(/(\d{1,2})(?:[:.](\d{2}))?/);
    if (!m) return null;
    return `${m[1].padStart(2, "0")}.${m[2] ?? "00"}`;
  };
  return pick(raw) ?? pick(fallback) ?? "14.00";
}

export function displayGuestName(raw: string | null | undefined): string {
  const name = String(raw ?? "").trim() || "Tamu";
  if (/[A-Z]/.test(name)) return name;
  return name.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

export function formatRoomLabel(
  rooms?: InvoiceMessageRoom[] | null,
  headerRoomType?: string | null,
  headerRoomNumber?: string | null,
): string {
  const fromRooms = (rooms ?? [])
    .map((room) => {
      const typeName = String(room.typeName ?? "").trim();
      const roomNumber = String(room.roomNumber ?? "").trim();
      if (typeName && roomNumber && typeName.toLowerCase().includes(roomNumber.toLowerCase())) {
        return typeName;
      }
      return [typeName, roomNumber].filter(Boolean).join(" ");
    })
    .filter(Boolean);
  if (fromRooms.length) return [...new Set(fromRooms)].join(", ");
  const header = [headerRoomType, headerRoomNumber]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return header || "Kamar";
}

export function nightsBetween(checkIn?: string | null, checkOut?: string | null): number {
  if (!checkIn || !checkOut) return 1;
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

export function resolveStayNights(nights?: number | null, checkIn?: string | null, checkOut?: string | null): number {
  const n = Number(nights);
  if (Number.isFinite(n) && n >= 1) return Math.round(n);
  return nightsBetween(checkIn, checkOut);
}

export function formatRp(amount: number): string {
  const n = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `Rp${n.toLocaleString("id-ID")}`;
}

export function isInvoicePaid(paymentStatus: string | null | undefined, paidAmount: number, totalAmount: number): boolean {
  if (String(paymentStatus ?? "").toLowerCase() === "paid") return true;
  return totalAmount > 0 && paidAmount >= totalAmount;
}

export function buildInvoicePaymentBlock(input: {
  paymentStatus?: string | null;
  paidAmount: number;
  totalAmount: number;
  transferAccountLine: string;
  paymentMethod?: string | null;
}): string {
  if (isInvoicePaid(input.paymentStatus, input.paidAmount, input.totalAmount)) {
    return "Pembayaran sudah lunas, terima kasih";
  }
  if (isOnsitePaymentMethod(input.paymentMethod)) {
    return ONSITE_GUEST_PAYMENT_LINE;
  }
  const account = String(input.transferAccountLine ?? "").trim() || "rekening resmi Pomah Guesthouse";
  return `Pembayaran bisa langsung saat check-in atau transfer ke ${account}. Mohon kirim bukti transfer di chat ini ya, Kak.`;
}

export function buildInvoicePageUrl(publicDomain: string | null | undefined, referenceCode: string): string {
  const raw = String(publicDomain ?? "").trim() || "https://pomahguesthouse.com";
  const base = (raw.startsWith("http") ? raw : `https://${raw}`).replace(/\/+$/, "");
  return `${base}/book/confirmation/${encodeURIComponent(referenceCode)}`;
}

export function buildAdminInvoiceMessage(input: AdminInvoiceMessageInput): string {
  const name = displayGuestName(input.guestName);
  const code = String(input.referenceCode ?? "").trim() || "-";
  const room = formatRoomLabel(input.rooms, input.headerRoomType, input.headerRoomNumber);
  const checkInTime = formatPukul(input.checkInTime, input.defaultCheckInTime ?? DEFAULT_CHECK_IN_TIME);
  const checkOutTime = formatPukul(input.checkOutTime, input.defaultCheckOutTime ?? DEFAULT_CHECK_OUT_TIME);
  const nights = resolveStayNights(input.nights, input.checkIn, input.checkOut);
  const total = Number(input.totalAmount) || 0;
  const paid = Number(input.paidAmount) || 0;
  const remaining = Math.max(0, total - paid);
  const payment = buildInvoicePaymentBlock({
    paymentStatus: input.paymentStatus,
    paidAmount: paid,
    totalAmount: total,
    transferAccountLine: input.transferAccountLine,
    paymentMethod: input.paymentMethod,
  });

  return [
    `Halo Kak ${name}, booking-nya sudah kami buat ya 🙏`,
    `Kode booking: ${code}`,
    `Kamar: ${room}`,
    `Check-in: ${fmtDateID(input.checkIn)} mulai pukul ${checkInTime}`,
    `Check-out: ${fmtDateID(input.checkOut)} pukul ${checkOutTime}`,
    `Total: ${formatRp(total)} (${nights} malam) | Sudah dibayar: ${formatRp(paid)} | Sisa: ${formatRp(remaining)}`,
    `Invoice: ${input.invoiceUrl}`,
    payment,
  ].join("\n");
}

export function adminInvoiceMetadata(input: {
  bookingId: string;
  referenceCode: string;
  invoiceUrl: string;
  delivery: "document" | "text";
  fileName?: string;
  mediaUrl?: string;
  storagePath?: string;
}): Record<string, unknown> {
  return {
    is_manual_admin: true,
    source: ADMIN_INVOICE_SOURCE,
    agent_key: "admin-invoice",
    booking_id: input.bookingId,
    reference_code: input.referenceCode,
    invoice_url: input.invoiceUrl,
    delivery: input.delivery,
    ...(input.delivery === "document"
      ? {
          media_type: "document",
          mime_type: "application/pdf",
          ...(input.fileName ? { file_name: input.fileName } : {}),
          ...(input.mediaUrl ? { media_url: input.mediaUrl } : {}),
          ...(input.storagePath ? { storage_path: input.storagePath } : {}),
        }
      : {}),
  };
}
