import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatTransferAccountLine, resolveBotTransferAccount } from "../src/lib/payment-account";
import {
  ADMIN_INVOICE_SOURCE,
  adminInvoiceMetadata,
  buildAdminInvoiceMessage,
  buildInvoicePageUrl,
  buildInvoicePaymentBlock,
  canSendThreadInvoice,
  displayGuestName,
  formatPukul,
  formatRoomLabel,
  formatRp,
  isInvoicePaid,
  resolveStayNights,
} from "../src/admin/modules/whatsapp/wa-invoice-message";

const builderSrc = readFileSync("src/admin/modules/whatsapp/wa-invoice-message.ts", "utf8");
assert.doesNotMatch(builderSrc, /0095584379/);
assert.doesNotMatch(builderSrc, /Faizal Abdurachman/);
assert.doesNotMatch(builderSrc, /Bank BCA|BCA 00/);

assert.equal(canSendThreadInvoice({ hasThread: true, metaWindowClosed: false, sending: false }), true);
assert.equal(canSendThreadInvoice({ hasThread: true, metaWindowClosed: true, sending: false }), false);
assert.equal(canSendThreadInvoice({ hasThread: true, metaWindowClosed: false, sending: true }), false);
assert.equal(canSendThreadInvoice({ hasThread: false, metaWindowClosed: false, sending: false }), false);

assert.equal(displayGuestName("agus santoso"), "Agus Santoso");
assert.equal(displayGuestName("Puteri Indah"), "Puteri Indah");
assert.equal(displayGuestName("  "), "Tamu");

assert.equal(formatPukul(null, "14:00"), "14.00");
assert.equal(formatPukul("12:00", "14:00"), "12.00");
assert.equal(formatPukul("14.00", "12:00"), "14.00");
assert.equal(formatRp(207000), "Rp207.000");
assert.equal(resolveStayNights(null, "2026-11-18", "2026-11-19"), 1);
assert.equal(resolveStayNights(3, "2026-11-18", "2026-11-19"), 3);

const account = resolveBotTransferAccount({
  payment_bank_name: "Bank BCA",
  payment_account_number: "0095584379",
  payment_account_holder: "Faizal Abdurachman",
});
const accountLine = formatTransferAccountLine(account);
assert.equal(accountLine, "Bank BCA 0095584379 a.n. Faizal Abdurachman");
assert.match(accountLine, /0095584379/);
assert.match(accountLine, /Faizal Abdurachman/);

assert.equal(isInvoicePaid("paid", 0, 207000), true);
assert.equal(isInvoicePaid("unpaid", 0, 207000), false);
assert.equal(isInvoicePaid("partial", 100000, 207000), false);
assert.equal(isInvoicePaid("unpaid", 207000, 207000), true);

const unpaidBlock = buildInvoicePaymentBlock({
  paymentStatus: "unpaid",
  paidAmount: 0,
  totalAmount: 207000,
  transferAccountLine: accountLine,
});
assert.match(unpaidBlock, /Pembayaran bisa langsung saat check-in atau transfer ke Bank BCA 0095584379 a\.n\. Faizal Abdurachman/);
assert.match(unpaidBlock, /Mohon kirim bukti transfer di chat ini ya, Kak/);

const dpBlock = buildInvoicePaymentBlock({
  paymentStatus: "partial",
  paidAmount: 100000,
  totalAmount: 207000,
  transferAccountLine: accountLine,
});
assert.match(dpBlock, /transfer ke Bank BCA 0095584379/);

const paidBlock = buildInvoicePaymentBlock({
  paymentStatus: "paid",
  paidAmount: 207000,
  totalAmount: 207000,
  transferAccountLine: accountLine,
});
assert.equal(paidBlock, "Pembayaran sudah lunas, terima kasih");

// Kasus PG-ZTBVY: header kamar kosong, data ada di booking_rooms.
assert.equal(formatRoomLabel([{ typeName: "Deluxe", roomNumber: "203" }], null, null), "Deluxe 203");
assert.equal(formatRoomLabel([], "Deluxe", "203"), "Deluxe 203");
assert.equal(formatRoomLabel([], null, null), "Kamar");
assert.equal(
  formatRoomLabel(
    [
      { typeName: "Deluxe", roomNumber: "203" },
      { typeName: "Family Room 222", roomNumber: "222" },
    ],
    "Dummy",
    "999",
  ),
  "Deluxe 203, Family Room 222",
);

