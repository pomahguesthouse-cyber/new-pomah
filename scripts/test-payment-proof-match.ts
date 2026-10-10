/**
 * Pencocokan bukti transfer: DP 50%, sisa, beberapa booking, rekening tujuan.
 * Tidak menyentuh produksi dan tidak mengubah status pembayaran.
 */
import assert from "node:assert/strict";
import {
  formatPaymentProofSummary,
  isOpenPaymentCandidate,
  matchProofToCandidates,
  paymentAmountFit,
  paymentAmountsClose,
  paymentAmountTolerance,
  TRANSFER_FEE_SURPLUS_TOLERANCE,
  paymentDestinationOk,
  receivedTransferAmount,
  roomTypeMentioned,
  type PaymentMatchCandidate,
  type PaymentProofOcrInput,
} from "../src/services/payment-proof-match";
import { matchPaymentProof } from "../src/services/payment-proof.service";

const NOW = new Date("2026-10-09T05:00:00.000Z");

function booking(over: Partial<PaymentMatchCandidate> & Pick<PaymentMatchCandidate, "bookingCode" | "total">): PaymentMatchCandidate {
  return {
    paid: 0,
    nights: 2,
    checkIn: "2026-10-07",
    checkOut: "2026-10-12",
    status: "confirmed",
    paymentStatus: "unpaid",
    roomTypes: ["Deluxe"],
    createdAt: "2026-10-07T02:00:00.000Z",
    source: "booking",
    ...over,
  };
}

function ocr(over: Partial<PaymentProofOcrInput> = {}): PaymentProofOcrInput {
  return {
    bank_pengirim: "BCA",
    bank_tujuan: "BCA",
    nominal: null,
    biaya_admin: null,
    total_dibayar: null,
    tanggal: "2026-10-09",
    nama_pengirim: "Tamu",
    nomor_referensi: "REF",
    raw_text: "Transfer BCA 0095584379 a.n. Faizal Abdurachman",
    ...over,
  };
}

const rita = booking({
  bookingCode: "PG-GET5N",
  total: 475000,
  nights: 2,
  checkIn: "2026-10-08",
  checkOut: "2026-10-10",
  createdAt: "2026-10-06T03:00:00.000Z",
});

const firstDeluxe = booking({
  bookingCode: "PG-2WA7S",
  total: 460000,
  nights: 2,
  checkIn: "2026-10-07",
  checkOut: "2026-10-09",
  createdAt: "2026-10-06T01:00:00.000Z",
  roomTypes: ["Deluxe"],
});

// ─── Nominal yang diterima, bukan total debit ────────────────────────────────

{
  const amount = receivedTransferAmount(ocr({ nominal: 237500, biaya_admin: 2500, total_dibayar: 240000 }));
  assert.equal(amount, 237500);
  assert.equal(
    receivedTransferAmount({ nominal: null, biaya_admin: 2500, total_dibayar: 240000 }),
    237500,
  );
  assert.equal(receivedTransferAmount({ nominal: null, biaya_admin: null, total_dibayar: 237500 }), 237500);
  assert.equal(receivedTransferAmount({ nominal: 0, biaya_admin: 2500, total_dibayar: 240000 }), 237500);
}

// ─── Rita: 50% dari 475.000 adalah DP, bukan selisih ke total ───────────────

{
  const match = matchProofToCandidates(
    ocr({ nominal: 237500, biaya_admin: 2500, total_dibayar: 240000 }),
    [rita],
    { now: NOW },
  );
  assert.equal(match.status, "matched_dp");
  assert.equal(match.booking_code, "PG-GET5N");
  assert.equal(match.expected_amount, 237500);
  assert.equal(match.amount_diff, 0);
  assert.equal(match.booking_amount, 475000);
  assert.equal(match.destination_ok, true);
  assert.equal(match.summary, "Cocok DP 50% PG-GET5N (Rp237.500)");
  assert.match(match.match_reason, /tidak diubah/i);
}

// ─── ...1043 transfer pertama: DP PG-2WA7S ───────────────────────────────────

