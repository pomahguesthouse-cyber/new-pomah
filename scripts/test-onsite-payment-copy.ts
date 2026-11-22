/**
 * Booking bayar di tempat tidak menampilkan "pembayaran ditunggu" ke tamu.
 * Booking transfer tetap memakai teks batas waktu dan instruksi rekening.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isOnsitePaymentMethod } from "../src/lib/deposit-policy";
import { shouldExpireUnpaidBooking } from "../src/lib/booking-expiry";
import {
  ONSITE_FORBIDDEN_GUEST_RE,
  ONSITE_GUEST_PAYMENT_LINE,
  ONSITE_STATUS_LABEL,
  buildBookingCreatedGuestReply,
  buildOnsiteInvoicePaymentLines,
  guestConfirmationPaymentMode,
  invoiceTransactionStatusLabel,
} from "../src/lib/guest-payment-copy";
import { buildInvoicePaymentLines } from "../src/services/invoice-notification.service";
import {
  buildAdminInvoiceMessage,
  buildInvoicePaymentBlock,
} from "../src/admin/modules/whatsapp/wa-invoice-message";

const BANK = "\n\nTransfer Pembayaran:\n🏦 Bank: BCA\n💳 No. Rekening: 0095584379\n👤 Atas Nama: Tamu";
const PAST = "2026-11-22T01:00:00.000Z";
const NOW = Date.parse("2026-11-22T02:00:00.000Z");

assert.equal(isOnsitePaymentMethod("onsite"), true);
assert.equal(isOnsitePaymentMethod("cash"), true);
assert.equal(isOnsitePaymentMethod("pay_at_checkin"), true);
assert.equal(isOnsitePaymentMethod("bayar_di_tempat"), true);
assert.equal(isOnsitePaymentMethod("Bayar di tempat saat check-in"), true);
assert.equal(isOnsitePaymentMethod("pay at property"), true);
assert.equal(isOnsitePaymentMethod("transfer"), false);
assert.equal(isOnsitePaymentMethod("bank_transfer"), false);
assert.equal(isOnsitePaymentMethod(null), false);

const onsiteLines = buildInvoicePaymentLines({
  paymentStatus: "unpaid",
  paidAmount: 0,
  totalAmount: 287000,
  nights: 1,
  paymentMethod: "Bayar di tempat saat check-in",
  expiresAt: PAST,
  bankDetails: BANK,
});
assert.equal(onsiteLines, buildOnsiteInvoicePaymentLines(287000));
assert.match(onsiteLines, /Status Pembayaran: Bayar di Tempat/);
assert.match(onsiteLines, /Pembayaran dilakukan di tempat saat check-in\./);
assert.match(onsiteLines, /Total: Rp 287\.000/);
assert.doesNotMatch(onsiteLines, ONSITE_FORBIDDEN_GUEST_RE);
assert.doesNotMatch(onsiteLines, /0095584379|BCA|1 jam|Batas waktu/);

const onsiteCode = buildInvoicePaymentLines({
  paymentStatus: "unpaid",
  paidAmount: 0,
  totalAmount: 207000,
  nights: 1,
  paymentMethod: "onsite",
  expiresAt: PAST,
  bankDetails: BANK,
});
assert.match(onsiteCode, /Bayar di Tempat/);
assert.match(onsiteCode, /Rp 207\.000/);
assert.doesNotMatch(onsiteCode, ONSITE_FORBIDDEN_GUEST_RE);

const transferLines = buildInvoicePaymentLines({
  paymentStatus: "unpaid",
  paidAmount: 0,
  totalAmount: 230000,
  nights: 1,
  paymentMethod: "transfer",
  expiresAt: PAST,
  bankDetails: BANK,
});
assert.match(transferLines, /Menunggu pembayaran/);
assert.match(transferLines, /Batas waktu pembayaran: 1 jam/);
assert.match(transferLines, /otomatis dibatalkan/);
assert.match(transferLines, /Transfer Pembayaran/);
assert.match(transferLines, /0095584379/);
assert.match(transferLines, /Rp 230\.000/);
assert.doesNotMatch(transferLines, /Bayar di Tempat/);

const account = "BCA 0095584379 a.n. Faizal Abdurachman";
const transferBlock = buildInvoicePaymentBlock({
  paymentStatus: "unpaid",
  paidAmount: 0,
  totalAmount: 207000,
  transferAccountLine: account,
  paymentMethod: "transfer",
});
assert.match(transferBlock, /transfer ke BCA 0095584379/);
assert.match(transferBlock, /Mohon kirim bukti transfer/);

const onsiteBlock = buildInvoicePaymentBlock({
  paymentStatus: "unpaid",
  paidAmount: 0,
  totalAmount: 207000,
  transferAccountLine: account,
  paymentMethod: "onsite",
});
assert.equal(onsiteBlock, ONSITE_GUEST_PAYMENT_LINE);
assert.doesNotMatch(onsiteBlock, ONSITE_FORBIDDEN_GUEST_RE);
assert.doesNotMatch(onsiteBlock, /0095584379/);

const onsiteMessage = buildAdminInvoiceMessage({
  guestName: "Husni Haris",
  referenceCode: "PG-BSH8P",
  rooms: [{ typeName: "Deluxe", roomNumber: "205" }],
  checkIn: "2026-11-22",
  checkOut: "2026-11-23",
  totalAmount: 287000,
  paidAmount: 0,
  nights: 1,
  paymentStatus: "unpaid",
  paymentMethod: "Bayar di tempat saat check-in",
  invoiceUrl: "https://pomahguesthouse.com/book/confirmation/PG-BSH8P",
  transferAccountLine: account,
});
assert.match(onsiteMessage, /Total: Rp287\.000/);
assert.match(onsiteMessage, /Pembayaran dilakukan di tempat saat check-in\./);
assert.doesNotMatch(onsiteMessage, ONSITE_FORBIDDEN_GUEST_RE);
assert.doesNotMatch(onsiteMessage, /0095584379|bukti transfer/);

const transferMessage = buildAdminInvoiceMessage({
  guestName: "Husni Haris",
  referenceCode: "PG-BSH8P",
  rooms: [{ typeName: "Deluxe", roomNumber: "205" }],
  checkIn: "2026-11-22",
  checkOut: "2026-11-23",
  totalAmount: 287000,
  paidAmount: 0,
  nights: 1,
  paymentStatus: "unpaid",
  paymentMethod: "transfer",
  invoiceUrl: "https://pomahguesthouse.com/book/confirmation/PG-BSH8P",
  transferAccountLine: account,
});
assert.match(transferMessage, /Total: Rp287\.000/);
assert.match(transferMessage, /Mohon kirim bukti transfer/);
assert.match(transferMessage, /0095584379/);

assert.equal(
  invoiceTransactionStatusLabel({ payment_status: "unpaid", payment_method: "onsite" }),
  ONSITE_STATUS_LABEL,
);
assert.equal(
  invoiceTransactionStatusLabel({ payment_status: "unpaid", payment_method: "Bayar di tempat saat check-in" }),
  "Bayar di Tempat",
);
assert.equal(
  invoiceTransactionStatusLabel({ payment_status: "unpaid", payment_method: "transfer" }),
  "Belum Bayar",
);
assert.equal(invoiceTransactionStatusLabel({ payment_status: "paid", payment_method: "onsite" }), "Lunas");
assert.equal(
  invoiceTransactionStatusLabel({ payment_status: "partial", payment_method: "transfer" }),
  "Pembayaran Sebagian",
);

assert.equal(
  guestConfirmationPaymentMode({
    paymentStatus: "unpaid",
    paidAmount: 0,
    totalAmount: 287000,
    paymentMethod: "onsite",
  }),
  "onsite",
);
assert.equal(
  guestConfirmationPaymentMode({
    paymentStatus: "unpaid",
    paidAmount: 0,
    totalAmount: 287000,
    paymentMethod: "Bayar di tempat saat check-in",
  }),
  "onsite",
);
assert.equal(
  guestConfirmationPaymentMode({
    paymentStatus: "unpaid",
    paidAmount: 0,
    totalAmount: 230000,
    paymentMethod: "transfer",
  }),
  "unpaid",
);
assert.equal(
  guestConfirmationPaymentMode({
    paymentStatus: "partial",
    paidAmount: 100000,
    totalAmount: 690000,
    paymentMethod: "transfer",
  }),
  "partial",
);
assert.equal(
  guestConfirmationPaymentMode({
    paymentStatus: "paid",
    paidAmount: 287000,
    totalAmount: 287000,
    paymentMethod: "onsite",
  }),
  "paid",
);

const onsiteReply = buildBookingCreatedGuestReply({
  guestName: "Husni",
  referenceCode: "PG-BSH8P",
  paymentType: "onsite",
  totalAmount: 287000,
  invoiceUrl: "https://pomahguesthouse.com/book/confirmation/PG-BSH8P",
});
assert.match(onsiteReply, /PG-BSH8P/);
assert.match(onsiteReply, /Pembayaran dilakukan di tempat saat check-in\./);
assert.match(onsiteReply, /Rp287\.000/);
assert.match(onsiteReply, /pomahguesthouse\.com\/book\/confirmation\/PG-BSH8P/);
assert.doesNotMatch(onsiteReply, /cara pembayarannya|menunggu pembayaran|pembayaran ditunggu/i);

const transferReply = buildBookingCreatedGuestReply({
  guestName: "Husni",
  referenceCode: "PG-TRANSFER",
  paymentType: "full",
  totalAmount: 230000,
});
assert.match(transferReply, /Berikut invoice dan cara pembayarannya:/);
assert.doesNotMatch(transferReply, /Pembayaran dilakukan di tempat/);

const base = {
  status: "pending",
  payment_status: "unpaid",
  expires_at: PAST,
};
assert.equal(shouldExpireUnpaidBooking({ ...base, payment_method: "transfer" }, NOW), true);
assert.equal(shouldExpireUnpaidBooking({ ...base, payment_method: null }, NOW), true);
assert.equal(shouldExpireUnpaidBooking({ ...base, payment_method: "onsite" }, NOW), false);
assert.equal(shouldExpireUnpaidBooking({ ...base, payment_method: "cash" }, NOW), false);
assert.equal(
  shouldExpireUnpaidBooking({ ...base, payment_method: "Bayar di tempat saat check-in" }, NOW),
  false,
);
assert.equal(
  shouldExpireUnpaidBooking({ ...base, payment_method: "transfer", expires_at: null }, NOW),
  false,
);
assert.equal(
  shouldExpireUnpaidBooking({ ...base, payment_method: "transfer", payment_status: "partial" }, NOW),
  false,
);
assert.equal(
  shouldExpireUnpaidBooking({ ...base, payment_method: "transfer", payment_status: "paid" }, NOW),
  false,
);
assert.equal(
  shouldExpireUnpaidBooking(
    { ...base, payment_method: "transfer", expires_at: "2026-11-22T03:00:00.000Z" },
    NOW,
  ),
  false,
);

const confirmation = readFileSync("src/routes/book/confirmation/$id.tsx", "utf8");
assert.match(confirmation, /guestConfirmationPaymentMode/);
assert.match(confirmation, /paymentMode === "onsite"/);
assert.match(confirmation, /ONSITE_STATUS_LABEL/);
assert.match(confirmation, /ONSITE_GUEST_PAYMENT_LINE/);
assert.match(confirmation, /Status pembayaran: menunggu pembayaran\./);
const onsiteBranch = confirmation.slice(
  confirmation.indexOf('paymentMode === "onsite"'),
  confirmation.indexOf('paymentMode === "partial"'),
);
assert.match(onsiteBranch, /ONSITE_GUEST_PAYMENT_LINE/);
assert.doesNotMatch(onsiteBranch, /menunggu pembayaran|Silakan transfer|bukti pembayaran/);

const pdf = readFileSync("src/admin/components/invoice-pdf.tsx", "utf8");
assert.match(pdf, /invoiceTransactionStatusLabel\(booking\)/);

const cron = readFileSync("src/routes/api.cron.expire-bookings.ts", "utf8");
assert.match(cron, /shouldExpireUnpaidBooking/);
assert.match(cron, /expires_at", "is", null/);

const recovery = readFileSync("src/services/invoice-recovery.service.ts", "utf8");
assert.match(recovery, /generateAndSendInvoiceNotification/);
assert.doesNotMatch(recovery, /menunggu pembayaran|pembayaran ditunggu|mohon segera transfer/i);

const machine = readFileSync("src/ai/state-machine/booking-machine.ts", "utf8");
assert.match(machine, /buildBookingCreatedGuestReply/);
assert.match(machine, /followUp: "send_invoice"/);

const orchestrator = readFileSync("src/ai/multi-agent-orchestrator.ts", "utf8");
assert.match(orchestrator, /paymentType === "onsite"/);
assert.match(orchestrator, /Jangan tulis menunggu pembayaran/);

console.log("onsite payment copy: ok");