const invoiceUrl = buildInvoicePageUrl("pomahguesthouse.com", "PG-ZTBVY");
assert.equal(invoiceUrl, "https://pomahguesthouse.com/book/confirmation/PG-ZTBVY");

const unpaid = buildAdminInvoiceMessage({
  guestName: "agus santoso",
  referenceCode: "PG-ZTBVY",
  rooms: [{ typeName: "Deluxe", roomNumber: "203" }],
  headerRoomType: null,
  headerRoomNumber: null,
  checkIn: "2026-11-18",
  checkOut: "2026-11-19",
  checkInTime: null,
  checkOutTime: null,
  totalAmount: 207000,
  paidAmount: 0,
  nights: 1,
  paymentStatus: "unpaid",
  invoiceUrl,
  transferAccountLine: accountLine,
});

assert.match(unpaid, /^Halo Kak Agus Santoso, booking-nya sudah kami buat ya 🙏\n/);
assert.match(unpaid, /Kode booking: PG-ZTBVY/);
assert.match(unpaid, /Kamar: Deluxe 203/);
assert.match(unpaid, /Check-in: 18 November 2026 mulai pukul 14\.00/);
assert.match(unpaid, /Check-out: 19 November 2026 pukul 12\.00/);
assert.match(unpaid, /Total: Rp207\.000 \(1 malam\) \| Sudah dibayar: Rp0 \| Sisa: Rp207\.000/);
assert.match(unpaid, /Invoice: https:\/\/pomahguesthouse\.com\/book\/confirmation\/PG-ZTBVY/);
assert.match(unpaid, /Pembayaran bisa langsung saat check-in atau transfer ke Bank BCA 0095584379 a\.n\. Faizal Abdurachman/);
assert.doesNotMatch(unpaid, /Pembayaran sudah lunas/);

const deposit = buildAdminInvoiceMessage({
  guestName: "Agus Santoso",
  referenceCode: "PG-ZTBVY",
  rooms: [{ typeName: "Deluxe", roomNumber: "203" }],
  checkIn: "2026-11-18",
  checkOut: "2026-11-21",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  totalAmount: 621000,
  paidAmount: 310500,
  nights: null,
  paymentStatus: "partial",
  invoiceUrl,
  transferAccountLine: accountLine,
});
assert.match(deposit, /Total: Rp621\.000 \(3 malam\) \| Sudah dibayar: Rp310\.500 \| Sisa: Rp310\.500/);
assert.match(deposit, /mulai pukul 15\.00/);
assert.match(deposit, /pukul 11\.00/);
assert.match(deposit, /transfer ke Bank BCA 0095584379/);
assert.doesNotMatch(deposit, /Pembayaran sudah lunas/);

const paid = buildAdminInvoiceMessage({
  guestName: "Agus Santoso",
  referenceCode: "PG-ZTBVY",
  rooms: [{ typeName: "Deluxe", roomNumber: "203" }],
  checkIn: "2026-11-18",
  checkOut: "2026-11-19",
  totalAmount: 207000,
  paidAmount: 207000,
  paymentStatus: "paid",
  invoiceUrl,
  transferAccountLine: accountLine,
});
assert.match(paid, /Sudah dibayar: Rp207\.000 \| Sisa: Rp0/);
assert.match(paid, /Pembayaran sudah lunas, terima kasih/);
assert.doesNotMatch(paid, /transfer ke/);

const meta = adminInvoiceMetadata({
  bookingId: "30a901f6-999d-4acb-9415-13be1862d383",
  referenceCode: "PG-ZTBVY",
  invoiceUrl,
  delivery: "document",
  fileName: "Invoice-PG-ZTBVY.pdf",
  storagePath: "thread/file.pdf",
});
assert.equal(meta.source, ADMIN_INVOICE_SOURCE);
assert.equal(meta.is_manual_admin, true);
assert.equal(meta.media_type, "document");
assert.equal(meta.mime_type, "application/pdf");
assert.equal(meta.reference_code, "PG-ZTBVY");

const textMeta = adminInvoiceMetadata({
  bookingId: "x",
  referenceCode: "PG-ZTBVY",
  invoiceUrl,
  delivery: "text",
});
assert.equal(textMeta.media_type, undefined);

console.log("wa inbox send invoice: ok");