{
  const match = matchProofToCandidates(
    ocr({ nominal: 230000, biaya_admin: 2500, total_dibayar: 232500, raw_text: "BCA 0095584379 FAIZAL ABDURACHMAN" }),
    [firstDeluxe],
    { now: NOW },
  );
  assert.equal(match.status, "matched_dp");
  assert.equal(match.booking_code, "PG-2WA7S");
  assert.equal(match.expected_amount, 230000);
  assert.equal(match.amount_diff, 0);
  assert.equal(match.summary, "Cocok DP 50% PG-2WA7S (Rp230.000)");
}

// ─── Transfer kedua, DP sudah tercatat 230.000 → sisa ───────────────────────

{
  const halfPaid = booking({ ...firstDeluxe, paid: 230000, paymentStatus: "partial" });
  const match = matchProofToCandidates(
    ocr({ nominal: 230000, biaya_admin: 2500, total_dibayar: 232500 }),
    [halfPaid],
    { now: NOW },
  );
  assert.equal(match.status, "matched_remaining");
  assert.equal(match.booking_code, "PG-2WA7S");
  assert.equal(match.expected_amount, 230000);
  assert.equal(match.amount_diff, 0);
  assert.equal(match.summary, "Cocok sisa PG-2WA7S (Rp230.000)");
}

// ─── Ada booking Deluxe kedua + catatan "duluxe" → booking itu yang dipilih ─

{
  const halfPaid = booking({ ...firstDeluxe, paid: 230000, paymentStatus: "partial", roomTypes: ["Superior"] });
  const second = booking({
    bookingCode: "PG-DLX2",
    total: 460000,
    paid: 0,
    nights: 2,
    checkIn: "2026-10-10",
    checkOut: "2026-10-12",
    createdAt: "2026-10-09T01:00:00.000Z",
    roomTypes: ["Deluxe"],
  });
  const proof = ocr({
    nominal: 230000,
    biaya_admin: 2500,
    total_dibayar: 232500,
    raw_text: "Transfer tipe duluxe BCA 0095584379 a.n. Faizal Abdurachman",
  });
  const match = matchProofToCandidates(proof, [halfPaid, second], { now: NOW });
  assert.equal(match.booking_code, "PG-DLX2");
  assert.ok(match.status === "matched_dp" || match.status === "matched_remaining");
  assert.equal(match.status, "matched_dp");
  assert.match(match.match_reason, /tipe kamar/i);
  assert.equal(roomTypeMentioned(["Deluxe"], "tipe duluxe"), true);
  assert.equal(roomTypeMentioned(["Superior"], "tipe duluxe"), false);
}

// ─── Exact menang atas kamar yang hanya masuk toleransi ─────────────────────

