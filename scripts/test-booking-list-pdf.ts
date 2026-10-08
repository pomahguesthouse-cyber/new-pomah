/**
 * Daftar-booking PDF: landscape A4, Indonesian labels, every filtered row's columns,
 * and a summary. Does not read or write booking data.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { BookingListDocument } from "../src/admin/components/booking-list-pdf";
import { collectPages, type ExportRow } from "../src/admin/lib/booking-export";
import {
  bookingListPdfFileName,
  bookingListPdfMessage,
  bookingRoomColumns,
  describeBookingListFilters,
  formatDateId,
  formatIdr,
  formatPrintedAt,
  summarizeBookingRows,
} from "../src/admin/lib/booking-list-pdf-model";

const printedAt = new Date("2026-10-08T06:18:00.000Z");

assert.equal(formatIdr(1250000), "Rp 1.250.000");
assert.equal(formatIdr(0), "Rp 0");
assert.equal(formatIdr(Number.NaN), "Rp 0");
assert.equal(formatDateId("2026-08-01"), "1 Agu 2026");
assert.equal(formatDateId(""), "—");
assert.equal(formatPrintedAt(printedAt), "8 Okt 2026, 13.18 WIB");
assert.equal(bookingListPdfFileName(printedAt), "Daftar-Booking-2026-10-08.pdf");
assert.equal(
  describeBookingListFilters({ status: "confirmed", source: "whatsapp", search: "Déwi", from: "2026-08-01", to: "2026-08-31" }),
  "Status: Konfirmasi · Sumber: WhatsApp · Check-in: 1 Agu 2026 s/d 31 Agu 2026 · Cari: Déwi",
);
assert.equal(describeBookingListFilters({}), "Status: semua · Sumber: semua");

const parsedRooms = bookingRoomColumns({ rooms: "Kamar Keluarga (12); Deluxe (5)" });
assert.deepEqual(parsedRooms, { types: "Kamar Keluarga, Deluxe", numbers: "12, 5" });
assert.deepEqual(bookingRoomColumns({ rooms: "", room_types: "Family", room_numbers: "101" }), {
  types: "Family",
  numbers: "101",
});

function row(partial: Partial<ExportRow> & Pick<ExportRow, "reference_code" | "guest_name">): ExportRow {
  return {
    guest_email: "",
    guest_phone: "081234567890",
    check_in: "2026-08-01",
    check_out: "2026-08-04",
    nights: 3,
    rooms: "Kamar Keluarga (12)",
    room_types: "Kamar Keluarga",
    room_numbers: "12",
    room_count: 1,
    adults: 2,
    children: 0,
    status: "confirmed",
    source: "whatsapp",
    payment_status: "partial",
    total_amount: 1_250_000,
    paid_amount: 500_000,
    outstanding: 750_000,
    nightly_rate_min: 400_000,
    nightly_rate_max: 400_000,
    created_at: "2026-07-01T00:00:00.000Z",
    ...partial,
  };
}

const featured = row({
  reference_code: "PMH-2401",
  guest_name: "Raden Ayu Déwi Laksmi",
});
const second = row({
  reference_code: "PMH-2402",
  guest_name: "Budi Santoso",
  rooms: "Deluxe (5); Family (8)",
  room_types: "Deluxe, Family",
  room_numbers: "5, 8",
  nights: 2,
  total_amount: 800_000,
  paid_amount: 800_000,
  outstanding: 0,
  status: "checked_in",
  source: "direct",
  payment_status: "paid",
  check_in: "2026-09-10",
  check_out: "2026-09-12",
});
const filler = Array.from({ length: 34 }, (_, index) =>
  row({
    reference_code: `PMH-${3000 + index}`,
    guest_name: index % 2 === 0 ? "Siti Nurhaliza" : "Ni Wayan Ayu",
    nights: 1,
    total_amount: 100_000,
    paid_amount: 0,
    outstanding: 100_000,
    status: "pending",
    source: "website",
    payment_status: "unpaid",
  }),
);
const rows = [featured, second, ...filler];
const summary = summarizeBookingRows(rows);
assert.equal(summary.count, 36);
assert.equal(summary.nights, 3 + 2 + 34);
assert.equal(summary.total, 1_250_000 + 800_000 + 34 * 100_000);
assert.equal(summary.paid, 500_000 + 800_000);

assert.equal(bookingListPdfMessage({ method: "download" }, 36), "PDF diunduh — 36 booking.");
assert.equal(bookingListPdfMessage({ method: "native-share", cancelled: true }, 2), null);
assert.match(bookingListPdfMessage({ method: "native-share" }, 2) ?? "", /Pilih aplikasi/);

const paged = await collectPages(async (from, to) => {
  const size = to - from + 1;
  if (from >= 2500) return [];
  return Array.from({ length: Math.min(size, 2500 - from) }, (_, index) => from + index);
}, 1000, 5000);
assert.equal(paged.rows.length, 2500);
assert.equal(paged.capped, false);
assert.equal(paged.rows[0], 0);
assert.equal(paged.rows[2499], 2499);

const capped = await collectPages(async (from, to) => {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}, 1000, 2000);
assert.equal(capped.rows.length, 2000);
assert.equal(capped.capped, true);

const pdf = await renderToBuffer(
  React.createElement(BookingListDocument, {
    rows,
    propertyName: "Pomah Guesthouse",
    filterSummary: describeBookingListFilters({ status: "confirmed", source: "whatsapp", search: "Déwi" }),
    generatedAt: printedAt,
  }),
);
assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
assert.ok(pdf.length > 5_000, `pdf too small: ${pdf.length}`);

const pdfPath = path.join(os.tmpdir(), "daftar-booking-sample.pdf");
fs.writeFileSync(pdfPath, pdf);
try {
  const artifactDir = "/opt/cursor/artifacts";
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.copyFileSync(pdfPath, path.join(artifactDir, "daftar-booking-sample.pdf"));
} catch {
  // Artifact folder is only present in the cloud agent workspace.
}

if (fs.existsSync("/usr/bin/pdftotext") && fs.existsSync("/usr/bin/pdfinfo")) {
  const { execFileSync } = await import("node:child_process");
  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  assert.match(info, /Pages:\s+2/);
  assert.match(info, /Page size:\s+841\.89 x 595\.28 pts/);
  const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
  for (const needle of [
    "Pomah Guesthouse",
    "Daftar Booking",
    "Raden Ayu Déwi Laksmi",
    "Kamar Keluarga",
    "1 Agu 2026",
    "Rp 1.250.000",
    "Rp 5.450.000",
    "WhatsApp",
    "Jumlah booking 36",
    "Total malam 39",
    "Total dibayar Rp 1.300.000",
    "Halaman 1 / 2",
    "Halaman 2 / 2",
    "Dicetak 8 Okt 2026, 13.18 WIB",
  ]) {
    assert.ok(text.includes(needle), `missing ${needle}`);
  }
}

const bookingsSrc = fs.readFileSync(new URL("../src/routes/admin/bookings.tsx", import.meta.url), "utf8");
assert.match(bookingsSrc, /downloadBookingListPdf/);
assert.match(bookingsSrc, /describeBookingListFilters/);
assert.match(bookingsSrc, /collectPages/);
assert.match(bookingsSrc, /\.range\(from, to\)/);
assert.doesNotMatch(bookingsSrc, /openBlankPrintWindow|openPrintView|window\.print\(/);

const calendarSrc = fs.readFileSync(new URL("../src/routes/admin/calendar.tsx", import.meta.url), "utf8");
assert.match(calendarSrc, /downloadBookingListPdf/);
assert.doesNotMatch(calendarSrc, /openBlankPrintWindow|openPrintView|window\.print\(/);

const exportSrc = fs.readFileSync(new URL("../src/admin/lib/booking-export.ts", import.meta.url), "utf8");
assert.doesNotMatch(exportSrc, /window\.print\(/);
assert.match(exportSrc, /collectPages/);

const pdfSrc = fs.readFileSync(new URL("../src/admin/components/booking-list-pdf.tsx", import.meta.url), "utf8");
assert.match(pdfSrc, /orientation="landscape"/);
assert.match(pdfSrc, /size="A4"/);
assert.match(pdfSrc, /wrap=\{false\}/);
assert.match(pdfSrc, /Halaman /);
assert.match(pdfSrc, /PomahSans/);
for (const label of ["Kode", "Tamu", "Tipe kamar", "No. kamar", "Check-in", "Check-out", "Malam", "Total", "Dibayar", "Status", "Sumber"]) {
  assert.match(pdfSrc, new RegExp(label));
}
for (const label of ["Jumlah booking", "Total malam", "Total nilai", "Total dibayar"]) {
  assert.match(pdfSrc, new RegExp(label));
}

console.log("booking list pdf tests passed", pdf.length, "bytes", "pages-file", pdfPath);
