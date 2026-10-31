/** Kebijakan pemilik: transfer 1–2 malam lunas; DP 50% hanya 3+ malam; bayar di tempat boleh untuk semua tamu (31 Okt 2026). */
import assert from "node:assert/strict";
import {
  allowsDeposit, allowsPayAtCheckin, mentionsPayAtCheckin, requiredDepositAmount, requiresFullPayment, FULL_PAYMENT_POLICY_TEXT,
} from "../src/lib/deposit-policy";
import { planInitialBookingPayment } from "../src/tools/booking.tool";
import { buildPaymentPolicyAnswer, bookingMethodGuestText } from "../src/ai/state-machine/booking-inline-answers";
import { buildInvoicePaymentLines } from "../src/services/invoice-notification.service";
import { formatStaffPaymentLine } from "../src/services/staff-booking-alert";
import { matchProofToCandidates, type PaymentMatchCandidate } from "../src/services/payment-proof-match";
import { botPaymentRuleText } from "../src/lib/payment-account";

// Helper
assert.equal(requiredDepositAmount(1, 230000), 230000);
assert.equal(requiredDepositAmount(2, 475000), 475000);
assert.equal(requiredDepositAmount(3, 690000), 345000);
assert.equal(requiredDepositAmount(null, 500000), 500000);
assert.equal(requiresFullPayment(2), true);
assert.equal(requiresFullPayment(3), false);
assert.equal(requiresFullPayment(null), false);
assert.equal(allowsDeposit(2), false);
assert.equal(allowsDeposit(3), true);
assert.equal(allowsPayAtCheckin(1), true); // bayar di tempat diperbolehkan (31 Okt 2026)
assert.equal(allowsPayAtCheckin(5), true);
assert.match(FULL_PAYMENT_POLICY_TEXT, /1–2 malam dibayar lunas/);
assert.ok(mentionsPayAtCheckin("bayar di tempat ya kak"));
assert.ok(mentionsPayAtCheckin("bayarnya pas check in aja"));
assert.ok(!mentionsPayAtCheckin("mau transfer saja"));
const onsite = planInitialBookingPayment({ nights: 1, total: 207000, paymentType: "onsite", now: 0 });
assert.equal(onsite.paymentMethod, "onsite");
assert.equal(onsite.expiresAt, null, "bayar di tempat tidak punya batas waktu");
assert.equal(onsite.paymentStatus, "unpaid");

// Booking creation: 2 malam ignores DP request; 3 malam keeps it.
const two = planInitialBookingPayment({ nights: 2, total: 475000, paymentType: "dp", dpAmount: 237500, now: 0 });
assert.equal(two.paidAmount, 0);
assert.equal(two.paymentStatus, "unpaid");
assert.ok(two.expiresAt);
const three = planInitialBookingPayment({ nights: 3, total: 690000, paymentType: "dp", dpAmount: 345000, now: 0 });
assert.equal(three.paidAmount, 345000);
assert.equal(three.paymentStatus, "partial");
const one = planInitialBookingPayment({ nights: 1, total: 230000, paymentType: "dp", dpAmount: 1, now: 0 });
assert.equal(one.paidAmount, 0);
assert.equal(one.paymentStatus, "unpaid");
assert.ok(one.expiresAt, "1 malam kini wajib transfer lunas sebelum kedatangan");