{
  const exactStandard = booking({
    bookingCode: "PG-STD",
    total: 460000,
    paid: 230000,
    paymentStatus: "partial",
    roomTypes: ["Superior"],
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  const fuzzyDeluxe = booking({
    bookingCode: "PG-NEAR",
    total: 462000,
    paid: 0,
    roomTypes: ["Deluxe"],
    createdAt: "2026-10-09T08:00:00.000Z",
  });
  const match = matchProofToCandidates(
    ocr({ nominal: 230000, raw_text: "duluxe BCA 0095584379 Faizal Abdurachman" }),
    [fuzzyDeluxe, exactStandard],
    { now: NOW },
  );
  assert.equal(match.booking_code, "PG-STD");
  assert.equal(match.status, "matched_remaining");
  assert.equal(match.amount_diff, 0);
}

// ─── Bukan bukti transfer: tidak melempar ───────────────────────────────────

{
  const cat = ocr({
    bank_pengirim: null,
    bank_tujuan: null,
    nominal: null,
    biaya_admin: null,
    total_dibayar: null,
    nama_pengirim: null,
    nomor_referensi: null,
    raw_text: "foto kucing",
  });
  const none = matchProofToCandidates(cat, [], { now: NOW });
  assert.equal(none.status, "no_pending_booking");
  assert.equal(none.destination_ok, false);
  assert.equal(none.summary, "Tidak ada booking terbuka untuk dicocokkan");

  const withBooking = matchProofToCandidates(cat, [rita, { ...rita, bookingCode: "", total: Number.NaN }], { now: NOW });
  assert.equal(withBooking.status, "unmatched");
  assert.equal(withBooking.booking_code, "PG-GET5N");
  assert.equal(withBooking.amount_diff, null);
  assert.match(withBooking.summary, /Nominal tidak terbaca/);
}

// ─── Rekening tujuan ─────────────────────────────────────────────────────────

{
  assert.equal(
    paymentDestinationOk(ocr({ bank_tujuan: "BCA", raw_text: "ke 0095584379 a.n. Faizal Abdurachman" })),
    true,
  );
  assert.equal(paymentDestinationOk({ bank_tujuan: null, raw_text: "FAIZAL ABDURACHMAN" }), true);
  assert.equal(
    paymentDestinationOk({ bank_tujuan: "BCA", raw_text: "BCA 1234567890 a.n. Budi Santoso" }),
    false,
  );
  const wrong = matchProofToCandidates(
    ocr({
      nominal: 237500,
      biaya_admin: 2500,
      total_dibayar: 240000,
      bank_tujuan: "Mandiri",
      raw_text: "Mandiri 1234567890 a.n. Budi Santoso",
    }),
    [rita],
    { now: NOW },
  );
  assert.equal(wrong.status, "matched_dp");
  assert.equal(wrong.destination_ok, false);
  assert.equal(
    paymentDestinationOk({ bank_tujuan: "Mandiri", raw_text: "untuk Faizal Abdurachman rekening Mandiri" }),
    false,
  );
}

// ─── Toleransi: max(Rp1.000, 0,5%) ───────────────────────────────────────────

{
  assert.equal(paymentAmountTolerance(100_000), 1000);
  assert.equal(paymentAmountTolerance(200_000), 1000);
  assert.equal(paymentAmountTolerance(1_000_000), 5000);
  assert.equal(paymentAmountTolerance(237_500), 1188);
  assert.equal(paymentAmountsClose(101_000, 100_000), true);
  assert.equal(paymentAmountsClose(101_001, 100_000), false);
  assert.equal(paymentAmountsClose(1_005_000, 1_000_000), true);
  assert.equal(paymentAmountsClose(1_005_001, 1_000_000), false);

  const oneNight = booking({
    bookingCode: "PG-1N",
    total: 200_000,
    nights: 1,
    checkIn: "2026-10-11",
    checkOut: "2026-10-12",
    roomTypes: ["Standard"],
  });
  const edge = matchProofToCandidates(ocr({ nominal: 201_000, raw_text: "BCA 0095584379 Faizal Abdurachman" }), [oneNight], { now: NOW });
  assert.equal(edge.status, "matched_full");
  assert.equal(edge.expected_amount, 200_000);

  // Lebih sedikit di atas toleransi kecil kini dianggap biaya transfer.
  const smallFee = matchProofToCandidates(ocr({ nominal: 201_001, raw_text: "BCA 0095584379 Faizal Abdurachman" }), [oneNight], { now: NOW });
  assert.equal(smallFee.status, "matched_full");
  assert.equal(smallFee.transfer_fee_surplus, 1001);

  const feeEdge = matchProofToCandidates(ocr({ nominal: 206_500, raw_text: "BCA 0095584379 Faizal Abdurachman" }), [oneNight], { now: NOW });
  assert.equal(feeEdge.status, "matched_full");
  assert.equal(feeEdge.summary, "Cocok lunas PG-1N (Rp200.000, lebih Rp6.500, kemungkinan biaya transfer)");

  const over = matchProofToCandidates(ocr({ nominal: 206_501, raw_text: "BCA 0095584379 Faizal Abdurachman" }), [oneNight], { now: NOW });
  assert.equal(over.status, "overpaid");
  assert.equal(over.transfer_fee_surplus, null);
  assert.match(over.summary, /Lebih bayar/);

  const halfOfOneNight = matchProofToCandidates(
    ocr({ nominal: 100_000, raw_text: "BCA 0095584379 Faizal Abdurachman" }),
    [oneNight],
    { now: NOW },
  );
  assert.equal(halfOfOneNight.status, "partial");
  assert.equal(halfOfOneNight.summary, "Belum cocok: transfer Rp100.000, booking PG-1N butuh sisa Rp200.000");

  const between = matchProofToCandidates(
    ocr({ nominal: 300_000, raw_text: "BCA 0095584379 Faizal Abdurachman" }),
    [rita],
    { now: NOW },
  );
  assert.equal(between.status, "unmatched");
  assert.equal(
    between.summary,
    "Belum cocok: transfer Rp300.000, booking PG-GET5N butuh DP Rp237.500/ sisa Rp475.000",
  );

  const shortOfRemainder = matchProofToCandidates(
    ocr({ nominal: 100_000, raw_text: "BCA 0095584379 Faizal Abdurachman" }),
    [booking({ ...firstDeluxe, paid: 230_000, paymentStatus: "partial" })],
    { now: NOW },
  );
  assert.equal(shortOfRemainder.status, "partial");
  assert.equal(
    shortOfRemainder.summary,
    "Belum cocok: transfer Rp100.000, booking PG-2WA7S butuh DP Rp230.000/ sisa Rp230.000",
  );

  const dpEdge = matchProofToCandidates(
    ocr({ nominal: 237_500 + 1188, raw_text: "BCA 0095584379 Faizal Abdurachman" }),
    [rita],
    { now: NOW },
  );
  assert.equal(dpEdge.status, "matched_dp");
  const dpFee = matchProofToCandidates(
    ocr({ nominal: 237_500 + 1189, raw_text: "BCA 0095584379 Faizal Abdurachman" }),
    [rita],
    { now: NOW },
  );
  assert.equal(dpFee.status, "matched_dp");
  assert.equal(dpFee.transfer_fee_surplus, 1189);
  const dpUnder = matchProofToCandidates(
    ocr({ nominal: 237_500 - 1189, raw_text: "BCA 0095584379 Faizal Abdurachman" }),
    [rita],
    { now: NOW },
  );
  assert.notEqual(dpUnder.status, "matched_dp");
  const dpMiss = matchProofToCandidates(
    ocr({ nominal: 237_500 + 6501, raw_text: "BCA 0095584379 Faizal Abdurachman" }),
    [rita],
    { now: NOW },
  );
  assert.notEqual(dpMiss.status, "matched_dp");
}

// ─── Kelebihan biaya transfer (BI-FAST Rp2.500, antarbank Rp6.500) ──────────

{
  const BCA = "BCA 0095584379 Faizal Abdurachman";
  assert.equal(TRANSFER_FEE_SURPLUS_TOLERANCE, 6500);
  assert.equal(paymentAmountFit(230_000, 230_000), "exact");
  assert.equal(paymentAmountFit(230_500, 230_000), "tolerance");
  assert.equal(paymentAmountFit(229_000, 230_000), "tolerance");
  assert.equal(paymentAmountFit(232_500, 230_000), "transfer_fee");
  assert.equal(paymentAmountFit(236_500, 230_000), "transfer_fee");
  assert.equal(paymentAmountFit(237_000, 230_000), null);
  assert.equal(paymentAmountFit(227_500, 230_000), null);

  // DP 50%: 230.000 diharapkan, 232.500 masuk → cocok dengan catatan biaya transfer.
  const dpFee = matchProofToCandidates(ocr({ nominal: 232_500, raw_text: BCA }), [firstDeluxe], { now: NOW });
  assert.equal(dpFee.status, "matched_dp");
  assert.equal(dpFee.booking_code, "PG-2WA7S");
  assert.equal(dpFee.expected_amount, 230_000);
  assert.equal(dpFee.amount_diff, 2500);
  assert.equal(dpFee.transfer_fee_surplus, 2500);
  assert.equal(dpFee.summary, "Cocok DP 50% PG-2WA7S (Rp230.000, lebih Rp2.500, kemungkinan biaya transfer)");
  assert.match(dpFee.match_reason, /toleransi biaya transfer/);
  assert.match(dpFee.match_reason, /lebih Rp2\.500, kemungkinan biaya transfer/);
  assert.equal(formatPaymentProofSummary(dpFee), dpFee.summary);

  const dpFeeMax = matchProofToCandidates(ocr({ nominal: 236_500, raw_text: BCA }), [firstDeluxe], { now: NOW });
  assert.equal(dpFeeMax.status, "matched_dp");
  assert.equal(dpFeeMax.transfer_fee_surplus, 6500);

  const dpTooMuch = matchProofToCandidates(ocr({ nominal: 237_000, raw_text: BCA }), [firstDeluxe], { now: NOW });
  assert.notEqual(dpTooMuch.status, "matched_dp");
  assert.equal(dpTooMuch.transfer_fee_surplus, null);

  const dpUnder = matchProofToCandidates(ocr({ nominal: 227_500, raw_text: BCA }), [firstDeluxe], { now: NOW });
  assert.equal(dpUnder.status, "partial");
  assert.equal(dpUnder.transfer_fee_surplus, null);

  // Lunas satu malam 230.000.
  const oneNight = booking({
    bookingCode: "PG-1N230",
    total: 230_000,
    nights: 1,
    checkIn: "2026-10-11",
    checkOut: "2026-10-12",
    roomTypes: ["Standard"],
  });
  const fullFee = matchProofToCandidates(ocr({ nominal: 232_500, raw_text: BCA }), [oneNight], { now: NOW });
  assert.equal(fullFee.status, "matched_full");
  assert.equal(fullFee.summary, "Cocok lunas PG-1N230 (Rp230.000, lebih Rp2.500, kemungkinan biaya transfer)");
  const fullMax = matchProofToCandidates(ocr({ nominal: 236_500, raw_text: BCA }), [oneNight], { now: NOW });
  assert.equal(fullMax.status, "matched_full");
  const fullOver = matchProofToCandidates(ocr({ nominal: 237_000, raw_text: BCA }), [oneNight], { now: NOW });
  assert.equal(fullOver.status, "overpaid");
  assert.match(fullOver.summary, /Lebih bayar/);
  const fullUnder = matchProofToCandidates(ocr({ nominal: 227_500, raw_text: BCA }), [oneNight], { now: NOW });
  assert.equal(fullUnder.status, "partial");

  // Sisa tagihan setelah DP 230.000 tercatat.
  const halfPaid = booking({ ...firstDeluxe, paid: 230_000, paymentStatus: "partial" });
  const remainingFee = matchProofToCandidates(ocr({ nominal: 232_500, raw_text: BCA }), [halfPaid], { now: NOW });
  assert.equal(remainingFee.status, "matched_remaining");
  assert.equal(remainingFee.transfer_fee_surplus, 2500);
  assert.equal(remainingFee.summary, "Cocok sisa PG-2WA7S (Rp230.000, lebih Rp2.500, kemungkinan biaya transfer)");
  const remainingUnder = matchProofToCandidates(ocr({ nominal: 227_500, raw_text: BCA }), [halfPaid], { now: NOW });
  assert.equal(remainingUnder.status, "partial");

  // Data lama tanpa transfer_fee_surplus: ringkasan tetap memakai amount_diff.
  assert.equal(
    formatPaymentProofSummary({ status: "matched_dp", booking_code: "PG-OLD", expected_amount: 230_000, amount_diff: 2500 }),
    "Cocok DP 50% PG-OLD (Rp230.000, lebih Rp2.500, kemungkinan biaya transfer)",
  );
  assert.equal(
    formatPaymentProofSummary({ status: "matched_dp", booking_code: "PG-OLD", expected_amount: 230_000, amount_diff: 0 }),
    "Cocok DP 50% PG-OLD (Rp230.000)",
  );

  // Beberapa kandidat: persis > toleransi kecil > toleransi biaya transfer.
  const feeNewer = booking({
    bookingCode: "PG-FEE",
    total: 230_000,
    nights: 1,
    checkIn: "2026-10-11",
    checkOut: "2026-10-12",
    roomTypes: ["Standard"],
    createdAt: "2026-10-09T03:00:00.000Z",
  });
  const exactOlder = booking({ ...feeNewer, bookingCode: "PG-EXACT", total: 232_500, createdAt: "2026-10-01T03:00:00.000Z" });
  const closeOlder = booking({ ...feeNewer, bookingCode: "PG-CLOSE", total: 233_000, createdAt: "2026-10-01T03:00:00.000Z" });
  const exactWins = matchProofToCandidates(ocr({ nominal: 232_500, raw_text: BCA }), [feeNewer, exactOlder], { now: NOW });
  assert.equal(exactWins.booking_code, "PG-EXACT");
  assert.equal(exactWins.transfer_fee_surplus, null);
  assert.equal(exactWins.summary, "Cocok lunas PG-EXACT (Rp232.500)");
  const closeWins = matchProofToCandidates(ocr({ nominal: 232_500, raw_text: BCA }), [feeNewer, closeOlder], { now: NOW });
  assert.equal(closeWins.booking_code, "PG-CLOSE");
  const feeAlone = matchProofToCandidates(ocr({ nominal: 232_500, raw_text: BCA }), [feeNewer], { now: NOW });
  assert.equal(feeAlone.booking_code, "PG-FEE");

  // Dalam satu booking: DP persis lebih diutamakan daripada sisa + biaya transfer.
  const dpVsRemaining = booking({ ...firstDeluxe, bookingCode: "PG-DPR", total: 460_000, paid: 225_000, paymentStatus: "partial" });
  const dpExact = matchProofToCandidates(ocr({ nominal: 230_000, raw_text: BCA }), [dpVsRemaining], { now: NOW });
  assert.equal(dpExact.status, "matched_dp");
  assert.equal(dpExact.amount_diff, 0);
}

// ─── Checkout, batal, lunas, draft ───────────────────────────────────────────

{
  assert.equal(
    isOpenPaymentCandidate(booking({ bookingCode: "PG-OLD", total: 1000, checkOut: "2026-10-07" }), NOW),
    false,
  );
  assert.equal(
    isOpenPaymentCandidate(booking({ bookingCode: "PG-YDAY", total: 1000, checkOut: "2026-10-08" }), NOW),
    true,
  );
  assert.equal(
    isOpenPaymentCandidate(booking({ bookingCode: "PG-X", total: 1000, status: "cancelled" }), NOW),
    false,
  );
  assert.equal(
    isOpenPaymentCandidate(
      booking({ bookingCode: "PG-PAID", total: 1000, paymentStatus: "paid", paid: 1000 }),
      NOW,
    ),
    false,
  );
  const staleDraft = booking({
    bookingCode: "DRAFT-old",
    total: 237500,
    nights: 1,
    source: "draft",
    status: "failed",
    createdAt: "2026-08-01T00:00:00.000Z",
    checkOut: "2026-10-12",
  });
  const freshDraft = booking({
    bookingCode: "DRAFT-new",
    total: 237500,
    nights: 1,
    source: "draft",
    status: "draft",
    createdAt: "2026-10-08T00:00:00.000Z",
    roomTypes: ["Deluxe"],
    checkIn: "2026-10-11",
    checkOut: "2026-10-12",
  });
  const skipped = matchProofToCandidates(ocr({ nominal: 237500 }), [staleDraft, freshDraft], { now: NOW });
  assert.equal(skipped.booking_code, "DRAFT-new");
  assert.equal(skipped.status, "matched_full");
}

// ─── Loader: varian nomor, tidak menulis booking ─────────────────────────────

function chain(rows: Record<string, unknown>[]) {
  const state = {
    filters: [] as Array<(row: Record<string, unknown>) => boolean>,
    order: null as { col: string; asc: boolean } | null,
    limit: 50,
  };
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = self;
  builder.eq = (col: string, val: unknown) => {
    state.filters.push((row) => row[col] === val);
    return builder;
  };
  builder.neq = (col: string, val: unknown) => {
    state.filters.push((row) => row[col] !== val);
    return builder;
  };
  builder.in = (col: string, vals: unknown[]) => {
    const allowed = new Set(vals);
    state.filters.push((row) => allowed.has(row[col]));
    return builder;
  };
  builder.gte = (col: string, val: unknown) => {
    state.filters.push((row) => row[col] != null && String(row[col]) >= String(val));
    return builder;
  };
  builder.order = (col: string, opts?: { ascending?: boolean }) => {
    state.order = { col, asc: opts?.ascending !== false };
    return builder;
  };
  builder.limit = (n: number) => {
    state.limit = n;
    return builder;
  };
  builder.update = () => {
    throw new Error("booking tidak boleh diubah oleh pencocokan OCR");
  };
  builder.insert = () => {
    throw new Error("booking tidak boleh ditambah oleh pencocokan OCR");
  };
  const run = () => {
    let out = rows.filter((row) => state.filters.every((filter) => filter(row)));
    if (state.order) {
      const { col, asc } = state.order;
      out = [...out].sort((left, right) => {
        if (left[col] === right[col]) return 0;
        return (String(left[col]) > String(right[col]) ? 1 : -1) * (asc ? 1 : -1);
      });
    }
    return out.slice(0, state.limit);
  };
  builder.then = (resolve: (value: { data: unknown; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: run(), error: null }).then(resolve, reject);
  return builder;
}

function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      return chain(tables[table] ?? []);
    },
  };
}

{
  const ritaOcr = ocr({ nominal: 237500, biaya_admin: 2500, total_dibayar: 240000 });
  const db = fakeDb({
    guests: [{ id: "g-rita", phone: "081110001043" }],
    bookings: [
      {
        id: "b1",
        guest_id: "g-rita",
        reference_code: "PG-GET5N",
        total_amount: 475000,
        paid_amount: 0,
        nights: 2,
        check_in: "2026-10-08",
        check_out: "2026-10-10",
        status: "confirmed",
        payment_status: "unpaid",
        created_at: "2026-10-06T03:00:00.000Z",
        room_types: { name: "Deluxe" },
        booking_rooms: [{ room_types: { name: "Deluxe" } }],
      },
      {
        id: "b-cancel",
        guest_id: "g-rita",
        reference_code: "PG-CANCEL",
        total_amount: 237500,
        paid_amount: 0,
        nights: 1,
        check_in: "2026-10-08",
        check_out: "2026-10-09",
        status: "cancelled",
        payment_status: "unpaid",
        created_at: "2026-10-09T00:00:00.000Z",
      },
    ],
    booking_drafts: [
      {
        id: "d1",
        phone: "6281110001043",
        booking_code: "PG-GET5N",
        quoted_total: 237500,
        check_in: "2026-10-11",
        check_out: "2026-10-12",
        room_type: "Deluxe",
        status: "failed",
        created_at: "2026-10-09T02:00:00.000Z",
        payload: {},
      },
    ],
  });
  const match = await matchPaymentProof(db as never, "6281110001043", ritaOcr, { now: NOW });
  assert.equal(match.status, "matched_dp");
  assert.equal(match.booking_code, "PG-GET5N");
  assert.equal(match.summary, "Cocok DP 50% PG-GET5N (Rp237.500)");
  assert.equal(formatPaymentProofSummary(match), match.summary);
}