// Bot replies.
const a2 = buildPaymentPolicyAnswer({ nights: 2, totalPrice: 475000 });
assert.match(a2, /bayar di tempat saat check-in/);
assert.match(a2, /lunas/);
assert.doesNotMatch(a2, /DP dulu/);
assert.match(a2, /475\.000/);
assert.match(buildPaymentPolicyAnswer({ nights: 3, totalPrice: 690000 }), /DP dulu 50% \(Rp\s?345\.000/);
const a1 = buildPaymentPolicyAnswer({ nights: 1, totalPrice: 230000 });
assert.match(a1, /bayar di tempat saat check-in/);
assert.doesNotMatch(a1, /tidak ada (opsi )?bayar di tempat|belum bisa bayar di tempat/);
const aUnknown = buildPaymentPolicyAnswer({});
assert.match(aUnknown, /3 malam atau lebih, Kakak bisa DP/);
assert.match(aUnknown, /1–2 malam dibayar lunas/);
assert.match(aUnknown, /bayar di tempat/);
assert.match(buildPaymentPolicyAnswer({ nights: 3, totalPrice: 690000 }), /bayar di tempat/);
const rule = botPaymentRuleText();
assert.match(rule, /BAYAR DI TEMPAT/);
assert.match(rule, /DP 50% hanya untuk 3 malam/);
assert.match(bookingMethodGuestText(), /bayar di tempat saat check-in/);
assert.doesNotMatch(bookingMethodGuestText(), /tidak ada bayar di tempat/);
const inv1 = buildInvoicePaymentLines({ paymentStatus: "unpaid", paidAmount: 0, totalAmount: 230000, nights: 1 });
assert.match(inv1, /Rp 230\.000 \(lunas via transfer/);
const invOnsite = buildInvoicePaymentLines({ paymentStatus: "unpaid", paidAmount: 0, totalAmount: 207000, nights: 1, paymentMethod: "onsite", expiresAt: "2026-10-30T17:40:00Z", bankDetails: "BANK" });
assert.match(invOnsite, /Bayar di tempat saat check-in/);
assert.doesNotMatch(invOnsite, /Batas waktu|dibatalkan|BANK/);
// Staf: booking baru 1 malam tanpa metode → bukan "Bayar di tempat"; booking lama bertanda onsite tetap.
assert.match(formatStaffPaymentLine({ totalAmount: 230000, paidAmount: 0, nights: 1, paymentStatus: "unpaid", paymentMethod: null } as never), /^Wajib lunas Rp/);
assert.equal(formatStaffPaymentLine({ totalAmount: 230000, paidAmount: 0, nights: 1, paymentStatus: "unpaid", paymentMethod: "onsite" } as never), "Bayar di tempat");

// Invoice text.
const inv2 = buildInvoicePaymentLines({ paymentStatus: "unpaid", paidAmount: 0, totalAmount: 475000, nights: 2 });
assert.match(inv2, /Jumlah yang harus dibayar: Rp 475\.000 \(lunas via transfer, tanpa DP — atau bisa bayar di tempat saat check-in\)/);
assert.doesNotMatch(buildInvoicePaymentLines({ paymentStatus: "unpaid", paidAmount: 0, totalAmount: 690000, nights: 3 }), /lunas via transfer/);

// Staff alert.
assert.match(formatStaffPaymentLine({ totalAmount: 475000, paidAmount: 0, nights: 2, paymentStatus: "unpaid" } as never), /^Wajib lunas Rp/);
assert.match(formatStaffPaymentLine({ totalAmount: 690000, paidAmount: 0, nights: 3, paymentStatus: "unpaid" } as never), /^DP 50%/);
assert.match(formatStaffPaymentLine({ totalAmount: 475000, paidAmount: 237500, nights: 2, paymentStatus: "partial" } as never), /wajib lunas/);

// Payment proof: 2 malam expects full price (+ Rp6.500 fee tolerance), half is not a DP match.
const cand = (over: Partial<PaymentMatchCandidate>): PaymentMatchCandidate => ({
  bookingCode: "PG-TEST", total: 475000, paid: 0, nights: 2, checkIn: "2026-10-20", checkOut: "2026-10-22",
  status: "confirmed", paymentStatus: "unpaid", roomTypes: ["Deluxe"], createdAt: "2026-10-16T02:00:00Z", source: "booking", ...over,
});
const ocr = (n: number) => ({ bank_pengirim: "BCA", bank_tujuan: "BCA", nominal: n, biaya_admin: null, total_dibayar: n,
  tanggal: "2026-10-16", nama_pengirim: "Tamu", nomor_referensi: "R", raw_text: "Transfer BCA 0095584379 a.n. Faizal Abdurachman" });
const run = (n: number, c: PaymentMatchCandidate) => (matchProofToCandidates as any)(ocr(n), [c], { now: new Date("2026-10-16T05:00:00Z") });
assert.equal(run(475000, cand({})).status, "matched_full");
assert.equal(run(481500, cand({})).status, "matched_full");
assert.notEqual(run(237500, cand({})).status, "matched_dp");
assert.equal(run(345000, cand({ total: 690000, nights: 3, checkOut: "2026-10-23" })).status, "matched_dp");

console.log("test-lunas-policy: OK");