{
  const guest = [{ id: "g1043", phone: "6281234501043", phone_normalized: "6281234501043" }];
  const firstBooking = {
    id: "old",
    guest_id: "g1043",
    reference_code: "PG-2WA7S",
    total_amount: 460000,
    paid_amount: 0,
    nights: 2,
    check_in: "2026-10-07",
    check_out: "2026-10-09",
    status: "confirmed",
    payment_status: "unpaid",
    created_at: "2026-10-06T01:00:00.000Z",
    room_types: { name: "Deluxe" },
    booking_rooms: [{ room_types: { name: "Deluxe" } }],
  };
  const first = await matchPaymentProof(
    fakeDb({ guests: guest, bookings: [firstBooking], booking_drafts: [] }) as never,
    "081234501043",
    ocr({ nominal: 230000, biaya_admin: 2500, total_dibayar: 232500, raw_text: "BCA 0095584379 Faizal Abdurachman" }),
    { now: NOW },
  );
  assert.equal(first.booking_code, "PG-2WA7S");
  assert.equal(first.status, "matched_dp");

  const second = await matchPaymentProof(
    fakeDb({
      guests: guest,
      bookings: [
        { ...firstBooking, paid_amount: 230000, payment_status: "partial", room_types: { name: "Superior" }, booking_rooms: [{ room_types: { name: "Superior" } }] },
        {
          id: "new",
          guest_id: "g1043",
          reference_code: "PG-DLX2",
          total_amount: 460000,
          paid_amount: 0,
          nights: 2,
          check_in: "2026-10-10",
          check_out: "2026-10-12",
          status: "pending",
          payment_status: "unpaid",
          created_at: "2026-10-09T01:00:00.000Z",
          room_types: { name: "Deluxe" },
          booking_rooms: [{ room_types: { name: "Deluxe" } }],
        },
      ],
      booking_drafts: [],
    }) as never,
    "6281234501043",
    ocr({
      nominal: 230000,
      biaya_admin: 2500,
      total_dibayar: 232500,
      raw_text: "tipe duluxe BCA 0095584379 a.n. Faizal Abdurachman",
    }),
    { now: NOW },
  );
  assert.equal(second.booking_code, "PG-DLX2");
  assert.equal(second.status, "matched_dp");
  assert.equal(second.destination_ok, true);
}

console.log("payment-proof match ok");
